# Transferring local media to Mali Posts over MCP

`uploadMediaTool` transfers actual file bytes. `prepareMediaUpload` and
`completeMediaUpload` transfer larger files over authenticated, temporary HTTP
uploads. Neither operation creates or publishes a post. Existing URL uploads,
interactive upload widgets, `uploadFileTool` and `uploadLinkTool` remain available.

A remote server cannot read `/workspace/image.png`, `sandbox:/image.png`, a local
Windows path, or an arbitrary attachment ID. The process with access to that file
must read and transmit its bytes. The example below does this in code; base64 is
never printed, transcribed by the model, or included in the user's response.

## Small files: `uploadMediaTool`

Input schema:

| Field | Type | Requirement |
| --- | --- | --- |
| `filename` | string | Original basename, 1–200 characters; no directory separators/control characters |
| `mimeType` | string | Actual supported MIME type, checked against file contents |
| `base64` | string | Base64 bytes, not a data URL; at most 6 MiB of characters |
| `adjust` | boolean | Defaults to false; request existing media preparation, preserving original |
| `idempotencyKey` | string | 8–200 characters; reuse the same key and input after an uncertain response |

Supported types: JPEG, PNG, GIF, WebP, AVIF, BMP, TIFF, MP4 and QuickTime.
Changing the extension or declared MIME type does not bypass content validation.
Images are decoded with Sharp (maximum 40 million pixels); videos are inspected
with `ffprobe`, including dimensions, duration and readable packets. Inspection
has a 120-second bound. An unreadable file cannot become ready. Video inspection
requires `ffprobe` on the backend, already present in the production image.
QuickTime/MOV is sent through the existing compatibility preparation and is not
ready for publication until processing completes.

The call is constructed programmatically:

```js
import { readFile } from 'node:fs/promises';

const bytes = await readFile('/workspace/Post-Instagram-Mali-01-Capa.png');
const response = await client.callTool({
  name: 'uploadMediaTool',
  arguments: {
    filename: 'Post-Instagram-Mali-01-Capa.png',
    mimeType: 'image/png',
    base64: bytes.toString('base64'),
    adjust: false,
    idempotencyKey: 'campaign-2026-10-cover-v1',
  },
});
// Read status/id/path from the response. Do not log request arguments.
```

`client` is the already authenticated MCP SDK client. The file is read on the
client machine; the server receives the encoded bytes, never the filesystem path.

## Large files: prepare → send bytes → complete

`prepareMediaUpload` accepts `filename`, `mimeType`, `adjust`, `idempotencyKey`,
plus `sizeBytes` (positive integer) and `sha256` (64 hexadecimal characters).
It returns:

```json
{
  "uploadId": "mu_<64 hexadecimal characters>",
  "status": "awaiting_upload",
  "progress": 0,
  "uploadUrl": "https://your-postiz.example/api/media-transfer/mu_<id>",
  "method": "POST",
  "uploadHeaders": { "X-Postiz-Upload-Ticket": "<temporary secret>" },
  "expiresAt": "2026-10-23T15:10:00.000Z"
}
```

The runtime sends multipart/form-data with exactly one field named `file`:

```js
import { openAsBlob } from 'node:fs';

const form = new FormData();
form.append('file', await openAsBlob(localPath, { type: mimeType }), filename);
await fetch(prepared.uploadUrl, {
  method: 'POST',
  headers: prepared.uploadHeaders,
  body: form,
  redirect: 'error',
});
const finalResult = await client.callTool({
  name: 'completeMediaUpload',
  arguments: { uploadId: prepared.uploadId },
});
```

Let the HTTP library generate the multipart boundary. Never copy the primary
Authorization header, cookies or API key into the upload request. The short-lived
ticket is scoped to one authenticated organization/profile, upload and manifest;
the server verifies the actual filename, byte length, MIME type and SHA-256.
The ticket is passed in a header, never in the URL. Its lifetime is 10 minutes.
Successful replays return the existing media without storing another copy.

The HTTP route is `POST /media-transfer/:uploadId` on the backend (normally exposed
as `/api/media-transfer/:uploadId`). It uses the existing Postiz streaming upload
validation/storage service and saves Media plus the durable receipt atomically.
`completeMediaUpload` accepts only `{ "uploadId": "mu_..." }`; it cannot register
an arbitrary supplied path. Preparation and completion use the existing MCP
authentication. The binary endpoint accepts only its limited ticket.

## Status and failure contract

All three tools return `uploadId`, `status`, `progress` and, when registered,
`id`, `path`, `originalPath`. `error` contains a sanitized `code` and `message`.

| Status | Meaning / next step |
| --- | --- |
| `awaiting_upload` | Manifest reserved; bytes not received. Send the file using current instructions. |
| `uploading` | A receiver claimed this upload. Poll the same ID; do not start another key. |
| `processing` | Stored, but media preparation is incomplete. Poll the same ID. |
| `ready` | The returned media ID/path may be used in a post. This does not mean published. |
| `failed` | Validation or preparation failed. Inspect the error; the rejected file is not publishable. |
| `unknown` | The result cannot be established safely. Reconcile this ID instead of blindly resending. |

`progress` is 0 before transfer, 100 when ready, and null when indeterminate.
It is not a fabricated byte-level percentage. The sender may show its own network
progress. Processing retains the original file and can return a different ready
path. Completion reconciles interrupted processing startup using the existing
stable workflow ID and refuses to restart an already completed conversion.
Uncertain or failed workflow results may still require operator reconciliation;
they must not be interpreted as ready or retried under a new key automatically.

Common errors include `INVALID_UPLOAD_INPUT` (invalid schema),
`UPLOAD_IDEMPOTENCY_CONFLICT` (same key, different manifest),
`UPLOAD_NOT_FOUND` (outside authenticated scope or absent),
`UPLOAD_TICKET_INVALID` (missing/expired/wrong ticket),
`UPLOAD_INTEGRITY_MISMATCH` (invalid bytes/manifest), and
`UPLOAD_RESULT_UNKNOWN`. MCP errors are returned in the tool's error envelope.
The HTTP receiver rejects invalid tickets before parsing the body; file validation
failures return a failed receipt, so callers must inspect status even after an
HTTP success response. Unexpected backend exceptions never return storage credentials,
ticket values or request bytes through the MCP wrapper.

Idempotency is scoped to organization and authenticated profile. The same key
with identical content/options resolves to the same upload and media ID, even
after a lost response. Different bytes/options under that key conflict. A failed
or unknown upload is not silently restarted. Repeating preparation for a still
unclaimed upload may issue a fresh short-lived ticket; it retains the same ID.
Receipts use the existing `PostOperation` storage; no schema migration is required.

Profile API keys retain their profile scope. Existing organization OAuth sessions
remain organization-scoped; these tools do not invent a profile from a prompt or
accept a caller-supplied organization/profile override.

## Limits and network requirements

Measurements below were taken on 2026-10-23. They describe different layers, not a
single interchangeable limit.

| Layer | Verified limit / observation |
| --- | --- |
| New direct base64 tool | 6 MiB of encoded characters, approximately 4.5 MiB decoded per call |
| Postiz media validation | 10 MiB per image; 1 GiB per video |
| Prepared multipart upload | Same media limits, plus exact declared size and SHA-256 |
| Production public Streamable HTTP MCP | A harmless `tools/list` request carrying 6 MiB of synthetic JSON was accepted; larger proxy payloads were not measured |
| Container Nginx | `client_max_body_size 2G`; API proxy read timeout 180s and send timeout 60s |
| Legacy SDK SSE transport | 4 MiB message limit; this is not the Streamable HTTP transport limit |
| ChatGPT client | No authoritative numeric MCP payload maximum was found. Do not assume the server's limit is available to that client. |

Seven 1.5–2 MiB PNGs should be seven separate uploads, not one enormous base64
argument. The supplied executable defaults to multipart sessions, so the MCP
message itself contains only a small manifest. It streams the file from disk.

The runtime needs filesystem read access, DNS resolution and outbound HTTPS to
the MCP/backend hostname. Its network policy must allow multipart POSTs to the
returned URL, and the proxy must allow the upload duration/size. No public source
hosting or browser session is required. The example refuses cross-origin upload
URLs, credentials/query parameters in them, and redirects. Plain HTTP is accepted
only on loopback for isolated development. Media stored by Postiz can subsequently
use its existing public delivery URL so social networks can fetch it; this is
distinct from requiring the user to host the original file beforehand.

## Executable end-to-end client

Use Node 22+ from this repository (the MCP SDK is already installed). Put
`MALI_POSTS_MCP_URL` in the runtime's secure environment. For OAuth, set the access
token in `MALI_POSTS_ACCESS_TOKEN` through the client's credential store; do not ask
the user to paste credentials in chat. An existing SDK client can instead call the
exported functions with its authenticated `callTool` implementation. An API-key
MCP address is also supported through the environment, but that full address is a
secret and must not be logged or committed.

Create a manifest next to the files. Paths here are client-side inputs to the
executable; they are not sent to the server:

```json
{
  "idempotencyKey": "mali-transfer-acceptance-20261023-v1",
  "mode": "session",
  "adjust": false,
  "files": [
    { "path": "Post-Instagram-Mali-01-Capa.png", "mimeType": "image/png" },
    { "path": "Post-Instagram-Mali-02.png", "mimeType": "image/png" },
    { "path": "Post-Instagram-Mali-03.png", "mimeType": "image/png" },
    { "path": "Post-Instagram-Mali-04.png", "mimeType": "image/png" },
    { "path": "Post-Instagram-Mali-05.png", "mimeType": "image/png" },
    { "path": "Post-Instagram-Mali-06.png", "mimeType": "image/png" },
    { "path": "Post-Instagram-Mali-07.png", "mimeType": "image/png" }
  ],
  "draft": {
    "integrationId": "<connected Instagram integration ID>",
    "captionFile": "caption.txt",
    "date": "2026-10-23T18:00:00Z",
    "collaborators": ["airesetmkt"]
  }
}
```

Run:

```sh
node scripts/mcp-media-upload.mjs /workspace/acceptance/manifest.json
node --test scripts/mcp-media-upload.test.mjs
```

The client hashes each local file, transfers its bytes, waits for ready and retains
array order. The optional `draft` section invokes `integrationSchedulePostTool`
with `type: "draft"` and a stable creation key. Omit that section to upload only.
There is deliberately no publish/schedule option in this example. Caption
paragraphs and the collaborators setting survive; a configured collaborator in a
draft is not a sent or accepted Instagram invitation.

After creation, `getPostTool` checks the saved caption, ordered media paths,
collaborators, channel, DRAFT state and absence of an active publishing workflow.
Retry the unchanged manifest to reuse the same files and draft. Changing a file,
caption or date intentionally requires reviewing the previous result before
choosing a new operation key. The script's final output contains only media
metadata and confirmed draft state, never base64, tokens or upload tickets.

## What ChatGPT can and cannot do

Installing a tool does not grant the model filesystem access or a code execution
environment. A generic ChatGPT session cannot be promised to read every generated
`sandbox:` artifact and call an MCP tool programmatically. If its runtime cannot
read the file or perform outbound HTTP, it cannot use the binary session flow
alone. A widget file selector is a different, interactive capability.

OpenAI documents widget APIs such as `uploadFile`, `selectFiles` and
`getFileDownloadUrl`, and a native attachment contract using
`_meta["openai/fileParams"]` with a file object containing `download_url` and
`file_id`. Those capabilities depend on the client and are not the same input as
this tool's base64/manifest. This change does not pretend arbitrary local paths or
attachment IDs are such a bridge. See the official
[plugin reference](https://developers.openai.com/plugins/reference) and
[ChatGPT UI documentation](https://developers.openai.com/plugins/build/chatgpt-ui).

The viable noninteractive alternative is Codex, a local agent, or a controlled
runner that already has the generated file, an authenticated MCP SDK connection
and HTTPS egress. Run the executable there, or call its exported
`uploadMediaFiles` / `createVerifiedDraft` functions through the existing client.
After deployment, refresh the connector's tool catalog if these tools do not
appear. A successful server `tools/list` response does not prove that an already
connected ChatGPT session has refreshed its cached catalog.

## Acceptance evidence

On 2026-10-23 the isolated integration test passed all three cases. It starts a
real MCP Streamable HTTP server and Nest multipart receiver with PostgreSQL,
Redis and local storage, then runs the executable in a separate Node process.
The server receives bytes over HTTP, not client paths. The seven valid PNGs each
contain 1,923,982 bytes. It verifies stored SHA-256, original names and array order.

The executable creates and reads the draft through the real
`IntegrationSchedulePostTool` and `GetPostTool` wrappers. Repeating the same
manifest preserves seven media records and one draft ID, its caption, UTC date,
channel and collaborator. State is DRAFT, queueActive is false and workflow-start
calls remain zero. A real PNG also passes base64 transfer and replay; invalid
names, excessive payloads, wrong hashes and another organization/profile are
rejected. Separate regression tests reject a truncated PNG with a valid signature.

The integration spec contains the exact isolated-container setup and cleanup:
[media.transfer.integration.spec.ts](../../libraries/nestjs-libraries/src/database/prisma/media/media.transfer.integration.spec.ts).
It is opt-in (`RUN_MEDIA_TRANSFER_INTEGRATION=1`), checks the test-only database
and Redis ports, does not load production credentials, and records sanitized
evidence in `/tmp/postiz-media-transfer-acceptance.json`.

Validation at this revision: 79 focused regression tests, six executable-client
tests and three real integration cases passed; backend and orchestrator builds
passed. This is an isolated acceptance, not a claim of deployment or of a draft
created on a live Instagram account. Production acceptance for @felipealmeman
and the installed ChatGPT connector catalog is a separate release verification.
