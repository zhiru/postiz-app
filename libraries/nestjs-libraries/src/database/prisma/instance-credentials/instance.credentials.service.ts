import {
  HttpException,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { AuthService } from '@gitroom/helpers/auth/auth.service';
import { InstanceCredentialsRepository } from '@gitroom/nestjs-libraries/database/prisma/instance-credentials/instance.credentials.repository';
import {
  bootstrapKeys,
  credentialClass,
  instanceCredentialGroups,
  instanceCredentialKeys,
  instanceCredentialListedKeys,
  isFrontendCredential,
  isSecretCredential,
  isWritableCredential,
  maskCredential,
} from '@gitroom/nestjs-libraries/database/prisma/instance-credentials/instance.credentials.list';
import { spawn, spawnSync } from 'child_process';

// the pm2 processes of the app, as named by the `pm2` script of each app
const appProcesses = ['backend', 'orchestrator', 'frontend'];

// Settings saved in the panel override the environment variables with the same
// name. Every process (backend, orchestrator) applies them before its modules
// are imported (see instance.credentials.bootstrap.ts) and then every minute,
// so a setting read on every call needs no restart while one read at boot needs
// the processes to restart; deleting a setting restores the .env value.
@Injectable()
export class InstanceCredentialsService
  implements OnModuleInit, OnModuleDestroy
{
  private _fromEnv: Record<string, string | undefined> = {};
  private _fromPanel = new Set<string>();
  // effective value of every key when this process booted, to tell which of the
  // boot-time settings were changed since and need a restart to take effect
  private _atBoot: Record<string, string | undefined> = {};
  private _timer?: NodeJS.Timeout;

  constructor(private _repository: InstanceCredentialsRepository) {}

  async onModuleInit() {
    for (const key of instanceCredentialListedKeys.concat(bootstrapKeys)) {
      this._fromEnv[key] = process.env[key];
    }
    await this.apply();
    for (const key of instanceCredentialKeys) {
      this._atBoot[key] = process.env[key];
    }
    this._timer = setInterval(() => this.apply(), 60_000);
    this._timer.unref();
  }

  onModuleDestroy() {
    clearInterval(this._timer);
  }

  async apply() {
    try {
      const saved = new Map<string, string>();
      for (const row of await this._repository.list()) {
        try {
          saved.set(row.key, AuthService.fixedDecryption(row.value));
        } catch (err) {
          Logger.warn(`Could not decrypt instance credential ${row.key}`);
        }
      }

      this._fromPanel = new Set(saved.keys());
      for (const key of instanceCredentialKeys) {
        const value = saved.has(key) ? saved.get(key) : this._fromEnv[key];
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    } catch (err) {
      Logger.warn(
        'Could not load instance credentials, keeping the environment'
      );
    }
  }

  list() {
    const frontend = process.env.FRONTEND_URL;
    return {
      groups: instanceCredentialGroups.map((group) => ({
        name: group.name,
        category: group.category,
        docs: group.docs,
        redirectUris: group.identifiers.map(
          (identifier) => `${frontend}/integrations/social/${identifier}`
        ),
        keys: group.keys.map((key) => {
          const value = process.env[key];
          return {
            key,
            secret: isSecretCredential(key),
            class: credentialClass(key),
            writable: isWritableCredential(key),
            frontend: isFrontendCredential(key),
            source: this._fromPanel.has(key)
              ? 'panel'
              : this._fromEnv[key]
              ? 'env'
              : 'none',
            value: maskCredential(key, value),
          };
        }),
      })),
      // bootstrap settings are read before the database is reachable: status only
      bootstrap: bootstrapKeys.map((key) => ({
        key,
        present: !!this._fromEnv[key],
      })),
      restartPending: this.restartPending(),
    };
  }

  // boot-time settings whose effective value changed since this process started
  private restartPending() {
    return instanceCredentialKeys.filter(
      (key) =>
        credentialClass(key) === 'restart' &&
        this._atBoot[key] !== process.env[key]
    );
  }

  // Restarts only the app processes inside the container; the watchdog brings
  // back anything that does not answer afterwards.
  restartProcesses() {
    const check = spawnSync('pm2', ['--version'], { encoding: 'utf8' });
    if (check.error || check.status !== 0) {
      throw new HttpException(
        'pm2 is not available, restart the services by hand',
        400
      );
    }

    // restarting the backend kills this handler, so let the response flush first
    setTimeout(() => {
      spawn('pm2', ['restart', ...appProcesses], {
        detached: true,
        stdio: 'ignore',
      }).unref();
    }, 1000).unref();

    return { restarting: appProcesses };
  }

  async save(values: Record<string, string | null>, userId: string) {
    const keys = Object.keys(values);
    const readOnly = keys.filter(
      (key) =>
        instanceCredentialListedKeys.includes(key) && !isWritableCredential(key)
    );
    if (readOnly.length) {
      throw new HttpException(
        `These settings can only be changed in the .env: ${readOnly.join(
          ', '
        )}`,
        400
      );
    }
    const blocked = keys.filter((key) => bootstrapKeys.includes(key));
    if (blocked.length) {
      throw new HttpException(
        `These settings are needed before the database is reachable and cannot be set from the panel: ${blocked.join(
          ', '
        )}`,
        400
      );
    }
    const unknown = keys.filter((key) => !instanceCredentialKeys.includes(key));
    if (unknown.length) {
      throw new HttpException(
        `Unknown credentials: ${unknown.join(', ')}`,
        400
      );
    }
    const invalid = keys.filter(
      (key) =>
        values[key] !== null &&
        (typeof values[key] !== 'string' || values[key]!.length > 4096)
    );
    if (invalid.length) {
      throw new HttpException(`Invalid values for: ${invalid.join(', ')}`, 400);
    }

    const logo = values.PLATFORM_BRAND_LOGO_URL?.trim();
    if (logo) {
      try {
        const url = new URL(logo);
        if (url.protocol !== 'https:' || url.username || url.password)
          throw new Error();
      } catch {
        throw new HttpException(
          'The platform logo must be an HTTPS image URL',
          400
        );
      }
    }
    if ((values.PLATFORM_BRAND_NAME?.trim().length || 0) > 100) {
      throw new HttpException(
        'The platform name must have at most 100 characters',
        400
      );
    }

    for (const key of keys) {
      const value = values[key]?.trim();
      if (!value) {
        await this._repository.delete(key);
      } else {
        await this._repository.upsert(
          key,
          AuthService.fixedEncryption(value),
          userId
        );
      }
    }

    await this.apply();
    return this.list();
  }
}
