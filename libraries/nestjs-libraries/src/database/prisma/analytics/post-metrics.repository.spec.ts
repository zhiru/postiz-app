import { PostMetricsRepository } from './post-metrics.repository';
const make = () => {
  const snapshots = {
    findFirst: jest.fn().mockResolvedValue(null),
    findMany: jest.fn().mockResolvedValue([]),
    upsert: jest.fn(),
    updateMany: jest.fn(),
  };
  const posts = { findMany: jest.fn(), findFirst: jest.fn() };
  const service = new PostMetricsRepository(
    { model: { postMetricSnapshot: snapshots } } as any,
    { model: { post: posts } } as any,
    {} as any
  );
  return { service, snapshots, posts };
};
describe('PostMetricsRepository', () => {
  it('enforces both post and channel ownership/profile, excludes deleted/recurring templates and caps report work', async () => {
    const { service, posts } = make();
    await service.list(
      'o',
      { from: new Date(), to: new Date(), platform: 'instagram' },
      'p'
    );
    expect(posts.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organizationId: 'o',
          profileId: 'p',
          deletedAt: null,
          state: 'PUBLISHED',
          integration: {
            organizationId: 'o',
            profileId: 'p',
            deletedAt: null,
            providerIdentifier: 'instagram',
          },
        }),
        take: 5001,
      })
    );
    const select = posts.findMany.mock.calls[0][0].select;
    expect(select.integration.select.token).toBeUndefined();
    expect(select.metricSnapshots.where).toEqual({
      organizationId: 'o',
      profileId: 'p',
      status: 'available',
    });
  });
  it('rejects a history cursor belonging to another profile/post', async () => {
    const { service, snapshots } = make();
    await expect(
      service.history('o', 'i', 'r', 'p', 'foreign')
    ).rejects.toThrow('Invalid history cursor');
    expect(snapshots.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'foreign',
          organizationId: 'o',
          integrationId: 'i',
          remoteId: 'r',
          profileId: 'p',
        },
      })
    );
    expect(snapshots.findMany).not.toHaveBeenCalled();
  });
  it('links pending observations only within the stored scope and preserves unknown fields during partial observations', async () => {
    const { service, snapshots } = make();
    snapshots.findFirst.mockResolvedValue({
      metrics: {
        views: 30,
        reactions: 4,
        __observedAt: { views: 'old', reactions: 'old' },
        __sources: { views: 'provider', reactions: 'provider' },
      },
    });
    await service.record({
      organizationId: 'o',
      profileId: 'p',
      integrationId: 'i',
      remoteId: 'r',
      postId: 'post',
      source: 'instagram_story_webhook',
      status: 'available',
      metrics: { views: null, replies: 2 },
    });
    expect(snapshots.updateMany).toHaveBeenCalledWith({
      where: {
        organizationId: 'o',
        profileId: 'p',
        integrationId: 'i',
        remoteId: 'r',
        postId: null,
      },
      data: { postId: 'post' },
    });
    const write = snapshots.upsert.mock.calls[0][0];
    expect(write.create.metrics).toMatchObject({
      views: 30,
      reactions: 4,
      replies: 2,
      __observedAt: { views: 'old' },
      __sources: { replies: 'instagram_story_webhook' },
    });
    expect(
      write.where.scopeKey_integrationId_remoteId_capturedHour_source_status
        .scopeKey
    ).toBe('["o","p"]');
  });
  it('rotates recent collection by id instead of repeatedly taking the oldest forty', async () => {
    const { service, posts } = make();
    await service.recentToCollect(['instagram'], 'cursor');
    expect(posts.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: { gt: 'cursor' } }),
        orderBy: { id: 'asc' },
        take: 40,
      })
    );
  });
});
