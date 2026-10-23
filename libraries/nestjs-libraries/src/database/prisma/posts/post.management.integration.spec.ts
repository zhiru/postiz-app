import { MediaRepository } from '../media/media.repository';
import { SocialCommentsService } from '../social-comments/social.comments.service';
import { SocialCommentsRepository } from '../social-comments/social.comments.repository';
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service',
  () => ({ IntegrationService: class IntegrationServiceMock {} })
);
jest.mock('@gitroom/nestjs-libraries/ai/ai-text.service', () => ({
  AiTextService: class AiTextServiceMock {},
}));
jest.mock('@gitroom/nestjs-libraries/openai/openai.service', () => ({
  OpenaiService: class OpenaiServiceMock {},
}));

jest.mock('@gitroom/nestjs-libraries/upload/upload.factory', () => ({
  UploadFactory: { createStorage: jest.fn().mockReturnValue({}) },
}));

import { CreationMethod } from '@prisma/client';
jest.mock('@gitroom/nestjs-libraries/integrations/integration.manager', () => ({
  IntegrationManager: class IntegrationManagerMock {},
}));
jest.mock(
  '@gitroom/nestjs-libraries/integrations/refresh.integration.service',
  () => ({ RefreshIntegrationService: class RefreshIntegrationServiceMock {} })
);
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/media/media.service',
  () => ({ MediaService: class MediaServiceMock {} })
);
jest.mock('@gitroom/nestjs-libraries/short-linking/short.link.service', () => ({
  ShortLinkService: class ShortLinkServiceMock {},
}));

import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { Connection, Client } from '@temporalio/client';
import { PrismaRepository, PrismaTransaction } from '../prisma.service';
import { PostsRepository } from './posts.repository';
import { PostsService } from './posts.service';
import { PostManagementService } from './post.management.service';
import { PublicPostsController } from '@gitroom/backend/public-api/routes/v1/public.posts.controller';
const suite =
  process.env.RUN_POST_MANAGEMENT_INTEGRATION === '1'
    ? describe
    : describe.skip;
suite('API management with real PostgreSQL and Temporal', () => {
  let db: PrismaClient,
    connection: Connection,
    client: Client,
    app: any,
    base: string,
    org: any,
    profile: any,
    other: any,
    integration: any,
    repo: PostsRepository,
    posts: PostsService,
    management: PostManagementService;
  const version = (p: any) => p.updatedAt.toISOString();
  const request = async (
    path: string,
    method = 'GET',
    body?: any,
    key = 'profile-one'
  ) => {
    const response = await fetch(base + '/public/v1/posts/' + path, {
      method,
      headers: {
        authorization: 'Bearer ' + key,
        'Content-Type': 'application/json',
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, body: (await response.json()) as any };
  };
  const create = async (state: any = 'DRAFT') =>
    db.post.create({
      data: {
        organizationId: org.id,
        profileId: profile.id,
        integrationId: integration.id,
        group: crypto.randomUUID(),
        state,
        publishDate: new Date(Date.now() + 86400000),
        content: '<p>Um</p><p>Dois</p><p>📅 Dia 10</p><p>📍 Local</p>',
        image: JSON.stringify([
          {
            id: 'image-one',
            path: 'https://example.test/a.png',
            alt: 'A',
            thumbnail: 'https://example.test/cover.png',
          },
          { id: 'image-two', path: 'https://example.test/b.png', alt: 'B' },
        ]),
        settings: JSON.stringify({
          __type: 'instagram',
          post_type: 'post',
          collaborators: [{ label: '@parceiro' }],
          hiddenToken: 'DUMMY_SHOULD_NOT_LEAVE_SERVER',
        }),
        intervalInDays: 7,
        title: 'Preserve title',
        description: 'Preserve description',
        batchId: 'original-batch',
      },
    });
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL);
    if (
      url.hostname !== '127.0.0.1' ||
      url.port !== '65432' ||
      url.pathname !== '/mcp_tests'
    )
      throw new Error('Integration test requires the isolated test database');
    if (process.env.TEMPORAL_TEST_ADDRESS !== '127.0.0.1:17233')
      throw new Error('Integration test requires isolated Temporal');
    db = new PrismaClient({
      datasources: { db: { url: process.env.DATABASE_URL } },
    });
    org = await db.organization.create({
      data: { name: 'MCP integration test' },
    });
    profile = await db.profile.create({
      data: { name: 'One', slug: 'one', organizationId: org.id },
    });
    other = await db.profile.create({
      data: { name: 'Other', slug: 'other', organizationId: org.id },
    });
    integration = await db.integration.create({
      data: {
        internalId: crypto.randomUUID(),
        organizationId: org.id,
        profileId: profile.id,
        name: 'Test channel',
        providerIdentifier: 'instagram',
        type: 'social',
        token: 'DUMMY_TOKEN_MUST_NOT_BE_RETURNED',
      },
    });
    const prisma = new PrismaRepository(db as any) as any;
    repo = new PostsRepository(
      prisma,
      prisma,
      prisma,
      prisma,
      prisma,
      prisma,
      new PrismaTransaction(db as any)
    );
    connection = await Connection.connect({
      address: process.env.TEMPORAL_TEST_ADDRESS,
    });
    client = new Client({ connection });
    const temporal: any = {
      client: {
        getRawClient: () => client,
        getWorkflowHandle: async (id: string) => client.workflow.getHandle(id),
      },
    };
    const media: any = {
      getPostMediaMetadata: async () => ({
        width: 1080,
        height: 1350,
        content_type: 'image/png',
      }),
      assertReadyForPosts: async (): Promise<any[]> => [],
    };
    posts = new PostsService(
      repo,
      {
        getSocialIntegration: () => ({
          dto: null as any,
          checkValidity: async () => true,
          maxLength: () => 2200,
        }),
      } as any,
      {
        getIntegrationById: async (o: string, id: string) =>
          db.integration.findFirst({ where: { id, organizationId: o } }),
      } as any,
      media,
      null,
      null,
      temporal,
      null,
      {} as any,
      null,
      {} as any,
      {} as any
    );
    management = new PostManagementService(
      repo,
      posts,
      media,
      temporal,
      new SocialCommentsService(
        new SocialCommentsRepository(prisma, prisma, prisma),
        null,
        null,
        null
      )
    );
    const module = await Test.createTestingModule({
      controllers: [PublicPostsController],
      providers: [{ provide: PostManagementService, useValue: management }],
    }).compile();
    app = module.createNestApplication({ logger: false });
    app.use((req: any, res: any, next: any) => {
      const key = req.headers.authorization;
      if (!['Bearer profile-one', 'Bearer profile-other'].includes(key))
        return res.status(401).end();
      req.org = org;
      req.publicApiProfileId =
        key === 'Bearer profile-one' ? profile.id : other.id;
      next();
    });
    await app.listen(0, '127.0.0.1');
    base = await app.getUrl();
  }, 30000);
  afterAll(async () => {
    await app?.close();
    await db?.$disconnect();
    await connection?.close();
  });
  it('applies only formatting through HTTP; all other persisted fields and comments stay identical', async () => {
    const root = await create();
    const child = await db.post.create({
      data: {
        organizationId: org.id,
        profileId: profile.id,
        integrationId: integration.id,
        group: root.group,
        parentPostId: root.id,
        state: 'DRAFT',
        publishDate: root.publishDate,
        content: '<p>Comment in sequence</p>',
        image: '[]',
        settings: root.settings,
      },
    });
    const comment = await db.comments.create({
      data: {
        organizationId: org.id,
        postId: root.id,
        content: 'Internal review',
        guestEmail: 'PRIVATE_FIXTURE@example.test',
        guestIp: '127.0.0.1',
      },
    });
    const networkComment = await db.socialComments.create({
      data: {
        organizationId: org.id,
        integrationId: integration.id,
        postId: root.id,
        providerCommentId: crypto.randomUUID(),
        content: 'Comentário da rede',
        publishedAt: new Date(),
        authorName: 'Test author',
      },
    });
    const before = await db.post.findUnique({ where: { id: root.id } });
    const preview = await request(root.id, 'PATCH', {
      version: version(root),
      normalizeSpacing: true,
      dryRun: true,
    });
    expect(preview.status).toBe(200);
    expect(preview.body.preview.contentText).toBe(
      'Um\n\nDois\n\n📅 Dia 10\n📍 Local'
    );
    const apply = await request(root.id, 'PATCH', {
      version: version(root),
      normalizeSpacing: true,
      previewHash: preview.body.previewHash,
    });
    expect(apply.status).toBe(200);
    const read = await request(root.id);
    expect(read.status).toBe(200);
    expect(read.body.contentText).toEqual(preview.body.preview.contentText);
    expect(JSON.stringify(read.body)).not.toMatch(
      /DUMMY_|PRIVATE_FIXTURE|guestIp/
    );
    const after = await db.post.findUnique({ where: { id: root.id } });
    const { content: bc, updatedAt: bu, ...preservedBefore } = before;
    const { content: ac, updatedAt: au, ...preservedAfter } = after;
    expect(preservedAfter).toEqual(preservedBefore);
    expect(ac.replace(/<p><\/p>/g, '')).toBe(bc);
    expect(au.getTime()).toBeGreaterThan(bu.getTime());
    expect(await db.post.findUnique({ where: { id: child.id } })).toEqual(
      child
    );
    expect(await db.comments.findUnique({ where: { id: comment.id } })).toEqual(
      comment
    );
    expect(read.body.networkComments.count).toBe(1);
    expect(read.body.networkComments.comments[0].content).toBe(
      'Comentário da rede'
    );
    expect(
      await db.socialComments.findUnique({ where: { id: networkComment.id } })
    ).toEqual(networkComment);
    expect(read.body.state).toBe('DRAFT');
    expect(read.body.queueActive).toBe(false);
  });
  it('returns 404 for another profile and rejects simultaneous stale writers atomically', async () => {
    const root = await create();
    expect(
      (await request(root.id, 'GET', undefined, 'profile-other')).status
    ).toBe(404);
    const results = await Promise.all([
      request(root.id, 'PATCH', { version: version(root), content: 'First' }),
      request(root.id, 'PATCH', { version: version(root), content: 'Second' }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await db.post.count({ where: { id: root.id } })).toBe(1);
  });
  it('replays successful bulk items after partial failure without touching their version again', async () => {
    const root = await create();
    const published = await create('PUBLISHED');
    const input = {
      idempotencyKey: 'x'.repeat(200),
      dryRun: false,
      updates: [
        {
          id: root.id,
          changes: { version: version(root), content: 'Changed' },
        },
        {
          id: published.id,
          changes: { version: version(published), content: 'Forbidden' },
        },
      ],
    };
    const first = await request('bulk-update', 'POST', input);
    expect(first.status).toBe(201);
    expect(first.body.results.map((r: any) => r.status)).toEqual([
      'updated',
      'failed',
    ]);
    const after = await db.post.findUnique({ where: { id: root.id } });
    const replay = await request('bulk-update', 'POST', input);
    expect(replay.body).toEqual(first.body);
    expect(await db.post.findUnique({ where: { id: root.id } })).toEqual(after);
    expect(
      (await db.post.findUnique({ where: { id: published.id } })).content
    ).toBe(published.content);
  });
  it('serializes competing queue changes and retains an ambiguous lock for reconciliation', async () => {
    const root = await create();
    const claimed = await repo.reservePostOperation(
      `queue:${root.id}`,
      org.id,
      profile.id,
      'another-owner'
    );
    expect(claimed.claimed).toBe(true);
    const change = await request(root.id + '/status', 'PUT', {
      version: version(root),
      status: 'schedule',
    });
    expect(change.status).toBe(409);
    expect(change.body.code).toBe('POST_QUEUE_LOCKED');
    expect((await db.post.findUnique({ where: { id: root.id } })).state).toBe(
      'DRAFT'
    );
    await repo.releasePostQueueLock(root.id, 'another-owner');
  });
  it('updates the date without scheduling a draft or changing any other field', async () => {
    const root = await create();
    const before = await db.post.findUnique({ where: { id: root.id } });
    const date = new Date(Date.now() + 172800000).toISOString();
    const result = await request(root.id + '/date', 'PUT', {
      version: version(root),
      date,
      timeZone: 'America/Sao_Paulo',
      action: 'update',
    });
    expect(result.status).toBe(200);
    expect(result.body.post.state).toBe('DRAFT');
    expect(result.body.post.queueActive).toBe(false);
    const after = await db.post.findUnique({ where: { id: root.id } });
    const { publishDate: bd, updatedAt: bu, ...b } = before;
    const { publishDate: ad, updatedAt: au, ...a } = after;
    expect(a).toEqual(b);
    expect(ad.toISOString()).toBe(date);
  });
  it('activates only on explicit schedule and returns the requested time zone', async () => {
    const root = await create();
    const result = await request(root.id + '/date', 'PUT', {
      version: version(root),
      date: new Date(Date.now() + 172800000).toISOString(),
      timeZone: 'America/Sao_Paulo',
      action: 'schedule',
    });
    expect(result.status).toBe(200);
    expect(result.body.post.state).toBe('QUEUE');
    expect(result.body.post.queueActive).toBe(true);
    expect(result.body.post.timeZone).toBe('America/Sao_Paulo');
    const cancelled = await request(root.id + '/status', 'PUT', {
      version: result.body.post.version,
      status: 'draft',
    });
    expect(cancelled.status).toBe(200);
  }, 30000);
  it('resolves prepared media by its original path without losing profile isolation', async () => {
    const prisma = new PrismaRepository(db as any) as any;
    const mediaRepo = new MediaRepository(prisma, prisma);
    const own = await db.media.create({
      data: {
        organizationId: org.id,
        profileId: profile.id,
        name: 'prepared.mp4',
        path: 'https://uploads.test/prepared.mp4',
        originalPath: 'https://uploads.test/original.mov',
        status: 'ready',
      },
    });
    const foreign = await db.media.create({
      data: {
        organizationId: org.id,
        profileId: other.id,
        name: 'private.mp4',
        path: 'https://uploads.test/private.mp4',
        status: 'ready',
      },
    });
    expect(
      await mediaRepo.findPostMedia(
        org.id,
        { id: foreign.id, path: own.originalPath },
        profile.id
      )
    ).toMatchObject({ id: own.id, path: own.path });
    expect(
      await mediaRepo.findPostMedia(org.id, { id: foreign.id }, profile.id)
    ).toBeNull();
    expect(
      await mediaRepo.findPostMedia(org.id, { path: foreign.path }, profile.id)
    ).toBeNull();
  });
  it('rejects a queued date write atomically after its cancellation deadline', async () => {
    const root = await create('QUEUE');
    await db.post.update({
      where: { id: root.id },
      data: { publishDate: new Date(Date.now() + 1000) },
    });
    const current = await db.post.findUnique({ where: { id: root.id } });
    await expect(
      repo.changeDate(
        org.id,
        root.id,
        new Date(Date.now() + 86400000).toISOString(),
        false,
        'update',
        profile.id,
        version(current)
      )
    ).rejects.toMatchObject({ status: 409 });
    expect(
      (await db.post.findUnique({ where: { id: root.id } })).publishDate
    ).toEqual(current.publishDate);
  });
  it('activates a real pending workflow, then draft cancels it and a new read confirms no running execution', async () => {
    const root = await create();
    const schedule = await request(root.id + '/status', 'PUT', {
      version: version(root),
      status: 'schedule',
    });
    expect(schedule.status).toBe(200);
    expect(schedule.body.post.queueActive).toBe(true);
    const handle = client.workflow.getHandle('post_' + root.id);
    expect((await handle.describe()).status.name).toBe('RUNNING');
    const draft = await request(root.id + '/status', 'PUT', {
      version: schedule.body.post.version,
      status: 'draft',
    });
    expect(draft.status).toBe(200);
    expect(draft.body.post.state).toBe('DRAFT');
    expect(draft.body.post.queueActive).toBe(false);
    expect((await handle.describe()).status.name).toBe('TERMINATED');
    const read = await request(root.id + '/status');
    expect(read.body.executionState).toBe('DRAFT_SAVED');
  }, 30000);
});
