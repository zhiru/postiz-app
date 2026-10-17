import { InstagramProvider } from './instagram.provider';
import { InstagramStandaloneProvider } from './instagram.standalone.provider';

describe('Instagram published media import', () => {
  const media = {
    id: 'media1',
    caption: 'Caption',
    timestamp: '2026-10-16T21:00:00+0000',
    permalink: 'https://www.instagram.com/p/example/',
    media_type: 'IMAGE',
    media_url: 'https://example.com/photo.jpg',
  };
  const response = (data: any) => ({ json: async () => data } as Response);

  it('uses the supported fields and cursor without following provider next URLs', async () => {
    const provider = new InstagramProvider();
    const fetch = jest.spyOn(provider as any, 'fetch').mockResolvedValue(
      response({
        data: [media],
        paging: {
          next: 'https://do-not-follow.invalid/?access_token=secret',
          cursors: { after: 'page-2' },
        },
      })
    );
    const page = await provider.listPublishedPosts(
      'profile-id',
      'page-token___user-token',
      'page-1'
    );
    const url = new URL(fetch.mock.calls[0][0] as string);
    expect(url.hostname).toBe('graph.facebook.com');
    expect(url.searchParams.get('after')).toBe('page-1');
    expect(url.searchParams.get('access_token')).toBe('user-token');
    expect(page.nextCursor).toBe('page-2');
    expect(page.posts[0]).toMatchObject({
      id: 'media1',
      content: 'Caption',
      media: [{ id: 'media1', path: media.media_url }],
    });
    expect(JSON.stringify(page)).not.toContain('user-token');
  });

  it('supports standalone login through the same adapter', async () => {
    const fetch = jest
      .spyOn(InstagramProvider.prototype as any, 'fetch')
      .mockResolvedValue(response({ data: [media] }));
    try {
      await new InstagramStandaloneProvider().listPublishedPosts(
        'profile-id',
        'ig-token'
      );
      expect(new URL(fetch.mock.calls[0][0] as string).hostname).toBe(
        'graph.instagram.com'
      );
    } finally {
      fetch.mockRestore();
    }
  });

  it('imports carousel children including a paginated expanded edge', async () => {
    const provider = new InstagramProvider();
    const fetch = jest
      .spyOn(provider as any, 'fetch')
      .mockResolvedValueOnce(
        response({
          data: [
            {
              ...media,
              media_type: 'CAROUSEL_ALBUM',
              children: { data: [{ id: 'a' }], paging: { next: 'ignored' } },
            },
          ],
        })
      )
      .mockResolvedValueOnce(
        response({
          data: [{ id: 'a', media_url: 'https://example.com/a.jpg' }],
          paging: { next: 'ignored', cursors: { after: 'b' } },
        })
      )
      .mockResolvedValueOnce(
        response({
          data: [
            {
              id: 'b',
              media_url: 'https://example.com/b.mp4',
              thumbnail_url: 'https://example.com/b.jpg',
            },
          ],
        })
      );
    const page = await provider.listPublishedPosts('profile-id', 'token');
    expect(page.posts[0].media).toHaveLength(2);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('fails invalid dates and repeated cursors instead of marking the history complete', async () => {
    const provider = new InstagramProvider();
    const fetch = jest
      .spyOn(provider as any, 'fetch')
      .mockResolvedValueOnce(
        response({ data: [{ ...media, timestamp: 'invalid' }] })
      );
    await expect(
      provider.listPublishedPosts('profile', 'token')
    ).rejects.toThrow('publication date');
    fetch.mockResolvedValueOnce(
      response({
        data: [],
        paging: { next: 'ignored', cursors: { after: 'same' } },
      })
    );
    await expect(
      provider.listPublishedPosts('profile', 'token', 'same')
    ).rejects.toThrow('Invalid media cursor');
  });
});
