import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { Injectable } from '@nestjs/common';

@Injectable()
export class InstanceCredentialsRepository {
  constructor(
    private _instanceCredential: PrismaRepository<'instanceCredential'>
  ) {}

  list() {
    return this._instanceCredential.model.instanceCredential.findMany();
  }

  upsert(key: string, value: string, updatedBy: string) {
    return this._instanceCredential.model.instanceCredential.upsert({
      where: {
        key,
      },
      create: {
        key,
        value,
        updatedBy,
      },
      update: {
        value,
        updatedBy,
      },
    });
  }

  delete(key: string) {
    return this._instanceCredential.model.instanceCredential.deleteMany({
      where: {
        key,
      },
    });
  }
}
