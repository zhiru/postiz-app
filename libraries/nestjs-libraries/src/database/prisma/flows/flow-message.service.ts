import { BadRequestException, Injectable } from '@nestjs/common';
import { FlowsRepository } from './flows.repository';
import { IntegrationService } from '../integrations/integration.service';
import { IntegrationManager } from '../../../integrations/integration.manager';
import { MediaRepository } from '../media/media.repository';
import { AutomationDeliveryService } from './automation-delivery.service';
import { InstagramMessagingService } from '../../../integrations/social/instagram-messaging.service';
import type { InstagramProvider } from '../../../integrations/social/instagram.provider';
import { resolveIgRoute } from '../../../integrations/social/instagram-route.resolver';
import { EncryptionService } from '../../../crypto/encryption.service';
import { decryptIntegrationToken } from '../../../crypto/integration-token.helper';
import { checkPublicHttpsUrl } from '../../../dtos/validators/is-public-https-url.validator';

export interface FlowSequenceMessage {
  flowId: string;
  executionId: string;
  integrationId: string;
  organizationId: string;
  nodeId: string;
  recipientId: string;
  commentId?: string;
  interactionAt?: number;
  message?: string;
  media?: { id: string; type: 'image' | 'video' };
  buttonText?: string;
  buttonUrl?: string;
}

@Injectable()
export class FlowMessageService {
  constructor(
    private flows: FlowsRepository,
    private integrations: IntegrationService,
    private manager: IntegrationManager,
    private media: MediaRepository,
    private deliveries: AutomationDeliveryService,
    private messaging: InstagramMessagingService,
    private encryption: EncryptionService
  ) {}

  async send(input: FlowSequenceMessage) {
    const flow = await this.flows.getFlowById(input.flowId);
    if (
      !flow ||
      flow.status !== 'ACTIVE' ||
      flow.deletedAt ||
      flow.organizationId !== input.organizationId ||
      flow.integrationId !== input.integrationId
    )
      throw new BadRequestException('Automation paused or unavailable.');
    const integration = await this.integrations.getIntegrationById(
      input.organizationId,
      input.integrationId
    );
    if (
      !integration ||
      integration.disabled ||
      integration.deletedAt ||
      !['instagram', 'instagram-standalone'].includes(
        integration.providerIdentifier
      ) ||
      (integration.profileId && integration.profileId !== flow.profileId)
    )
      throw new BadRequestException('Channel unavailable for this profile.');
    const privateReply = !!input.commentId && !input.interactionAt;
    if (
      !privateReply &&
      (!Number.isFinite(input.interactionAt) ||
        input.interactionAt! > Date.now() + 60_000 ||
        Date.now() - input.interactionAt! >= 23 * 3600_000)
    )
      throw new BadRequestException(
        'Messaging window expired. Wait for a new reply.'
      );
    const text = input.message || '';
    if (
      !input.media &&
      (!text.trim() || text.length > (input.buttonText ? 640 : 1000))
    )
      throw new BadRequestException('Invalid message length.');
    if (
      !!input.buttonText !== !!input.buttonUrl ||
      (input.buttonText &&
        (input.buttonText.length > 20 ||
          checkPublicHttpsUrl(input.buttonUrl!) !== null))
    )
      throw new BadRequestException('Invalid message button.');
    let mediaUrl: string | undefined;
    if (input.media) {
      if (
        privateReply ||
        text.trim() ||
        input.buttonText ||
        !['image', 'video'].includes(input.media.type)
      )
        throw new BadRequestException(
          'Media requires an open conversation and its own message.'
        );
      const media = await this.media.findAutomationMedia(
        input.organizationId,
        input.media.id,
        flow.profileId || undefined
      );
      const limit = input.media.type === 'image' ? 8 : 25;
      if (
        !media ||
        media.status !== 'ready' ||
        checkPublicHttpsUrl(media.path) !== null ||
        (media.fileSize && media.fileSize > limit * 1024 * 1024) ||
        !(
          input.media.type === 'image'
            ? /\.(png|jpe?g)(?:$|[?#])/i
            : /\.(mp4|mov|webm|avi|ogg)(?:$|[?#])/i
        ).test(media.path)
      )
        throw new BadRequestException(
          'Choose ready PNG/JPEG (up to 8 MB) or video (up to 25 MB) from this profile.'
        );
      mediaUrl = media.path;
    }
    integration.token = decryptIntegrationToken(
      this.encryption,
      integration.token
    );
    const route = await resolveIgRoute(integration, this.messaging);
    const provider = this.manager.getSocialIntegration(
      'instagram'
    ) as InstagramProvider;
    const button = input.buttonText
      ? { kind: 'url' as const, title: input.buttonText, url: input.buttonUrl! }
      : undefined;
    const key = privateReply
      ? [input.integrationId, input.commentId, 'private']
      : [input.integrationId, input.executionId, input.nodeId, 'sequence-v2'];
    await this.deliveries.sendOnce(JSON.stringify(key), async () => {
      // Recheck pause immediately before the external effect, including after media/token reads.
      const current = await this.flows.getFlowById(input.flowId);
      if (current?.status !== 'ACTIVE' || current.deletedAt)
        throw new BadRequestException('Automation paused.');
      if (privateReply)
        return provider.sendPrivateReply(
          route.token,
          integration.internalId,
          input.commentId!,
          text,
          button,
          route.host
        );
      if (mediaUrl)
        return provider.sendMediaDM(
          route.token,
          input.recipientId,
          input.media!.type,
          mediaUrl,
          route.host
        );
      if (button)
        return this.messaging.sendDmWithToken({
          token: route.token,
          recipientIgsid: input.recipientId,
          message: text,
          button,
          useInstagramGraph: route.useIgGraph,
        });
      return provider.sendDM(route.token, input.recipientId, text, route.host);
    });
  }
}
