import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { GetProfileFromRequest } from '@gitroom/nestjs-libraries/user/profile.from.request';
import { Organization, Profile } from '@prisma/client';
import { ApiTags } from '@nestjs/swagger';
import { WebhooksService } from '@gitroom/nestjs-libraries/database/prisma/webhooks/webhooks.service';
import { CheckPolicies } from '@gitroom/backend/services/auth/permissions/permissions.ability';
import {
  OnlyURL, UpdateDto, WebhooksDto
} from '@gitroom/nestjs-libraries/dtos/webhooks/webhooks.dto';
import { AuthorizationActions, Sections } from '@gitroom/backend/services/auth/permissions/permission.exception.class';
import { deliverWebhook } from '@gitroom/nestjs-libraries/dtos/webhooks/webhook.delivery';

@ApiTags('Webhooks')
@Controller('/webhooks')
export class WebhookController {
  constructor(private _webhooksService: WebhooksService) {}

  @Get('/')
  async getStatistics(
    @GetOrgFromRequest() org: Organization,
    @GetProfileFromRequest() profile: Profile | null
  ) {
    return this._webhooksService.getWebhooks(org.id, profile?.id);
  }

  @Post('/')
  @CheckPolicies([AuthorizationActions.Create, Sections.WEBHOOKS])
  async createAWebhook(
    @GetOrgFromRequest() org: Organization,
    @GetProfileFromRequest() profile: Profile | null,
    @Body() body: WebhooksDto
  ) {
    return this._webhooksService.createWebhook(org.id, body, profile?.id);
  }

  @Put('/')
  async updateWebhook(
    @GetOrgFromRequest() org: Organization,
    @GetProfileFromRequest() profile: Profile | null,
    @Body() body: UpdateDto
  ) {
    return this._webhooksService.createWebhook(org.id, body, profile?.id);
  }

  @Post('/:id/secret')
  @CheckPolicies([AuthorizationActions.Create, Sections.WEBHOOKS])
  async rotateSecret(
    @GetOrgFromRequest() org: Organization,
    @GetProfileFromRequest() profile: Profile | null,
    @Param('id') id: string
  ) {
    return this._webhooksService.rotateSecret(org.id, id, profile?.id);
  }

  @Get('/:id/deliveries')
  async getDeliveries(
    @GetOrgFromRequest() org: Organization,
    @GetProfileFromRequest() profile: Profile | null,
    @Param('id') id: string
  ) {
    return this._webhooksService.getDeliveries(org.id, id, profile?.id);
  }

  @Delete('/:id')
  async deleteWebhook(
    @GetOrgFromRequest() org: Organization,
    @GetProfileFromRequest() profile: Profile | null,
    @Param('id') id: string
  ) {
    return this._webhooksService.deleteWebhook(org.id, id, profile?.id);
  }

  @Post('/send')
  async sendWebhook(@Body() body: any, @Query() query: OnlyURL) {
    // Unsigned single shot: the test button only proves the URL is reachable,
    // a real event goes out through the dispatcher with its signature.
    const result = await deliverWebhook(query.url, JSON.stringify(body), {
      event: 'post.published',
      maxAttempts: 1,
    });

    return { send: true, success: result.success, statusCode: result.statusCode };
  }
}
