import { initializeSentry } from '@gitroom/nestjs-libraries/sentry/initialize.sentry';
initializeSentry('orchestrator', true);
// Same as the backend: apply the panel settings before anything that reads
// them at import time is loaded.
import { loadInstanceCredentials } from '@gitroom/nestjs-libraries/database/prisma/instance-credentials/instance.credentials.bootstrap';

loadInstanceCredentials().then(() => import('./start'));
