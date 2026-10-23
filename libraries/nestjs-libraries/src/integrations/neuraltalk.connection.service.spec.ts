jest.mock('../database/prisma/integrations/integration.service', () => ({
  IntegrationService: class {},
}));
jest.mock('../database/prisma/profiles/profile.service', () => ({
  ProfileService: class {},
}));
import { NeuralTalkConnectionService } from './neuraltalk.connection.service';
import { createMock } from '../test';
import { IntegrationService } from '../database/prisma/integrations/integration.service';
import { ProfileService } from '../database/prisma/profiles/profile.service';
import { EncryptionService } from '../crypto/encryption.service';
import {
  NeuralTalkProvider,
  NeuralTalkDeliveryError,
} from './social/neuraltalk.provider';

describe('NeuralTalkConnectionService', () => {
  const body = {
    baseUrl: 'https://chat.example.com',
    apiToken: 'private-key',
    accountId: 'tenant',
    inboxId: '10',
  };
  function setup() {
    const provider = createMock<NeuralTalkProvider>();
    const integrations = createMock<IntegrationService>();
    const profiles = createMock<ProfileService>();
    const encryption = createMock<EncryptionService>();
    encryption.encrypt.mockReturnValue('encrypted');
    provider.validateConnection.mockResolvedValue({
      account: { id: 'tenant', name: 'Account' },
      inbox: {
        id: '10',
        name: 'Groups',
        channelType: 'Channel::Quepasa',
        supportsGroups: true,
        available: true,
      },
      auth: {
        id: 'tenant:10',
        name: 'Groups',
        username: 'Groups',
        accessToken: JSON.stringify(body),
        refreshToken: '',
      },
    } as any);
    integrations.createOrUpdateIntegration.mockResolvedValue({
      id: 'safe-id',
      token: 'secret',
    } as any);
    return {
      service: new NeuralTalkConnectionService(
        provider,
        integrations,
        profiles,
        encryption
      ),
      provider,
      integrations,
      profiles,
    };
  }
  it('connects validated inbox to authenticated profile and only returns the id', async () => {
    const x = setup();
    expect(await x.service.connect('org', 'profile', body)).toEqual({
      id: 'safe-id',
    });
    const args = x.integrations.createOrUpdateIntegration.mock.calls[0];
    expect(args[2]).toBe('org');
    expect(args[8]).toBe('enc:v1:encrypted');
    expect(args[16]).toBe('profile');
    expect(args[7]).toBe('neuraltalk');
  });
  it('uses separate identity for the same inbox in separate profiles', async () => {
    const x = setup();
    await x.service.connect('org', 'p1', body);
    await x.service.connect('org', 'p2', body);
    expect(x.integrations.createOrUpdateIntegration.mock.calls[0][6]).not.toBe(
      x.integrations.createOrUpdateIntegration.mock.calls[1][6]
    );
  });
  it('does not save a channel if credentials or inbox permissions fail', async () => {
    const x = setup();
    x.provider.validateConnection.mockRejectedValue(new Error('Rejected'));
    await expect(x.service.connect('org', 'profile', body)).rejects.toThrow();
    expect(x.integrations.createOrUpdateIntegration).not.toHaveBeenCalled();
  });
  it('returns a useful permission error without writing the integration', async () => {
    const x = setup();
    x.provider.validateConnection.mockRejectedValue(
      new NeuralTalkDeliveryError(
        'rejected',
        'The selected inbox is unavailable.'
      )
    );
    await expect(
      x.service.connect('org', 'profile', body)
    ).rejects.toMatchObject({
      status: 412,
      message: 'The selected inbox is unavailable.',
    });
    expect(x.integrations.createOrUpdateIntegration).not.toHaveBeenCalled();
  });
  it('does not expose transport error details or credentials', async () => {
    const x = setup();
    x.provider.accounts.mockRejectedValue(
      new Error('transport failed with private-key')
    );
    await expect(x.service.accounts(body)).rejects.toMatchObject({
      status: 502,
      message: 'Could not reach NeuralTalk. Check the server and credential.',
    });
  });
  it('requires a real default profile for an org-scoped administrator', async () => {
    const x = setup();
    x.profiles.getDefaultProfile.mockResolvedValue(null as any);
    await expect(x.service.connect('org', undefined, body)).rejects.toThrow();
    expect(x.integrations.createOrUpdateIntegration).not.toHaveBeenCalled();
  });
});
