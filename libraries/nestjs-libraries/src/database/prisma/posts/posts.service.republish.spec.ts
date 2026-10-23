jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service',
  () => ({ IntegrationService: class IntegrationServiceMock {} })
);
jest.mock('@gitroom/nestjs-libraries/ai/ai-text.service', () => ({
  AiTextService: class AiTextServiceMock {},
}));
jest.mock('@gitroom/nestjs-libraries/openai/openai.service', () => ({
  OpenaiService: class OpenaiServiceMock {},
}));

jest.mock('@gitroom/nestjs-libraries/upload/upload.factory', () => ({
  UploadFactory: { createStorage: jest.fn().mockReturnValue({}) },
}));

import { CreationMethod } from '@prisma/client';
jest.mock('@gitroom/nestjs-libraries/integrations/integration.manager', () => ({
  IntegrationManager: class IntegrationManagerMock {},
}));
jest.mock(
  '@gitroom/nestjs-libraries/integrations/refresh.integration.service',
  () => ({ RefreshIntegrationService: class RefreshIntegrationServiceMock {} })
);
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/media/media.service',
  () => ({ MediaService: class MediaServiceMock {} })
);
jest.mock('@gitroom/nestjs-libraries/short-linking/short.link.service', () => ({
  ShortLinkService: class ShortLinkServiceMock {},
}));

import { BadRequestException } from '@nestjs/common';
import { createMock } from '@gitroom/nestjs-libraries/test';
import { PostsRepository } from './posts.repository';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { PostsService } from './posts.service';

const makeBody = (overrides: Record<string, unknown> = {}) => ({
  type: 'schedule' as const,
  shortLink: false,
  date: '2026-09-04T17:00:00.000Z',
  tags: [] as Array<{ value: string; label: string }>,
  posts: [
    {
      integration: { id: 'int-1' },
      value: [
        {
          id: 'post-1',
          content: '<p>Teste</p>',
          delay: 0,
          image: [] as Array<{ id: string; path: string }>,
        },
      ],
      settings: { __type: 'instagram' },
    },
  ],
  ...overrides,
});

const publishedPost = {
  id: 'post-1',
  organizationId: 'org-1',
  profileId: 'profile-1',
  state: 'PUBLISHED',
  publishDate: new Date('2026-09-03T12:00:00.000Z'),
  integration: {
    id: 'int-1',
    providerIdentifier: 'instagram',
  },
};

const buildService = () => {
  const repository = createMock<PostsRepository>();
  const integrationService = createMock<IntegrationService>();
  const service = new PostsService(
    repository,
    { getSocialIntegration: jest.fn().mockReturnValue({}) } as any,
    integrationService,
    null as any,
    null as any,
    null as any,
    null as any,
    null as any,
    {} as any, // webhooksService
    null as any,
    {} as any,
    {} as any
  );

  jest.spyOn(service as any, 'startWorkflow').mockResolvedValue(undefined);
  integrationService.getIntegrationById.mockResolvedValue({
    id: 'int-1',
    profileId: 'profile-1',
  } as any);
  repository.reservePostOperation.mockResolvedValue({
    claimed: true,
    requestHash: 'owner',
    result: null,
  });
  repository.releasePostQueueLock.mockResolvedValue({ count: 1 });
  repository.getAnchoredCommentsForPost.mockResolvedValue([]);
  repository.getPostById.mockResolvedValue(publishedPost as any);
  repository.createOrUpdatePost.mockResolvedValue({
    posts: [{ id: 'post-1', state: 'QUEUE' }],
  } as any);
  repository.changeDate.mockResolvedValue({ id: 'post-1' } as any);

  return { service, repository };
};

describe('PostsService - republicacao explicita', () => {
  it('rejeita salvar como schedule um post publicado sem opt-in', async () => {
    const { service, repository } = buildService();

    const result = expect(
      service.createPost(
        'org-1',
        makeBody() as any,
        CreationMethod.WEB,
        false,
        'profile-1'
      )
    ).rejects;
    await result.toBeInstanceOf(BadRequestException);
    await result.toThrow("use type 'update'");
    await result.toThrow('republish: true');

    expect(repository.getPostById).toHaveBeenCalledWith('post-1', 'org-1');
    expect(repository.createOrUpdatePost).not.toHaveBeenCalled();
  });

  it('valida todo o lote antes de escrever o primeiro canal', async () => {
    const { service, repository } = buildService();
    const body = makeBody() as any;
    body.posts = [
      {
        ...body.posts[0],
        value: [{ ...body.posts[0].value[0], id: undefined }],
      },
      {
        ...body.posts[0],
        integration: { id: 'int-2' },
        value: [{ ...body.posts[0].value[0], id: 'post-2' }],
      },
    ];

    await expect(
      service.createPost('org-1', body, CreationMethod.WEB, false, 'profile-1')
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(repository.getPostById).toHaveBeenCalledWith('post-2', 'org-1');
    expect(repository.createOrUpdatePost).not.toHaveBeenCalled();
  });

  it('exige booleano true real para autorizar a republicacao', async () => {
    const { service, repository } = buildService();

    await expect(
      service.createPost(
        'org-1',
        makeBody({ republish: 'true' }) as any,
        CreationMethod.WEB,
        false,
        'profile-1'
      )
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(repository.createOrUpdatePost).not.toHaveBeenCalled();
  });

  it('permite republicar quando o cliente envia republish true', async () => {
    const { service, repository } = buildService();

    await service.createPost(
      'org-1',
      makeBody({ republish: true }) as any,
      CreationMethod.WEB,
      false,
      'profile-1'
    );

    expect(repository.getPostById).toHaveBeenCalledWith('post-1', 'org-1');
    expect(repository.createOrUpdatePost).toHaveBeenCalledTimes(1);
  });

  it('rejeita republicacao fora do perfil mesmo com opt-in', async () => {
    const { service, repository } = buildService();
    repository.getPostById.mockResolvedValue({
      ...publishedPost,
      profileId: 'profile-2',
    } as any);

    await expect(
      service.createPost(
        'org-1',
        makeBody({ republish: true }) as any,
        CreationMethod.WEB,
        false,
        'profile-1'
      )
    ).rejects.toThrow('Post does not belong to this profile');

    expect(repository.createOrUpdatePost).not.toHaveBeenCalled();
  });

  it('rejeita id que existe fora da organizacao antes do upsert', async () => {
    const { service, repository } = buildService();
    // Escopado na org: nao encontra. Sem escopo: existe. E tentativa de
    // sequestrar o post de outra organizacao pelo `where: { id }` do upsert.
    repository.getPostById.mockImplementation(((id: string, org?: string) =>
      Promise.resolve(
        org ? null : ({ ...publishedPost, organizationId: 'org-2' } as any)
      )) as any);

    await expect(
      service.createPost(
        'org-1',
        makeBody({ type: 'update' }) as any,
        CreationMethod.WEB,
        false,
        'profile-1'
      )
    ).rejects.toThrow('Post not found');

    expect(repository.createOrUpdatePost).not.toHaveBeenCalled();
  });

  it('aceita id novo gerado no cliente para um post que ainda nao existe', async () => {
    const { service, repository } = buildService();
    // A UI gera `value[].id` com makeId(10) antes de salvar; o upsert cria o
    // post com esse id. Nao existe em lugar nenhum, entao nao e sequestro.
    repository.getPostById.mockResolvedValue(null);

    await service.createPost(
      'org-1',
      makeBody() as any,
      CreationMethod.WEB,
      false,
      'profile-1'
    );

    expect(repository.createOrUpdatePost).toHaveBeenCalledTimes(1);
  });

  it('nao bloqueia o agendamento de um post que ainda esta na fila', async () => {
    const { service, repository } = buildService();
    repository.getPostById.mockResolvedValue({
      ...publishedPost,
      state: 'QUEUE',
    } as any);

    await service.createPost(
      'org-1',
      makeBody() as any,
      CreationMethod.WEB,
      false,
      'profile-1'
    );

    expect(repository.createOrUpdatePost).toHaveBeenCalledTimes(1);
  });

  it('mantem updates de conteudo de posts publicados sem exigir republicacao', async () => {
    const { service, repository } = buildService();

    await service.createPost(
      'org-1',
      makeBody({ type: 'update' }) as any,
      CreationMethod.WEB,
      false,
      'profile-1'
    );

    expect(repository.getPostById).toHaveBeenCalledWith('post-1', 'org-1');
    expect(repository.createOrUpdatePost).toHaveBeenCalledTimes(1);
  });

  it('preserva update explicito ao alterar apenas a data', async () => {
    const { service, repository } = buildService();

    await service.changeDate(
      'org-1',
      'post-1',
      '2026-09-04T17:00:00.000Z',
      'update',
      false,
      'profile-1'
    );

    expect(repository.changeDate).toHaveBeenCalledWith(
      'org-1',
      'post-1',
      '2026-09-04T17:00:00.000Z',
      false,
      'update',
      'profile-1'
    );
    expect((service as any).startWorkflow).not.toHaveBeenCalled();
  });

  it('rejeita reagendar um post publicado sem opt-in antes de qualquer escrita', async () => {
    const { service, repository } = buildService();

    await expect(
      service.changeDate(
        'org-1',
        'post-1',
        '2026-09-04T17:00:00.000Z',
        'schedule',
        false,
        'profile-1'
      )
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(repository.changeDate).not.toHaveBeenCalled();
    expect((service as any).startWorkflow).not.toHaveBeenCalled();
  });

  it('preserva profileId e permite reagendar com opt-in explicito', async () => {
    const { service, repository } = buildService();

    await service.changeDate(
      'org-1',
      'post-1',
      '2026-09-04T17:00:00.000Z',
      'schedule',
      true,
      'profile-1'
    );

    expect(repository.changeDate).toHaveBeenCalledWith(
      'org-1',
      'post-1',
      '2026-09-04T17:00:00.000Z',
      false,
      'schedule',
      'profile-1'
    );
    expect((service as any).startWorkflow).toHaveBeenCalledTimes(1);
  });

  it('reagenda um post em fila sem exigir opt-in de republicacao', async () => {
    const { service, repository } = buildService();
    repository.getPostById.mockResolvedValue({
      ...publishedPost,
      state: 'QUEUE',
      publishDate: new Date(Date.now() + 86400000),
    } as any);

    await service.changeDate(
      'org-1',
      'post-1',
      new Date(Date.now() + 172800000).toISOString(),
      'schedule',
      false,
      'profile-1'
    );

    expect(repository.changeDate).toHaveBeenCalledTimes(1);
    expect((service as any).startWorkflow).toHaveBeenCalledTimes(1);
  });

  it('nao aceita string como opt-in ao reagendar', async () => {
    const { service, repository } = buildService();

    await expect(
      service.changeDate(
        'org-1',
        'post-1',
        '2026-09-04T17:00:00.000Z',
        'schedule',
        'true' as any,
        'profile-1'
      )
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(repository.changeDate).not.toHaveBeenCalled();
  });
  it('rejeita alterar a data fora do perfil antes de escrever ou iniciar workflow', async () => {
    const { service, repository } = buildService();
    await expect(
      service.changeDate(
        'org-1',
        'post-1',
        '2026-10-19T17:00:00Z',
        'update',
        false,
        'profile-other'
      )
    ).rejects.toThrow('Post not found');
    expect(repository.changeDate).not.toHaveBeenCalled();
    expect((service as any).startWorkflow).not.toHaveBeenCalled();
  });

  it('rejeita alterar data de post inexistente sem TypeError nem escrita', async () => {
    const { service, repository } = buildService();
    repository.getPostById.mockResolvedValue(null);
    await expect(
      service.changeDate('org-1', 'missing', '2026-10-19T17:00:00Z')
    ).rejects.toThrow('Post not found');
    expect(repository.changeDate).not.toHaveBeenCalled();
  });

  it('mantem o historico importado somente leitura mesmo com opt-in', async () => {
    const { service, repository } = buildService();
    repository.getPostById.mockResolvedValue({
      ...publishedPost,
      importedFromPlatform: true,
    } as any);
    await expect(
      service.changeDate(
        'org-1',
        'post-1',
        '2026-10-19T17:00:00Z',
        'schedule',
        true,
        'profile-1'
      )
    ).rejects.toThrow('read-only');
    expect(repository.changeDate).not.toHaveBeenCalled();
  });

  it('valida todos os canais antes de escrever o primeiro', async () => {
    const { service, repository } = buildService();
    const integrationService = (service as any)._integrationService;
    integrationService.getIntegrationById
      .mockResolvedValueOnce({ id: 'int-1', profileId: 'profile-1' })
      .mockResolvedValueOnce(null);
    const body = makeBody();
    body.posts = [
      body.posts[0],
      { ...body.posts[0], integration: { id: 'foreign-channel' } },
    ];
    await expect(
      service.createPost(
        'org-1',
        { ...body, type: 'update' } as any,
        CreationMethod.WEB,
        false,
        'profile-1'
      )
    ).rejects.toThrow('Channel not found');
    expect(repository.createOrUpdatePost).not.toHaveBeenCalled();
  });
  it('nao adota uma publicacao sem perfil ao receber um perfil explicito', async () => {
    const { service, repository } = buildService();
    repository.getPostById.mockResolvedValue({
      ...publishedPost,
      profileId: null,
    } as any);
    await expect(
      service.createPost(
        'org-1',
        makeBody({ type: 'update' }) as any,
        CreationMethod.WEB,
        false,
        'profile-1'
      )
    ).rejects.toThrow('Post does not belong to this profile');
    expect(repository.createOrUpdatePost).not.toHaveBeenCalled();
  });
});

describe('durable post operation receipts', () => {
  const receipts = (repository: any) => {
    const saved = new Map<string, any>();
    repository.reservePostOperation.mockImplementation(
      async (id: string, _o: string, _p: string, h: string) => {
        if (saved.has(id)) return { claimed: false, ...saved.get(id) };
        saved.set(id, { requestHash: h, result: null });
        return { claimed: true, ...saved.get(id) };
      }
    );
    repository.completePostOperation.mockImplementation(
      async (id: string, result: any) => {
        saved.get(id).result = JSON.stringify(result);
        return { id };
      }
    );
  };
  it('replays successful creates and rejects key reuse for another payload', async () => {
    const { service, repository } = buildService();
    receipts(repository);
    const create = jest.fn().mockResolvedValue([{ postId: 'same-id' }]);
    const first = await service.runIdempotentPostOperation(
      'o1',
      'p1',
      'create',
      'request-123',
      { caption: 'A' },
      create
    );
    const replay = await service.runIdempotentPostOperation(
      'o1',
      'p1',
      'create',
      'request-123',
      { caption: 'A' },
      create
    );
    expect(replay).toEqual(first);
    expect(create).toHaveBeenCalledTimes(1);
    await expect(
      service.runIdempotentPostOperation(
        'o1',
        'p1',
        'create',
        'request-123',
        { caption: 'B' },
        create
      )
    ).rejects.toMatchObject({ status: 409 });
  });
  it('never repeats an interrupted unknown-result creation', async () => {
    const { service, repository } = buildService();
    receipts(repository);
    const create = jest
      .fn()
      .mockRejectedValue(new Error('Interrupted after write'));
    await expect(
      service.runIdempotentPostOperation(
        'o1',
        'p1',
        'create',
        'unknown-123',
        {},
        create
      )
    ).rejects.toThrow();
    await expect(
      service.runIdempotentPostOperation(
        'o1',
        'p1',
        'create',
        'unknown-123',
        {},
        create
      )
    ).rejects.toMatchObject({ status: 409 });
    expect(create).toHaveBeenCalledTimes(1);
  });
  it('keeps receipt identity separate across profiles', async () => {
    const { service, repository } = buildService();
    receipts(repository);
    const create = jest.fn().mockResolvedValue({ id: 'own' });
    await service.runIdempotentPostOperation(
      'o1',
      'p1',
      'create',
      'same-key-123',
      {},
      create
    );
    await service.runIdempotentPostOperation(
      'o1',
      'p2',
      'create',
      'same-key-123',
      {},
      create
    );
    expect(create).toHaveBeenCalledTimes(2);
  });
});

describe('verified queue cancellation', () => {
  it('waits for termination and confirms it by a second description', async () => {
    const { service } = buildService();
    const handle = {
      describe: jest
        .fn()
        .mockResolvedValueOnce({ status: { name: 'RUNNING' } })
        .mockResolvedValueOnce({ status: { name: 'TERMINATED' } }),
      terminate: jest.fn().mockResolvedValue(undefined),
    };
    (service as any)._temporalService = {
      client: {
        getRawClient: () => ({ workflow: { getHandle: () => handle } }),
      },
    };
    await service.stopPendingPost('post-1');
    expect(handle.terminate).toHaveBeenCalledTimes(1);
    expect(handle.describe).toHaveBeenCalledTimes(2);
  });
  it('returns an explicit failure instead of hiding a cancellation error', async () => {
    const { service } = buildService();
    (service as any)._temporalService = {
      client: {
        getRawClient: () => ({
          workflow: {
            getHandle: () => ({
              describe: async () => ({ status: { name: 'RUNNING' } }),
              terminate: async () => {
                throw new Error('queue unavailable');
              },
            }),
          },
        }),
      },
    };
    await expect(service.stopPendingPost('post-1')).rejects.toMatchObject({
      status: 503,
    });
  });
});

describe('publication media processing gate', () => {
  it.each(['processing', 'failed'])(
    'blocks %s media before publishing, including references without ids',
    async (status) => {
      const { service, repository } = buildService();
      repository.getPostById.mockResolvedValue({
        ...publishedPost,
        settings: '{}',
      } as any);
      const media = {
        assertReadyForPosts: jest
          .fn()
          .mockResolvedValue([
            { field: 'media.0', code: 'MEDIA_NOT_READY', message: status },
          ]),
        getMediaById: jest.fn(),
      };
      (service as any)._mediaService = media;
      await expect(
        service.updateMedia('post-1', [
          { path: 'https://uploads.test/movie.mov' },
        ])
      ).rejects.toMatchObject({ status: 400 });
      expect(media.getMediaById).not.toHaveBeenCalled();
      expect(repository.updateImages).not.toHaveBeenCalled();
    }
  );
});

describe('queue mutation locking', () => {
  it('retains the lock after an ambiguous queue activation', async () => {
    const { service, repository } = buildService();
    const post = {
      ...publishedPost,
      state: 'DRAFT',
      updatedAt: new Date(),
      publishDate: new Date(Date.now() + 86400000),
    };
    repository.getPostById.mockResolvedValue(post as any);
    repository.patchManagedPost.mockResolvedValue(true);
    (service.startWorkflow as jest.Mock).mockRejectedValue(
      new Error('Unknown activation result')
    );
    await expect(
      service.changePostStatus(
        'org-1',
        'post-1',
        'schedule',
        'profile-1',
        post.updatedAt.toISOString()
      )
    ).rejects.toThrow('Unknown activation result');
    expect(repository.releasePostQueueLock).not.toHaveBeenCalled();
  });
  it('checks a stale version before terminating any workflow and releases its unused lock', async () => {
    const { service, repository } = buildService();
    repository.getPostById.mockResolvedValue({
      ...publishedPost,
      state: 'DRAFT',
      updatedAt: new Date(),
      publishDate: new Date(Date.now() + 86400000),
    } as any);
    const stop = jest.spyOn(service, 'stopPendingPost');
    await expect(
      service.changePostStatus(
        'org-1',
        'post-1',
        'draft',
        'profile-1',
        '2020-01-01T00:00:00Z'
      )
    ).rejects.toMatchObject({ status: 409 });
    expect(stop).not.toHaveBeenCalled();
    expect(repository.releasePostQueueLock).toHaveBeenCalledTimes(1);
  });
});

it('refreshes execution media through the scoped resolver, including original paths after preparation', async () => {
  const { service, repository } = buildService();
  repository.getPostById.mockResolvedValue({
    ...publishedPost,
    settings: '{}',
  } as any);
  const media = {
    assertReadyForPosts: jest.fn().mockResolvedValue([]),
    resolvePostMedia: jest.fn().mockResolvedValue({
      id: 'owned',
      path: 'https://uploads.test/prepared.mp4',
      name: 'prepared.mp4',
    }),
    getMediaById: jest.fn(),
  };
  (service as any)._mediaService = media;
  const result = await service.updateMedia('post-1', [
    {
      id: 'foreign',
      path: 'https://uploads.test/original.mov',
      alt: 'Preserve',
    },
  ]);
  expect(media.resolvePostMedia).toHaveBeenCalledWith(
    'org-1',
    {
      id: 'foreign',
      path: 'https://uploads.test/original.mov',
      alt: 'Preserve',
    },
    'profile-1'
  );
  expect(media.getMediaById).not.toHaveBeenCalled();
  expect(result[0]).toMatchObject({
    id: 'owned',
    path: 'https://uploads.test/prepared.mp4',
    alt: 'Preserve',
  });
});
