# iTop Integration — Plan

**Shipped** across PRs #2–#8 on `develop`, 2026-09-22 → 2026-09-23. Decisions
are in §1 below; deviations from the original proposal are in §2; deferred
findings live in `docs/ISSUES.md` (the "iTop integration Phase N — deferred
findings" sections).

Status: **decisions confirmed 2026-09-22 (user)**; code starts after PR `feat/remove-pipeline-module` merges into `develop` (user sequencing decision, 2026-09-22).
Source proposal: `docs/archive/plans/itop-integration-spec.md` (extract of the "iTop in Solvro" artifact, v2, 2026-09-12).
Branches: one per phase, off up-to-date `origin/develop`: `feat/itop-p1-tickets`, `feat/itop-p2-daily-review`, `feat/itop-p3-utilization`, `feat/itop-p4-webhook-taskref`, `feat/itop-p5-write-path`, `feat/itop-p6-board`, `feat/itop-p7-timer`. Phase = branch = PR; task = commit.

## 1. Decisions (settled — do not re-litigate)

| # | Question (spec §Unknowns) | Answer |
|---|---|---|
| 1 | Option | **Option 1 + Option 2.** Phases 1–4 first, Phases 5–7 follow with no rework. |
| 2 | iTop version | **3.2.1 or later.** Token auth (`Auth-Token`). No password fallback. |
| 3 | Time Tracking extension | **Installed, TAMs log time already.** Phase 3 ships with real data. |
| 4 | Ticket agents | **TAMs are the agents.** "Mine" filter is primary; TAMs may assign/pending/resolve. |
| 5 | Org names vs customer names | **Few or none match.** Auto-match still runs; the admin maps every customer once. |
| 6 | Who sees other TAMs' hours | `report:executive` permission holders (spec default 3). No new permission string. |
| 7 | Ticket classes | **UserRequest + Incident only.** |
| 8 | Write identity | **Per TAM**, personal token in Settings (spec default 6). |
| 9 | Project tasks | **Stay in Solvro** (spec default 8). A task may pin one ticket ref and may create a ticket. |
| 10 | Lifecycle rules (spec item 10) | **iTop defaults** (user, 2026-09-23): assign needs team + agent; pending needs nothing; resolve needs resolution code + solution; close and reopen need nothing. |
| 11 | Token ownership | **Writes only under the acting user's own token** (user, 2026-09-23): a pasted personal token is accepted only when it resolves to the iTop person with the same email as the Solvro user; no fallback to the application token or another user's token, ever. |

All 8 spec defaults accepted: read-only app token; 5-minute snapshot + Refresh; Work Logs → Utilization after Weekly Sync; tickets on the customer, not the project; 40 h/week capacity, one Admin number; per-TAM tokens; no optimistic writes, nothing queued; tasks never become tickets.

## 2. Deviations from the proposal (planner assumptions — flag if wrong)

1. **Org mapping lives on `Customer`** (`itopOrgId`, `itopOrgName`) instead of a separate `itop_org_map` table. One customer ↔ one org; a join table adds nothing.
2. **"Test connection" reports probes, not "iTop 3.2.1 · profiles".** The REST API has no version/whoami call. The probe runs `list_operations`, then `core/get` with `limit: 1` on `Organization`, `UserRequest`, `Incident`, `Person`, `TimeSpent`. Each probe passes or shows iTop's error. `TimeSpent` failing = extension missing.
3. **Personal-token expiry is shown only if iTop returns it.** Token validation = `core/get Person WHERE email = <user email>` with the personal token. Expiry read is attempted, not promised.
4. **Admin iTop endpoints live in a new router** `backend/src/routes/itopAdmin.ts` mounted at `/admin/itop`, not inside `routes/admin.ts` (spine file; keep it small).
5. **Daily Review strip has its own endpoint** `GET /itop/daily?date=` instead of growing the `dailyReview.ts` payload.
6. **Webhook**: the cancelled standing decision covers `POST /webhook/blueprint` (SA-blueprint ingestion) only. `POST /webhook/itop` is a sync nudge with no payload trust: it triggers a normal pull. It is the first unauthenticated non-health route; it carries a shared secret and a rate limit.
7. **Scheduler is in-process** (`setInterval` started from `index.ts`), guarded by a Postgres advisory lock so a second backend instance cannot double-sync. `setup.sh` deploys one backend container; this is enough.
8. **Snapshot freshness**: incremental pull by `last_update` every N minutes; a full pull per org once per 24 h and on manual Refresh, which also drops tickets iTop no longer returns.
9. **Utilization API is its own router** (`backend/src/routes/utilization.ts`, mounted at `/utilization`) rather than a route in `routes/itop.ts`, for the same reason as deviation 4. "Today"/"this week" windows on external iTop instants follow the viewer's local day via a `utcOffsetMinutes` query param (user decision 2026-09-22); the Solvro-picked `date`/`week` strings still follow the UTC-midnight date contract.
10. **Ticket ref format** is `^[A-Z]{1,3}-\d{4,8}$` (not the narrower `^[A-Z]-\d{6}$` written in Task 4.2): iTop's ref pattern is install-configurable (`R-004512`, `I-000123`, `TKT-123456`). Do not re-narrow it. A duplicated task never carries the ref (one ticket, one task by default); tasks cannot be created with a ref pre-set — pin it after creation.
11. **Board lifecycle graph** (2026-09-23): `new → assigned` = `ev_assign` (assign to me), `assigned → pending` = `ev_pending`, `assigned|pending → resolved` = `ev_resolve` (sheet), `resolved → closed` = `ev_close`, `resolved → assigned` = `ev_reopen`. There is no `pending → assigned` move: iTop's default lifecycle has no `ev_assign` from pending, and `ev_reassign` is out of scope. Escalated and approval states are folded into the Assigned column; iTop's refusal text is shown if a step is not allowed there. Forbidden drops are refused client-side (dimmed columns, inline message) — the vendored engine has no per-column drop veto without a vendored patch, which we do not make.

## 3. Architecture

```
iTop REST (rest.php?version=1.3, Auth-Token)
   ▲ pull (app token)            ▲ write (TAM token, Phase 5+)
backend/src/lib/itop/client.ts   ── one client, injectable fetch, ItopError{code,message}
backend/src/lib/itop/sync.ts     ── tickets (P1), time entries (P3); upsert snapshot tables
backend/src/lib/itop/scheduler.ts── setInterval + pg advisory lock; manual trigger (Refresh, webhook)
backend/src/lib/secretBox.ts     ── AES-256-GCM, key = env SECRETS_KEY; app token, webhook secret, TAM tokens
Postgres snapshot: ItopConfig (singleton), ItopTicket, ItopTimeEntry; Customer.itopOrg*, User.itopPerson*/itopUser*/itopToken*
routes: itopAdmin.ts (/admin/itop), itop.ts (/itop, /customers/:id/tickets), webhook.ts (/webhook/itop), users.ts (/users/me/itop-token)
frontend: components/itop/*, pages/Utilization.tsx, Admin iTop tab, Settings iTop section; hooks in lib/queries.ts
```

Schema (Prisma, snake_case `@map`; all new tables prefixed `itop_`):

- `ItopConfig { id "default", baseUrl?, appTokenEnc?, webhookSecretEnc?, refreshMinutes 5, readClasses String[] ["UserRequest","Incident"], capacityHoursPerWeek 40, actionsEnabled false, lastSyncAt?, lastSyncOk?, lastSyncError?, lastFullSyncAt?, updatedAt, updatedById? }` — copy of the `AuthConfig` singleton pattern (`schema.prisma:117-129`, `routes/admin.ts:437-525`).
- `Customer` + `itopOrgId Int? @unique`, `itopOrgName String?`.
- `User` + `itopPersonId Int? @unique`, `itopUserId Int? @unique` (P1), `itopTokenEnc String?`, `itopTokenCheckedAt?`, `itopTokenExpiresAt?`, `itopPersonName?` (P5).
- `ItopTicket { id Int @id (iTop key), class, ref @unique, title, status, operationalStatus, priority, agentPersonId?, agentName?, teamName?, serviceName?, callerName?, orgId, customerId? FK, startDate, lastUpdate, tto?, ttr?, slaTtoPassed, slaTtrPassed, resolutionDate?, publicLog Json? (P5), privateLog Json? (P5), syncedAt }` — indexes `customerId`, `status`, `lastUpdate`, `agentPersonId`.
- `ItopTimeEntry { id Int @id, itopUserId, userId? FK, orgId?, customerId? FK, ticketId? FK, ticketRef?, startDate, endDate, durationMinutes, title?, syncedAt }` — indexes `(userId, startDate)`, `(customerId, startDate)` (P3).
- `Task` + `itopTicketRef String?` (P4).

Join rules: customer ↔ org by `itopOrgId` (admin-mapped, exact-name auto-match first); user ↔ agent by `Person.email = User.email` → `itopPersonId`; user ↔ time entry by `User.email` (iTop `User.contactid → Person.email`) → `itopUserId`. Email mismatch = no "Mine", no hours, shown in the Admin match report.

Security: tokens never leave the backend; `GET` config returns `appTokenSet: true|false`, never the token. Webhook secret compared with `crypto.timingSafeEqual`. All `/itop` reads reuse `ensureCustomerVisible` / `customerVisibilityFilter` (`lib/visibility.ts`). Writes (P5+) require `ItopConfig.actionsEnabled` and the acting user's own token; Solvro adds no permission of its own for tickets.

Testing: a fake iTop (`backend/test/itop/fakeItop.ts`, Express, in-memory objects, speaks `rest.php` `core/get|create|update|apply_stimulus|list_operations`) drives backend vitest and, via `scripts/fake-itop.ts` on port 8484, manual dev-stack checks. Playwright specs intercept `/api/itop/*` and `/api/customers/*/tickets`.

## 4. Phases and tasks

Sizes: S 1–2 files, M 3–5, L 5–8. Every task: scoped typecheck + the tests it touched; the orchestrator runs `gates.sh` once per wave. Each task reports its CHANGELOG entry text. Spine touches (schema/migrations, `setup.sh`/env, `routes/tasks.ts`, `lib/queries.ts`, vendored `reui/`) get an instant review.

### Phase 1 — Connection, snapshot, Tickets tab (`feat/itop-p1-tickets`)

**Task 1.1 Secrets at rest.** `backend/src/lib/secretBox.ts` (`seal(plain): string`, `open(sealed): string`, AES-256-GCM, random IV, versioned prefix `v1:`), `SECRETS_KEY` (32-byte base64) in `env.ts`, `.env.example`, `docs/CONFIGURATION.md`; `setup.sh` generates it once. Tests: roundtrip, tampered ciphertext throws, wrong key throws.
Acceptance: `open(seal(x)) === x`; backend refuses to boot without a valid key. Deps: none. Files: 5. Size M. Spine: env/`setup.sh`.

**Task 1.2 Schema: config + mapping + ticket snapshot.** `ItopConfig`, `Customer.itopOrg*`, `User.itopPersonId/itopUserId`, `ItopTicket` (without log columns). Migration `itop_snapshot`. Seed untouched.
Acceptance: `prisma migrate dev` clean on dev and `_test`; `tsc` green. Deps: none. Files: 2. Size S. Spine: schema.

**Task 1.3 iTop client + fake iTop.** `backend/src/lib/itop/client.ts` (`createItopClient({baseUrl, token, fetchImpl?})` → `get(class, oql, fields, {limit,page})`, `listOperations()`, `probe()`; 15 s timeout; iTop `code !== 0` → `ItopError`), `types.ts` (ticket/org/person/time field unions), `backend/test/itop/fakeItop.ts`, `scripts/fake-itop.ts`. Tests: paging, error mapping, timeout.
Acceptance: client reads all pages of 250 fake tickets; iTop error text reaches `ItopError.message`. Deps: none. Files: 5. Size M.

**Task 1.4 Sync + scheduler.** `lib/itop/sync.ts` (`syncTickets({full})`: mapped orgs → paged OQL per class → upsert `ItopTicket`, resolve `agent_id_friendlyname`/`agent_id` → `User.itopPersonId`; incremental by `last_update > lastSyncAt − 60 s`; full = drop rows not returned; writes `lastSync*`), `lib/itop/scheduler.ts` (`start()` from `index.ts` unless `NODE_ENV=test` or `ITOP_SYNC_DISABLED=1`; `pg_try_advisory_lock(hashtext('itop_sync'))`; `requestSync()` debounced 10 s for Refresh/webhook). Tests against fake iTop: first full pull, incremental update, removed ticket dropped on full, lock skips a concurrent run.
Acceptance: two `syncTickets` calls in parallel → one runs; snapshot matches fake after each scenario. Deps: 1.2, 1.3. Files: 4 + `index.ts`. Size M.

**Task 1.5 Admin API.** `routes/itopAdmin.ts` (`requireAuth, requireAdmin`): `GET/PATCH /admin/itop/settings` (token write-only, `bust` cache), `POST /admin/itop/test` (probes), `POST /admin/itop/sync` (`full: true`), `GET /admin/itop/organizations` (live from iTop, name+id), `POST /admin/itop/customers/automatch` (exact name, case-insensitive, unmapped customers only), `PATCH /admin/itop/customers/:id` (`{itopOrgId|null}`), `GET /admin/itop/persons` (match report: users with/without an iTop person, by email). Mount in `app.ts`. Tests: each route, token never echoed, non-admin 403.
Acceptance: after PATCH + test, response lists 5 probes with pass/fail; automatch maps only exact names. Deps: 1.1, 1.2, 1.3 (1.4 for `/sync`). Files: 3 + tests. Size M.

**Task 1.6 Admin UI: iTop tab.** `Admin.tsx` `TAB_ITEMS` + `components/admin/ItopTab.tsx` (Connection card: URL, token, Test with probe list, refresh minutes, capacity, "Actions from Solvro" switch disabled until P5; Customers → organisations table with org picker + Automatch; Users → persons match report). Hooks under `adminQueryKeys` in `lib/queries.ts`.
Acceptance: unmatched customer shows a picker; saving maps it and the row reads "manual". Deps: 1.5. Files: 3. Size M. Spine: `lib/queries.ts`.

**Task 1.7 Tickets API.** `routes/itop.ts` (`requireAuth`): `GET /customers/:id/tickets?scope=ongoing|resolved_week|mine&class=UserRequest|Incident` via `ensureCustomerVisible`, returns rows + counts per scope + `syncedAt`; `POST /itop/refresh` → `requestSync()`; `GET /itop/status` (`configured`, `lastSyncAt`, `baseUrl` for links). Mount in `app.ts`. Tests: visibility 404, counts, mine by `itopPersonId`.
Acceptance: a user without customer visibility gets 404; counts equal row filters. Deps: 1.4. Files: 2 + tests. Size S.

**Task 1.8 Customer Tickets tab.** `CustomerDetail.tsx` adds tab `tickets` (only when `customer.itopOrgId`; header shows mapped org), `components/itop/TicketsTab.tsx`, `TicketsTable.tsx`, `TicketFilters.tsx` (count chips), `SyncedAgo.tsx` (age + Refresh), row link "Open in iTop ↗" (`${baseUrl}/pages/UI.php?operation=details&class=${class}&id=${id}`). Blue "from iTop" marker per `docs/DESIGN.md`. Hooks in `lib/queries.ts` (`queryKeys.customerTickets(id, scope, cls)`, `staleTime 30 s`, `refetchInterval 60 s` while the tab is visible). Playwright spec with intercepted API.
Acceptance: 375 px usable; tab absent for an unmapped customer; Refresh calls `/itop/refresh` and re-fetches. Deps: 1.6 (tab primitive reuse), 1.7. Files: 6. Size L → split UI (1.8a table+filters) and wiring (1.8b tab+hooks+e2e) at dispatch.

Waves: W1 = 1.1 ∥ 1.2 ∥ 1.3 · W2 = 1.4 ∥ 1.5 · W3 = 1.6 ∥ 1.7 · W4 = 1.8a ∥ 1.8b.
Checkpoint P1: gates green; dev stack + `scripts/fake-itop.ts`: admin maps 2 customers, sync runs, Tickets tab shows rows, "Mine" works for a user whose email exists in the fake. Docs-keeper triggers: env, `setup.sh`, `docs/CONFIGURATION.md`.

### Phase 2 — Daily Review strip (`feat/itop-p2-daily-review`)

**Task 2.1 Daily API.** `GET /itop/daily?date=YYYY-MM-DD` in `routes/itop.ts`: per visible customer (`customerVisibilityFilter`) → `{ newToday, resolvedToday, slaBreached, ongoing, recent: 3 tickets by lastUpdate, syncedAt }`. Day boundaries follow the date contract (`lib/dateField.ts`, UTC midnight decision `docs/plans/date-contract-utc-midnight.md`). Tests.
Acceptance: counts match fixtures across the day boundary. Deps: P1. Files: 1 + test. Size S.

**Task 2.2 Strip UI + Add to note.** `components/itop/DailyItopStrip.tsx` rendered in `daily-review/CustomerGroup.tsx` on the operations card (above `OperationsCard`); "Add to note" appends `"<ref> <title>"` to the day's operations note draft (extend `WeekNotesEditor`/`OperationsCard` with an `appendText(text)` handle; writes nothing to iTop). Hook `useItopDaily(date)`. Playwright spec.
Acceptance: clicking Add to note puts the ref in the note editor; saving persists via the existing note mutation. Deps: 2.1. Files: 4. Size M.

Checkpoint P2: gates green; Daily Review shows the strip only for mapped customers.

### Phase 3 — Utilization (`feat/itop-p3-utilization`)

**Task 3.1 Time entries in sync.** Schema `ItopTimeEntry` (migration `itop_time_entries`); `sync.ts` adds `syncTimeEntries()`: resolve `User.itopUserId` (`SELECT User WHERE contactid->email IN (...)`), pull `TimeSpent WHERE user_id IN (...) AND start_date >= now − 8 weeks`, upsert with ticket/org/customer links. Fake iTop gains `TimeSpent` + `User`. Tests.
Acceptance: entries land with `userId` and `customerId` set when emails/orgs are mapped, null otherwise. Deps: P1. Files: 4. Size M. Spine: schema.

**Task 3.2 Utilization API.** `GET /utilization?week=YYYY-Www&scope=me|tam|customer` in `routes/itop.ts`: `me` for anyone; `tam`/`customer` need `report:executive`; returns tiles (hours, capacity from `ItopConfig`, customers touched, unassigned hours) + matrix rows (customer or TAM × Mon–Sun + total + ticket refs). Tests: permission gate, week math, "No customer" row.
Acceptance: non-executive requesting `scope=tam` gets 403; totals sum. Deps: 3.1. Files: 1 + test. Size S.

**Task 3.3 Utilization page.** Rename `pages/WorkLogs.tsx` → `pages/Utilization.tsx`; route `/utilization`; `/work-logs` → `<Navigate to="/utilization" replace />`; `NAV_COMMANDS` entry after Weekly Sync (no `requires`); update `navCommands.test.ts`; week switcher (`?week=`), Me / By TAM / By customer (last two gated by `hasPermission(user,"report:executive")`), tiles, matrix, "Source · iTop Time Tracking · synced". Hook `useUtilization(week, scope)`. Playwright spec. README line 268 + `docs/ISSUES.md:220` updated; root `CLAUDE.md` WorkLogs standing decision retired (docs-keeper).
Acceptance: `/work-logs` redirects; a TAM sees only Me; an executive sees three tabs. Deps: 3.2. Files: 6. Size L → split page (3.3a) and nav/route/docs (3.3b).

Checkpoint P3: gates green; docs-keeper (CLAUDE.md standing decision, ISSUES.md).

### Phase 4 — Webhook nudge + task ticket ref (`feat/itop-p4-webhook-taskref`)

**Task 4.1 Webhook.** `routes/webhook.ts` `POST /webhook/itop` (no `requireAuth`): header `X-Solvro-Webhook-Secret` vs `ItopConfig.webhookSecretEnc` (`timingSafeEqual`), body ignored, replies 202, calls `requestSync()`; 429 above 6 req/min; 404 when no secret configured. Admin: "Generate webhook secret" (shown once) + the iTop-side URL in `ItopTab.tsx`; `GET/PATCH /admin/itop/settings` extended. Tests: wrong secret 401, rate limit, sync requested.
Acceptance: valid call → sync within 10 s in fake-iTop dev check. Deps: P1. Files: 4. Size M. Note in `docs/CONFIGURATION.md` (iTop Webhook extension trigger "on ticket update").

**Task 4.2 Task ticket ref.** `Task.itopTicketRef String?` (migration `task_itop_ticket_ref`); `routes/tasks.ts` PATCH accepts it (validated `^[A-Z]-\d{6}$`); `GET /itop/tickets/by-ref/:ref` (visibility via the ticket's customer); `TaskPanel.tsx` field "iTop ticket" + chip (status from snapshot, link). Hooks in `lib/queries.ts` with the existing optimistic task-update pattern. Tests + e2e.
Acceptance: an unknown ref saves and shows "not in snapshot"; a known ref shows status. Deps: P1. Files: 5. Size M. Spine: schema, `routes/tasks.ts`, `lib/queries.ts`.

Waves: 4.1 ∥ 4.2. Checkpoint P4: gates green. Option 1 complete.

### Phase 5 — Personal tokens + write path (`feat/itop-p5-write-path`)

**Task 5.1 Token storage + check.** Schema `User.itopToken*`, `itopPersonName` (migration `user_itop_token`); `routes/users.ts` (or existing me-router): `PUT /users/me/itop-token` (validates by `core/get Person WHERE email = <me>` with that token; stores sealed; saves person name; reads expiry if `PersonalToken` is readable), `GET /users/me/itop-token` → `{ set, valid, personName, expiresAt?, checkedAt }`, `DELETE`. Tests with fake iTop tokens.
Acceptance: invalid token → 400 with iTop's message, nothing stored. Deps: P1. Files: 3 + test. Size M. Spine: schema.

**Task 5.2 Settings section + Admin switch.** `Settings.tsx` "iTop" section (paste, Save, Remove, status line); `ItopTab.tsx` enables "Actions from Solvro" (`actionsEnabled`). Hooks.
Acceptance: with no token the section says writes are read-only for this user. Deps: 5.1. Files: 3. Size S.

**Task 5.3 Action API.** Sync reads `public_log`, `private_log` into `ItopTicket` (migration `itop_ticket_logs`). `routes/itop.ts`: `POST /itop/tickets/:id/actions` `{ action: assign_to_me|pending|resolve|close|reopen, fields }` → per-action stimulus map (`ev_assign` with `team_id`+`agent_id` = user's team/person, `ev_pending` `pending_reason`, `ev_resolve` `resolution_code`+`solution`, `ev_close`, `ev_reopen`) via `apply_stimulus` with the user's token; then `core/get` that ticket and upsert; iTop refusal → 409 `{ code: "itop_refused", message }`; no token → 403 `itop_token_missing`; `actionsEnabled` false → 404. `POST /itop/tickets/:id/log` `{ visibility: public|private, text }` via `core/update`. Tests: each action on fake iTop incl. refusal passthrough; snapshot updated only from iTop's answer.
Acceptance: after resolve, the row shows iTop's status, not a client guess. Deps: 5.1. Files: 4 + tests. Size M. Spine: schema.

**Task 5.4 Ticket panel.** `components/itop/TicketPanel.tsx` (`?ticket=<id>` on the Tickets tab, facts, public/private log, add entry, buttons Pending / Resolve / Reassign(assign to me) / Open in iTop, "writes as <email>" footer, read-only banner without token), `ActionSheet.tsx` (pending reason; resolution code + solution). Mutations: no `onMutate`; `onSuccess` sets the returned ticket; error toast shows iTop's message. Playwright spec.
Acceptance: Resolve opens the sheet; a refused action leaves the panel unchanged and shows the message. Deps: 5.2, 5.3. Files: 4. Size M.

Waves: W1 = 5.1 · W2 = 5.2 ∥ 5.3 · W3 = 5.4. Checkpoint P5: gates green; instant review on 5.1/5.3 schema.

### Phase 6 — Board + sheets (`feat/itop-p6-board`)

**Task 6.1 Board.** `components/itop/board/boardAdapter.ts` (pure: tickets → columns `new, assigned, pending, resolved, closed`; escalation as chip, never a column), `dropMapper.ts` (drop → action or `null` for forbidden steps; allowed graph from iTop's default UserRequest/Incident lifecycle, per install item 10), `TicketBoard.tsx` on vendored `reui/kanban` (never `kanban-v2/adapter.ts`, which is task-specific), view switch Table/Board on the Tickets tab (`?view=board`). No optimistic move: the card moves only on the action's success; on failure it stays and the sheet shows the message. Unit tests for both pure modules; Playwright drag smoke.
Acceptance: dragging to a forbidden column is not a drop target; resolve drag opens the sheet from 5.4. Deps: P5. Files: 6. Size L → split pure modules (6.1a) and UI (6.1b).

**Task 6.2 New ticket.** `GET /itop/services`, `GET /itop/contacts?customerId=` (callers of the org), `POST /itop/tickets` `{ customerId, class, title, description, callerId, serviceId }` via `core/create` with the user's token, then upsert. `NewTicketSheet.tsx` from the Tickets tab. Tests.
Acceptance: created ticket appears in the table with iTop's ref. Deps: P5. Files: 4. Size M.

**Task 6.3 Daily strip actions.** "Assign to me" and "Resolve" on `DailyItopStrip.tsx` rows, reusing 5.3 mutations and 5.4 sheet.
Acceptance: same behaviour as the panel. Deps: 5.4. Files: 1. Size S.

Waves: 6.1a ∥ 6.2 · then 6.1b ∥ 6.3. Checkpoint P6: gates green; design review of the board against `docs/DESIGN.md`.

### Phase 7 — Timer + task-to-ticket (`feat/itop-p7-timer`)

**Task 7.1 Timer.** `POST /itop/tickets/:id/time` `{ startedAt, endedAt, title? }` → `core/create TimeSpent { user_id: me.itopUserId, org_id, start_date, end_date, title: ref }` with the user's token; upsert into `ItopTimeEntry`. Frontend: `useTicketTimer(ticketId)` (one running timer per user, persisted in `localStorage["solvro.itopTimer"]`), Start/Stop on the panel, "x h this week on this ticket" from the snapshot. Tests.
Acceptance: Stop creates one entry; Utilization shows it after the next sync or at once from the upsert. Deps: P5, P3. Files: 4. Size M.

**Task 7.2 Create ticket from a task.** `TaskPanel.tsx` "Create iTop ticket" (customer of the task's project must be mapped) → `NewTicketSheet` prefilled (title, description) → on success PATCH `Task.itopTicketRef`. No new backend route.
Acceptance: the task chip from 4.2 shows the new ticket's status. Deps: 6.2, 4.2. Files: 2. Size S.

Checkpoint P7: gates green. Option 2 complete.

## 5. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Field names differ on the real install (custom attributes, states) | High | Client fields are one `types.ts` union; Test connection probes `output_fields`; item 10 list from the iTop admin before P5. |
| Time Tracking `TimeSpent` schema differs from the docs | Med | `probe()` fetches one row with `output_fields: "*"` and logs the keys; 3.1 adapts before sync. |
| First unauthenticated route (webhook) | Med | Secret + `timingSafeEqual` + rate limit + no payload trust; 404 when unset. |
| Token leak via API/logs | High | Sealed at rest; never serialised; pino redact paths for `token`, `Auth-Token`. |
| Two backend instances double-sync | Low | Advisory lock; single container in `setup.sh`. |
| Snapshot drifts (tickets deleted/moved org in iTop) | Low | Daily full pull + manual Refresh drop missing rows. |
| Merge conflicts with `feat/remove-pipeline-module` | Med | Phase 1 starts only after that PR merges (decided). |
| `lib/queries.ts` grows large | Low | Keep iTop hooks in one contiguous block; instant review on each touch. |

## 6. To hand to the iTop admin before Phase 1 / Phase 5

Phase 1: items 1–5 of the spec (3.2.1+, HTTPS path, application token with `REST Services` + a read profile, org names / TAM emails). Phase 3: item 6. Phase 4: item 7 (Webhook extension, trigger "on ticket update", URL `https://<solvro>/api/webhook/itop`, header `X-Solvro-Webhook-Secret`). Phase 5: items 8–10, with item 10 (mandatory fields per stimulus, custom states) written down.

## 7. Docs and CHANGELOG obligations

- Every task: `CHANGELOG.md` entry under `[Unreleased]`, public wording.
- P1: `docs/CONFIGURATION.md` (`SECRETS_KEY`, `ITOP_SYNC_DISABLED`, webhook URL), `setup.sh`, `.env.example`.
- P3: root `CLAUDE.md` standing decision on `WorkLogs.tsx` retired by the docs-keeper; `README.md:268`, `docs/ISSUES.md:220`.
- On completion: move this plan and the spec to `docs/archive/plans/`; code comments cite `docs/archive/plans/itop-integration.md`.
