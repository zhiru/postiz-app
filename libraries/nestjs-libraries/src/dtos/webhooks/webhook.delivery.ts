import { createHmac } from 'crypto';
import { getSsrfSafeDispatcher } from './ssrf.safe.dispatcher';

export const WEBHOOK_EVENTS = [
  'post.published',
  'post.failed',
  'post.deleted',
] as const;

export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

// Webhooks created before events existed have an empty list and must keep
// behaving exactly as they did: publish only.
export const DEFAULT_WEBHOOK_EVENTS: WebhookEvent[] = ['post.published'];

export const webhookSubscribesTo = (
  events: string[] | undefined | null,
  event: WebhookEvent
) => (events?.length ? events : DEFAULT_WEBHOOK_EVENTS).includes(event);

// Signed payload is `<timestamp>.<body>` so a captured request can't be
// replayed later with the same signature - the receiver rejects a timestamp
// that drifted too far from its own clock.
export const signWebhookBody = (
  secret: string,
  timestamp: number,
  body: string
) =>
  'sha256=' +
  createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');

export interface WebhookDeliveryResult {
  success: boolean;
  statusCode?: number;
  attempts: number;
  error?: string;
}

export const deliverWebhook = async (
  url: string,
  body: string,
  options: {
    event: WebhookEvent;
    secret?: string | null;
    maxAttempts?: number;
    timeoutMs?: number;
    backoffMs?: number;
  }
): Promise<WebhookDeliveryResult> => {
  const maxAttempts = options.maxAttempts ?? 3;
  const backoffMs = options.backoffMs ?? 1000;
  const timeoutMs = options.timeoutMs ?? 30000;

  let last: WebhookDeliveryResult = {
    success: false,
    attempts: 0,
    error: 'not attempted',
  };

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const timestamp = Date.now();
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'X-Postiz-Event': options.event,
        'X-Postiz-Timestamp': String(timestamp),
      };

      // Webhooks saved before secrets existed have none - they keep receiving
      // the exact same request they always did.
      if (options.secret) {
        headers['X-Postiz-Signature'] = signWebhookBody(
          options.secret,
          timestamp,
          body
        );
      }

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body,
        signal: AbortSignal.timeout(timeoutMs),
        // url is validated at save time, but DNS can change between then and
        // now - pin resolution like every other user-influenced request.
        // @ts-ignore — undici option, not in lib.dom fetch types
        dispatcher: getSsrfSafeDispatcher(),
      });

      last = {
        success: response.ok,
        statusCode: response.status,
        attempts: attempt,
        ...(response.ok ? {} : { error: `HTTP ${response.status}` }),
      };

      if (response.ok) {
        return last;
      }
    } catch (err: any) {
      last = {
        success: false,
        attempts: attempt,
        error: String(err?.message || err),
      };
    }

    if (attempt < maxAttempts) {
      await new Promise((resolve) =>
        setTimeout(resolve, backoffMs * Math.pow(2, attempt - 1))
      );
    }
  }

  return last;
};
