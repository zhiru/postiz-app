jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/media/media.transfer.service',
  () => ({ MediaTransferService: class {} })
);
import { BadRequestException, HttpException } from '@nestjs/common';
import { createMock } from '@gitroom/nestjs-libraries/test';
import { MediaTransferService } from '@gitroom/nestjs-libraries/database/prisma/media/media.transfer.service';
import { runWithContext } from '../async.storage';
import {
  UploadMediaTool,
  PrepareMediaUploadTool,
  CompleteMediaUploadTool,
} from './media.transfer.tools';

const trustedContext = (profile = 'profile-trusted') => ({
  requestContext: new Map([
    ['organization', JSON.stringify({ id: 'org-trusted' })],
    ['profileId', profile],
  ]),
});
const uploadId = 'mu_' + 'a'.repeat(64);
const uploadInput = {
  filename: 'photo.png',
  mimeType: 'image/png',
  base64: 'aW1hZ2U=',
  idempotencyKey: 'upload-request-1',
};
const prepareInput = {
  filename: 'private.mov',
  mimeType: 'video/quicktime',
  sizeBytes: 12345,
  sha256: 'a'.repeat(64),
  idempotencyKey: 'upload-request-2',
};

describe('MCP media transfer contracts', () => {
  const service = createMock<MediaTransferService>();
  beforeEach(() => jest.clearAllMocks());

  it.each([
    [UploadMediaTool, 'uploadMediaTool', 'upload', uploadInput],
    [PrepareMediaUploadTool, 'prepareMediaUpload', 'prepare', prepareInput],
    [
      CompleteMediaUploadTool,
      'completeMediaUpload',
      'complete',
      { uploadId: uploadId },
    ],
  ] as const)(
    '%s exposes the exact public name %s and authenticated scope',
    async (Ctor, name, method, input) => {
      const result = {
        uploadId: uploadId,
        status: 'processing' as const,
        progress: null as number | null,
      };
      service[method].mockResolvedValue(result);
      const instance = new Ctor(service);
      const tool = instance.run() as any;
      expect(instance.name).toBe(name);
      expect(instance.mcpOnly).toBe(true);
      expect(tool.id).toBe(name);
      const parsed = tool.inputSchema.parse(input);
      const expectedInput =
        'uploadId' in input ? input.uploadId : { ...input, adjust: false };
      expect(await tool.execute(parsed, trustedContext())).toEqual(result);
      expect(service[method]).toHaveBeenCalledWith(
        'org-trusted',
        'profile-trusted',
        expectedInput
      );
      expect(tool.mcp.annotations).toMatchObject({
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      });
      expect(tool.outputSchema.safeParse(result).success).toBe(true);
    }
  );

  it('preserves explicit adjustment and idempotency keys across retries', async () => {
    service.upload.mockResolvedValue({
      uploadId: uploadId,
      status: 'ready',
      progress: 100,
      id: 'media-1',
      path: '/uploads/photo.png',
    });
    const tool = new UploadMediaTool(service).run() as any;
    const input = tool.inputSchema.parse({ ...uploadInput, adjust: true });
    await tool.execute(input, trustedContext());
    await tool.execute(input, trustedContext());
    expect(service.upload).toHaveBeenNthCalledWith(
      1,
      'org-trusted',
      'profile-trusted',
      input
    );
    expect(service.upload).toHaveBeenNthCalledWith(
      2,
      'org-trusted',
      'profile-trusted',
      input
    );
  });

  it.each([
    [UploadMediaTool, uploadInput],
    [PrepareMediaUploadTool, prepareInput],
    [CompleteMediaUploadTool, { uploadId: uploadId }],
  ] as const)(
    '%s rejects forged organization/profile and unrecognized inputs',
    (Ctor, input) => {
      const tool = new Ctor(service).run() as any;
      for (const extra of [
        { organizationId: 'other-org' },
        { profileId: 'other-profile' },
        { filePath: '/etc/passwd' },
      ]) {
        expect(tool.inputSchema.safeParse({ ...input, ...extra }).success).toBe(
          false
        );
      }
    }
  );

  it('uses async-local MCP authentication when no runtime context is supplied', async () => {
    service.complete.mockResolvedValue({
      uploadId: uploadId,
      status: 'awaiting_upload',
      progress: 0,
    });
    const tool = new CompleteMediaUploadTool(service).run() as any;
    await runWithContext(
      {
        requestId: 'request-1',
        auth: { id: 'org-als' },
        profileId: 'profile-als',
      },
      () => tool.execute({ uploadId: uploadId }, undefined)
    );
    expect(service.complete).toHaveBeenCalledWith(
      'org-als',
      'profile-als',
      uploadId
    );
  });

  it('keeps the active profile isolated between requests', async () => {
    service.complete.mockResolvedValue({
      uploadId: uploadId,
      status: 'processing',
      progress: null,
    });
    const tool = new CompleteMediaUploadTool(service).run() as any;
    await tool.execute({ uploadId: uploadId }, trustedContext('profile-a'));
    await tool.execute({ uploadId: uploadId }, trustedContext('profile-b'));
    expect(service.complete.mock.calls).toEqual([
      ['org-trusted', 'profile-a', uploadId],
      ['org-trusted', 'profile-b', uploadId],
    ]);
  });

  it.each([
    undefined,
    { requestContext: new Map() },
    { requestContext: new Map([['organization', 'not-json']]) },
  ])('fails closed without organization context', async (context) => {
    const tool = new CompleteMediaUploadTool(service).run() as any;
    expect(await tool.execute({ uploadId: uploadId }, context)).toMatchObject({
      error: { code: 'AUTH_CONTEXT_REQUIRED' },
    });
    expect(service.complete).not.toHaveBeenCalled();
  });

  it('returns all upload instructions and accurately preserves non-ready states', async () => {
    const tool = new PrepareMediaUploadTool(service).run() as any;
    const result = {
      uploadId: uploadId,
      status: 'awaiting_upload' as const,
      progress: 0,
      uploadUrl: 'https://postiz.example/media-transfer/upload',
      method: 'POST' as const,
      uploadHeaders: { 'X-Postiz-Upload-Ticket': 'short-lived-upload-ticket' },
      expiresAt: '2027-01-01T00:10:00.000Z',
    };
    service.prepare.mockResolvedValue(result);
    expect(
      await tool.execute(tool.inputSchema.parse(prepareInput), trustedContext())
    ).toEqual(result);
    expect(tool.outputSchema.safeParse(result).success).toBe(true);
    const complete = new CompleteMediaUploadTool(service).run() as any;
    for (const status of [
      'awaiting_upload',
      'uploading',
      'processing',
      'unknown',
      'failed',
    ] as const) {
      service.complete.mockResolvedValue({
        uploadId: uploadId,
        status,
        progress: null,
      });
      expect(
        (await complete.execute({ uploadId: uploadId }, trustedContext()))
          .status
      ).toBe(status);
    }
  });

  it('never echoes storage errors or secret-bearing HttpException payloads', async () => {
    const tool = new CompleteMediaUploadTool(service).run() as any;
    for (const error of [
      new Error('SECRET_TOKEN https://storage.example/?token=secret'),
      new BadRequestException({
        code: 'UPLOAD_INTEGRITY_MISMATCH',
        message: 'SECRET_TOKEN',
        uploadHeaders: { key: 'SECRET_TOKEN' },
      }),
      new HttpException(
        { code: 'INTERNAL_STORAGE_ERROR', message: 'SECRET_TOKEN' },
        502
      ),
    ]) {
      service.complete.mockRejectedValue(error);
      const result = await tool.execute(
        { uploadId: uploadId },
        trustedContext()
      );
      expect(JSON.stringify(result)).not.toContain('SECRET_TOKEN');
      expect(JSON.stringify(result)).not.toContain('storage.example');
      expect(tool.outputSchema.safeParse(result).success).toBe(true);
      expect(result.error.code).toBe(
        error instanceof BadRequestException
          ? 'UPLOAD_INTEGRITY_MISMATCH'
          : 'UPLOAD_OPERATION_FAILED'
      );
    }
  });

  it('rejects malformed or incomplete transfer parameters before a service call', () => {
    const upload = new UploadMediaTool(service).run() as any;
    expect(
      upload.inputSchema.safeParse({ ...uploadInput, mimeType: '' }).success
    ).toBe(false);
    expect(
      upload.inputSchema.safeParse({ ...uploadInput, idempotencyKey: '' })
        .success
    ).toBe(false);
    expect(
      upload.inputSchema.safeParse({
        ...uploadInput,
        base64: 'a'.repeat(6 * 1024 * 1024 + 1),
      }).success
    ).toBe(false);
    const prepare = new PrepareMediaUploadTool(service).run() as any;
    expect(
      prepare.inputSchema.safeParse({ ...prepareInput, sizeBytes: 0 }).success
    ).toBe(false);
    expect(
      prepare.inputSchema.safeParse({ ...prepareInput, sha256: 'bad-hash' })
        .success
    ).toBe(false);
    expect(
      prepare.inputSchema.safeParse({ ...prepareInput, sha256: undefined })
        .success
    ).toBe(false);
  });
});
