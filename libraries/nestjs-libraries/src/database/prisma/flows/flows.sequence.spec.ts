// Mocks topo-de-modulo: FlowsService importa IntegrationManager (nostr.provider
// ESM-only que quebra ts-jest) e serviços que o puxam transitivamente. Nada
// disso é usado pelo caminho de configuração de DM.
jest.mock('@gitroom/nestjs-libraries/integrations/integration.manager', () => ({
  IntegrationManager: class IntegrationManagerMock {},
}));
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service',
  () => ({ IntegrationService: class IntegrationServiceMock {} })
);
jest.mock(
  '@gitroom/nestjs-libraries/integrations/social/instagram-messaging.service',
  () => ({ InstagramMessagingService: class InstagramMessagingServiceMock {} })
);
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/credentials/credential.service',
  () => ({ CredentialService: class CredentialServiceMock {} })
);
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/profiles/profile.service',
  () => ({ ProfileService: class ProfileServiceMock {} })
);

import { FlowsService, validateFlowSequence } from './flows.service';

const n = (id: string, type: string, data = {}) => ({
  id,
  type,
  data: JSON.stringify(data),
  positionX: 0,
  positionY: 0,
});
const graph = (nodes: any[]) => ({
  nodes,
  edges: nodes
    .slice(1)
    .map((v, i) => ({ sourceNodeId: nodes[i].id, targetNodeId: v.id })),
});
const trigger = (type = 'comment_on_post') =>
  n('t', 'TRIGGER', { executionVersion: 2, triggerType: type });
const dm = (id: string) => n(id, 'SEND_DM', { message: 'Hello' });
const wait = () => n('w', 'DELAY', { mode: 'reply', timeoutHours: 24 });

describe('validateFlowSequence', () => {
  it('allows one private reply followed by a reply wait and separate messages', () => {
    expect(() =>
      validateFlowSequence(
        graph([trigger(), dm('a'), wait(), dm('b'), dm('c')]) as any
      )
    ).not.toThrow();
  });
  it('does not treat a timer as permission to send another DM', () => {
    expect(() =>
      validateFlowSequence(
        graph([
          trigger(),
          dm('a'),
          n('d', 'DELAY', { duration: 5, unit: 'minutes' }),
          dm('b'),
        ]) as any
      )
    ).toThrow(/reply/i);
  });
  it('allows sequential text and media in an open Story conversation', () => {
    expect(() =>
      validateFlowSequence(
        graph([
          trigger('story_reply'),
          dm('a'),
          n('m', 'SEND_DM', { media: { id: 'media', type: 'video' } }),
        ]) as any
      )
    ).not.toThrow();
  });
  it('rejects media as a first comment reply', () => {
    expect(() =>
      validateFlowSequence(
        graph([
          trigger(),
          n('m', 'SEND_DM', { media: { id: 'media', type: 'image' } }),
        ]) as any
      )
    ).toThrow(/reply/i);
  });
  it('rejects cycles and dangling edges', () => {
    const body = graph([trigger(), dm('a')]);
    body.edges.push({ sourceNodeId: 'a', targetNodeId: 't' });
    expect(() => validateFlowSequence(body as any)).toThrow(/cycle/i);
    expect(() =>
      validateFlowSequence({
        ...body,
        edges: [{ sourceNodeId: 't', targetNodeId: 'missing' }],
      } as any)
    ).toThrow(/edge/i);
  });
  it('checks every branch instead of only adjacent DM nodes', () => {
    const body = graph([trigger(), dm('a'), wait(), dm('b')]);
    body.edges.push({ sourceNodeId: 'a', targetNodeId: 'b' });
    expect(() => validateFlowSequence(body as any)).toThrow();
  });
  it.each([
    {},
    { message: '' },
    { media: { id: 'm', type: 'html' } },
    { message: 'x', buttonText: 'Go', buttonUrl: 'http://localhost' },
  ])('rejects invalid message configuration %j', (data) => {
    expect(() =>
      validateFlowSequence(
        graph([trigger('story_reply'), n('m', 'SEND_DM', data)]) as any
      )
    ).toThrow();
  });
  it('rejects unsupported combinations with the existing comment follow gate', () => {
    expect(() =>
      validateFlowSequence(
        graph([
          n('t', 'TRIGGER', { executionVersion: 2, requireFollow: true }),
          dm('a'),
        ]) as any
      )
    ).toThrow(/follow/i);
  });
});

describe('Sequence opt-in and response delivery', () => {
  const setup = () => {
    const repo = {
      getFlow: jest.fn().mockResolvedValue({ status: 'PAUSED' }),
      saveCanvas: jest.fn(),
      findReplyWaits: jest.fn().mockResolvedValue([]),
    };
    const signal = jest.fn();
    const client = { workflow: { getHandle: jest.fn(() => ({ signal })) } };
    const service = new FlowsService(
      repo as any,
      { client: { getRawClient: () => client } } as any,
      null as any,
      null as any,
      null as any,
      null as any,
      null as any,
      {} as any,
      {} as any
    );
    return { repo, signal, client, service };
  };
  it('does not change an active automation when enabling the new engine', async () => {
    const { repo, service } = setup();
    repo.getFlow.mockResolvedValue({ status: 'ACTIVE' });
    await expect(
      service.saveCanvas(
        'org',
        'f',
        { ...graph([trigger(), dm('a')]), executionVersion: 2 } as any,
        'p'
      )
    ).rejects.toThrow(/Pause/i);
    expect(repo.saveCanvas).not.toHaveBeenCalled();
  });
  it('cannot downgrade an active V2 flow by omitting the version in the body', async () => {
    const { repo, service } = setup();
    repo.getFlow.mockResolvedValue({
      status: 'ACTIVE',
      nodes: [trigger()],
    } as any);
    await expect(
      service.saveCanvas(
        'org',
        'f',
        graph([n('t', 'TRIGGER'), dm('a')]) as any,
        'p'
      )
    ).rejects.toThrow(/Pause/i);
    expect(repo.saveCanvas).not.toHaveBeenCalled();
  });
  it('keeps legacy saves on the original engine', async () => {
    const { repo, service } = setup();
    const body = graph([n('t', 'TRIGGER'), dm('a')]);
    await service.saveCanvas('org', 'f', body as any, 'p');
    expect(repo.saveCanvas.mock.calls[0][2][0].data).toBe('{}');
  });
  it('resumes only a matching V2 wait returned by the scoped repository', async () => {
    const { repo, service, signal } = setup();
    repo.findReplyWaits.mockResolvedValue([
      {
        temporalWorkflowId: 'wf',
        currentNodeId: 'w',
        flow: { nodes: [trigger(), wait()] },
      },
    ] as any);
    const at = Date.now();
    await service.handleIncomingFlowReply({
      organizationId: 'org',
      integrationId: 'i',
      senderId: 'u',
      eventId: 'mid',
      at,
      text: 'yes',
    });
    expect(repo.findReplyWaits).toHaveBeenCalledWith('org', 'i', 'u');
    expect(signal).toHaveBeenCalledWith('flow-message-reply-v2', {
      nodeId: 'w',
      eventId: 'mid',
      at,
      text: 'yes',
    });
  });
  it('ignores stale messages and legacy executions', async () => {
    const { repo, service, signal } = setup();
    const event = {
      organizationId: 'org',
      integrationId: 'i',
      senderId: 'u',
      eventId: 'mid',
      at: Date.now() - 24 * 3600_000,
      text: 'yes',
    };
    await service.handleIncomingFlowReply(event);
    expect(repo.findReplyWaits).not.toHaveBeenCalled();
    repo.findReplyWaits.mockResolvedValue([
      {
        temporalWorkflowId: 'wf',
        currentNodeId: 'w',
        flow: { nodes: [n('t', 'TRIGGER'), wait()] },
      },
    ] as any);
    await service.handleIncomingFlowReply({ ...event, at: Date.now() });
    expect(signal).not.toHaveBeenCalled();
  });
});
