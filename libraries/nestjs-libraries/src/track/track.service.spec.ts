import { TrackService } from './track.service';
import { TrackEnum } from '../user/track.enum';

describe('TrackService upstream compatibility', () => {
  const original = { ...process.env };
  afterEach(() => {
    process.env = { ...original };
    jest.restoreAllMocks();
  });
  it('does not send anything when tracking is not configured', async () => {
    delete process.env.FACEBOOK_PIXEL_ACCESS_TOKEN;
    const fetch = jest.spyOn(global, 'fetch');
    await new TrackService().track(
      'event',
      'ip',
      'agent',
      TrackEnum.Purchase,
      {}
    );
    expect(fetch).not.toHaveBeenCalled();
  });
  it('contains a provider failure and keeps the request token out of its URL', async () => {
    process.env.FACEBOOK_PIXEL_ACCESS_TOKEN = 'test-token';
    process.env.NEXT_PUBLIC_FACEBOOK_PIXEL = '123';
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const fetch = jest
      .spyOn(global, 'fetch')
      .mockRejectedValue(new Error('network unavailable'));
    await expect(
      new TrackService().track('event', 'ip', 'agent', TrackEnum.Purchase, {})
    ).resolves.toBeUndefined();
    expect(fetch.mock.calls[0][0]).not.toContain('test-token');
    expect(fetch.mock.calls[0][1]?.signal).toBeDefined();
  });
  it('sends normalized hashed email and stable conversion event identity', async () => {
    process.env.FACEBOOK_PIXEL_ACCESS_TOKEN = 'test-token';
    process.env.NEXT_PUBLIC_FACEBOOK_PIXEL = '123';
    const cancel = jest.fn();
    const fetch = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue({ ok: true, body: { cancel } } as any);
    await new TrackService().track(
      'invoice-1',
      'ip',
      'agent',
      TrackEnum.Purchase,
      { value: 10, currency: 'brl' },
      'fb.1.1.click',
      { email: ' TEST@EXAMPLE.COM ' } as any,
      'fb.1.1.browser'
    );
    const data = JSON.parse(fetch.mock.calls[0][1]?.body as string).data[0];
    expect(data.event_id).toBe('invoice-1');
    expect(data.user_data.em[0]).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(data)).not.toContain('TEST@');
    expect(data.custom_data).toEqual({ value: 10, currency: 'BRL' });
    expect(cancel).toHaveBeenCalled();
  });
});
