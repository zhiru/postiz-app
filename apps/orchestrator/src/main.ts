import { initializeSentry } from '@gitroom/nestjs-libraries/sentry/initialize.sentry';
initializeSentry('orchestrator', true);
// Same as the backend: apply the panel settings before anything that reads
// them at import time is loaded.
import { loadInstanceCredentials } from '@gitroom/nestjs-libraries/database/prisma/instance-credentials/instance.credentials.bootstrap';

loadInstanceCredentials().then(() => {
  // Keep in sync with apps/backend/src/main.ts: normalize a trailing slash
  // once at boot, after the panel settings are applied.
  for (const key of ['FRONTEND_URL', 'MAIN_URL', 'NEXT_PUBLIC_BACKEND_URL']) {
    if (process.env[key]) {
      process.env[key] = process.env[key]!.replace(/\/+$/, '');
    }
  }
  return import('./start');
});
