#!/usr/bin/env node
// Node 22+. Credentials stay in the MCP transport; only the scoped ticket goes to HTTP upload.
import { createReadStream, openAsBlob } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

export function toolValue(result) {
  if (result.isError) throw new Error('MCP_TOOL_FAILED');
  let value = result.structuredContent;
  if (!value) {
    const text = result.content?.find((item) => item.type === 'text')?.text;
    value = text ? JSON.parse(text) : result;
  }
  if (value.error || value.output?.errors) throw new Error('MCP_OPERATION_FAILED');
  return value;
}

export async function inspectFile(path, mimeType, filename = basename(path)) {
  const info = await stat(path);
  const max = mimeType.startsWith('image/') ? 10 * 1024 ** 2 : 1024 ** 3;
  if (!info.isFile() || !info.size || info.size > max) throw new Error('FILE_SIZE_INVALID');
  if (!filename || /[\\/\x00-\x1f\x7f]/.test(filename)) throw new Error('FILENAME_INVALID');
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return { filename, mimeType, sizeBytes: info.size, sha256: hash.digest('hex') };
}

function safeUploadUrl(url, mcpUrl) {
  const target = new URL(url);
  const local = ['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname);
  if (
    target.origin !== new URL(mcpUrl).origin || target.username || target.password ||
    target.search || target.hash ||
    !(target.protocol === 'https:' || (local && target.protocol === 'http:'))
  ) throw new Error('UNTRUSTED_UPLOAD_URL');
  return target;
}

export async function waitUntilReady(callTool, result, { pollMs = 1500, timeoutMs = 600000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (result.status === 'processing' || result.status === 'uploading') {
    if (Date.now() >= deadline) throw new Error('UPLOAD_STILL_PROCESSING_REUSE_KEY');
    await delay(pollMs);
    result = toolValue(await callTool('completeMediaUpload', { uploadId: result.uploadId }));
  }
  if (result.status !== 'ready' || !result.id || !result.path) throw new Error('MEDIA_NOT_READY_REUSE_KEY');
  return result;
}

export async function uploadMediaFiles(callTool, files, {
  mcpUrl, idempotencyKey, mode = 'session', adjust = false, onProgress = () => {},
  fetchImpl = fetch, pollMs, timeoutMs,
}) {
  if (!idempotencyKey || !['base64', 'session'].includes(mode)) throw new Error('MANIFEST_INVALID');
  const uploaded = [];
  // Input order is the carousel order, independent of remote filenames or completion time.
  for (const [index, file] of files.entries()) {
    const manifest = await inspectFile(file.path, file.mimeType, file.filename);
    const key = `file-${createHash('sha256').update(JSON.stringify([idempotencyKey, index])).digest('hex')}`;
    let result;
    if (mode === 'base64') {
      if (manifest.sizeBytes > 4.5 * 1024 ** 2) throw new Error('USE_SESSION_FOR_LARGE_FILE');
      const bytes = await readFile(file.path);
      if (createHash('sha256').update(bytes).digest('hex') !== manifest.sha256) throw new Error('FILE_CHANGED');
      // Bytes are encoded and passed by code. Never print the base64 or ask an LLM to transcribe it.
      result = toolValue(await callTool('uploadMediaTool', {
        filename: manifest.filename, mimeType: manifest.mimeType,
        base64: bytes.toString('base64'), adjust, idempotencyKey: key,
      }));
    } else {
      result = toolValue(await callTool('prepareMediaUpload', { ...manifest, adjust, idempotencyKey: key }));
      if (result.status === 'awaiting_upload') {
        const url = safeUploadUrl(result.uploadUrl, mcpUrl);
        const ticket = result.uploadHeaders?.['X-Postiz-Upload-Ticket'];
        if (!/^[a-f0-9]{64}$/.test(ticket || '') || result.method !== 'POST') throw new Error('INVALID_UPLOAD_INSTRUCTIONS');
        const form = new FormData();
        form.append('file', await openAsBlob(file.path, { type: manifest.mimeType }), manifest.filename);
        onProgress({ filename: manifest.filename, status: 'uploading', progress: null });
        // Do not forward Authorization, API keys, cookies or arbitrary response headers.
        // On network failure consult the same receipt instead of starting a second upload.
        try {
          await fetchImpl(url, {
            method: 'POST', body: form, redirect: 'error',
            headers: { 'X-Postiz-Upload-Ticket': ticket },
            signal: AbortSignal.timeout(180000),
          });
        } catch { /* The receipt below is authoritative, even after a lost HTTP response. */ }
        result = toolValue(await callTool('completeMediaUpload', { uploadId: result.uploadId }));
      }
    }
    result = await waitUntilReady(callTool, result, { pollMs, timeoutMs });
    const item = { ...manifest, id: result.id, path: result.path, uploadId: result.uploadId, status: result.status };
    uploaded.push(item);
    onProgress({ filename: item.filename, status: item.status, progress: 100 });
  }
  return uploaded;
}

export async function createVerifiedDraft(callTool, media, draft, idempotencyKey) {
  if (!draft.integrationId || !draft.caption || !/T.*(?:Z|[+-]\d\d:\d\d)$/.test(draft.date || '') ||
      Number.isNaN(Date.parse(draft.date)) || !media.length || media.some((item) => item.status !== 'ready')) {
    throw new Error('DRAFT_INPUT_INVALID');
  }
  const collaborators = (draft.collaborators || []).map((handle) => {
    if (!/^@?[A-Za-z0-9._]{1,30}$/.test(handle)) throw new Error('COLLABORATOR_INVALID');
    return { label: `@${handle.replace(/^@/, '')}` };
  });
  const created = toolValue(await callTool('integrationSchedulePostTool', {
    idempotencyKey: `draft-${createHash('sha256').update(idempotencyKey).digest('hex')}`,
    socialPost: [{
      integrationId: draft.integrationId, isPremium: false, date: new Date(draft.date).toISOString(),
      shortLink: false, type: 'draft',
      postsAndComments: [{ content: draft.caption, attachments: media.map(({ path }) => ({ path })) }],
      settings: [
        { key: 'post_type', value: 'post' },
        { key: 'collaborators', value: JSON.stringify(collaborators) },
      ],
    }],
  }));
  const postId = created.output?.[0]?.postId;
  if (!postId) throw new Error('DRAFT_NOT_CONFIRMED_REUSE_KEY');
  const { output: post } = toolValue(await callTool('getPostTool', { id: postId, timeZone: 'UTC' }));
  if (!post || post.state !== 'DRAFT' || post.queueActive !== false || post.remoteId ||
      post.channel?.id !== draft.integrationId ||
      post.publishDateUtc !== new Date(draft.date).toISOString() ||
      post.contentText.replace(/\r\n/g, '\n').trim() !== draft.caption.replace(/\r\n/g, '\n').trim() ||
      JSON.stringify(post.media.map(({ path }) => path)) !== JSON.stringify(media.map(({ path }) => path)) ||
      JSON.stringify(post.settings.collaborators || []) !== JSON.stringify(collaborators)) {
    throw new Error('DRAFT_VERIFICATION_FAILED_READ_EXISTING_POST');
  }
  return { postId, state: post.state, queueActive: post.queueActive, mediaCount: post.media.length };
}

async function main() {
  if (process.argv.length !== 3) throw new Error('USAGE: node scripts/mcp-media-upload.mjs manifest.json');
  const manifestPath = resolve(process.argv[2]);
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const mcpUrl = process.env.MALI_POSTS_MCP_URL;
  if (!mcpUrl || !Array.isArray(manifest.files) || !manifest.files.length) throw new Error('CONFIGURATION_REQUIRED');
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
  const client = new Client({ name: 'mali-posts-file-transfer', version: '1.0.0' });
  const token = process.env.MALI_POSTS_ACCESS_TOKEN;
  const transport = new StreamableHTTPClientTransport(new URL(mcpUrl), {
    requestInit: { headers: token ? { Authorization: `Bearer ${token}` } : {} },
  });
  try {
    await client.connect(transport);
    const callTool = (name, args) => client.callTool({ name, arguments: args }, undefined, { timeout: 180000 });
    const tools = await client.listTools();
    const required = [manifest.mode === 'base64' ? 'uploadMediaTool' : 'prepareMediaUpload', 'completeMediaUpload'];
    if (manifest.draft) required.push('integrationSchedulePostTool', 'getPostTool');
    if (required.some((name) => !tools.tools.some((tool) => tool.name === name))) throw new Error('REFRESH_CLIENT_OR_DEPLOY_TOOLS');
    const media = await uploadMediaFiles(callTool, manifest.files.map((file) => ({
      ...file, path: resolve(dirname(manifestPath), file.path),
    })), { ...manifest, mcpUrl, onProgress: (progress) => console.log(JSON.stringify(progress)) });
    let draft;
    if (manifest.draft) {
      const caption = await readFile(resolve(dirname(manifestPath), manifest.draft.captionFile), 'utf8');
      draft = await createVerifiedDraft(callTool, media, { ...manifest.draft, caption }, manifest.idempotencyKey);
    }
    console.log(JSON.stringify({ media, ...(draft ? { draft } : {}) }, null, 2));
  } finally { await client.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    // SDK/HTTP exceptions may embed request URLs, tickets or encoded bytes.
    const code = /^[A-Z][A-Z0-9_]{2,80}$/.test(error?.message || '') ? error.message : 'TRANSFER_NOT_CONFIRMED';
    console.error(`${code}: transfer failed or could not be confirmed. Re-run the unchanged manifest/key to reconcile; do not publish. See docs/api/mcp-media-transfer.md.`);
    process.exitCode = 1;
  });
}
