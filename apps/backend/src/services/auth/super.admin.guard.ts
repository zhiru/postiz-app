import {
  CanActivate,
  ExecutionContext,
  HttpException,
  Injectable,
} from '@nestjs/common';
import { Request } from 'express';
import { Organization } from '@prisma/client';
import { OrganizationService } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.service';

@Injectable()
export class SuperAdminGuard implements CanActivate {
  constructor(private _organizationService: OrganizationService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request: Request = context.switchToHttp().getRequest();
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-expect-error
    const {
      org,
      isOAuthApp,
      publicApiProfileId,
      authOrgId,
    }: { org: Organization; isOAuthApp?: boolean; publicApiProfileId?: string; authOrgId?: string } =
      request;

    const orgId = authOrgId || org?.id;

    if (
      !orgId ||
      isOAuthApp || publicApiProfileId ||
      !(await this._organizationService.canUseSuperAdminApi(orgId))
    ) {
      throw new HttpException({ msg: 'Unauthorized' }, 403);
    }

    return true;
  }
}
