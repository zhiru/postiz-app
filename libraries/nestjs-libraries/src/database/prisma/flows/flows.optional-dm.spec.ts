// Mocks topo-de-modulo: FlowsService importa IntegrationManager (nostr.provider
// ESM-only que quebra ts-jest) e serviços que o puxam transitivamente. Nada
// disso é usado pelo caminho de configuração de DM.
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

describe('Optional private messages in comment automations', () => {
  const body = {
    name: 'Public reply only',
    integrationId: 'ig-1',
    postMode: 'all',
    enableDm: false,
    replyMessages: ['Thanks for commenting!'],
    dmMessage: 'Retained draft must not be sent',
    dmButtonText: 'Details',
    dmButtonUrl: 'https://example.com/details',
    requireFollow: true,
    openingDmMessage: 'Retained opening DM',
  } as any;
  const setup = () => {
    const repo = {
      getFlow: jest.fn().mockResolvedValue({
        id: 'flow-1',
        integrationId: 'ig-1',
        status: 'ACTIVE',
        nodes: [{ type: 'SEND_DM', data: '{"message":"Old DM"}' }],
      }),
      abandonFlowPostbacks: jest.fn(),
      findPostbackById: jest.fn(),
      findPostbackByPayload: jest.fn(),
      updateFlow: jest.fn(),
      saveCanvas: jest.fn(),
      updateFlowStatus: jest.fn(),
      createQuickBatch: jest.fn().mockResolvedValue([]),
    };
    const service = new FlowsService(
      repo as any,
      null as any,
      null as any,
      null as any,
      null as any,
      null as any,
      null as any,
      {} as any,
      {} as any
    );
    return { repo, service };
  };
  const expectPublicOnly = (nodes: any[]) => {
    expect(nodes.map((n) => n.type)).toEqual(['TRIGGER', 'REPLY_COMMENT']);
    expect(JSON.parse(nodes[0].data).requireFollow).toBe(false);
    expect(JSON.parse(nodes[1].data).messages).toEqual(body.replyMessages);
  };
  it('does not generate private actions or a follow gate when DM is explicitly off', () => {
    expectPublicOnly((setup().service as any).buildQuickCanvas(body).nodes);
  });
  it('removes an existing DM on save without pausing or reactivating the flow', async () => {
    const { repo, service } = setup();
    jest
      .spyOn(service as any, 'assertIntegrationAccess')
      .mockResolvedValue(undefined);
    await service.quickUpdateFlow('org-1', 'flow-1', body, 'profile-1');
    expectPublicOnly(repo.saveCanvas.mock.calls[0][2]);
    expect(repo.saveCanvas.mock.calls[0].slice(0, 2)).toEqual([
      'org-1',
      'flow-1',
    ]);
    expect(repo.updateFlowStatus).not.toHaveBeenCalled();
    expect(repo.abandonFlowPostbacks).toHaveBeenCalledWith(
      'org-1',
      'flow-1',
      'profile-1'
    );
  });
  it('uses the same public-only graph for multiple accounts', async () => {
    const { repo, service } = setup();
    jest
      .spyOn(service as any, 'assertIntegrationAccess')
      .mockResolvedValue(undefined);
    jest
      .spyOn(service, 'checkIntegrationWebhook')
      .mockResolvedValue({ ok: true } as any);
    jest
      .spyOn(service as any, 'resolveCreationProfileId')
      .mockResolvedValue('profile-1');
    await service.quickCreateMultipleFlows(
      'org-1',
      {
        ...body,
        integrationIds: ['ig-1', 'ig-2'],
        requestId: 'unique-request',
        activate: false,
      },
      'profile-1'
    );
    expectPublicOnly(repo.createQuickBatch.mock.calls[0][4].nodes);
  });
  it.each([true, undefined])(
    'preserves DM behavior when enabled or omitted by legacy clients: %s',
    (enableDm) => {
      const { service } = setup();
      const canvas = (service as any).buildQuickCanvas({ ...body, enableDm });
      expect(canvas.nodes.map((n: any) => n.type)).toEqual([
        'TRIGGER',
        'REPLY_COMMENT',
        'SEND_DM',
      ]);
      expect(JSON.parse(canvas.nodes[0].data).requireFollow).toBe(true);
    }
  );
  it('blocks old follow-gate snapshots after DM is disabled, even before cancellation finishes', async () => {
    const { repo, service } = setup();
    repo.findPostbackById.mockResolvedValue({
      id: 'pending-1',
      flowId: 'flow-1',
      organizationId: 'org-1',
      status: 'PENDING',
    });
    repo.getFlow.mockResolvedValue({
      nodes: [{ type: 'TRIGGER', data: '{"enableDm":false}' }],
    } as any);
    expect(await service.getPendingPostback('pending-1')).toBeNull();
    expect(repo.getFlow).toHaveBeenCalledWith('org-1', 'flow-1');
  });
  it('ignores an old valid button after DM is disabled', async () => {
    const { repo, service } = setup();
    jest.spyOn(service as any, 'verifyPostbackPayload').mockReturnValue(true);
    repo.findPostbackByPayload.mockResolvedValue({
      id: 'pending-1',
      flowId: 'flow-1',
      organizationId: 'org-1',
      status: 'PENDING',
    });
    repo.getFlow.mockResolvedValue({
      nodes: [{ type: 'TRIGGER', data: '{"enableDm":false}' }],
    } as any);
    await expect(
      service.handlePostbackClick({
        payload: 'pb_old',
        senderIgsid: 'sender-1',
        igAccountId: 'ig-1',
      })
    ).resolves.toBeUndefined();
  });
  it('preserves legacy pending snapshots when there is no explicit DM opt-out', async () => {
    const { repo, service } = setup();
    const pending = {
      id: 'pending-1',
      flowId: 'flow-1',
      organizationId: 'org-1',
      status: 'PENDING',
    };
    repo.findPostbackById.mockResolvedValue(pending);
    expect(await service.getPendingPostback('pending-1')).toBe(pending);
  });
});
