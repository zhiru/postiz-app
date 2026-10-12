// Run: node --test libraries/nestjs-libraries/src/dtos/webhooks/webhook.url.validator.spec.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import dns from 'node:dns/promises';
import { isBlockedIp, isSafePublicHttpsUrl } from './webhook.url.validator';

const realLookup = dns.lookup;
test.afterEach(() => {
  dns.lookup = realLookup;
  delete process.env.SSRF_ALLOWED_HOSTS;
});

test('blocks a private IP by default', () => {
  assert.equal(isBlockedIp('10.0.0.5'), true);
});

test('an SSRF_ALLOWED_HOSTS CIDR entry lets its private IP through', () => {
  process.env.SSRF_ALLOWED_HOSTS = '10.0.0.0/8';
  assert.equal(isBlockedIp('10.0.0.5'), false);
});

test('an SSRF_ALLOWED_HOSTS hostname entry lets that host through even when it resolves privately', async () => {
  process.env.SSRF_ALLOWED_HOSTS = 'n8n.internal';
  dns.lookup = (async () => [{ address: '192.168.1.50', family: 4 }]) as any;
  assert.equal(await isSafePublicHttpsUrl('https://n8n.internal/webhook'), true);
});

test('a host not on the allowlist resolving privately is still blocked', async () => {
  process.env.SSRF_ALLOWED_HOSTS = 'n8n.internal';
  dns.lookup = (async () => [{ address: '192.168.1.50', family: 4 }]) as any;
  assert.equal(await isSafePublicHttpsUrl('https://other.internal/webhook'), false);
});
