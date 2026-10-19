jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/repost/repost.service',
  () => ({ RepostService: class {} })
);
jest.mock(
  '@gitroom/nestjs-libraries/integrations/refresh.integration.service',
  () => ({ RefreshIntegrationService: class {} })
);
import 'reflect-metadata';

// O tipo RepostService no construtor puxa integration.manager (nostr-tools e
// ESM e quebra o ts-jest); mock segue o padrao dos demais specs do repo.
jest.mock('@gitroom/nestjs-libraries/integrations/integration.manager', () => ({
  IntegrationManager: class {},
}));
jest.mock('@gitroom/nestjs-libraries/redis/redis.service', () => ({
  ioRedis: {},
}));

import { Test } from '@nestjs/testing';
import { ProfileSeedService } from '../profiles/profile.seed.module';
import { StartupMigrationService } from '../startup-migration.service';

describe('StartupMigrationService.cleanupExpiredUnmatchedComments', () => {
  let service: StartupMigrationService;
  let prisma: any;

  beforeEach(() => {
    prisma = {
      providerCredential: { count: jest.fn().mockResolvedValue(0) },
      profile: { findMany: jest.fn().mockResolvedValue([]) },
      organization: { count: jest.fn().mockResolvedValue(0) },
      integration: {
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([]),
      },
      repostRule: {
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([]),
      },
      repostRuleDestination: { upsert: jest.fn() },
      unmatchedComment: {
        count: jest.fn(),
        deleteMany: jest.fn(),
      },
      flow: { count: jest.fn().mockResolvedValue(0) },
      $transaction: jest.fn(),
      $executeRawUnsafe: jest.fn(),
    };
    service = new StartupMigrationService(
      prisma,
      {
        reconcileWorkflows: jest.fn().mockResolvedValue({ started: 0 }),
      } as any,
      {
        ensureRefreshTokensCronWorkflow: jest.fn().mockResolvedValue(undefined),
      } as any
    );
  });

  it('deve ser no-op quando nao ha PENDING > 30 dias', async () => {
    prisma.unmatchedComment.count.mockResolvedValue(0);

    await service.onApplicationBootstrap();

    expect(prisma.unmatchedComment.deleteMany).not.toHaveBeenCalled();
  });

  it('deve deletar PENDING anteriores ao cutoff de 30 dias', async () => {
    prisma.unmatchedComment.count.mockResolvedValue(5);
    prisma.unmatchedComment.deleteMany.mockResolvedValue({ count: 5 });

    await service.onApplicationBootstrap();

    expect(prisma.unmatchedComment.deleteMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        status: 'PENDING',
        createdAt: expect.objectContaining({ lt: expect.any(Date) }),
      }),
    });
  });

  it('nao deve derrubar o boot quando deleteMany falha', async () => {
    prisma.unmatchedComment.count.mockResolvedValue(3);
    prisma.unmatchedComment.deleteMany.mockRejectedValue(
      new Error('DB connection lost')
    );

    // Nao lanca — apenas loga
    await expect(service.onApplicationBootstrap()).resolves.toBeUndefined();
  });
});

describe('StartupMigrationService.backfillFlowsToDefaultProfile', () => {
  let service: StartupMigrationService;
  let prisma: any;

  beforeEach(() => {
    prisma = {
      providerCredential: { count: jest.fn().mockResolvedValue(0) },
      profile: { findMany: jest.fn().mockResolvedValue([]) },
      organization: { count: jest.fn().mockResolvedValue(0) },
      integration: {
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([]),
      },
      repostRule: {
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([]),
      },
      repostRuleDestination: { upsert: jest.fn() },
      unmatchedComment: {
        count: jest.fn().mockResolvedValue(0),
        deleteMany: jest.fn(),
      },
      flow: { count: jest.fn().mockResolvedValue(0) },
      $transaction: jest.fn(),
      $executeRawUnsafe: jest.fn(),
    };
    service = new StartupMigrationService(
      prisma,
      {
        reconcileWorkflows: jest.fn().mockResolvedValue({ started: 0 }),
      } as any,
      {
        ensureRefreshTokensCronWorkflow: jest.fn().mockResolvedValue(undefined),
      } as any
    );
  });

  it('deve ser no-op quando nao ha flow com profileId null', async () => {
    prisma.flow.count.mockResolvedValue(0);

    await service.onApplicationBootstrap();

    expect(prisma.$executeRawUnsafe).not.toHaveBeenCalled();
  });

  it('deve rodar UPDATE atribuindo flows null ao perfil Default', async () => {
    prisma.flow.count.mockResolvedValue(2);

    await service.onApplicationBootstrap();

    expect(prisma.flow.count).toHaveBeenCalledWith({
      where: { profileId: null },
    });
    expect(prisma.$executeRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE "Flow"')
    );
  });

  it('nao deve derrubar o boot quando o UPDATE falha', async () => {
    prisma.flow.count.mockResolvedValue(1);
    prisma.$executeRawUnsafe.mockRejectedValue(new Error('DB down'));

    await expect(service.onApplicationBootstrap()).resolves.toBeUndefined();
  });
});

describe('StartupMigrationService.reconcileRefreshTokensCron', () => {
  const buildPrisma = () => ({
    providerCredential: { count: jest.fn().mockResolvedValue(0) },
    profile: { findMany: jest.fn().mockResolvedValue([]) },
    organization: { count: jest.fn().mockResolvedValue(0) },
    integration: {
      count: jest.fn().mockResolvedValue(0),
      findMany: jest.fn().mockResolvedValue([]),
    },
    repostRule: {
      count: jest.fn().mockResolvedValue(0),
      findMany: jest.fn().mockResolvedValue([]),
    },
    repostRuleDestination: { upsert: jest.fn() },
    unmatchedComment: {
      count: jest.fn().mockResolvedValue(0),
      deleteMany: jest.fn(),
    },
    flow: { count: jest.fn().mockResolvedValue(0) },
    $transaction: jest.fn(),
    $executeRawUnsafe: jest.fn(),
  });

  const buildService = (ensure: jest.Mock) =>
    new StartupMigrationService(
      buildPrisma() as any,
      {
        reconcileWorkflows: jest.fn().mockResolvedValue({ started: 0 }),
      } as any,
      { ensureRefreshTokensCronWorkflow: ensure } as any
    );

  it('garante o workflow cron de refresh (singleton) no boot', async () => {
    const ensure = jest.fn().mockResolvedValue(undefined);

    await buildService(ensure).onApplicationBootstrap();

    expect(ensure).toHaveBeenCalledTimes(1);
  });

  it('nao derruba o boot quando o start do cron falha', async () => {
    const ensure = jest.fn().mockRejectedValue(new Error('temporal down'));

    await expect(
      buildService(ensure).onApplicationBootstrap()
    ).resolves.toBeUndefined();
  });
});

describe('legacy upgrade profile migration', () => {
  type ScopedRecord = {
    id: string;
    organizationId: string;
    profileId: string | null;
  };
  type LegacyFamily = 'providerCredential' | 'webhooks' | 'autoPost' | 'sets';
  const setup = (withDefault = true) => {
    const defaults: any[] = withDefault
      ? [
          {
            id: 'default-profile',
            organizationId: 'org',
            isDefault: true,
            deletedAt: null,
            shortlink: 'ASK',
            lateApiKey: null,
          },
        ]
      : [];
    const channels: ScopedRecord[] = [1, 2, 3].map((id) => ({
      id: `channel-${id}`,
      organizationId: 'org',
      profileId: null,
    }));
    const records: Record<LegacyFamily, ScopedRecord[]> = {
      providerCredential: [],
      webhooks: [
        { id: 'legacy-webhook', organizationId: 'org', profileId: null },
      ],
      autoPost: [{ id: 'legacy-auto', organizationId: 'org', profileId: null }],
      sets: [
        { id: 'legacy-set', organizationId: 'org', profileId: null },
        {
          id: 'client-set',
          organizationId: 'org',
          profileId: 'client-profile',
        },
        { id: 'foreign-set', organizationId: 'other-org', profileId: null },
      ],
    };
    const updateModel = (rows: any[]) => ({
      count: jest.fn(
        async () => rows.filter((row) => row.profileId === null).length
      ),
      updateMany: jest.fn(async ({ where, data }) => {
        const matched = rows.filter((row) =>
          Object.entries(where).every(([key, value]) => row[key] === value)
        );
        matched.forEach((row) => Object.assign(row, data));
        return { count: matched.length };
      }),
    });
    const prisma: any = {
      ...Object.fromEntries(
        Object.entries(records).map(([name, rows]) => [name, updateModel(rows)])
      ),
      profile: {
        findMany: jest.fn(async () => defaults),
        create: jest.fn(async ({ data }) => {
          const profile = { id: 'default-profile', deletedAt: null, ...data };
          defaults.push(profile);
          return profile;
        }),
        updateMany: updateModel(defaults).updateMany,
      },
      organization: {
        count: jest.fn(async () => 0),
        findMany: jest.fn(async () =>
          defaults.length
            ? []
            : [
                {
                  id: 'org',
                  lateApiKey: 'enc:v1:legacy-fake',
                  shortlink: 'YES',
                },
              ]
        ),
        findUnique: jest.fn(async () => ({
          id: 'org',
          lateApiKey: 'enc:v1:legacy-fake',
          shortlink: 'YES',
        })),
      },
      integration: {
        count: jest.fn(async () => 0),
        findMany: jest.fn(async () => []),
      },
      repostRule: {
        count: jest.fn(async () => 0),
        findMany: jest.fn(async () => []),
      },
      repostRuleDestination: { upsert: jest.fn() },
      unmatchedComment: { count: jest.fn(async () => 0) },
      statusEvent: { count: jest.fn(async () => 0) },
      flow: { count: jest.fn(async () => 0) },
      $executeRawUnsafe: jest.fn(async (sql: string) => {
        if (
          sql.includes('UPDATE "Integration"') &&
          sql.includes('i."customerId" IS NULL')
        ) {
          channels
            .filter((channel) => !channel.profileId)
            .forEach((channel) => {
              channel.profileId = 'default-profile';
            });
          return channels.length;
        }
        return 0;
      }),
    };
    prisma.$transaction = jest.fn(async (run) => run(prisma));
    const service = new StartupMigrationService(
      prisma,
      { reconcileWorkflows: jest.fn(async () => ({ total: 0 })) } as any,
      { ensureRefreshTokensCronWorkflow: jest.fn() } as any
    );
    return { service, prisma, defaults, channels, records };
  };

  it('backfills legacy families even when the new credential table is empty', async () => {
    const { service, records, prisma } = setup();
    await (service as any).onApplicationBootstrap();
    expect(records.providerCredential).toEqual([]);
    for (const family of ['webhooks', 'autoPost', 'sets'] as const) {
      expect(records[family][0].profileId).toBe('default-profile');
      expect(prisma[family].updateMany).toHaveBeenCalledWith({
        where: { organizationId: 'org', profileId: null },
        data: { profileId: 'default-profile' },
      });
    }
    expect(records.sets[1].profileId).toBe('client-profile');
    expect(records.sets[2].profileId).toBeNull();
    expect(prisma.providerCredential.count).not.toHaveBeenCalled();
  });

  it('runs after Default seeding in the Nest lifecycle with three legacy channels', async () => {
    const { service, prisma, records, channels, defaults } = setup(false);
    const module = await Test.createTestingModule({
      providers: [
        { provide: StartupMigrationService, useValue: service },
        {
          provide: ProfileSeedService,
          useValue: new ProfileSeedService(prisma),
        },
      ],
    }).compile();
    const app = module.createNestApplication();
    try {
      await app.init();
      expect(defaults).toHaveLength(1);
      expect(channels).toHaveLength(3);
      expect(
        channels.every((channel) => channel.profileId === 'default-profile')
      ).toBe(true);
      expect(records.webhooks[0].profileId).toBe('default-profile');
      expect(records.autoPost[0].profileId).toBe('default-profile');
      expect(records.sets[0].profileId).toBe('default-profile');
      expect(prisma.profile.create).toHaveBeenCalledTimes(1);
      expect(prisma.profile.create.mock.invocationCallOrder[0]).toBeLessThan(
        prisma.profile.findMany.mock.invocationCallOrder[0]
      );
    } finally {
      await app.close();
    }
  });

  it('keeps ASK and a removed key after legacy migration and restart', async () => {
    const { service, prisma, defaults } = setup(false);
    const seed = new ProfileSeedService(prisma);
    await seed.onModuleInit();
    await service.onApplicationBootstrap();
    expect(defaults[0]).toMatchObject({
      shortlink: 'YES',
      lateApiKey: 'enc:v1:legacy-fake',
    });

    defaults[0].shortlink = 'ASK';
    defaults[0].lateApiKey = null;
    await seed.onModuleInit();
    await service.onApplicationBootstrap();

    expect(defaults).toHaveLength(1);
    expect(defaults[0]).toMatchObject({ shortlink: 'ASK', lateApiKey: null });
    expect(prisma.profile.create).toHaveBeenCalledTimes(1);
    expect(prisma.profile.updateMany).not.toHaveBeenCalled();
    expect(prisma.organization.findUnique).not.toHaveBeenCalled();
  });

  it('is idempotent and leaves existing profile records and credentials untouched', async () => {
    const { service, records, defaults, prisma } = setup();
    await (service as any).onApplicationBootstrap();
    const first = JSON.stringify({ records, defaults });
    await (service as any).onApplicationBootstrap();
    expect(JSON.stringify({ records, defaults })).toBe(first);
    expect(prisma.profile.findMany).toHaveBeenCalledWith({
      where: { isDefault: true, deletedAt: null },
      select: { id: true, organizationId: true },
    });
    expect(prisma.providerCredential.updateMany).toHaveBeenCalledWith({
      where: { organizationId: 'org', profileId: null },
      data: { profileId: 'default-profile' },
    });
  });
});
