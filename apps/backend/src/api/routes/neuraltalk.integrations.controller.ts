import { Body, Controller, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Organization, Profile } from '@prisma/client';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { GetProfileFromRequest } from '@gitroom/nestjs-libraries/user/profile.from.request';
import { ProfileManage } from '@gitroom/nestjs-libraries/services/auth/profile-access/profile-access.decorators';
import { NeuralTalkConnectionService } from '@gitroom/nestjs-libraries/integrations/neuraltalk.connection.service';
import {
  NeuralTalkCredentialsDto,
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
  @Post('/accounts')
  @CheckPolicies([AuthorizationActions.Create, Sections.CHANNEL])
  accounts(@Body() body: NeuralTalkCredentialsDto) {
    return this.service.accounts(body);
  }
  @Post('/inboxes')
  @CheckPolicies([AuthorizationActions.Create, Sections.CHANNEL])
  inboxes(@Body() body: NeuralTalkAccountDto) {
    return this.service.inboxes(body);
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
