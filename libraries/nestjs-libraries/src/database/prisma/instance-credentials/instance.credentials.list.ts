// Credentials an instance admin can set from the panel. Only these keys can be
// stored, and they override the environment variable with the same name.
// identifiers: providers whose OAuth callback is /integrations/social/<identifier>
export const instanceCredentialGroups: {
  name: string;
  identifiers: string[];
  keys: string[];
  docs?: string;
}[] = [
  { name: 'Facebook / Instagram (Meta)', identifiers: ['facebook', 'instagram'], keys: ['FACEBOOK_APP_ID', 'FACEBOOK_APP_SECRET'], docs: 'https://developers.facebook.com/apps' },
  { name: 'Instagram (Instagram Login)', identifiers: ['instagram-standalone'], keys: ['INSTAGRAM_APP_ID', 'INSTAGRAM_APP_SECRET'], docs: 'https://developers.facebook.com/apps' },
  { name: 'Threads', identifiers: ['threads'], keys: ['THREADS_APP_ID', 'THREADS_APP_SECRET'], docs: 'https://developers.facebook.com/apps' },
  { name: 'YouTube', identifiers: ['youtube'], keys: ['YOUTUBE_CLIENT_ID', 'YOUTUBE_CLIENT_SECRET'], docs: 'https://console.cloud.google.com/apis/credentials' },
  { name: 'Google Business Profile', identifiers: ['gmb'], keys: ['GOOGLE_GMB_CLIENT_ID', 'GOOGLE_GMB_CLIENT_SECRET'], docs: 'https://console.cloud.google.com/apis/credentials' },
  { name: 'TikTok', identifiers: ['tiktok'], keys: ['TIKTOK_CLIENT_ID', 'TIKTOK_CLIENT_SECRET'], docs: 'https://developers.tiktok.com/apps' },
  { name: 'TikTok Business', identifiers: ['tiktok-business'], keys: ['TIKTOK_BUSINESS_CLIENT_ID', 'TIKTOK_BUSINESS_CLIENT_SECRET'], docs: 'https://business-api.tiktok.com/portal' },
  { name: 'LinkedIn', identifiers: ['linkedin', 'linkedin-page'], keys: ['LINKEDIN_CLIENT_ID', 'LINKEDIN_CLIENT_SECRET'], docs: 'https://www.linkedin.com/developers/apps' },
  { name: 'X', identifiers: ['x'], keys: ['X_API_KEY', 'X_API_SECRET'], docs: 'https://developer.x.com/en/portal/dashboard' },
  { name: 'Pinterest', identifiers: ['pinterest'], keys: ['PINTEREST_CLIENT_ID', 'PINTEREST_CLIENT_SECRET'], docs: 'https://developers.pinterest.com/apps' },
  { name: 'Reddit', identifiers: ['reddit'], keys: ['REDDIT_CLIENT_ID', 'REDDIT_CLIENT_SECRET'], docs: 'https://www.reddit.com/prefs/apps' },
  { name: 'Discord', identifiers: ['discord'], keys: ['DISCORD_CLIENT_ID', 'DISCORD_CLIENT_SECRET', 'DISCORD_BOT_TOKEN_ID'], docs: 'https://discord.com/developers/applications' },
  { name: 'Slack', identifiers: ['slack'], keys: ['SLACK_ID', 'SLACK_SECRET'], docs: 'https://api.slack.com/apps' },
  { name: 'Mastodon', identifiers: ['mastodon'], keys: ['MASTODON_URL', 'MASTODON_CLIENT_ID', 'MASTODON_CLIENT_SECRET'] },
  { name: 'Dribbble', identifiers: ['dribbble'], keys: ['DRIBBBLE_CLIENT_ID', 'DRIBBBLE_CLIENT_SECRET'] },
  { name: 'Tumblr', identifiers: ['tumblr'], keys: ['TUMBLR_CLIENT_ID', 'TUMBLR_CLIENT_SECRET'] },
  { name: 'Twitch', identifiers: ['twitch'], keys: ['TWITCH_CLIENT_ID', 'TWITCH_CLIENT_SECRET'] },
  { name: 'Kick', identifiers: ['kick'], keys: ['KICK_CLIENT_ID', 'KICK_SECRET'] },
  { name: 'VK', identifiers: ['vk'], keys: ['VK_ID'] },
  { name: 'Whop', identifiers: ['whop'], keys: ['WHOP_CLIENT_ID'] },
  { name: 'MeWe', identifiers: ['mewe'], keys: ['MEWE_APP_ID', 'MEWE_API_KEY', 'MEWE_HOST'] },
  { name: 'Farcaster (Neynar)', identifiers: ['wrapcast'], keys: ['NEYNAR_CLIENT_ID', 'NEYNAR_SECRET_KEY', 'NEYNAR_APP_FID', 'NEYNAR_APP_MNEMONIC', 'NEYNAR_SPONSOR_SIGNERS'] },
  // read once at boot by the provider: needs a restart after changing
  { name: 'Telegram', identifiers: [], keys: ['TELEGRAM_TOKEN'] },
  { name: 'AI (Agent, AI images)', identifiers: [], keys: ['OPENAI_API_KEY'], docs: 'https://platform.openai.com/api-keys' },
];

export const instanceCredentialKeys = instanceCredentialGroups.flatMap(
  (group) => group.keys
);

export const isSecretCredential = (key: string) =>
  /SECRET|TOKEN|MNEMONIC|API_KEY/.test(key);
