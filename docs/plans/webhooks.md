# Webhooks: outgoing events and GitLab incoming links (GitHub #166)

Status: planned (written 2026-11-25 @ `259fd0a`)
Archive path: `docs/archive/plans/webhooks.md`

Lane: P (new models and migrations, new routes, a new signed unauthenticated route, a new Settings section). Two phases, each its own branch and PR: **Phase 1** outgoing webhooks, **Phase 2** GitLab incoming links. Phase 2 starts after Phase 1 merges; the two never carry a migration at the same time.

## Decisions (user, 2026-11-25)

- Both directions: Solvro sends events to other tools, and Solvro receives GitLab events.
- Outgoing format: [Standard Webhooks](https://www.standardwebhooks.com/) (JSON body `{ type, timestamp, data }`, headers `webhook-id`, `webhook-timestamp`, `webhook-signature`, HMAC-SHA256). A second format, **Google Chat**, sends `{ "text": "..." }` with no signature, because Google Chat cannot read the standard body.
- Outgoing events in the first version: `task.created`, `task.status_changed`, `task.assigned`, `task.due_date_changed`, `task.completed`, `comment.created`, `project.created`, `risk.created`.
- No note events. INTERNAL notes never leave Solvro (root Guardrails); customer-facing notes wait for a later version.
- A webhook sends only events about projects its owner can see at delivery time. When the owner loses access, deliveries for that project stop.
- Incoming: one URL per project with a secret token. A GitLab commit or merge request that contains a Solvro task URL adds a comment with the link to that task. Tasks are named by their URL (`${APP_URL}/tasks/<id>`), not by a new short reference (option (b)): no task-reference schema change.

## Questions for the user

Each has a default the plan uses if the user does not choose otherwise.

1. **Private addresses.** May a webhook target a LAN or loopback address (a custom app on the same network)? Default: refused, switched on per deployment with `WEBHOOK_ALLOW_PRIVATE_HOSTS=true` (the iTop setting defaults the other way because iTop shares the LAN).
2. **Plain http.** Default: https only, switched on with `WEBHOOK_ALLOW_HTTP=true`.
3. **Comment text.** Does `comment.created` carry the comment text? Default: yes, the first 500 characters. A Google Chat space can hold people without project access, so the create dialog says this.
4. **Who gets the permission.** The new permission `webhook:manage` gates the Settings section. Default: the migration adds it to the built-in TAM and STAKEHOLDER roles (so all users have it, as the issue asks); custom roles get it only when an admin adds it; admins have it through `*`.
5. **Incoming comment author.** A GitLab comment needs a Solvro author. Default: the user who created the incoming URL, with a "via GitLab" marker on the comment. If that user is deactivated or loses access to the project, the URL stops accepting events.

## Phase 1: outgoing webhooks

### Data model (one migration)

- `WebhookSubscription`: `id`, `ownerId` → User, `name`, `url`, `format` (`standard` | `google_chat`), `secretEnc` (sealed with `lib/secretBox.ts`, `null` for Google Chat), `eventTypes String[]`, `projectIds Int[]` (empty = every project the owner can see), `active`, `consecutiveFailures`, `disabledReason?`, `createdAt`, `updatedAt`. Limit: 10 per user.
- `WebhookDelivery`: `id`, `subscriptionId` (cascade), `activityEventId` (cascade), `eventType`, `status` (`pending` | `succeeded` | `failed`), `attempts`, `nextAttemptAt`, `lastStatusCode?`, `lastError?` (short, never the response body), `createdAt`. Unique on (`subscriptionId`, `activityEventId`). Index on (`status`, `nextAttemptAt`).
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

Google Chat gets one line built from the same data, for example `rizky.pratama moved "Cut-over rehearsal" to In review · Core banking migration · <url>`.

### Dispatcher (`lib/webhooks/dispatcher.ts`, started in `src/index.ts` like the iTop scheduler)

- Every 5 seconds: claim up to 100 undispatched activity rows with `FOR UPDATE SKIP LOCKED` (safe with more than one backend instance), map them, match active subscriptions by event type and project, create the `WebhookDelivery` rows, and set `webhookDispatchedAt`, in one transaction.
- Visibility: before each send, `filterActiveUsersWhoCanSeeProject` (`lib/notifications.ts`) on the owner. An owner who is inactive or cannot see the project: the delivery is marked `failed` with `owner_no_access` and never sent.
- Send: 10-second timeout, no redirects followed, response body read only up to 1 KB and never stored. 2xx = success.
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
| 1.5 | e2e spec (create, test-send to a local receiver, disable), `docs/guides/webhooks.md`, `docs/CONFIGURATION.md` env rows | 1.2, 1.4 |

Wave: 1.1 first, then 1.2 ∥ 1.3 (separate files; the orchestrator mounts the router in `app.ts`), then 1.4, then 1.5.

## Phase 2: GitLab incoming links

### Data model (one migration)

- `InboundHook`: `id`, `projectId` (cascade), `createdById` → User, `provider` (`gitlab`), `tokenHash` (SHA-256 of the secret; GitLab sends it in plain in `X-Gitlab-Token`, compared in constant time), `active`, `lastReceivedAt?`, `createdAt`.
- `InboundHookLink`: (`taskId`, `externalUrl`) unique, so a re-pushed commit or a re-opened merge request comments once.
- `Comment.source String?` (`gitlab`), shown as a "via GitLab" marker.

### Route: `POST /webhook/gitlab/:hookId` (`routes/webhook.ts`)

- A signed webhook like the iTop and Outline ones: mounted before `express.json()`, its own raw body limit (1 MB), rate-limited per address and per hook, refused without a valid token. Unknown hook, inactive hook and wrong token all get the same answer.
- `X-Gitlab-Token` is added to the header masking in `http/requestLogger.ts`.
- `backend/CLAUDE.md` "Public (unauthenticated) surface" lists this route as the third signed-webhook exception.
- Handles `Push Hook` (each `commits[].message` and `url`) and `Merge Request Hook` (`object_attributes.title`, `description`, `url`, actions `open`, `reopen`, `merge`). Every other event type answers 200 and does nothing.
- Finds task URLs that start with `${APP_URL}/tasks/`. Only tasks inside the hook's project count; any other id is ignored, so one project's URL can never write to another project. At most 20 tasks per delivery.
- For each new (task, URL) pair: a comment by the hook's creator with `source: "gitlab"`, for example `Commit a1b2c3d by Maya Putri: Fix cut-over script · <url>` or `Merge request !42 merged: <title> · <url>`. It records `comment` `created` activity, so notifications and outgoing webhooks follow the normal path.
- If the creator is inactive or cannot see the project, the hook answers 200, writes nothing, and turns inactive with a reason the project owner sees.
- Without `APP_URL` the route answers 404 (task URLs cannot be recognised).

### Routes for managing incoming URLs (`routes/inboundHooks.ts`)

- `GET /projects/:id/inbound-hooks`, `POST`, `DELETE /projects/:id/inbound-hooks/:hookId`, `POST …/rotate-token`.
- Gate: `project:write` plus `ensureProjectOwnerAccess` (the project's TAM or the owner of a linked customer). `POST` and rotate return the URL and the token once.

### Frontend

- Project page: an "Integrations" entry in the project's actions menu, for owners. It opens a dialog with the GitLab URL, a token shown once, setup steps (GitLab → Settings → Webhooks, events "Push" and "Merge request"), the last received time, and Rotate / Delete.
- Task comments show "via GitLab" on comments with that source.

### Phase 2 tasks

| Task | Content | Depends on |
|---|---|---|
| 2.1 | Migration, `Comment.source` in the comment DTOs | Phase 1 merged |
| 2.2 | Incoming route, parser, comment writer, logger masking, tests | 2.1 |
| 2.3 | Management routes, tests | 2.1 |
| 2.4 | Project dialog, comment marker, tests | 2.3 |
| 2.5 | e2e spec (create URL, post a GitLab push fixture, see the comment), guide section, `backend/CLAUDE.md` public-surface line | 2.2, 2.4 |

Wave: 2.1 first, then 2.2 ∥ 2.3, then 2.4, then 2.5.

## Spine and review

- Spine touches: `schema.prisma` + migrations (both phases), env (`src/env.ts`, Phase 1), `lib/queries.ts` (frontend hooks, both phases). Each needs the instant review; the phase review covers the rest.
- `lib/visibility.ts` does not change. The dispatcher reuses `filterActiveUsersWhoCanSeeProject`, which the parity test in `test/notifications.test.ts` already covers.
- Guardrail check: no export of INTERNAL notes (no note events, no note data in any payload).

## Out of scope for this version

- Note events, customer-facing or not.
- GitHub, Jira or other incoming providers (the `provider` column leaves room).
- Short task references (`SOL-123`).
- An admin view of all users' webhooks.
- Slack or Microsoft Teams formats.
