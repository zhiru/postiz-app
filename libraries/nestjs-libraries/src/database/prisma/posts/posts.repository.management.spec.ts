import { PostsRepository } from './posts.repository';
import { createPrismaRepositoryMock } from '@gitroom/nestjs-libraries/test';
describe('managed post writes', () => {
  it('compares organization, profile, version and editable state atomically', async () => {
    const post = createPrismaRepositoryMock('post');
    post.model.post.updateMany.mockResolvedValue({ count: 1 });
    const repo = new PostsRepository(
      post as any,
      null,
      null,
      null,
      null,
      null,
      null
    );
    await repo.patchManagedPost('o1', 'p1', 'id1', '2026-01-01T00:00:00.000Z', {
      content: '<p>Novo</p>',
    });
    expect(post.model.post.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: 'id1',
        organizationId: 'o1',
        profileId: 'p1',
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        releaseId: null,
        importedFromPlatform: false,
      }),
      data: { content: '<p>Novo</p>', updatedAt: expect.any(Date) },
    });
  });
  it('rejects stale/concurrent writes without upsert or creation', async () => {
    const post = createPrismaRepositoryMock('post');
    post.model.post.updateMany.mockResolvedValue({ count: 0 });
    const repo = new PostsRepository(
      post as any,
      null,
      null,
      null,
      null,
      null,
      null
    );
    await expect(
      repo.patchManagedPost('o1', 'p1', 'id1', '2026-01-01T00:00:00Z', {
        content: 'novo',
      })
    ).rejects.toMatchObject({ status: 409 });
    expect(post.model.post.create).not.toHaveBeenCalled();
    expect(post.model.post.upsert).not.toHaveBeenCalled();
  });
});
