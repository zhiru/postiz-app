import { Body, Controller, Delete, Get, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Organization, Profile } from '@prisma/client';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { GetProfileFromRequest } from '@gitroom/nestjs-libraries/user/profile.from.request';
import { ProfileManage } from '@gitroom/nestjs-libraries/services/auth/profile-access/profile-access.decorators';
import { NeuralTalkConnectionService } from '@gitroom/nestjs-libraries/integrations/neuraltalk.connection.service';
import {
  NeuralTalkAccountsDto,
  NeuralTalkAccountDto,
  NeuralTalkConnectDto,
} from '@gitroom/nestjs-libraries/dtos/integrations/neuraltalk.dto';
import { CheckPolicies } from '@gitroom/backend/services/auth/permissions/permissions.ability';
import {
  AuthorizationActions,
  Sections,
} from '@gitroom/backend/services/auth/permissions/permission.exception.class';
@ApiTags('NeuralTalk channels')
@Controller('/integrations/neuraltalk')
@ProfileManage()
export class NeuralTalkIntegrationsController {
  constructor(private service: NeuralTalkConnectionService) {}
  @Get('/default-connection')
  @CheckPolicies([AuthorizationActions.Create, Sections.CHANNEL])
  defaultConnection(
    @GetOrgFromRequest() org: Organization,
    @GetProfileFromRequest() profile: Profile | null
  ) {
    return this.service.defaultConnection(org.id, profile?.id);
  }
  @Delete('/default-connection')
  @CheckPolicies([AuthorizationActions.Create, Sections.CHANNEL])
  removeDefaultConnection(
    @GetOrgFromRequest() org: Organization,
    @GetProfileFromRequest() profile: Profile | null
  ) {
    return this.service.removeDefaultConnection(org.id, profile?.id);
  }
  @Post('/accounts')
  @CheckPolicies([AuthorizationActions.Create, Sections.CHANNEL])
  accounts(
    @GetOrgFromRequest() org: Organization,
    @GetProfileFromRequest() profile: Profile | null,
    @Body() body: NeuralTalkAccountsDto
  ) {
    return this.service.accounts(org.id, profile?.id, body);
  }
  @Post('/inboxes')
  @CheckPolicies([AuthorizationActions.Create, Sections.CHANNEL])
  inboxes(
    @GetOrgFromRequest() org: Organization,
    @GetProfileFromRequest() profile: Profile | null,
    @Body() body: NeuralTalkAccountDto
  ) {
    return this.service.inboxes(org.id, profile?.id, body);
  }
  @Post('/connect')
  @CheckPolicies([AuthorizationActions.Create, Sections.CHANNEL])
  connect(
    @GetOrgFromRequest() org: Organization,
    @GetProfileFromRequest() profile: Profile | null,
    @Body() body: NeuralTalkConnectDto
  ) {
    return this.service.connect(org.id, profile?.id, body);
  }
}
