# Instagram webhook relay

The relay keeps the existing Meta callback URL and Chatwoot receiver. It adds a second delivery to Postiz. It does not change the Meta app callback or rebuild Hermes.

Python 3.12 standard library is sufficient. No application database is used or changed. The HTTP listener binds only to `127.0.0.1:15038`. Apache remains the public TLS endpoint.

## Delivery and data scope

1. The relay verifies the original `X-Hub-Signature-256` with the current Meta app secret before it accepts an event.
2. It writes both delivery states to a private spool with atomic replacement and file/directory `fsync`. It returns HTTP 200 only after that write succeeds. Duplicate raw payloads receive HTTP 200.
3. Independent workers send to the existing Hermes receiver and Postiz. A slow or unavailable destination does not block the other worker.
4. Hermes receives the exact original bytes, content type and signature. Its own signature validation remains enabled.
5. Postiz receives only entries whose Instagram account IDs are in `RELAY_INSTAGRAM_IDS`. A batch containing only allowed entries retains its exact original bytes and signature. For a mixed batch, the relay removes other entries, encodes the filtered payload and signs those bytes with the same Meta app secret. Postiz validates the forwarded bytes normally. The original source signature has already been verified. An unowned-only batch is sent only to Hermes.
6. Delivery is at least once. A process can stop after an upstream accepts a request and before the result is written. Postiz's execution/delivery ledger and Hermes's message identity checks must therefore remain enabled. Transport deduplication is not a replacement for those checks.

No token, payload, message text or commenter identity is written to logs. Pending and dead-letter payloads are private operational data. Successful payloads are removed; a hash-only receipt remains for 30 days. Receipts from older successful events expire. Their later redelivery is still deduplicated by the destination.

## Limits and failure handling

- Maximum request: 1 MiB and 100 entries; maximum concurrent requests: 16.
- Default spool: 5,000 events or 64 MiB. A full or unwritable spool returns HTTP 503 so Meta can retry. **A long Postiz outage can fill this shared spool and apply backpressure to new Chatwoot events. Monitor the backlog and resolve it before the limit is reached.** Do not discard pending deliveries to clear the queue.
- HTTP timeouts, HTTP 408/425/429 and HTTP 5xx retry with exponential backoff, at most one hour between attempts, up to 100 attempts.
- Other non-2xx responses, including redirects, become dead letters. Exhausted transient failures also become dead letters. Their payloads remain available for manual replay. HTTPS validates the certificate and hostname; redirects are not followed.
- `/health` exposes counts, queued bytes and the oldest pending age. It contains no payload. A dead letter returns HTTP 503. Monitor Docker health, pending age and spool bytes. The health check does not send notifications on its own.
- On corrupt spool data or a durable write failure in a delivery worker, the process stops. The restart policy reloads persisted state. A second process cannot open the same spool.

## Prepare and test

Run from this directory:

```sh
python3 -m unittest -v test_relay
python3 -m py_compile relay.py test_relay.py
```

The tests use temporary private directories and local HTTP sockets. They do not load installation configuration, access a database, call Meta or send a message.

## Deploy

Perform this step only as part of an authorized release.

1. Check that the existing Hermes listener is still `127.0.0.1:45104` and the Postiz endpoint is `https://postiz-app.aireset.com.br/api/public/ig-webhook`. These destinations are fixed in `relay.py`.
2. Copy this directory to a dedicated private installation directory. Create `spool/` with owner UID/GID 1000 and mode 0700. Keep the spool on persistent local storage; do not use a temporary directory or an ephemeral container layer.
3. Put the **existing shared Meta app secret** in a separate private file without printing it. The file must be readable by container UID 1000 (mode 0400, owner 1000). Keep its parent directory private to the operator. Do not change the secret in Meta, Hermes or Postiz. Both destinations must already use that same app secret.
4. Set `META_APP_SECRET_FILE` to that file's absolute path. Set `RELAY_INSTAGRAM_IDS` to the connected Instagram `internalId` values from the current Postiz database. Check the active account and organization scope. The release validation identified three accounts, but read their current IDs instead of assuming that old metadata is still current. Keep this `.env` outside Git.
5. Start only this service with `docker compose -f compose.yaml up -d`. Check its image digest and retain it with the release record. Check `http://127.0.0.1:15038/health`; expect zero pending/dead deliveries.
6. Back up the exact Apache/Plesk HTTPS vhost file and its permissions. Add `apache.conf` **before** the existing `ProxyPass "/"` rule for `chat.aireset.com.br`. Keep the remaining vhost configuration and the Meta callback URL unchanged. Run the server's Apache configuration test before its graceful reload. Do not restart the global Docker daemon or alter unrelated vhosts.
7. Verify an invalid signature returns HTTP 401 without a queue entry. Verify the Meta GET challenge still reaches Hermes. Use an authorized test event to confirm both destinations accept a delivery and the queue drains. Keep automation flows paused until the test account, rule and expected message are confirmed.
8. Replay the same signed event. Expect HTTP 200 `duplicate` and unchanged Postiz execution/delivery counts. Confirm the existing Chatwoot event and current Instagram history sync still work. Record the exact source revision, image digest, allowed account IDs and results without secrets.

## Recover a dead letter

Fix the upstream or configuration first. The log identifies only the event hash and destination. Stop the relay before manual recovery; this leaves Meta requests retryable and prevents concurrent spool writers.

```sh
docker compose -f compose.yaml stop relay
docker compose -f compose.yaml run --rm --no-deps relay python /app/relay.py retry-dead EVENT_SHA256 postiz
docker compose -f compose.yaml up -d relay
```

Replace `EVENT_SHA256` with the 64-character hash from the dead-letter log. Use `hermes` only when that destination failed. The command refuses a non-dead delivery or an invalid identifier. It resets only the selected destination, preserves the other destination's status and reuses the stored signed body.

## Roll back ingress

Restore the saved HTTPS vhost configuration, run the Apache configuration test, then reload Apache gracefully. The same callback URL will again reach Hermes directly. Keep the relay running until accepted pending deliveries have drained, or retain the spool and resolve dead letters later. Do not remove the spool, rotate signing secrets or restore an application database for this rollback.
