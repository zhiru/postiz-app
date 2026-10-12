// Runtime settings an instance admin can see and set from the panel. Only the
// writable keys below can be stored, and they override the environment variable
// with the same name.
// identifiers: providers whose OAuth callback is /integrations/social/<identifier>
export type InstanceCredentialCategory =
  | 'networks'
  | 'ai'
  | 'email'
  | 'storage'
  | 'limits'
  | 'flags'
  | 'urls'
  | 'monitoring';

export const instanceCredentialGroups: {
  name: string;
  category: InstanceCredentialCategory;
  identifiers: string[];
  keys: string[];
  docs?: string;
}[] = [
  { name: 'Facebook / Instagram (Meta)', category: 'networks', identifiers: ['facebook', 'instagram'], keys: ['FACEBOOK_APP_ID', 'FACEBOOK_APP_SECRET'], docs: 'https://developers.facebook.com/apps' },
  { name: 'Instagram (Instagram Login)', category: 'networks', identifiers: ['instagram-standalone'], keys: ['INSTAGRAM_APP_ID', 'INSTAGRAM_APP_SECRET'], docs: 'https://developers.facebook.com/apps' },
  { name: 'Threads', category: 'networks', identifiers: ['threads'], keys: ['THREADS_APP_ID', 'THREADS_APP_SECRET'], docs: 'https://developers.facebook.com/apps' },
  { name: 'YouTube', category: 'networks', identifiers: ['youtube'], keys: ['YOUTUBE_CLIENT_ID', 'YOUTUBE_CLIENT_SECRET'], docs: 'https://console.cloud.google.com/apis/credentials' },
  { name: 'Google Business Profile', category: 'networks', identifiers: ['gmb'], keys: ['GOOGLE_GMB_CLIENT_ID', 'GOOGLE_GMB_CLIENT_SECRET'], docs: 'https://console.cloud.google.com/apis/credentials' },
  { name: 'TikTok', category: 'networks', identifiers: ['tiktok'], keys: ['TIKTOK_CLIENT_ID', 'TIKTOK_CLIENT_SECRET'], docs: 'https://developers.tiktok.com/apps' },
  { name: 'TikTok Business', category: 'networks', identifiers: ['tiktok-business'], keys: ['TIKTOK_BUSINESS_CLIENT_ID', 'TIKTOK_BUSINESS_CLIENT_SECRET'], docs: 'https://business-api.tiktok.com/portal' },
  { name: 'LinkedIn', category: 'networks', identifiers: ['linkedin', 'linkedin-page'], keys: ['LINKEDIN_CLIENT_ID', 'LINKEDIN_CLIENT_SECRET'], docs: 'https://www.linkedin.com/developers/apps' },
  { name: 'X', category: 'networks', identifiers: ['x'], keys: ['X_API_KEY', 'X_API_SECRET'], docs: 'https://developer.x.com/en/portal/dashboard' },
  { name: 'Pinterest', category: 'networks', identifiers: ['pinterest'], keys: ['PINTEREST_CLIENT_ID', 'PINTEREST_CLIENT_SECRET'], docs: 'https://developers.pinterest.com/apps' },
  { name: 'Reddit', category: 'networks', identifiers: ['reddit'], keys: ['REDDIT_CLIENT_ID', 'REDDIT_CLIENT_SECRET'], docs: 'https://www.reddit.com/prefs/apps' },
  { name: 'Discord', category: 'networks', identifiers: ['discord'], keys: ['DISCORD_CLIENT_ID', 'DISCORD_CLIENT_SECRET', 'DISCORD_BOT_TOKEN_ID'], docs: 'https://discord.com/developers/applications' },
  { name: 'Slack', category: 'networks', identifiers: ['slack'], keys: ['SLACK_ID', 'SLACK_SECRET'], docs: 'https://api.slack.com/apps' },
  { name: 'Mastodon', category: 'networks', identifiers: ['mastodon'], keys: ['MASTODON_URL', 'MASTODON_CLIENT_ID', 'MASTODON_CLIENT_SECRET'] },
  { name: 'Dribbble', category: 'networks', identifiers: ['dribbble'], keys: ['DRIBBBLE_CLIENT_ID', 'DRIBBBLE_CLIENT_SECRET'] },
  { name: 'Tumblr', category: 'networks', identifiers: ['tumblr'], keys: ['TUMBLR_CLIENT_ID', 'TUMBLR_CLIENT_SECRET'] },
  { name: 'Twitch', category: 'networks', identifiers: ['twitch'], keys: ['TWITCH_CLIENT_ID', 'TWITCH_CLIENT_SECRET'] },
  { name: 'Kick', category: 'networks', identifiers: ['kick'], keys: ['KICK_CLIENT_ID', 'KICK_SECRET'] },
  { name: 'VK', category: 'networks', identifiers: ['vk'], keys: ['VK_ID'] },
  { name: 'Whop', category: 'networks', identifiers: ['whop'], keys: ['WHOP_CLIENT_ID'] },
  { name: 'MeWe', category: 'networks', identifiers: ['mewe'], keys: ['MEWE_APP_ID', 'MEWE_API_KEY', 'MEWE_HOST'] },
  { name: 'Farcaster (Neynar)', category: 'networks', identifiers: ['wrapcast'], keys: ['NEYNAR_CLIENT_ID', 'NEYNAR_SECRET_KEY', 'NEYNAR_APP_FID', 'NEYNAR_APP_MNEMONIC', 'NEYNAR_SPONSOR_SIGNERS'] },
  // read once at boot by the provider: needs a restart after changing
  { name: 'Telegram', category: 'networks', identifiers: [], keys: ['TELEGRAM_TOKEN'] },

  { name: 'AI (Agent, AI images)', category: 'ai', identifiers: [], keys: ['OPENAI_API_KEY', 'FAL_KEY'], docs: 'https://platform.openai.com/api-keys' },
  { name: 'Audio and research', category: 'ai', identifiers: [], keys: ['ELEVENSLABS_API_KEY', 'DEEPGRAM_API_KEY', 'TAVILY_API_KEY'] },

  { name: 'E-mail', category: 'email', identifiers: [], keys: ['EMAIL_PROVIDER', 'EMAIL_FROM_ADDRESS', 'EMAIL_FROM_NAME'] },
  { name: 'E-mail (SMTP)', category: 'email', identifiers: [], keys: ['EMAIL_HOST', 'EMAIL_PORT', 'EMAIL_SECURE', 'EMAIL_USER', 'EMAIL_PASS'] },
  { name: 'E-mail (Resend)', category: 'email', identifiers: [], keys: ['RESEND_API_KEY'], docs: 'https://resend.com/api-keys' },

  { name: 'Storage', category: 'storage', identifiers: [], keys: ['STORAGE_PROVIDER', 'UPLOAD_DIRECTORY', 'NEXT_PUBLIC_UPLOAD_STATIC_DIRECTORY'] },
  { name: 'Storage (Cloudflare R2)', category: 'storage', identifiers: [], keys: ['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_ACCESS_KEY', 'CLOUDFLARE_SECRET_ACCESS_KEY', 'CLOUDFLARE_REGION', 'CLOUDFLARE_BUCKETNAME', 'CLOUDFLARE_BUCKET_URL'] },

  { name: 'Limits', category: 'limits', identifiers: [], keys: ['API_LIMIT', 'MAX_ORGS_PER_USER', 'WORKER_CONCURRENCY_DIVIDER'] },

  { name: 'Flags', category: 'flags', identifiers: [], keys: ['DISABLE_REGISTRATION', 'DISALLOW_PLUS', 'HIDDEN_PROVIDERS', 'RUN_CRON', 'DISABLE_IMAGE_COMPRESSION', 'DISABLE_X_ANALYTICS', 'STRIP_LINKS_FROM_X_POSTS', 'DISABLE_SSRF_PROTECTION', 'RESTRICT_UPLOAD_DOMAINS'] },

  { name: 'Public URLs', category: 'urls', identifiers: [], keys: ['FRONTEND_URL', 'MAIN_URL', 'BACKEND_INTERNAL_URL', 'NEXT_PUBLIC_BACKEND_URL'] },

  { name: 'Sentry', category: 'monitoring', identifiers: [], keys: ['NEXT_PUBLIC_SENTRY_DSN', 'SENTRY_SPOTLIGHT'] },
  { name: 'Analytics', category: 'monitoring', identifiers: [], keys: ['NEXT_PUBLIC_POSTHOG_KEY', 'NEXT_PUBLIC_POSTHOG_HOST', 'NEXT_PUBLIC_GTM_ID', 'NEXT_PUBLIC_FACEBOOK_PIXEL', 'FACEBOOK_PIXEL_ACCESS_TOKEN', 'DATAFAST_API_KEY', 'DATAFAST_WEBSITE_ID'] },
];

// Needed before the app can read the database, or protecting the panel itself:
// never editable, only shown with an ok/missing status.
export const bootstrapKeys = [
  'DATABASE_URL',
  'REDIS_URL',
  'JWT_SECRET',
  'TEMPORAL_ADDRESS',
  'TEMPORAL_NAMESPACE',
];

// Read once at boot by the backend or the orchestrator: a panel change only
// takes effect after the processes restart.
const restartKeys = new Set([
  'TELEGRAM_TOKEN',
  'EMAIL_PROVIDER',
  'EMAIL_FROM_ADDRESS',
  'EMAIL_FROM_NAME',
  'EMAIL_HOST',
  'EMAIL_PORT',
  'EMAIL_SECURE',
  'EMAIL_USER',
  'EMAIL_PASS',
  'RESEND_API_KEY',
  'STORAGE_PROVIDER',
  'UPLOAD_DIRECTORY',
  'CLOUDFLARE_ACCOUNT_ID',
  'CLOUDFLARE_ACCESS_KEY',
  'CLOUDFLARE_SECRET_ACCESS_KEY',
  'CLOUDFLARE_REGION',
  'CLOUDFLARE_BUCKETNAME',
  'CLOUDFLARE_BUCKET_URL',
  'API_LIMIT',
  'WORKER_CONCURRENCY_DIVIDER',
  'RUN_CRON',
  'SENTRY_SPOTLIGHT',
]);

// Also read by the Next frontend, which is a separate process loading the .env
// directly: the panel value only reaches the backend and the orchestrator, so
// the .env has to be kept in sync for these.
const frontendKeys = new Set([
  'STORAGE_PROVIDER',
  'UPLOAD_DIRECTORY',
  'CLOUDFLARE_BUCKET_URL',
  'FRONTEND_URL',
  'MAIN_URL',
  'DISABLE_REGISTRATION',
  'DISABLE_IMAGE_COMPRESSION',
  'DISABLE_X_ANALYTICS',
  'SENTRY_SPOTLIGHT',
  'NEYNAR_CLIENT_ID',
  'TELEGRAM_TOKEN',
]);

// live: read on every call, applies as soon as it is saved.
// restart: read at boot, needs the "Restart services" button.
// rebuild: inlined into the frontend bundle at build time, the panel cannot
// change it at all - it is shown read-only with its .env status.
export type InstanceCredentialClass = 'live' | 'restart' | 'rebuild';

export const credentialClass = (key: string): InstanceCredentialClass =>
  key.startsWith('NEXT_PUBLIC_')
    ? 'rebuild'
    : restartKeys.has(key)
    ? 'restart'
    : 'live';

export const isFrontendCredential = (key: string) => frontendKeys.has(key);

// A rebuild key can be read but never stored, so it is not writable either.
export const isWritableCredential = (key: string) =>
  credentialClass(key) !== 'rebuild' && !bootstrapKeys.includes(key);

// every key the panel shows inside a group, writable or not
export const instanceCredentialListedKeys = instanceCredentialGroups.flatMap(
  (group) => group.keys
);

// the keys the panel may store and that apply() pushes into process.env
export const instanceCredentialKeys = instanceCredentialListedKeys.filter(
  isWritableCredential
);

export const isSecretCredential = (key: string) =>
  /KEY|SECRET|TOKEN|MNEMONIC|_PASS$/.test(key);

// secrets never leave the server, only their last characters - and nothing at
// all when the value is short enough for those to give it away
export const maskCredential = (key: string, value: string | undefined) => {
  if (!value) {
    return '';
  }
  if (!isSecretCredential(key)) {
    return value;
  }
  return value.length <= 8 ? '••••' : `••••${value.slice(-4)}`;
};
