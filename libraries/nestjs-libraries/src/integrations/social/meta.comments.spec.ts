// Run: npx tsx --test libraries/nestjs-libraries/src/integrations/social/meta.comments.spec.ts
import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import { FacebookProvider } from './facebook.provider.ts';
import { InstagramProvider } from './instagram.provider.ts';
import {
  shouldSendReplyNow,
  unseenComments,
} from '../../database/prisma/social-comments/social.comments.service.ts';

const realFetch = globalThis.fetch;
test.afterEach(() => {
  globalThis.fetch = realFetch;
});

const integration = { id: 'int-1' } as any;

test('the Facebook Graph payload maps onto the internal comment', async () => {
  globalThis.fetch = (async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      data: [
        {
          id: 'fb-comment-1',
          message: 'Nice post',
          created_time: '2026-10-11T12:00:00+0000',
          permalink_url: 'https://facebook.com/c/1',
          from: { id: 'user-9', name: 'Ada' },
        },
        {
          id: 'fb-comment-2',
          created_time: '2026-10-11T13:00:00+0000',
          parent: { id: 'fb-comment-1' },
        },
      ],
    }),
  })) as any;

  const comments = await new FacebookProvider().listComments(
    'token',
    'page-post-1',
    integration
  );

  assert.deepEqual(comments, [
    {
      id: 'fb-comment-1',
      parentId: undefined,
      content: 'Nice post',
      authorName: 'Ada',
      authorId: 'user-9',
      permalink: 'https://facebook.com/c/1',
      publishedAt: '2026-10-11T12:00:00+0000',
    },
    {
      id: 'fb-comment-2',
      parentId: 'fb-comment-1',
      // a comment with only a photo has no message
      content: '',
      authorName: undefined,
      authorId: undefined,
      permalink: undefined,
      publishedAt: '2026-10-11T13:00:00+0000',
    },
  ]);
});

test('the Instagram Graph payload maps onto the same shape', async () => {
  globalThis.fetch = (async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      data: [
        {
          id: 'ig-comment-1',
          text: 'Love it',
          timestamp: '2026-10-11T12:00:00+0000',
          username: 'ada',
          parent_id: 'ig-comment-0',
          from: { id: 'ig-user-9', username: 'ada_from_from' },
        },
      ],
    }),
  })) as any;

  const comments = await new InstagramProvider().listComments(
    'page-token___user-token',
    'media-1',
    integration
  );

  assert.deepEqual(comments, [
    {
      id: 'ig-comment-1',
      parentId: 'ig-comment-0',
      content: 'Love it',
      authorName: 'ada_from_from',
      authorId: 'ig-user-9',
      publishedAt: '2026-10-11T12:00:00+0000',
    },
  ]);
});

test('an empty Graph answer gives an empty list, not a crash', async () => {
  globalThis.fetch = (async () => ({
    ok: true,
    status: 200,
    json: async () => ({}),
  })) as any;

  assert.deepEqual(
    await new FacebookProvider().listComments('token', 'p', integration),
    []
  );
  assert.deepEqual(
    await new InstagramProvider().listComments('token', 'p', integration),
    []
  );
});

test('replying posts to the right Graph edge', async () => {
  const urls: string[] = [];
  globalThis.fetch = (async (url: string) => {
    urls.push(url);
    return { ok: true, status: 200, json: async () => ({ id: 'reply-1' }) };
  }) as any;

  await new FacebookProvider().replyToComment(
    'token',
    'fb-comment-1',
    'thanks',
    integration
  );
  await new InstagramProvider().replyToComment(
    'page-token___user-token',
    'ig-comment-1',
    'thanks',
    integration
  );

  assert.ok(urls[0].includes('/fb-comment-1/comments'));
  assert.ok(urls[1].includes('/ig-comment-1/replies'));
  assert.ok(urls[1].includes('message=thanks'));
  // the user token half is never sent to the Graph API
  assert.ok(!urls[1].includes('user-token'));
});

test('dedupe keeps only the comments we have not stored yet', () => {
  const fetched = [
    { id: 'a', content: '', publishedAt: '' },
    { id: 'b', content: '', publishedAt: '' },
    { id: 'c', content: '', publishedAt: '' },
  ];

  assert.deepEqual(
    unseenComments(fetched, ['a', 'c']).map((c) => c.id),
    ['b']
  );
  assert.deepEqual(unseenComments(fetched, ['a', 'b', 'c']), []);
  assert.deepEqual(
    unseenComments(fetched, []).map((c) => c.id),
    ['a', 'b', 'c']
  );
});

test('an automation never replies on its own unless the org opted in', () => {
  assert.equal(shouldSendReplyNow('automation', false), false);
  assert.equal(shouldSendReplyNow('automation', true), true);
  // a person clicking approve in the UI is the approval
  assert.equal(shouldSendReplyNow('human', false), true);
  assert.equal(shouldSendReplyNow('human', true), true);
});
