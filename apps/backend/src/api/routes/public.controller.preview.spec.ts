jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/posts/posts.service',
  () => ({ PostsService: class {} })
);
jest.mock('@gitroom/nestjs-libraries/track/track.service', () => ({
  TrackService: class {},
}));
jest.mock('@gitroom/nestjs-libraries/agent/agent.graph.insert.service', () => ({
  AgentGraphInsertService: class {},
}));
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service',
  () => ({ SubscriptionService: class {} })
);
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/review-links/review-links.service',
  () => ({ ReviewLinksService: class {} })
);

import { PublicController } from './public.controller';

describe('Public post preview privacy', () => {
  it('preserves token-based review permissions without exposing link internals', async () => {
    const reviews = {
      resolveToken: jest.fn().mockResolvedValue({
        allowComment: true,
        allowApprove: false,
        expiresAt: '2026-12-01T00:00:00Z',
        tokenHash: 'private-hash',
        organizationId: 'private-org',
      }),
    };
    const controller = new PublicController(
      null as any,
      null as any,
      null as any,
      null as any,
      reviews as any
    );
    expect(await controller.getReviewLinkInfo('post', 'review-token')).toEqual({
      valid: true,
      allowComment: true,
      allowApprove: false,
      expiresAt: '2026-12-01T00:00:00Z',
    });
    expect(reviews.resolveToken).toHaveBeenCalledWith('post', 'review-token');
    reviews.resolveToken.mockResolvedValue(null);
    expect(await controller.getReviewLinkInfo('post', 'invalid')).toEqual({
      valid: false,
    });
  });

  it('omits persisted recipients from every post and keeps integration credentials private', async () => {
    const settings = JSON.stringify({ targets: ['contact:1', 'group:2'] });
    const posts = {
      getPostsRecursively: jest.fn().mockResolvedValue([
        {
          id: 'post',
          content: 'hello',
          settings,
          batchId: 'batch',
          childrenPost: [{ settings }],
          integration: {
            id: 'channel',
            name: 'Inbox',
            providerIdentifier: 'neuraltalk',
            profile: 'Inbox',
            picture: 'image',
            token: 'secret',
            customInstanceDetails: 'secret',
          },
        },
        { id: 'child', content: 'reply', settings, childrenPost: [] },
      ]),
    };
    const controller = new PublicController(
      null as any,
      null as any,
      posts as any,
      null as any,
      null as any
    );
    const result = await controller.getPreview('post');
    expect(result).toEqual([
      {
        id: 'post',
        content: 'hello',
        integration: {
          id: 'channel',
          name: 'Inbox',
          providerIdentifier: 'neuraltalk',
          profile: 'Inbox',
          picture: 'image',
        },
      },
      { id: 'child', content: 'reply' },
    ]);
    expect(JSON.stringify(result)).not.toMatch(/contact:1|group:2|secret/);
  });
});
