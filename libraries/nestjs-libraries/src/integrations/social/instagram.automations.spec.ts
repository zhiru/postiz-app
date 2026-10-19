import { InstagramProvider } from './instagram.provider';
import { InstagramStandaloneProvider } from './instagram.standalone.provider';
import { CommentAutomationDeliveryError } from './social.integrations.interface';
import { getSsrfSafeDispatcher } from '@gitroom/nestjs-libraries/dtos/webhooks/ssrf.safe.dispatcher';

const response = (body: unknown, status = 200) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response);

describe('Instagram automation deliveries', () => {
  let provider: InstagramProvider;
  let request: jest.SpyInstance;

  beforeEach(() => {
    provider = new InstagramProvider();
    request = jest.spyOn(global, 'fetch');
  });
  afterEach(() => jest.restoreAllMocks());

  it.each(['graph.facebook.com', 'graph.instagram.com'])(
    'sends one private reply on %s with account identity and bearer token',
    async (host) => {
      request.mockResolvedValue(
        response({ recipient_id: 'recipient', message_id: 'sent' })
      );
      await expect(
        provider.sendPrivateReply(
          'page-token___user-token',
          'ig-account',
          'comment',
          'Catalog',
          undefined,
          host
        )
      ).resolves.toEqual({ recipientId: 'recipient', messageId: 'sent' });
      expect(request).toHaveBeenCalledTimes(1);
      const [url, options] = request.mock.calls[0];
      expect(String(url)).toBe(`https://${host}/v25.0/ig-account/messages`);
      expect(options.headers.Authorization).toBe('Bearer page-token');
      expect(JSON.parse(options.body)).toEqual({
        recipient: { comment_id: 'comment' },
        message: { text: 'Catalog' },
      });
      expect(options).toMatchObject({
        method: 'POST',
        redirect: 'error',
        dispatcher: getSsrfSafeDispatcher(),
      });
      expect(options.signal).toBeInstanceOf(AbortSignal);
      expect(String(url)).not.toContain('token');
    }
  );

  it('keeps public replies compatible with inbox integration and standalone host routing', async () => {
    request.mockResolvedValue(response({ id: 'reply' }));
    await expect(
      provider.replyToComment('page___user', 'comment', 'Response', {} as any)
    ).resolves.toEqual({ id: 'reply' });
    await expect(
      new InstagramStandaloneProvider().replyToComment(
        'ig-token',
        'comment',
        'Response',
        {} as any
      )
    ).resolves.toEqual({ id: 'reply' });
    expect(request).toHaveBeenCalledTimes(2);
    expect(String(request.mock.calls[0][0])).toContain(
      'graph.facebook.com/v25.0/comment/replies'
    );
    expect(String(request.mock.calls[1][0])).toContain(
      'graph.instagram.com/v25.0/comment/replies'
    );
    expect(JSON.parse(request.mock.calls[0][1].body)).toEqual({
      message: 'Response',
    });
    expect(request.mock.calls[1][1].headers.Authorization).toBe(
      'Bearer ig-token'
    );
  });

  it('resolves the Facebook page with a read and sends a regular DM only once', async () => {
    request
      .mockResolvedValueOnce(response({ id: 'page-id' }))
      .mockResolvedValueOnce(
        response({ recipient_id: 'recipient', message_id: 'sent' })
      );
    await provider.sendDM('page-token', 'recipient', 'Message');
    expect(request).toHaveBeenCalledTimes(2);
    expect(
      request.mock.calls.filter(([, init]) => init.method === 'POST')
    ).toHaveLength(1);
    expect(String(request.mock.calls[1][0])).toBe(
      'https://graph.facebook.com/v25.0/page-id/messages'
    );
  });

  it.each([
    [
      'permission rejection',
      response({ error: { message: 'secret-token', code: 190 } }, 400),
      'rejected',
    ],
    [
      'server failure',
      response({ error: { message: 'secret-token' } }, 500),
      'unknown',
    ],
    ['missing identity', response({ success: true }), 'unknown'],
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
    'never retries or persists provider details after %s',
    async (_label, result, outcome) => {
      request.mockResolvedValue(result);
      let failure: CommentAutomationDeliveryError;
      try {
        await provider.replyToComment(
          'secret-token',
          'comment',
          'Response',
          {} as any
        );
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
    'treats %s as uncertain and never retries',
    async (name) => {
      request.mockRejectedValue(
        Object.assign(new Error('secret-token'), { name })
      );
      await expect(
        provider.sendPrivateReply(
          'secret-token',
          'account',
          'comment',
          'Message'
        )
      ).rejects.toMatchObject({ outcome: 'unknown' });
      expect(request).toHaveBeenCalledTimes(1);
    }
  );

  it('refuses an unexpected host before sending credentials', async () => {
    await expect(
      provider.replyToComment(
        'secret-token',
        'comment',
        'Message',
        'unexpected.invalid'
      )
    ).rejects.toMatchObject({ outcome: 'rejected' });
    expect(request).not.toHaveBeenCalled();
  });
});
