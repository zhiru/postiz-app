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

  describe('claimRedispatch', () => {
    const execution = { id: 'e', flowId: 'f', igCommentId: 'c', status: 'COMPLETED',
      temporalWorkflowId: 'original', updatedAt: new Date('2026-11-01'),
      executionLog: '[{"status":"entered"},{"status":"skipped","error":"keywords_not_matched"}]' } as any;
    const flow = { id: 'f', organizationId: 'org', profileId: 'profile', integrationId: 'i',
      status: 'ACTIVE', deletedAt: null, triggerPostIds: null, nodes: [], edges: [] } as any;
    let tx: any;
    let transaction: jest.Mock;
    beforeEach(() => {
      tx = Object.assign({}, ...['flow', 'automationDelivery', 'pendingPostback', 'flowExecution', 'ignoredMedia', 'flowMediaAlias', 'integration'].map((name) => createPrismaRepositoryMock(name).model));
      tx.flow.findFirst.mockResolvedValue(flow);
      tx.ignoredMedia.findUnique.mockResolvedValue(null);
      tx.integration.findFirst.mockResolvedValue({ id: 'i' });
      tx.automationDelivery.findFirst.mockResolvedValue(null);
      tx.pendingPostback.findFirst.mockResolvedValue(null);
      tx.flowExecution.findFirst.mockResolvedValue(null);
      tx.flowExecution.updateMany.mockResolvedValue({ count: 1 });
      transaction = jest.fn((callback) => callback(tx));
      repo = new FlowsRepository({ model: { $transaction: transaction } } as any,
        {} as any, {} as any, flowExecution as any, {} as any, {} as any, {} as any, {} as any);
    });

    it('keeps the original log and workflow reference under a scoped serializable compare-and-swap', async () => {
      // getFlow's credential-free integration summary must not affect configuration comparison.
      expect(await repo.claimRedispatch('org', 'profile', execution, { ...flow, integration: { id: 'i' } }, 'manual')).toBe(true);
      expect(transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'Serializable' });
      expect(tx.flow.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: {
        id: 'f', organizationId: 'org', profileId: 'profile', integrationId: 'i', status: 'ACTIVE', deletedAt: null,
      } }));
      const { where, data } = tx.flowExecution.updateMany.mock.calls[0][0] as any;
      expect(where).toMatchObject({ id: 'e', status: 'COMPLETED', temporalWorkflowId: 'original', updatedAt: execution.updatedAt,
        flow: { organizationId: 'org', profileId: 'profile', status: 'ACTIVE', deletedAt: null } });
      expect(data).toMatchObject({ status: 'RUNNING', temporalWorkflowId: 'manual', completedAt: null });
      const history = JSON.parse(data.executionLog);
      expect(history.slice(0, 2)).toEqual(JSON.parse(execution.executionLog));
      expect(JSON.parse(history[2].error)).toMatchObject({ previousWorkflowId: 'original', previousStatus: 'COMPLETED' });
      expect(tx.automationDelivery.findFirst).toHaveBeenCalledWith({ where: { OR: [
        { key: { startsWith: '["i","c",' } }, { key: { startsWith: '["i","e",' } },
      ] }, select: { id: true } });
    });

    it.each(['SENT', 'SENDING', 'UNKNOWN', 'REJECTED'])('blocks any %s receipt before claiming', async (status) => {
      tx.automationDelivery.findFirst.mockResolvedValue({ id: 'receipt', status } as any);
      expect(await repo.claimRedispatch('org', 'profile', execution, flow, 'manual')).toBe(false);
      expect(tx.flowExecution.updateMany).not.toHaveBeenCalled();
    });

    it.each(['postback', 'other-execution', 'configuration', 'scope'])('blocks %s', async (scenario) => {
      if (scenario === 'postback') tx.pendingPostback.findFirst.mockResolvedValue({ id: 'pb' } as any);
      if (scenario === 'other-execution') tx.flowExecution.findFirst.mockResolvedValue({ id: 'other' } as any);
      if (scenario === 'configuration') tx.flow.findFirst.mockResolvedValue({ ...flow, triggerPostIds: '["excluded"]' });
      if (scenario === 'scope') tx.flow.findFirst.mockResolvedValue(null);
      expect(await repo.claimRedispatch('org', 'profile', execution, flow, 'manual')).toBe(false);
      expect(tx.flowExecution.updateMany).not.toHaveBeenCalled();
    });

    it.each(['ignored', 'alias-removed', 'channel-disabled'])('blocks eligibility changed before the claim: %s', async (scenario) => {
      tx.ignoredMedia.findUnique.mockResolvedValue(scenario === 'ignored' ? { id: 'ignored' } : null);
      tx.integration.findFirst.mockResolvedValue(scenario === 'channel-disabled' ? null : { id: 'i' });
      const selectedFlow = scenario === 'alias-removed' ? { ...flow, triggerPostIds: '["other"]' } : flow;
      tx.flow.findFirst.mockResolvedValue(selectedFlow);
      tx.flowMediaAlias.findFirst.mockResolvedValue(null);
      expect(await repo.claimRedispatch('org', 'profile', { ...execution, igMediaId: 'media' }, selectedFlow, 'manual')).toBe(false);
      expect(tx.flowExecution.updateMany).not.toHaveBeenCalled();
    });

    it('allows only one claim for concurrent callers', async () => {
      let claimed = false;
      tx.flowExecution.updateMany.mockImplementation(async () => {
        if (claimed) return { count: 0 };
        claimed = true;
        return { count: 1 };
      });
      const results = await Promise.all([1, 2].map(() => repo.claimRedispatch('org', 'profile', execution, flow, 'manual')));
      expect(results.sort()).toEqual([false, true]);
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


describe('Execution publication metadata scope', () => {
  it('limits stored metadata to the flow organization, profile and channel relation', async () => {
    const findFirst = jest.fn().mockResolvedValue(null);
    const repo = new FlowsRepository(
      { model: { flow: { findFirst } } } as any,
      {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any
    );
    await repo.getExecutionPublicationContext('org', 'flow', 'media', 'profile');
    expect(findFirst).toHaveBeenCalledWith({
      where: { id: 'flow', organizationId: 'org', profileId: 'profile' },
      select: {
        integrationId: true, profileId: true,
        integration: { select: {
          posts: {
            where: { organizationId: 'org', profileId: 'profile',
              OR: [{ externalId: 'media' }, { releaseId: 'media' }] },
            select: { releaseURL: true }, orderBy: { createdAt: 'desc' }, take: 1,
          },
          unmatchedComments: {
            where: { organizationId: 'org', igMediaId: 'media', permalink: { not: null } },
            select: { permalink: true }, orderBy: { enrichedAt: 'desc' }, take: 1,
          },
        } },
      },
    });
  });
});
