import { PrismaClient } from '@prisma/client';
import { AuthService } from '@gitroom/helpers/auth/auth.service';
import { instanceCredentialKeys } from '@gitroom/nestjs-libraries/database/prisma/instance-credentials/instance.credentials.list';

// Several settings are read while the modules that use them are still being
// imported (module-scope e-mail transporters, the throttler of app.module, the
// storage of every `private storage = UploadFactory.createStorage()`), which is
// long before any Nest lifecycle hook runs. This puts the values saved in the
// panel into process.env before that import happens, so restarting the
// processes is all those settings need.
// Must never stop the app from booting: on any failure the .env is kept.
export const loadInstanceCredentials = async () => {
  const prisma = new PrismaClient();
  try {
    for (const row of await prisma.instanceCredential.findMany()) {
      if (!instanceCredentialKeys.includes(row.key)) {
        continue;
      }
      try {
        process.env[row.key] = AuthService.fixedDecryption(row.value);
      } catch (err) {
        console.warn(`Could not decrypt instance credential ${row.key}`);
      }
    }
  } catch (err) {
    console.warn(
      'Could not load instance credentials at boot, keeping the environment'
    );
  } finally {
    await prisma.$disconnect().catch(() => undefined);
  }
};
