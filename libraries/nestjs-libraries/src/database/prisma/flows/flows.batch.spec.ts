import { FlowsRepository } from './flows.repository';
import { FlowNodeType } from '@prisma/client';

describe('Atomic and idempotent multi-account graph creation', () => {
  const nodes = [
    {
      id: 'temp-0',
      type: FlowNodeType.TRIGGER,
      positionX: 0,
      positionY: 0,
      data: '{"mode":"all"}',
    },
    {
      id: 'temp-1',
      type: FlowNodeType.SEND_DM,
      positionX: 0,
      positionY: 150,
      data: '{"message":"Details"}',
    },
  ];
  const canvas = {
    nodes,
    edges: [{ sourceNodeId: 'temp-0', targetNodeId: 'temp-1' }],
  };
  const setup = (existing: any = null) => {
    const tx = {
      flow: {
        findUnique: jest.fn().mockResolvedValue(existing),
        create: jest.fn().mockResolvedValue({ id: 'flow' }),
      },
      flowNode: { createMany: jest.fn() },
      flowEdge: { createMany: jest.fn() },
    };
    const transaction = jest.fn(
      async (callback: (client: any) => Promise<unknown>) => callback(tx)
    );
    const repository = new FlowsRepository(
      { model: { $transaction: transaction } } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any
    );
    return { tx, transaction, repository };
  };
  it('creates each graph within one transaction and links edges to that accounts own nodes', async () => {
    const ctx = setup();
    await ctx.repository.createQuickBatch(
      'org-1',
      'profile-1',
      [
        { id: 'flow-1', integrationId: 'ig-1' },
        { id: 'flow-2', integrationId: 'ig-2' },
      ],
      'Keywords',
      canvas,
      false
    );
    expect(ctx.transaction).toHaveBeenCalledTimes(1);
    expect(
      ctx.tx.flow.create.mock.calls.map(([args]) => args.data.status)
    ).toEqual(['PAUSED', 'PAUSED']);
    for (let i = 0; i < 2; i++) {
      const nodeRows = ctx.tx.flowNode.createMany.mock.calls[i][0].data;
      const edge = ctx.tx.flowEdge.createMany.mock.calls[i][0].data[0];
      expect(edge.sourceNodeId).toBe(nodeRows[0].id);
      expect(edge.targetNodeId).toBe(nodeRows[1].id);
      expect(edge.flowId).toBe(`flow-${i + 1}`);
    }
  });
  it('returns the existing graph on a retry and never rewrites or reactivates it', async () => {
    const ctx = setup({
      id: 'flow-1',
      organizationId: 'org-1',
      profileId: 'profile-1',
      integrationId: 'ig-1',
      name: 'Keywords',
      nodes,
    });
    await ctx.repository.createQuickBatch(
      'org-1',
      'profile-1',
      [{ id: 'flow-1', integrationId: 'ig-1' }],
      'Keywords',
      canvas,
      true
    );
    expect(ctx.tx.flow.create).not.toHaveBeenCalled();
    expect(ctx.tx.flowNode.createMany).not.toHaveBeenCalled();
    expect(ctx.tx.flowEdge.createMany).not.toHaveBeenCalled();
  });
  it('rejects reusing a request id with a different configuration', async () => {
    const ctx = setup({
      id: 'flow-1',
      organizationId: 'org-1',
      profileId: 'profile-1',
      integrationId: 'ig-1',
      name: 'Other',
      nodes,
    });
    await expect(
      ctx.repository.createQuickBatch(
        'org-1',
        'profile-1',
        [{ id: 'flow-1', integrationId: 'ig-1' }],
        'Keywords',
        canvas,
        false
      )
    ).rejects.toThrow('different settings');
    expect(ctx.tx.flowNode.createMany).not.toHaveBeenCalled();
  });
});
