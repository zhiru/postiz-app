import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  BadRequestException,
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Request, Response } from 'express';
import multer from 'multer';
import { Observable, of } from 'rxjs';
import { MediaTransferService } from '@gitroom/nestjs-libraries/database/prisma/media/media.transfer.service';
import { MediaTransferStatus } from '@gitroom/nestjs-libraries/dtos/media/media.transfer.dto';
import { UploadedStream } from './upload.interface';

export type MediaTransferRequest = Request & {
  mediaTransferResult?: MediaTransferStatus;
};

@Injectable()
export class MediaTransferInterceptor implements NestInterceptor {
  constructor(private transfers: MediaTransferService) {}

  async intercept(
    context: ExecutionContext,
    next: CallHandler
  ): Promise<Observable<unknown>> {
    const request = context.switchToHttp().getRequest<MediaTransferRequest>();
    const response = context.switchToHttp().getResponse<Response>();
    // Claim before parsing or streaming any file. A bearer ticket grants only
    // this manifest, never the organization's API or filesystem access.
    const ticket = request.header('X-Postiz-Upload-Ticket');
    // Do not retain the upload credential on the request seen by error/log hooks.
    delete request.headers['x-postiz-upload-ticket'];
    for (let i = 0; i < (request.rawHeaders?.length || 0); i += 2) {
      if (request.rawHeaders[i].toLowerCase() === 'x-postiz-upload-ticket')
        request.rawHeaders[i + 1] = '[redacted]';
    }
    const claimed = await this.transfers.authorizeAndClaim(
      request.params.uploadId as string,
      ticket
    );
    if (!('record' in claimed)) return of(claimed);
    let uploaded: UploadedStream | undefined;
    const parser = multer({
      // Busboy emits partsLimit when it reaches the configured boundary count.
      // Allow the closing boundary; files/fields still enforce exactly one file.
      limits: {
        files: 1,
        fields: 0,
        parts: 2,
        fileSize: claimed.state.manifest.sizeBytes + 1,
      },
      storage: {
        _handleFile: (_request, file, callback) => {
          this.transfers.receive(claimed, file.stream, file.originalname).then(
            (stored) => {
              uploaded = stored;
              callback(null, {
                filename: stored.filename,
                path: stored.path,
                mimetype: stored.mimetype,
              });
            },
            (error) => callback(error)
          );
        },
        // The catch below owns cleanup, before any media row is committed.
        _removeFile: (_request, _file, callback) => callback(null),
      },
    }).single('file');
    try {
      await new Promise<void>((resolve, reject) =>
        parser(request, response, (error) =>
          error ? reject(error) : resolve()
        )
      );
      if (!uploaded)
        throw new BadRequestException('A multipart file is required.');
    } catch (error) {
      let definite =
        error instanceof BadRequestException ||
        error instanceof multer.MulterError;
      if (uploaded) {
        try {
          await this.transfers.discard(uploaded);
        } catch {
          definite = false;
        }
      }
      return of(await this.transfers.fail(claimed, definite));
    }
    request.mediaTransferResult = await this.transfers.finalize(
      claimed,
      uploaded
    );
    return next.handle();
  }
}

// Handle this credential-bearing route locally: unexpected failures must not
// reach the global telemetry exception filter with upload request context.
@Catch()
export class MediaTransferExceptionFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    const body = error instanceof HttpException ? error.getResponse() : null;
    const code =
      body && typeof body === 'object' && 'code' in body
        ? String(body.code)
        : '';
    const known: Record<string, { status: number; message: string }> = {
      UPLOAD_TICKET_INVALID: {
        status: 401,
        message: 'Upload ticket is missing, invalid or expired.',
      },
      UPLOAD_IN_PROGRESS: {
        status: 409,
        message:
          'Upload already claimed. Check completeMediaUpload before retrying.',
      },
      UPLOAD_NOT_FOUND: { status: 404, message: 'Upload not found.' },
      UPLOAD_RESULT_UNKNOWN: {
        status: 409,
        message: 'Check completeMediaUpload to reconcile this upload.',
      },
    };
    const entry = known[code];
    response.status(entry?.status || 503).json({
      error: {
        code: entry ? code : 'UPLOAD_UNAVAILABLE',
        message:
          entry?.message ||
          'The upload service is temporarily unavailable. Check completeMediaUpload before retrying.',
      },
    });
  }
}
