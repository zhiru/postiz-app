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
jest.mock('@gitroom/nestjs-libraries/redis/redis.service', () => ({
  ioRedis: {},
}));

import { createMock } from '@gitroom/nestjs-libraries/test';
import { PostsRepository } from './posts.repository';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { PostsService } from './posts.service';

const emptyWorkflowList = {
  async *[Symbol.asyncIterator]() {
    return;
  },
};

const buildService = () => {
  const repository = createMock<PostsRepository>();
  const integrationService = createMock<IntegrationService>();
  const start = jest.fn().mockResolvedValue(undefined);
  const temporalService = {
    client: {
      getRawClient: jest.fn().mockReturnValue({
        workflow: {
          list: jest.fn().mockReturnValue(emptyWorkflowList),
          start,
        },
      }),
      getWorkflowHandle: jest.fn(),
    },
  };
  const integrationManager = {
    getSocialIntegration: jest.fn().mockReturnValue({}),
  };
  const service = new PostsService(
    repository,
    integrationManager as any,
    integrationService,
    null as any,
    null as any,
    null as any,
    temporalService as any,
    null as any,
    {} as any, // webhooksService
    null as any,
    {} as any,
    {} as any
  );

  return { service, start, repository, integrationManager };
};

describe('PostsService - selecao do workflow de publicacao', () => {
  const originalEnv = {
    ids: process.env.POST_WORKFLOW_V112_INTEGRATION_IDS,
    providers: process.env.POST_WORKFLOW_V112_PROVIDERS,
    all: process.env.POST_WORKFLOW_V112_ALL,
  };

  afterEach(() => {
    const restore = (key: string, value: string | undefined) => {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    };
    restore('POST_WORKFLOW_V112_INTEGRATION_IDS', originalEnv.ids);
    restore('POST_WORKFLOW_V112_PROVIDERS', originalEnv.providers);
    restore('POST_WORKFLOW_V112_ALL', originalEnv.all);
  });

  it('inicia V114 apenas para a integracao canario', async () => {
    process.env.POST_WORKFLOW_V112_INTEGRATION_IDS = 'integration-1';
    const { service, start } = buildService();

    await service.startWorkflow('instagram', 'post-1', 'org-1', 'QUEUE', {
      id: 'integration-1',
      providerIdentifier: 'instagram',
    });

    expect(start).toHaveBeenCalledWith(
      'postWorkflowV114',
      expect.objectContaining({ workflowId: 'post_post-1' })
    );
  });

  it('mantem Zernio em V102 mesmo com gate global', async () => {
    delete process.env.POST_WORKFLOW_V112_INTEGRATION_IDS;
    delete process.env.POST_WORKFLOW_V112_PROVIDERS;
    process.env.POST_WORKFLOW_V112_ALL = 'true';
    const { service, start } = buildService();

    await service.startWorkflow('zernio', 'post-z', 'org-1', 'QUEUE', {
      id: 'integration-z',
      providerIdentifier: 'zernio-instagram',
    });

    expect(start).toHaveBeenCalledWith(
      'postWorkflowV102',
      expect.objectContaining({
        workflowId: 'post_post-z',
        args: [expect.objectContaining({ taskQueue: 'main' })],
      })
    );
  });
  it('usa V113 por padrao e evita consultar o post quando recebe a integracao', async () => {
    delete process.env.POST_WORKFLOW_V112_INTEGRATION_IDS;
    delete process.env.POST_WORKFLOW_V112_PROVIDERS;
    delete process.env.POST_WORKFLOW_V112_ALL;
    const { service, start, repository } = buildService();
    await service.startWorkflow('instagram', 'post-default', 'org-1', 'QUEUE', {
      id: 'channel',
      providerIdentifier: 'instagram',
    });
    expect(repository.getPostById).not.toHaveBeenCalled();
    expect(start).toHaveBeenCalledWith(
      'postWorkflowV113',
      expect.objectContaining({ workflowId: 'post_post-default' })
    );
  });
  it('selects credential-free history from the provider capability without a rollout gate', async () => {
    delete process.env.POST_WORKFLOW_V112_INTEGRATION_IDS;
    delete process.env.POST_WORKFLOW_V112_PROVIDERS;
    delete process.env.POST_WORKFLOW_V112_ALL;
    const { service, start, integrationManager } = buildService();
    integrationManager.getSocialIntegration.mockReturnValue({
      requiresCredentialFreeWorkflow: true,
    });
    await service.startWorkflow(
      'neuraltalk',
      'post-message',
      'org-1',
      'QUEUE',
      {
        id: 'messaging-channel',
        providerIdentifier: 'neuraltalk',
      }
    );
    expect(start).toHaveBeenCalledWith(
      'postWorkflowV114',
      expect.objectContaining({ workflowId: 'post_post-message' })
    );
  });
});
