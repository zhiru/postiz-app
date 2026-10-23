jest.mock('../media/media.service', () => ({ MediaService: class {} }));
jest.mock('@gitroom/nestjs-libraries/upload/upload.factory', () => ({
  UploadFactory: { createStorage: () => storage },
}));
jest.mock('@gitroom/nestjs-libraries/upload/custom.upload.validation', () => ({
  uploadStreamToStorage: jest.fn(),
}));
jest.mock('@gitroom/nestjs-libraries/redis/redis.service', () => ({
  ioRedis: { set: jest.fn(), get: jest.fn() },
}));
import { createHash } from 'crypto';
import { Readable } from 'stream';
import { MediaTransferService } from './media.transfer.service';
import { uploadStreamToStorage } from '@gitroom/nestjs-libraries/upload/custom.upload.validation';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';
import { BadRequestException } from '@nestjs/common';
const storage = { removeFile: jest.fn() };
const file = {
  filename: 'photo.png',
  mimeType: 'image/png' as const,
  adjust: false,
  idempotencyKey: 'file-key-0001',
  base64: Buffer.from('bytes').toString('base64'),
};
const manifest = {
  filename: file.filename,
  mimeType: file.mimeType,
  adjust: false,
  idempotencyKey: file.idempotencyKey,
  sizeBytes: 5,
  sha256: createHash('sha256').update('bytes').digest('hex'),
};
const setup = () => {
  const rows = new Map<string, any>();
  const repository: any = {
    reserve: jest.fn(async (scope, requestHash, state) => {
      if (!rows.has(scope.id))
        rows.set(scope.id, {
          ...scope,
          requestHash,
          result: JSON.stringify(state),
        });
      return { ...rows.get(scope.id) };
    }),
    find: jest.fn(async (scope) => {
      const row = rows.get(scope.id);
      return row &&
        row.organizationId === scope.organizationId &&
        row.profileId === scope.profileId
        ? { ...row }
        : null;
    }),
    transition: jest.fn(async (record, state) => {
      const row = rows.get(record.id);
      if (row.result !== record.result) return { count: 0 };
      rows.set(record.id, { ...row, result: JSON.stringify(state) });
      return { count: 1 };
    }),
    save: jest.fn(async (record, state, saved) => {
      rows.set(record.id, {
        ...record,
        result: JSON.stringify({
          ...state,
          status: 'stored',
          mediaId: saved.id,
        }),
      });
      return {
        id: saved.id,
        name: saved.name,
        path: saved.path,
        status: state.manifest.adjust ? 'processing' : 'ready',
      };
    }),
    failProcessing: jest.fn(),
  };
  const media: any = {
    getMediaUploadStatus: jest.fn(async (_o, id) => ({
      id,
      path: 'https://uploads.test/photo.png',
      originalPath: 'https://uploads.test/photo.png',
      status: 'ready',
      progress: 100,
    })),
    prepareSavedMedia: jest.fn(),
    validateUploadedMedia: jest.fn().mockResolvedValue(undefined),
    ensureUploadedMediaProcessing: jest.fn().mockResolvedValue(undefined),
  };
  (uploadStreamToStorage as jest.Mock).mockResolvedValue({
    filename: 'stored.png',
    path: 'https://uploads.test/photo.png',
    mimetype: 'image/png',
    originalname: 'stored.png',
  });
  return {
    rows,
    repository,
    media,
    service: new MediaTransferService(repository, media),
  };
};
beforeEach(() => {
  jest.clearAllMocks();
  process.env.NEXT_PUBLIC_BACKEND_URL = 'https://postiz.test/api';
});
it('replays an upload id and reads current processing state without storing bytes twice', async () => {
  const { service, repository } = setup();
  const first = await service.upload('o1', 'p1', file);
  const replay = await service.upload('o1', 'p1', file);
  expect(replay).toEqual(first);
  expect(repository.save).toHaveBeenCalledTimes(1);
  expect(uploadStreamToStorage).toHaveBeenCalledTimes(1);
});
it('rejects key reuse with different bytes and isolates profiles', async () => {
  const { service } = setup();
  const first = await service.upload('o1', 'p1', file);
  await expect(
    service.upload('o1', 'p1', {
      ...file,
      base64: Buffer.from('other').toString('base64'),
    })
  ).rejects.toMatchObject({ status: 409 });
  await expect(
    service.complete('o1', 'p2', first.uploadId)
  ).rejects.toMatchObject({ status: 404 });
  expect((await service.upload('o1', 'p2', file)).uploadId).not.toBe(
    first.uploadId
  );
});
it('binds temporary header tickets to the manifest and never puts them in the URL', async () => {
  const { service } = setup();
  const prepared = await service.prepare('o1', 'p1', manifest);
  expect(prepared.uploadUrl).toBe(
    'https://postiz.test/api/media-transfer/' + prepared.uploadId
  );
  expect(prepared.uploadHeaders?.['X-Postiz-Upload-Ticket']).toMatch(
    /^[a-f0-9]{64}$/
  );
  expect(prepared.uploadUrl).not.toContain(
    prepared.uploadHeaders!['X-Postiz-Upload-Ticket']
  );
  expect(ioRedis.set).toHaveBeenCalledWith(
    expect.stringMatching(/^mediaTransferTicket:/),
    expect.stringContaining(prepared.uploadId),
    'EX',
    600
  );
});
it('claims a prepared upload once across simultaneous requests', async () => {
  const { service } = setup();
  const prepared = await service.prepare('o1', 'p1', manifest);
  (ioRedis.get as jest.Mock).mockResolvedValue(
    JSON.stringify({ org: 'o1', profileId: 'p1', uploadId: prepared.uploadId })
  );
  const results = await Promise.allSettled([
    service.authorizeAndClaim(prepared.uploadId, 'a'.repeat(64)),
    service.authorizeAndClaim(prepared.uploadId, 'a'.repeat(64)),
  ]);
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
});
it('passes the complete manifest to the byte validator and records a definite integrity failure', async () => {
  const { service, repository } = setup();
  (uploadStreamToStorage as jest.Mock).mockRejectedValue(
    new BadRequestException('mismatch')
  );
  const result = await service.upload('o1', 'p1', file);
  expect(result.status).toBe('failed');
  expect(uploadStreamToStorage).toHaveBeenCalledWith(
    expect.anything(),
    expect.anything(),
    5,
    { mimeType: 'image/png', sizeBytes: 5, sha256: manifest.sha256 }
  );
  expect(repository.save).not.toHaveBeenCalled();
  expect((await service.upload('o1', 'p1', file)).status).toBe('failed');
  expect(uploadStreamToStorage).toHaveBeenCalledTimes(1);
});
it('does not repeat an upload after an ambiguous storage failure', async () => {
  const { service, repository } = setup();
  (uploadStreamToStorage as jest.Mock).mockRejectedValue(
    new Error('secret storage URL')
  );
  const result = await service.upload('o1', 'p1', file);
  expect(result).toMatchObject({
    status: 'unknown',
    error: { code: 'UPLOAD_RESULT_UNKNOWN' },
  });
  expect(JSON.stringify(result)).not.toContain('secret');
  expect((await service.upload('o1', 'p1', file)).status).toBe('unknown');
  expect(repository.save).not.toHaveBeenCalled();
  expect(uploadStreamToStorage).toHaveBeenCalledTimes(1);
});
it('rejects missing or mismatched tickets before receiving the stream', async () => {
  const { service } = setup();
  (ioRedis.get as jest.Mock).mockResolvedValue(null);
  await expect(
    service.authorizeAndClaim('mu_' + 'a'.repeat(64), 'b'.repeat(64))
  ).rejects.toMatchObject({ status: 401 });
  expect(uploadStreamToStorage).not.toHaveBeenCalled();
});
it('preserves MOV original and returns processing until preparation finishes', async () => {
  const { service, repository, media } = setup();
  media.getMediaUploadStatus.mockResolvedValue({
    id: 'media',
    path: 'https://uploads.test/original.mov',
    originalPath: 'https://uploads.test/original.mov',
    status: 'processing',
    progress: null,
  });
  const result = await service.upload('o1', 'p1', {
    ...file,
    filename: 'video.mov',
    mimeType: 'video/quicktime',
  });
  expect(result.status).toBe('processing');
  expect(repository.save.mock.calls[0][1].manifest.adjust).toBe(true);
  expect(media.ensureUploadedMediaProcessing).toHaveBeenCalledTimes(1);
  expect(storage.removeFile).not.toHaveBeenCalled();
});

it.each(['vídeo-á.png', Buffer.from('vídeo-á.png', 'utf8').toString('latin1')])(
  'accepts the prepared Unicode filename from multipart: %s',
  async (filename) => {
    const { service } = setup();
    const claimed = {
      state: { manifest: { ...manifest, filename: 'vídeo-á.png' } },
    } as any;
    await service.receive(
      claimed,
      Readable.from(Buffer.from('bytes')),
      filename
    );
    expect(uploadStreamToStorage).toHaveBeenCalledTimes(1);
  }
);
it.each(['different.png', '../vídeo-á.png', '/tmp/vídeo-á.png', 'š.png'])(
  'rejects a different/path filename without lossy Unicode matches: %s',
  async (filename) => {
    const { service } = setup();
    const claimed = {
      state: {
        manifest: {
          ...manifest,
          filename: filename === 'š.png' ? 'a.png' : 'vídeo-á.png',
        },
      },
    } as any;
    await expect(
      service.receive(claimed, Readable.from(Buffer.from('bytes')), filename)
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(uploadStreamToStorage).not.toHaveBeenCalled();
  }
);

it('rejects undecodable media before committing a publishable record', async () => {
  const { service, repository, media } = setup();
  media.validateUploadedMedia.mockRejectedValue(
    new BadRequestException('decode failed')
  );
  const result = await service.upload('o1', 'p1', file);
  expect(result.status).toBe('failed');
  expect(repository.save).not.toHaveBeenCalled();
  expect(storage.removeFile).toHaveBeenCalledWith(
    'https://uploads.test/photo.png'
  );
});
it('recovers preparation after the media transaction committed but its acknowledgement was lost', async () => {
  const { service, repository, media } = setup();
  const commit = repository.save.getMockImplementation();
  repository.save.mockImplementation(async (...args: any[]) => {
    await commit(...args);
    throw new Error('lost database acknowledgement');
  });
  media.getMediaUploadStatus.mockResolvedValue({
    id: 'media',
    path: 'https://uploads.test/original.mov',
    originalPath: 'https://uploads.test/original.mov',
    status: 'processing',
  });
  const result = await service.upload('o1', 'p1', {
    ...file,
    filename: 'video.mov',
    mimeType: 'video/quicktime',
  });
  expect(result.status).toBe('processing');
  expect(media.ensureUploadedMediaProcessing).toHaveBeenCalledTimes(1);
  expect(repository.save).toHaveBeenCalledTimes(1);
  expect(storage.removeFile).not.toHaveBeenCalled();
});
