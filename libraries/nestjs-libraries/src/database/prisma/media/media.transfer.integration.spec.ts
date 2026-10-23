/**
 * Opt-in acceptance: real PostgreSQL, Redis, storage, Nest multipart and MCP wire.
 * Run from the repository root with Node 22; no production .env is loaded.
 * Create ONLY these isolated containers (no existing volume is mounted):
 *
 * docker run -d --name postiz-media-transfer-test-pg -p 127.0.0.1:65432:5432 \
 *   -e POSTGRES_USER=postiz_test -e POSTGRES_PASSWORD=isolated_test_only \
 *   -e POSTGRES_DB=mcp_tests postgres:16-alpine
 * docker run -d --name postiz-media-transfer-test-redis -p 127.0.0.1:16352:6379 redis:7-alpine
 * export DATABASE_URL=postgresql://postiz_test:isolated_test_only@127.0.0.1:65432/mcp_tests
 * export REDIS_URL=redis://127.0.0.1:16352
 * pnpm exec prisma db push --schema libraries/nestjs-libraries/src/database/prisma/schema.prisma --skip-generate
 * RUN_MEDIA_TRANSFER_INTEGRATION=1 pnpm exec jest --config libraries/nestjs-libraries/jest.config.ts \
 *   --runInBand --runTestsByPath libraries/nestjs-libraries/src/database/prisma/media/media.transfer.integration.spec.ts
 *
 * Ports/database are checked before fixtures are created. Test rows and the unique
 * temporary storage directory are removed in afterAll. Redis tickets expire in
 * ten minutes; remove the dedicated containers after the final verification:
 * docker rm -fv postiz-media-transfer-test-pg postiz-media-transfer-test-redis
 *
 * Temporal is intentionally absent: drafts use the existing PostsService and
 * a workflow-start tripwire; no publishing worker or real social credentials exist.
 * Sanitized evidence is written to /tmp/postiz-media-transfer-acceptance.json.
 */
// Node 22 loads this real ESM package natively; Jest's CommonJS loader cannot.
jest.mock('file-type', () =>
  (process as any).getBuiltinModule('module').createRequire(__filename)(
    'file-type'
  )
);
// Unused AI/provider dependency graphs are excluded; the entire transfer path is real.
jest.mock('@gitroom/nestjs-libraries/ai/ai-image.service', () => ({
  AiImageService: class {},
}));
jest.mock('@gitroom/nestjs-libraries/ai/ai-text.service', () => ({
  AiTextService: class {},
}));
jest.mock('@gitroom/nestjs-libraries/ai/ai-video.service', () => ({
  AiVideoService: class {},
}));
jest.mock('@gitroom/nestjs-libraries/openai/openai.service', () => ({
  OpenaiService: class {},
}));
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service',
  () => ({ SubscriptionService: class {} })
);
jest.mock('@gitroom/nestjs-libraries/videos/video.manager', () => ({
  VideoManager: class {},
}));
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service',
  () => ({ IntegrationService: class {} })
);
jest.mock('@gitroom/nestjs-libraries/integrations/integration.manager', () => ({
  IntegrationManager: class {},
}));
jest.mock(
  '@gitroom/nestjs-libraries/integrations/refresh.integration.service',
  () => ({ RefreshIntegrationService: class {} })
);
jest.mock('@gitroom/nestjs-libraries/short-linking/short.link.service', () => ({
  ShortLinkService: class {},
}));

import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { randomBytes, randomUUID, createHash } from 'crypto';
import { spawn } from 'child_process';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { mkdtemp, readFile, writeFile, rm, readdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import sharp from 'sharp';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';
import { LocalStorage } from '@gitroom/nestjs-libraries/upload/local.storage';
import { MediaTransferController } from '@gitroom/backend/api/routes/media.transfer.controller';
import { MediaTransferInterceptor } from '@gitroom/nestjs-libraries/upload/media.transfer.interceptor';
import {
  UploadMediaTool,
  PrepareMediaUploadTool,
  CompleteMediaUploadTool,
} from '@gitroom/nestjs-libraries/chat/tools/media.transfer.tools';
import { PrismaRepository, PrismaTransaction } from '../prisma.service';
import { MediaRepository } from './media.repository';
import { MediaService } from './media.service';
import { MediaTransferRepository } from './media.transfer.repository';
import { MediaTransferService } from './media.transfer.service';
import { PostsRepository } from '../posts/posts.repository';
import { PostsService } from '../posts/posts.service';
import { PostManagementService } from '../posts/post.management.service';
import { SocialCommentsService } from '../social-comments/social.comments.service';
import { SocialCommentsRepository } from '../social-comments/social.comments.repository';
import { IntegrationSchedulePostTool } from '@gitroom/nestjs-libraries/chat/tools/integration.schedule.post';
import { GetPostTool } from '@gitroom/nestjs-libraries/chat/tools/post.management.tools';
import { postContentToHtml } from '@gitroom/helpers/utils/sanitize.post.content';
import { InstagramProvider } from '@gitroom/nestjs-libraries/integrations/social/instagram.provider';

const projectRoot = join(__dirname, '../../../../../..');
const suite =
  process.env.RUN_MEDIA_TRANSFER_INTEGRATION === '1' ? describe : describe.skip;
const digest = (bytes: Buffer) =>
  createHash('sha256').update(bytes).digest('hex');
const storedFiles = async (directory: string): Promise<string[]> => {
  const entries = await readdir(directory, { withFileTypes: true });
  const lists = await Promise.all(
    entries.map((entry) =>
      entry.isDirectory()
        ? storedFiles(join(directory, entry.name))
        : Promise.resolve([join(directory, entry.name)])
    )
  );
  return lists.flat().sort();
};

// A separate Node process reads client-side paths and transfers real multipart
// bytes over HTTP. Ticket credentials travel only through its stdin, not argv/logs.
const clientScript = String.raw`
const { readFile } = require('fs/promises');
(async () => {
 let stdin=''; for await(const chunk of process.stdin) stdin+=chunk;
 const requests=JSON.parse(stdin); const results=[];
 for(const item of requests) {
   const bytes=await readFile(item.source);
   const form=new FormData();
   form.append('file',new Blob([bytes],{type:item.mimeType}),item.filename);
   const response=await fetch(item.uploadUrl,{
     method:'POST',headers:item.uploadHeaders,body:form,
     signal:AbortSignal.timeout(30000)
   });
   results.push({status:response.status,body:await response.json()});
 }
 process.stdout.write(JSON.stringify(results));
})().catch(() => { process.stderr.write('Upload client failed'); process.exitCode=1; });
`;
const transferFromClient = (requests: unknown[]) =>
  new Promise<any[]>((resolve, reject) => {
    const child = spawn(process.execPath, ['-e', clientScript], {
      env: { PATH: process.env.PATH },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let output = '';
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error('Upload client timed out'));
    }, 60000);
    child.stdout.on('data', (chunk) => {
      output += chunk.toString();
    });
    child.stderr.resume();
    child.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on('exit', (code) => {
      clearTimeout(timeout);
      if (code !== 0) return reject(new Error('Upload client failed'));
      try {
        resolve(JSON.parse(output));
      } catch {
        reject(new Error('Invalid upload client response'));
      }
    });
    child.stdin.end(JSON.stringify(requests));
  });

suite('MCP media transfer with real HTTP, PostgreSQL and storage', () => {
  let db: PrismaClient,
    app: INestApplication,
    directory: string,
    storage: LocalStorage;
  let org: { id: string },
    otherOrg: { id: string },
    profile: { id: string },
    otherProfile: { id: string };
  let media: MediaService,
    transfers: MediaTransferService,
    postRepository: PostsRepository,
    posts: PostsService;
  let prepareTool: any,
    uploadTool: any,
    completeTool: any,
    scheduleTool: any,
    getPostTool: any;
  let draftInput: any;
  const caption = 'Transfer acceptance.\n\nDraft only.';
  const toolCalls: string[] = [];
  let base: string;
  const clientToken = randomUUID();
  const carouselKey = `carousel-${randomUUID()}`;
  let multipartRequests = 0;
  const workflowStart = jest.fn(() => {
    throw new Error('Publication is forbidden in this test');
  });
  const files: Array<{
    filename: string;
    source: string;
    bytes: Buffer;
    manifest: any;
  }> = [];
  const previousEnvironment = new Map<string, string | undefined>();
  const setEnvironment = (key: string, value: string) => {
    if (!previousEnvironment.has(key))
      previousEnvironment.set(key, process.env[key]);
    process.env[key] = value;
  };
  const context = (profileId = profile.id, organizationId = org.id) => ({
    requestContext: new Map([
      ['organization', JSON.stringify({ id: organizationId })],
      ['profileId', profileId],
    ]),
  });
  const invoke = (tool: any, input: unknown, scope = context()) =>
    tool.execute(tool.inputSchema.parse(input), scope);

  const runClient = async (
    mode: 'session' | 'base64',
    selected = files,
    key = carouselKey,
    withDraft = false
  ) => {
    const manifestPath = join(directory, `client-${mode}-${randomUUID()}.json`);
    await writeFile(
      manifestPath,
      JSON.stringify({
        mode,
        idempotencyKey: key,
        ...(withDraft ? { draft: draftInput } : {}),
        files: selected.map((file) => ({
          path: file.source,
          mimeType: 'image/png',
          filename: file.filename,
        })),
      })
    );
    return new Promise<any>((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [join(projectRoot, 'scripts/mcp-media-upload.mjs'), manifestPath],
        {
          cwd: projectRoot,
          env: {
            PATH: process.env.PATH,
            MALI_POSTS_MCP_URL: base + '/mcp',
            MALI_POSTS_ACCESS_TOKEN: clientToken,
          },
          stdio: ['ignore', 'pipe', 'pipe'],
        }
      );
      let output = '';
      const timeout = setTimeout(() => {
        child.kill();
        reject(new Error('MCP client timed out'));
      }, 90000);
      child.stdout.on('data', (chunk) => {
        output += chunk.toString();
      });
      child.stderr.resume();
      child.on('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      child.on('exit', (code) => {
        clearTimeout(timeout);
        if (code !== 0)
          return reject(new Error('MCP file-transfer client failed'));
        try {
          resolve(JSON.parse(output.slice(output.indexOf('{\n'))));
        } catch {
          reject(new Error('MCP client did not return a media receipt'));
        }
      });
    });
  };

  beforeAll(async () => {
    const database = new URL(process.env.DATABASE_URL || 'http://invalid');
    if (
      database.hostname !== '127.0.0.1' ||
      database.port !== '65432' ||
      database.pathname !== '/mcp_tests'
    )
      throw new Error(
        'Requires isolated PostgreSQL at 127.0.0.1:65432/mcp_tests'
      );
    if (process.env.REDIS_URL !== 'redis://127.0.0.1:16352')
      throw new Error('Requires isolated Redis at 127.0.0.1:16352');
    directory = await mkdtemp(join(tmpdir(), 'postiz-transfer-integration-'));
    setEnvironment('STORAGE_PROVIDER', 'local');
    setEnvironment('UPLOAD_DIRECTORY', join(directory, 'storage'));
    setEnvironment('NEXT_PUBLIC_OVERRIDE_BACKEND_URL', '');
    setEnvironment('RESTRICT_UPLOAD_DOMAINS', '127.0.0.1');
    db = new PrismaClient({
      datasources: { db: { url: process.env.DATABASE_URL } },
    });
    await db.$connect();
    await ioRedis.ping();
    org = await db.organization.create({
      data: { name: 'Isolated transfer acceptance' },
    });
    otherOrg = await db.organization.create({
      data: { name: 'Isolated foreign organization' },
    });
    profile = await db.profile.create({
      data: {
        organizationId: org.id,
        name: 'Selected profile',
        slug: 'selected',
      },
    });
    otherProfile = await db.profile.create({
      data: { organizationId: org.id, name: 'Other profile', slug: 'other' },
    });
    const prisma = new PrismaRepository(db as any) as any;
    const transaction = new PrismaTransaction(db as any);
    const temporal: any = {
      client: {
        getRawClient: () => ({
          workflow: {
            start: workflowStart,
            getHandle: () => ({
              describe: async () => {
                throw Object.assign(new Error('No isolated workflow'), {
                  name: 'WorkflowNotFoundError',
                });
              },
            }),
            list: async function* () {
              /* No publication workers exist. */
            },
          },
        }),
      },
    };
    media = new MediaService(
      new MediaRepository(prisma, prisma),
      null,
      null,
      null,
      null,
      null,
      null,
      temporal
    );
    transfers = new MediaTransferService(
      new MediaTransferRepository(transaction),
      media
    );
    storage = new LocalStorage(process.env.UPLOAD_DIRECTORY);
    postRepository = new PostsRepository(
      prisma,
      prisma,
      prisma,
      prisma,
      prisma,
      prisma,
      transaction
    );
    const provider = new InstagramProvider();
    const integrations = {
      getIntegrationById: (organizationId: string, id: string) =>
        db.integration.findFirst({ where: { id, organizationId } }),
    };
    posts = new PostsService(
      postRepository,
      { getSocialIntegration: () => provider } as any,
      integrations as any,
      media,
      null,
      null,
      temporal,
      null,
      null,
      null,
      null,
      null
    );
    const management = new PostManagementService(
      postRepository,
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
    scheduleTool = new IntegrationSchedulePostTool(
      posts,
      integrations as any
    ).run();
    getPostTool = new GetPostTool(management).run();
    const channel = await db.integration.create({
      data: {
        internalId: randomUUID(),
        organizationId: org.id,
        profileId: profile.id,
        name: 'Isolated Instagram',
        providerIdentifier: 'instagram',
        type: 'social',
        token: 'TEST_ONLY_NOT_REAL',
      },
    });
    await writeFile(join(directory, 'caption.txt'), caption);
    draftInput = {
      integrationId: channel.id,
      captionFile: 'caption.txt',
      date: new Date(Date.now() + 86400000).toISOString(),
      collaborators: ['test_partner'],
    };
    const module = await Test.createTestingModule({
      controllers: [MediaTransferController],
      providers: [
        MediaTransferInterceptor,
        { provide: MediaTransferService, useValue: transfers },
      ],
    }).compile();
    app = module.createNestApplication({ logger: false, bodyParser: false });
    // Real SDK Streamable HTTP transport: the separate CLI must initialize,
    // discover the actual schemas and invoke the production MCP wrappers.
    app.use('/mcp', async (request: any, response: any) => {
      if (request.headers.authorization !== `Bearer ${clientToken}`)
        return response.status(401).end();
      const server = new McpServer({
        name: 'isolated-media-transfer-test',
        version: '1.0.0',
      });
      for (const [name, tool] of [
        ['uploadMediaTool', uploadTool],
        ['prepareMediaUpload', prepareTool],
        ['completeMediaUpload', completeTool],
        ['integrationSchedulePostTool', scheduleTool],
        ['getPostTool', getPostTool],
      ] as const) {
        server.registerTool(
          name,
          {
            description: tool.description,
            inputSchema: tool.inputSchema,
            outputSchema: tool.outputSchema,
            annotations: tool.mcp.annotations,
          },
          async (input: any) => {
            toolCalls.push(name);
            const result = await invoke(tool, input);
            return {
              content: [
                { type: 'text' as const, text: JSON.stringify(result) },
              ],
              structuredContent: result,
            };
          }
        );
      }
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      response.on('close', () => {
        void server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(request, response);
    });
    app.use('/media-transfer', (request: any, _response: any, next: any) => {
      if (request.method === 'POST') multipartRequests++;
      next();
    });
    await app.listen(0, '127.0.0.1');
    base = await app.getUrl();
    setEnvironment('NEXT_PUBLIC_BACKEND_URL', base);
    setEnvironment('FRONTEND_URL', base);
    prepareTool = new PrepareMediaUploadTool(transfers).run();
    uploadTool = new UploadMediaTool(transfers).run();
    completeTool = new CompleteMediaUploadTool(transfers).run();
    for (let index = 0; index < 7; index++) {
      const filename = `${String(index + 1).padStart(2, '0')}-Carousel-${
        index + 1
      }.png`;
      const bytes = await sharp(randomBytes(800 * 800 * 3), {
        raw: { width: 800, height: 800, channels: 3 },
      })
        .png({ compressionLevel: 0 })
        .toBuffer();
      expect(bytes.length).toBeGreaterThanOrEqual(1.5 * 1024 * 1024);
      expect(bytes.length).toBeLessThanOrEqual(2 * 1024 * 1024);
      const source = join(directory, filename);
      await writeFile(source, bytes);
      files.push({
        filename,
        source,
        bytes,
        manifest: {
          filename,
          mimeType: 'image/png',
          sizeBytes: bytes.length,
          sha256: digest(bytes),
          idempotencyKey: `file-${digest(
            Buffer.from(JSON.stringify([carouselKey, index]))
          )}`,
        },
      });
    }
  }, 45000);

  afterAll(async () => {
    await app?.close();
    if (db && org) {
      await db.post.deleteMany({ where: { organizationId: org.id } });
      await db.postOperation.deleteMany({ where: { organizationId: org.id } });
      await db.media.deleteMany({ where: { organizationId: org.id } });
      await db.integration.deleteMany({ where: { organizationId: org.id } });
      await db.profile.deleteMany({ where: { organizationId: org.id } });
      await db.organization.deleteMany({
        where: { id: { in: [org.id, otherOrg?.id].filter(Boolean) } },
      });
    }
    await db?.$disconnect();
    if (
      ioRedis.status !== 'end' &&
      process.env.REDIS_URL === 'redis://127.0.0.1:16352'
    )
      await ioRedis.quit();
    if (directory) await rm(directory, { recursive: true, force: true });
    for (const [key, value] of previousEnvironment) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }, 30000);

  it('transfers seven real PNGs, replays without duplicates, preserves hashes/names/order and saves only a collab draft', async () => {
    const prepared: any[] = [];
    for (const file of files) {
      const ticket = await invoke(prepareTool, file.manifest);
      expect(ticket).toMatchObject({
        status: 'awaiting_upload',
        progress: 0,
        method: 'POST',
      });
      expect(new URL(ticket.uploadUrl).search).toBe('');
      prepared.push(ticket);
    }
    const requests = files.map((file, i) => ({
      source: file.source,
      filename: file.filename,
      mimeType: file.manifest.mimeType,
      uploadUrl: prepared[i].uploadUrl,
      uploadHeaders: prepared[i].uploadHeaders,
    }));
    const clientResult = await runClient('session', files, carouselKey, true);
    expect(clientResult.media).toHaveLength(7);
    expect(multipartRequests).toBe(7);
    const results: any[] = [];
    for (const [index, response] of clientResult.media.entries()) {
      expect(response).toMatchObject({
        status: 'ready',
        uploadId: prepared[index].uploadId,
        filename: files[index].filename,
      });
      const confirmed = await invoke(completeTool, {
        uploadId: prepared[index].uploadId,
      });
      expect(confirmed).toMatchObject({
        id: response.id,
        path: response.path,
        status: 'ready',
      });
      const record = await db.media.findUnique({ where: { id: confirmed.id } });
      expect(record).toMatchObject({
        originalName: files[index].filename,
        fileSize: files[index].bytes.length,
        organizationId: org.id,
        profileId: profile.id,
        status: 'ready',
        originalPath: confirmed.path,
      });
      const storedPath = storage.localFilePath(confirmed.path);
      expect(storedPath).not.toBeNull();
      expect(digest(await readFile(storedPath))).toBe(
        files[index].manifest.sha256
      );
      expect(
        await media.getPostMediaMetadata(org.id, confirmed, profile.id)
      ).toMatchObject({ width: 800, height: 800, content_type: 'image/png' });
      results.push(confirmed);
    }
    expect(new Set(results.map((result) => result.id)).size).toBe(7);
    expect(await db.media.count({ where: { organizationId: org.id } })).toBe(7);
    const storageBeforeReplay = await storedFiles(process.env.UPLOAD_DIRECTORY);
    const replayClient = await runClient('session', files, carouselKey, true);
    expect(replayClient.media).toEqual(clientResult.media);
    expect(replayClient.draft).toEqual(clientResult.draft);
    expect(multipartRequests).toBe(7);
    const replay = await transferFromClient([requests[0]]);
    expect(replay[0].body).toEqual(results[0]);
    expect(await invoke(prepareTool, files[0].manifest)).toEqual(results[0]);
    expect(
      await invoke(uploadTool, {
        filename: files[0].filename,
        mimeType: 'image/png',
        base64: files[0].bytes.toString('base64'),
        idempotencyKey: files[0].manifest.idempotencyKey,
      })
    ).toEqual(results[0]);
    expect(await db.media.count({ where: { organizationId: org.id } })).toBe(7);
    expect(await storedFiles(process.env.UPLOAD_DIRECTORY)).toEqual(
      storageBeforeReplay
    );
    const conflict = await invoke(prepareTool, {
      ...files[0].manifest,
      sha256: '0'.repeat(64),
    });
    expect(conflict.error.code).toBe('UPLOAD_IDEMPOTENCY_CONFLICT');
    for (const scope of [
      context(otherProfile.id),
      context(profile.id, otherOrg.id),
    ]) {
      expect(
        (await invoke(completeTool, { uploadId: results[0].uploadId }, scope))
          .error.code
      ).toBe('UPLOAD_NOT_FOUND');
    }
    const [draft] = await postRepository.getManagedPost(
      org.id,
      profile.id,
      clientResult.draft.postId
    );
    expect(draft).toMatchObject({
      state: 'DRAFT',
      content: postContentToHtml(caption),
      integrationId: draftInput.integrationId,
      profileId: profile.id,
      releaseId: null,
      releaseURL: null,
      error: null,
    });
    expect(draft.publishDate.toISOString()).toBe(draftInput.date);
    expect(JSON.parse(draft.image).map((image: any) => image.path)).toEqual(
      results.map((result) => result.path)
    );
    expect(JSON.parse(draft.settings)).toEqual({
      __type: 'instagram',
      post_type: 'post',
      collaborators: [{ label: '@test_partner' }],
    });
    expect(clientResult.draft).toMatchObject({
      state: 'DRAFT',
      queueActive: false,
      mediaCount: 7,
    });
    expect(await db.post.count({ where: { organizationId: org.id } })).toBe(1);
    expect(
      toolCalls.filter((name) => name === 'integrationSchedulePostTool')
    ).toHaveLength(2);
    expect(toolCalls.filter((name) => name === 'getPostTool')).toHaveLength(2);
    expect(
      await db.post.count({
        where: { organizationId: org.id, state: { not: 'DRAFT' } },
      })
    ).toBe(0);
    expect(workflowStart).not.toHaveBeenCalled();
    await writeFile(
      join(tmpdir(), 'postiz-media-transfer-acceptance.json'),
      JSON.stringify(
        {
          transport: 'MCP Streamable HTTP + multipart from separate Node CLI',
          persistedMediaCount: 7,
          persistedPostCount: 1,
          draftCreatedViaMcp: true,
          draftCreationReplayStable: true,
          state: draft.state,
          workflowStarts: workflowStart.mock.calls.length,
          files: files.map((file, index) => ({
            name: file.filename,
            sizeBytes: file.bytes.length,
            sha256: file.manifest.sha256,
            mediaId: results[index].id,
            hashVerified: true,
            order: index + 1,
          })),
          replayStable: true,
          profileIsolation: true,
          collabPreserved: true,
        },
        null,
        2
      )
    );
  }, 90000);

  it('rejects oversized JSON bytes and invalid names over the actual MCP transport before storage', async () => {
    const before = await db.media.count({ where: { organizationId: org.id } });
    for (const input of [
      { filename: 'too-large.png', base64: 'A'.repeat(6 * 1024 * 1024 + 4) },
      { filename: '../outside.png', base64: files[0].bytes.toString('base64') },
    ]) {
      const response = await fetch(base + '/mcp', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${clientToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          'MCP-Protocol-Version': '2025-03-26',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: randomUUID(),
          method: 'tools/call',
          params: {
            name: 'uploadMediaTool',
            arguments: {
              ...input,
              mimeType: 'image/png',
              idempotencyKey: `invalid-${randomUUID()}`,
            },
          },
        }),
      });
      const payload = (await response.json()) as any;
      expect(response.status).toBe(200);
      expect(payload.result?.isError || !!payload.error).toBe(true);
    }
    expect(await db.media.count({ where: { organizationId: org.id } })).toBe(
      before
    );
    expect(workflowStart).not.toHaveBeenCalled();
  }, 30000);

  it('creates and replays a real base64 upload, while integrity failure leaves no usable media', async () => {
    const file = files[1];
    const key = `base64-${randomUUID()}`;
    const clientResult = await runClient('base64', [file], key);
    const result = clientResult.media[0];
    expect(result).toMatchObject({ status: 'ready' });
    expect(digest(await readFile(storage.localFilePath(result.path)))).toBe(
      file.manifest.sha256
    );
    expect((await runClient('base64', [file], key)).media).toEqual(
      clientResult.media
    );
    const count = await db.media.count({ where: { organizationId: org.id } });
    const invalid = await invoke(prepareTool, {
      ...file.manifest,
      sha256: 'f'.repeat(64),
      idempotencyKey: `bad-hash-${randomUUID()}`,
    });
    const [failed] = await transferFromClient([
      {
        source: file.source,
        filename: file.filename,
        mimeType: 'image/png',
        uploadUrl: invalid.uploadUrl,
        uploadHeaders: invalid.uploadHeaders,
      },
    ]);
    expect(failed.body.status).toBe('failed');
    expect(failed.body.id).toBeUndefined();
    expect(
      (await invoke(completeTool, { uploadId: invalid.uploadId })).status
    ).toBe('failed');
    expect(await db.media.count({ where: { organizationId: org.id } })).toBe(
      count
    );
    expect(workflowStart).not.toHaveBeenCalled();
  }, 60000);
});
