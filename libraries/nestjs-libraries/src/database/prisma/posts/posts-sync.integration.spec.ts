import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PostsRepository } from './posts.repository';
import { PostsSyncRepository } from './posts-sync.repository';
import { AnalyticsReportRepository } from '../analytics/analytics.report.repository';
import { SocialCommentsRepository } from '../social-comments/social.comments.repository';

const databaseUrl = process.env.POSTIZ_SYNC_TEST_DATABASE_URL;
if (
  databaseUrl &&
  (!['127.0.0.1', 'localhost'].includes(new URL(databaseUrl).hostname) ||
    !new URL(databaseUrl).pathname.endsWith('_test'))
) {
  throw new Error('Use a disposable local database ending in _test');
}

(databaseUrl ? describe : describe.skip)(
  'platform imports against PostgreSQL',
  () => {
    const db = new PrismaClient({
      datasources: {
        db: { url: databaseUrl || 'postgresql://localhost/unused_test' },
      },
    });
    const repository = new PostsRepository(
      ...([
        ...Array(6).fill({ model: db } as any),
        { model: db } as any,
      ] as unknown as ConstructorParameters<typeof PostsRepository>)
    );
    const sync = new PostsSyncRepository({ model: db } as any);
    const org = randomUUID();
    const otherOrg = randomUUID();
    let channel: string;
    let otherChannel: string;
    const item = (id: string) => ({
      id,
      content: 'A caption <not HTML>',
      publishedAt: '2026-10-16T21:00:00Z',
      url: `https://www.instagram.com/p/${id}/`,
      media: [{ id, path: 'https://example.com/photo.jpg' }],
    });

    beforeAll(async () => {
      await db.organization.createMany({
        data: [
          { id: org, name: 'Sync test' },
          { id: otherOrg, name: 'Other tenant' },
        ],
      });
      const first = await db.integration.create({
        data: {
          organizationId: org,
          internalId: 'ig-1',
          name: 'IG',
          providerIdentifier: 'instagram',
          type: 'social',
          token: 'fake',
        },
      });
      const second = await db.integration.create({
        data: {
          organizationId: otherOrg,
          internalId: 'ig-1',
          name: 'Other IG',
          providerIdentifier: 'instagram',
          type: 'social',
          token: 'fake',
        },
      });
      channel = first.id;
      otherChannel = second.id;
    });
    afterAll(async () => {
      await db.post.deleteMany({
        where: { organizationId: { in: [org, otherOrg] } },
      });
      await db.integration.deleteMany({
        where: { organizationId: { in: [org, otherOrg] } },
      });
      await db.organization.deleteMany({
        where: { id: { in: [org, otherOrg] } },
      });
      await db.$disconnect();
    });

    it('does not duplicate concurrent imports and preserves dates and safe text', async () => {
      await Promise.all(
        Array.from({ length: 4 }, () =>
          repository.importPlatformPost(org, channel, item('concurrent'))
        )
      );
      const rows = await db.post.findMany({
        where: { integrationId: channel, externalId: 'concurrent' },
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        importedFromPlatform: true,
        state: 'PUBLISHED',
      });
      expect(rows[0].publishDate.toISOString()).toBe(
        '2026-10-16T21:00:00.000Z'
      );
      expect(rows[0].content).toContain('&lt;not HTML&gt;');
    });

    it('recognizes older native posts that only have releaseId', async () => {
      const native = await db.post.create({
        data: {
          organizationId: org,
          integrationId: channel,
          releaseId: 'legacy',
          content: 'Keep original',
          publishDate: new Date(),
          group: randomUUID(),
          state: 'PUBLISHED',
        },
      });
      expect(
        await repository.importPlatformPost(org, channel, item('legacy'))
      ).toBe(false);
      expect(
        await db.post.count({
          where: { integrationId: channel, releaseId: 'legacy' },
        })
      ).toBe(1);
      expect(
        (await db.post.findUniqueOrThrow({ where: { id: native.id } })).content
      ).toBe('Keep original');
    });

    it('reconciles an import racing a native publish without replacing the native id', async () => {
      for (let i = 0; i < 5; i++) {
        const remoteId = `publish-race-${i}`;
        const native = await db.post.create({
          data: {
            organizationId: org,
            integrationId: channel,
            content: 'Native',
            publishDate: new Date(),
            group: randomUUID(),
          },
        });
        await Promise.all([
          repository.importPlatformPost(org, channel, item(remoteId)),
          repository.updatePost(native.id, remoteId, item(remoteId).url),
          repository.importPlatformPost(org, channel, item(remoteId)),
        ]);
        const visible = await db.post.findMany({
          where: {
            integrationId: channel,
            releaseId: remoteId,
            deletedAt: null,
          },
        });
        expect(visible).toHaveLength(1);
        expect(visible[0]).toMatchObject({
          id: native.id,
          importedFromPlatform: false,
          externalId: remoteId,
        });
      }
    });

    it('does not resurrect hidden imported posts', async () => {
      await repository.importPlatformPost(org, channel, item('hidden'));
      await db.post.updateMany({
        where: { integrationId: channel, externalId: 'hidden' },
        data: { deletedAt: new Date() },
      });
      await repository.importPlatformPost(org, channel, item('hidden'));
      expect(
        await db.post.count({
          where: {
            integrationId: channel,
            releaseId: 'hidden',
            deletedAt: null,
          },
        })
      ).toBe(0);
    });

    it('keeps identical media ids isolated across tenants and scopes sync status', async () => {
      await repository.importPlatformPost(org, channel, item('shared-id'));
      await repository.importPlatformPost(
        otherOrg,
        otherChannel,
        item('shared-id')
      );
      expect(
        await db.post.count({
          where: {
            releaseId: 'shared-id',
            organizationId: { in: [org, otherOrg] },
          },
        })
      ).toBe(2);
      expect(await sync.get(otherOrg, channel)).toBeNull();
      expect(
        (
          await sync.update(otherOrg, channel, {
            postsSyncLastError: 'not allowed',
          })
        ).count
      ).toBe(0);
    });

    it('updates imported captions and carousel attachments in place', async () => {
      await repository.importPlatformPost(org, channel, item('edited'));
      const before = await db.post.findUniqueOrThrow({
        where: {
          integrationId_externalId: {
            integrationId: channel,
            externalId: 'edited',
          },
        },
      });
      await repository.importPlatformPost(org, channel, {
        ...item('edited'),
        content: 'Updated',
        media: [
          ...item('edited').media,
          { id: 'second', path: 'https://example.com/second.jpg' },
        ],
      });
      const after = await db.post.findUniqueOrThrow({
        where: { id: before.id },
      });
      expect(after.content).toBe('<p>Updated</p>');
      expect(JSON.parse(after.image!)).toHaveLength(2);
    });

    it('reconciles a missing platform id connected after import', async () => {
      await repository.importPlatformPost(
        org,
        channel,
        item('connected-later')
      );
      const native = await db.post.create({
        data: {
          organizationId: org,
          integrationId: channel,
          releaseId: 'missing',
          state: 'PUBLISHED',
          content: 'Native',
          publishDate: new Date(),
          group: randomUUID(),
        },
      });
      await repository.updateReleaseId(native.id, org, 'connected-later');
      const rows = await db.post.findMany({
        where: {
          integrationId: channel,
          releaseId: 'connected-later',
          deletedAt: null,
        },
      });
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(native.id);
    });

    it('materializes recurring releases without duplicating virtual historical occurrences', async () => {
      const anchor = new Date(Date.now() - 3 * 86400000);
      const nextDay = new Date(anchor.getTime() + 86400000);
      const root = await db.post.create({
        data: {
          organizationId: org,
          integrationId: channel,
          content: 'Recurring',
          publishDate: anchor,
          intervalInDays: 1,
          group: randomUUID(),
          state: 'PUBLISHED',
          releaseId: 'repeat-b',
        },
      });
      await repository.importPlatformPost(org, channel, {
        ...item('repeat-a'),
        publishedAt: anchor.toISOString(),
      });
      await repository.importPlatformPost(org, channel, {
        ...item('repeat-b'),
        publishedAt: nextDay.toISOString(),
      });
      await repository.updatePost(root.id, 'repeat-b', item('repeat-b').url);
      await repository.coverRecurringHistory(org, channel, [root.id]);
      const rows = await repository.getPosts(org, {
        startDate: anchor.toISOString(),
        endDate: new Date(Date.now() + 2 * 86400000).toISOString(),
      } as any);
      const historical = rows.filter(
        (post: any) => post.id === root.id && post.publishDate < new Date()
      );
      expect(historical).toHaveLength(0);
      expect(
        rows.filter(
          (post: any) =>
            ['repeat-a', 'repeat-b'].includes(post.releaseId) &&
            post.importedFromPlatform
        )
      ).toHaveLength(2);
      expect(
        rows.some(
          (post: any) => post.id === root.id && post.publishDate > new Date()
        )
      ).toBe(true);
      expect(
        rows.every((post: any) => !('postsSyncCompletedAt' in post.integration))
      ).toBe(true);
      expect(
        rows.every((post: any) => !('platformHistoryCovered' in post))
      ).toBe(true);
    });

    it('keeps recurring publications visible immediately, including Stories outside media history', async () => {
      const anchor = new Date(Date.now() - 86400000);
      const root = await db.post.create({
        data: {
          organizationId: org,
          integrationId: channel,
          content: 'A story',
          settings: '{"post_type":"story"}',
          publishDate: anchor,
          intervalInDays: 1,
          group: randomUUID(),
          state: 'PUBLISHED',
        },
      });
      await repository.updatePost(
        root.id,
        'live-story',
        'https://www.instagram.com/stories/example/'
      );
      await repository.updatePost(
        root.id,
        'live-story',
        'https://www.instagram.com/stories/example/'
      );
      const rows = await repository.getPosts(org, {
        startDate: anchor.toISOString(),
        endDate: new Date(Date.now() + 86400000).toISOString(),
      } as any);
      expect(
        rows.filter(
          (post: any) =>
            post.releaseId === 'live-story' && post.importedFromPlatform
        )
      ).toHaveLength(1);
      expect(
        rows.filter(
          (post: any) =>
            post.id === root.id &&
            post.publishDate.getTime() === anchor.getTime()
        )
      ).toHaveLength(1);
      const snapshot = await db.post.findUniqueOrThrow({
        where: {
          integrationId_externalId: {
            integrationId: channel,
            externalId: 'live-story',
          },
        },
      });
      expect(snapshot.recurringSourceId).toBe(root.id);
      expect(
        rows.some(
          (post: any) =>
            post.id === root.id &&
            post.publishDate.getTime() === snapshot.recurringSlotDate?.getTime()
        )
      ).toBe(false);
    });

    it('does not materialize thread replies or failed publications as successful root posts', async () => {
      const root = await db.post.create({
        data: {
          organizationId: org,
          integrationId: channel,
          content: 'Thread root',
          publishDate: new Date(),
          intervalInDays: 1,
          group: randomUUID(),
        },
      });
      const child = await db.post.create({
        data: {
          organizationId: org,
          integrationId: channel,
          content: 'Reply',
          publishDate: new Date(),
          intervalInDays: 1,
          group: root.group,
          parentPostId: root.id,
        },
      });
      await repository.updatePost(
        child.id,
        'thread-reply',
        'https://example.com/reply'
      );
      expect(
        await db.post.count({
          where: {
            integrationId: channel,
            releaseId: 'thread-reply',
            parentPostId: null,
          },
        })
      ).toBe(0);
      await db.post.update({
        where: { id: root.id },
        data: { state: 'ERROR' },
      });
      await repository.setReleaseDetails(
        root.id,
        'live-but-error',
        'https://example.com/live'
      );
      expect(
        await db.post.count({
          where: {
            integrationId: channel,
            releaseId: 'live-but-error',
            state: 'PUBLISHED',
          },
        })
      ).toBe(0);
    });

    it('does not charge the publishing quota for imported history', async () => {
      const since = new Date('2000-01-01T00:00:00Z');
      const before = await repository.countPostsFromDay(org, since);
      await repository.importPlatformPost(org, channel, item('quota-import'));
      expect(await repository.countPostsFromDay(org, since)).toBe(before);
    });

    it('counts one recurring publication in analytics and polls its comments only once', async () => {
      const integration = await db.integration.create({
        data: {
          organizationId: org,
          internalId: 'analytics-snapshot',
          name: 'Counts',
          providerIdentifier: 'instagram',
          type: 'social',
          token: 'fake',
        },
      });
      const root = await db.post.create({
        data: {
          organizationId: org,
          integrationId: integration.id,
          content: 'Recurring report',
          publishDate: new Date(),
          intervalInDays: 1,
          group: randomUUID(),
        },
      });
      await repository.updatePost(
        root.id,
        'report-media',
        'https://example.com/report'
      );
      const report = new AnalyticsReportRepository(
        { model: db } as any,
        { model: db } as any,
        { model: db } as any
      );
      const from = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
      const to = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
      const points = await report.getPublishedPosts(
        org,
        [integration.id],
        from,
        to
      );
      expect(points.reduce((sum, point) => sum + point.value, 0)).toBe(1);
      const comments = new SocialCommentsRepository(
        { model: db } as any,
        { model: db } as any,
        { model: db } as any
      );
      const polled = await comments.getPostsToPoll(['instagram'], 7);
      expect(
        polled.filter((post) => post.integration.id === integration.id)
      ).toHaveLength(1);
      expect(
        polled.find((post) => post.integration.id === integration.id)?.id
      ).not.toBe(root.id);
    });

    it('includes imports in the normal calendar with origin and tenant filters', async () => {
      const rows = await repository.getPosts(org, {
        startDate: '2026-10-16T00:00:00Z',
        endDate: '2026-10-17T23:59:59Z',
      } as any);
      expect(
        rows.some(
          (post: any) =>
            post.releaseId === 'concurrent' && post.importedFromPlatform
        )
      ).toBe(true);
      expect(
        rows.some((post: any) => post.integration.id === otherChannel)
      ).toBe(false);
      expect(rows.some((post: any) => post.releaseId === 'hidden')).toBe(false);
    });
  }
);
