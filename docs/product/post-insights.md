# Post insights, Stories and calendar post panel

Implements #58–62 on the Mali Posts authentication, reports, comments poll and external-post sync. PR #64 already supplies compact cards, full preview and server-side period pagination (#57/#63). This extension does not change any published Temporal workflow or activity parameter.

## Selective reuse

Reference: GkhanKINAY/postqueen-app, commit f8e33f52067c18efd6f958ed70bb708522aa6bdf (AGPL-3.0, same license). Adapted known-count normalization, unknown-last ranking, top-four, weekday distribution and dashboard structure from post-metrics.query/map and workspace.analytics. Existing Mali Posts list cards, pagination, profile permissions, full preview, reports and CSV patterns are reused. Donor billing/credits, schedulers, org-only authorization, purge/retention, assumed zeroes and fabricated first deltas were not imported.

## Dashboard and calendar

Metrics opens consolidated post insights; Channel analytics retains the existing provider-specific charts. Filter publication period (1–366 days), channel, format and caption search; choose ranking/order and page size. Top four, per-post table, counts/coverage, channel distribution and weekday counts (UTC) use the same filtered set. CSV contains all matching rows, not just the visible page. Cards open the existing 80vw × 80vh preview; history shows durable observations including Story reach, replies and navigation when returned. Unknown is an em dash, actual zero remains zero.

The calendar Posts panel is optional on desktop and reuses ListView/actions with scheduled/draft/published tabs, existing channel/format/search and list-period filters. The calendar remains mounted when the panel opens/closes. Returning from a day list restores the previous calendar period/view. Phones retain the agenda/full-list interfaces.

## Read contracts (no provider calls)

All calls use the authenticated organization and permitted profile; profile keys cannot override it. MCP payloads reject organizationId/profileId. Responses explicitly select public post/channel fields; tokens and internal integration settings never leave the service.

| HTTP | MCP | Result |
| --- | --- | --- |
| GET /public/v1/analytics/summary | analyticsSummaryTool | period, notes, unit=count, total, summary.metrics and coverage, channels, weekdays |
| GET /public/v1/analytics/posts | analyticsPostsTool | summary plus page, limit, posts, topReactions, topComments |
| GET /public/v1/analytics/posts/:id?cursor=… | analyticsPostTool | post, notes, history (up to 100), historyNextCursor |

Query schema: date integer1–366 (default30), or from/to ISO timestamps up to366 days; integrationId/platform/q strings up to200; format=all/post/story/video/carousel; page>=0 (zero-based), limit1–100; sort=reactions/comments/views/impressions/reach/engagement/published; dir=asc/desc. Invalid periods/cursors return400; missing or inaccessible published posts return404. A report above5,000 matching posts returns400 with instructions to narrow it, never partial totals. Query work is capped at5,001 posts with the latest merged snapshot per post. Search/format/ranking run over that bounded period/channel set before paging.

Each post includes id, plain content, UTC publishDate, remoteId/releaseURL/reviewURL, format/thumbnail, channelName/channelPicture/platform/integrationId, nullable count metrics, metricCollectedAt and metricSources, updatedAt/source/metricPeriod, latest attempt status/time, nextRefreshAt and manualRefreshAfter. There are no fabricated percentages. Engagement returns value, denominator, denominatorValue and formula: (reactions+comments)/reach*100, falling back to impressions then views only when that denominator is returned. Missing numerator or a zero/missing denominator returns null. Different-network audiences are not deduplicated.

`period.field=publishDate` filters which publications are included. Metrics are latest observed provider totals, NOT interactions earned during this period. Instagram post/Story results are lifetime; other providers are marked provider_window_unknown rather than misrepresented as lifetime. History contains observed samples, not daily interaction deltas. Success observations in the same hour/source are coalesced; failures have a separate status row. Per-metric timestamps/sources preserve older known fields when a webhook is partial.

Examples (the application/client supplies its authenticated connection; do not paste a key into chat):

```json
{"date":30,"format":"story","sort":"comments","limit":20,"page":0}
```

```json
{"id":"published-post-id","cursor":"historyNextCursor-from-previous-page"}
```

```sh
curl --fail --get "$POSTIZ_URL/public/v1/analytics/posts" \
  -H "Authorization: Bearer $POSTIZ_TOKEN" \
  --data-urlencode 'date=30' --data-urlencode 'format=story' \
  --data-urlencode 'sort=views' --data-urlencode 'limit=20'
```

Do not infer that a missing metric is zero, or that stored observations guarantee a provider currently grants permission. Read-only MCP tools never collect remotely, send, schedule, delete or retry a publication.

## Collection and failure handling

The existing comments activity invokes a bounded metrics batch; there is no second timer/workflow. Existing external-post sync also discovers active Stories on the first page, preserving native posts and remote identities. Story edge failures log only a sanitized partial warning and do not block successful feed reconciliation. Cursor pagination uses the fixed Graph host, never a provider-supplied next URL. The existing provider-specific legacy analytics charts retain their window contract; the new dashboard/MCP read only stored snapshots.

The new manual refresh route POST /analytics/posts/:id/refresh and comment-preview refresh share the same canonical org/stored-profile/channel/remote-ID lease and collector as the scheduled batch. Manual successful reads have a30-second cooldown; automatic feed collection is up to once per6h, active Stories up to once per30min. Failed reads back off15min to6h. Batches rotate recent/history cursors, cap40+20 candidates and90 seconds, and use a120-second per-post lease. These are eligibility limits, not an exact execution SLA. Large backlogs or provider quotas can delay collection. Status is available/not_collected/in_progress/cooldown/unavailable/transient_error/permission_required/unsupported/window_expired. Permission errors never disconnect a channel or retry a send from this collector.

Snapshots are additive and durable, keyed by organization/profile/integration/remote ID/hour/source/status, optionally linked to Post. HMAC-verified story_insights callbacks are constrained to signed-account ownership and allowed organizations. Callbacks arriving before import keep the remote identity and are linked on later collection. A partial observation merges known fields with their original individual source/time; unavailable attempts never replace a successful snapshot. Pre-release Redis metrics remain visible until the first durable observation exists.

## Story limitations and setup

Official source checked23Oct2026: https://developers.facebook.com/documentation/instagram-platform/reference/instagram-media/insights (via Context7). Meta exposes Story metrics for24h, may return insufficient-viewer errors below5 viewers, and has regional replies limitations. Highlights/webhooks can return different observations; this implementation does not promise retroactive recovery.

Instagram and Instagram Login use the active /stories edge; Story insights request views/reach/replies/shares separately from optional navigation with story_navigation_action_type. No feed-only likes/saves/comments request is used for Stories. Counts absent from the response remain unknown. Expired media URLs can stop rendering: preserved IDs, publication metadata and observed metrics do not constitute an archive of the original image/video bytes.

For final expiry observations, the Meta app must already be approved for the relevant insight permissions and subscribed to the Instagram story_insights webhook field. This code handles verified callbacks but does not silently modify the app's subscriptions or the active automation. Polling still captures available metrics without this callback; app-level review/permission availability is external. Check the app subscription at release time without replacing existing fields.

## Notifications

Notifications can include a dedupeKey, hashed with org+profile and stored under a unique database index. A concurrent duplicate P2002 skips both another in-app notification and another email/digest; other database errors still surface. Refresh warnings and metric-failure warnings use channel+problem+UTC-day, so a new failure category can be reported. Metric failure text explicitly says the remote post is confirmed published and metrics are unavailable; do not publish again. No remote receipts, IDs, flow definitions or sends are modified.

## Migration / release

Generated additive migration20261023190000_post_metric_snapshots adds PostMetricSnapshot and nullable unique Notifications.dedupeKey. It deletes nothing and has no purge job. Prisma generate/validation, focused tests and all three builds must pass before a separate release. Apply the migration before starting code that reads snapshots. Back up first, preserve workflows/active automation, and validate with read-only requests; do not publish/delete real posts or send messages to groups as QA.

## QA

1. With two authenticated profiles in different organizations, read summary/posts/history; each must see only its scoped publications. A foreign ID or history cursor must not expose rows. MCP must reject supplied organizationId/profileId.
2. Use local fixtures with known0, absent/null and partial observations. Confirm0 versus—, formula denominator, per-field collected time/source and no disappearance of pre-release cached metrics.
3. Filter period/channel/Story/search, sort and paginate. Compare CSV to the entire filtered set, not one page. A set above5,000 returns an explicit narrowing error.
4. Open a prior month, select a date/list, return to calendar; the month remains. Open/close the side panel, change tabs/pages, and verify calendar context, all post actions and status filters remain intact.
5. Stub paginated active Stories and a failing Story edge. Confirm remote identity/date/format/order and continued feed import. Send a signed Story webhook before import; later collection links observations only within the stored scope. Invalid HMAC must not reach storage.
6. Race manual/scheduled calls for the same stored profile (including an org-wide caller); only one provider call executes. Repeat notification keys concurrently; one unique record/email/digest. Change profile/problem/day; a new notification is allowed.
7. Compare workflow file hashes and active flow definitions/states/channels/delivery counts before/after release. Do not treat a successful analytics request as publication evidence.


## Operational verification, 23 October 2026

The shared Chat NeuralTalk Meta app had valid insights scopes on all four connected Facebook Login Instagram channels, but lacked the `story_insights` subscription. The field was added at v25.0 while preserving every existing field/version/callback, including Page and WhatsApp subscriptions. The relay now includes the already connected Grupo Mali account and its Page has the same app installed. Story metrics are delivered only to Postiz; comments/messages retain their existing route. Signed empty-value acceptance, invalid signature rejection and durable deduplication passed without changing flow definitions, channel settings or delivery counts. The official Meta dashboard Story sample also reached the public callback with HTTP 200; no rows for its sample media ID were stored. This is a transport/sample check, not a real expired-Story observation.

The app dashboard still reports Standard Access, with no Advanced Access review requested, for `instagram_manage_insights`, `pages_manage_metadata` and `instagram_manage_contents`. A granted token scope does not prove Advanced Access or live webhook delivery for external accounts. The connected tokens do not include `instagram_manage_contents` or the second Facebook User token required by the existing deletion implementation. Reconnect only after the needed approval/access is available; do not test with a real deletion.

Published Instagram captions are not editable by the existing API: the documented media update operation controls comments, not the caption. Draft/queued captions and media remain editable through the current editor/API/MCP. Remote deletion supports non-ad posts, whole carousels, Reels and individual Stories only when the provider/access preconditions pass. Local removal is a separate operation. Calendar menus use server-provided `remoteDeletionSupported` capability, hide unavailable/already completed remote actions, and preserve read-only users' restrictions. Capability is not proof that the connected token has every required permission.


### Instagram reconnection and deletion credentials

Facebook Login account selection and reconnection retain both Page and user tokens in the existing server-side combined token format. Deletion checks use the user token and require granted `instagram_manage_contents`; Page-only historical connections must reconnect using saved authorization or OAuth. Reconnection alone never deletes media. No credential is returned to the browser or MCP.
