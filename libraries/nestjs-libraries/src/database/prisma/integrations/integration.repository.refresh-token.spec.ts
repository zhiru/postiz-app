jest.mock('@gitroom/nestjs-libraries/upload/upload.factory', () => ({
  UploadFactory: { createStorage: () => ({}) },
}));
import { IntegrationRepository } from './integration.repository';

describe('integration refresh token preservation', () => {
  const setup = () => {
    const model = {
      upsert: jest.fn().mockResolvedValue({ id: 'channel' }),
      findFirst: jest.fn().mockResolvedValue({ rootInternalId: 'ig' }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    };
    const repository = new IntegrationRepository(
      { model: { integration: model } } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      { encrypt: (value: string) => `cipher:${value}` } as any
    );
    return { model, repository };
  };

  it('preserves the stored refresh token when reconnect returns none', async () => {
    const { model, repository } = setup();
    await repository.createOrUpdateIntegration(
      undefined,
      true,
      'org',
      'Channel',
      undefined,
      'social',
      'ig',
      'instagram',
      'new-access'
    );
    expect(model.upsert.mock.calls[0][0].update).not.toHaveProperty(
      'refreshToken'
    );
    expect(model.updateMany.mock.calls[0][0].data).not.toHaveProperty(
      'refreshToken'
    );
    expect(model.updateMany.mock.calls[0][0].where).toMatchObject({
      organizationId: 'org',
    });
  });

  it('stores a supplied replacement using the encryption boundary', async () => {
    const { model, repository } = setup();
    await repository.createOrUpdateIntegration(
      undefined,
      false,
      'org',
      'Channel',
      undefined,
      'social',
      'ig',
      'instagram',
      'new-access',
      'new-refresh'
    );
    expect(model.upsert.mock.calls[0][0].update.refreshToken).toBe(
      'enc:v1:cipher:new-refresh'
    );
  });
  it('limits shared token updates to the organization and selected profile', async () => {
    const { model, repository } = setup();
    await repository.createOrUpdateIntegration(
      undefined,
      true,
      'org',
      'Channel',
      undefined,
      'social',
      'ig',
      'instagram',
      'new-access',
      undefined,
      undefined,
      undefined,
      false,
      undefined,
      undefined,
      undefined,
      'client-a'
    );
    expect(model.updateMany.mock.calls[0][0].where).toMatchObject({
      organizationId: 'org',
      profileId: 'client-a',
    });
  });
});
