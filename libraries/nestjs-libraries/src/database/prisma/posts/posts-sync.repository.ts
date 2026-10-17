import { Injectable } from '@nestjs/common';
import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { Prisma } from '@prisma/client';

@Injectable()
export class PostsSyncRepository {
  constructor(private _integration: PrismaRepository<'integration'>) {}

  eligible(providers: string[]) {
    return this._integration.model.integration.findMany({
      where: {
        providerIdentifier: { in: providers },
        deletedAt: null,
        disabled: false,
        inBetweenSteps: false,
        refreshNeeded: false,
      },
      select: { id: true, organizationId: true },
    });
  }

  get(organizationId: string, id: string) {
    return this._integration.model.integration.findFirst({
      where: { id, organizationId, deletedAt: null },
    });
  }

  update(
    organizationId: string,
    id: string,
    data: Prisma.IntegrationUpdateManyMutationInput
  ) {
    return this._integration.model.integration.updateMany({
      where: { id, organizationId, deletedAt: null },
      data,
    });
  }
}
