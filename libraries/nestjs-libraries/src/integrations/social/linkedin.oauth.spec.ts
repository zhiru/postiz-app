// Run: node --test libraries/nestjs-libraries/src/integrations/social/linkedin.oauth.spec.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const providerSource = readFileSync(
  new URL('./linkedin.provider.ts', import.meta.url),
  'utf8'
);
const pageProviderSource = readFileSync(
  new URL('./linkedin.page.provider.ts', import.meta.url),
  'utf8'
);

test('personal LinkedIn OAuth requests only personal posting scopes', () => {
  const scopesBlock = providerSource.match(/scopes = \[(.*?)\]/s)?.[1];
  const scopes = scopesBlock?.match(/'[^']+'/g);

  assert.deepEqual(scopes, ["'openid'", "'profile'", "'w_member_social'"]);
});

test('LinkedIn OAuth allows interactive consent', () => {
  assert.doesNotMatch(providerSource, /prompt=none/);
  assert.doesNotMatch(pageProviderSource, /prompt=none/);
});
