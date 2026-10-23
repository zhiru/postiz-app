import {
  Injectable,
  PreconditionFailedException,
  BadGatewayException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import {
  NeuralTalkProvider,
  NeuralTalkDeliveryError,
} from './social/neuraltalk.provider';
import { IntegrationService } from '../database/prisma/integrations/integration.service';
import { ProfileService } from '../database/prisma/profiles/profile.service';
import { EncryptionService } from '../crypto/encryption.service';
import { encryptIntegrationToken } from '../crypto/integration-token.helper';
import {
  NeuralTalkAccountDto,
  NeuralTalkConnectDto,
  NeuralTalkCredentialsDto,
} from '../dtos/integrations/neuraltalk.dto';
@Injectable()
export class NeuralTalkConnectionService {
  constructor(
    private provider: NeuralTalkProvider,
    private integrations: IntegrationService,
    private profiles: ProfileService,
    private encryption: EncryptionService
  ) {}
  private async remote<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (error instanceof NeuralTalkDeliveryError)
        throw new PreconditionFailedException(error.message);
      throw new BadGatewayException(
        'Could not reach NeuralTalk. Check the server and credential.'
      );
    }
  }
  async accounts(body: NeuralTalkCredentialsDto) {
    return { accounts: await this.remote(() => this.provider.accounts(body)) };
  }
  async inboxes(body: NeuralTalkAccountDto) {
    return { inboxes: await this.remote(() => this.provider.inboxes(body)) };
  }
  async connect(
    org: string,
    profileId: string | undefined,
    body: NeuralTalkConnectDto
  ) {
    const profile =
      profileId || (await this.profiles.getDefaultProfile(org))?.id;
    if (!profile)
      throw new PreconditionFailedException(
        'Select a profile before connecting NeuralTalk.'
      );
    const verified = await this.remote(() =>
      this.provider.validateConnection(JSON.stringify(body))
    );
    const internalId =
      'neuraltalk_' +
      createHash('sha256')
        .update(
          JSON.stringify([
            profile,
            new URL(body.baseUrl).origin,
            verified.account.id,
            verified.inbox.id,
          ])
        )
        .digest('hex');
    // Always encrypt messaging keys, including installations still migrating legacy OAuth tokens.
    const token = encryptIntegrationToken(
      this.encryption,
      verified.auth.accessToken
    );
    const integration = await this.integrations.createOrUpdateIntegration(
      undefined,
      false,
      org,
      `${verified.account.name} · ${verified.inbox.name}`,
      '/icons/platforms/neuraltalk.png',
      'social',
      internalId,
      'neuraltalk',
      token,
      '',
      undefined,
      verified.inbox.name,
      false,
      undefined,
      undefined,
      undefined,
      profile
    );
    return { id: integration.id };
  }
}
