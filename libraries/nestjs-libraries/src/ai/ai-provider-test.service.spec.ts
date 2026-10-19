import { AiProviderTestService } from './ai-provider-test.service';

describe('Compatible AI provider connection test', () => {
  const service = new AiProviderTestService();
  afterEach(() => jest.restoreAllMocks());

  it('checks models on the configured endpoint without generation or redirects', async () => {
    const request = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue({ ok: true } as Response);
    expect(
      await service.test(
        'openai-compatible',
        'demo-key',
        'https://omni.example.com/v1/'
      )
    ).toEqual({ ok: true });
    expect(request).toHaveBeenCalledWith(
      'https://omni.example.com/v1/models',
      expect.objectContaining({
        headers: { Authorization: 'Bearer demo-key' },
        redirect: 'error',
        signal: expect.anything(),
      })
    );
  });

  it('blocks a private literal before dispatch and hides credential-bearing errors', async () => {
    const request = jest
      .spyOn(global, 'fetch')
      .mockRejectedValue(new Error('demo-secret-token'));
    expect(
      await service.test(
        'openai-compatible',
        'demo-key',
        'https://[fd12::1]/v1'
      )
    ).toEqual({
      ok: false,
      error: expect.not.stringContaining('demo-secret-token'),
    });
    expect(request).not.toHaveBeenCalled();
    expect(
      await service.test(
        'openai-compatible',
        'demo-key',
        'https://omni.example.com/v1'
      )
    ).toEqual({
      ok: false,
      error: expect.not.stringContaining('demo-secret-token'),
    });
  });
});
