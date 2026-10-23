jest.mock('../database/prisma/integrations/integration.service', () => ({
  IntegrationService: class {},
}));
jest.mock('../database/prisma/profiles/profile.service', () => ({
  ProfileService: class {},
}));
jest.mock('../database/prisma/credentials/credential.service', () => ({
  CredentialService: class {},
}));
import { NeuralTalkConnectionService } from './neuraltalk.connection.service';
import { createMock } from '../test';
import { IntegrationService } from '../database/prisma/integrations/integration.service';
import { ProfileService } from '../database/prisma/profiles/profile.service';
import { CredentialService } from '../database/prisma/credentials/credential.service';
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
    const credentials = createMock<CredentialService>();
    encryption.encrypt.mockReturnValue('encrypted');
    provider.accounts.mockResolvedValue([{ id: 'tenant', name: 'Account' }]);
    integrations.getIntegrationsList.mockResolvedValue([]);
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
        encryption,
        credentials
      ),
      provider,
      integrations,
      profiles,
      credentials,
      encryption,
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
    await expect(
      x.service.accounts('org', 'profile', body)
    ).rejects.toMatchObject({
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
  it('saves a validated default only when explicitly requested', async () => {
    const x = setup();
    await x.service.accounts('org', 'profile', body);
    expect(x.credentials.save).not.toHaveBeenCalled();
    await x.service.accounts('org', 'profile', {
      ...body,
      baseUrl: 'https://chat.example.com/',
      saveAsDefault: true,
    });
    expect(x.credentials.save).toHaveBeenCalledWith(
      'org',
      'neuraltalk',
      { baseUrl: 'https://chat.example.com', apiToken: 'private-key' },
      'profile'
    );
    expect(x.integrations.createOrUpdateIntegration).not.toHaveBeenCalled();
  });
  it('does not replace a saved default when the new token fails validation', async () => {
    const x = setup();
    x.provider.accounts.mockRejectedValue(new Error('private-key rejected'));
    await expect(
      x.service.accounts('org', 'profile', {
        ...body,
        saveAsDefault: true,
      })
    ).rejects.toMatchObject({ status: 502 });
    expect(x.credentials.save).not.toHaveBeenCalled();
    expect(x.credentials.delete).not.toHaveBeenCalled();
  });
  it('resolves a saved credential with exact organization and profile, never inheritance', async () => {
    const x = setup();
    x.credentials.getRaw.mockImplementation(async (org, provider, profile) =>
      org === 'org' && profile === 'p1' ? body : null
    );
    await x.service.accounts('org', 'p1', { useSavedConnection: true });
    expect(x.provider.accounts).toHaveBeenCalledWith({
      baseUrl: body.baseUrl,
      apiToken: body.apiToken,
    });
    for (const [org, profile] of [
      ['org', 'p2'],
      ['other-org', 'p1'],
    ]) {
      await expect(
        x.service.accounts(org, profile, {
          useSavedConnection: true,
        })
      ).rejects.toMatchObject({ status: 412 });
    }
    expect(x.provider.accounts).toHaveBeenCalledTimes(1);
    expect(x.credentials.getRawShared).not.toHaveBeenCalled();
  });
  it('does not permit overriding the target URL or token of a saved connection', async () => {
    const x = setup();
    x.credentials.getRaw.mockResolvedValue(body);
    for (const extra of [
      { baseUrl: 'https://other.example.com' },
      { apiToken: 'different' },
      { savedIntegrationId: 'channel' },
    ]) {
      await expect(
        x.service.accounts('org', 'profile', {
          useSavedConnection: true,
          ...extra,
        })
      ).rejects.toMatchObject({ status: 400 });
    }
    expect(x.provider.accounts).not.toHaveBeenCalled();
  });
  it('resolves the default profile before any credential read or deletion', async () => {
    const x = setup();
    x.profiles.getDefaultProfile.mockResolvedValue({ id: 'default' } as any);
    x.credentials.getRaw.mockResolvedValue(body);
    await x.service.accounts('org', undefined, { useSavedConnection: true });
    await x.service.removeDefaultConnection('org', undefined);
    expect(x.credentials.getRaw).toHaveBeenCalledWith(
      'org',
      'neuraltalk',
      'default'
    );
    expect(x.credentials.delete).toHaveBeenCalledWith(
      'org',
      'neuraltalk',
      'default'
    );
    expect(x.integrations.createOrUpdateIntegration).not.toHaveBeenCalled();
    expect(x.integrations.disconnectChannel).not.toHaveBeenCalled();
  });
  it('returns only safe default metadata and existing channels from the exact profile', async () => {
    const x = setup();
    x.credentials.getRaw.mockResolvedValue({
      ...body,
      arbitrarySecret: 'hidden',
    });
    const channel = {
      id: 'channel',
      name: 'Groups',
      providerIdentifier: 'neuraltalk',
      organizationId: 'org',
      profileId: 'profile',
      token: 'private-key',
      disabled: false,
      deletedAt: null as Date | null,
      refreshNeeded: false,
    };
    x.integrations.getIntegrationsList.mockResolvedValue([
      channel,
      { ...channel, id: 'other-profile', profileId: 'other' },
      { ...channel, id: 'legacy', profileId: null },
      { ...channel, id: 'other-org', organizationId: 'other' },
      { ...channel, id: 'other-provider', providerIdentifier: 'instagram' },
      { ...channel, id: 'disabled', disabled: true },
    ] as any);
    expect(await x.service.defaultConnection('org', 'profile')).toEqual({
      configured: true,
      baseUrl: body.baseUrl,
      connections: [{ id: 'channel', name: 'Groups' }],
    });
    expect(x.credentials.save).not.toHaveBeenCalled();
    expect(x.provider.accounts).not.toHaveBeenCalled();
  });
  it('reuses an existing channel credential server-side and saves only the server/token pair', async () => {
    const x = setup();
    x.encryption.decrypt.mockReturnValue(JSON.stringify(body));
    x.integrations.getIntegrationById.mockResolvedValue({
      id: 'channel',
      organizationId: 'org',
      profileId: 'profile',
      providerIdentifier: 'neuraltalk',
      token: 'enc:v1:encrypted',
      disabled: false,
      deletedAt: null as Date | null,
      refreshNeeded: false,
    } as any);
    const result = await x.service.accounts('org', 'profile', {
      savedIntegrationId: 'channel',
      saveAsDefault: true,
    });
    expect(result).toEqual({ accounts: [{ id: 'tenant', name: 'Account' }] });
    expect(x.provider.accounts).toHaveBeenCalledWith({
      baseUrl: body.baseUrl,
      apiToken: body.apiToken,
    });
    expect(x.credentials.save).toHaveBeenCalledWith(
      'org',
      'neuraltalk',
      {
        baseUrl: body.baseUrl,
        apiToken: body.apiToken,
      },
      'profile'
    );
    expect(x.integrations.createOrUpdateIntegration).not.toHaveBeenCalled();
    expect(x.integrations.disconnectChannel).not.toHaveBeenCalled();
  });
  it('rejects existing channels belonging to another organization/profile or provider', async () => {
    const x = setup();
    const channel = {
      organizationId: 'org',
      profileId: 'profile',
      providerIdentifier: 'neuraltalk',
      token: JSON.stringify(body),
      deletedAt: null as Date | null,
      disabled: false,
    };
    for (const extra of [
      { organizationId: 'other' },
      { profileId: 'other' },
      { profileId: null },
      { providerIdentifier: 'instagram' },
      { disabled: true },
      { deletedAt: new Date() },
    ]) {
      x.integrations.getIntegrationById.mockResolvedValue({
        ...channel,
        ...extra,
      } as any);
      await expect(
        x.service.accounts('org', 'profile', {
          savedIntegrationId: 'channel',
          saveAsDefault: true,
        })
      ).rejects.toMatchObject({ status: 404 });
    }
    expect(x.encryption.decrypt).not.toHaveBeenCalled();
    expect(x.provider.accounts).not.toHaveBeenCalled();
    expect(x.credentials.save).not.toHaveBeenCalled();
  });
  it('uses saved credentials for inbox discovery and connects only the requested inbox', async () => {
    const x = setup();
    x.credentials.getRaw.mockResolvedValue(body);
    await x.service.inboxes('org', 'profile', {
      useSavedConnection: true,
      accountId: 'tenant',
    });
    expect(x.provider.inboxes).toHaveBeenCalledWith({
      baseUrl: body.baseUrl,
      apiToken: body.apiToken,
      accountId: 'tenant',
    });
    await x.service.connect('org', 'profile', {
      useSavedConnection: true,
      accountId: 'tenant',
      inboxId: '10',
    });
    expect(x.provider.validateConnection).toHaveBeenCalledWith(
      JSON.stringify(body)
    );
    expect(x.credentials.save).not.toHaveBeenCalled();
  });
});
