jest.mock('./posts.service', () => ({ PostsService: class {} }));
jest.mock('../media/media.service', () => ({ MediaService: class {} }));
jest.mock('@gitroom/nestjs-libraries/integrations/integration.manager', () => ({
  IntegrationManager: class {},
}));
import { PostManagementService } from './post.management.service';
import { createMock } from '@gitroom/nestjs-libraries/test';
import { PostsRepository } from './posts.repository';
import { PostsService } from './posts.service';

const row = (): any => ({
  id: 'p1',
  organizationId: 'o1',
  profileId: 'profile1',
  integrationId: 'i1',
  group: 'g1',
  parentPostId: null,
  state: 'DRAFT',
  publishDate: new Date('2027-01-01T16:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
  content: '<p>Original</p>',
  image: '[{"id":"m1","path":"https://media.test/a.jpg","alt":"original"}]',
  settings:
    '{"__type":"instagram","post_type":"post","collaborators":[{"label":"@parceiro"}]}',
  releaseId: null,
  releaseURL: null,
  importedFromPlatform: false,
  comments: [],
  integration: { id: 'i1', name: 'Conta', providerIdentifier: 'instagram' },
});
const setup = () => {
  const repo = createMock<PostsRepository>();
  const posts = createMock<PostsService>();
  const media = { assertReadyForPosts: jest.fn().mockResolvedValue([]) };
  const temporal = {
    client: {
      getRawClient: jest.fn().mockReturnValue({
        workflow: {
          getHandle: jest.fn().mockReturnValue({
            describe: jest
              .fn()
              .mockRejectedValue({ name: 'WorkflowNotFoundError' }),
          }),
        },
      }),
    },
  };
  const service = new PostManagementService(
    repo,
    posts,
    media as any,
    temporal as any,
    {
      getComments: jest.fn().mockResolvedValue({ comments: [], count: 0 }),
    } as any
  );
  repo.getManagedPost.mockResolvedValue([row()] as any);
  repo.patchManagedPost.mockResolvedValue(true);
  posts.validatePosts.mockResolvedValue([
    { valid: true, errors: true, emptyContent: false, tooLong: false },
  ] as any);
  return { repo, posts, media, service, temporal };
};
describe('PostManagementService', () => {
  it('patches only supplied content, never calls create or schedules', async () => {
    const { service, repo, posts } = setup();
    await service.update('o1', 'profile1', 'p1', {
      version: row().updatedAt.toISOString(),
      content: 'Novo',
    });
    expect(repo.patchManagedPost).toHaveBeenCalledWith(
      'o1',
      'profile1',
      'p1',
      row().updatedAt.toISOString(),
      { content: '<p>Novo</p>' }
    );
    expect(posts.createPost).not.toHaveBeenCalled();
    expect(posts.startWorkflow).not.toHaveBeenCalled();
  });
  it('rejects stale versions and published records before any write', async () => {
    const { service, repo } = setup();
    await expect(
      service.update('o1', 'profile1', 'p1', {
        version: '2025-01-01T00:00:00Z',
        content: 'Novo',
      })
    ).rejects.toMatchObject({ status: 409 });
    repo.getManagedPost.mockResolvedValue([
      { ...row(), state: 'PUBLISHED', releaseId: 'remote1' },
    ] as any);
    await expect(
      service.update('o1', 'profile1', 'p1', {
        version: row().updatedAt.toISOString(),
        content: 'Novo',
      })
    ).rejects.toMatchObject({ status: 409 });
    expect(repo.patchManagedPost).not.toHaveBeenCalled();
  });
  it('never exposes a record from another profile', async () => {
    const { service, repo } = setup();
    repo.getManagedPost.mockResolvedValue([]);
    await expect(service.get('o1', 'other', 'p1')).rejects.toMatchObject({
      status: 404,
    });
    expect(repo.getManagedPost).toHaveBeenCalledWith('o1', 'other', 'p1');
  });
  it('dry run returns before/after without mutations or workflow calls', async () => {
    const { service, repo, posts } = setup();
    const result = await service.update('o1', 'profile1', 'p1', {
      version: row().updatedAt.toISOString(),
      content: 'Novo',
      dryRun: true,
    });
    expect(result.diff).toEqual({
      content: { before: '<p>Original</p>', after: '<p>Novo</p>' },
    });
    expect(repo.patchManagedPost).not.toHaveBeenCalled();
    expect(posts.startWorkflow).not.toHaveBeenCalled();
  });
  it('preserves exact media order and metadata when omitted', async () => {
    const { service, repo } = setup();
    await service.update('o1', 'profile1', 'p1', {
      version: row().updatedAt.toISOString(),
      settings: { collaborators: [] },
    });
    const data = repo.patchManagedPost.mock.calls[0][4];
    expect(Object.keys(data)).toEqual(['settings']);
    expect(JSON.parse(data.settings as string)).toEqual({
      __type: 'instagram',
      post_type: 'post',
      collaborators: [],
    });
  });
  it('does not report a missing remote id as published', async () => {
    const { service, repo } = setup();
    repo.getManagedPost.mockResolvedValue([
      { ...row(), state: 'PUBLISHED', releaseId: 'missing' },
    ] as any);
    expect((await service.get('o1', 'profile1', 'p1')).executionState).toBe(
      'AWAITING_REMOTE_CONFIRMATION'
    );
  });
});

describe('management preservation and bulk results', () => {
  it('preserves per-media alt/cover while reordering by ID', async () => {
    const { service, repo, media } = setup();
    const root = row();
    root.image = JSON.stringify([
      {
        id: 'a',
        path: 'https://media.test/a.jpg',
        alt: 'A',
        thumbnail: 'https://media.test/cover.jpg',
      },
      { id: 'b', path: 'https://media.test/b.jpg', alt: 'B' },
    ]);
    repo.getManagedPost.mockResolvedValue([root]);
    (media as any).resolvePostMedia = jest.fn(async (_o: any, m: any) => m);
    await service.update('o1', 'profile1', 'p1', {
      version: root.updatedAt.toISOString(),
      media: [{ id: 'b' }, { id: 'a' }],
    });
    const images = JSON.parse(
      repo.patchManagedPost.mock.calls[0][4].image as string
    );
    expect(images).toEqual([
      JSON.parse(root.image)[1],
      JSON.parse(root.image)[0],
    ]);
  });
  it('requires the exact dry-run hash to apply normalization', async () => {
    const { service, repo } = setup();
    const root = { ...row(), content: '<p>Um</p><p>Dois</p>' };
    repo.getManagedPost.mockResolvedValue([root]);
    const input = {
      version: root.updatedAt.toISOString(),
      normalizeSpacing: true,
    };
    await expect(
      service.update('o1', 'profile1', 'p1', input)
    ).rejects.toMatchObject({ status: 428 });
    const preview = await service.update('o1', 'profile1', 'p1', {
      ...input,
      dryRun: true,
    });
    await service.update('o1', 'profile1', 'p1', {
      ...input,
      previewHash: preview.previewHash,
    });
    expect(repo.patchManagedPost).toHaveBeenCalledWith(
      'o1',
      'profile1',
      'p1',
      input.version,
      { content: '<p>Um</p><p></p><p>Dois</p>' }
    );
  });
  it('merges nested settings without clearing omitted cover fields', async () => {
    const { service, repo } = setup();
    const root = row();
    root.settings = JSON.stringify({
      __type: 'instagram',
      post_type: 'post',
      cover: { id: 'cover', alt: 'Keep' },
    });
    repo.getManagedPost.mockResolvedValue([root]);
    await service.update('o1', 'profile1', 'p1', {
      version: root.updatedAt.toISOString(),
      settings: { cover: { alt: 'Changed' } },
    });
    expect(
      JSON.parse(repo.patchManagedPost.mock.calls[0][4].settings as string)
        .cover
    ).toEqual({ id: 'cover', alt: 'Changed' });
  });
  it('does not update unchanged content or version', async () => {
    const { service, repo } = setup();
    const result = await service.update('o1', 'profile1', 'p1', {
      version: row().updatedAt.toISOString(),
      content: '<p>Original</p>',
    });
    expect(result.status).toBe('skipped');
    expect(repo.patchManagedPost).not.toHaveBeenCalled();
  });
  it('reports each dry-run failure and continues with the next post', async () => {
    const { service, repo } = setup();
    repo.getManagedPost.mockImplementation(async (_o, _p, id) =>
      id === 'missing' ? [] : ([row()] as any)
    );
    const result = await service.bulk('o1', 'profile1', {
      idempotencyKey: 'test-bulk-1',
      dryRun: true,
      updates: [
        { id: 'missing', changes: { version: row().updatedAt.toISOString() } },
        {
          id: 'p1',
          changes: { version: row().updatedAt.toISOString(), content: 'Novo' },
        },
      ],
    });
    expect(result.results.map((r) => r.status)).toEqual(['failed', 'preview']);
    expect(repo.patchManagedPost).not.toHaveBeenCalled();
  });
});

it('reports an applied edit with confirmation pending when the final read fails', async () => {
  const { service, repo } = setup();
  repo.getManagedPost
    .mockResolvedValueOnce([row()])
    .mockRejectedValueOnce(new Error('Read unavailable'));
  const result = await service.update('o1', 'profile1', 'p1', {
    version: row().updatedAt.toISOString(),
    content: 'Novo',
  });
  expect(result.status).toBe('updated');
  expect(result).toMatchObject({ confirmation: 'pending' });
  expect(repo.patchManagedPost).toHaveBeenCalledTimes(1);
});

it('redacts stored credentials from settings diffs as well as returned posts', async () => {
  const { service, repo } = setup();
  const root = row();
  root.settings = JSON.stringify({
    __type: 'instagram',
    post_type: 'post',
    hiddenToken: 'SECRET_FIXTURE',
  });
  repo.getManagedPost.mockResolvedValue([root]);
  const result = await service.update('o1', 'profile1', 'p1', {
    version: root.updatedAt.toISOString(),
    settings: { collaborators: [] },
    dryRun: true,
  });
  expect(JSON.stringify(result)).not.toContain('SECRET_FIXTURE');
  expect(result.diff.settings.before).not.toContain('hiddenToken');
});

it('stores only the canonical owned media id even when input pairs an unrelated id with its path', async () => {
  const { service, repo, media } = setup();
  (media as any).resolvePostMedia = jest
    .fn()
    .mockResolvedValue({ id: 'owned-id', path: 'https://media.test/own.jpg' });
  await service.update('o1', 'profile1', 'p1', {
    version: row().updatedAt.toISOString(),
    media: [{ id: 'foreign-id', path: 'https://media.test/own.jpg' }],
  });
  expect(
    JSON.parse(repo.patchManagedPost.mock.calls[0][4].image as string)[0]
  ).toMatchObject({ id: 'owned-id', path: 'https://media.test/own.jpg' });
});

it('reports confirmed remote deletion instead of claiming a live publication', async () => {
  const { service, repo, posts } = setup();
  repo.getManagedPost.mockResolvedValue([
    { ...row(), state: 'PUBLISHED', releaseId: '123' },
  ] as any);
  posts.getRemoteDeletionInfo.mockResolvedValue({
    status: 'deleted',
    supported: true,
  } as any);
  const result = await service.get('o1', 'profile1', 'p1');
  expect(result.executionState).toBe('REMOTE_DELETED');
  expect(result.remoteDeletion.status).toBe('deleted');
});
