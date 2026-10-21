import { AiCredentialService } from './ai-credential.service';
import { AiCredentialRepository } from './ai-credential.repository';
import { AiProviderTestService } from './ai-provider-test.service';
import { EncryptionService } from '@gitroom/nestjs-libraries/crypto/encryption.service';
import { createMock } from '@gitroom/nestjs-libraries/test';
import { MockProxy } from 'jest-mock-extended';
import { HttpException } from '@nestjs/common';

describe('AiCredentialService', () => {
  let service: AiCredentialService;
  let repository: MockProxy<AiCredentialRepository> & AiCredentialRepository;
  let encryption: MockProxy<EncryptionService> & EncryptionService;
  let testService: MockProxy<AiProviderTestService> & AiProviderTestService;

  beforeEach(() => {
    repository = createMock<AiCredentialRepository>();
    encryption = createMock<EncryptionService>();
    testService = createMock<AiProviderTestService>();
    service = new AiCredentialService(
      repository,
      encryption,
      testService,
      {} as any
    );
  });

  describe('model discovery', () => {
    it('scopes saved-key lookup and never reuses it for another destination', async () => {
      repository.findOne.mockResolvedValue({
        id: 'cred',
        provider: 'openai-compatible',
        encryptedData: 'encrypted',
        options: { baseURL: 'https://old.example.com/v1' },
      } as any);
      encryption.decryptJson.mockReturnValue({ apiKey: 'private-key' });
      await expect(
        service.previewModels(
          'org-1',
          'PROFILE',
          'IMAGE',
          {
            provider: 'openai-compatible',
            apiKey: '__REDACTED__',
            options: { baseURL: 'https://other.example.com/v1' },
            shareDefault: false,
          },
          'profile-1'
        )
      ).rejects.toMatchObject({ status: 400 });
      expect(repository.findOne).toHaveBeenCalledWith(
        'org-1',
        'PROFILE',
        'IMAGE',
        'profile-1'
      );
      expect(repository.upsert).not.toHaveBeenCalled();
    });
    it('rejects profile scope without a profile before looking up credentials', async () => {
      await expect(
        service.previewModels('org-1', 'PROFILE', 'TEXT', {
          provider: 'openai',
          apiKey: '__REDACTED__',
          shareDefault: false,
        })
      ).rejects.toMatchObject({ status: 400 });
      expect(repository.findOne).not.toHaveBeenCalled();
    });
  });

  describe('save', () => {
    it('deve encriptar a apiKey e delegar ao repository', async () => {
      encryption.encryptJson.mockReturnValue('cipher-base64');
      repository.upsert.mockResolvedValue({} as any);

      await service.save('org-1', 'WORKSPACE', 'TEXT', {
        provider: 'openrouter',
        model: 'openai/gpt-5.5',
        apiKey: 'sk-or-real',
        options: { temperature: 0.7 },
        shareDefault: true,
      });

      expect(encryption.encryptJson).toHaveBeenCalledWith({
        apiKey: 'sk-or-real',
      });
      expect(repository.upsert).toHaveBeenCalledWith(
        'org-1',
        'WORKSPACE',
        'TEXT',
        expect.objectContaining({
          provider: 'openrouter',
          model: 'openai/gpt-5.5',
          encryptedData: 'cipher-base64',
          shareDefault: true,
          options: { temperature: 0.7 },
        }),
        undefined
      );
    });

    it('deve preservar apiKey antiga quando enviada como SENTINEL', async () => {
      encryption.encryptJson.mockReturnValue('cipher-novo');
      // getRaw devolve a apiKey real existente
      repository.findOne.mockResolvedValue({
        id: 'cred-1',
        scope: 'WORKSPACE',
        kind: 'TEXT',
        profileId: null,
        provider: 'openrouter',
        model: 'openai/gpt-5.5',
        fallbackModel: null,
        encryptedData: 'cipher-antigo',
        options: null,
        shareDefault: true,
        lastTestStatus: null,
        lastUsedAt: null,
        keyVersion: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any);
      encryption.decryptJson.mockReturnValue({ apiKey: 'sk-or-antiga' });
      repository.upsert.mockResolvedValue({} as any);

      await service.save('org-1', 'WORKSPACE', 'TEXT', {
        provider: 'openrouter',
        apiKey: '__REDACTED__',
      });

      expect(encryption.encryptJson).toHaveBeenCalledWith({
        apiKey: 'sk-or-antiga',
      });
    });

    it('deve recusar SENTINEL quando nao existe credencial previa', async () => {
      repository.findOne.mockResolvedValue(null);

      await expect(
        service.save('org-1', 'WORKSPACE', 'TEXT', {
          provider: 'openrouter',
          apiKey: '__REDACTED__',
        })
      ).rejects.toThrow(HttpException);
    });

    it('deve exigir profileId em scope PROFILE', async () => {
      await expect(
        service.save('org-1', 'PROFILE', 'TEXT', {
          provider: 'openrouter',
          apiKey: 'sk',
        })
      ).rejects.toThrow(HttpException);
    });

    it('deve validar options pelo schema do kind', async () => {
      await expect(
        service.save('org-1', 'WORKSPACE', 'IMAGE', {
          provider: 'openrouter',
          apiKey: 'sk',
          // temperature nao existe em ImageOptions
          options: { temperature: 0.5 } as any,
        })
      ).rejects.toThrow();
    });
  });

  describe('getRedacted', () => {
    it('deve retornar SENTINEL no apiKey e nao chamar decrypt', async () => {
      repository.findOne.mockResolvedValue({
        id: 'cred-1',
        scope: 'WORKSPACE',
        kind: 'TEXT',
        profileId: null,
        provider: 'openrouter',
        model: 'openai/gpt-5.5',
        fallbackModel: null,
        encryptedData: 'cipher',
        options: { temperature: 0.7 },
        shareDefault: true,
        lastTestStatus: 'ok',
        lastUsedAt: null,
        keyVersion: 1,
        createdAt: new Date(),
        updatedAt: new Date('2026-05-05T00:00:00Z'),
      } as any);

      const result = await service.getRedacted('org-1', 'WORKSPACE', 'TEXT');

      expect(result).toEqual(
        expect.objectContaining({
          apiKey: '__REDACTED__',
          provider: 'openrouter',
          model: 'openai/gpt-5.5',
          shareDefault: true,
          options: { temperature: 0.7 },
        })
      );
      expect(encryption.decryptJson).not.toHaveBeenCalled();
    });

    it('deve retornar null quando nao existe credencial', async () => {
      repository.findOne.mockResolvedValue(null);
      const result = await service.getRedacted('org-1', 'WORKSPACE', 'TEXT');
      expect(result).toBeNull();
    });
  });

  describe('getRaw', () => {
    it('deve decriptar e expor a apiKey real', async () => {
      repository.findOne.mockResolvedValue({
        id: 'cred-1',
        scope: 'WORKSPACE',
        kind: 'TEXT',
        profileId: null,
        provider: 'openrouter',
        model: null,
        fallbackModel: null,
        encryptedData: 'cipher',
        options: null,
        shareDefault: true,
      } as any);
      encryption.decryptJson.mockReturnValue({ apiKey: 'sk-or-real' });

      const result = await service.getRaw('org-1', 'WORKSPACE', 'TEXT');

      expect(result?.apiKey).toBe('sk-or-real');
      expect(encryption.decryptJson).toHaveBeenCalledWith('cipher');
    });
  });

  describe('test', () => {
    it('deve atualizar lastTestStatus=ok quando provider valida', async () => {
      repository.findOne.mockResolvedValue({
        id: 'cred-1',
        scope: 'WORKSPACE',
        kind: 'TEXT',
        profileId: null,
        provider: 'openrouter',
        model: null,
        fallbackModel: null,
        encryptedData: 'cipher',
        options: null,
        shareDefault: true,
      } as any);
      encryption.decryptJson.mockReturnValue({ apiKey: 'sk' });
      testService.test.mockResolvedValue({ ok: true });
      repository.updateMeta.mockResolvedValue({} as any);

      const result = await service.test('org-1', 'WORKSPACE', 'TEXT');

      expect(testService.test).toHaveBeenCalledWith(
        'openrouter',
        'sk',
        undefined,
        'TEXT'
      );
      expect(repository.updateMeta).toHaveBeenCalledWith('cred-1', {
        lastTestStatus: 'ok',
      });
      expect(result).toEqual({ ok: true });
    });

    it('deve atualizar lastTestStatus=failed quando provider rejeita', async () => {
      repository.findOne.mockResolvedValue({
        id: 'cred-1',
        scope: 'WORKSPACE',
        kind: 'TEXT',
        profileId: null,
        provider: 'openrouter',
        model: null,
        fallbackModel: null,
        encryptedData: 'cipher',
        options: null,
        shareDefault: true,
      } as any);
      encryption.decryptJson.mockReturnValue({ apiKey: 'sk' });
      testService.test.mockResolvedValue({ ok: false, error: '401' });
      repository.updateMeta.mockResolvedValue({} as any);

      const result = await service.test('org-1', 'WORKSPACE', 'TEXT');

      expect(repository.updateMeta).toHaveBeenCalledWith('cred-1', {
        lastTestStatus: 'failed',
      });
      expect(result).toEqual({ ok: false, error: '401' });
    });

    it('deve retornar erro descritivo quando credencial nao existe', async () => {
      repository.findOne.mockResolvedValue(null);

      const result = await service.test('org-1', 'WORKSPACE', 'TEXT');

      expect(result.ok).toBe(false);
      expect(testService.test).not.toHaveBeenCalled();
    });
  });

  describe('delete', () => {
    it('deve delegar ao repository', async () => {
      repository.delete.mockResolvedValue({ count: 1 } as any);
      await service.delete('org-1', 'WORKSPACE', 'TEXT');
      expect(repository.delete).toHaveBeenCalledWith(
        'org-1',
        'WORKSPACE',
        'TEXT',
        undefined
      );
    });
  });

  describe('markUsed', () => {
    it('deve atualizar lastUsedAt sem propagar erros', async () => {
      repository.updateMeta.mockResolvedValue({} as any);
      await expect(service.markUsed('cred-1')).resolves.toBeUndefined();
      expect(repository.updateMeta).toHaveBeenCalledWith(
        'cred-1',
        expect.objectContaining({
          lastUsedAt: expect.any(Date),
        })
      );
    });
  });
  it('validates compatible endpoints and requires an explicit model', async () => {
    await expect(
      service.save('org', 'WORKSPACE', 'TEXT', {
        provider: 'openai-compatible',
        apiKey: 'test',
        options: { baseURL: 'https://omni.example.com/v1' },
      })
    ).rejects.toThrow('modelo');
    await service.save('org', 'WORKSPACE', 'TEXT', {
      provider: 'openai-compatible',
      apiKey: 'test',
      model: 'cx/gpt-6-luna-low',
      options: { baseURL: 'https://omni.example.com/v1/' },
    });
    expect(repository.upsert).toHaveBeenCalledWith(
      'org',
      'WORKSPACE',
      'TEXT',
      expect.objectContaining({
        options: { baseURL: 'https://omni.example.com/v1' },
      }),
      undefined
    );
  });
  it.each([
    'http://localhost:8000/v1',
    'https://127.0.0.1/v1',
    'https://100.64.0.1/v1',
    'https://198.18.0.1/v1',
    'https://[::]/v1',
    'https://[fc01::1]/v1',
    'https://[fd12:3456::1]/v1',
    'https://[::ffff:7f00:1]/v1',
    'https://user:secret@example.com/v1',
    'https://example.com/v1?key=secret',
  ])('rejects unsafe endpoint %s', async (baseURL) => {
    await expect(
      service.save('org', 'WORKSPACE', 'TEXT', {
        provider: 'openai-compatible',
        model: 'model',
        apiKey: 'test',
        options: { baseURL },
      })
    ).rejects.toBeInstanceOf(HttpException);
    expect(repository.upsert).not.toHaveBeenCalled();
  });
  it('requires a new key before changing the credential destination', async () => {
    jest.spyOn(service, 'getRaw').mockResolvedValue({
      provider: 'openai',
      apiKey: 'existing-secret',
      options: null,
    } as any);
    await expect(
      service.save('org', 'WORKSPACE', 'TEXT', {
        provider: 'openai',
        model: 'model',
        apiKey: '__REDACTED__',
        options: { baseURL: 'https://omni.example.com/v1' },
      })
    ).rejects.toThrow('chave novamente');
    expect(repository.upsert).not.toHaveBeenCalled();
  });
  it.each([
    ['IMAGE', 'openai-compatible'],
    ['VIDEO', 'omni'],
    ['WEB_SEARCH', 'omni'],
  ])('saves a custom endpoint for %s', async (kind, provider) => {
    await service.save('org', 'WORKSPACE', kind as any, {
      provider,
      model: 'provider/model',
      apiKey: 'test-only',
      options: { baseURL: 'https://omni.example.com/v1' },
    });
    expect(repository.upsert).toHaveBeenCalledWith(
      'org',
      'WORKSPACE',
      kind,
      expect.objectContaining({
        provider,
        options: { baseURL: 'https://omni.example.com/v1' },
      }),
      undefined
    );
  });
  it('drops a conflicting reasoning option when the model already encodes its effort', async () => {
    await service.save('org', 'WORKSPACE', 'TEXT', {
      provider: 'openai-compatible',
      model: 'cx/gpt-6-luna-low',
      apiKey: 'test-only',
      options: {
        baseURL: 'https://omni.example.com/v1',
        reasoningEffort: 'high',
      },
    });
    expect(repository.upsert.mock.calls[0][3].options).not.toHaveProperty(
      'reasoningEffort'
    );
  });
});
