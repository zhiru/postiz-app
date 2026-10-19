jest.mock('@gitroom/helpers/auth/auth.service', () => ({
  AuthService: { fixedEncryption: jest.fn(), fixedDecryption: jest.fn() },
}));
import { InstanceCredentialsService } from './instance.credentials.service';
import {
  credentialClass,
  instanceCredentialKeys,
  isSecretCredential,
} from './instance.credentials.list';

describe('Public branding settings', () => {
  it.each([
    'http://example.com/logo.png',
    'javascript:alert(1)',
    'data:image/png;base64,AA',
    '//example.com/logo.png',
    'https://user:password@example.com/logo.png',
  ])('rejects unsafe logo URL %s before writing any setting', async (url) => {
    const repository = { upsert: jest.fn(), delete: jest.fn() };
    const service = new InstanceCredentialsService(repository as any);
    await expect(
      service.save({ PLATFORM_BRAND_LOGO_URL: url }, 'admin-1')
    ).rejects.toThrow('HTTPS image URL');
    expect(repository.upsert).not.toHaveBeenCalled();
    expect(repository.delete).not.toHaveBeenCalled();
  });
  it('rejects an oversized name before writing', async () => {
    const repository = { upsert: jest.fn(), delete: jest.fn() };
    const service = new InstanceCredentialsService(repository as any);
    await expect(
      service.save({ PLATFORM_BRAND_NAME: 'a'.repeat(101) }, 'admin-1')
    ).rejects.toThrow('100 characters');
    expect(repository.upsert).not.toHaveBeenCalled();
  });
  it('classifies only the two intended branding settings as public and live', () => {
    for (const key of ['PLATFORM_BRAND_NAME', 'PLATFORM_BRAND_LOGO_URL']) {
      expect(instanceCredentialKeys).toContain(key);
      expect(credentialClass(key)).toBe('live');
      expect(isSecretCredential(key)).toBe(false);
    }
    expect(isSecretCredential('FACEBOOK_APP_SECRET')).toBe(true);
  });
});
