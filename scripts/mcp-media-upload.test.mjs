import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { uploadMediaFiles, createVerifiedDraft, toolValue } from './mcp-media-upload.mjs';

const ready = (index) => ({ uploadId: `upload-${index}`, id: `media-${index}`, path: `https://posts.example/uploads/${index}.png`, status: 'ready' });
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'mali-transfer-client-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, 'Imagem 01.png');
  const bytes = Buffer.from('The server validates the actual image format; this fixture tests byte transport.');
  await writeFile(path, bytes);
  return { path, bytes, mimeType: 'image/png' };
}

test('base64 is generated from actual bytes in code and stable keys are reused', async (t) => {
  const file = await fixture(t);
  const calls = [];
  const callTool = async (name, input) => { calls.push({ name, input }); return ready(0); };
  const options = { mode: 'base64', idempotencyKey: 'acceptance-stable' };
  const first = await uploadMediaFiles(callTool, [file], options);
  const second = await uploadMediaFiles(callTool, [file], options);
  assert.deepEqual(first, second);
  assert.equal(calls[0].name, 'uploadMediaTool');
  assert.deepEqual(Buffer.from(calls[0].input.base64, 'base64'), file.bytes);
  assert.equal(calls[0].input.filename, 'Imagem 01.png');
  assert.equal(calls[0].input.idempotencyKey, calls[1].input.idempotencyKey);
});

test('session sends real multipart bytes with only its scoped ticket, keeps order, and polls ready', async (t) => {
  const file = await fixture(t);
  const calls = [];
  const ticket = 'a'.repeat(64);
  let current = -1;
  let polls = 0;
  let uploads = 0;
  const callTool = async (name, input) => {
    calls.push({ name, input });
    if (name === 'prepareMediaUpload') {
      current += 1; polls = 0;
      assert.equal(input.sizeBytes, file.bytes.length);
      assert.equal(input.sha256, createHash('sha256').update(file.bytes).digest('hex'));
      return { uploadId: `upload-${current}`, status: 'awaiting_upload', uploadUrl: 'https://posts.example/api/media-transfer/id', method: 'POST', uploadHeaders: { 'X-Postiz-Upload-Ticket': ticket } };
    }
    return polls++ === 0 ? { uploadId: `upload-${current}`, status: 'processing' } : ready(current);
  };
  const media = await uploadMediaFiles(callTool, [file, { ...file, filename: 'Imagem 02.png' }], {
    mcpUrl: 'https://posts.example/api/mcp', idempotencyKey: 'session-order', pollMs: 1,
    fetchImpl: async (_url, request) => {
      uploads += 1;
      assert.deepEqual(request.headers, { 'X-Postiz-Upload-Ticket': ticket });
      assert.equal(request.redirect, 'error');
      const body = request.body.get('file');
      assert.deepEqual(Buffer.from(await body.arrayBuffer()), file.bytes);
      assert.equal(body.name, uploads === 1 ? 'Imagem 01.png' : 'Imagem 02.png');
      return new Response('{}');
    },
  });
  assert.equal(uploads, 2);
  assert.deepEqual(media.map((item) => item.id), ['media-0', 'media-1']);
  assert.notEqual(calls[0].input.idempotencyKey, calls[3].input.idempotencyKey);
});

test('ready replay skips HTTP, and foreign upload host is refused before bytes leave', async (t) => {
  const file = await fixture(t);
  const options = { mcpUrl: 'https://posts.example/api/mcp', idempotencyKey: 'test-replay', fetchImpl: () => assert.fail('Must not send bytes') };
  await uploadMediaFiles(async () => ready(0), [file], options);
  await assert.rejects(uploadMediaFiles(async () => ({
    status: 'awaiting_upload', uploadUrl: 'https://foreign.example/upload',
  }), [file], options), /UNTRUSTED_UPLOAD_URL/);
});

test('lost HTTP response reconciles receipt; unknown status never becomes publishable', async (t) => {
  const file = await fixture(t);
  const prepared = { status: 'awaiting_upload', uploadId: 'upload-0', method: 'POST', uploadUrl: 'https://posts.example/upload', uploadHeaders: { 'X-Postiz-Upload-Ticket': 'b'.repeat(64) } };
  const options = { mcpUrl: 'https://posts.example/mcp', idempotencyKey: 'lost-response', fetchImpl: async () => { throw new Error('network lost'); } };
  const successful = await uploadMediaFiles(async (name) => name === 'prepareMediaUpload' ? prepared : ready(0), [file], options);
  assert.equal(successful[0].status, 'ready');
  await assert.rejects(uploadMediaFiles(async (name) => name === 'prepareMediaUpload' ? prepared : { status: 'unknown' }, [file], options), /MEDIA_NOT_READY/);
});

test('draft creation preserves caption, paths and collaborator and requires a confirming read', async () => {
  const media = [ready(0), ready(1)];
  const draft = { integrationId: 'ig-account', caption: 'Teste de transferência.\n\nNão publicar.', date: '2026-10-23T12:00:00Z', collaborators: ['airesetmkt'] };
  const calls = [];
  const callTool = async (name, input) => {
    calls.push({ name, input });
    if (name === 'integrationSchedulePostTool') return { output: [{ postId: 'draft-1' }] };
    return { output: { state: 'DRAFT', queueActive: false, remoteId: null, channel: { id: draft.integrationId }, publishDateUtc: new Date(draft.date).toISOString(), contentText: draft.caption, media, settings: { collaborators: [{ label: '@airesetmkt' }] } } };
  };
  const result = await createVerifiedDraft(callTool, media, draft, 'draft-stable');
  assert.equal(result.state, 'DRAFT');
  assert.equal(calls[0].input.socialPost[0].type, 'draft');
  assert.deepEqual(calls[0].input.socialPost[0].postsAndComments[0].attachments, media.map(({ path }) => ({ path })));
  assert.equal(calls[1].name, 'getPostTool');
  await assert.rejects(createVerifiedDraft(async () => ({ output: [{ postId: 'x' }] }), media, draft, 'draft-stable'), /VERIFICATION_FAILED/);
  await assert.rejects(createVerifiedDraft(callTool, [{ ...ready(0), status: 'processing' }], draft, 'draft-stable'), /INPUT_INVALID/);
});

test('tool decoding supports standard text and structured results and rejects tool errors', () => {
  assert.deepEqual(toolValue({ content: [{ type: 'text', text: '{"status":"ready"}' }] }), { status: 'ready' });
  assert.throws(() => toolValue({ structuredContent: { error: { code: 'FAILED' } } }), /OPERATION_FAILED/);
  assert.throws(() => toolValue({ isError: true }), /TOOL_FAILED/);
});
