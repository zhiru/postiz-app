import { NeuralTalkDeliveryService } from './neuraltalk.delivery.service';
import { PostsRepository } from '../database/prisma/posts/posts.repository';
import { createMock } from '../test';

describe('NeuralTalkDeliveryService', () => {
  const context = {
    organizationId: 'org',
    profileId: 'profile',
    integrationId: 'channel',
    postId: 'post',
    target: 'contact:1',
    payloadHash: 'hash',
  };
  function setup() {
    const repo = createMock<PostsRepository>();
    repo.reservePostOperation.mockResolvedValue({
      claimed: true,
      requestHash: 'hash',
      result: null,
    });
    return { repo, service: new NeuralTalkDeliveryService(repo) };
  }
  it('persists receipt before success and replays without sending again', async () => {
    const x = setup(),
      send = jest
        .fn()
        .mockResolvedValue({ conversationId: '2', messageId: '3' });
    expect(await x.service.execute(context, send)).toEqual({
      conversationId: '2',
      messageId: '3',
    });
    expect(x.repo.completePostOperation).toHaveBeenCalled();
    const result = JSON.stringify({
      receipt: { conversationId: '2', messageId: '3' },
    });
    x.repo.reservePostOperation.mockResolvedValue({
      claimed: false,
      requestHash: 'hash',
      result,
    });
    await x.service.execute(context, send);
    expect(send).toHaveBeenCalledTimes(1);
  });
  it('blocks ambiguous previous send and altered payload', async () => {
    const x = setup(),
      send = jest.fn();
    x.repo.reservePostOperation.mockResolvedValue({
      claimed: false,
      requestHash: 'hash',
      result: null,
    });
    await expect(x.service.execute(context, send)).rejects.toThrow();
    x.repo.reservePostOperation.mockResolvedValue({
      claimed: false,
      requestHash: 'other',
      result: null,
    });
    await expect(x.service.execute(context, send)).rejects.toThrow();
    expect(send).not.toHaveBeenCalled();
  });
  it('never clears a reservation after an unknown network result', async () => {
    const x = setup();
    await expect(
      x.service.execute(context, async () => {
        throw new Error('network timeout');
      })
    ).rejects.toThrow();
    expect(x.repo.completePostOperation).not.toHaveBeenCalled();
  });
  it('namespaces receipts by tenant/profile/post/channel and destination', async () => {
    const x = setup(),
      send = async () => ({ conversationId: '2', messageId: '3' });
    for (const changes of [
      {},
      { organizationId: 'other' },
      { profileId: 'other' },
      { postId: 'other' },
      { integrationId: 'other' },
      { target: 'group:2' },
    ])
      await x.service.execute({ ...context, ...changes }, send);
    expect(
      new Set(x.repo.reservePostOperation.mock.calls.map((c) => c[0])).size
    ).toBe(6);
  });
});
