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

import { FlowMessageService } from './flow-message.service';
import { createMock } from '@gitroom/nestjs-libraries/test';
import { FlowsRepository } from './flows.repository';
import { IntegrationService } from '../integrations/integration.service';
import { IntegrationManager } from '../../../integrations/integration.manager';
import { MediaRepository } from '../media/media.repository';
import { AutomationDeliveryService } from './automation-delivery.service';
import { InstagramMessagingService } from '../../../integrations/social/instagram-messaging.service';
import { EncryptionService } from '../../../crypto/encryption.service';

describe('FlowMessageService', () => {
  const repo = createMock<FlowsRepository>();
  const integrations = createMock<IntegrationService>();
  const manager = createMock<IntegrationManager>();
  const media = createMock<MediaRepository>();
  const delivery = createMock<AutomationDeliveryService>();
  const messaging = createMock<InstagramMessagingService>();
  const encryption = createMock<EncryptionService>();
  const provider = {
    sendDM: jest.fn(),
    sendPrivateReply: jest.fn(),
    sendMediaDM: jest.fn(),
  };
  const service = new FlowMessageService(
    repo,
    integrations,
    manager,
    media,
    delivery,
    messaging,
    encryption
  );
  const input = {
    flowId: 'f',
    executionId: 'e',
    integrationId: 'i',
    organizationId: 'org',
    nodeId: 'n',
    recipientId: 'u',
    message: 'Hello',
    interactionAt: Date.now(),
  };
  beforeEach(() => {
    jest.clearAllMocks();
    repo.getFlowById.mockResolvedValue({
      id: 'f',
      organizationId: 'org',
      profileId: 'profile',
      integrationId: 'i',
      status: 'ACTIVE',
    } as any);
    integrations.getIntegrationById.mockResolvedValue({
      id: 'i',
      organizationId: 'org',
      profileId: 'profile',
      internalId: 'ig',
      token: 'PAGE',
      providerIdentifier: 'instagram',
      disabled: false,
    } as any);
    manager.getSocialIntegration.mockReturnValue(provider as any);
    messaging.resolveIgUserToken.mockResolvedValue(null);
    delivery.sendOnce.mockImplementation(async (_key, send) => {
      await send();
    });
  });
  it('sends separate messages with a stable per-node delivery key', async () => {
    await service.send(input);
    expect(provider.sendDM).toHaveBeenCalledWith(
      'PAGE',
      'u',
      'Hello',
      'graph.facebook.com'
    );
    expect(delivery.sendOnce).toHaveBeenCalledWith(
      JSON.stringify(['i', 'e', 'n', 'sequence-v2']),
      expect.any(Function)
    );
  });
  it('uses the existing private-reply claim for the first comment response', async () => {
    await service.send({ ...input, commentId: 'c', interactionAt: undefined });
    expect(provider.sendPrivateReply).toHaveBeenCalledWith(
      'PAGE',
      'ig',
      'c',
      'Hello',
      undefined,
      'graph.facebook.com'
    );
    expect(delivery.sendOnce).toHaveBeenCalledWith(
      JSON.stringify(['i', 'c', 'private']),
      expect.any(Function)
    );
  });
  it('blocks an expired window before making any mutation', async () => {
    await expect(
      service.send({ ...input, interactionAt: Date.now() - 24 * 3600_000 })
    ).rejects.toThrow(/window/i);
    expect(delivery.sendOnce).not.toHaveBeenCalled();
  });
  it('blocks a paused flow and another profile', async () => {
    repo.getFlowById.mockResolvedValueOnce({ status: 'PAUSED' } as any);
    await expect(service.send(input)).rejects.toThrow();
    integrations.getIntegrationById.mockResolvedValueOnce({
      profileId: 'other',
    } as any);
    await expect(service.send(input)).rejects.toThrow();
    expect(delivery.sendOnce).not.toHaveBeenCalled();
  });
  it('sends only ready media owned by the flow profile', async () => {
    media.findAutomationMedia.mockResolvedValue({
      path: 'https://cdn.example.com/video.mp4',
      status: 'ready',
      fileSize: 123,
      type: 'video',
    } as any);
    await service.send({
      ...input,
      message: undefined,
      media: { id: 'm', type: 'video' },
    });
    expect(media.findAutomationMedia).toHaveBeenCalledWith(
      'org',
      'm',
      'profile'
    );
    expect(provider.sendMediaDM).toHaveBeenCalledWith(
      'PAGE',
      'u',
      'video',
      'https://cdn.example.com/video.mp4',
      'graph.facebook.com'
    );
  });
  it('supports videos uploaded by the panel with the historical image type default', async () => {
    media.findAutomationMedia.mockResolvedValue({
      path: 'https://cdn.example.com/legacy.mp4',
      status: 'ready',
      type: 'image',
      fileSize: null,
    } as any);
    await service.send({
      ...input,
      message: undefined,
      media: { id: 'legacy', type: 'video' },
    });
    expect(provider.sendMediaDM).toHaveBeenCalledTimes(1);
  });
  it.each([
    null,
    { status: 'processing' },
    {
      status: 'ready',
      path: 'https://cdn.example.com/x.png',
      type: 'image',
      fileSize: 9 * 1024 * 1024,
    },
  ])('blocks unavailable/oversized media %j', async (value) => {
    media.findAutomationMedia.mockResolvedValue(value as any);
    await expect(
      service.send({
        ...input,
        message: undefined,
        media: { id: 'm', type: 'image' },
      })
    ).rejects.toThrow();
    expect(provider.sendMediaDM).not.toHaveBeenCalled();
  });
});
