// Mocks topo-de-modulo: FlowsService importa IntegrationManager (nostr.provider
// ESM-only que quebra ts-jest) e serviços que o puxam transitivamente. Nada
// disso é usado pelo caminho de updateExecution.
jest.mock('@gitroom/nestjs-libraries/integrations/integration.manager', () => ({
  IntegrationManager: class IntegrationManagerMock {},
}));
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service',
  () => ({ IntegrationService: class IntegrationServiceMock {} })
);
jest.mock(
  '@gitroom/nestjs-libraries/integrations/social/instagram-messaging.service',
  () => ({ InstagramMessagingService: class InstagramMessagingServiceMock {} })
);
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/credentials/credential.service',
  () => ({ CredentialService: class CredentialServiceMock {} })
);
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/profiles/profile.service',
  () => ({ ProfileService: class ProfileServiceMock {} })
);

import { FlowsService } from './flows.service';

const CTX = {
  id: 'exec-1',
  flow: {
    id: 'flow-7',
    name: 'Auto-DM',
    organizationId: 'org-1',
    profileId: 'prof-9',
    integration: {
      id: 'int-1',
      providerIdentifier: 'instagram',
      name: 'IG do Cliente',
      picture: 'https://cdn/ig.jpg',
    },
  },
};

const buildService = (repo: any, statusEvent: any) =>
  new FlowsService(
    repo as any,
    null as any, // temporalService
    null as any, // integrationService
    null as any, // integrationManager
    null as any, // credentialService
    null as any, // instagramMessaging
    null as any, // profileService
    {} as any, // encryption
    statusEvent as any
  );

describe('FlowsService.updateExecution (StatusEvent AUTOMATION_FAILED)', () => {
  it('registra AUTOMATION_FAILED com snapshot do canal quando status FAILED', async () => {
    const repo = {
      updateExecution: jest.fn().mockResolvedValue({ id: 'exec-1' }),
      getExecutionEventContext: jest.fn().mockResolvedValue(CTX),
    };
    const statusEvent = { record: jest.fn().mockResolvedValue(undefined) };
    const service = buildService(repo, statusEvent);

    await service.updateExecution('exec-1', {
      status: 'FAILED' as any,
      error: 'Temporal indisponível',
      completedAt: new Date(),
    });

    expect(repo.getExecutionEventContext).toHaveBeenCalledWith('exec-1');
    expect(statusEvent.record).toHaveBeenCalledTimes(1);
    expect(statusEvent.record).toHaveBeenCalledWith({
      organizationId: 'org-1',
      type: 'AUTOMATION_FAILED',
      severity: 'WARNING',
      message: 'Temporal indisponível',
      profileId: 'prof-9',
      integrationId: 'int-1',
      channelName: 'IG do Cliente',
      channelPicture: 'https://cdn/ig.jpg',
      providerIdentifier: 'instagram',
      entityId: 'flow-7', // link -> /automacoes/:flowId
    });
  });

  it('NAO registra evento para transicoes que nao sao FAILED (caminho quente)', async () => {
    const repo = {
      updateExecution: jest.fn().mockResolvedValue({ id: 'exec-1' }),
      getExecutionEventContext: jest.fn(),
    };
    const statusEvent = { record: jest.fn() };
    const service = buildService(repo, statusEvent);

    await service.updateExecution('exec-1', { currentNodeId: 'node-2' });

    expect(repo.getExecutionEventContext).not.toHaveBeenCalled();
    expect(statusEvent.record).not.toHaveBeenCalled();
  });

  it('nao registra quando o contexto da execucao nao e encontrado (evita evento orfao)', async () => {
    const repo = {
      updateExecution: jest.fn().mockResolvedValue({ id: 'exec-1' }),
      getExecutionEventContext: jest.fn().mockResolvedValue(null),
    };
    const statusEvent = { record: jest.fn() };
    const service = buildService(repo, statusEvent);

    await service.updateExecution('exec-1', { status: 'FAILED' as any });

    expect(statusEvent.record).not.toHaveBeenCalled();
  });

  it('e fail-soft: falha ao ler o contexto NAO derruba o updateExecution (write FAILED ja ocorreu; e activity Temporal)', async () => {
    const repo = {
      updateExecution: jest.fn().mockResolvedValue({ id: 'exec-1' }),
      getExecutionEventContext: jest
        .fn()
        .mockRejectedValue(new Error('db hiccup')),
    };
    const statusEvent = { record: jest.fn() };
    const service = buildService(repo, statusEvent);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(
      service.updateExecution('exec-1', { status: 'FAILED' as any })
    ).resolves.toEqual({ id: 'exec-1' });
    expect(statusEvent.record).not.toHaveBeenCalled();
  });
});

describe('Multi-account quick automation creation', () => {
  const build = () => {
    const repo = {
      createQuickBatch: jest.fn().mockResolvedValue([
        { id: 'flow-1', integrationId: 'ig-1' },
        { id: 'flow-2', integrationId: 'ig-2' },
      ]),
    };
    const integrations = {
      getIntegrationById: jest.fn(async (_org, id) => ({
        id,
        profileId: 'profile-1',
        providerIdentifier: 'instagram',
      })),
    };
    const profiles = {
      getProfileById: jest.fn().mockResolvedValue({ id: 'profile-1' }),
    };
    const service = new FlowsService(
      repo as any,
      null as any,
      integrations as any,
      null as any,
      null as any,
      null as any,
      profiles as any,
      {} as any,
      {} as any
    );
    jest
      .spyOn(service, 'checkIntegrationWebhook')
      .mockResolvedValue({ ok: true });
    return { repo, integrations, service };
  };
  const body = {
    name: 'Keywords',
    integrationId: 'ig-1',
    integrationIds: ['ig-1', 'ig-2'],
    requestId: '62044a19-f129-4aef-8cc4-f9745b29d96e',
    postMode: 'all' as const,
    keywords: ['QUERO'],
    replyMessage: 'Sent!',
    dmMessage: 'Details',
  };
  it('validates every account before writing and saves paused with the same graph per account', async () => {
    const ctx = build();
    await ctx.service.quickCreateMultipleFlows('org-1', body, 'profile-1');
    expect(ctx.integrations.getIntegrationById).toHaveBeenCalledWith(
      'org-1',
      'ig-1'
    );
    expect(ctx.integrations.getIntegrationById).toHaveBeenCalledWith(
      'org-1',
      'ig-2'
    );
    const args = ctx.repo.createQuickBatch.mock.calls[0];
    expect(args[0]).toBe('org-1');
    expect(args[1]).toBe('profile-1');
    expect(args[5]).toBe(false);
    expect(args[4].nodes.map((node: { type: string }) => node.type)).toEqual([
      'TRIGGER',
      'REPLY_COMMENT',
      'SEND_DM',
    ]);
    expect(JSON.parse(args[4].nodes[0].data)).toMatchObject({
      mode: 'all',
      keywords: ['QUERO'],
    });
    expect(
      new Set(args[2].map((target: { id: string }) => target.id)).size
    ).toBe(2);
    await ctx.service.quickCreateMultipleFlows('org-1', body, 'profile-1');
    expect(ctx.repo.createQuickBatch.mock.calls[1][2]).toEqual(args[2]);
  });
  it('rejects an account outside the profile before creating any flow', async () => {
    const ctx = build();
    ctx.integrations.getIntegrationById.mockImplementation(
      async (_org, id) => ({
        id,
        providerIdentifier: 'instagram',
        profileId: id === 'ig-2' ? 'other-profile' : 'profile-1',
      })
    );
    await expect(
      ctx.service.quickCreateMultipleFlows('org-1', body, 'profile-1')
    ).rejects.toThrow('outro perfil');
    expect(ctx.repo.createQuickBatch).not.toHaveBeenCalled();
  });
  it('does not apply account-specific media ids to other accounts', async () => {
    const ctx = build();
    await expect(
      ctx.service.quickCreateMultipleFlows(
        'org-1',
        { ...body, postMode: 'specific', postIds: ['media-1'] },
        'profile-1'
      )
    ).rejects.toThrow('Specific posts');
    expect(ctx.repo.createQuickBatch).not.toHaveBeenCalled();
  });
});

describe('Saving automation configuration preserves activation intent', () => {
  it.each(['ACTIVE', 'PAUSED'])(
    'preserves existing %s state when saving',
    async (status) => {
      const current = { id: 'flow-1', integrationId: 'ig-1', status };
      const repo = {
        getFlow: jest.fn().mockResolvedValue(current),
        updateFlow: jest.fn(),
        saveCanvas: jest.fn(),
        updateFlowStatus: jest.fn(),
      };
      const service = new FlowsService(
        repo as any,
        null as any,
        {
          getIntegrationById: jest
            .fn()
            .mockResolvedValue({ id: 'ig-1', profileId: 'profile-1' }),
        } as any,
        null as any,
        null as any,
        null as any,
        null as any,
        {} as any,
        {} as any
      );
      await service.quickUpdateFlow(
        'org-1',
        'flow-1',
        {
          name: 'Rule',
          integrationId: 'ig-1',
          dmMessage: 'Details',
          activate: false,
        },
        'profile-1'
      );
      expect(repo.updateFlowStatus).not.toHaveBeenCalled();
    }
  );
  it('saves a draft paused when activation is explicitly unchecked', async () => {
    const repo = {
      getFlow: jest
        .fn()
        .mockResolvedValue({
          id: 'flow-1',
          integrationId: 'ig-1',
          status: 'DRAFT',
        }),
      updateFlow: jest.fn(),
      saveCanvas: jest.fn(),
      updateFlowStatus: jest.fn(),
    };
    const service = new FlowsService(
      repo as any,
      null as any,
      {
        getIntegrationById: jest
          .fn()
          .mockResolvedValue({ id: 'ig-1', profileId: 'profile-1' }),
      } as any,
      null as any,
      null as any,
      null as any,
      null as any,
      {} as any,
      {} as any
    );
    await service.quickUpdateFlow(
      'org-1',
      'flow-1',
      {
        name: 'Rule',
        integrationId: 'ig-1',
        dmMessage: 'Details',
        activate: false,
      },
      'profile-1'
    );
    expect(repo.updateFlowStatus).toHaveBeenCalledWith(
      'org-1',
      'flow-1',
      'PAUSED',
      'profile-1'
    );
  });
});
