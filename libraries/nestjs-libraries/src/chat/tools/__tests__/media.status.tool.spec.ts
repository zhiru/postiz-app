jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/media/media.service',
  () => ({ MediaService: class {} })
);
import { MediaStatusTool } from '../media.status.tool';
import { HttpException } from '@nestjs/common';
const ctx = (org?: string, profileId?: string) => ({
  requestContext: {
    get: (key: string) =>
      key === 'organization'
        ? JSON.stringify(org ? { id: org } : null)
        : profileId,
  },
});
describe('MediaStatusTool', () => {
  const service = { getMediaUploadStatus: jest.fn() };
  beforeEach(() => jest.clearAllMocks());
  it('uses organization and profile when polling adjusted media', async () => {
    service.getMediaUploadStatus.mockResolvedValue({
      id: 'media-1',
      path: 'https://example.com/video.mp4',
      status: 'ready',
    });
    const tool = new MediaStatusTool(service as any).run() as any;
    const result = await tool.execute(
      { id: 'media-1' },
      ctx('org-1', 'profile-1')
    );
    expect(service.getMediaUploadStatus).toHaveBeenCalledWith(
      'org-1',
      'media-1',
      'profile-1'
    );
    expect(tool.outputSchema.safeParse(result).success).toBe(true);
  });
  it('requires organization context', async () => {
    const result = await (
      new MediaStatusTool(service as any).run() as any
    ).execute({ id: 'media-1' }, ctx());
    expect(result.error).toBeDefined();
    expect(service.getMediaUploadStatus).not.toHaveBeenCalled();
  });
  it.each([
    new HttpException('Media not found', 404),
    new Error('secret credentials'),
  ])('does not expose private errors', async (err) => {
    service.getMediaUploadStatus.mockRejectedValue(err);
    const result = await (
      new MediaStatusTool(service as any).run() as any
    ).execute({ id: 'media-1' }, ctx('org-1', 'profile-1'));
    expect(result.error).toBeDefined();
    expect(JSON.stringify(result)).not.toContain('secret');
  });
});
