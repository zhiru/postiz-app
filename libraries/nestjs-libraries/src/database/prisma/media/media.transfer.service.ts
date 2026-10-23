import { BadRequestException, HttpException, Injectable } from '@nestjs/common';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { Readable } from 'stream';
import { z } from 'zod';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';
import { UploadFactory } from '@gitroom/nestjs-libraries/upload/upload.factory';
import { UploadedStream } from '@gitroom/nestjs-libraries/upload/upload.interface';
import { uploadStreamToStorage } from '@gitroom/nestjs-libraries/upload/custom.upload.validation';
import {
  completeMediaUploadSchema,
  MediaTransferManifest,
  MediaTransferStatus,
  PreparedMediaTransfer,
  PrepareMediaUploadInput,
  prepareMediaUploadSchema,
  UploadMediaInput,
  uploadMediaSchema,
} from '@gitroom/nestjs-libraries/dtos/media/media.transfer.dto';
import { MediaService } from './media.service';
import {
  MediaTransferRepository,
  TransferRecord,
  TransferState,
} from './media.transfer.repository';

export type ClaimedMediaTransfer = {
  record: TransferRecord;
  state: TransferState;
};
const hash = (value: string | Buffer) =>
  createHash('sha256').update(value).digest('hex');
const problem = (code: string, message: string, status: number) =>
  new HttpException({ code, message }, status);
const unknownError = {
  code: 'UPLOAD_RESULT_UNKNOWN',
  message:
    'The upload result is uncertain. Check this upload again; do not start another upload with a new key.',
};

@Injectable()
export class MediaTransferService {
  private storage = UploadFactory.createStorage();
  constructor(
    private repository: MediaTransferRepository,
    private media: MediaService
  ) {}

  private parse<T>(schema: z.ZodType<T, any, any>, input: unknown): T {
    const parsed = schema.safeParse(input);
    if (!parsed.success)
      throw problem(
        'INVALID_UPLOAD_INPUT',
        'Check the filename, supported MIME type, size, hash and idempotency key. Supply actual file bytes, not a filesystem path.',
        400
      );
    return parsed.data;
  }

  private state(record: TransferRecord): TransferState {
    try {
      const state = JSON.parse(record.result || 'null') as TransferState;
      if (
        state?.version === 1 &&
        state.manifest &&
        ['prepared', 'uploading', 'stored', 'failed', 'unknown'].includes(
          state.status
        )
      )
        return state;
    } catch {}
    throw problem('UPLOAD_RESULT_UNKNOWN', unknownError.message, 409);
  }

  private async reserve(
    org: string,
    profile: string | undefined,
    input: PrepareMediaUploadInput
  ) {
    const { idempotencyKey, ...supplied } = input;
    const manifest: MediaTransferManifest = {
      filename: supplied.filename,
      mimeType: supplied.mimeType,
      sizeBytes: supplied.sizeBytes,
      sha256: supplied.sha256,
      adjust: supplied.adjust || supplied.mimeType === 'video/quicktime',
    };
    const scope = {
      id: `mu_${hash(JSON.stringify([org, profile || null, idempotencyKey]))}`,
      organizationId: org,
      profileId: profile || null,
    };
    const requestHash = hash(JSON.stringify(manifest));
    const record = await this.repository.reserve(scope, requestHash, {
      version: 1,
      manifest,
      status: 'prepared',
    });
    if (!record)
      throw problem('UPLOAD_RESULT_UNKNOWN', unknownError.message, 409);
    if (record.requestHash !== requestHash)
      throw problem(
        'UPLOAD_IDEMPOTENCY_CONFLICT',
        'This idempotency key belongs to different file bytes or options. Reuse the original request.',
        409
      );
    return record;
  }

  private async find(
    org: string,
    profile: string | undefined,
    uploadId: string
  ) {
    this.parse(completeMediaUploadSchema, { uploadId });
    const record = await this.repository.find({
      id: uploadId,
      organizationId: org,
      profileId: profile || null,
    });
    if (!record)
      throw problem(
        'UPLOAD_NOT_FOUND',
        'Upload not found for this organization and profile.',
        404
      );
    return record;
  }

  async prepare(
    org: string,
    profile: string | undefined,
    input: PrepareMediaUploadInput
  ): Promise<PreparedMediaTransfer> {
    const parsed = this.parse(prepareMediaUploadSchema, input);
    const backend =
      process.env.NEXT_PUBLIC_OVERRIDE_BACKEND_URL ||
      process.env.NEXT_PUBLIC_BACKEND_URL ||
      '';
    let url: URL;
    try {
      url = new URL(`${backend.replace(/\/+$/, '')}/media-transfer/`);
      const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
      if (
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        (url.protocol !== 'https:' && !(local && url.protocol === 'http:'))
      )
        throw new Error();
    } catch {
      throw problem(
        'UPLOAD_URL_NOT_CONFIGURED',
        'A public HTTPS backend URL must be configured for temporary uploads.',
        503
      );
    }
    const record = await this.reserve(org, profile, parsed);
    const status = await this.complete(org, profile, record.id);
    if (status.status !== 'awaiting_upload') return status;
    const ticket = randomBytes(32).toString('hex');
    await ioRedis.set(
      `mediaTransferTicket:${hash(ticket)}`,
      JSON.stringify({ org, profileId: profile || null, uploadId: record.id }),
      'EX',
      600
    );
    return {
      ...status,
      uploadUrl: new URL(record.id, url).toString(),
      method: 'POST',
      uploadHeaders: { 'X-Postiz-Upload-Ticket': ticket },
      expiresAt: new Date(Date.now() + 600000).toISOString(),
    };
  }

  private async claim(record: TransferRecord): Promise<ClaimedMediaTransfer> {
    const state = this.state(record);
    if (state.status !== 'prepared')
      throw problem(
        'UPLOAD_IN_PROGRESS',
        'This upload was already claimed. Check its status before retrying.',
        409
      );
    const next: TransferState = {
      ...state,
      status: 'uploading',
      startedAt: Date.now(),
    };
    const changed = await this.repository.transition(record, next);
    if (changed.count !== 1)
      throw problem(
        'UPLOAD_IN_PROGRESS',
        'Another request already claimed this upload. Check its status.',
        409
      );
    return { record: { ...record, result: JSON.stringify(next) }, state: next };
  }

  async authorizeAndClaim(
    uploadId: string,
    ticket: string | undefined
  ): Promise<ClaimedMediaTransfer | MediaTransferStatus> {
    if (
      !/^mu_[a-f0-9]{64}$/.test(uploadId) ||
      !ticket ||
      !/^[a-f0-9]{64}$/.test(ticket)
    )
      throw problem(
        'UPLOAD_TICKET_INVALID',
        'Upload ticket is missing, invalid or expired.',
        401
      );
    let data: {
      org: string;
      profileId?: string | null;
      uploadId: string;
    } | null = null;
    try {
      data = JSON.parse(
        (await ioRedis.get(`mediaTransferTicket:${hash(ticket)}`)) || 'null'
      );
    } catch {}
    if (!data || data.uploadId !== uploadId || !data.org)
      throw problem(
        'UPLOAD_TICKET_INVALID',
        'Upload ticket is missing, invalid or expired.',
        401
      );
    const record = await this.find(
      data.org,
      data.profileId || undefined,
      uploadId
    );
    if (this.state(record).status === 'stored')
      return this.complete(data.org, data.profileId || undefined, uploadId);
    return this.claim(record);
  }

  async receive(
    claimed: ClaimedMediaTransfer,
    stream: Readable,
    filename: string
  ): Promise<UploadedStream> {
    // Multipart filename parameters are decoded as Latin-1 by Busboy, while
    // FormData/curl commonly send UTF-8. Accept that exact round-trip only;
    // decoding arbitrary Unicode as Latin-1 could otherwise truncate characters.
    const utf8Filename = Buffer.from(filename, 'latin1').toString('utf8');
    const matchesMultipartUtf8 =
      utf8Filename === claimed.state.manifest.filename &&
      Buffer.from(utf8Filename, 'utf8').toString('latin1') === filename;
    if (filename !== claimed.state.manifest.filename && !matchesMultipartUtf8)
      throw new BadRequestException(
        'Filename does not match the upload manifest.'
      );
    const { mimeType, sizeBytes, sha256 } = claimed.state.manifest;
    return uploadStreamToStorage(
      this.storage,
      Readable.toWeb(stream) as any,
      sizeBytes,
      { mimeType, sizeBytes, sha256 }
    );
  }

  async fail(claimed: ClaimedMediaTransfer, definite: boolean) {
    await this.repository.transition(claimed.record, {
      ...claimed.state,
      status: definite ? 'failed' : 'unknown',
      errorCode: definite
        ? 'UPLOAD_INTEGRITY_MISMATCH'
        : 'UPLOAD_RESULT_UNKNOWN',
    });
    return this.complete(
      claimed.record.organizationId,
      claimed.record.profileId || undefined,
      claimed.record.id
    );
  }

  async discard(file: UploadedStream) {
    // Only a path returned by our storage adapter, never a client path.
    await this.storage.removeFile(file.path);
  }

  async finalize(
    claimed: ClaimedMediaTransfer,
    file: UploadedStream
  ): Promise<MediaTransferStatus> {
    const { record, state } = claimed;
    try {
      await this.media.validateUploadedMedia(
        file.originalname,
        file.path,
        state.manifest.mimeType
      );
    } catch (error) {
      if (error instanceof BadRequestException) {
        try {
          await this.discard(file);
        } catch {
          return this.fail(claimed, false);
        }
        return this.fail(claimed, true);
      }
      return this.fail(claimed, false);
    }
    try {
      await this.repository.save(record, state, {
        id: randomUUID(),
        name: file.originalname,
        path: file.path,
        sizeBytes: state.manifest.sizeBytes,
        mimeType: state.manifest.mimeType,
      });
    } catch {
      // A transaction acknowledgement can be lost after commit. Never remove
      // the file or create another row; the durable receipt resolves that case.
      return this.fail(claimed, false);
    }
    return this.complete(
      record.organizationId,
      record.profileId || undefined,
      record.id
    );
  }

  async upload(
    org: string,
    profile: string | undefined,
    input: UploadMediaInput
  ): Promise<MediaTransferStatus> {
    const parsed = this.parse(uploadMediaSchema, input);
    const bytes = Buffer.from(parsed.base64, 'base64');
    if (!bytes.length)
      throw problem('INVALID_UPLOAD_INPUT', 'The file must not be empty.', 400);
    const { base64, ...options } = parsed;
    const manifest = this.parse(prepareMediaUploadSchema, {
      ...options,
      sizeBytes: bytes.length,
      sha256: hash(bytes),
    });
    const record = await this.reserve(org, profile, manifest);
    if (this.state(record).status !== 'prepared')
      return this.complete(org, profile, record.id);
    const claimed = await this.claim(record);
    let file: UploadedStream;
    try {
      file = await this.receive(
        claimed,
        Readable.from(bytes),
        manifest.filename
      );
    } catch (error) {
      return this.fail(claimed, error instanceof BadRequestException);
    }
    return this.finalize(claimed, file);
  }

  async complete(
    org: string,
    profile: string | undefined,
    uploadId: string
  ): Promise<MediaTransferStatus> {
    const record = await this.find(org, profile, uploadId);
    const state = this.state(record);
    if (state.status === 'stored' && state.mediaId) {
      let media = await this.media.getMediaUploadStatus(
        org,
        state.mediaId,
        profile
      );
      if (media.status === 'processing') {
        try {
          await this.media.ensureUploadedMediaProcessing(
            org,
            state.mediaId,
            profile
          );
          media = await this.media.getMediaUploadStatus(
            org,
            state.mediaId,
            profile
          );
        } catch {
          return {
            uploadId,
            id: media.id,
            path: media.path,
            originalPath: media.originalPath || media.path,
            status: 'unknown',
            progress: null,
            error: unknownError,
          };
        }
      }
      const status = ['ready', 'processing', 'failed'].includes(media.status)
        ? (media.status as 'ready' | 'processing' | 'failed')
        : 'unknown';
      return {
        uploadId,
        status,
        progress: status === 'ready' ? 100 : null,
        id: media.id,
        path: media.path,
        originalPath: media.originalPath || media.path,
        ...(status === 'failed'
          ? {
              error: {
                code: 'UPLOAD_FAILED',
                message:
                  'Media preparation failed. The original file was preserved.',
              },
            }
          : {}),
        ...(status === 'unknown' ? { error: unknownError } : {}),
      };
    }
    if (state.status === 'prepared')
      return { uploadId, status: 'awaiting_upload', progress: 0 };
    if (
      state.status === 'uploading' &&
      state.startedAt &&
      Date.now() - state.startedAt < 2 * 60 * 60 * 1000
    )
      return { uploadId, status: 'uploading', progress: null };
    if (state.status === 'failed')
      return {
        uploadId,
        status: 'failed',
        progress: null,
        error: {
          code: state.errorCode || 'UPLOAD_FAILED',
          message:
            'The file is unreadable or does not match its filename, supported MIME type, size or SHA-256 manifest.',
        },
      };
    return { uploadId, status: 'unknown', progress: null, error: unknownError };
  }
}
