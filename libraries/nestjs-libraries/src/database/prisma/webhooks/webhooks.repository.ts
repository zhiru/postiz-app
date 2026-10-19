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

  getTotal(orgId: string, profileId?: string) {
    return this._webhooks.model.webhooks.count({
      where: {
        organizationId: orgId,
        ...(profileId ? { profileId } : {}),
        deletedAt: null,
      },
    });
  }

  getWebhooks(orgId: string, profileId?: string) {
    return this._webhooks.model.webhooks.findMany({
      where: {
        organizationId: orgId,
        ...(profileId ? { profileId } : {}),
        deletedAt: null,
      },
      select: listSelect,
    });
  }

  // Only the dispatcher needs the secret, and it never leaves the backend.
  getWebhooksForDispatch(orgId: string, integrationId?: string) {
    return this._webhooks.model.webhooks.findMany({
      where: {
        organizationId: orgId,
        deletedAt: null,
        ...(integrationId ? { OR: [
          { profileId: null },
          { profile: { integrations: { some: { id: integrationId } } } },
        ] } : {}),
      },
      select: {
        ...listSelect,
        secret: true,
      },
    });
  }

  deleteWebhook(orgId: string, id: string, profileId?: string) {
    return this._webhooks.model.webhooks.update({
      where: {
        id,
        organizationId: orgId,
        ...(profileId ? { profileId } : {}),
      },
      data: {
        deletedAt: new Date(),
      },
      select: { id: true },
    });
  }

  async rotateSecret(orgId: string, id: string, profileId?: string) {
    const secret = generateWebhookSecret();
    await this._webhooks.model.webhooks.update({
      where: {
        id,
        organizationId: orgId,
        ...(profileId ? { profileId } : {}),
      },
      data: {
        secret,
      },
      select: { id: true },
    });

    return { secret };
  }

  getDeliveries(orgId: string, id: string, profileId?: string) {
    return this._webhookDeliveries.model.webhookDeliveries.findMany({
      where: {
        webhookId: id,
        webhook: {
          organizationId: orgId,
          ...(profileId ? { profileId } : {}),
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

  async createWebhook(orgId: string, body: WebhooksDto, profileId?: string) {
    const secret = generateWebhookSecret();
    const { id, secret: savedSecret } =
      await this._webhooks.model.webhooks.upsert({
        where: {
          id: body.id || uuidv4(),
          organizationId: orgId,
          ...(profileId ? { profileId } : {}),
        },
        create: {
          organizationId: orgId,
          url: body.url,
          name: body.name,
          events: body.events || [],
          secret,
          ...(profileId ? { profileId } : {}),
        },
        update: {
          url: body.url,
          name: body.name,
          events: body.events || [],
        },
        select: { id: true, secret: true },
      });

    await this._webhooks.model.webhooks.update({
      where: {
        id,
        organizationId: orgId,
        ...(profileId ? { profileId } : {}),
      },
      data: {
        integrations: {
          deleteMany: {},
          create: body.integrations.map((integration) => ({
            integration: { connect: { id: integration.id, organizationId: orgId, ...(profileId ? { profileId } : {}) } },
          })),
        },
      },
      select: { id: true },
    });

    // Returned once, on creation only, so the screen can show it and forget it.
    return { id, ...(savedSecret === secret ? { secret } : {}) };
  }
}
