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
  instanceCredentialGroups,
  instanceCredentialKeys,
  isSecretCredential,
} from '@gitroom/nestjs-libraries/database/prisma/instance-credentials/instance.credentials.list';

// Credentials saved in the panel override the environment variables with the
// same name. Every process (backend, orchestrator) applies them at boot and
// every minute, so a change needs no restart; deleting one restores the .env value.
@Injectable()
export class InstanceCredentialsService
  implements OnModuleInit, OnModuleDestroy
{
  private _fromEnv: Record<string, string | undefined> = {};
  private _fromPanel = new Set<string>();
  private _timer?: NodeJS.Timeout;

  constructor(private _repository: InstanceCredentialsRepository) {}

  async onModuleInit() {
    for (const key of instanceCredentialKeys) {
      this._fromEnv[key] = process.env[key];
    }
    await this.apply();
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
      Logger.warn('Could not load instance credentials, keeping the environment');
    }
  }

  list() {
    const frontend = process.env.FRONTEND_URL;
    return instanceCredentialGroups.map((group) => ({
      name: group.name,
      docs: group.docs,
      redirectUris: group.identifiers.map(
        (identifier) => `${frontend}/integrations/social/${identifier}`
      ),
      keys: group.keys.map((key) => {
        const value = process.env[key];
        const secret = isSecretCredential(key);
        return {
          key,
          secret,
          source: this._fromPanel.has(key)
            ? 'panel'
            : this._fromEnv[key]
            ? 'env'
            : 'none',
          // secrets never leave the server, only their last characters
          value: !value ? '' : secret ? `••••${value.slice(-4)}` : value,
        };
      }),
    }));
  }

  async save(values: Record<string, string | null>, userId: string) {
    const keys = Object.keys(values);
    const unknown = keys.filter((key) => !instanceCredentialKeys.includes(key));
    if (unknown.length) {
      throw new HttpException(`Unknown credentials: ${unknown.join(', ')}`, 400);
    }
    const invalid = keys.filter(
      (key) =>
        values[key] !== null &&
        (typeof values[key] !== 'string' || values[key]!.length > 4096)
    );
    if (invalid.length) {
      throw new HttpException(`Invalid values for: ${invalid.join(', ')}`, 400);
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
