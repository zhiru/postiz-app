import { createPrismaRepositoryMock } from '@gitroom/nestjs-libraries/test';
import { FlowsRepository } from './flows.repository';

describe('FlowsRepository', () => {
  let repo: FlowsRepository;
  let flowExecution: ReturnType<typeof createPrismaRepositoryMock>;

  beforeEach(() => {
    flowExecution = createPrismaRepositoryMock('flowExecution');
    repo = new FlowsRepository(
      {} as any,
      {} as any,
      {} as any,
      flowExecution as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any
    );
  });

  it('scopes reply waits to an active flow, organization, channel and sender', async () => {
    await repo.findReplyWaits('org', 'i', 'u');
    expect(flowExecution.model.flowExecution.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: 'RUNNING',
          igCommenterId: 'u',
          flow: {
            organizationId: 'org',
            integrationId: 'i',
            status: 'ACTIVE',
            deletedAt: null,
          },
        },
        take: 50,
      })
    );
  });

  describe('getExecution', () => {
    it('filtra por id e organizationId do flow para isolar o tenant', async () => {
      flowExecution.model.flowExecution.findFirst.mockResolvedValue(null);

      await repo.getExecution('exec-1', 'org-1');

      expect(flowExecution.model.flowExecution.findFirst).toHaveBeenCalledWith({
        where: { id: 'exec-1', flow: { organizationId: 'org-1' } },
      });
    });
  });

  describe('getExecutions', () => {
    it('filtra por flowId e organizationId do flow para isolar o tenant', async () => {
      flowExecution.model.flowExecution.findMany.mockResolvedValue([]);

      await repo.getExecutions('flow-1', 'org-1', 2, 20);

      expect(flowExecution.model.flowExecution.findMany).toHaveBeenCalledWith({
        where: { flowId: 'flow-1', flow: { organizationId: 'org-1' } },
        orderBy: { createdAt: 'desc' },
        skip: 20,
        take: 20,
      });
    });
  });

  describe('getExecutionsPage', () => {
    it('filters before pagination and scopes rows and count to the same organization/profile', async () => {
      const items = [{ id: 'execution-1' }];
      flowExecution.model.flowExecution.findMany.mockResolvedValue(items);
      flowExecution.model.flowExecution.count.mockResolvedValue(47);
      const result = await repo.getExecutionsPage('flow-1', 'org-1', {
        page: 2, limit: 10, status: 'FAILED', search: '  Ana  ',
        since: '2026-11-01T03:00:00.000Z', until: '2026-11-03T03:00:00.000Z',
        order: 'asc',
      }, 'profile-1');
      const where = {
        flowId: 'flow-1', flow: { organizationId: 'org-1', profileId: 'profile-1' },
        status: 'FAILED',
        startedAt: { gte: new Date('2026-11-01T03:00:00.000Z'), lt: new Date('2026-11-03T03:00:00.000Z') },
        OR: ['commentText', 'igCommenterName', 'igCommenterId'].map((field) => ({
          [field]: { contains: 'Ana', mode: 'insensitive' },
        })),
      };
      expect(flowExecution.model.flowExecution.findMany).toHaveBeenCalledWith({
        where, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], skip: 10, take: 10,
      });
      expect(flowExecution.model.flowExecution.count).toHaveBeenCalledWith({ where });
      expect(result).toEqual({ items, total: 47 });
    });

    it('uses bounded defaults without adding empty filters', async () => {
      flowExecution.model.flowExecution.findMany.mockResolvedValue([]);
      flowExecution.model.flowExecution.count.mockResolvedValue(0);
      await repo.getExecutionsPage('flow-1', 'org-1', {});
      expect(flowExecution.model.flowExecution.findMany).toHaveBeenCalledWith({
        where: { flowId: 'flow-1', flow: { organizationId: 'org-1' } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: 0, take: 20,
      });
    });
  });

  describe('getFailedExecutions', () => {
    it('filtra status=FAILED cross-flow por org e traz o perfil de origem', async () => {
      flowExecution.model.flowExecution.findMany.mockResolvedValue([]);

      await repo.getFailedExecutions('org-1', undefined, 50);

      const arg = flowExecution.model.flowExecution.findMany.mock
        .calls[0][0] as any;
      expect(arg.where.status).toBe('FAILED');
      expect(arg.where.createdAt.gte).toBeInstanceOf(Date);
      expect(arg.where.flow.organizationId).toBe('org-1');
      expect(arg.where.flow.deletedAt).toBeNull();
      expect(arg.where.flow.OR).toEqual([
        { profileId: null },
        { profile: { deletedAt: null } },
      ]);
      expect(arg.where.flow.profileId).toBeUndefined();
      expect(arg.orderBy).toEqual({ createdAt: 'desc' });
      expect(arg.take).toBe(50);
      expect(arg.select.flow.select.profile.select).toEqual({
        id: true,
        name: true,
      });
    });

    it('aplica profileId ao filtro do flow quando informado', async () => {
      flowExecution.model.flowExecution.findMany.mockResolvedValue([]);

      await repo.getFailedExecutions('org-1', 'prof-2');

      const arg = flowExecution.model.flowExecution.findMany.mock
        .calls[0][0] as any;
      expect(arg.where.flow.profileId).toBe('prof-2');
    });
  });

  describe('getExecutionEventContext', () => {
    it('traz org/perfil/flow + snapshot do canal para o StatusEvent', async () => {
      (flowExecution.model.flowExecution as any).findUnique = jest
        .fn()
        .mockResolvedValue(null);

      await repo.getExecutionEventContext('exec-1');

      const arg = (flowExecution.model.flowExecution as any).findUnique.mock
        .calls[0][0] as any;
      expect(arg.where).toEqual({ id: 'exec-1' });
      expect(arg.select.flow.select).toEqual({
        id: true,
        name: true,
        organizationId: true,
        profileId: true,
        integration: {
          select: {
            id: true,
            providerIdentifier: true,
            name: true,
            picture: true,
          },
        },
      });
    });
  });
});
