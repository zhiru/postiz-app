import { CreationMethod } from '@prisma/client';
import { PostsRepository } from './posts.repository';
import { createPrismaRepositoryMock } from '@gitroom/nestjs-libraries/test';

describe('PostsRepository - isolamento de perfil e snapshots', () => {
  it.each([false, true])(
    'nao remove grupo alheio com keepGroup=%s',
    async (keepGroup) => {
      const post = createPrismaRepositoryMock('post');
      const tagsPosts = createPrismaRepositoryMock('tagsPosts');
      tagsPosts.model.tagsPosts.deleteMany.mockResolvedValue({ count: 0 });
      post.model.post.findFirst.mockResolvedValue(null);
      post.model.post.upsert.mockResolvedValue({ id: 'new-post' });
      const rows: Array<{
        id: string;
        organizationId: string;
        profileId: string;
        group: string;
        deletedAt: Date | null;
      }> = [
        {
          id: 'foreign-org',
          organizationId: 'other-org',
          profileId: 'profile-1',
          group: 'known-group',
          deletedAt: null,
        },
        {
          id: 'foreign-profile',
          organizationId: 'org-1',
          profileId: 'profile-2',
          group: 'known-group',
          deletedAt: null,
        },
        {
          id: 'own-old-comment',
          organizationId: 'org-1',
          profileId: 'profile-1',
          group: 'known-group',
          deletedAt: null,
        },
      ];
      post.model.post.updateMany.mockImplementation(
        async ({ where, data }: any) => {
          const matched = rows.filter(
            (row) =>
              row.group === where.group &&
              (!where.organizationId ||
                row.organizationId === where.organizationId) &&
              (!where.profileId || row.profileId === where.profileId) &&
              row.deletedAt === null &&
              !where.id?.notIn?.includes(row.id)
          );
          matched.forEach((row) => Object.assign(row, data));
          return { count: matched.length };
        }
      );
      const repo = new PostsRepository(
        post as any,
        {} as any,
        {} as any,
        {} as any,
        tagsPosts as any,
        {} as any,
        {} as any
      );

      await repo.createOrUpdatePost(
        'draft',
        'org-1',
        '2026-10-19T12:00:00Z',
        {
          group: 'known-group',
          integration: { id: 'channel' },
          settings: {},
          value: [{ id: 'new-post', content: 'new', image: [] }],
        } as any,
        [],
        CreationMethod.WEB,
        undefined,
        keepGroup,
        'batch',
        'profile-1'
      );

      expect(
        rows.find((row) => row.id === 'foreign-org')?.deletedAt
      ).toBeNull();
      expect(
        rows.find((row) => row.id === 'foreign-profile')?.deletedAt
      ).toBeNull();
      expect(
        rows.find((row) => row.id === 'own-old-comment')?.deletedAt
      ).toBeInstanceOf(Date);
      for (const [query] of post.model.post.findFirst.mock.calls) {
        expect(query.where).toMatchObject({
          organizationId: 'org-1',
          profileId: 'profile-1',
        });
      }
    }
  );

  it('mantem o perfil em snapshots novos e existentes de uma recorrencia publicada', async () => {
    const post = createPrismaRepositoryMock('post');
    const tx = {
      post: {
        ...post.model.post,
        findFirstOrThrow: jest.fn().mockResolvedValue({
          id: 'recurring-root',
          organizationId: 'org-1',
          profileId: 'profile-1',
          integrationId: 'channel',
          intervalInDays: 7,
          publishDate: new Date('2026-10-01T12:00:00Z'),
          content: 'weekly',
          image: '[]',
          settings: '{}',
          creationMethod: CreationMethod.WEB,
        }),
      },
      tagsPosts: createPrismaRepositoryMock('tagsPosts').model.tagsPosts,
    };
    tx.tagsPosts.findMany.mockResolvedValue([]);
    tx.post.findUnique.mockResolvedValue(null);
    tx.post.update.mockResolvedValue({ id: 'recurring-root' });
    const transaction = {
      model: { $transaction: jest.fn().mockImplementation((run) => run(tx)) },
    };
    const repo = new PostsRepository(
      post as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      transaction as any
    );

    await repo.updatePost(
      'recurring-root',
      'remote-occurrence',
      'https://example.com/post'
    );

    const snapshot = tx.post.upsert.mock.calls[0][0];
    expect(snapshot.create.profileId).toBe('profile-1');
    expect(snapshot.update.profileId).toBe('profile-1');
    expect(snapshot.create.recurringSourceId).toBe('recurring-root');
    expect(snapshot.create.importedFromPlatform).toBe(true);
  });
  it('filtra historico antigo e canais irmaos pelo perfil ativo', async () => {
    const post = createPrismaRepositoryMock('post');
    post.model.post.findMany.mockResolvedValue([]);
    const repo = new PostsRepository(
      post as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any
    );
    await repo.getOldPosts('org-1', '2026-10-01', 'profile-1');
    await repo.getPostsByBatch(
      'org-1',
      'shared-batch',
      'own-group',
      'profile-1'
    );
    for (const [query] of post.model.post.findMany.mock.calls) {
      expect(query.where).toMatchObject({
        organizationId: 'org-1',
        profileId: 'profile-1',
      });
    }
  });
});
