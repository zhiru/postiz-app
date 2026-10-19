import { ProfileSeedService } from './profile.seed.module';

describe('ProfileSeedService', () => {
  let service: ProfileSeedService;
  let executeRawUnsafe: jest.Mock;
  let organizationFindMany: jest.Mock;
  let profileCreate: jest.Mock;

  beforeEach(() => {
    executeRawUnsafe = jest.fn().mockResolvedValue(0);
    organizationFindMany = jest.fn().mockResolvedValue([]);
    profileCreate = jest.fn().mockResolvedValue({ id: 'default-profile' });
    service = new ProfileSeedService({
      $executeRawUnsafe: executeRawUnsafe,
      organization: { findMany: organizationFindMany },
      profile: { create: profileCreate },
    } as any);
  });

  const allSql = () =>
    executeRawUnsafe.mock.calls.map((c) => c[0] as string);

  describe('onModuleInit', () => {
    it('nao insere mais memberships OWNER para admins (acesso implicito)', async () => {
      await service.onModuleInit();

      const ownerInserts = allSql().filter((sql) =>
        sql.includes(`'OWNER'::"ProfileRole"`)
      );
      expect(ownerInserts).toEqual([]);
    });

    it('so faz backfill EDITOR em orgs nao bootstrapadas e sem nenhuma membership', async () => {
      await service.onModuleInit();

      const editorInsert = allSql().find((sql) =>
        sql.includes(`'EDITOR'::"ProfileRole"`)
      );
      expect(editorInsert).toBeDefined();
      expect(editorInsert).toContain('"profilesBootstrappedAt" IS NULL');
      expect(editorInsert).toContain('NOT EXISTS');
      // guard por org: nenhuma linha de ProfileMember em toda a organizacao
      expect(editorInsert).toMatch(
        /NOT EXISTS \(\s*SELECT 1 FROM "ProfileMember" pm2/
      );
    });

    it('marca todas as orgs como bootstrapadas apos o backfill', async () => {
      await service.onModuleInit();

      const sqls = allSql();
      const markerIndex = sqls.findIndex(
        (sql) =>
          sql.includes('UPDATE "Organization"') &&
          sql.includes('"profilesBootstrappedAt" = NOW()') &&
          sql.includes('"profilesBootstrappedAt" IS NULL')
      );
      const editorIndex = sqls.findIndex((sql) =>
        sql.includes(`'EDITOR'::"ProfileRole"`)
      );
      expect(markerIndex).toBeGreaterThan(editorIndex);
    });

    it('copies legacy preferences only while creating the missing Default profile', async () => {
      organizationFindMany.mockResolvedValue([
        { id: 'org', shortlink: 'YES', lateApiKey: 'enc:v1:legacy-fake' },
      ]);

      await service.onModuleInit();

      expect(organizationFindMany).toHaveBeenCalledWith({
        where: { profiles: { none: { isDefault: true, deletedAt: null } } },
        select: { id: true, shortlink: true, lateApiKey: true },
      });
      expect(profileCreate).toHaveBeenCalledWith({
        data: {
          name: 'Default',
          slug: 'default',
          organizationId: 'org',
          isDefault: true,
          shortlink: 'YES',
          lateApiKey: 'enc:v1:legacy-fake',
        },
      });
    });

    it('does not write preferences for organizations with an existing Default', async () => {
      await service.onModuleInit();

      expect(profileCreate).not.toHaveBeenCalled();
    });

    it('nao propaga erro quando a tabela Profile ainda nao existe', async () => {
      executeRawUnsafe.mockRejectedValueOnce(new Error('no table'));

      await expect(service.onModuleInit()).resolves.toBeUndefined();
      // apenas o probe rodou
      expect(executeRawUnsafe).toHaveBeenCalledTimes(1);
    });
  });
});
