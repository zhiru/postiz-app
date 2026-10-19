// Run: npx tsx --test libraries/nestjs-libraries/src/dtos/webhooks/webhook.delivery.spec.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'crypto';
import {
  deliverWebhook,
  signWebhookBody,
  webhookSubscribesTo,
  DEFAULT_WEBHOOK_EVENTS,
} from './webhook.delivery.ts';

const realFetch = globalThis.fetch;
test.afterEach(() => {
  globalThis.fetch = realFetch;
});

// A receiver (n8n, a Lambda, whatever) would verify like this - the signature
// has to match a verification written without looking at our implementation.
const referenceVerify = (
  secret: string,
  headers: Record<string, string>,
  body: string
) => {
  const expected = createHmac('sha256', secret)
    .update(`${headers['X-Postiz-Timestamp']}.${body}`)
    .digest('hex');
  return headers['X-Postiz-Signature'] === `sha256=${expected}`;
};

test('signature matches an independent HMAC-SHA256 verification', async () => {
  let seen: any;
  globalThis.fetch = (async (_url: string, init: any) => {
    seen = init;
    return { ok: true, status: 200 };
  }) as any;

  const body = JSON.stringify([{ id: 'post-1' }]);
  const result = await deliverWebhook('https://hook.test/x', body, {
    event: 'post.published',
    secret: 'super-secret',
  });

  assert.equal(result.success, true);
  assert.equal(seen.headers['X-Postiz-Event'], 'post.published');
  assert.ok(referenceVerify('super-secret', seen.headers, body));
});

test('signing the same body with a different timestamp gives a different signature', () => {
  const body = '{"a":1}';
  assert.notEqual(
    signWebhookBody('s', 1000, body),
    signWebhookBody('s', 2000, body)
  );
});

test('a webhook without a secret gets no signature headers (old webhooks keep working)', async () => {
  let seen: any;
  globalThis.fetch = (async (_url: string, init: any) => {
    seen = init;
    return { ok: true, status: 200 };
  }) as any;

  await deliverWebhook('https://hook.test/x', '[]', {
    event: 'post.published',
  });

  assert.equal(seen.headers['X-Postiz-Signature'], undefined);
  assert.equal(seen.body, '[]');
});

test('retries up to three times and reports the last failure', async () => {
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    return { ok: false, status: 500 };
  }) as any;

  const result = await deliverWebhook('https://hook.test/x', '[]', {
    event: 'post.failed',
    backoffMs: 0,
  });

  assert.equal(calls, 3);
  assert.deepEqual(result, {
    success: false,
    statusCode: 500,
    attempts: 3,
    error: 'HTTP 500',
  });
});

test('stops retrying as soon as a delivery succeeds', async () => {
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    return calls === 2 ? { ok: true, status: 204 } : { ok: false, status: 503 };
  }) as any;

  const result = await deliverWebhook('https://hook.test/x', '[]', {
    event: 'post.published',
    backoffMs: 0,
  });

  assert.equal(calls, 2);
  assert.equal(result.success, true);
  assert.equal(result.attempts, 2);
});

test('a thrown network error is reported, not swallowed', async () => {
  globalThis.fetch = (async () => {
    throw new Error('ECONNREFUSED');
  }) as any;

  const result = await deliverWebhook('https://hook.test/x', '[]', {
    event: 'post.published',
    maxAttempts: 2,
    backoffMs: 0,
  });

  assert.equal(result.success, false);
  assert.equal(result.attempts, 2);
  assert.equal(result.error, 'ECONNREFUSED');
});

test('an empty event list means post.published only (backwards compatibility)', () => {
  assert.deepEqual(DEFAULT_WEBHOOK_EVENTS, ['post.published']);
  assert.equal(webhookSubscribesTo([], 'post.published'), true);
  assert.equal(webhookSubscribesTo(undefined, 'post.published'), true);
  assert.equal(webhookSubscribesTo([], 'post.failed'), false);
  assert.equal(webhookSubscribesTo(['post.failed'], 'post.published'), false);
  assert.equal(webhookSubscribesTo(['post.failed'], 'post.failed'), true);
});
