import {
  Injectable,
  PreconditionFailedException,
  BadGatewayException,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import {
  NeuralTalkProvider,
  NeuralTalkDeliveryError,
  NeuralTalkCredentials,
} from './social/neuraltalk.provider';
import { IntegrationService } from '../database/prisma/integrations/integration.service';
import { ProfileService } from '../database/prisma/profiles/profile.service';
import { EncryptionService } from '../crypto/encryption.service';
import {
  decryptIntegrationToken,
  encryptIntegrationToken,
} from '../crypto/integration-token.helper';
import { CredentialService } from '../database/prisma/credentials/credential.service';
import {
  NeuralTalkAccountDto,
  NeuralTalkConnectDto,
  NeuralTalkCredentialsDto,
  NeuralTalkAccountsDto,
} from '../dtos/integrations/neuraltalk.dto';
@Injectable()
export class NeuralTalkConnectionService {
  constructor(
    private provider: NeuralTalkProvider,
    private integrations: IntegrationService,
    private profiles: ProfileService,
    private encryption: EncryptionService,
    private credentials: CredentialService
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
  private async profile(org: string, profileId: string | undefined) {
    const profile =
      profileId || (await this.profiles.getDefaultProfile(org))?.id;
    if (!profile)
      throw new PreconditionFailedException(
        'Select a profile before connecting NeuralTalk.'
      );
    return profile;
  }

  private async resolveCredentials(
    org: string,
    profile: string,
    body: NeuralTalkCredentialsDto
  ): Promise<NeuralTalkCredentials> {
    if (body.useSavedConnection === true || body.savedIntegrationId) {
      if (
        body.baseUrl !== undefined ||
        body.apiToken !== undefined ||
        (body.useSavedConnection === true && body.savedIntegrationId)
      )
        throw new BadRequestException(
          'Choose only one NeuralTalk connection source.'
        );
      if (body.savedIntegrationId) {
        const channel = await this.integrations.getIntegrationById(
          org,
          body.savedIntegrationId
        );
        if (
          !channel ||
          channel.organizationId !== org ||
          channel.profileId !== profile ||
          channel.providerIdentifier !== 'neuraltalk' ||
          channel.disabled ||
          channel.deletedAt
        )
          throw new NotFoundException(
            'NeuralTalk connection not found in this profile.'
          );
        try {
          const saved = JSON.parse(
            decryptIntegrationToken(this.encryption, channel.token)
          );
          if (
            typeof saved.baseUrl !== 'string' ||
            typeof saved.apiToken !== 'string'
          )
            throw new Error();
          return { baseUrl: saved.baseUrl, apiToken: saved.apiToken };
        } catch {
          throw new PreconditionFailedException(
            'Reconnect this NeuralTalk channel before reusing it.'
          );
        }
      }
      // A messaging token is personal: never inherit it from another profile.
      const saved = await this.credentials.getRaw(org, 'neuraltalk', profile);
      if (!saved?.baseUrl || !saved.apiToken)
        throw new PreconditionFailedException(
          'No default NeuralTalk connection is saved for this profile.'
        );
      return { baseUrl: saved.baseUrl, apiToken: saved.apiToken };
    }
    if (!body.baseUrl || !body.apiToken)
      throw new BadRequestException(
        'A NeuralTalk URL and API token are required.'
      );
    return { baseUrl: body.baseUrl, apiToken: body.apiToken };
  }

  async defaultConnection(org: string, profileId: string | undefined) {
    const profile = await this.profile(org, profileId);
    const [saved, channels] = await Promise.all([
      this.credentials.getRaw(org, 'neuraltalk', profile),
      this.integrations.getIntegrationsList(org, profile),
    ]);
    const configured = Boolean(saved?.baseUrl && saved.apiToken);
    return {
      configured,
      ...(configured ? { baseUrl: new URL(saved!.baseUrl).origin } : {}),
      connections: channels
        .filter(
          (channel) =>
            channel.organizationId === org &&
            channel.profileId === profile &&
            channel.providerIdentifier === 'neuraltalk' &&
            !channel.disabled &&
            !channel.deletedAt
        )
        .map(({ id, name }) => ({ id, name })),
    };
  }

  async removeDefaultConnection(org: string, profileId: string | undefined) {
    const profile = await this.profile(org, profileId);
    await this.credentials.delete(org, 'neuraltalk', profile);
    return { configured: false };
  }

  async accounts(
    org: string,
    profileId: string | undefined,
    body: NeuralTalkAccountsDto
  ) {
    const profile = await this.profile(org, profileId);
    const auth = await this.resolveCredentials(org, profile, body);
    const accounts = await this.remote(() => this.provider.accounts(auth));
    if (body.saveAsDefault === true) {
      await this.credentials.save(
        org,
        'neuraltalk',
        {
          baseUrl: new URL(auth.baseUrl).origin,
          apiToken: auth.apiToken,
        },
        profile
      );
    }
    return { accounts };
  }

  async inboxes(
    org: string,
    profileId: string | undefined,
    body: NeuralTalkAccountDto
  ) {
    const profile = await this.profile(org, profileId);
    const auth = await this.resolveCredentials(org, profile, body);
    return {
      inboxes: await this.remote(() =>
        this.provider.inboxes({ ...auth, accountId: body.accountId })
      ),
    };
  }
  async connect(
    org: string,
    profileId: string | undefined,
    body: NeuralTalkConnectDto
  ) {
    const profile = await this.profile(org, profileId);
    const auth = await this.resolveCredentials(org, profile, body);
    const verified = await this.remote(() =>
      this.provider.validateConnection(
        JSON.stringify({
          ...auth,
          accountId: body.accountId,
          inboxId: body.inboxId,
        })
      )
    );
    const internalId =
      'neuraltalk_' +
      createHash('sha256')
        .update(
          JSON.stringify([
            profile,
            new URL(auth.baseUrl).origin,
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
