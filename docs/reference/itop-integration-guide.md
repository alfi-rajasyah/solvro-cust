# How to implement the iTop integration in Solvro

A replication guide for an AI agent (or a human) who must build, rebuild, or
port the iTop integration. It records **what** was built, **in which order**,
**why** each decision was made, and **every trap a real iTop install
exposed** — so the next implementation gets it right the first time.

- **Status:** shipped on `develop` — PRs #2–#8 (seven phases), #9 (real-install
  fixes), #10 (iTop server timezone), #11 (guardrails). Verified against a real
  iTop 3.2.2 on 2026-09-24: 17 of 20 live scenarios pass; the other 3 are
  time tracking (paid extension, out of scope) and one partial (iTop `User`
  class unreadable).
- **Source documents:** the original proposal
  `docs/archive/plans/itop-integration-spec.md`; the phase plan with task
  acceptance criteria `docs/archive/plans/itop-integration.md`; deferred
  findings in `docs/ISSUES.md` ("iTop integration …" sections); operator
  config in `docs/CONFIGURATION.md` §2.16; shipped detail in `CHANGELOG.md`.
- **Rule for the reader:** this guide describes the implementation as of
  2026-09-24. Before relying on a file, route, or field name, confirm it in
  the code — the code wins over this document.

---

## 1. What the integration does

iTop (Combodo's open-source ITSM) holds the customer tickets. Solvro is the
TAM's delivery workspace. The integration lets a TAM work iTop tickets from
inside Solvro without opening iTop.

| Phase | Capability | User-visible surface |
|---|---|---|
| 1 | Connection, ticket snapshot, customer ↔ organisation mapping | Admin › iTop; Customers › *customer* › **Tickets** tab |
| 2 | Today's ticket activity per customer | Daily Review › "iTop today" strip, "Add to note" |
| 3 | Hours from iTop Time Tracking | **Utilization** page (`/utilization`, replaced Work Logs) |
| 4 | Webhook nudge; pin a ticket to a Solvro task | `POST /webhook/itop`; Task panel › "iTop ticket" field |
| 5 | Per-TAM personal tokens; ticket actions + log entries | Settings › iTop; ticket panel buttons |
| 6 | Board view; create tickets; strip quick actions | Tickets tab › Board; "New ticket" sheet |
| 7 | Timer that logs time; create a ticket from a task | Ticket panel timer + top-bar pill; Task panel › "Create in iTop" |

Option 1 = Phases 1–4 (read-only). Option 2 = Phases 5–7 (writes). Option 2
was designed to follow Option 1 with no rework — keep that property.

---

## 2. Settled decisions and hard rules

These were decided by the product owner. Do not re-litigate them; build to them.

1. **iTop 3.2.1 or later, token auth only** (`Auth-Token` header). No password fallback.
2. **Ticket classes: `UserRequest` and `Incident` only** (`ItopConfig.readClasses`).
3. **TAMs are the iTop agents.** "Mine" = tickets whose agent is the TAM's iTop Person.
4. **Organisation names rarely match customer names.** Auto-match runs (exact, case-insensitive), but the admin maps every customer once.
5. **Other TAMs' hours** are visible only with the existing `report:executive` permission. No new permission string.
6. **Tickets hang off the customer, not the project.** Project tasks stay in Solvro; a task may pin one ticket ref and may create a ticket.
7. **iTop default lifecycles.** Solvro sends exactly the fields iTop's default lifecycle needs and shows iTop's refusal text verbatim for anything custom.
8. **Writes only under the acting user's own token** — a guardrail in root `CLAUDE.md`:
   - The application token (`ItopConfig.appTokenEnc`, `lib/itop/config.ts#getItopAppClient`) **only reads**. No write ever falls back to it.
   - A pasted personal token is accepted only when it resolves (`core/get Person WHERE email = '<Solvro email>'`) to the iTop Person with the Solvro user's email.
9. **No optimistic writes, nothing queued.** The UI changes only after iTop accepts the write and Solvro re-reads the ticket.
10. **Snapshot model:** 5-minute incremental pull + manual Refresh; daily full pull; 40 h/week capacity as one admin number.
11. **Viewer-local day windows.** "Today" / "this week" counts over iTop instants use the viewer's local day via a `utcOffsetMinutes` query param (UTC+7 sends `420`). Solvro-picked `date`/`week` strings keep the app's UTC-midnight date contract.
12. **Drag engine:** the ticket board uses the vendored `frontend/src/components/reui/kanban.tsx` through `itop/board/` — a sanctioned layer per the root `CLAUDE.md` guardrail. Never install an npm board/DnD library.
13. **Out of scope for the POC (2026-09-24):** buying the paid Time Tracking extension; resolving `User.itopUserId`.

---

## 3. Architecture

```
iTop REST  POST {baseUrl}/webservices/rest.php?version=1.3
           header Auth-Token: <token>, body: form-urlencoded json_data=<JSON>
   ▲ reads: application token             ▲ writes: acting TAM's personal token
   │                                      │
backend/src/lib/itop/client.ts     one client; 15 s timeout; iTop code≠0 → ItopError
backend/src/lib/itop/config.ts     ItopConfig singleton (30 s cache), app/personal clients, zone
backend/src/lib/itop/sync.ts       syncUsers / syncTickets / syncTimeEntries → snapshot upserts
backend/src/lib/itop/scheduler.ts  setInterval + Postgres advisory lock; requestSync() debounced
backend/src/lib/itop/timezone.ts   iTop wall-clock ⇄ UTC (IANA zone, DST-correct)
backend/src/lib/itop/types.ts      output_fields strings + row types (one place for field names)
backend/src/lib/secretBox.ts       AES-256-GCM seal/open, key = env SECRETS_KEY, prefix v1:
Postgres snapshot: itop_config, itop_tickets, itop_time_entries
                   + Customer.itopOrg*, User.itopPerson*/itopUser*/itopToken*, Task.itopTicketRef
routes: itopAdmin.ts (/admin/itop) · itop.ts (/itop) · itopUser.ts (/itop/me)
        utilization.ts (/utilization) · webhook.ts (/webhook, mounted before the JSON parser)
frontend: components/itop/* (+ board/), components/admin/ItopTab.tsx, pages/Utilization.tsx,
          Settings iTop section, TopBar timer pill; hooks in lib/queries.ts (one contiguous block)
```

**Why a snapshot, not live proxying:** list views, counts, "Mine", Daily
Review, and Utilization all query Postgres, so they are fast, work when iTop
is slow, and reuse Solvro's visibility filters. Live iTop calls happen only
for writes, the admin screens, pick-lists (services, callers), and the
re-read after a write.

### 3.1 Schema (Prisma, snake_case `@map`)

| Model / field | Purpose |
|---|---|
| `ItopConfig` (singleton `id = "default"`) | `baseUrl`, `appTokenEnc`, `webhookSecretEnc`, `timezone` (IANA, default `UTC`), `refreshMinutes` 5, `readClasses`, `capacityHoursPerWeek` 40, `actionsEnabled` false, `lastSyncAt/Ok/Error`, `lastFullSyncAt`, `updatedById` |
| `ItopTicket` (`id` = iTop key) | `class`, `ref` unique, `title`, `status`, `operationalStatus`, `priority` (code "1".."4"), agent/team/service/caller names, `agentPersonId`, `orgId`, `customerId`, `startDate`, `lastUpdate`, `tto`/`ttr` (**deadlines**), `slaTtoPassed/slaTtrPassed`, `resolutionDate`, `publicLog`/`privateLog` (Json), `syncedAt` |
| `ItopTimeEntry` (`id` = iTop key) | `itopUserId`, `userId`, `orgId`, `customerId`, `ticketId`, `ticketRef`, `startDate`, `endDate`, `durationMinutes`, `title`, `syncedAt` |
| `Customer.itopOrgId` (unique), `itopOrgName` | Mapping lives on `Customer` — one customer ↔ one org; no join table |
| `User.itopPersonId`, `itopUserId` (both unique) | Resolved by email |
| `User.itopTokenEnc`, `itopTokenCheckedAt`, `itopTokenPersonName`, `itopTokenExpiresAt` | Personal token (sealed) and its check result |
| `Task.itopTicketRef` (indexed) | One pinned ticket per task |

Migrations, in order: `itop_snapshot`, `itop_time_entries`,
`itop_time_entry_indexes`, `task_itop_ticket_ref`, `itop_write_path`,
`itop_timezone`.

### 3.2 Join rules

- **Customer ↔ organisation:** `Customer.itopOrgId`, admin-mapped; automatch = exact name, case-insensitive, unmapped customers only.
- **Solvro user ↔ iTop Person:** `Person.email = User.email` → `User.itopPersonId`. Drives "Mine" and ticket actions.
- **Solvro user ↔ iTop User account:** `User.contactid → Person.email` → `User.itopUserId`. Needed only for `TimeSpent` (time logging).
- An email mismatch means no "Mine", no hours; the Admin › iTop match report lists it.

### 3.3 API surface (as implemented)

All paths are behind the frontend's `/api` prefix in production.

| Method + path | Auth | Purpose |
|---|---|---|
| `GET/PATCH /admin/itop/settings` | admin | Read/update config. Token is write-only (`appTokenSet: true/false`). `timezone` validated → 400 `invalid_timezone` |
| `POST/DELETE /admin/itop/webhook-secret` | admin | Generate (shown once) / remove the webhook secret |
| `POST /admin/itop/test` | admin | Probes: `list_operations`, then `core/get` limit 1 on `Organization`, `UserRequest`, `Incident`, `Person`, `TimeSpent` |
| `POST /admin/itop/sync` | admin | Fire-and-forget sync (`full: true` option) |
| `GET /admin/itop/organizations` | admin | Live org list from iTop |
| `GET /admin/itop/customers`, `PATCH /admin/itop/customers/:id`, `POST /admin/itop/customers/automatch` | admin | Mapping |
| `GET /admin/itop/persons`, `POST /admin/itop/persons/match` | admin | Match report; re-run user matching |
| `GET /itop/status` | user | `configured`, `lastSyncAt`, `baseUrl` (for "Open in iTop" links), `actionsEnabled` |
| `GET /itop/customers/:id/tickets?scope=ongoing\|resolved_week\|mine&class=` | user + customer visibility | Rows + counts per scope + `syncedAt` |
| `GET /itop/tickets/:id`, `GET /itop/tickets/by-ref/:ref` | user + visibility | One ticket (with logs); ref lookup for the task field |
| `POST /itop/refresh` | user | `requestSync()` |
| `GET /itop/daily?date=&utcOffsetMinutes=` | user | Daily Review strip data per visible customer |
| `POST /itop/tickets/:id/actions` | user + own token + `actionsEnabled` | `assign_to_me` / `pending` / `resolve` / `close` / `reopen` |
| `POST /itop/tickets/:id/log` | same | Public/private log entry via `core/update` |
| `GET /itop/services`, `GET /itop/customers/:id/contacts` | user | New-ticket pick-lists (read with the app token) |
| `POST /itop/tickets` | same as writes | `core/create` a UserRequest/Incident |
| `POST /itop/tickets/:id/time` | same + `itopUserId` | `core/create TimeSpent` |
| `PUT/GET/DELETE /itop/me/token` | user | Save (validate + seal), status, remove personal token |
| `GET /utilization?week=&scope=me\|tam\|customer&utcOffsetMinutes=` | user; `tam`/`customer` need `report:executive` | Tiles + day matrix |
| `POST /webhook/itop` | shared secret header `X-Solvro-Webhook-Secret` | Nudge → `requestSync()`; body ignored; 202; 401 wrong secret; 404 no secret set; 429 above 6/min |
| `PATCH /tasks/:id` `{ itopTicketRef }` | existing task auth | Pin a ref, regex `^[A-Z]{1,3}-\d{4,8}$` |

### 3.4 Security model

- Tokens never leave the backend. Every token (app, personal) and the webhook secret are sealed with `secretBox.ts` (AES-256-GCM, `SECRETS_KEY`, versioned `v1:`). Rotating `SECRETS_KEY` invalidates all of them.
- `GET` endpoints never echo a token. Never log tokens (no `Auth-Token` in logs).
- Every `/itop` read reuses Solvro's customer visibility (`ensureCustomerVisible` / `customerVisibilityFilter` in `backend/src/lib/visibility.ts`) — a user without visibility gets 404.
- The webhook is the first unauthenticated non-health route: constant-time secret compare (`crypto.timingSafeEqual`), rate limit, and **no payload trust** — it only triggers a normal pull.
- Writes need three things: `ItopConfig.actionsEnabled`, the acting user's own sealed token, and (for `assign_to_me`) the user's iTop Person and team membership.

---

## 4. iTop REST facts (read before writing any iTop call)

These come from the real iTop 3.2.2 install. The in-memory fake originally
missed most of them; each one broke something on first contact.

### 4.1 Protocol

- Endpoint `POST {baseUrl}/webservices/rest.php?version=1.3`; body `application/x-www-form-urlencoded` with a single `json_data` field holding the JSON operation.
- Operations used: `list_operations`, `core/get` (`class`, `key` = OQL, `output_fields`, `limit`, `page`), `core/create`, `core/update`, `core/apply_stimulus`.
- Success is `code: 0`. Any other code → `ItopError { code, message }`; show iTop's `message` to the user verbatim (HTTP 409 `itop_refused` for refused writes).
- **Tokens are not free text.** iTop mints them: an encrypted `id:class:random` blob. Create a `UserToken` / `PersonalToken` object, then mint the value with iTop's `AuthentTokenService` (see §6.2). An arbitrary string is rejected.

### 4.2 Writes

- **`comment` is mandatory on every `core/update` and `core/apply_stimulus`.** Without it iTop answers "Missing parameter 'comment'". Solvro sends `Solvro: <action> by <email>`, `Solvro: log entry by <email>`, `Solvro: ticket created by <email>`, `Solvro: time logged by <email>` — this also leaves a readable audit trail in iTop's history.
- Stimulus map (default lifecycle):

  | Solvro action | Stimulus | Fields | Valid from |
  |---|---|---|---|
  | `assign_to_me` | `ev_assign` | `team_id`, `agent_id` (= user's Person) | `new`, **`pending`** |
  | `pending` | `ev_pending` | **`pending_reason` (mandatory)** | `assigned` |
  | `resolve` | `ev_resolve` | `solution` (mandatory), `resolution_code` | `assigned`, `pending` |
  | `close` | `ev_close` | — | `resolved` |
  | `reopen` | `ev_reopen` | — | `resolved` |

- **Team for `ev_assign`:** read the user's teams from `lnkPersonToTeam`. Zero teams → 409 `itop_no_team`. More than one and none chosen → 409 `itop_team_required` with the team list; the UI then asks the user to pick (ActionSheet `team` mode).
- **After every write, re-read the ticket** (`core/get`) and upsert the snapshot. If the re-read fails, answer with the pre-write row and `staleAfterWrite: true` — never a 500, because a client retry would fire the stimulus twice.

### 4.3 Reads and field shapes

- **`tto` / `ttr` are integers (elapsed SLA-clock seconds), not deadlines.** Deadlines are `tto_escalation_deadline` / `ttr_escalation_deadline`. Reading `tto` as a date crashed the whole sync (`value.trim is not a function`). Read every field through a type-tolerant parser (`parseItopDate`, `parseItopInt`, `parseItopBoolean`).
- **`priority` is a code `"1".."4"`** (1 critical … 4 low). Store the code; map to a label in the UI (`ticketPresentation.ts#priorityLabel`).
- **Case logs** (`public_log`, `private_log`) come as `{ entries: [{ date, user_login, user_id, message, message_html }] }`, possibly newest-first. Sort ascending before capping; older installs may send a plain string.
- **Date-times are wall-clock strings `YYYY-MM-DD HH:MM:SS` in the iTop server's configured `timezone`** (iTop config file), with no offset. Convert on every read, every OQL cutoff (`last_update > '…'`, `start_date >= '…'`), and every write through `ItopConfig.timezone` (`lib/itop/timezone.ts`, DST-correct: fall-back overlap → earlier instant; spring-forward gap → shifted forward). Assuming UTC made every time 2 h wrong on a Europe/Paris install.
- **Profiles limit reads.** A Support Agent token (app or personal) **cannot read `User` or `PersonalToken`.** Consequences: `User.itopUserId` never resolves (time logging says "not linked"), and personal-token expiry stays unknown. The token-ownership check therefore relies on the email → Person match.
- **One bad row must not stop a sync.** Wrap each row's upsert in try/catch, count skips, and show "Skipped N rows…" in Admin › iTop.

---

## 5. Prerequisites

### 5.1 Solvro side

- `SECRETS_KEY` env (base64 of exactly 32 bytes; `openssl rand -base64 32`), validated in `backend/src/env.ts`; the backend refuses to boot without it. `setup.sh` generates it for production.
- `ITOP_SYNC_DISABLED` env (`true`/`false`, default `false`) — kill switch for the scheduler. The scheduler also never starts under `NODE_ENV=test`.
- Everything else is DB-configured at Admin › iTop — never env vars.

### 5.2 iTop side (hand this to the iTop administrator)

1. iTop 3.2.1+, reachable from the Solvro backend over HTTPS (and from users' browsers, for "Open in iTop" links).
2. An **application token** user: profile **REST Services User** plus a read profile covering `Organization`, `UserRequest`, `Incident`, `Person`, `Service`, `lnkPersonToTeam` (and `TimeSpent` if Time Tracking exists). A custom read-only profile is better than Support Agent.
3. **Each TAM:** an iTop login whose Person email equals their Solvro login email; write rights on UserRequest/Incident (e.g. Support Agent); REST access; membership of at least one team.
4. **Personal tokens enabled** for the TAM profile: module setting `authent-token` → `personal_tokens_allowed_profiles` (e.g. `array('Support Agent')`). Default: administrators only.
5. **Timezone:** read `'timezone' => '…'` from iTop's `conf/production/config-itop.php` and enter the same IANA name at Admin › iTop › iTop server timezone.
6. **SLA (optional):** SLTs on the customer contracts' SLA for each priority/ticket type, and tickets linked to a contract service — otherwise the SLA columns stay empty.
7. **Webhook (optional):** a Remote Application Connection to Solvro, an `ActionWebhook` that POSTs to `https://<solvro>/api/webhook/itop` with header `X-Solvro-Webhook-Secret: <secret from Admin › iTop>`, fired by `TriggerOnObjectCreate` and `TriggerOnObjectUpdate` on `Ticket`.
8. **Time Tracking (optional, paid):** Combodo's Time Tracking extension (iTop Hub, ~€129 per version). Its docs list `TimeSpent.contact_id` (Person) beside `user_id`, which may remove the need for `itopUserId`. Verify the duration unit and `ticket_ref` writability before go-live.

---

## 6. Build and test environment

### 6.1 Fake iTop (automated tests)

`backend/test/itop/fakeItop.ts` is an in-memory Express server that speaks
`rest.php` (`list_operations`, `core/get|create|update|apply_stimulus`).
`backend/test/itop/run-fake-itop.ts` runs it standalone (port 8484) for
manual dev-stack checks.

**Make the fake strict from day one.** It must enforce every rule in §4:
comment required, `pending_reason` required, default lifecycle transitions
(including `pending → assigned`), integer `tto`/`ttr` beside the deadline
fields, priority codes, server-zone wall-clock dates (`state.timezone`),
and iTop's error texts. A lenient fake let six real-install bugs ship; the
strict fake now catches them in CI. One gap remains: the fake does not model
per-profile read limits (a Support Agent token cannot read `User` or
`PersonalToken`) — add that if you rebuild it.

- Fake tokens are plain-word constants (`FAKE_ITOP_TOKENS`). Random-looking fake secrets trip GitGuardian on the PR.
- Render the fake's dates through the production `utcToZonedWallTime`, but also keep at least one **absolute** instant assertion (hard-coded ISO string or an independent offset oracle) so a symmetric bug in `timezone.ts` cannot pass.

### 6.2 A real iTop for live QA (strongly recommended before calling it done)

The reference instance ran as its own compose project, outside the repo:

- Image `vbkunin/itop:3.2.2` (all-in-one with MariaDB), published on `127.0.0.1:8000`, joined to the Solvro compose network (`solvro_default`) with alias `itop`, so the backend reaches it at `http://itop`. Volumes for `conf/`, `extensions/`, and the DB.
- Headless install with `setup/unattended-install/unattended-install.php` and `--installation_xml`. The stock `itil-fresh-install.xml` has a **duplicate empty `selected_modules` block** that fails with "Missing unique tag: groups" — remove it.
- Admin user needs the **REST Services User** profile to call REST.
- Tokens: create the `UserToken` / `PersonalToken` object over REST, then mint the value inside the container as `www-data`:

  ```php
  <?php // php mint-token.php <Class> <id>
  require_once '/var/www/html/approot.inc.php';
  require_once APPROOT.'application/startup.inc.php';
  use Combodo\iTop\AuthentToken\Service\AuthentTokenService;
  [$_, $sClass, $iId] = $argv;
  CMDBObject::SetTrackInfo('Solvro dev token mint');
  $oObj = MetaModel::GetObject($sClass, (int)$iId);
  $oService = new AuthentTokenService();
  $sToken = $oService->CreateNewToken($oObj);
  $oObj->Set('auth_token', $oService->CreatePassword($sToken));
  $oObj->DBUpdate();
  echo $sToken, PHP_EOL;
  ```

- Keep secrets (DB password, admin password, tokens) in a `chmod 600` `.env` beside the compose file; never print them.
- Behind a tunnel or reverse proxy, set iTop's `app_root_url` to the public URL and `behind_reverse_proxy` to `true`. Back up `config-itop.php` before each edit; it is read-only by default.
- **Changing iTop's timezone on an existing install** requires converting every stored `DATETIME` column and the `========== <date> : ` separators in case-log text from the old zone to the new one (case-log `*_index` dates are Unix timestamps and need nothing). MariaDB in that image has no zone tables, so `CONVERT_TZ` returns NULL — do it with a PHP script using `DateTime`/`DateTimeZone`, one `CASE` update per column, inside a transaction, after a `mysqldump` backup. Then update Solvro's setting to match.

### 6.3 Solvro test infrastructure

- Backend vitest runs on an **isolated test database** (never the dev DB). Reset only the rows a test owns — an unscoped `deleteMany` hit foreign keys and made tests order-dependent.
- Playwright specs that mock routes with `page.route` must set `test.use({ serviceWorkers: "block" })`; the CI stack registers a PWA service worker that otherwise bypasses the mocks.
- Frontend unit tests are node-environment `.ts` only — keep logic in pure modules (`boardAdapter.ts`, `dropMapper.ts`, `ticketActions.ts`, `ticketPresentation.ts`, `itopSettingsDiff.ts`, `itopTimezones.ts`) and test those.

---

## 7. Implementation playbook

One phase = one branch = one PR into `develop`; one task = one commit. Run
each phase's scoped checks per task and the full gate (`.claude/scripts/gates.sh`)
once per wave. Schema, `lib/queries.ts`, `routes/tasks.ts`, env/`setup.sh`,
and vendored `reui/` are spine files — review them immediately. Detailed task
acceptance criteria are in `docs/archive/plans/itop-integration.md` §4.

### Phase 1 — Connection, snapshot, Tickets tab

1. `lib/secretBox.ts` + `SECRETS_KEY` (env, `setup.sh`, docs). Tests: round trip, tampered ciphertext throws, wrong key throws.
2. Schema: `ItopConfig`, `Customer.itopOrg*`, `User.itopPersonId/itopUserId`, `ItopTicket` → migration `itop_snapshot`.
3. `lib/itop/client.ts` + `types.ts` + fake iTop. Paging (`limit`/`page`), timeout, `ItopError`.
4. `lib/itop/sync.ts#syncTickets` + `scheduler.ts`: mapped orgs → paged OQL per class → upsert; incremental on `last_update > lastSyncAt − 60 s` (in the iTop zone); full pull every 24 h and on demand drops rows iTop no longer returns; `pg_try_advisory_xact_lock` inside a short interactive transaction so two backends never double-sync; per-row writes on the global client; `requestSync()` debounced 10 s.
5. `routes/itopAdmin.ts` + `components/admin/ItopTab.tsx` (Connection card with probes, refresh minutes, capacity, timezone, actions switch; Customers → organisations table with picker + Automatch; persons match report).
6. `routes/itop.ts` tickets/status/refresh + `components/itop/TicketsTab.tsx`, `TicketsTable.tsx`, `TicketFilters.tsx`, `SyncedAgo.tsx`. The Tickets tab appears only when iTop is configured **and** the customer is mapped (`CustomerDetail.tsx` derives "mapped" from the tickets endpoint's `mapped` flag). "Open in iTop" = `${baseUrl}/pages/UI.php?operation=details&class=${class}&id=${id}`.

Checkpoint: admin maps customers, sync runs, Tickets tab shows rows, "Mine" works for a user whose email exists in iTop.

### Phase 2 — Daily Review strip

`GET /itop/daily` (per visible customer: new today, resolved today, SLA
breached, ongoing, 3 recent) and `components/itop/DailyItopStrip.tsx` inside
`daily-review/OperationsCard.tsx`. "Add to note" appends `"<ref> <title>"` to
the day's operations note draft — it writes nothing to iTop.

### Phase 3 — Utilization

`ItopTimeEntry` (migration `itop_time_entries`, then `itop_time_entry_indexes`);
`syncUsers` resolves `itopUserId`; `syncTimeEntries` pulls `TimeSpent` for
matched users over an 8-week window (`TIME_ENTRY_WINDOW_MS`). Full-sync
cleanup deletes only rows at least 14 h inside the window
(`MAX_ZONE_OFFSET_MS`), because history outside the window can never be
re-fetched. `routes/utilization.ts` + `pages/Utilization.tsx` (Me / By TAM /
By customer; the last two need `report:executive`); `/work-logs` redirects to
`/utilization`; nav entry in `lib/navCommands.ts`.

### Phase 4 — Webhook and task ticket ref

- `routes/webhook.ts` mounted **before** the global JSON body parser; secret, rate limit, 202 + `requestSync()`.
- `Task.itopTicketRef` (migration `task_itop_ticket_ref`), accepted by `PATCH /tasks/:id`, regex `^[A-Z]{1,3}-\d{4,8}$` (iTop ref formats are install-configurable — do not narrow it). `components/itop/TaskTicketField.tsx` in `TaskPanel.tsx` shows the ticket's snapshot status, or "not in snapshot". A duplicated task does not carry the ref; a task cannot be created with a ref pre-set.

### Phase 5 — Personal tokens and the write path

- Schema `User.itopToken*`, log columns on `ItopTicket` → migration `itop_write_path`.
- `routes/itopUser.ts` (`PUT/GET/DELETE /itop/me/token`): validate with that token (`core/get Person WHERE email = <user email>`, exactly one match, else `itop_token_not_yours`), seal, store the person name, try to read `PersonalToken.expiration_date` (best effort).
- `POST /itop/tickets/:id/actions` and `/log` per §4.2; iTop refusal → 409 `itop_refused`; no token → 403 `itop_token_missing`; `actionsEnabled` off → 404.
- Frontend: Settings › iTop section; `TicketPanel.tsx` (facts, logs, buttons, "writes as <email>" footer, read-only banner without a token), `ActionSheet.tsx` (modes `resolve`, `team`, `pending`), `TicketLog.tsx`. Mutations have no `onMutate`; `onSuccess` sets the returned ticket; errors show iTop's message.

### Phase 6 — Board, new tickets, strip actions

- Pure `board/boardAdapter.ts` (columns `new, assigned, pending, resolved, closed`; escalation is a chip, never a column) and `board/dropMapper.ts` (drop → action or `null`; allowed graph = §4.2 table). `TicketBoard.tsx` / `TicketCard.tsx` on vendored `reui/kanban` in `onMove` mode — **no optimistic move**; forbidden columns are dimmed with an inline message (no vendored patch for a per-column veto).
- `GET /itop/services`, `GET /itop/customers/:id/contacts`, `POST /itop/tickets` (caller must be a Person in the customer's mapped org, checked with the app token; create runs under the TAM's token) + `NewTicketSheet.tsx`.
- "Assign to me" / "Resolve" on Daily strip rows reuse the same mutations and sheet.

### Phase 7 — Timer and task-to-ticket

- `POST /itop/tickets/:id/time` → `core/create TimeSpent { user_id, org_id, start_date, end_date, title, ticket_ref }` under the TAM's token, dates formatted in the iTop zone; window 1 min–24 h, not in the future (5 min skew), start ≤ 8 weeks old. Upsert into `ItopTimeEntry`.
- `useTicketTimer.ts` (one running timer, `localStorage`, cleared on logout), `TicketTimer.tsx`, top-bar pill in `layout/TopBar.tsx`.
- Task panel "Create in iTop" opens `NewTicketSheet` prefilled; on success it PATCHes `Task.itopTicketRef`.

### Post-launch fixes to include from the start

- **Real-install fixes (PR #9):** everything in §4.2–§4.3.
- **Server timezone (PR #10):** `ItopConfig.timezone` + `timezone.ts`; helpers take the zone as a **required** parameter (a default of `"UTC"` silently reintroduces the bug); an invalid stored zone falls back to UTC with a warning instead of failing the sync; changing the zone re-converts stored time entries and token expiry in place (DST-correct per row) and forces a full ticket re-sync. The admin select unions the saved value and the browser zone into `Intl.supportedValuesOf("timeZone")`, with a hard-coded fallback list.
- **Permission guards (PR #11):** `AdminGuard`/`ExecutiveGuard` wait for the server-confirmed user (`useAuth().userVerified`) before redirecting.

---

## 8. Verification

### 8.1 Automated

- Backend: client, sync (incl. non-UTC zone round trip and the UTC-misconfiguration skew), case logs, tickets, daily, utilization, webhook, token, actions, create, time, task ref, admin settings, timezone unit tests.
- Frontend unit: board adapter, drop mapper, ticket actions, presentation, daily strip, timer, settings diff, timezone groups.
- Playwright: `itop-tickets`, `itop-ticket-panel`, `itop-board`, `itop-daily-review`, `itop-task-ref`, `itop-timer`, `utilization` (desktop + mobile, 375 px).

### 8.2 Live QA against a real iTop (the 20 scenarios used)

| # | Scenario | Pass criterion |
|---|---|---|
| A1 | Admin › iTop › Test connection | Probes green (`TimeSpent` red without the extension) |
| A2 | Map customer → organisation | Picked from iTop's live list |
| A3 | Match users by email | Person linked (iTop account needs `User` read rights) |
| A4 | Full sync | Tickets pulled, 0 skipped, no error |
| B1 | Save personal token | "Valid · <name>"; another user's token refused |
| B2 | Customer › Tickets | Scope counts equal iTop |
| B3 | New ticket | Created in the right org with the chosen caller |
| B4 | Assign to me | new → assigned, agent and team set |
| B5 | Pending with a reason | iTop stores the reason |
| B6 | Assign to me from Pending | pending → assigned |
| B7 | Public log entry | In iTop's public log, author = TAM |
| B8 | Resolve | iTop stores resolution code and solution |
| B9 | Board | Cards in the lifecycle columns; drags run the right stimulus |
| B10 | Task › Create in iTop | Ticket created and pinned to the task |
| B11 | Daily Review strip | Counts and recent tickets; Add to note |
| B12 | Webhook | Wrong secret 401, right secret 202 + sync |
| B13 | Phone (375 px) ticket panel | Edge-to-edge, all actions reachable |
| C1 | Utilization | Hours shown (needs Time Tracking) |
| C2 | Timer → log time | One `TimeSpent` entry (needs Time Tracking + `itopUserId`) |
| C3 | Timestamps | Solvro times equal iTop's after zone conversion |

Check every write by reading it back from iTop, not from Solvro's response.
iTop's history should show each step with the `Solvro: … by <email>` comment.

---

## 9. Go-live checklist

- [ ] `SECRETS_KEY` set (production generated by `setup.sh`); migrations deployed.
- [ ] Application token with a read-only profile; entered at Admin › iTop; Test connection green.
- [ ] Admin › iTop › iTop server timezone = iTop's `timezone` config value (new installs start on `UTC`).
- [ ] Every customer mapped; persons match report reviewed.
- [ ] Personal tokens enabled for the TAM profile; each TAM saved a token in Settings › iTop.
- [ ] "Actions from Solvro" switched on only after the above.
- [ ] Optional: webhook, SLA targets, Time Tracking verification (duration unit, `ticket_ref`, `user_id`/`contact_id`).
- [ ] Public iTop URLs protected (e.g. Cloudflare Access) — a tunnelled login page is reachable by anyone.

---

## 10. Known limitations and deferred work

See `docs/ISSUES.md` for the full list. The ones a re-implementation should
decide up front:

- `User` and `PersonalToken` unreadable with Support Agent profiles → no `itopUserId`, unknown token expiry.
- `TimeSpent` duration unit and `ticket_ref` attribute unverified (`ITOP_TIME_SPENT_DURATION_IN_SECONDS`, `ITOP_TIME_SPENT_TICKET_REF_FIELD` in `types.ts`).
- `GET /itop/services` is not customer-scoped.
- Duplicating a task drops its pinned ticket ref; a task cannot be created with a ref.
- The running timer is per browser profile, not per user (logout clears it).
- The board's transition graph assumes iTop's default lifecycles.

---

## 11. Lessons learned (process)

1. **Test against a real iTop early.** The fake confirmed the design; the real install found 7 behaviours in one hour (comment, pending reason, pending → assigned, integer `tto`/`ttr`, priority codes, crash-on-one-row, timezone). Stand up §6.2 before Phase 5, not after Phase 7.
2. **Every external date is zoned until proven otherwise.** Store UTC instants; convert at the boundary with an explicit zone; make the zone a required parameter.
3. **Snapshot reads, live writes, re-read after write.** It keeps the UI honest (no guessed state) and retry-safe.
4. **One place for field names** (`types.ts`) made each real-install fix a one-line change.
5. **CI traps seen:** PWA service worker bypassing Playwright mocks; order-dependent DB resets; GitGuardian on fake tokens; a lock file written by the host's newer npm (write `package-lock.json` only inside the container); concurrent frontend `tsc` runs thrashing the container.
6. **Keep the guardrails:** app token reads only; writes under the acting user's own token; no npm board/DnD library; `CHANGELOG.md` entry per change in public wording.
