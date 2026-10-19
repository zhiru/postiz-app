// Run: npx tsx --test libraries/nestjs-libraries/src/database/prisma/instance-credentials/instance.credentials.spec.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bootstrapKeys,
  credentialClass,
  instanceCredentialKeys,
  instanceCredentialListedKeys,
  isSecretCredential,
  isWritableCredential,
  maskCredential,
} from './instance.credentials.list.ts';

test('a secret is masked down to its last characters', () => {
  assert.equal(
    maskCredential('FACEBOOK_APP_SECRET', 'abcdefghijklmnop'),
    '••••mnop'
  );
  assert.equal(maskCredential('EMAIL_PASS', 'abcdefghij'), '••••ghij');
});

test('a short secret is masked whole, the last characters would give it away', () => {
  assert.equal(maskCredential('FACEBOOK_APP_SECRET', 'abc123'), '••••');
  assert.equal(maskCredential('FACEBOOK_APP_SECRET', '12345678'), '••••');
});

test('a value that is not a secret is returned as it is', () => {
  assert.equal(maskCredential('FACEBOOK_APP_ID', '1234567890'), '1234567890');
  assert.equal(maskCredential('STORAGE_PROVIDER', 'cloudflare'), 'cloudflare');
});

test('an empty value stays empty instead of being masked', () => {
  assert.equal(maskCredential('FACEBOOK_APP_SECRET', ''), '');
  assert.equal(maskCredential('FACEBOOK_APP_SECRET', undefined), '');
});

test('passwords and tokens count as secrets', () => {
  for (const key of [
    'EMAIL_PASS',
    'TELEGRAM_TOKEN',
    'OPENAI_API_KEY',
    'NEYNAR_APP_MNEMONIC',
    'CLOUDFLARE_SECRET_ACCESS_KEY',
  ]) {
    assert.equal(isSecretCredential(key), true, key);
  }
  for (const key of ['FACEBOOK_APP_ID', 'EMAIL_HOST', 'API_LIMIT']) {
    assert.equal(isSecretCredential(key), false, key);
  }
});

test('a bootstrap key is never writable and never reaches the saveable list', () => {
  for (const key of bootstrapKeys) {
    assert.equal(isWritableCredential(key), false, key);
    assert.equal(instanceCredentialKeys.includes(key), false, key);
    assert.equal(instanceCredentialListedKeys.includes(key), false, key);
  }
  assert.deepEqual(bootstrapKeys, [
    'DATABASE_URL',
    'REDIS_URL',
    'JWT_SECRET',
    'TEMPORAL_ADDRESS',
    'TEMPORAL_NAMESPACE',
  ]);
});

test('a NEXT_PUBLIC key is listed but never saveable, it needs a rebuild', () => {
  const key = 'NEXT_PUBLIC_SENTRY_DSN';
  assert.equal(credentialClass(key), 'rebuild');
  assert.equal(isWritableCredential(key), false);
  assert.equal(instanceCredentialListedKeys.includes(key), true);
  assert.equal(instanceCredentialKeys.includes(key), false);
});

test('settings read at boot are classified as needing a restart', () => {
  for (const key of [
    'STORAGE_PROVIDER',
    'TELEGRAM_TOKEN',
    'RESEND_API_KEY',
    'API_LIMIT',
    'RUN_CRON',
  ]) {
    assert.equal(credentialClass(key), 'restart', key);
  }
});

test('settings read on every call apply without a restart', () => {
  for (const key of [
    'FACEBOOK_APP_SECRET',
    'MAX_ORGS_PER_USER',
    'HIDDEN_PROVIDERS',
    'DISABLE_REGISTRATION',
    'FRONTEND_URL',
  ]) {
    assert.equal(credentialClass(key), 'live', key);
  }
});

test('no listed key that holds a credential is returned unmasked', () => {
  for (const key of instanceCredentialListedKeys) {
    if (/KEY|SECRET|TOKEN|MNEMONIC|_PASS$/.test(key)) {
      assert.equal(isSecretCredential(key), true, key);
      assert.equal(maskCredential(key, 'abcdefghijklmnop'), '••••mnop', key);
    }
  }
});

test('every saveable key is writable and listed exactly once', () => {
  for (const key of instanceCredentialKeys) {
    assert.equal(isWritableCredential(key), true, key);
  }
  const seen = new Set<string>();
  for (const key of instanceCredentialListedKeys) {
    assert.equal(seen.has(key), false, `${key} is listed twice`);
    seen.add(key);
  }
});
