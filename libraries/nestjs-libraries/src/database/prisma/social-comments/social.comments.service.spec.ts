jest.mock('@gitroom/nestjs-libraries/redis/redis.service', () => {
  const values = new Map<string, string>();
  return {
    ioRedis: {
      get: jest.fn(async (key) => values.get(key) || null),
      set: jest.fn(async (key, value, ...args) => {
        if (args.includes('NX') && values.has(key)) return null;
        values.set(key, value);
        return 'OK';
      }),
      del: jest.fn(async (key) => values.delete(key)),
      eval: jest.fn(
        async (_script, _count, key, token) =>
          values.get(key) === token && values.delete(key)
      ),
      flushdb: jest.fn(async () => values.clear()),
    },
  };
});
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';
jest.mock('@gitroom/nestjs-libraries/integrations/integration.manager', () => ({
  IntegrationManager: class {},
  socialIntegrationList: [{ identifier: 'instagram', listComments: jest.fn() }],
}));
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/webhooks/webhooks.service',
  () => ({ WebhooksService: class {} })
);
import { SocialCommentsService } from './social.comments.service';
import { SocialCommentsRepository } from './social.comments.repository';
import { IntegrationManager } from '@gitroom/nestjs-libraries/integrations/integration.manager';
import { createMock } from '@gitroom/nestjs-libraries/test';

describe('SocialComments - isolamento e credenciais', () => {
  it('filtra comentarios pela integracao do perfil em listagem e leitura individual', async () => {
    const findMany = jest.fn().mockResolvedValue([]),
      findFirst = jest.fn().mockResolvedValue(null),
      count = jest.fn().mockResolvedValue(0);
    const repository = new SocialCommentsRepository(
      { model: { socialComments: { findMany, findFirst, count } } } as any,
      {} as any,
      {} as any
    );
    repository.getComments('org-1', {}, 'profile-1');
    repository.countComments('org-1', {}, 'profile-1');
    repository.getComment('org-1', 'comment-2', 'profile-1');
    for (const mock of [findMany, findFirst, count])
      expect(mock.mock.calls[0][0].where).toEqual(
        expect.objectContaining({
          organizationId: 'org-1',
          integration: {
            profileId: 'profile-1',
            organizationId: 'org-1',
            deletedAt: null,
          },
        })
      );
  });
  it('nega resposta fora do perfil antes de enviar ou salvar sugestao', async () => {
    const repository = createMock<SocialCommentsRepository>();
    const manager = createMock<IntegrationManager>();
    repository.getComment.mockResolvedValue(undefined);
    const service = new SocialCommentsService(
      repository,
      manager,
      {} as any,
      {} as any
    );
    await expect(
      service.reply('org-1', 'comment-2', 'Resposta', 'human', 'profile-1')
    ).rejects.toThrow('Comment not found');
    expect(repository.getComment).toHaveBeenCalledWith(
      'org-1',
      'comment-2',
      'profile-1'
    );
    expect(repository.saveSuggestion).not.toHaveBeenCalled();
    expect(manager.getSocialIntegration).not.toHaveBeenCalled();
  });
  it('retorna somente os campos publicos da integracao', async () => {
    const repository = createMock<SocialCommentsRepository>();
    repository.getComment.mockResolvedValue({
      id: 'comment-1',
      integration: {
        id: 'channel-1',
        name: 'Canal',
        picture: null,
        providerIdentifier: 'instagram',
        token: 'NAO-EXPOR',
        additionalSettings: 'NAO-EXPOR',
        profileId: 'profile-1',
        organizationId: 'org-1',
      },
    } as any);
    const service = new SocialCommentsService(
      repository,
      {} as any,
      {} as any,
      {} as any
    );
    const result = await service.getComment('org-1', 'comment-1', 'profile-1');
    expect(result.integration).toEqual({
      id: 'channel-1',
      name: 'Canal',
      picture: null,
      providerIdentifier: 'instagram',
    });
  });
});

describe('Post engagement refresh', () => {
  const post = {
    id: 'post-1',
    releaseId: 'media-1',
    organizationId: 'org-1',
    integration: {
      id: 'channel-1',
      internalId: 'account-1',
      providerIdentifier: 'instagram',
      token: 'plain-token',
    },
  };
  const comment = {
    id: 'comment-1',
    content: 'Quero',
    publishedAt: '2026-10-19T12:00:00Z',
  };
  const setup = () => {
    const repository = createMock<SocialCommentsRepository>();
    repository.getPostToRefresh.mockResolvedValue(post as any);
    repository.getKnownProviderIds.mockResolvedValue([]);
    repository.createComments.mockResolvedValue([
      { providerCommentId: 'comment-1' },
    ]);
    const provider = {
      listComments: jest.fn().mockResolvedValue([comment]),
      postAnalytics: jest
        .fn()
        .mockResolvedValue([
          { label: 'Likes', data: [{ total: '3' }], percentageChange: 0 },
        ]),
    };
    const manager = {
      getSocialIntegration: jest.fn().mockReturnValue(provider),
    };
    const webhooks = { sendEvent: jest.fn().mockResolvedValue(undefined) };
    return {
      repository,
      provider,
      manager,
      webhooks,
      service: new SocialCommentsService(
        repository,
        manager as any,
        {} as any,
        webhooks as any
      ),
    };
  };
  beforeEach(async () => {
    await ioRedis.flushdb();
  });
  it('checks organization/profile before cache access or provider requests', async () => {
    const ctx = setup();
    ctx.repository.getPostToRefresh.mockResolvedValue(null);
    await expect(
      ctx.service.refreshPost('other-org', 'post-1', 'profile-2')
    ).rejects.toThrow('Published post not found');
    expect(ctx.repository.getPostToRefresh).toHaveBeenCalledWith(
      'other-org',
      'post-1',
      'profile-2'
    );
    expect(ctx.manager.getSocialIntegration).not.toHaveBeenCalled();
    expect(ctx.provider.listComments).not.toHaveBeenCalled();
  });
  it('refreshes comments and metrics, then coalesces repeated manual refreshes', async () => {
    const ctx = setup();
    const first = await ctx.service.refreshPost('org-1', 'post-1', 'profile-1');
    const second = await ctx.service.refreshPost(
      'org-1',
      'post-1',
      'profile-1'
    );
    expect(first.checkedAt).toBeTruthy();
    expect(second).toEqual(first);
    expect(ctx.provider.listComments).toHaveBeenCalledTimes(1);
    expect(ctx.provider.postAnalytics).toHaveBeenCalledWith(
      'account-1',
      'plain-token',
      'media-1',
      7,
      post.integration
    );
    expect(ctx.webhooks.sendEvent).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(first)).not.toContain('plain-token');
  });
  it('notifies only comments actually inserted even when another writer won the unique key', async () => {
    const ctx = setup();
    ctx.repository.createComments.mockResolvedValue([]);
    await ctx.service.refreshPost('org-1', 'post-1');
    expect(ctx.webhooks.sendEvent).not.toHaveBeenCalled();
  });
  it('preserves last successful data and sanitizes provider failures', async () => {
    const ctx = setup();
    ctx.provider.listComments.mockRejectedValue(
      new Error('URL https://graph/?access_token=SECRET')
    );
    await expect(ctx.service.refreshPost('org-1', 'post-1')).rejects.toThrow(
      'Could not refresh post data'
    );
    expect(await ioRedis.get('post-engagement:org-1:post-1')).toBeNull();
    ctx.provider.listComments.mockResolvedValue([comment]);
    await expect(
      ctx.service.refreshPost('org-1', 'post-1')
    ).resolves.toMatchObject({ checkedAt: expect.any(String) });
  });
  it('excludes deleted/unpublished posts and scopes the integration to the current organization and profile', () => {
    const findFirst = jest.fn();
    const repository = new SocialCommentsRepository(
      {} as any,
      { model: { post: { findFirst } } } as any,
      {} as any
    );
    repository.getPostToRefresh('org-1', 'post-1', 'profile-1');
    expect(findFirst.mock.calls[0][0].where).toMatchObject({
      id: 'post-1',
      organizationId: 'org-1',
      state: 'PUBLISHED',
      deletedAt: null,
      integration: {
        organizationId: 'org-1',
        profileId: 'profile-1',
        deletedAt: null,
      },
    });
  });
  it('paginates historical posts by id rather than filtering out posts older than seven days', () => {
    const findMany = jest.fn();
    const repository = new SocialCommentsRepository(
      {} as any,
      { model: { post: { findMany } } } as any,
      {} as any
    );
    repository.getPostsToPoll(['instagram'], 'post-42');
    expect(findMany.mock.calls[0][0]).toMatchObject({
      where: { id: { gt: 'post-42' } },
      orderBy: { id: 'asc' },
    });
    expect(findMany.mock.calls[0][0].where.publishDate).toBeUndefined();
  });
  it('saves partial comment progress and resumes its private cursor on the next refresh', async () => {
    const ctx = setup();
    const listCommentsPage = jest
      .fn()
      .mockResolvedValueOnce({ comments: [comment], nextCursor: 'cursor-2' })
      .mockResolvedValueOnce({ comments: [], nextCursor: undefined });
    (ctx.provider as any).listCommentsPage = listCommentsPage;
    const now = Date.now();
    const clock = jest.spyOn(Date, 'now').mockReturnValue(now);
    try {
      const partial = await ctx.service.refreshPost('org-1', 'post-1');
      expect(partial).toMatchObject({
        checkedAt: null,
        commentsComplete: false,
      });
      expect(JSON.stringify(partial)).not.toContain('cursor-2');
      expect(ctx.provider.postAnalytics).not.toHaveBeenCalled();
      clock.mockReturnValue(now + 31_000);
      const completed = await ctx.service.refreshPost('org-1', 'post-1');
      expect(listCommentsPage.mock.calls[1][3]).toBe('cursor-2');
      expect(completed).toMatchObject({
        checkedAt: expect.any(String),
        commentsComplete: true,
      });
      expect(ctx.provider.postAnalytics).toHaveBeenCalledTimes(1);
    } finally {
      clock.mockRestore();
    }
  });
  it('advances its historical cursor per processed post and resets after a complete pass', async () => {
    const ctx = setup();
    ctx.repository.getPostsToPoll
      .mockResolvedValueOnce([post as any])
      .mockResolvedValueOnce([]);
    jest.spyOn(ctx.service as any, 'pollPost').mockResolvedValue(2);
    await expect(ctx.service.pollComments(7)).resolves.toEqual({
      posts: 1,
      comments: 2,
    });
    expect(await ioRedis.get('comments-poll-history-cursor-v1')).toBe('post-1');
    await expect(ctx.service.pollComments(7)).resolves.toEqual({
      posts: 0,
      comments: 0,
    });
    expect(ctx.repository.getPostsToPoll).toHaveBeenLastCalledWith(
      ['instagram'],
      'post-1'
    );
    expect(await ioRedis.get('comments-poll-history-cursor-v1')).toBeNull();
  });
  it('stops a slow historical round within its activity time budget without losing the cursor', async () => {
    const ctx = setup();
    ctx.repository.getPostsToPoll.mockResolvedValue([post as any]);
    const poll = jest.spyOn(ctx.service as any, 'pollPost');
    const clock = jest
      .spyOn(Date, 'now')
      .mockReturnValueOnce(0)
      .mockReturnValue(300_000);
    try {
      await expect(ctx.service.pollComments(7)).resolves.toEqual({
        posts: 0,
        comments: 0,
      });
      expect(poll).not.toHaveBeenCalled();
    } finally {
      clock.mockRestore();
    }
  });
});
