import { PostsRepository } from './posts.repository';
import { createPrismaRepositoryMock } from '@gitroom/nestjs-libraries/test';

describe('PostsRepository.getErrorPosts', () => {
  let repo: PostsRepository;
  let prismaMock: ReturnType<typeof createPrismaRepositoryMock<'post'>>;

  beforeEach(() => {
    prismaMock = createPrismaRepositoryMock('post');
    (prismaMock.model.post as any).findMany = jest
      .fn()
      .mockResolvedValue([] as any);
    repo = new PostsRepository(
      prismaMock as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any // transaction
    );
  });

  const arg = () => prismaMock.model.post.findMany.mock.calls[0][0] as any;

  it('filtra state=ERROR por org, ignora filhos de thread, janela de 30 dias e limit padrao', async () => {
    await repo.getErrorPosts('org-1');

    const a = arg();
    expect(a.where.organizationId).toBe('org-1');
    expect(a.where.state).toBe('ERROR');
    expect(a.where.deletedAt).toBeNull();
    expect(a.where.OR).toEqual([
      { profileId: null },
      { profile: { deletedAt: null } },
    ]);
    expect(a.where.parentPostId).toBeNull();
    expect(a.where.updatedAt.gte).toBeInstanceOf(Date);
    expect(a.orderBy).toEqual({ updatedAt: 'desc' });
    expect(a.take).toBe(50);
    // Seguranca: NAO seleciona `error` (serializacao crua da excecao — pode
    // conter refresh_token/client_secret). A tela so precisa da contagem.
    expect(a.select.error).toBeUndefined();
    // canal + perfil embutidos (sem N+1)
    expect(a.select.integration.select).toEqual({
      id: true,
      providerIdentifier: true,
      internalId: true,
      name: true,
      picture: true,
    });
    expect(a.select.profile.select).toEqual({ id: true, name: true });
  });

  it('aplica profileId quando informado e respeita o limit', async () => {
    await repo.getErrorPosts('org-1', 'prof-2', 10);

    const a = arg();
    expect(a.where.profileId).toBe('prof-2');
    expect(a.take).toBe(10);
  });

  it('nao filtra por profileId quando ausente', async () => {
    await repo.getErrorPosts('org-1');
    expect(arg().where.profileId).toBeUndefined();
  });
});

describe('PostsRepository.changeState', () => {
  let repo: PostsRepository;
  let prismaMock: ReturnType<typeof createPrismaRepositoryMock<'post'>>;

  beforeEach(() => {
    prismaMock = createPrismaRepositoryMock('post');
    (prismaMock.model.post as any).update = jest
      .fn()
      .mockResolvedValue({ id: 'p1', integration: {} } as any);
    repo = new PostsRepository(
      prismaMock as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any // transaction
    );
  });

  it('inclui name/picture do canal (snapshot do StatusEvent) alem do providerIdentifier', async () => {
    // Estado nao-ERROR: nao aciona o ramo da tabela `errors`, isola o include.
    await repo.changeState('p1', 'PUBLISHED' as any);

    const call = prismaMock.model.post.update.mock.calls[0][0] as any;
    expect(call.include.integration.select).toEqual({
      providerIdentifier: true,
      name: true,
      picture: true,
    });
  });
});

describe('PostsRepository - ciclo de republicacao apos erro', () => {
  let repo: PostsRepository;
  let prismaMock: ReturnType<typeof createPrismaRepositoryMock<'post'>>;

  beforeEach(() => {
    prismaMock = createPrismaRepositoryMock('post');
    prismaMock.model.post.update.mockResolvedValue({ id: 'p1' } as any);
    const tx = {
      post: {
        ...prismaMock.model.post,
        findFirstOrThrow: jest.fn().mockResolvedValue({
          id: 'p1',
          integrationId: 'channel',
          intervalInDays: null,
        }),
      },
    };
    prismaMock.model.post.findUnique.mockResolvedValue(null);
    repo = new PostsRepository(
      prismaMock as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {
        model: { $transaction: jest.fn().mockImplementation((run) => run(tx)) },
      } as any // transaction
    );
  });

  it('limpa o erro atual quando a publicacao termina com sucesso', async () => {
    await repo.updatePost('p1', 'remote-1', 'https://example.com/post/1');

    expect(prismaMock.model.post.update).toHaveBeenCalledWith({
      where: { id: 'p1' },
      data: {
        state: 'PUBLISHED',
        releaseURL: 'https://example.com/post/1',
        releaseId: 'remote-1',
        externalId: 'remote-1',
        error: null as string | null,
      },
    });
  });

  it('limpa o erro atual ao reagendar uma nova tentativa', async () => {
    await repo.changeDate(
      'org-1',
      'p1',
      '2026-09-07T14:30:00.000Z',
      false,
      'schedule'
    );

    expect(prismaMock.model.post.update).toHaveBeenCalledWith({
      where: { organizationId: 'org-1', id: 'p1' },
      data: {
        publishDate: new Date('2026-09-07T14:30:00.000Z'),
        state: 'QUEUE',
        releaseId: null,
        releaseURL: null,
        error: null as string | null,
      },
    });
  });

  it('preserva o erro atual quando altera somente a data', async () => {
    await repo.changeDate(
      'org-1',
      'p1',
      '2026-09-07T14:30:00.000Z',
      false,
      'update'
    );

    const call = prismaMock.model.post.update.mock.calls[0][0] as any;
    expect(call.data).toEqual({
      publishDate: new Date('2026-09-07T14:30:00.000Z'),
    });
    expect(call.data).not.toHaveProperty('error');
  });
});

describe('PostsRepository.searchForMissingThreeHoursPosts', () => {
  it('ignora posts de perfis cancelados e preserva posts legados de workspace', async () => {
    const prismaMock = createPrismaRepositoryMock('post');
    prismaMock.model.post.findMany.mockResolvedValue([] as any);
    const repo = new PostsRepository(
      prismaMock as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any // transaction
    );

    await repo.searchForMissingThreeHoursPosts();

    expect(prismaMock.model.post.findMany.mock.calls[0][0].where.OR).toEqual([
      { profileId: null },
      { profile: { deletedAt: null } },
    ]);
  });
});

describe('PostsRepository.getPost for publishing', () => {
  it('ignora a raiz quando o perfil foi cancelado', async () => {
    const prismaMock = createPrismaRepositoryMock('post');
    prismaMock.model.post.findUnique.mockResolvedValue(null);
    const repo = new PostsRepository(
      prismaMock as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any // transaction
    );

    await repo.getPost('post-1', true, 'org-1', true);

    expect(prismaMock.model.post.findUnique.mock.calls[0][0].where.OR).toEqual([
      { profileId: null },
      { profile: { deletedAt: null } },
    ]);
  });
});

describe('PostsRepository.getPostsList filters', () => {
  const setup = () => {
    const prisma = createPrismaRepositoryMock('post');
    prisma.model.post.findMany.mockResolvedValue([] as any);
    prisma.model.post.count.mockResolvedValue(0);
    const repo = new PostsRepository(
      prisma as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any
    );
    return { repo, prisma };
  };

  it('keeps historical drafts visible and offers an overdue-only view', async () => {
    const { repo, prisma } = setup();
    await repo.getPostsList('org-1', { state: 'draft' }, 'profile-1');
    expect(
      prisma.model.post.findMany.mock.calls[0][0].where.publishDate
    ).toBeUndefined();
    await repo.getPostsList('org-1', { state: 'overdue' } as any, 'profile-1');
    const query = prisma.model.post.findMany.mock.calls[1][0];
    expect(query.where.state).toBe('DRAFT');
    expect(query.orderBy).toEqual([{ publishDate: 'desc' }, { id: 'desc' }]);
    expect(query.where.publishDate.lt).toBeInstanceOf(Date);
    expect(query.where.integration.organizationId).toBe('org-1');
    expect(query.where.integration.profileId).toBe('profile-1');
  });

  it('intersects date ranges with state filters before pagination, preserving profile isolation', async () => {
    const { repo, prisma } = setup();
    await repo.getPostsList(
      'org-1',
      {
        state: 'scheduled',
        order: 'desc',
        page: 2,
        limit: 10,
        startDate: '2030-01-01T03:00:00Z',
        endDate: '2030-01-02T02:59:59Z',
      } as any,
      'profile-1'
    );
    const query = prisma.model.post.findMany.mock.calls[0][0];
    expect(query.skip).toBe(20);
    expect(query.orderBy).toEqual([{ publishDate: 'desc' }, { id: 'desc' }]);
    expect(query.where.AND).toContainEqual({
      publishDate: {
        gte: new Date('2030-01-01T03:00:00Z'),
        lte: new Date('2030-01-02T02:59:59Z'),
      },
    });
    expect(query.where.publishDate.gte).toBeInstanceOf(Date);
    expect(query.where.integration).toMatchObject({
      organizationId: 'org-1',
      profileId: 'profile-1',
    });
    expect(prisma.model.post.count.mock.calls[0][0].where).toEqual(query.where);
  });

  it('returns only the first media preview, without exposing settings or media metadata', async () => {
    const { repo, prisma } = setup();
    prisma.model.post.findMany.mockResolvedValueOnce([
      {
        id: 'video',
        settings: '{"collaborators":["test"]}',
        image:
          '[{"path":"/clip.mp4","thumbnail":"/cover.png","privateField":"hidden"},{"path":"/second.png"}]',
      },
    ] as any);
    const result = await repo.getPostsList('org-1', {}, 'profile-1');
    expect(result.posts[0].mediaPreview).toEqual({
      src: '/cover.png',
      video: true,
    });
    expect(result.posts[0]).not.toHaveProperty('image');
    expect(result.posts[0]).not.toHaveProperty('settings');
  });

  it('filters formats before counting and paging and never returns raw media/settings', async () => {
    const { repo, prisma } = setup();
    prisma.model.post.findMany
      .mockResolvedValueOnce([
        { id: 'story', settings: '{"post_type":"story"}', image: '[]' },
        {
          id: 'reel',
          settings: '{"post_type":"post"}',
          image: '[{"path":"clip.mp4"}]',
        },
      ] as any)
      .mockResolvedValueOnce([
        { id: 'story', settings: '{"post_type":"story"}', image: '[]' },
      ] as any);
    prisma.model.post.count.mockResolvedValue(1);
    const result = await repo.getPostsList(
      'org-1',
      { format: 'story', search: 'Summit', limit: 20, page: 0 } as any,
      'profile-1'
    );
    const query = prisma.model.post.findMany.mock.calls[1][0];
    expect(query.where.AND).toContainEqual({ id: { in: ['story'] } });
    expect(query.where.content).toEqual({
      contains: 'Summit',
      mode: 'insensitive',
    });
    expect(query.where.integration.profileId).toBe('profile-1');
    expect(prisma.model.post.count.mock.calls[0][0].where).toEqual(query.where);
    expect(result.posts[0]).toMatchObject({ id: 'story', format: 'story' });
    expect(result.posts[0]).not.toHaveProperty('settings');
    expect(result.posts[0]).not.toHaveProperty('image');
  });
});

describe('PostsRepository calendar format compatibility', () => {
  const query = { startDate: '2026-10-19', endDate: '2026-10-25' };
  it('classifies only private calendar requests without changing public attachments', async () => {
    const prisma = createPrismaRepositoryMock('post');
    const row = {
      id: 'post-1',
      publishDate: new Date('2026-10-21T15:00:00Z'),
      state: 'DRAFT',
      settings: '{}',
      image: '[{"path":"a.jpg"},{"path":"b.jpg"}]',
      error: null as string | null,
    };
    prisma.model.post.findMany.mockResolvedValue([row] as any);
    const repo = new PostsRepository(
      prisma as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any
    );
    const publicPosts = await repo.getPosts(
      'org-1',
      query as any,
      false,
      'profile-1'
    );
    expect(publicPosts[0]).not.toHaveProperty('format');
    expect(publicPosts[0]).not.toHaveProperty('image');
    expect(
      (prisma.model.post.findMany.mock.calls[0][0] as any).select.image
    ).toBeUndefined();
    const privatePosts = await repo.getPosts(
      'org-1',
      query as any,
      false,
      'profile-1',
      true
    );
    expect(privatePosts[0].format).toBe('carousel');
    expect(privatePosts[0]).not.toHaveProperty('image');
    const attached = await repo.getPosts(
      'org-1',
      query as any,
      true,
      'profile-1'
    );
    expect(attached[0].image).toBe(row.image);
    expect(attached[0]).not.toHaveProperty('format');
  });
});
