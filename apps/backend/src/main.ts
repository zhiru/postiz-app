import { initializeSentry } from '@gitroom/nestjs-libraries/sentry/initialize.sentry';
initializeSentry('backend', true);
// Settings saved in the panel have to be in process.env before the modules
// that read them while being imported are loaded, so the rest of the app only
// starts once they are applied.
import { loadInstanceCredentials } from '@gitroom/nestjs-libraries/database/prisma/instance-credentials/instance.credentials.bootstrap';

loadInstanceCredentials().then(() => {
  // Providers append paths directly to these, so a trailing slash in the
  // value (e.g. FRONTEND_URL=https://host.com/) produces a double slash in the
  // OAuth redirect_uri and breaks Meta's exact redirect_uri matching, plus
  // CORS origin matching in split-origin setups. Normalized after the panel
  // settings are applied, since the panel can set these too.
  for (const key of ['FRONTEND_URL', 'MAIN_URL', 'NEXT_PUBLIC_BACKEND_URL']) {
    if (process.env[key]) {
      process.env[key] = process.env[key]!.replace(/\/+$/, '');
    }
  }
  return import('./start');
});
