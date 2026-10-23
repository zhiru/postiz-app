import { Inject, Injectable, Optional } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { Integration } from '@prisma/client';
import {
  captionText,
  postContentToHtml,
} from '@gitroom/helpers/utils/sanitize.post.content';
import { parseFragment, serialize } from 'parse5';
import { NeuralTalkDto } from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/neuraltalk.dto';
import { ssrfSafeFetch } from '@gitroom/nestjs-libraries/dtos/webhooks/ssrf.safe.dispatcher';
import { isSafePublicHttpsUrl } from '@gitroom/nestjs-libraries/dtos/webhooks/webhook.url.validator';
import { Tool } from '../tool.decorator';
import { BadBody, SocialAbstract } from '../social.abstract';
import {
  AuthTokenDetails,
  MediaContent,
  PendingCheckResponse,
  PostDetails,
  PostResponse,
  SocialProvider,
} from './social.integrations.interface';

export const NEURALTALK_DELIVERY_STORE = 'NEURALTALK_DELIVERY_STORE';
export type NeuralTalkCredentials = {
  baseUrl: string;
  apiToken: string;
  accountId?: string;
  inboxId?: string;
};
export type NeuralTalkReceipt = { conversationId: string; messageId: string };
export interface NeuralTalkDeliveryStore {
  execute(
    scope: {
      organizationId: string;
      profileId: string | null;
      integrationId: string;
      postId: string;
      target: string;
      payloadHash: string;
    },
    send: () => Promise<NeuralTalkReceipt>
  ): Promise<NeuralTalkReceipt>;
}
export class NeuralTalkDeliveryError extends BadBody {
  constructor(
    public readonly outcome: 'rejected' | 'unknown',
    message = 'NeuralTalk delivery result is unknown; check the history before retrying.'
  ) {
    super('neuraltalk', '{}', '{}', message);
  }
}
type Inbox = {
  id: string;
  name: string;
  channelType: string;
  supportsGroups: boolean;
  available: boolean;
};
type Delivery = NeuralTalkReceipt & { target: string };
type Pending = { deliveries: Delivery[] };
const MAX_MEDIA_BYTES = 50 * 1024 * 1024;
const identifier = /^[a-zA-Z0-9-]{1,80}$/;

@Injectable()
export class NeuralTalkProvider
  extends SocialAbstract
  implements SocialProvider
{
  identifier = 'neuraltalk';
  name = 'NeuralTalk';
  scopes: string[] = [];
  editor = 'normal' as const;
  isBetweenSteps = false;
  noNativeRefresh = true;
  requiresCredentialFreeWorkflow = true;
  supportsRecurringPosts = false;
  dto = NeuralTalkDto;
  constructor(
    @Optional()
    @Inject(NEURALTALK_DELIVERY_STORE)
    private readonly receipts?: NeuralTalkDeliveryStore
  ) {
    super();
  }
  maxLength() {
    return 4096;
  }

  async generateAuthUrl(): Promise<{
    url: string;
    codeVerifier: string;
    state: string;
  }> {
    throw this.rejected(
      'Connect NeuralTalk through the account and inbox selector.'
    );
  }
  async authenticate(): Promise<AuthTokenDetails | string> {
    return 'Connect NeuralTalk through the account and inbox selector.';
  }
  async refreshToken(): Promise<AuthTokenDetails> {
    throw this.rejected('Reconnect NeuralTalk with a valid API credential.');
  }

  private rejected(message: string) {
    return new NeuralTalkDeliveryError('rejected', message);
  }
  private credentials(
    value: NeuralTalkCredentials | string,
    scoped = false
  ): NeuralTalkCredentials {
    let data: NeuralTalkCredentials;
    try {
      data = typeof value === 'string' ? JSON.parse(value) : value;
    } catch {
      throw this.rejected('Invalid NeuralTalk connection.');
    }
    let url: URL;
    try {
      url = new URL(data?.baseUrl?.trim());
    } catch {
      throw this.rejected('Use a valid HTTPS NeuralTalk URL.');
    }
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !/^\/*$/.test(url.pathname)
    )
      throw this.rejected('Use the HTTPS origin of the NeuralTalk server.');
    if (
      !data.apiToken ||
      typeof data.apiToken !== 'string' ||
      data.apiToken.length > 4096 ||
      /[\r\n]/.test(data.apiToken)
    )
      throw this.rejected('A NeuralTalk API credential is required.');
    if (
      scoped &&
      (!identifier.test(String(data.accountId || '')) ||
        !/^[1-9]\d*$/.test(String(data.inboxId || '')))
    )
      throw this.rejected('Select a NeuralTalk account and inbox.');
    return {
      baseUrl: url.origin,
      apiToken: data.apiToken,
      accountId: data.accountId == null ? undefined : String(data.accountId),
      inboxId: data.inboxId == null ? undefined : String(data.inboxId),
    };
  }

  private async request(
    auth: NeuralTalkCredentials,
    path: string,
    init: RequestInit & { duplex?: 'half' } = {}
  ): Promise<any> {
    if (!(await isSafePublicHttpsUrl(auth.baseUrl)))
      throw this.rejected(
        'NeuralTalk must use a reachable public HTTPS address.'
      );
    const mutation = !!init.method && init.method !== 'GET';
    let response: Response;
    try {
      response = await ssrfSafeFetch(auth.baseUrl + path, {
        ...init,
        redirect: 'error',
        signal: AbortSignal.timeout(mutation ? 120000 : 30000),
        headers: { ...init.headers, api_access_token: auth.apiToken },
      });
    } catch {
      if (mutation) throw new NeuralTalkDeliveryError('unknown');
      throw new Error('NeuralTalk is temporarily unreachable; retry the read.');
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      if (
        !mutation &&
        (response.status >= 500 ||
          response.status === 408 ||
          response.status === 429)
      )
        throw new Error(
          'NeuralTalk is temporarily unavailable; retry the read.'
        );
      if (mutation && (response.status >= 500 || response.status === 408))
        throw new NeuralTalkDeliveryError('unknown');
      throw this.rejected(
        response.status === 401 || response.status === 403
          ? 'NeuralTalk denied access. Check the account, inbox and API credential permissions.'
          : `NeuralTalk rejected the request (HTTP ${response.status}).`
      );
    }
    try {
      return await response.json();
    } catch {
      if (mutation) throw new NeuralTalkDeliveryError('unknown');
      throw new Error(
        'NeuralTalk returned an invalid response; retry the read.'
      );
    }
  }
  private path(auth: NeuralTalkCredentials) {
    if (!identifier.test(String(auth.accountId || '')))
      throw this.rejected('Select a NeuralTalk account.');
    return `/api/v1/accounts/${encodeURIComponent(auth.accountId!)}`;
  }

  async accounts(
    value: NeuralTalkCredentials
  ): Promise<Array<{ id: string; name: string }>> {
    const auth = this.credentials(value);
    const data = await this.request(auth, '/api/v1/profile');
    if (!Array.isArray(data.accounts))
      throw this.rejected('NeuralTalk did not return authorized accounts.');
    return data.accounts
      .filter((account: any) => account.status === 'active')
      .map((account: any) => ({
        id: String(account.uuid || account.id),
        name: String(account.name || ''),
      }));
  }
  async inboxes(value: NeuralTalkCredentials): Promise<Inbox[]> {
    const auth = this.credentials(value);
    const data = await this.request(auth, this.path(auth) + '/inboxes');
    if (!Array.isArray(data.payload))
      throw this.rejected('NeuralTalk did not return authorized inboxes.');
    return data.payload
      .filter(
        (inbox: any) =>
          Array.isArray(inbox.channel_capabilities) &&
          inbox.channel_capabilities.includes('outbound_message')
      )
      .map((inbox: any) => ({
        id: String(inbox.id),
        name: String(inbox.name || ''),
        channelType: String(inbox.channel_type || ''),
        supportsGroups:
          inbox.channel_type === 'Channel::Quepasa' &&
          inbox.provider === 'quepasa_channel',
        available: inbox.outbound_message_available !== false,
      }));
  }
  private async selectedInbox(auth: NeuralTalkCredentials) {
    const inbox = (await this.inboxes(auth)).find(
      (item) => item.id === auth.inboxId
    );
    if (!inbox || !inbox.available)
      throw this.rejected(
        'The selected NeuralTalk inbox is unavailable or does not allow outbound messages.'
      );
    return inbox;
  }
  async validateConnection(value: string | NeuralTalkCredentials) {
    const credentials = this.credentials(value, true);
    const account = (await this.accounts(credentials)).find(
      (item) => item.id === credentials.accountId
    );
    if (!account)
      throw this.rejected('The NeuralTalk account is not authorized.');
    const inbox = await this.selectedInbox(credentials);
    const id = createHash('sha256')
      .update(`${credentials.baseUrl}|${account.id}|${inbox.id}`)
      .digest('hex');
    return {
      account,
      inbox,
      auth: {
        id,
        name: `${account.name} — ${inbox.name}`,
        username: inbox.name,
        picture: '',
        accessToken: JSON.stringify(credentials),
        refreshToken: '',
        expiresIn: 3153600000,
      },
    };
  }

  private destination(contact: any, inbox: Inbox) {
    const link = contact?.contact_inboxes?.find(
      (item: any) => String(item.inbox?.id) === inbox.id
    );
    if (!link || contact.blocked || !/^[1-9]\d*$/.test(String(contact.id)))
      return undefined;
    const group = [
      contact.identifier,
      link.source_id,
      contact.custom_attributes?.quepasa,
    ].some((value) => typeof value === 'string' && value.endsWith('@g.us'));
    if (group && !inbox.supportsGroups) return undefined;
    return {
      id: `${group ? 'group' : 'contact'}:${contact.id}`,
      name: String(contact.name || ''),
      kind: group ? ('group' as const) : ('contact' as const),
    };
  }
  @Tool({
    description:
      'Search contacts and groups available in this NeuralTalk inbox.',
    dataSchema: [
      { key: 'query', type: 'string', description: 'Contact or group name.' },
      {
        key: 'page',
        type: 'number',
        description: 'Page number, starting at 1.',
      },
    ],
  })
  async destinations(
    accessToken: string,
    params: { query?: string; page?: number; ids?: string[] } = {}
  ) {
    const auth = this.credentials(accessToken, true);
    const inbox = await this.selectedInbox(auth);
    if (params.ids !== undefined) {
      if (
        !Array.isArray(params.ids) ||
        params.ids.length > 50 ||
        params.ids.some(
          (id) =>
            typeof id !== 'string' || !/^(contact|group):[1-9]\d*$/.test(id)
        )
      )
        throw this.rejected('Invalid destination selection.');
      const items = [];
      for (const id of [...new Set(params.ids)]) {
        const contactResponse = await this.request(
          auth,
          this.path(auth) +
            `/contacts/${id.split(':')[1]}?include_contact_inboxes=true`
        );
        const contact = contactResponse.payload;
        const destination = this.destination(contact, inbox);
        if (destination?.id === id) items.push(destination);
      }
      return { items, hasMore: false, page: 1 };
    }
    const page = params.page ?? 1;
    if (
      !Number.isInteger(page) ||
      page < 1 ||
      page > 10000 ||
      (params.query?.length || 0) > 200
    )
      throw this.rejected('Invalid destination search.');
    const query = new URLSearchParams({
      page: String(page),
      include_contact_inboxes: 'true',
      capabilities_inbox_id: inbox.id,
    });
    if (params.query?.trim()) query.set('q', params.query.trim());
    const data = await this.request(
      auth,
      this.path(auth) + `/contacts${query.has('q') ? '/search' : ''}?${query}`
    );
    if (!Array.isArray(data.payload))
      throw this.rejected('NeuralTalk did not return contacts.');
    return {
      items: data.payload
        .map((contact: any) => this.destination(contact, inbox))
        .filter(Boolean),
      hasMore:
        typeof data.meta?.has_more === 'boolean'
          ? data.meta.has_more
          : page * 15 < Number(data.meta?.count || 0),
      page,
    };
  }

  override async checkValidity(
    posts: Array<{ path: string }[]>,
    settings: NeuralTalkDto
  ) {
    if (
      !Array.isArray(settings?.targets) ||
      settings.targets.length < 1 ||
      settings.targets.length > 50 ||
      new Set(settings.targets).size !== settings.targets.length ||
      settings.targets.some(
        (target) => !/^(contact|group):[1-9]\d*$/.test(target)
      )
    )
      return 'Select between 1 and 50 unique NeuralTalk targets.';
    if (posts.length !== 1)
      return 'NeuralTalk supports one message per post; use the media list for multiple attachments.';
    if (posts[0].length > 10)
      return 'NeuralTalk accepts at most 10 media files per message.';
    return true;
  }

  private messageContent(value: string): string {
    const fragment = parseFragment(postContentToHtml(value));
    const visit = (node: any) => {
      for (const child of node.childNodes || []) visit(child);
      if (node.tagName !== 'a') return;
      const href = node.attrs?.find((attr: any) => attr.name === 'href')?.value;
      if (!href || !/^(https?:|mailto:)/i.test(href)) return;
      const label = captionText(serialize(node)).trim();
      if (label === href || label === href.replace(/^mailto:/i, '')) return;
      node.childNodes.push({
        nodeName: '#text',
        value: label ? ` (${href})` : href,
        parentNode: node,
      });
    };
    visit(fragment);
    return captionText(serialize(fragment));
  }

  async post(
    id: string,
    accessToken: string,
    posts: PostDetails<NeuralTalkDto>[],
    integration: Integration
  ): Promise<PostResponse[]> {
    return this.postPending(id, accessToken, posts, integration);
  }
  async postPending(
    _id: string,
    accessToken: string,
    posts: PostDetails<NeuralTalkDto>[],
    integration: Integration
  ): Promise<PostResponse[]> {
    if (!this.receipts)
      throw this.rejected(
        'NeuralTalk delivery receipt storage is unavailable.'
      );
    const post = posts[0];
    const validity = await this.checkValidity(
      posts.map((item) => item.media || []),
      post?.settings
    );
    if (validity !== true) throw this.rejected(validity);
    const content = this.messageContent(post.message);
    if (
      content.length > this.maxLength() ||
      (!content.trim() && !post.media?.length)
    )
      throw this.rejected(
        'The NeuralTalk message is empty or exceeds 4096 characters.'
      );
    const auth = this.credentials(accessToken, true);
    const inbox = await this.selectedInbox(auth);
    const recipients = [];
    // Validate every target before any message is sent.
    for (const target of post.settings.targets) {
      const contactId = target.split(':')[1];
      const contactResponse = await this.request(
        auth,
        this.path(auth) + `/contacts/${contactId}?include_contact_inboxes=true`
      );
      const contact = contactResponse.payload;
      if (this.destination(contact, inbox)?.id !== target)
        throw this.rejected(
          'The selected NeuralTalk destination is no longer available in this inbox.'
        );
      recipients.push({
        target,
        contactId,
        sourceId: contact.contact_inboxes.find(
          (item: any) => String(item.inbox?.id) === inbox.id
        ).source_id,
      });
    }
    const deliveries: Delivery[] = [];
    for (const recipient of recipients) {
      const payloadHash = createHash('sha256')
        .update(
          JSON.stringify({
            baseUrl: auth.baseUrl,
            accountId: auth.accountId,
            inboxId: auth.inboxId,
            content,
            media: post.media || [],
            target: recipient.target,
          })
        )
        .digest('hex');
      const receipt = await this.receipts.execute(
        {
          organizationId: integration.organizationId,
          profileId: integration.profileId,
          integrationId: integration.id,
          postId: post.id,
          target: recipient.target,
          payloadHash,
        },
        async () => {
          const conversation = await this.request(
            auth,
            this.path(auth) + '/conversations',
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                inbox_id: Number(inbox.id),
                contact_id: Number(recipient.contactId),
                source_id: recipient.sourceId,
              }),
            }
          );
          if (
            !/^[1-9]\d*$/.test(String(conversation.id)) ||
            String(conversation.inbox_id) !== inbox.id ||
            String(conversation.meta?.sender?.id) !== recipient.contactId
          )
            throw new NeuralTalkDeliveryError('unknown');
          const data = {
            content,
            message_type: 'outgoing',
            private: false,
            content_attributes: {
              mali_post_delivery_id: createHash('sha256')
                .update(`${integration.id}|${post.id}|${recipient.target}`)
                .digest('hex'),
            },
          };
          const body = post.media?.length
            ? await this.mediaBody(post.media, data)
            : {
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data),
              };
          const message = await this.request(
            auth,
            this.path(auth) + `/conversations/${conversation.id}/messages`,
            { method: 'POST', ...body }
          );
          if (!/^[1-9]\d*$/.test(String(message.id)))
            throw new NeuralTalkDeliveryError('unknown');
          return {
            conversationId: String(conversation.id),
            messageId: String(message.id),
          };
        }
      );
      deliveries.push({ ...receipt, target: recipient.target });
    }
    return [
      {
        id: post.id,
        postId: deliveries[0].messageId,
        releaseURL: this.conversationUrl(auth, deliveries[0].conversationId),
        status: 'pending',
        pendingData: { deliveries },
      },
    ];
  }

  private async mediaBody(
    media: MediaContent[],
    data: Record<string, unknown>
  ) {
    const boundary = `MaliPosts-${randomUUID()}`;
    // Stream media without sending the NeuralTalk credential to storage hosts.
    for (const item of media) {
      if (!(await isSafePublicHttpsUrl(item.path)))
        throw this.rejected(
          'A media URL is unavailable for NeuralTalk upload.'
        );
    }
    async function* parts() {
      for (const [name, value] of Object.entries(data))
        yield Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${
            typeof value === 'object' ? JSON.stringify(value) : String(value)
          }\r\n`
        );
      for (let index = 0; index < media.length; index++) {
        const response = await ssrfSafeFetch(media[index].path, {
          redirect: 'error',
          signal: AbortSignal.timeout(120000),
        });
        const mime = response.headers.get('content-type')?.split(';')[0] || '';
        if (
          !response.ok ||
          !response.body ||
          !/^(image|video)\/[a-z0-9.+-]+$/i.test(mime) ||
          Number(response.headers.get('content-length') || 0) > MAX_MEDIA_BYTES
        ) {
          await response.body?.cancel();
          throw new Error('Media upload unavailable.');
        }
        yield Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="attachments[]"; filename="media-${
            index + 1
          }.${mime
            .split('/')[1]
            .replace('jpeg', 'jpg')}"\r\nContent-Type: ${mime}\r\n\r\n`
        );
        const reader = response.body.getReader();
        let bytes = 0;
        try {
          for (;;) {
            const chunk = await reader.read();
            if (chunk.done) break;
            bytes += chunk.value.byteLength;
            if (bytes > MAX_MEDIA_BYTES)
              throw new Error('Media upload limit exceeded.');
            yield chunk.value;
          }
        } finally {
          await reader.cancel().catch(() => undefined);
        }
        yield Buffer.from('\r\n');
      }
      yield Buffer.from(`--${boundary}--\r\n`);
    }
    return {
      headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
      body: Readable.from(parts()) as unknown as BodyInit,
      duplex: 'half' as const,
    };
  }
  private conversationUrl(auth: NeuralTalkCredentials, conversationId: string) {
    return `${auth.baseUrl}/app/accounts/${auth.accountId}/conversations/${conversationId}`;
  }
  override async checkPostStatus(
    accessToken: string,
    value: unknown,
    _integration: Integration
  ): Promise<PendingCheckResponse> {
    const auth = this.credentials(accessToken, true);
    const pending = value as Pending;
    if (
      !Array.isArray(pending?.deliveries) ||
      pending.deliveries.length < 1 ||
      pending.deliveries.length > 50 ||
      pending.deliveries.some(
        (item) =>
          !/^[1-9]\d*$/.test(item.conversationId) ||
          !/^[1-9]\d*$/.test(item.messageId)
      )
    )
      throw this.rejected('Invalid NeuralTalk delivery status reference.');
    let complete = true;
    for (const delivery of pending.deliveries) {
      const data = await this.request(
        auth,
        this.path(auth) +
          `/conversations/${delivery.conversationId}/messages?around=${delivery.messageId}`
      );
      const message = data.payload?.find(
        (item: any) =>
          String(item.id) === delivery.messageId &&
          String(item.inbox_id) === auth.inboxId &&
          String(item.conversation_id) === delivery.conversationId
      );
      if (!message)
        throw this.rejected(
          'The NeuralTalk message could not be confirmed in this inbox.'
        );
      if (message.status === 'failed')
        throw this.rejected(
          'NeuralTalk message delivery failed. Check the conversation before retrying.'
        );
      if (
        !message.source_id &&
        message.status !== 'delivered' &&
        message.status !== 'read'
      )
        complete = false;
    }
    return complete
      ? {
          status: 'completed',
          postId: pending.deliveries.map((item) => item.messageId).join(','),
          releaseURL: this.conversationUrl(
            auth,
            pending.deliveries[0].conversationId
          ),
        }
      : { status: 'pending', pendingData: pending };
  }
}
