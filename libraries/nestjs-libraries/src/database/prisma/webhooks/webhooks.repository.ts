import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { Injectable } from '@nestjs/common';
import { WebhooksDto } from '@gitroom/nestjs-libraries/dtos/webhooks/webhooks.dto';
import { v4 as uuidv4 } from 'uuid';
import { randomBytes } from 'crypto';
import { WebhookDeliveryResult } from '@gitroom/nestjs-libraries/dtos/webhooks/webhook.delivery';

// Everything but the secret: the list endpoint feeds the settings screen and
// the secret is only ever handed back once, right after it is generated.
const listSelect = {
  id: true,
  name: true,
  url: true,
  events: true,
  createdAt: true,
  integrations: {
    select: {
      integration: {
        select: {
          id: true,
          picture: true,
          name: true,
        },
      },
    },
  },
};

export const generateWebhookSecret = () => randomBytes(32).toString('hex');

@Injectable()
export class WebhooksRepository {
  constructor(
    private _webhooks: PrismaRepository<'webhooks'>,
    private _webhookDeliveries: PrismaRepository<'webhookDeliveries'>
  ) {}

  getTotal(orgId: string) {
    return this._webhooks.model.webhooks.count({
      where: {
        organizationId: orgId,
        deletedAt: null,
      },
    });
  }

  getWebhooks(orgId: string) {
    return this._webhooks.model.webhooks.findMany({
      where: {
        organizationId: orgId,
        deletedAt: null,
      },
      select: listSelect,
    });
  }

  // Only the dispatcher needs the secret, and it never leaves the backend.
  getWebhooksForDispatch(orgId: string) {
    return this._webhooks.model.webhooks.findMany({
      where: {
        organizationId: orgId,
        deletedAt: null,
      },
      select: {
        ...listSelect,
        secret: true,
      },
    });
  }

  deleteWebhook(orgId: string, id: string) {
    return this._webhooks.model.webhooks.update({
      where: {
        id,
        organizationId: orgId,
      },
      data: {
        deletedAt: new Date(),
      },
    });
  }

  async rotateSecret(orgId: string, id: string) {
    const secret = generateWebhookSecret();
    await this._webhooks.model.webhooks.update({
      where: {
        id,
        organizationId: orgId,
      },
      data: {
        secret,
      },
    });

    return { secret };
  }

  getDeliveries(orgId: string, id: string) {
    return this._webhookDeliveries.model.webhookDeliveries.findMany({
      where: {
        webhookId: id,
        webhook: {
          organizationId: orgId,
        },
      },
      orderBy: {
        createdAt: 'desc' as const,
      },
      // ponytail: newest 20 only and no retention job - add a cleanup cron if
      // the table starts to matter.
      take: 20,
      select: {
        id: true,
        event: true,
        success: true,
        statusCode: true,
        attempts: true,
        error: true,
        createdAt: true,
      },
    });
  }

  createDelivery(
    webhookId: string,
    event: string,
    url: string,
    result: WebhookDeliveryResult
  ) {
    return this._webhookDeliveries.model.webhookDeliveries.create({
      data: {
        webhookId,
        event,
        url,
        success: result.success,
        statusCode: result.statusCode,
        attempts: result.attempts,
        error: result.error,
      },
    });
  }

  async createWebhook(orgId: string, body: WebhooksDto) {
    const secret = generateWebhookSecret();
    const { id, secret: savedSecret } =
      await this._webhooks.model.webhooks.upsert({
        where: {
          id: body.id || uuidv4(),
          organizationId: orgId,
        },
        create: {
          organizationId: orgId,
          url: body.url,
          name: body.name,
          events: body.events || [],
          secret,
        },
        update: {
          url: body.url,
          name: body.name,
          events: body.events || [],
        },
      });

    await this._webhooks.model.webhooks.update({
      where: {
        id,
        organizationId: orgId,
      },
      data: {
        integrations: {
          deleteMany: {},
          create: body.integrations.map((integration) => ({
            integrationId: integration.id,
          })),
        },
      },
    });

    // Returned once, on creation only, so the screen can show it and forget it.
    return { id, ...(savedSecret === secret ? { secret } : {}) };
  }
}
