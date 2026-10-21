jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/posts/posts.service',
  () => ({ PostsService: class {} })
);
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service',
  () => ({ IntegrationService: class {} })
);
import { IntegrationSchedulePostTool } from '../integration.schedule.post';
describe('MCP attachments after upstream merge', () => {
  it('preserves object media, string media, parsed settings and authenticated profile', async () => {
    const posts = {
      validatePosts: jest
        .fn()
        .mockResolvedValue([{ valid: true, errors: true }]),
      createPost: jest
        .fn()
        .mockResolvedValue([{ postId: 'post-1', integration: 'youtube' }]),
    };
    const channels = {
      getIntegrationById: jest
        .fn()
        .mockResolvedValue({
          id: 'channel-1',
          profileId: 'profile-1',
          providerIdentifier: 'youtube',
        }),
    };
    const tool = new IntegrationSchedulePostTool(
      posts as any,
      channels as any
    ).run() as any;
    const objectMedia = {
      path: 'https://example.com/video.mp4',
      alt: 'Description',
      thumbnail: 'https://example.com/cover.jpg',
      thumbnailTimestamp: 1200,
    };
    const input = {
      socialPost: [
        {
          integrationId: 'channel-1',
          isPremium: false,
          date: '2026-10-20T20:00:00Z',
          shortLink: false,
          type: 'draft',
          postsAndComments: [
            {
              content: '<p>Test</p>',
              attachments: ['https://example.com/image.jpg', objectMedia],
            },
          ],
          settings: [
            { key: 'made_for_kids', value: 'false' },
            { key: 'tags', value: '["test"]' },
          ],
        },
      ],
    };
    expect(tool.inputSchema.safeParse(input).success).toBe(true);
    await tool.execute(input, {
      requestContext: {
        get: (key: string) =>
          key === 'organization'
            ? JSON.stringify({ id: 'org-1' })
            : 'profile-1',
      },
    });
    expect(posts.createPost).toHaveBeenCalledWith(
      'org-1',
      expect.anything(),
      'MCP',
      false,
      'profile-1'
    );
    const saved = posts.createPost.mock.calls[0][1] as any;
    expect(saved.posts[0].settings.made_for_kids).toBe(false);
    expect(saved.posts[0].settings.tags).toEqual(['test']);
    expect(saved.posts[0].value[0].image).toEqual([
      expect.objectContaining({ path: 'https://example.com/image.jpg' }),
      expect.objectContaining(objectMedia),
    ]);
  });
});
