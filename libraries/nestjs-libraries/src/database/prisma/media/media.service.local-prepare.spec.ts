jest.mock('@gitroom/nestjs-libraries/ai/ai-image.service', () => ({
  AiImageService: class {},
}));
jest.mock('@gitroom/nestjs-libraries/ai/ai-text.service', () => ({
  AiTextService: class {},
}));
jest.mock('@gitroom/nestjs-libraries/ai/ai-video.service', () => ({
  AiVideoService: class {},
}));
jest.mock('@gitroom/nestjs-libraries/upload/custom.upload.validation', () => ({
  getMaxSize: jest.fn(),
  uploadStreamToStorage: jest.fn(),
}));
jest.mock('@gitroom/nestjs-libraries/redis/redis.service', () => ({
  ioRedis: {
    get: jest.fn(),
    set: jest.fn(),
    rpush: jest.fn(),
    expire: jest.fn(),
    lrange: jest.fn(),
  },
}));
// MediaService importa SubscriptionService que cascateia ate nostr-tools
// (ESM-only que quebra ts-jest). Mockamos topo-de-modulo as cadeias pesadas.
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service',
  () => ({ SubscriptionService: class SubscriptionServiceMock {} })
);
jest.mock('@gitroom/nestjs-libraries/videos/video.manager', () => ({
  VideoManager: class VideoManagerMock {},
}));
jest.mock(
  '@gitroom/backend/services/auth/permissions/permission.exception.class',
  () => ({
    AuthorizationActions: {
      Create: 'Create',
      Delete: 'Delete',
      Update: 'Update',
    },
    Sections: { ADMIN: 'ADMIN', VIDEOS_PER_MONTH: 'VIDEOS_PER_MONTH' },
    SubscriptionException: class SubscriptionExceptionMock extends Error {
      constructor(public meta: any) {
        super('SubscriptionException');
      }
    },
  })
);

import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { promisify } from 'util';
import { execFile } from 'child_process';
import { createHash } from 'crypto';
import sharp from 'sharp';
const mockStorage: any = {
  localFilePath: jest.fn(),
  uploadStream: jest.fn(),
  removeFile: jest.fn(),
};
jest.mock('@gitroom/nestjs-libraries/upload/upload.factory', () => ({
  UploadFactory: {
    createStorage: () => mockStorage,
    createProcessor: () => null,
  },
}));
import { MediaService } from './media.service';
import { MediaRepository } from './media.repository';
import { createMock } from '@gitroom/nestjs-libraries/test';
const setup = () => {
  const repo = createMock<MediaRepository>();
  const temporal: any = {
    client: { getRawClient: () => ({ workflow: { start: jest.fn() } }) },
  };
  return {
    repo,
    service: new MediaService(
      repo,
      null,
      null,
      null,
      null,
      null,
      null,
      temporal
    ),
  };
};
describe('local MOV preparation', () => {
  it('decodes image bytes before accepting a media upload', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'postiz-test-inspect-'));
    try {
      const source = join(folder, 'image.png');
      const { service } = setup();
      mockStorage.localFilePath.mockReturnValue(source);
      await writeFile(
        source,
        Buffer.from(
          '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489',
          'hex'
        )
      );
      await expect(
        service.validateUploadedMedia('image.png', 'stored-path', 'image/png')
      ).rejects.toThrow(/decoded/);
      await sharp({
        create: { width: 8, height: 8, channels: 3, background: '#fff' },
      })
        .png()
        .toFile(source);
      await expect(
        service.validateUploadedMedia('image.png', 'stored-path', 'image/png')
      ).resolves.toBeUndefined();
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  });
  it('reconciles a committed upload once using a stable non-reusable workflow id', async () => {
    const { repo, service } = setup();
    repo.getMediaStatus.mockResolvedValue({
      id: 'm1',
      name: 'original.mov',
      path: 'stored-path',
      status: 'processing',
    } as any);
    const missing = Object.assign(new Error('missing'), {
      name: 'WorkflowNotFoundError',
    });
    const describe = jest
      .fn()
      .mockRejectedValueOnce(missing)
      .mockResolvedValue({ status: { name: 'RUNNING' } });
    const start = jest.fn();
    (service as any)._temporalService = {
      client: {
        getRawClient: () => ({
          workflow: { getHandle: () => ({ describe }), start },
        }),
      },
    };
    await service.ensureUploadedMediaProcessing('o1', 'm1', 'p1');
    await service.ensureUploadedMediaProcessing('o1', 'm1', 'p1');
    expect(start).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledWith(
      'prepareLocalMediaWorkflowV1',
      expect.objectContaining({
        workflowId: 'media_local_m1',
        workflowIdReusePolicy: 'REJECT_DUPLICATE',
        args: [{ mediaId: 'm1' }],
      })
    );
    expect(repo.startProcessing).not.toHaveBeenCalled();
  });
  it('does not restart a finished workflow or regress a concurrently ready media', async () => {
    const { repo, service } = setup();
    repo.getMediaStatus.mockResolvedValue({
      id: 'm1',
      name: 'original.mov',
      path: 'stored-path',
      status: 'processing',
    } as any);
    const start = jest
      .fn()
      .mockRejectedValue(
        Object.assign(new Error('already exists'), {
          name: 'WorkflowExecutionAlreadyStartedError',
        })
      );
    const describe = jest
      .fn()
      .mockResolvedValueOnce({ status: { name: 'COMPLETED' } })
      .mockRejectedValue(
        Object.assign(new Error('missing'), { name: 'WorkflowNotFoundError' })
      );
    (service as any)._temporalService = {
      client: {
        getRawClient: () => ({
          workflow: { getHandle: () => ({ describe }), start },
        }),
      },
    };
    await expect(
      service.ensureUploadedMediaProcessing('o1', 'm1', 'p1')
    ).rejects.toThrow(/reconciliation/);
    expect(start).not.toHaveBeenCalled();
    await expect(
      service.ensureUploadedMediaProcessing('o1', 'm1', 'p1')
    ).resolves.toBeUndefined();
    expect(repo.startProcessing).not.toHaveBeenCalled();
  });
  it('produces H264 MP4 and keeps the original bytes', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'postiz-test-mov-'));
    try {
      const source = join(folder, 'original.mov');
      const prepared = join(folder, 'prepared.mp4');
      await promisify(execFile)('ffmpeg', [
        '-nostdin',
        '-v',
        'error',
        '-f',
        'lavfi',
        '-i',
        'color=c=blue:s=320x480:d=0.3',
        '-c:v',
        'mpeg4',
        source,
      ]);
      const original = await readFile(source);
      const { repo, service } = setup();
      repo.getMediaById.mockResolvedValue({
        id: 'm1',
        name: 'original.mov',
        path: 'https://example.test/uploads/original.mov',
        organizationId: 'o1',
        status: 'processing',
        originalPath: 'https://example.test/uploads/original.mov',
      } as any);
      mockStorage.localFilePath.mockReturnValue(source);
      mockStorage.uploadStream.mockImplementation(async (stream: any) => {
        const chunks = [];
        for await (const c of stream) chunks.push(c);
        await writeFile(prepared, Buffer.concat(chunks));
        return {
          originalname: 'prepared.mp4',
          path: 'https://example.test/uploads/prepared.mp4',
        };
      });
      await service.prepareLocalMedia('m1');
      const { stdout } = await promisify(execFile)('ffprobe', [
        '-v',
        'error',
        '-show_entries',
        'stream=codec_name,pix_fmt:format=format_name',
        '-of',
        'json',
        prepared,
      ]);
      expect(JSON.parse(stdout).streams[0]).toMatchObject({
        codec_name: 'h264',
        pix_fmt: 'yuv420p',
      });
      expect(
        createHash('sha256')
          .update(await readFile(source))
          .digest('hex')
      ).toBe(createHash('sha256').update(original).digest('hex'));
      expect(repo.finishProcessing).toHaveBeenCalledWith(
        'o1',
        'm1',
        expect.objectContaining({
          name: 'prepared.mp4',
          path: 'https://example.test/uploads/prepared.mp4',
        })
      );
      expect(mockStorage.removeFile).not.toHaveBeenCalled();
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  }, 30000);
  it('rejects filesystem references and invalid bytes before upload', async () => {
    const { service } = setup();
    await expect(
      service.uploadFileReference('o1', {
        name: 'file.mov',
        base64: '/etc/passwd',
      })
    ).rejects.toThrow(/base64/);
  });
  it('does not release processing media for publication', async () => {
    const { repo, service } = setup();
    repo.findPostMedia.mockResolvedValue({
      id: 'm1',
      status: 'processing',
      path: 'https://example.test/a.mp4',
    } as any);
    await expect(
      service.resolvePostMedia('o1', { id: 'm1' }, 'p1')
    ).rejects.toThrow(/processing/);
    expect(repo.findPostMedia).toHaveBeenCalledWith('o1', { id: 'm1' }, 'p1');
  });
});
