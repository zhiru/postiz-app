import { InstagramProvider } from './instagram.provider';
import { InstagramStandaloneProvider } from './instagram.standalone.provider';

describe('Instagram comments synchronization', () => {
  const response = (body: any) => ({ json: async () => body } as Response);
  const item = (id: string) => ({
    id,
    text: 'Quero',
    timestamp: '2026-10-19T12:00:00Z',
    from: { id: 'author-1', username: 'author' },
  });
  afterEach(() => jest.restoreAllMocks());
  it('reads paginated comments and expanded replies using fixed-host cursors and the correct token half', async () => {
    const provider = new InstagramProvider();
    const fetch = jest
      .spyOn(provider as any, 'fetch')
      .mockResolvedValueOnce(
        response({
          data: [{ ...item('1'), replies: { data: [item('2')] } }],
          paging: {
            next: 'https://untrusted.invalid/?access_token=secret',
            cursors: { after: 'page-2' },
          },
        })
      )
      .mockResolvedValueOnce(response({ data: [item('3')] }));
    const comments = await provider.listComments(
      'page-token___user-token',
      'media-1',
      {} as any
    );
    expect(comments.map((comment) => comment.id)).toEqual(['1', '2', '3']);
    expect(comments[1].parentId).toBe('1');
    const urls = fetch.mock.calls.map(([url]) => new URL(url as string));
    expect(urls[0].pathname).toMatch(/media-1\/comments$/);
    expect(urls[1].searchParams.get('after')).toBe('page-2');
    expect(
      urls.every(
        (url) =>
          url.hostname === 'graph.facebook.com' &&
          url.searchParams.get('access_token') === 'page-token'
      )
    ).toBe(true);
  });
  it('rejects malformed or repeated paging and provider errors instead of treating them as no comments', async () => {
    const provider = new InstagramProvider();
    const fetch = jest
      .spyOn(provider as any, 'fetch')
      .mockResolvedValue(response({ error: { message: 'expired' } }));
    await expect(
      provider.listComments('token', 'media', {} as any)
    ).rejects.toThrow('Invalid comments response');
    fetch.mockResolvedValue(
      response({
        data: [],
        paging: { next: 'ignored', cursors: { after: 'same' } },
      })
    );
    await expect(
      provider.listComments('token', 'media', {} as any)
    ).rejects.toThrow('Invalid comments cursor');
  });
  it('supports standalone Instagram on its own Graph host', async () => {
    const fetch = jest
      .spyOn(InstagramProvider.prototype as any, 'fetch')
      .mockResolvedValue(response({ data: [] }));
    await new InstagramStandaloneProvider().listComments(
      'ig-token',
      'media',
      {} as any
    );
    expect(new URL(fetch.mock.calls[0][0] as string).hostname).toBe(
      'graph.instagram.com'
    );
  });
  it('returns resumable chunks for histories longer than fifty pages', async () => {
    const provider = new InstagramProvider();
    let count = 0;
    const fetch = jest
      .spyOn(provider as any, 'fetch')
      .mockImplementation(async () => {
        const index = ++count;
        return response({
          data: [item(String(index))],
          ...(index < 55
            ? {
                paging: {
                  next: 'ignored',
                  cursors: { after: `page-${index + 1}` },
                },
              }
            : {}),
        });
      });
    const ids: string[] = [];
    let cursor: string | undefined;
    do {
      const before = fetch.mock.calls.length;
      const page = await provider.listCommentsPage(
        'token',
        'media',
        {} as any,
        cursor
      );
      expect(fetch.mock.calls.length - before).toBeLessThanOrEqual(10);
      ids.push(...page.comments.map((comment) => comment.id));
      cursor = page.nextCursor;
    } while (cursor);
    expect(ids).toHaveLength(55);
    expect(new Set(ids).size).toBe(55);
  });  it('reads post metrics with the page-token half in a header and a bounded timeout', async () => {
    const provider = new InstagramProvider();
    const fetch = jest.spyOn(provider as any, 'analyticsFetch').mockResolvedValue(response({ data: [{ name: 'likes', values: [{ value: 4 }] }] }));
    const metrics = await provider.postAnalytics('account', 'page-token___user-token', 'media', 7);
    const [url, options] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).not.toContain('page-token'); expect(url).not.toContain('user-token');
    expect(options.headers).toEqual({ Authorization: 'Bearer page-token' });
    expect(options.signal).toBeTruthy();
    expect(metrics[0]).toMatchObject({ label: 'Likes', data: [{ total: '4' }] });
  });

});
