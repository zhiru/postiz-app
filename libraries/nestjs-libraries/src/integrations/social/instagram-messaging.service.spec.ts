jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/credentials/credential.service',
  () => ({ CredentialService: class CredentialServiceMock {} })
);
import { CommentAutomationDeliveryError } from './social.integrations.interface';
import { getSsrfSafeDispatcher } from '@gitroom/nestjs-libraries/dtos/webhooks/ssrf.safe.dispatcher';
import 'reflect-metadata';
import { InstagramMessagingService } from './instagram-messaging.service';
import { CredentialService } from '@gitroom/nestjs-libraries/database/prisma/credentials/credential.service';
import { createMock } from '@gitroom/nestjs-libraries/test';

const VALID_TOKEN = 'EAA' + 'x'.repeat(60);

// Roteia por substring da URL para nao depender da ordem das chamadas.
function routeFetch(routes: Array<[string, any]>) {
  return jest.fn().mockImplementation((url: string) => {
    const hit = routes.find(([fragment]) => url.includes(fragment));
    if (!hit) {
      return Promise.resolve({
        ok: false,
        status: 404,
        json: async () => ({ error: { message: `sem rota para ${url}` } }),
      });
    }
    return Promise.resolve({ ok: true, status: 200, json: async () => hit[1] });
  });
}

describe('InstagramMessagingService.validateSystemUserToken', () => {
  let service: InstagramMessagingService;
  let originalFetch: typeof fetch;

  beforeEach(() => {
    service = new InstagramMessagingService(createMock<CredentialService>());
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.resetAllMocks();
  });

  it('nao deve pedir o campo business em /me (Graph #100 nonexisting field)', async () => {
    const fetchMock = routeFetch([
      ['/me?', { id: 'su-1', name: 'dashboard_user' }],
      ['/me/businesses', { data: [] }],
      ['/me/assigned_pages', { data: [] }],
      ['/me/accounts', { data: [] }],
    ]);
    global.fetch = fetchMock as any;

    await service.validateSystemUserToken(VALID_TOKEN);

    const meUrl = (fetchMock.mock.calls as any[]).find((c) =>
      String(c[0]).includes('/me?')
    )?.[0] as string;
    expect(meUrl).toContain('fields=id,name');
    expect(meUrl).not.toContain('business');
  });

  it('deve buscar contas em assigned_pages (edge do node System User)', async () => {
    global.fetch = routeFetch([
      ['/me?', { id: 'su-1', name: 'dashboard_user' }],
      ['/me/businesses', { data: [] }],
      [
        '/me/assigned_pages',
        {
          data: [
            {
              id: 'page-1',
              name: 'Pagina 1',
              instagram_business_account: { id: 'ig-1', username: 'conta1' },
            },
          ],
        },
      ],
      ['/me/accounts', { data: [] }],
    ]) as any;

    const result = await service.validateSystemUserToken(VALID_TOKEN);

    expect(result.ok).toBe(true);
    expect(result.pages).toEqual([
      { id: 'page-1', name: 'Pagina 1', igUserId: 'ig-1', username: 'conta1' },
    ]);
  });

  it('deve reprovar o token quando /me retorna erro do Graph', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({
        error: { message: 'Invalid OAuth access token.' },
      }),
    }) as any;

    const result = await service.validateSystemUserToken(VALID_TOKEN);

    expect(result.ok).toBe(false);
    expect(result.error).toBe('Invalid OAuth access token.');
  });

  it('deve reprovar token vazio ou curto sem chamar a Graph', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as any;

    expect((await service.validateSystemUserToken('')).ok).toBe(false);
    expect((await service.validateSystemUserToken('curto')).ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('deve resolver businessId/businessName por /me/businesses', async () => {
    global.fetch = routeFetch([
      ['/me?', { id: 'su-1', name: 'dashboard_user' }],
      ['/me/businesses', { data: [{ id: 'biz-1', name: 'Solomo Media' }] }],
      ['/me/assigned_pages', { data: [] }],
      ['/me/accounts', { data: [] }],
      ['owned_pages', { data: [] }],
      ['client_pages', { data: [] }],
    ]) as any;

    const result = await service.validateSystemUserToken(VALID_TOKEN);

    expect(result.ok).toBe(true);
    expect(result.businessId).toBe('biz-1');
    expect(result.businessName).toBe('Solomo Media');
  });

  it('deve usar o nome do System User quando nao ha business acessivel', async () => {
    global.fetch = routeFetch([
      ['/me?', { id: 'su-1', name: 'dashboard_user' }],
      ['/me/businesses', { data: [] }],
      ['/me/assigned_pages', { data: [] }],
      ['/me/accounts', { data: [] }],
    ]) as any;

    const result = await service.validateSystemUserToken(VALID_TOKEN);

    expect(result.ok).toBe(true);
    expect(result.businessName).toBe('dashboard_user');
    expect(result.businessId).toBeUndefined();
  });

  it('deve descobrir contas IG via owned_pages quando /me/accounts vem vazio', async () => {
    global.fetch = routeFetch([
      ['/me?', { id: 'su-1', name: 'dashboard_user' }],
      ['/me/businesses', { data: [{ id: 'biz-1', name: 'Solomo Media' }] }],
      ['/me/assigned_pages', { data: [] }],
      ['/me/accounts', { data: [] }],
      [
        'owned_pages',
        {
          data: [
            {
              id: 'page-1',
              name: 'Pagina 1',
              instagram_business_account: { id: 'ig-1', username: 'conta1' },
            },
          ],
        },
      ],
      ['client_pages', { data: [] }],
    ]) as any;

    const result = await service.validateSystemUserToken(VALID_TOKEN);

    expect(result.ok).toBe(true);
    expect(result.pages).toEqual([
      {
        id: 'page-1',
        name: 'Pagina 1',
        igUserId: 'ig-1',
        username: 'conta1',
      },
    ]);
  });

  it('deve deduplicar pages repetidas entre /me/accounts e os assets do BM', async () => {
    const page = {
      id: 'page-1',
      name: 'Pagina 1',
      instagram_business_account: { id: 'ig-1', username: 'conta1' },
    };
    global.fetch = routeFetch([
      ['/me?', { id: 'su-1', name: 'dashboard_user' }],
      ['/me/businesses', { data: [{ id: 'biz-1', name: 'Solomo Media' }] }],
      ['/me/assigned_pages', { data: [] }],
      ['/me/accounts', { data: [page] }],
      ['owned_pages', { data: [page] }],
      ['client_pages', { data: [{ ...page, id: 'page-2', name: 'Pagina 2' }] }],
    ]) as any;

    const result = await service.validateSystemUserToken(VALID_TOKEN);

    expect(result.pages?.map((p) => p.id)).toEqual(['page-1', 'page-2']);
  });

  it('deve aprovar o token mesmo quando as edges opcionais falham', async () => {
    global.fetch = jest.fn().mockImplementation((url: string) =>
      url.includes('/me?')
        ? Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ id: 'su-1', name: 'dashboard_user' }),
          })
        : Promise.reject(new Error('network down'))
    ) as any;

    const result = await service.validateSystemUserToken(VALID_TOKEN);

    expect(result.ok).toBe(true);
    expect(result.pages).toEqual([]);
  });
});

describe('InstagramMessagingService single-shot deliveries', () => {
  let service: InstagramMessagingService;
  let request: jest.SpyInstance;
  const success = { message_id: 'remote-message', recipient_id: 'recipient' };
  const params = {
    organizationId: 'org',
    profileId: 'profile',
    igBusinessAccountId: 'ig-account',
    recipientIgsid: 'recipient',
    message: 'Message',
  };
  const response = (body: unknown, status = 200) =>
    ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    } as Response);
  const tokenEntry = {
    igUserId: 'ig-account',
    token: 'ig-token',
    refreshedAt: new Date().toISOString(),
  };

  beforeEach(() => {
    service = new InstagramMessagingService(createMock<CredentialService>());
    request = jest.spyOn(global, 'fetch');
  });
  afterEach(() => jest.restoreAllMocks());

  it.each([false, true])(
    'sends one regular DM on the selected host (IG login=%s)',
    async (useInstagramGraph) => {
      request.mockResolvedValue(response(success));
      await expect(
        service.sendDmWithToken({
          token: 'secret-token',
          recipientIgsid: 'recipient',
          message: 'Message',
          useInstagramGraph,
        })
      ).resolves.toEqual({
        messageId: 'remote-message',
        recipientId: 'recipient',
      });
      expect(request).toHaveBeenCalledTimes(1);
      const [url, init] = request.mock.calls[0];
      expect(String(url)).toBe(
        `https://${
          useInstagramGraph ? 'graph.instagram.com' : 'graph.facebook.com'
        }/v25.0/me/messages`
      );
      expect(String(url)).not.toContain('secret-token');
      expect(init).toMatchObject({
        method: 'POST',
        redirect: 'error',
        dispatcher: getSsrfSafeDispatcher(),
      });
      expect(init.headers.Authorization).toBe('Bearer secret-token');
      expect(init.signal).toBeInstanceOf(AbortSignal);
      expect(JSON.parse(init.body)).toEqual({
        recipient: { id: 'recipient' },
        message: { text: 'Message' },
      });
    }
  );

  it('selects the system-user token before sending and never falls back to another token on uncertainty', async () => {
    jest.spyOn(service as any, 'loadState').mockResolvedValue({
      metaSystemUserToken: 'system-token',
      instagramTokens: [tokenEntry],
    });
    request.mockResolvedValue(
      response({ error: { message: 'secret-token' } }, 500)
    );
    await expect(service.sendStoryReply(params)).rejects.toMatchObject({
      outcome: 'unknown',
    });
    expect(request).toHaveBeenCalledTimes(1);
    expect(String(request.mock.calls[0][0])).toBe(
      'https://graph.facebook.com/v25.0/ig-account/messages'
    );
    expect(request.mock.calls[0][1].headers.Authorization).toBe(
      'Bearer system-token'
    );
  });

  it('uses the configured per-account IG token when there is no system-user token', async () => {
    jest
      .spyOn(service as any, 'loadState')
      .mockResolvedValue({ instagramTokens: [tokenEntry] });
    request.mockResolvedValue(response(success));
    await expect(service.sendStoryReply(params)).resolves.toEqual({
      messageId: 'remote-message',
      recipientId: 'recipient',
    });
    expect(request).toHaveBeenCalledTimes(1);
    expect(String(request.mock.calls[0][0])).toContain(
      'graph.instagram.com/v25.0/me/messages'
    );
    expect(request.mock.calls[0][1].headers.Authorization).toBe(
      'Bearer ig-token'
    );
  });

  it('permits a failed token-refresh preflight followed by only one delivery attempt', async () => {
    jest.spyOn(service as any, 'loadState').mockResolvedValue({
      instagramTokens: [
        {
          ...tokenEntry,
          refreshedAt: new Date(Date.now() - 2 * 86400000).toISOString(),
        },
      ],
    });
    request
      .mockResolvedValueOnce(
        response({ error: { message: 'secret-token' } }, 500)
      )
      .mockResolvedValueOnce(response(success));
    await service.sendStoryReply(params);
    expect(request).toHaveBeenCalledTimes(2);
    expect(
      request.mock.calls.filter(([, init]) => init.method === 'POST')
    ).toHaveLength(1);
    expect(request.mock.calls[1][1].headers.Authorization).toBe(
      'Bearer ig-token'
    );
  });

  it.each([
    [
      'explicit rejection',
      response({ error: { message: 'secret-token' } }, 403),
      'rejected',
    ],
    [
      'server failure',
      response({ error: { message: 'secret-token' } }, 503),
      'unknown',
    ],
    ['missing message identity', response({ success: true }), 'unknown'],
    [
      'malformed success',
      {
        ok: true,
        status: 200,
        json: async () => {
          throw Error('secret-token');
        },
      } as Response,
      'unknown',
    ],
  ])(
    'never retries after %s and sanitizes the failure',
    async (_label, result, outcome) => {
      request.mockResolvedValue(result);
      let failure: CommentAutomationDeliveryError;
      try {
        await service.sendDmWithToken({
          token: 'secret-token',
          recipientIgsid: 'recipient',
          message: 'Message',
        });
      } catch (error) {
        failure = error as CommentAutomationDeliveryError;
      }
      expect(failure).toBeInstanceOf(CommentAutomationDeliveryError);
      expect(failure.outcome).toBe(outcome);
      expect(String(failure)).not.toContain('secret-token');
      expect(request).toHaveBeenCalledTimes(1);
    }
  );

  it.each(['TimeoutError', 'TypeError'])(
    'does not resend after %s',
    async (name) => {
      request.mockRejectedValue(
        Object.assign(new Error('secret-token'), { name })
      );
      await expect(
        service.sendDmWithToken({
          token: 'secret-token',
          recipientIgsid: 'recipient',
          message: 'Message',
        })
      ).rejects.toMatchObject({ outcome: 'unknown' });
      expect(request).toHaveBeenCalledTimes(1);
    }
  );
});
