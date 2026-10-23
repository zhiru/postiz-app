import 'reflect-metadata';
const mockFetch = jest.fn();
jest.mock(
  '@gitroom/nestjs-libraries/dtos/webhooks/ssrf.safe.dispatcher',
  () => ({ ssrfSafeFetch: mockFetch })
);
jest.mock(
  '@gitroom/nestjs-libraries/dtos/webhooks/webhook.url.validator',
  () => ({ isSafePublicHttpsUrl: jest.fn().mockResolvedValue(true) })
);
import { isSafePublicHttpsUrl } from '@gitroom/nestjs-libraries/dtos/webhooks/webhook.url.validator';
import {
  NeuralTalkProvider,
  NeuralTalkDeliveryError,
} from './neuraltalk.provider';
const credentials = {
  baseUrl: 'https://chat.example.com',
  apiToken: 'secret',
  accountId: 'tenant-1',
  inboxId: '4',
};
const token = JSON.stringify(credentials);
const response = (body: unknown, status = 200) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    body: { cancel: jest.fn().mockResolvedValue(undefined) },
  } as any);
const inbox = {
  id: 4,
  name: 'Abrasel',
  channel_type: 'Channel::Quepasa',
  provider: 'quepasa_channel',
  channel_capabilities: ['outbound_message'],
  outbound_message_available: true,
};
const contact = {
  id: 12,
  name: 'Grupo',
  identifier: '12000@g.us',
  contact_inboxes: [{ source_id: '12000@g.us', inbox: { id: 4 } }],
};
const integration = {
  id: 'integration-1',
  organizationId: 'org-1',
  profileId: 'profile-1',
} as any;
const post = {
  id: 'post-1',
  message: '<p>Olá!</p><p>https://example.com</p>',
  settings: { targets: ['group:12'] },
  media: [] as any[],
};
const store = { execute: jest.fn(async (_scope: any, send: any) => send()) };
describe('NeuralTalkProvider', () => {
  let provider: NeuralTalkProvider;
  beforeEach(() => {
    jest.clearAllMocks();
    provider = new NeuralTalkProvider(store);
  });
  it('declares single deliveries to prevent recurrence from reusing a receipt', () => {
    expect(provider.supportsRecurringPosts).toBe(false);
  });
  it('projects accounts without exposing session secrets', async () => {
    mockFetch.mockResolvedValue(
      response({
        pubsub_token: 'hidden',
        accounts: [
          {
            id: 7,
            uuid: 'tenant-1',
            name: 'Abrasel',
            status: 'active',
            secret: 'hidden',
          },
        ],
      })
    );
    expect(await provider.accounts(credentials)).toEqual([
      { id: 'tenant-1', name: 'Abrasel' },
    ]);
    expect(mockFetch.mock.calls[0][1]).toMatchObject({
      redirect: 'error',
      headers: { api_access_token: 'secret' },
    });
  });
  it('only exposes outbound-capable inboxes and strips credentials', async () => {
    mockFetch.mockResolvedValue(
      response({
        payload: [
          { ...inbox, inbox_identifier: 'hidden' },
          { id: 5, name: 'Web', channel_capabilities: [] },
        ],
      })
    );
    expect(await provider.inboxes(credentials)).toEqual([
      {
        id: '4',
        name: 'Abrasel',
        channelType: 'Channel::Quepasa',
        supportsGroups: true,
        available: true,
      },
    ]);
  });
  it('filters foreign inbox contacts and classifies groups', async () => {
    mockFetch
      .mockResolvedValueOnce(response({ payload: [inbox] }))
      .mockResolvedValueOnce(
        response({
          payload: [
            contact,
            { id: 99, name: 'Other', contact_inboxes: [{ inbox: { id: 9 } }] },
          ],
          meta: { has_more: false },
        })
      );
    expect(
      await provider.destinations(token, { query: 'grupo', page: 1 })
    ).toEqual({
      items: [{ id: 'group:12', name: 'Grupo', kind: 'group' }],
      hasMore: false,
      page: 1,
    });
  });
  it('requires durable receipts before sending', async () => {
    await expect(
      new NeuralTalkProvider().post('id', token, [post], integration)
    ).rejects.toThrow('receipt');
    expect(mockFetch).not.toHaveBeenCalled();
  });
  it('rejects destinations that changed group kind without sending', async () => {
    mockFetch
      .mockResolvedValueOnce(response({ payload: [inbox] }))
      .mockResolvedValueOnce(
        response({
          payload: {
            ...contact,
            identifier: '555@s.whatsapp.net',
            contact_inboxes: [
              { source_id: '555@s.whatsapp.net', inbox: { id: 4 } },
            ],
          },
        })
      );
    await expect(
      provider.post('id', token, [post], integration)
    ).rejects.toThrow('destination');
    expect(
      mockFetch.mock.calls.every(
        (c: any) => !c[1].method || c[1].method === 'GET'
      )
    ).toBe(true);
  });
  it('returns pending when accepted, and persists every target through the store', async () => {
    mockFetch
      .mockResolvedValueOnce(response({ payload: [inbox] }))
      .mockResolvedValueOnce(response({ payload: contact }))
      .mockResolvedValueOnce(
        response({ id: 23, inbox_id: 4, meta: { sender: { id: 12 } } })
      )
      .mockResolvedValueOnce(
        response({ id: 45, status: 'sent', source_id: null })
      );
    const result = await provider.post('id', token, [post], integration);
    expect(result[0].status).toBe('pending');
    expect(result[0].pendingData.deliveries).toEqual([
      { conversationId: '23', messageId: '45', target: 'group:12' },
    ]);
    expect(store.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org-1',
        profileId: 'profile-1',
        postId: 'post-1',
        target: 'group:12',
      }),
      expect.any(Function)
    );
    expect(JSON.parse(mockFetch.mock.calls[3][1].body)).toMatchObject({
      message_type: 'outgoing',
      private: false,
      content: 'Olá!\nhttps://example.com',
    });
  });
  it('does not retry a timeout or leak credentials in the error', async () => {
    mockFetch
      .mockResolvedValueOnce(response({ payload: [inbox] }))
      .mockResolvedValueOnce(response({ payload: contact }))
      .mockResolvedValueOnce(
        response({ id: 23, inbox_id: 4, meta: { sender: { id: 12 } } })
      )
      .mockRejectedValueOnce(new Error('secret provider details'));
    let error: any;
    try {
      await provider.post('id', token, [post], integration);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(NeuralTalkDeliveryError);
    expect(error.outcome).toBe('unknown');
    expect(error.message).not.toContain('secret');
    expect(mockFetch).toHaveBeenCalledTimes(4);
  });
  it('never treats the default sent status as confirmed delivery', async () => {
    const pending = {
      deliveries: [
        { conversationId: '23', messageId: '45', target: 'group:12' },
      ],
    };
    mockFetch.mockResolvedValue(
      response({
        payload: [
          {
            id: 45,
            inbox_id: 4,
            conversation_id: 23,
            status: 'sent',
            source_id: null,
          },
        ],
      })
    );
    expect(await provider.checkPostStatus(token, pending, integration)).toEqual(
      { status: 'pending', pendingData: pending }
    );
  });
  it('confirms only the exact message in the configured inbox', async () => {
    const pending = {
      deliveries: [
        { conversationId: '23', messageId: '45', target: 'group:12' },
      ],
    };
    mockFetch.mockResolvedValue(
      response({
        payload: [
          {
            id: 45,
            inbox_id: 4,
            conversation_id: 23,
            status: 'sent',
            source_id: 'remote-45',
          },
        ],
      })
    );
    expect(await provider.checkPostStatus(token, pending, integration)).toEqual(
      {
        status: 'completed',
        postId: '45',
        releaseURL:
          'https://chat.example.com/app/accounts/tenant-1/conversations/23',
      }
    );
  });
  it('fails clearly when the provider reports a delivery failure', async () => {
    mockFetch.mockResolvedValue(
      response({
        payload: [
          {
            id: 45,
            inbox_id: 4,
            conversation_id: 23,
            status: 'failed',
            source_id: null,
            external_error: 'private provider error',
          },
        ],
      })
    );
    await expect(
      provider.checkPostStatus(
        token,
        {
          deliveries: [
            { conversationId: '23', messageId: '45', target: 'group:12' },
          ],
        },
        integration
      )
    ).rejects.toThrow('failed');
  });
  it('rejects duplicate or malformed targets before any send', async () => {
    await expect(
      provider.post(
        'id',
        token,
        [{ ...post, settings: { targets: ['group:12', 'group:12'] } }],
        integration
      )
    ).rejects.toThrow('targets');
    expect(mockFetch).not.toHaveBeenCalled();
  });
  it('resolves saved target names only inside the selected inbox', async () => {
    mockFetch
      .mockResolvedValueOnce(response({ payload: [inbox] }))
      .mockResolvedValueOnce(response({ payload: contact }))
      .mockResolvedValueOnce(
        response({
          payload: {
            ...contact,
            id: 99,
            contact_inboxes: [{ inbox: { id: 9 } }],
          },
        })
      );
    expect(
      await provider.destinations(token, { ids: ['group:12', 'group:99'] })
    ).toEqual({
      items: [{ id: 'group:12', name: 'Grupo', kind: 'group' }],
      hasMore: false,
      page: 1,
    });
  });
  it('rejects unsafe origins before sending credentials', async () => {
    (isSafePublicHttpsUrl as jest.Mock).mockResolvedValueOnce(false);
    await expect(
      provider.accounts({ ...credentials, baseUrl: 'https://127.0.0.1' })
    ).rejects.toThrow('public HTTPS');
    expect(mockFetch).not.toHaveBeenCalled();
  });
  it('rejects URL credentials and redirects instead of forwarding a token', async () => {
    await expect(
      provider.accounts({
        ...credentials,
        baseUrl: 'https://user:pass@example.com',
      })
    ).rejects.toThrow('origin');
    mockFetch.mockResolvedValueOnce(response({}, 302));
    await expect(provider.accounts(credentials)).rejects.toThrow('302');
    expect(mockFetch.mock.calls[0][1].redirect).toBe('error');
  });
  it('streams attachments in order without sending the API token to the media host', async () => {
    const wire: any[] = [];
    mockFetch.mockImplementation(async (url: string, init: any) => {
      wire.push({ url, init });
      if (url.endsWith('/inboxes')) return response({ payload: [inbox] });
      if (url.includes('/contacts/12')) return response({ payload: contact });
      if (url.endsWith('/conversations'))
        return response({ id: 23, inbox_id: 4, meta: { sender: { id: 12 } } });
      if (url.startsWith('https://media.example.com'))
        return new Response(
          url.endsWith('1.jpg') ? 'first-image' : 'second-video',
          {
            headers: {
              'content-type': url.endsWith('1.jpg')
                ? 'image/jpeg'
                : 'video/mp4',
            },
          }
        );
      if (url.endsWith('/messages')) {
        const chunks = [];
        for await (const chunk of init.body) chunks.push(Buffer.from(chunk));
        const multipart = Buffer.concat(chunks).toString();
        expect(multipart).toContain('name="attachments[]"');
        expect(multipart.indexOf('first-image')).toBeLessThan(
          multipart.indexOf('second-video')
        );
        expect(multipart).toContain('mali_post_delivery_id');
        expect(init.duplex).toBe('half');
        return response({ id: 45, status: 'sent' });
      }
      throw new Error('unexpected URL');
    });
    await provider.post(
      'id',
      token,
      [
        {
          ...post,
          media: [
            { type: 'image', path: 'https://media.example.com/1.jpg' },
            { type: 'video', path: 'https://media.example.com/2.mp4' },
          ],
        },
      ],
      integration
    );
    expect(
      wire
        .filter((call) => call.url.startsWith('https://media.example.com'))
        .every((call) => !call.init.headers)
    ).toBe(true);
  });
  it.each([429, 500, 503])(
    'keeps HTTP %s read failures retryable during polling',
    async (status) => {
      mockFetch.mockResolvedValue(response({}, status));
      let error: unknown;
      try {
        await provider.checkPostStatus(
          token,
          {
            deliveries: [
              { conversationId: '23', messageId: '45', target: 'group:12' },
            ],
          },
          integration
        );
      } catch (caught) {
        error = caught;
      }
      expect(error).toBeInstanceOf(Error);
      expect(error).not.toBeInstanceOf(NeuralTalkDeliveryError);
      expect((error as Error).message).not.toContain('secret');
    }
  );
  it('keeps network polling failures retryable without resending', async () => {
    mockFetch.mockRejectedValue(new Error('secret response body'));
    let error: unknown;
    try {
      await provider.checkPostStatus(
        token,
        {
          deliveries: [
            { conversationId: '23', messageId: '45', target: 'group:12' },
          ],
        },
        integration
      );
    } catch (caught) {
      error = caught;
    }
    expect(error).not.toBeInstanceOf(NeuralTalkDeliveryError);
    expect((error as Error).message).not.toContain('secret');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
  it.each([
    [
      'Texto original\n\nhttps://example.com',
      'Texto original\n\nhttps://example.com',
    ],
    [
      '<p>Inscreva-se <a href="https://example.com/ingressos?x=1&amp;y=2">aqui</a>.</p><p>📅 Amanhã</p>',
      'Inscreva-se aqui (https://example.com/ingressos?x=1&y=2).\n📅 Amanhã',
    ],
    [
      '<p><a href="https://example.com">https://example.com</a></p>',
      'https://example.com',
    ],
  ])(
    'preserves message content and clickable links: %s',
    async (message, expected) => {
      mockFetch
        .mockResolvedValueOnce(response({ payload: [inbox] }))
        .mockResolvedValueOnce(response({ payload: contact }))
        .mockResolvedValueOnce(
          response({ id: 23, inbox_id: 4, meta: { sender: { id: 12 } } })
        )
        .mockResolvedValueOnce(
          response({ id: 45, status: 'sent', source_id: null })
        );
      await provider.post('id', token, [{ ...post, message }], integration);
      expect(JSON.parse(mockFetch.mock.calls[3][1].body).content).toBe(
        expected
      );
    }
  );
  it('rejects an unexpected contacts/show envelope without sending', async () => {
    mockFetch
      .mockResolvedValueOnce(response({ payload: [inbox] }))
      .mockResolvedValueOnce(response(contact));
    await expect(
      provider.post('id', token, [post], integration)
    ).rejects.toThrow('destination');
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});
