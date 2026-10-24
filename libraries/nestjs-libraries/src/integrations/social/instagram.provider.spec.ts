import 'reflect-metadata';
import { InstagramProvider } from './instagram.provider';

describe('InstagramProvider (flags)', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('declara noNativeRefresh pois o refreshToken e stub (Page token nao renova)', () => {
    // Consumido por IntegrationService.refreshTokens: sem esta flag o cron
    // em lote volta a desconectar canal saudavel por falso positivo.
    expect(new InstagramProvider().noNativeRefresh).toBe(true);
  });

  it('nao envia trial_params quando flag legada contem a string false', async () => {
    jest.useFakeTimers();
    const provider = new InstagramProvider();
    const fetchMock = jest
      .spyOn(provider, 'fetch')
      .mockResolvedValueOnce({
        json: async () => ({ id: 'creation-1' }),
      } as Response)
      .mockResolvedValueOnce({
        json: async () => ({ status_code: 'FINISHED' }),
      } as Response)
      .mockResolvedValueOnce({
        json: async () => ({ id: 'media-1' }),
      } as Response)
      .mockResolvedValueOnce({
        json: async () => ({ permalink: 'https://instagram.example/p/1' }),
      } as Response);

    const posting = provider.post(
      'ig-1',
      'token',
      [
        {
          id: 'post-1',
          message: 'Teste',
          media: [{ path: 'https://cdn.example/video.mp4' }],
          settings: {
            post_type: 'post',
            is_trial_reel: 'false',
          },
        },
      ] as any,
      {} as any
    );

    await jest.runAllTimersAsync();
    await posting;

    expect(String(fetchMock.mock.calls[0][0])).not.toContain('trial_params');
  });
});

describe('InstagramProvider.getMediaMetadata', () => {
  let provider: InstagramProvider;
  let originalFetch: typeof fetch;

  beforeEach(() => {
    provider = new InstagramProvider();
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.resetAllMocks();
  });

  it('deve montar URL com host recebido e fields essenciais', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: 'm-1', permalink: 'p', media_type: 'IMAGE' }),
    });
    global.fetch = fetchMock as any;

    await provider.getMediaMetadata('m-1', 'TOK', 'graph.facebook.com');

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('https://graph.facebook.com/v25.0/m-1?')
    );
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('thumbnail_url');
    expect(url).toContain('boost_eligibility_info'); // graph.facebook.com suporta
    expect(url).toContain('access_token=TOK');
  });

  it('deve marcar isAd=true quando eligible_to_boost=false', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        id: 'm-1',
        media_type: 'VIDEO',
        boost_eligibility_info: { eligible_to_boost: false },
      }),
    }) as any;

    const result = await provider.getMediaMetadata(
      'm-1',
      'TOK',
      'graph.facebook.com'
    );

    expect(result.isAd).toBe(true);
  });

  it('deve marcar isAd=false quando eligible_to_boost=true', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        id: 'm-1',
        media_type: 'VIDEO',
        boost_eligibility_info: { eligible_to_boost: true },
      }),
    }) as any;

    const result = await provider.getMediaMetadata('m-1', 'TOK');

    expect(result.isAd).toBe(false);
  });

  it('deve retornar isAd=undefined quando campo nao vem na resposta', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: 'm-1', media_type: 'IMAGE' }),
    }) as any;

    const result = await provider.getMediaMetadata('m-1', 'TOK');

    expect(result.isAd).toBeUndefined();
  });

  it('deve fazer fallback de thumbnailUrl pra media_url quando thumbnail_url ausente', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        id: 'm-1',
        media_type: 'IMAGE',
        media_url: 'https://cdn/image.jpg',
      }),
    }) as any;

    const result = await provider.getMediaMetadata('m-1', 'TOK');

    expect(result.thumbnailUrl).toBe('https://cdn/image.jpg');
  });

  it('deve preferir thumbnail_url quando ambos vem', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        id: 'm-1',
        media_type: 'VIDEO',
        media_url: 'https://cdn/video.mp4',
        thumbnail_url: 'https://cdn/thumb.jpg',
      }),
    }) as any;

    const result = await provider.getMediaMetadata('m-1', 'TOK');

    expect(result.thumbnailUrl).toBe('https://cdn/thumb.jpg');
  });

  it('deve lancar erro quando resposta nao-ok', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({
        error: { message: 'Object does not exist' },
      }),
    }) as any;

    await expect(provider.getMediaMetadata('bad-id', 'TOK')).rejects.toThrow(
      /HTTP 400/
    );
  });

  it('graph.instagram.com nao deve nem tentar boost_eligibility_info', async () => {
    // Documentacao Meta: o campo so existe em "Instagram API with Facebook Login"
    // (host graph.facebook.com). Em graph.instagram.com nem pedimos.
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        id: 'm-1',
        permalink: 'https://...',
        caption: 'ola',
        media_type: 'VIDEO',
        thumbnail_url: 'https://thumb',
      }),
    });
    global.fetch = fetchMock as any;

    const result = await provider.getMediaMetadata(
      'm-1',
      'TOK',
      'graph.instagram.com'
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).not.toContain('boost_eligibility_info');
    expect(result.isAd).toBeUndefined();
    expect(result.permalink).toBe('https://...');
  });

  it('graph.facebook.com retry defensive quando app type nao suporta o campo', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({
          error: {
            message:
              '(#100) Tried accessing nonexisting field (boost_eligibility_info) on node type (Media)',
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          id: 'm-1',
          permalink: 'https://...',
          caption: 'ola',
          media_type: 'VIDEO',
          thumbnail_url: 'https://thumb',
        }),
      });
    global.fetch = fetchMock as any;

    const result = await provider.getMediaMetadata(
      'm-1',
      'TOK',
      'graph.facebook.com'
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toContain('boost_eligibility_info');
    expect(fetchMock.mock.calls[1][0]).not.toContain('boost_eligibility_info');
    expect(result.isAd).toBeUndefined();
    expect(result.permalink).toBe('https://...');
  });

  it('nao deve fazer retry quando 400 eh por outro motivo', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({
        error: { message: 'Invalid OAuth access token' },
      }),
    });
    global.fetch = fetchMock as any;

    await expect(
      provider.getMediaMetadata('m-1', 'TOK', 'graph.instagram.com')
    ).rejects.toThrow(/Invalid OAuth/);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  // Smoke test apenas para garantir que pages() nao lanca quando fetch falha
  // (rede caida ou timeout). Garante que o catch global cobre a falha do
  // primeiro fetch para /me/accounts. Cobertura completa do budget de 90s e
  // dos timeouts individuais fica como divida tecnica.
  it('pages() retorna array (mesmo vazio) sem lancar quando fetch falha', async () => {
    const fetchMock = jest.fn().mockRejectedValue(new Error('Network down'));
    global.fetch = fetchMock as any;

    const result = await provider.pages('TOK');
    expect(Array.isArray(result)).toBe(true);
  });

  // Garante que erros do Meta no token exchange virem mensagens explicitas
  // em vez de TypeError obscuro ("Cannot read properties of undefined").
  it('authenticate() lanca mensagem explicita quando token exchange retorna erro', async () => {
    const fetchMock = jest.fn().mockResolvedValueOnce({
      json: async () => ({
        error: {
          message: 'Application request limit reached',
          type: 'OAuthException',
          code: 4,
        },
      }),
    });
    global.fetch = fetchMock as any;

    await expect(
      provider.authenticate({ code: 'CODE', codeVerifier: 'CV', refresh: '' })
    ).rejects.toThrow(/Meta token exchange failed/);
  });
});

describe('InstagramProvider Graph API v25', () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.resetAllMocks();
  });

  it('usa v25 nas duas consultas de analytics para ambos os hosts', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      json: async () => ({ data: [] as any[] }),
    });
    global.fetch = fetchMock as any;

    await new InstagramProvider().analytics(
      'ig-1',
      'TOK',
      7,
      undefined,
      'graph.instagram.com'
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const [url] of fetchMock.mock.calls) {
      expect(String(url)).toContain('graph.instagram.com/v25.0/ig-1/insights');
      expect(String(url)).not.toContain('/v21.0/');
    }
  });
});

describe('InstagramProvider.handleErrors', () => {
  let provider: InstagramProvider;

  beforeEach(() => {
    provider = new InstagramProvider();
  });

  it.each([460, 464])(
    'classifica Meta 190/%s como token que exige reconexao',
    (subcode) => {
      const body = JSON.stringify({
        error: {
          message: 'Error validating access token',
          type: 'OAuthException',
          code: 190,
          error_subcode: subcode,
        },
      });

      expect(provider.handleErrors(body, 400)).toEqual({
        type: 'refresh-token',
        value:
          'The connected Facebook user session is no longer valid, please reconnect the account',
      });
    }
  );

  it('mantem outros erros 190 como permissao insuficiente', () => {
    expect(
      provider.handleErrors('OAuthException 190, permissions', 400)
    ).toEqual({
      type: 'bad-body',
      value:
        'The account is missing some permissions to perform this action, please re-add the account and allow all permissions',
    });
  });
});

describe('InstagramProvider recent media readers', () => {
  const media = {
    id: 'media-1',
    media_type: 'IMAGE',
    caption: 'Caption',
    media_url: 'https://cdn.example/photo.jpg',
    timestamp: '2026-10-18T12:00:00+0000',
  };
  const response = (body: unknown, status = 200) =>
    ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    } as Response);
  let provider: InstagramProvider;
  let request: jest.SpyInstance;

  beforeEach(() => {
    provider = new InstagramProvider();
    request = jest.spyOn(global, 'fetch');
  });
  afterEach(() => jest.restoreAllMocks());

  const readers = [
    { method: 'getRecentMedia', edge: 'media' },
    { method: 'getRecentStories', edge: 'stories' },
  ] as const;

  describe.each(readers)('$method', ({ method, edge }) => {
    it.each([
      ['graph.facebook.com', 'page-token___user-token', 'user-token'],
      ['graph.facebook.com', 'page-token___', 'page-token'],
      ['graph.instagram.com', 'ig-token', 'ig-token'],
    ])('uses the correct token on %s', async (host, token, expectedToken) => {
      request.mockResolvedValue(response({ data: [media] }));

      const result = await provider[method]('ig-account', token, host);

      expect(request).toHaveBeenCalledTimes(1);
      const [input, options] = request.mock.calls[0];
      const url = new URL(String(input));
      expect(url.hostname).toBe(host);
      expect(url.pathname).toBe(`/v25.0/ig-account/${edge}`);
      expect(url.searchParams.get('access_token')).toBe(expectedToken);
      expect(url.searchParams.get('fields')).toContain('media_type');
      expect(options).toMatchObject({ redirect: 'error' });
      expect(options.signal).toBeInstanceOf(AbortSignal);
      expect(options.dispatcher).toBeDefined();
      expect('posts' in result ? result.posts : result.stories).toEqual([
        {
          id: 'media-1',
          mediaType: 'IMAGE',
          caption: 'Caption',
          mediaUrl: media.media_url,
          timestamp: media.timestamp,
        },
      ]);
      expect(JSON.stringify(result)).not.toContain('token');
    });

    it('keeps an explicitly empty data page valid', async () => {
      request.mockResolvedValue(response({ data: [] }));
      const result = await provider[method]('ig-account', 'secret-token');
      expect('posts' in result ? result.posts : result.stories).toEqual([]);
    });

    it.each([
      ['HTTP', { data: [] }, 403],
      [
        'Graph',
        { data: [], error: { message: 'secret-token provider-body' } },
        200,
      ],
      ['missing data', { unexpected: 'secret-token provider-body' }, 200],
      ['non-array data', { data: {} }, 200],
      ['null item', { data: [null] }, 200],
      ['missing identity', { data: [{ media_type: 'IMAGE' }] }, 200],
    ])('rejects %s without leaking provider data', async (_, body, status) => {
      request.mockResolvedValue(response(body, status as number));
      await expect(
        provider[method]('ig-account', 'secret-token')
      ).rejects.toEqual(new Error(`Could not retrieve Instagram ${edge}`));
      expect(request).toHaveBeenCalledTimes(1);
    });

    it('sanitizes network and JSON parse failures without retrying', async () => {
      request.mockRejectedValueOnce(new Error('secret-token provider-body'));
      await expect(
        provider[method]('ig-account', 'secret-token')
      ).rejects.toEqual(new Error(`Could not retrieve Instagram ${edge}`));
      request.mockResolvedValueOnce({
        ok: true,
        json: async () => {
          throw new Error('secret-token provider-body');
        },
      } as any);
      await expect(
        provider[method]('ig-account', 'secret-token')
      ).rejects.toEqual(new Error(`Could not retrieve Instagram ${edge}`));
      expect(request).toHaveBeenCalledTimes(2);
    });
  });

  it('encodes media cursors and does not follow paging next URLs', async () => {
    request.mockResolvedValue(
      response({
        data: [],
        paging: {
          next: 'https://do-not-follow.invalid/?access_token=secret',
          cursors: { after: 'next-safe' },
        },
      })
    );
    const cursor = 'cursor+/=&access_token=evil';
    const result = await provider.getRecentMedia(
      'ig-account',
      'page___user',
      'graph.facebook.com',
      50,
      cursor
    );
    const url = new URL(String(request.mock.calls[0][0]));
    expect(url.searchParams.get('after')).toBe(cursor);
    expect(url.searchParams.get('access_token')).toBe('user');
    expect(url.searchParams.getAll('access_token')).toEqual(['user']);
    expect(url.searchParams.get('limit')).toBe('50');
    expect(result.nextCursor).toBe('next-safe');
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('does not expose a terminal cursor when paging.next is absent', async () => {
    request.mockResolvedValue(
      response({ data: [], paging: { cursors: { after: 'terminal' } } })
    );
    await expect(
      provider.getRecentMedia('ig-account', 'token')
    ).resolves.toEqual({ posts: [], nextCursor: null });
  });

  it.each([undefined, '', 42, 'same'])(
    'rejects an invalid or repeated next cursor %s',
    async (cursor) => {
      request.mockResolvedValue(
        response({
          data: [],
          paging: { next: 'ignored', cursors: { after: cursor } },
        })
      );
      await expect(
        provider.getRecentMedia('ig-account', 'token', undefined, 25, 'same')
      ).rejects.toThrow('Could not retrieve Instagram media');
    }
  );
});

describe('InstagramProvider webhook account subscriptions', () => {
  const response = (body: unknown, status = 200) =>
    ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    } as Response);
  let provider: InstagramProvider;
  let request: jest.SpyInstance;
  let pageLookup: jest.SpyInstance;

  beforeEach(() => {
    provider = new InstagramProvider();
    request = jest.spyOn(global, 'fetch');
    pageLookup = jest
      .spyOn(provider, 'getPageIdForIgAccount')
      .mockResolvedValue('page-id');
  });
  afterEach(() => jest.restoreAllMocks());

  it.each([
    ['graph.facebook.com', 'page-id', 'messages'],
    ['graph.instagram.com', 'ig-id', 'comments,messages'],
  ])(
    'subscribes the correct object and fields for %s',
    async (host, objectId, fields) => {
      request
        .mockResolvedValueOnce(response({ data: [] }))
        .mockResolvedValueOnce(response({ success: true }));
      await expect(
        provider.ensureWebhookSubscription(
          'page-token___user-token',
          'ig-id',
          host,
          'app-id'
        )
      ).resolves.toBe(true);
      expect(request).toHaveBeenCalledTimes(2);
      const [input, options] = request.mock.calls[1];
      const url = new URL(String(input));
      expect(url.hostname).toBe(host);
      expect(url.pathname).toBe(`/v25.0/${objectId}/subscribed_apps`);
      expect(url.searchParams.get('subscribed_fields')).toBe(fields);
      expect(url.searchParams.get('access_token')).toBe('page-token');
      expect(options).toMatchObject({ method: 'POST', redirect: 'error' });
      expect(options.signal).toBeInstanceOf(AbortSignal);
      expect(options.dispatcher).toBeDefined();
      if (host === 'graph.facebook.com') {
        expect(pageLookup).toHaveBeenCalledWith('page-token', 'ig-id', host);
      } else {
        expect(pageLookup).not.toHaveBeenCalled();
      }
      expect(String(input)).not.toContain('callback');
      expect(String(input)).not.toContain('verify_token');
    }
  );

  it.each(['graph.facebook.com', 'graph.instagram.com'])(
    'checks subscription state on the correct object for %s',
    async (host) => {
      request.mockResolvedValue(
        response({ data: [{ id: 'app-id', subscribed_fields: ['messages'] }] })
      );
      await expect(
        provider.checkWebhookSubscription(
          'ig-id',
          'page-token___user-token',
          host,
          'app-id'
        )
      ).resolves.toEqual({ subscribed: true, fields: ['messages'] });
      const url = new URL(String(request.mock.calls[0][0]));
      expect(url.pathname).toBe(
        `/v25.0/${
          host === 'graph.facebook.com' ? 'page-id' : 'ig-id'
        }/subscribed_apps`
      );
      expect(url.searchParams.get('access_token')).toBe('page-token');
      expect(request.mock.calls[0][1]).toMatchObject({ redirect: 'error' });
    }
  );

  it('does not report a missing Facebook Page as an unsubscribed Instagram account', async () => {
    pageLookup.mockResolvedValue(null);
    await expect(
      provider.checkWebhookSubscription('ig-id', 'token', undefined, 'app-id')
    ).rejects.toEqual(
      new Error('Could not check Instagram webhook subscription')
    );
    await expect(
      provider.ensureWebhookSubscription('token', 'ig-id', undefined, 'app-id')
    ).rejects.toEqual(new Error('Could not subscribe to Instagram webhooks'));
    expect(request).not.toHaveBeenCalled();
  });

  it('keeps a valid empty Page subscription list empty', async () => {
    request.mockResolvedValue(response({ data: [] }));
    await expect(
      provider.checkWebhookSubscription('ig-id', 'token', undefined, 'app-id')
    ).resolves.toEqual({ subscribed: false, fields: [] });
  });

  it.each([
    ['HTTP', { success: true }, 403],
    ['Graph', { error: { message: 'secret-token provider-body' } }, 200],
    ['malformed', { unexpected: 'secret-token provider-body' }, 200],
    ['rejected', { success: false }, 200],
  ])(
    'rejects %s subscription failures without retry or provider data',
    async (_, body, status) => {
      request
        .mockResolvedValueOnce(response({ data: [] }))
        .mockResolvedValueOnce(response(body, status as number));
      await expect(
        provider.ensureWebhookSubscription(
          'secret-token',
          'ig-id',
          'graph.instagram.com',
          'app-id'
        )
      ).rejects.toEqual(new Error('Could not subscribe to Instagram webhooks'));
      expect(request).toHaveBeenCalledTimes(2);
    }
  );

  it('does not retry an uncertain subscription result', async () => {
    request
      .mockResolvedValueOnce(response({ data: [] }))
      .mockRejectedValueOnce(new Error('secret-token timeout provider-body'));
    await expect(
      provider.ensureWebhookSubscription(
        'secret-token',
        'ig-id',
        'graph.instagram.com',
        'app-id'
      )
    ).rejects.toEqual(new Error('Could not subscribe to Instagram webhooks'));
    expect(request).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['HTTP', { data: [] }, 403],
    [
      'Graph',
      { data: [], error: { message: 'secret-token provider-body' } },
      200,
    ],
    ['missing data', {}, 200],
    [
      'invalid fields',
      { data: [{ id: 'app-id', subscribed_fields: 'comments' }] },
      200,
    ],
    ['unknown fields', { data: [{ id: 'app-id' }] }, 200],
  ])(
    'rejects %s check failures without provider data',
    async (_, body, status) => {
      request.mockResolvedValue(response(body, status as number));
      await expect(
        provider.checkWebhookSubscription(
          'ig-id',
          'secret-token',
          'graph.instagram.com',
          'app-id'
        )
      ).rejects.toEqual(
        new Error('Could not check Instagram webhook subscription')
      );
      expect(request).toHaveBeenCalledTimes(1);
    }
  );
});

describe('InstagramProvider shared app subscription preservation', () => {
  afterEach(() => jest.restoreAllMocks());

  it('unions the existing Chatwoot fields before subscribing without touching callbacks', async () => {
    const provider = new InstagramProvider();
    jest.spyOn(provider, 'getPageIdForIgAccount').mockResolvedValue('page-id');
    const existing = ['feed', 'message_reads', 'messaging_postbacks'];
    const request = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [{ id: 'app-id', subscribed_fields: existing }],
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      } as Response);

    await expect(
      provider.ensureWebhookSubscription(
        'page-token',
        'ig-id',
        undefined,
        'app-id'
      )
    ).resolves.toBe(true);

    expect(request).toHaveBeenCalledTimes(2);
    const read = new URL(String(request.mock.calls[0][0]));
    expect(read.searchParams.get('fields')).toBe('id,subscribed_fields');
    const mutation = new URL(String(request.mock.calls[1][0]));
    expect(mutation.searchParams.get('subscribed_fields')?.split(',')).toEqual([
      ...existing,
      'messages',
    ]);
    expect(mutation.searchParams.has('callback_url')).toBe(false);
    expect(mutation.searchParams.has('verify_token')).toBe(false);
  });

  it('does not mutate a Page subscription that already has messages', async () => {
    const provider = new InstagramProvider();
    jest.spyOn(provider, 'getPageIdForIgAccount').mockResolvedValue('page-id');
    const request = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          {
            id: 'app-id',
            subscribed_fields: ['messages'],
          },
        ],
      }),
    } as Response);

    await expect(
      provider.ensureWebhookSubscription(
        'page-token',
        'ig-id',
        undefined,
        'app-id'
      )
    ).resolves.toBe(true);

    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][1]?.method).not.toBe('POST');
  });

  it('does not mutate when existing fields cannot be read safely', async () => {
    const provider = new InstagramProvider();
    jest.spyOn(provider, 'getPageIdForIgAccount').mockResolvedValue('page-id');
    const request = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      json: async () => ({ error: { message: 'provider-body' } }),
    } as Response);

    await expect(
      provider.ensureWebhookSubscription(
        'page-token',
        'ig-id',
        undefined,
        'app-id'
      )
    ).rejects.toEqual(new Error('Could not subscribe to Instagram webhooks'));

    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][1]?.method).not.toBe('POST');
  });
});

describe('InstagramProvider subscription app identity', () => {
  afterEach(() => jest.restoreAllMocks());

  it('does not consider a different app sufficient or copy its fields', async () => {
    const provider = new InstagramProvider();
    jest.spyOn(provider, 'getPageIdForIgAccount').mockResolvedValue('page-id');
    const request = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [
            {
              id: 'other-app',
              subscribed_fields: ['feed', 'messages', 'leadgen'],
            },
            {
              id: 'app-id',
              subscribed_fields: ['messaging_postbacks'],
            },
          ],
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      } as Response);

    await expect(
      provider.ensureWebhookSubscription(
        'page-token',
        'ig-id',
        undefined,
        'app-id'
      )
    ).resolves.toBe(true);

    expect(request).toHaveBeenCalledTimes(2);
    const mutation = new URL(String(request.mock.calls[1][0]));
    expect(mutation.searchParams.get('subscribed_fields')?.split(',')).toEqual([
      'messaging_postbacks',
      'messages',
    ]);
  });

  it('fails closed when the app identity is unavailable', async () => {
    const request = jest
      .spyOn(global, 'fetch')
      .mockRejectedValue(new Error('Network disabled in test'));
    const provider = new InstagramProvider();
    jest.spyOn(provider, 'getPageIdForIgAccount').mockResolvedValue('page-id');
    await expect(
      provider.ensureWebhookSubscription('page-token', 'ig-id')
    ).rejects.toEqual(new Error('Could not subscribe to Instagram webhooks'));
    expect(request).not.toHaveBeenCalled();
  });

  it('does not reset fields when the current app may be on a subsequent page', async () => {
    const provider = new InstagramProvider();
    jest.spyOn(provider, 'getPageIdForIgAccount').mockResolvedValue('page-id');
    const request = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [{ id: 'other-app', subscribed_fields: ['messages'] }],
        paging: { next: 'https://do-not-follow.invalid/' },
      }),
    } as Response);

    await expect(
      provider.ensureWebhookSubscription(
        'page-token',
        'ig-id',
        undefined,
        'app-id'
      )
    ).rejects.toEqual(new Error('Could not subscribe to Instagram webhooks'));
    expect(request).toHaveBeenCalledTimes(1);
  });
});

describe('InstagramProvider.pages usernames', () => {
  it('returns the Instagram username for account search without tokens', async () => {
    const mockFetch = jest
      .spyOn(global, 'fetch')
      .mockImplementation(async (input) => {
      const url = String(input);
      const data = url.includes('/me/accounts?')
        ? { data: [
                { id: 'page-1', instagram_business_account: { id: 'ig-1' } },
              ],
            }
        : url.includes('/me/businesses?')
        ? { data: [] }
        : { id: 'ig-1', name: 'Grupo Mali', username: 'grupomalioficial', profile_picture_url: 'https://example.com/avatar.jpg',
            };
      return { json: async () => data } as Response;
    });
    try {
      expect(await new InstagramProvider().pages('test-token')).toEqual([
        {
          pageId: 'page-1', id: 'ig-1', name: 'Grupo Mali', username: 'grupomalioficial',
        picture: { data: { url: 'https://example.com/avatar.jpg' } },
        },
      ]);
      expect(String(mockFetch.mock.calls[2][0])).toContain(
        'fields=name,username,profile_picture_url'
      );
    } finally {
      mockFetch.mockRestore();
    }
  });
});

describe('InstagramProvider account discovery performance', () => {
  const account = (id: string) => ({ id, name: `Account ${id}`, username: `account${id}`, profile_picture_url: 'https://example.com/avatar.jpg',
  });
  const page = (index: number) => ({
    id: `page-${index}`,
    instagram_business_account: account(`ig-${index}`),
  });
  let request: jest.SpyInstance;
  beforeEach(() => { request = jest.spyOn(global, 'fetch'); });
  afterEach(() => { request.mockRestore(); jest.useRealTimers(); });

  it('uses expanded account details without requesting every Instagram again', async () => {
    request.mockImplementation(async (input) => ({ json: async () => String(input).includes('/me/accounts?') ? { data: [page(1)] } : { data: [] as unknown[] },
    }));
    const result = await new InstagramProvider().pages('test-token');
    expect(result).toEqual([
      {
        pageId: 'page-1', id: 'ig-1', name: 'Account ig-1', username: 'accountig-1', picture: { data: { url: 'https://example.com/avatar.jpg' } },
      },
    ]);
    expect(request).toHaveBeenCalledTimes(2);
    expect(
      new URL(String(request.mock.calls[0][0])).searchParams.get('fields')
    ).toContain(
      'instagram_business_account{id,name,username,profile_picture_url}'
    );
  });

  it('discovers all 47 businesses with four concurrent reads and no duplicate accounts', async () => {
    jest.useFakeTimers({ now: 0 });
    let active = 0; let peak = 0;
    request.mockImplementation(async (input) => {
      const url = new URL(String(input));
      active++; peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 100));
      active--;
      const data = url.pathname.endsWith('/me/accounts') ? []
        : url.pathname.endsWith('/me/businesses') ? Array.from({ length: 47 }, (_, i) => ({ id: `business-${i}` }))
        : /\/(owned_pages|client_pages)$/.test(url.pathname) ? [page(Number(url.pathname.match(/business-(\d+)/)![1]) % 33)]
        : account(url.pathname.split('/').pop()!);
      return { json: async () => (Array.isArray(data) ? { data } : data) };
    });
    const pending = new InstagramProvider().pages('test-token');
    await jest.runAllTimersAsync();
    const result = await pending;
    expect(result).toHaveLength(33);
    expect(new Set(result.map((item) => item.id)).size).toBe(33);
    expect(Date.now()).toBe(2600);
    expect(peak).toBe(4);
    expect(request).toHaveBeenCalledTimes(96);
  });

  it('reconnects an authorized account without scanning unrelated businesses', async () => {
    request.mockImplementation(async (input) => ({ json: async () => String(input).includes('/me/accounts?') ? { data: [page(1), page(2)] } : { data: [] as unknown[] },
    }));
    const provider = new InstagramProvider();
    const information = jest
      .spyOn(provider, 'fetchPageInformation')
      .mockResolvedValue({
        id: 'ig-2',
        name: 'Target',
        access_token: 'page-token',
        picture: 'avatar',
        username: 'target',
      } as any);
    const result = await provider.reConnect('user-id', 'ig-2', 'test-token');
    expect(information).toHaveBeenCalledWith('test-token', { id: 'ig-2', pageId: 'page-2',
    });
    expect(result.accessToken).toBe('page-token');
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('does not fetch a page token when the required account is absent', async () => {
    request.mockResolvedValue({ json: async () => ({ data: [] as unknown[] }),
    });
    const provider = new InstagramProvider();
    const information = jest.spyOn(provider, 'fetchPageInformation');
    await expect(
      provider.reConnect('user-id', 'missing', 'test-token')
    ).rejects.toThrow(
      'Instagram account is not available in this authorization'
    );
    expect(information).not.toHaveBeenCalled();
  });

  it('keeps pagination and other businesses when one business edge is unavailable', async () => {
    request.mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('business-b/owned_pages')) throw new Error('Unavailable');
      const body = url.includes('/me/accounts?') ? { data: [] as unknown[], paging: { next: 'https://graph.facebook.com/v25.0/next-accounts' },
          }
        : url.includes('/next-accounts') ? { data: [page(1)] }
        : url.includes('/me/businesses?') ? { data: [{ id: 'business-b' }] }
        : url.includes('business-b/client_pages') ? { data: [page(2)] }
        : account('ig-1');
      return { json: async () => body };
    });
    const result = await new InstagramProvider().pages('test-token');
    expect(result.map((item) => item.id).sort()).toEqual(['ig-1', 'ig-2']);
  });
});

describe('Instagram account metadata fallback deadline', () => {
  it('does not start metadata batches after exhausting the discovery budget', async () => {
    jest.useFakeTimers({ now: 0 });
    const started: number[] = [];
    const request = jest
      .spyOn(global, 'fetch')
      .mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/me/accounts?')) return { json: async () => ({ data: Array.from({ length: 33 }, (_, i) => ({ id: `page-${i}`, instagram_business_account: { id: `ig-${i}` },
              })),
            }),
          } as Response;
      if (url.includes('/me/businesses?')) return { json: async () => ({ data: [] as unknown[] }) } as Response;
      started.push(Date.now());
      await new Promise((resolve) => setTimeout(resolve, 15000));
      throw new Error('Metadata unavailable');
    });
    try {
      const pending = new InstagramProvider().pages('test-token');
      await jest.runAllTimersAsync();
      await pending;
      expect(started).toHaveLength(24);
      expect(started.every((time) => time < 90000)).toBe(true);
      expect(Date.now()).toBe(90000);
    } finally { request.mockRestore(); jest.useRealTimers(); }
  });
});

describe('Instagram discovery throttling', () => {
  it('stops the scan on a Meta rate limit instead of returning an incomplete list', async () => {
    const request = jest
      .spyOn(global, 'fetch')
      .mockImplementation(async (input) => {
      const url = String(input);
      const body = url.includes('/me/accounts?') ? { data: [
                {
                  id: 'page-1',
                  instagram_business_account: {
                    id: 'ig-1',
                    name: 'One',
                    username: 'one',
                  },
                },
              ],
            }
        : url.includes('/me/businesses?') ? { data: Array.from({ length: 47 }, (_, i) => ({ id: `business-${i}`,
              })),
            }
        : { error: { code: 4, message: 'Should never expose provider data test-token',
              },
            };
      return { status: 200, json: async () => body } as Response;
    });
    try {
      await expect(
        new InstagramProvider().pages('test-token')
      ).rejects.toMatchObject({
        status: 429,
        response: { code: 'PROVIDER_RATE_LIMIT' },
      });
      expect(request.mock.calls.length).toBeLessThanOrEqual(6);
    } finally { request.mockRestore(); }
  });
});

describe('Instagram discovery quota response formats', () => {
  it('recognizes HTTP 429 even when the body is empty or HTML', async () => {
    const json = jest.fn().mockRejectedValue(new Error('Invalid JSON'));
    const request = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue({ status: 429, json } as any);
    try {
      await expect(
        new InstagramProvider().pages('test-token')
      ).rejects.toMatchObject({ status: 429 });
      expect(json).not.toHaveBeenCalled();
      expect(request).toHaveBeenCalledTimes(1);
    } finally { request.mockRestore(); }
  });
  it.each([80001, 80002])(
    'recognizes Page and Instagram quota code %s', async (code) => {
    const request = jest
        .spyOn(global, 'fetch')
        .mockResolvedValue({
          status: 400,
          json: async () => ({ error: { code } }),
        } as any);
      try {
        await expect(
          new InstagramProvider().pages('test-token')
        ).rejects.toMatchObject({ status: 429 });
        expect(request).toHaveBeenCalledTimes(1);
      } finally {
        request.mockRestore();
      }
    }
  );
});

describe('InstagramProvider account selection identity', () => {
  let originalFetch: typeof global.fetch;
  beforeEach(() => {
    originalFetch = global.fetch;
  });
  afterEach(() => {
    global.fetch = originalFetch;
  });
  const selection = { id: '123', pageId: '456' };
  const valid = {
    access_token: 'PAGE',
    instagram_business_account: {
      id: '123',
      name: 'Account',
      username: 'account',
      profile_picture_url: 'avatar',
    },
  };
  it('derives the token and account from the selected Page in one bounded request', async () => {
    const request = jest
      .fn()
      .mockResolvedValue({ ok: true, status: 200, json: async () => valid });
    global.fetch = request;
    expect(
      await new InstagramProvider().fetchPageInformation('USER', selection)
    ).toEqual({
      id: '123',
      name: 'Account',
      username: 'account',
      picture: 'avatar',
      access_token: 'PAGE___USER',
    });
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][1].signal).toBeDefined();
  });
  it('rejects a forged association between a Page and another Instagram', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue({ ok: true, status: 200, json: async () => valid });
    await expect(
      new InstagramProvider().fetchPageInformation('USER', {
        ...selection,
        id: '999',
      })
    ).rejects.toMatchObject({ status: 400 });
  });
  it.each([
    ['bad/identity', '456'],
    ['123', '456?token=secret'],
  ])(
    'rejects malformed identifiers before a provider request',
    async (id, pageId) => {
      global.fetch = jest.fn();
      await expect(
        new InstagramProvider().fetchPageInformation('USER', { id, pageId })
      ).rejects.toMatchObject({ status: 400 });
      expect(global.fetch).not.toHaveBeenCalled();
    }
  );
  it.each([
    [190, 412],
    [4, 429],
    [17, 429],
    [80002, 429],
  ])('sanitizes provider error %s to status %s', async (code, status) => {
    global.fetch = jest
      .fn()
      .mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({ error: { code, message: 'token=SECRET' } }),
      });
    await expect(
      new InstagramProvider().fetchPageInformation('USER', selection)
    ).rejects.toMatchObject({ status });
  });
});


describe('InstagramProvider combined credentials', () => {
  afterEach(() => jest.restoreAllMocks());

  it.each(['PAGE', 'PAGE___USER'])('uses only the Page token for analytics, music and metadata: %s', async (token) => {
    const provider = new InstagramProvider();
    const response = { ok: true, json: async () => ({ data: [], id: '123', media_type: 'IMAGE' }) } as Response;
    const analytics = jest.spyOn(provider as any, 'analyticsFetch').mockResolvedValue(response);
    const music = jest.spyOn(provider, 'fetch').mockResolvedValue(response);
    const metadata = jest.spyOn(global, 'fetch').mockResolvedValue(response);
    await provider.analytics('123', token, 7);
    await provider.music(token, { q: 'track' });
    await provider.getMediaMetadata('123', token);
    for (const call of [...analytics.mock.calls, ...music.mock.calls, ...metadata.mock.calls]) {
      expect(new URL(String(call[0])).searchParams.get('access_token')).toBe('PAGE');
    }
    expect(analytics).toHaveBeenCalledTimes(2);
    expect(music).toHaveBeenCalledTimes(1);
    expect(metadata).toHaveBeenCalledTimes(1);
  });
});
