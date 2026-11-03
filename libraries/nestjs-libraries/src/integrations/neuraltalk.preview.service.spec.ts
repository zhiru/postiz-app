import { NeuralTalkDeliveryService } from './neuraltalk.delivery.service';
import { PostsRepository } from '../database/prisma/posts/posts.repository';
import { createMock } from '../test';

// Exercise the same operation identity used by the send path.
describe('NeuralTalk persisted recipient preview', () => {
  function setup(state = 'QUEUE', releaseId: string | null = null) {
    const repo = createMock<PostsRepository>();
    repo.getRecipientPreviewPost.mockResolvedValue({
      id: 'post',
      organizationId: 'org',
      profileId: 'profile',
      integrationId: 'channel',
      state,
      releaseId,
      integration: { providerIdentifier: 'neuraltalk', profileId: 'profile' },
      settings: JSON.stringify({ targets: ['contact:1', 'group:2'] }),
    } as any);
    repo.getPostOperations.mockResolvedValue([]);
    repo.reservePostOperation.mockResolvedValue({
      claimed: true,
      requestHash: 'hash',
      result: null,
    });
    return { repo, service: new NeuralTalkDeliveryService(repo) };
  }
  it('shows configured targets without claiming delivery', async () => {
    const { repo, service } = setup();
    expect(await service.preview('org', 'profile', 'post')).toEqual({
      integrationId: 'channel',
      recipients: [
        { target: 'contact:1', status: 'configured' },
        { target: 'group:2', status: 'configured' },
      ],
    });
    expect(repo.getRecipientPreviewPost).toHaveBeenCalledWith(
      'org',
      'profile',
      'post'
    );
  });
  it('requires both a persisted receipt and published message identity to confirm provider send', async () => {
    const { repo, service } = setup('PUBLISHED', '3');
    await service.execute(
      {
        organizationId: 'org',
        profileId: 'profile',
        integrationId: 'channel',
        postId: 'post',
        target: 'contact:1',
        payloadHash: 'hash',
      },
      async () => ({ conversationId: '2', messageId: '3' })
    );
    const id = repo.reservePostOperation.mock.calls[0][0];
    // Existing persisted operation identity must survive the extraction/refactor.
    expect(id).toBe(
      'neuraltalk:17c44200af915b15f98a026422985b0249aef7aba4d2ab7a05df8f4e2bcd236c'
    );
    repo.getPostOperations.mockResolvedValue([
      {
        id,
        result: JSON.stringify({
          receipt: { conversationId: '2', messageId: '3' },
        }),
      },
    ]);
    expect(
      (await service.preview('org', 'profile', 'post')).recipients[0].status
    ).toBe('confirmed');
    repo.getRecipientPreviewPost.mockResolvedValue({
      ...(await repo.getRecipientPreviewPost('org', 'profile', 'post')),
      state: 'ERROR',
    } as any);
    expect(
      (await service.preview('org', 'profile', 'post')).recipients[0].status
    ).toBe('accepted');
  });
  it.each([null, '{broken', '{}', '{"receipt":{"messageId":"3"}}'])(
    'treats ambiguous receipts as unknown: %s',
    async (result) => {
      const { repo, service } = setup('PUBLISHED', '3');
      repo.reservePostOperation.mockResolvedValue({
        claimed: true,
        requestHash: 'hash',
        result: null,
      });
      await service.execute(
        {
          organizationId: 'org',
          profileId: 'profile',
          integrationId: 'channel',
          postId: 'post',
          target: 'group:2',
          payloadHash: 'hash',
        },
        async () => ({ conversationId: '2', messageId: '3' })
      );
      const id = repo.reservePostOperation.mock.calls[0][0];
      repo.getPostOperations.mockResolvedValue([{ id, result }]);
      expect(
        (await service.preview('org', 'profile', 'post')).recipients[1].status
      ).toBe('unknown');
    }
  );
  it.each([
    null,
    '{broken',
    'null',
    '{"targets":["contact:1","bad","contact:1"]}',
  ])('handles legacy settings safely: %s', async (settings) => {
    const { repo, service } = setup();
    repo.getRecipientPreviewPost.mockResolvedValue({
      ...(await repo.getRecipientPreviewPost('org', 'profile', 'post')),
      settings,
    } as any);
    const result = await service.preview('org', 'profile', 'post');
    expect(result.recipients).toEqual(
      settings?.includes('contact:1')
        ? [{ target: 'contact:1', status: 'configured' }]
        : []
    );
  });
  it('returns 404 for posts outside the scope before reading operations', async () => {
    const { repo, service } = setup();
    repo.getRecipientPreviewPost.mockResolvedValue(null);
    await expect(
      service.preview('other', 'other', 'post')
    ).rejects.toMatchObject({ status: 404 });
    expect(repo.getPostOperations).not.toHaveBeenCalled();
  });
  it('does not confirm a different published message and preserves rejected outcomes', async () => {
    const { repo, service } = setup('PUBLISHED', '999');
    await service.execute(
      {
        organizationId: 'org',
        profileId: 'profile',
        integrationId: 'channel',
        postId: 'post',
        target: 'contact:1',
        payloadHash: 'hash',
      },
      async () => ({ conversationId: '2', messageId: '3' })
    );
    const id = repo.reservePostOperation.mock.calls[0][0];
    repo.getPostOperations.mockResolvedValue([
      {
        id,
        result: JSON.stringify({
          receipt: { conversationId: '2', messageId: '3' },
        }),
      },
    ]);
    expect(
      (await service.preview('org', 'profile', 'post')).recipients[0].status
    ).toBe('accepted');
    repo.getPostOperations.mockResolvedValue([
      { id, result: '{"rejected":true}' },
    ]);
    expect(
      (await service.preview('org', 'profile', 'post')).recipients[0].status
    ).toBe('rejected');
  });
  it('does not interpret another provider settings as NeuralTalk targets', async () => {
    const { repo, service } = setup();
    repo.getRecipientPreviewPost.mockResolvedValue({
      ...(await repo.getRecipientPreviewPost('org', 'profile', 'post')),
      integration: { providerIdentifier: 'instagram' },
    } as any);
    await expect(
      service.preview('org', 'profile', 'post')
    ).rejects.toMatchObject({ status: 404 });
    expect(repo.getPostOperations).not.toHaveBeenCalled();
  });
});
