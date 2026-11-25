# Webhooks: outgoing events and a general incoming URL (GitHub #166)

Status: shipped 2026-11-25 (written 2026-11-25 @ `259fd0a`; Phase 1 in #172; Phase 2 in the incoming-webhooks PR)
Archive path: `docs/archive/plans/webhooks.md`

Lane: P (new models and migrations, new routes, a new signed unauthenticated route, a new Settings section). Two phases, each its own branch and PR: **Phase 1** outgoing webhooks, **Phase 2** a general incoming URL. Phase 2 starts after Phase 1 merges; the two never carry a migration at the same time.

## Decisions (user, 2026-11-25)

- Both directions: Solvro sends events to other tools, and Solvro receives events from any tool through one general incoming URL (Phase 2 rewritten from GitLab-only to general by the user, 2026-11-25).
- Outgoing format: [Standard Webhooks](https://www.standardwebhooks.com/) (JSON body `{ type, timestamp, data }`, headers `webhook-id`, `webhook-timestamp`, `webhook-signature`, HMAC-SHA256). It is the only format. A Google Chat format was planned and then dropped by the user (2026-11-25): a webhook needs a receiver that reads Standard Webhooks.
- Outgoing events in the first version: `task.created`, `task.status_changed`, `task.assigned`, `task.due_date_changed`, `task.completed`, `comment.created`, `project.created`, `risk.created`.
- No note events. INTERNAL notes never leave Solvro (root Guardrails); customer-facing notes wait for a later version.
- A webhook sends only events about projects its owner can see at delivery time. When the owner loses access, deliveries for that project stop.
- Incoming: one URL per project with a secret token in its path. Any JSON that contains a Solvro task URL, for example a commit message, adds a comment with the link to that task; a fixed Solvro JSON lets scripts write a comment directly. Tasks are named by their URL (`${APP_URL}/tasks/<id>`), not by a new short reference (option (b)): no task-reference schema change.

Defaults accepted by the user, 2026-11-25:

- Private and loopback targets are refused; `WEBHOOK_ALLOW_PRIVATE_HOSTS=true` allows them for one deployment.
- Targets must be https; `WEBHOOK_ALLOW_HTTP=true` allows plain http.
- `comment.created` carries the first 500 characters of the comment. The create dialog says that a shared chat space can hold people without project access.
- The new permission `webhook:manage` gates the Settings section. The migration adds it to the built-in TAM and STAKEHOLDER roles; custom roles get it only when an admin adds it; admins have it through `*`.
- An incoming comment's author is the user who created the incoming URL, with a "via <URL name>" marker. If that user is deactivated or loses access to the project, the URL stops accepting events.

## Phase 1: outgoing webhooks

### Data model (one migration)

- `WebhookSubscription`: `id`, `ownerId` → User, `name`, `url`, `secretEnc` (sealed with `lib/secretBox.ts`), `eventTypes String[]`, `projectIds Int[]` (empty = every project the owner can see), `active`, `consecutiveFailures`, `disabledReason?`, `createdAt`, `updatedAt`. Limit: 10 per user.
- `WebhookDelivery`: `id`, `subscriptionId` (cascade), `activityEventId` (cascade), `eventType`, `status` (`pending` | `succeeded` | `failed`), `attempts`, `nextAttemptAt`, `lastStatusCode?`, `lastError?` (short, never the response body), `createdAt`. Unique on (`subscriptionId`, `activityEventId`, `eventType`), so one change that maps to two events a webhook follows sends both. Indexes on (`subscriptionId`, `id`) and `createdAt`. Index on (`status`, `nextAttemptAt`).
- `ActivityEvent.webhookDispatchedAt DateTime?` with a partial index where it is null. The migration sets it to `now()` on every existing row, so past events are never sent.
- No change to any write path: the dispatcher reads the activity log, which every write already records in the same transaction (`lib/activity.ts`). Bulk edits, duplicates and imports send events exactly when they record activity.

### Event mapping (`lib/webhooks/events.ts`)

An allow-list. Any activity row that matches no line is marked dispatched and sends nothing.

| Activity row | Webhook event |
|---|---|
| `task` `created` | `task.created`; also `task.assigned` when `changes.assignee` is set |
| `task` `updated` with `changes.status` | `task.status_changed`; also `task.completed` when the task's current status category is DONE |
| `task` `updated` with `changes.assignee` (new value not null) | `task.assigned` |
| `task` `updated` with `changes.startDate` or `changes.dueDate` | `task.due_date_changed` |
| `comment` `created` | `comment.created` |
| `project` `created` | `project.created` |
| `risk` `created` | `risk.created` |

### Payload

`data` is built at delivery time from allow-listed columns, never a whole row. A task never sends its description (same rule as the activity log's privacy invariant).

```json
{
  "type": "task.status_changed",
  "timestamp": "2026-11-25T08:00:00Z",
  "data": {
    "project": { "id": 12, "name": "Core banking migration", "url": "https://solvro.example.com/projects/12" },
    "task": { "id": 345, "title": "Cut-over rehearsal", "status": "In review", "assignee": "maya.putri", "dueDate": "2026-12-01", "url": "https://solvro.example.com/tasks/345" },
    "changes": { "status": { "from": "In progress", "to": "In review" } },
    "actor": "rizky.pratama"
  }
}
```


### Dispatcher (`lib/webhooks/dispatcher.ts`, started in `src/index.ts` like the iTop scheduler)

- Every 5 seconds: claim up to 100 undispatched activity rows with `FOR UPDATE SKIP LOCKED` (safe with more than one backend instance), map them, match active subscriptions by event type and project, create the `WebhookDelivery` rows, and set `webhookDispatchedAt`, in one transaction.
- Visibility: deliveries are created only for owners who can see the project and hold `webhook:manage` and `project:read`; before each send the same check runs again (`filterActiveUsersWhoCanSeeProject` in `lib/notifications.ts` plus the permissions). An owner who is inactive, cannot see the project, or lost `webhook:manage` or `project:read`: the delivery is marked `failed` with `owner_no_access` and never sent.
- Send: 10-second timeout, no redirects followed; the response body is never read or stored. 2xx = success.
- Retries for a network error, a timeout, 429 or 5xx: after 5 s, 5 min, 30 min, 2 h, 5 h, 10 h (7 attempts in about 18 hours), then `failed`. Any other 4xx fails at once.
- After 20 failed deliveries in a row the subscription turns inactive with `disabledReason`, and the owner sees it in Settings. Re-enabling resets the count.
- Address policy (`lib/webhooks/validateTarget.ts`): reuses `isPrivateAddress` from `lib/itop/validateBaseUrl.ts`. Checked at save time and again at each send, where the request connects to the address that was checked (a pinned lookup), so DNS rebinding cannot reach a private address. No userinfo in the URL.

### Routes (`routes/webhooks.ts`, `requireAuth` + `requirePermission("webhook:manage")`)

- `GET /webhooks`: the caller's own subscriptions. `POST /webhooks`, `PATCH /webhooks/:id`, `DELETE /webhooks/:id`: own only, 404 for another user's id.
- `POST /webhooks/:id/rotate-secret`: returns the new secret once.
- `POST /webhooks/:id/test`: sends one `webhook.test` event at once and returns the status code.
- `GET /webhooks/:id/deliveries`: the last 50 deliveries (event type, status, attempts, status code, time).
- `POST` returns the secret (`whsec_…`) once; reads never return it.
- `projectIds` on create or update must all be visible to the caller (`ensureProjectVisible` semantics, 400 on a bad id).
- Admins see only their own subscriptions. There is no cross-user view in this version.
- Activity cleanup (`lib/activityCleanup.ts`, 180 days) cascades to deliveries. Deliveries older than 30 days are also removed by the same job.

### Frontend: Settings → Integrations → Webhooks

- A list of the user's webhooks: name, target host, format, events, status (active / disabled with reason), the last delivery result.
- A create and edit dialog: name, URL, format, event checkboxes, projects (all visible, or picked). After create: the secret, shown once, with a copy button.
- Row actions: Send test, Rotate secret, Disable / Enable, Delete, Deliveries (a panel with the last 50).
- Built on existing components (`reui/` and the Settings section pattern); `docs/DESIGN.md` and antislop apply; Delivery Gate in both themes and at 375px.

### Phase 1 tasks

| Task | Content | Depends on |
|---|---|---|
| 1.1 | Migration, permission in `builtInRoles.ts`, env (`WEBHOOK_ALLOW_PRIVATE_HOSTS`, `WEBHOOK_ALLOW_HTTP`) | none |
| 1.2 | Event mapping, payload builders, signing, address policy, dispatcher, retries, auto-disable, tests | 1.1 |
| 1.3 | Routes, validation, tests | 1.1 |
| 1.4 | Settings section, dialogs, deliveries panel, `queries.ts` hooks, tests | 1.3 (API shape) |
| 1.5 | e2e spec (create, one-time secret, disable, delete, a URL with a query string shows only its host, 403 without the permission; the test-send is covered by backend tests against a local receiver), `docs/guides/webhooks.md`, `docs/CONFIGURATION.md` env rows | 1.2, 1.4 |

Wave: 1.1 first, then 1.2 ∥ 1.3 (separate files; the orchestrator mounts the router in `app.ts`), then 1.4, then 1.5.

## Phase 2: general incoming URL

Decision (user, 2026-11-25): incoming events are general, not written for one tool at a time. One URL accepts the JSON of any tool that can send a webhook (GitLab, GitHub, Gitea, Bitbucket, CI jobs, n8n, Zapier, your own scripts). There is no per-tool parser and no per-tool signature check.

### How a tool proves who it is

- The URL holds the secret: `POST ${APP_URL}/api/webhook/in/<token>`. Every tool accepts a URL, so this works everywhere. The token is 32 random bytes in base64url, stored only as its SHA-256 hash and looked up by that hash.
- An unknown token, an inactive URL and a deleted URL all get the same 404.
- The token never reaches a log: `http/requestLogger.ts` masks the path segment after `/webhook/in/`, and `frontend/nginx.conf` turns off the access log for that location (the setup.sh deployment uses the same file).
- Rotate makes a new token; the old URL stops at once.
- Optional Standard Webhooks check (user decision 2026-11-25). An incoming URL can also hold a Standard Webhooks secret (`whsec_…`, sealed with `lib/secretBox.ts`, shown once). When it has one, a request must carry a valid `webhook-id`, `webhook-timestamp` and `webhook-signature` (`v1,<base64 HMAC-SHA256 of id.timestamp.body>`, any one of the space-separated signatures may match, compared in constant time), and the timestamp must be within 5 minutes of the server clock. A request that fails the check gets 401; the path token is still required. A sender that signs this way (another Solvro server, or any Standard Webhooks library) is checked; a URL without the secret works with the path token alone. The secret can be added, rotated or removed from the dialog. The same `webhook-id` seen twice within 24 hours writes nothing the second time.

### Two modes, chosen by the body

1. **Solvro JSON.** A body with a top-level `solvro` key: `{ "solvro": { "task": 345, "text": "Deployed to prod", "url": "https://ci.example.com/run/88" } }`. `task` is a task id or a task URL; `text` is required (max 2,000 characters); `url` is optional and is added as the source link. One request writes one comment. A bad body gets 400 with a reason, so a script author can fix it.
2. **Link scanner.** Any other body. Solvro reads every string in the JSON (depth up to 20, up to 5,000 strings) and finds the task URLs `${APP_URL}/tasks/<id>`. For each task found:
   - The comment text is the first line of the string that held the URL (max 200 characters), for example a commit message or a merge request title.
   - The source link is a `url`, `html_url` or `web_url` field in the same JSON object, when there is one.
   - The comment reads `<first line> · <source link>`, with the marker "via <URL name>".
   - The answer is 200 with `{ "linked": <n> }`, also when `n` is 0, so a tool never retries a body that has no task URL.

Both modes:

- Only tasks inside the URL's project count. Any other id is ignored, so one project's URL can never write to another project. At most 20 tasks per request.
- Body types: `application/json`; `application/x-www-form-urlencoded` with a `payload` field that holds JSON (GitHub's form option); `text/plain`, scanned as one string. Max 1 MB.
- Rate limit: 60 requests a minute per URL and per address.
- The same (task, source) pair writes one comment only (`InboundHookLink`). The source is the source link, or the SHA-256 of the first line when there is no link. A re-pushed commit or a retried delivery comments once.
- The author of each comment is the user who created the URL. If that user is deactivated or cannot see the project any more, the request gets 200, writes nothing, and the URL turns inactive with a reason the project owner sees.
- A comment records `comment` `created` activity, so notifications follow the normal path.
- Without `APP_URL`, the scanner finds nothing; Solvro JSON with a numeric `task` still works.

### No loop between outgoing and incoming

An outgoing webhook pointed at an incoming URL would make each comment send a new comment. Two rules stop this:

- Outgoing `validateTarget` refuses a URL whose path starts with `/api/webhook/in/` on the `APP_URL` host.
- Outgoing webhooks do not send `comment.created` for a comment written by an incoming URL (`Comment.source` set). A relay in between cannot restart the loop.

### Data model (one migration)

- `InboundHook`: `id`, `projectId` (cascade), `createdById` → User, `name`, `tokenHash` (unique), `tokenPreview` (first 4 characters, for the list), `signingSecretEnc?` (the optional Standard Webhooks secret), `active`, `disabledReason?`, `lastReceivedAt?`, `createdAt`. Limit: 5 per project.
- `InboundHookLink`: `hookId` (cascade), `taskId` (cascade), `sourceKey`, `createdAt`; unique on (`taskId`, `sourceKey`).
- `InboundHookMessage`: `hookId` (cascade), `messageId` (the `webhook-id`), `createdAt`; unique on (`hookId`, `messageId`). Rows older than 24 hours are deleted by the activity cleanup job.
- `Comment.source String?` (`incoming`) and `Comment.inboundHookId Int?` (set null on delete), so the marker shows the URL's name.

### Routes for managing incoming URLs (`routes/inboundHooks.ts`)

- `GET /projects/:id/inbound-hooks`, `POST`, `PATCH …/:hookId` (name, active), `DELETE …/:hookId`, `POST …/:hookId/rotate-token`, `POST …/:hookId/signing-secret` (adds or rotates; returns the secret once), `DELETE …/:hookId/signing-secret`.
- Gate: `project:write` plus `ensureProjectOwnerAccess` (the project's TAM or the owner of a linked customer). `POST` and rotate return the full URL once. The list shows the name, `tokenPreview`, the last received time and the disabled reason, never the URL.

### Frontend

- Project page: an "Integrations" entry in the project's actions menu, for owners. It opens a dialog: the list of incoming URLs, Add (name only), the full URL shown once with a copy button, Rotate, Disable/Enable, Delete, and an optional "Require a Standard Webhooks signature" control that makes and shows the secret once.
- The dialog's help text is general: paste the URL into the tool's webhook settings, choose JSON, and put task links in commit messages or titles. Tool-by-tool steps (GitLab, GitHub, n8n, curl) live in the guide, not in the UI.
- Task comments from an incoming URL show "via <URL name>".

### Phase 2 tasks

| Task | Content | Depends on |
|---|---|---|
| 2.1 | Migration, `Comment.source` and `inboundHookId` in the comment DTOs, the outgoing loop rules | Phase 1 merged |
| 2.2 | Incoming route: token lookup, optional Standard Webhooks check (reuse `lib/webhooks/sign.ts`), body types, Solvro JSON mode, scanner, comment writer, dedup, logger and nginx masking, tests with GitLab, GitHub, plain and signed fixtures | 2.1 |
| 2.3 | Management routes, tests | 2.1 |
| 2.4 | Project dialog, comment marker, tests | 2.3 |
| 2.5 | e2e spec (create a URL, post a push fixture and a Solvro JSON body, see both comments), guide section, `backend/CLAUDE.md` public-surface line | 2.2, 2.4 |

Wave: 2.1 first, then 2.2 ∥ 2.3, then 2.4, then 2.5.

## Spine and review

- Spine touches: `schema.prisma` + migrations (both phases), env (`src/env.ts`, Phase 1), `nginx.conf` (Phase 2 log masking), `lib/queries.ts` (frontend hooks, both phases). Each needs the instant review; the phase review covers the rest.
- `lib/visibility.ts` does not change. The dispatcher reuses `filterActiveUsersWhoCanSeeProject`, which the parity test in `test/notifications.test.ts` already covers.
- Guardrail check: no export of INTERNAL notes (no note events, no note data in any payload).

## Out of scope for this version

- Note events, customer-facing or not.
- Per-tool parsers and per-tool signature checks for incoming events (a comment such as "Commit a1b2c3d by Maya" needs one; the scanner writes the first line and the link instead).
- Incoming actions other than a comment (status change, new task).
- Short task references (`SOL-123`).
- An admin view of all users' webhooks.
- Slack or Microsoft Teams formats.

## Phase 2 record

- Reviews: an instant review of the schema and migration (2 should-fix, 2 nits, all fixed), then one phase review (1 blocker: focus loss and inline destructive confirms in the Integrations dialog; 6 should-fix; 7 nits). All fixed except the deferred ISS-223 (loop check with an `APP_URL` path prefix). A re-check found nothing left.
- Changes from the plan made during review: rotating a URL, setting its signing secret or enabling it makes the caller the author of later comments; the author check also needs `task:comment`; disabled reasons are codes (`creator_inactive`, `creator_lost_access`, `creator_lost_permission`); a cap of 100 comments per request; the 20-task cap counts only the URL's own project.
- Delivery Gate: PASS (2026-11-25), light and dark, 1280px and 375px. Checked: the Integrations dialog list, the one-time URL panel with focus on its copy button, the Rotate confirm (Escape closes only the confirm), the limit error with focus back on the Name input, no horizontal overflow, and a task comment showing "via GitLab". One FAIL during the gate (focus lost after a failed Add) was fixed and covered by a test.
