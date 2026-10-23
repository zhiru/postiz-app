import 'reflect-metadata';
import { InstagramStandaloneProvider } from './instagram.standalone.provider';

describe('InstagramStandaloneProvider Graph API', () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.resetAllMocks();
  });

  it('consulta /me pela Graph v25 depois de renovar o token', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({
        json: async () => ({ access_token: 'NEW_TOKEN' }),
      })
      .mockResolvedValueOnce({
        json: async () => ({
          user_id: 'ig-1',
          name: 'Conta',
          username: 'conta',
          profile_picture_url: 'https://cdn/avatar.jpg',
        }),
      });
    global.fetch = fetchMock as any;

    const result = await new InstagramStandaloneProvider().refreshToken(
      'OLD_TOKEN'
    );

    expect(String(fetchMock.mock.calls[1][0])).toContain(
      'graph.instagram.com/v25.0/me'
    );
    expect(result.accessToken).toBe('NEW_TOKEN');
  });
});

describe('InstagramStandaloneProvider media validation', () => {
  const provider = new InstagramStandaloneProvider();

  it('rejects invalid Stories and collaborator settings before publishing', async () => {
    await expect(
      provider.checkValidity([[{ path: 'a.jpg' }, { path: 'b.jpg' }]], {
        post_type: 'story',
      })
    ).resolves.toMatch(/one media/i);
    await expect(
      provider.checkValidity([[{ path: 'a.jpg' }]], {
        post_type: 'story',
        collaborators: [{ label: '@partner' }],
      })
    ).resolves.toMatch(/collaborators/i);
  });

  it('applies feed dimensions and Reel limits while accepting valid media', async () => {
    const image = {
      path: 'a.jpg',
      content_type: 'image/jpeg',
      width: 1080,
      height: 1350,
    };
    await expect(
      provider.checkValidity([[image]], { post_type: 'post' })
    ).resolves.toBe(true);
    await expect(
      provider.checkValidity([[{ ...image, height: 1920 }]], {
        post_type: 'post',
      })
    ).resolves.toMatch(/aspect ratio/i);
    await expect(
      provider.checkValidity(
        [
          [
            {
              path: 'a.mp4',
              content_type: 'video/mp4',
              width: 1080,
              height: 1920,
              video_codec: 'h264',
              duration_seconds: 901,
            },
          ],
        ],
        { post_type: 'post' }
      )
    ).resolves.toMatch(/Reels duration/i);
  });
});
