// Run: node --test libraries/nestjs-libraries/src/integrations/social/meta.graph.spec.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { graphPaginate } from './meta.graph.ts';

const realFetch = globalThis.fetch;
test.afterEach(() => {
  globalThis.fetch = realFetch;
});

test('endless paging.next terminates at the page cap', async () => {
  let calls = 0;
  globalThis.fetch = (async (url: string) => {
    calls++;
    return { json: async () => ({ data: [{ id: calls }], paging: { next: `${url}&n=${calls}` } }) };
  }) as any;
  const items = await graphPaginate('https://graph.test/me/accounts', { maxPages: 20 });
  assert.equal(calls, 20);
  assert.equal(items.length, 20);
});

test('repeated next url stops immediately', async () => {
  let calls = 0;
  globalThis.fetch = (async (url: string) => {
    calls++;
    return { json: async () => ({ data: [], paging: { next: url } }) };
  }) as any;
  await graphPaginate('https://graph.test/x');
  assert.equal(calls, 1);
});

test('a fetch that never resolves is aborted by the timeout', async () => {
  globalThis.fetch = ((_url: string, init: RequestInit) =>
    new Promise((_res, rej) =>
      init.signal!.addEventListener('abort', () => rej(init.signal!.reason))
    )) as any;
  const t0 = Date.now();
  const keepAlive = setInterval(() => {}, 1000); // AbortSignal.timeout is unref'd
  await assert.rejects(graphPaginate('https://graph.test/x', { timeoutMs: 100 }));
  clearInterval(keepAlive);
  assert.ok(Date.now() - t0 < 2000);
});
