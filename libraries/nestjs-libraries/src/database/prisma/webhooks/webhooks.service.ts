import { Injectable } from '@nestjs/common';
import { WebhooksRepository } from '@gitroom/nestjs-libraries/database/prisma/webhooks/webhooks.repository';
import { WebhooksDto } from '@gitroom/nestjs-libraries/dtos/webhooks/webhooks.dto';
import {
  deliverWebhook,
  WebhookEvent,
  webhookSubscribesTo,
} from '@gitroom/nestjs-libraries/dtos/webhooks/webhook.delivery';

@Injectable()
export class WebhooksService {
  constructor(private _webhooksRepository: WebhooksRepository) {}

  getTotal(orgId: string, profileId?: string) {
    return this._webhooksRepository.getTotal(orgId, profileId);
  }

  getWebhooks(orgId: string, profileId?: string) {
    return this._webhooksRepository.getWebhooks(orgId, profileId);
  }

  createWebhook(orgId: string, body: WebhooksDto, profileId?: string) {
    return this._webhooksRepository.createWebhook(orgId, body, profileId);
  }

  deleteWebhook(orgId: string, id: string, profileId?: string) {
    return this._webhooksRepository.deleteWebhook(orgId, id, profileId);
  }

  rotateSecret(orgId: string, id: string, profileId?: string) {
    return this._webhooksRepository.rotateSecret(orgId, id, profileId);
  }

  getDeliveries(orgId: string, id: string, profileId?: string) {
    return this._webhooksRepository.getDeliveries(orgId, id, profileId);
  }

  // Lets a caller skip building a payload nobody is going to receive.
  async hasSubscribers(orgId: string, event: WebhookEvent) {
    return (
      await this._webhooksRepository.getWebhooksForDispatch(orgId)
    ).some((f) => webhookSubscribesTo(f.events, event));
  }

  // The payload is built by the caller: this stays unaware of what a post
  // looks like, so posts can depend on webhooks and never the other way round.
  // Delivery failures never throw - they are written to the deliveries table
  // instead, so nothing is swallowed but nothing fails the caller either.
  async sendEvent(
    orgId: string,
    event: WebhookEvent,
    integrationId: string,
    payload: any
  ) {
    const webhooks = (
      await this._webhooksRepository.getWebhooksForDispatch(orgId, integrationId)
    ).filter(
      (f) =>
        webhookSubscribesTo(f.events, event) &&
        (f.integrations.length === 0 ||
          f.integrations.some((i) => i.integration.id === integrationId))
    );

    if (webhooks.length === 0) {
      return;
    }

    const body = JSON.stringify(payload);

    await Promise.all(
      webhooks.map(async (webhook) => {
        const result = await deliverWebhook(webhook.url, body, {
          event,
          secret: webhook.secret,
        });

        try {
          await this._webhooksRepository.createDelivery(
            webhook.id,
            event,
            webhook.url,
            result
          );
        } catch (err) {
          /** the delivery log must never break the delivery **/
        }
      })
    );
  }
}
