import { initializeSentry } from '@gitroom/nestjs-libraries/sentry/initialize.sentry';
initializeSentry('backend', true);
// Settings saved in the panel have to be in process.env before the modules
// that read them while being imported are loaded, so the rest of the app only
// starts once they are applied.
import { loadInstanceCredentials } from '@gitroom/nestjs-libraries/database/prisma/instance-credentials/instance.credentials.bootstrap';

loadInstanceCredentials().then(() => import('./start'));
