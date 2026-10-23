jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/posts/post.management.service',
  () => ({ PostManagementService: class {} })
);
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/media/media.service',
  () => ({ MediaService: class {} })
);
import { BadRequestException } from '@nestjs/common';
import {
  GetPostTool,
  UpdatePostTool,
  ValidatePostTool,
  ChangePostStatusTool,
  ChangePostDateTool,
  BulkUpdatePostsTool,
  GetPostExecutionTool,
  UploadFileTool,
} from '../post.management.tools';
const ctx = {
  requestContext: new Map([
    ['organization', JSON.stringify({ id: 'org-trusted' })],
    ['profileId', 'profile-trusted'],
  ]),
};
const version = '2026-10-23T00:00:00.000Z';
describe('MCP post management contracts', () => {
  it.each([
    [
      GetPostTool,
      'get',
      { id: 'post', timeZone: 'America/Sao_Paulo' },
      ['post', 'America/Sao_Paulo', undefined],
      true,
    ],
    [
      GetPostExecutionTool,
      'get',
      { id: 'post' },
      ['post', undefined, undefined],
      true,
    ],
    [
      UpdatePostTool,
      'update',
      {
        id: 'post',
        version,
        content: 'Novo',
        settingsJson: '{"collaborators":[]}',
      },
      ['post', { version, content: 'Novo', settings: { collaborators: [] } }],
      false,
    ],
    [
      ValidatePostTool,
      'validate',
      { id: 'post', version },
      ['post', { version }],
      true,
    ],
    [
      ChangePostStatusTool,
      'status',
      { id: 'post', version, status: 'draft' },
      ['post', { version, status: 'draft' }],
      false,
    ],
    [
      ChangePostDateTool,
      'date',
      {
        id: 'post',
        version,
        date: '2027-01-01T13:00:00-03:00',
        timeZone: 'America/Sao_Paulo',
        action: 'update',
      },
      [
        'post',
        {
          version,
          date: '2027-01-01T13:00:00-03:00',
          timeZone: 'America/Sao_Paulo',
          action: 'update',
        },
      ],
      false,
    ],
    [
      BulkUpdatePostsTool,
      'bulk',
      { idempotencyKey: 'request-key', dryRun: true, updatesJson: '[]' },
      [{ idempotencyKey: 'request-key', dryRun: true, updates: [] }],
      false,
    ],
  ] as const)(
    '%p forwards only authenticated scope to %s',
    async (Ctor, method, input, args, readOnly) => {
      const service = { [method]: jest.fn().mockResolvedValue({ id: 'post' }) };
      const tool = new (Ctor as any)(service).run() as any;
      expect(tool.inputSchema.safeParse(input).success).toBe(true);
      expect(await tool.execute(input, ctx)).toEqual({
        output: { id: 'post' },
      });
      expect(service[method]).toHaveBeenCalledWith(
        'org-trusted',
        'profile-trusted',
        ...args
      );
      expect(tool.mcp.annotations.readOnlyHint).toBe(readOnly);
    }
  );
  it('returns field errors for invalid settings JSON and never logs/leaks internal errors', async () => {
    const service = {
      update: jest.fn().mockRejectedValue(new Error('SECRET_INTERNAL')),
    };
    const tool = new UpdatePostTool(service as any).run() as any;
    const invalid = await tool.execute(
      { id: 'post', version, settingsJson: 'invalid' },
      ctx
    );
    expect(invalid.error).toMatchObject({
      code: 'INVALID_INPUT',
      errors: [{ field: 'settingsJson', message: 'Use valid JSON.' }],
    });
    expect(service.update).not.toHaveBeenCalled();
    const failed = await tool.execute({ id: 'post', version }, ctx);
    expect(JSON.stringify(failed)).not.toContain('SECRET_INTERNAL');
    service.update.mockRejectedValue(
      new BadRequestException({
        code: 'POST_VALIDATION_FAILED',
        errors: [{ field: 'media.0' }],
      })
    );
    expect((await tool.execute({ id: 'post', version }, ctx)).error.code).toBe(
      'POST_VALIDATION_FAILED'
    );
  });
  it('uploads actual bytes through existing storage service and trusted profile', async () => {
    const service = {
      uploadFileReference: jest.fn().mockResolvedValue({
        id: 'media',
        status: 'processing',
        progress: null,
      }),
    };
    const upload = new UploadFileTool(service as any);
    expect(upload.mcpOnly).toBe(true);
    const tool = upload.run() as any;
    const fileReference = { name: 'private.mov', base64: 'Ynl0ZXM=' };
    expect(
      (await tool.execute({ fileReference, adjust: true }, ctx)).output.status
    ).toBe('processing');
    expect(service.uploadFileReference).toHaveBeenCalledWith(
      'org-trusted',
      { ...fileReference, adjust: true },
      'profile-trusted'
    );
  });
});
