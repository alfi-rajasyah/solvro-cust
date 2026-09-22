# Changelog

All notable changes to this repository are tracked here. This file is maintained by hand (and by Claude Code when assisting) and serves as the canonical configuration / change-history reference.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) conventions:

- **Added** — new files, features, dependencies, or services.
- **Changed** — modifications to existing behavior, configuration, or structure.
- **Fixed** — bug fixes.
- **Removed** — deletions of files, features, or dependencies.

Entries are reverse-chronological. Each entry should record **what changed**, **where** (file path), and **why** when the reason isn't obvious from the change itself. Configuration-affecting decisions (env vars, Docker services, schema columns, etc.) must be captured here so this file can be used as a single source of truth for environment setup.

---

## [Unreleased]

### Added — 2026-09-22 — iTop integration: encrypted secrets at rest, ticket snapshot schema, REST client

- **Secrets at rest.** Integration tokens and other sensitive values can now be encrypted before they reach the database. A new required `SECRETS_KEY` environment variable (a base64-encoded 32-byte key, `openssl rand -base64 32`) drives AES-256-GCM encryption in **`backend/src/lib/secretBox.ts`**; `backend/src/env.ts` refuses to start without a valid key. `setup.sh` generates the key on a fresh install and backfills it once on an existing install; the dev `docker-compose.yml` carries a fixed dev-only value; CI generates a throwaway key per run (`.github/workflows/ci.yml`, `ci/docker-compose.ci.yml`, `ci/.env.ci.example`). Rotating the key invalidates every stored token — they must be re-entered.
- **iTop snapshot schema** — migration `20260922075353_itop_snapshot` adds a singleton `itop_config` table (connection URL, encrypted application token, sync interval, ticket classes, weekly capacity, last-sync status), an `itop_tickets` table mirroring iTop User Requests and Incidents, and mapping columns `customers.itop_org_id` / `customers.itop_org_name` and `users.itop_person_id` / `users.itop_user_id` that join Solvro customers and users to their iTop organisation and person (**`backend/prisma/schema.prisma`**). iTop stays the owner of tickets and hours; Solvro keeps a dated snapshot.
- **iTop REST client** — **`backend/src/lib/itop/client.ts`** and `types.ts` speak iTop's REST/JSON 1.3 interface (`core/get` with paging, `list_operations`, a connection probe, and the write operations later iTop work will use), with a typed `ItopError` that carries iTop's own message. An in-memory fake iTop (`backend/test/itop/fakeItop.ts`, run standalone with `npx tsx test/itop/run-fake-itop.ts`) backs the tests and manual dev-stack checks. No product-facing surface yet.
- **iTop admin API** — **`backend/src/routes/itopAdmin.ts`** (mounted at `/admin/itop`, admin-only) stores the iTop connection settings (URL, encrypted application token, sync interval, ticket classes, weekly capacity), runs a "Test connection" probe, lists iTop organisations, maps customers to their organisation (with exact-name automatch), triggers a sync, and reports which users are matched to an iTop person by email. The token is never returned by the API.
- **iTop ticket sync** — **`backend/src/lib/itop/sync.ts`** and **`scheduler.ts`** pull User Requests and Incidents for every mapped customer on the configured interval (minimum 1 minute), keep the snapshot in `itop_tickets`, and run a full resync once a day that also removes rows for tickets iTop no longer returns or for customers that were unmapped. Users are matched to their iTop person by email. Runs are serialised with a database lock so two triggers never sync at once. A new optional `ITOP_SYNC_DISABLED=true` turns the background sync off. iTop datetimes are read as UTC for now.
- **Tickets API** — **`backend/src/routes/itop.ts`** (`GET /itop/status`, `GET /itop/customers/:id/tickets`, `GET /itop/tickets/:id`, `POST /itop/refresh`) lets any user who can see a customer read that customer's ticket snapshot — ongoing, resolved this week, and "mine" — with per-scope counts, and request a refresh (one accepted request per 10 s). Visibility reuses the customer visibility rule.
- **Admin › iTop tab** — **`frontend/src/components/admin/ItopTab.tsx`** connects Solvro to iTop from the Admin page: a connection card (URL, application token, "Test connection" with per-probe results, refresh interval, ticket classes, weekly capacity, "Sync now"), a customers → iTop organisations mapping table with "Automatch by name", and a users → iTop persons report. The token field is write-only. Hooks live under `adminQueryKeys` in `frontend/src/lib/queries.ts`; the changed-fields-only save payload is built by `itopSettingsDiff.ts` (unit-tested).
- **Customer › Tickets tab** — **`frontend/src/components/itop/TicketsTab.tsx`** (with `TicketFilters`, `TicketsTable`, `SyncedAgo`, `ticketPresentation.ts`) appears on a customer page once iTop is connected and the customer is mapped to an organisation. It shows ongoing, resolved-this-week and "mine" tickets with incident/request counts, status, agent, age and SLA columns, and an "Open in iTop" link per row. A synced-ago line with a refresh button keeps the list current; the list refetches every minute while visible. Playwright spec: `e2e/tests/itop-tickets.spec.ts`.

### Removed — 2026-09-22 — Pipeline module and the Solution Architect project owner

- **Pipeline module removed in full.** The opportunity board (`/pipeline`), the opportunity detail page, the List / Swimlane / Quarter views, the Excel/CSV import with its history, the won-deal handoff, and the Overview and Executive pipeline analytics are gone. Why: Solvro ships as a delivery workspace for Technical Account Managers; sales-pipeline tracking is out of that scope.
  - **`backend/`** — deleted `src/routes/opportunities.ts`, `src/routes/opportunityItems.ts`, `src/lib/pipelineAccess.ts` and their tests; the `/opportunities` mount is removed from `src/app.ts`. The `pipeline:view`, `pipeline:create`, `pipeline:edit_own`, `pipeline:edit_all`, `pipeline:delete_own` and `pipeline:delete_all` permissions no longer exist.
  - **`frontend/`** — deleted `pages/Pipeline.tsx`, `pages/OpportunityDetail.tsx`, `pages/views/Pipeline*.tsx`, `components/pipeline/`, `components/PipelineGuard.tsx`, `components/PipelineImportDialog.tsx`, `components/OpportunityFormModal.tsx`, `components/AssignPicModal.tsx`, `components/DealCard.tsx`, `components/StageChip.tsx`, `lib/pipelineFormat.ts` and `lib/handoffDefaults.ts`. Both `/pipeline` routes, the sidebar and command-palette entry, the Pipeline hooks in `lib/queries.ts`, and the Admin **Pipeline** tab are removed.
  - **`e2e/`** — deleted `tests/pipeline-board.spec.ts` and `tests/pipeline-form.spec.ts`.
- **Solution Architect project owner removed.** A project is now owned only by its Technical Account Manager. The `SA` built-in role is gone from `backend/prisma/seed.ts` and `frontend/src/lib/auth.tsx`; the SA field is removed from the project form, the project right sidebar, the project meta row, the project cards, and the customer-detail project grid.
  - **Project visibility changed.** `backend/src/lib/visibility.ts` no longer matches on `saId`: a user without `project:view-all` sees a project when they are its TAM, or when they own its customer as TAM. Anyone who could previously see a project *only* because they were its SA loses access to it — reassign those projects before upgrading.
  - **`Customer.solutionArchitect` is unaffected.** It is a free-text contact name on the customer record and stays.
- **Database migration `20260922034304_remove_pipeline_module`** drops the `opportunities`, `opportunity_activities`, `opportunity_links` and `pipeline_import_logs` tables, the `PipelineStage` and `PipelineImportStatus` enum types, and the `projects.sa_id` column with its foreign key and index. **This deletes all opportunity data and is not reversible — back the database up before upgrading.**
- **Upgrade note — remove the `SA` role by hand.** The seed upserts the four remaining built-in roles (`ADMIN`, `TAM`, `STAKEHOLDER`, `PENDING`) and deletes nothing, so an existing install keeps its `SA` role row with permissions that no longer resolve. Delete it in **Admin > Roles** after reassigning its members. The role is left in place on purpose: silently deleting a role that live users are assigned to is worse than leaving one an admin can remove.
- **Docs** — `README.md`, `INSTALL.md`, `OPERATIONS.md`, `docs/DESIGN.md`, `docs/CONFIGURATION.md`, `docs/ISSUES.md` and the `CLAUDE.md` files drop their Pipeline and SA sections; the Pipeline and Velora planning documents move to `docs/archive/`.

### Changed — 2026-09-21 — Velora reference stack retired from the dev stack and its documentation

- **`.claude/scripts/gates.sh`** — the `guardrail-local-only-untracked` gate is inverted and renamed `guardrail-local-only-tracked`: it now asserts that `.claude/`, the four `CLAUDE.md` files and `docs/` **are** tracked, and that `.superpowers` is not. Why: the gate came from the source repository, where those paths are local-only; this repository tracks them by decision, so the gate failed on every run and no change set could ever reach a green gate. The inverted check still guards the inverse mistake — re-adding the source repository's ignore block would silently drop the agent workflow from the distribution.
- **`CLAUDE.md`** — removed the trap requiring a sibling `../VeloraApp` checkout for the dev stack, and described the Pipeline module as natively ported rather than as an "integrated Velora service". Why: the Pipeline module is native code and the reference containers no longer exist, so `docker compose up -d` no longer depends on that checkout.
- **`docs/CONFIGURATION.md`** — the `velora-app` and `velora-cron` services, the `velora_uploads` volume, the `velora` logical database, and port 3001 are removed from the dev-stack tables and the quick-reference card; the dockerised-dev row lists `postgres` + `backend` + `frontend`; section 2.16 is retitled "The Pipeline module (native)" and no longer documents a dev-only reference stack.
- **`docs/ISSUES.md`** — the cutover checklist entry records, as a dated partial resolution, that the dev Velora services, the `velora` database and the `../VeloraApp` clone are gone; retiring the standalone `/opt/velora` stack remains outside this repository.
- **Removed** — `backend/scripts/import-velora.ts` and `backend/test/importVelora.test.ts`. Why: the script was a one-time importer for historical deals from the previous standalone opportunity tracker, kept available under the 2026-08-15 "start fresh, no data migration" decision. No application code imported it, no `VELORA_*` variable exists in `backend/src/env.ts`, and the Pipeline module runs entirely on its own models and routes — so nothing depends on it and there is no data left to import. **`README.md`**, **`docs/CONFIGURATION.md`** — the script is no longer listed under `backend/scripts/`, and section 2.16 drops the one-time data migration procedure.

### Changed — 2026-09-21 — Vite dev server can be reached through a tunnel or reverse proxy

- **`frontend/vite.config.ts`** — `server.allowedHosts` is read from `VITE_ALLOWED_HOSTS` (comma-separated hostnames; unset leaves Vite's default host check in place). Why: Vite 5.4.12+ refuses any request whose `Host` header is not localhost or an IP address, so opening the dev server through a cloudflared tunnel (or any reverse proxy with a public hostname) answered "Blocked request. This host is not allowed." The variable follows the same pattern as `VITE_API_PROXY_TARGET`: set it in the frontend container's environment (the local `docker-compose.yml`), never in the repository.

### Changed — 2026-09-21 — Customer distribution builds and installs its own images

- **`.github/workflows/docker-publish.yml`** — the image name is derived from the repository (`ghcr.io/<owner>/<repository>-backend` and `-frontend`), so this repository publishes `ghcr.io/alfi-rajasyah/solvro-cust-backend` and `ghcr.io/alfi-rajasyah/solvro-cust-frontend`; the `IMAGE_OWNER` variable is replaced by `IMAGE_NAME` (`github.repository`). The trigger is unchanged: a green CI run on `main`, a `v*` tag, or a manual dispatch. Why: the copied workflow published to the source repository's image names, so a green run here would have overwritten the production `latest` images.
- **`setup.sh`** — the generated `~/solvro/docker-compose.yml` pulls `ghcr.io/alfi-rajasyah/solvro-cust-backend:latest` and `ghcr.io/alfi-rajasyah/solvro-cust-frontend:latest`.
- **`INSTALL.md`**, **`OPERATIONS.md`**, **`LICENSE.md`**, **`README.md`**, **`docs/CONFIGURATION.md`**, **`docs/plans/setup-sh-hardening.md`** — image names updated to the two above. **`INSTALL.md`**, **`notes/TEMPLATE.md`** — the clone and upgrade commands name this repository, `solvro-cust` (was `solvro-releases`). **`README.md`** — Production deployment clones this repository and runs `bash setup.sh` instead of piping `curl` from the source repository's raw file, which is private; the upgrade line says `git pull` then `bash setup.sh`.

### Added — 2026-09-21 — Customer repository: source, installer, operator docs, and the agent workflow in one tree

- **Source** — the complete tracked tree of the Solvro source repository (`backend/`, `frontend/`, `e2e/`, `ci/`, `.github/`, `setup.sh`, `README.md`, this changelog) copied as of commit 9f5fc20, plus the local-only files the agent workflow needs: `CLAUDE.md` at the root and in `backend/`, `frontend/`, `e2e/`; `docs/` (design system, configuration reference, issues, plans, reference, archive); `docker-compose.yml`, `.env.example`, `frontend/.env.example` for the dev stack. Why: this repository is the customer's copy of Solvro, developed with the same workflow.
- **`INSTALL.md`** — customer-facing install and upgrade guide (registry login, installer prompts, environment form, SSH tunnel, Google sign-in, backup). **`OPERATIONS.md`** — operator reference (containers, ports, `~/solvro/.env`, startup, first admin, backup and restore, logs, the fresh-install wipe). **`SUPPORT.md`** — support email placeholder, report contents, self-checks. **`LICENSE.md`** — proprietary notice with the sections left for the licensor. **`VERSION`** — `v1.0.0`; the installer does not read it yet. **`notes/TEMPLATE.md`** — the release-notes shape. **`docs/plans/setup-sh-hardening.md`** — the 4 planned installer changes, not approved. **`docs/reference/customer-repo-guardrails-draft.md`** — guardrails proposed for this repository, for the user to merge into `CLAUDE.md`.
- **`.gitignore`** — the source repository's rules minus its local-only workflow block: `CLAUDE.md`, `.claude/`, and `docs/` are tracked here by user decision. Claude Code runtime state under `.claude/` and the tool caches stay ignored. `docker-compose.yml` and `.env.example` stay ignored as in the source repository.
- **`.claude/settings.local.json`** — the reply-style hook path is `$CLAUDE_PROJECT_DIR`-relative; the one permission entry with an absolute source-repository path was dropped.


### Changed — 2026-09-10 — README: features, architecture, and API reference brought up to date with the shipped codebase

- **`README.md`** — rewritten against the current code. The feature list now covers everything that shipped since mid-August: the Daily Review's operations notes and review stamps, the Weekly Sync page with its Mid-week and Reflection tables (one row per highlight and per achievement, copy-as-table, drafts from the week's notes), the Recent-notes feed, the Pipeline module's Assign PIC flow, the Kanban mobile pager, the Gantt's holiday shading and critical-path flag, and the Admin tabs. New **Architecture** section: the three tiers and the `/api` proxy contract, a layer table for `backend/src/` (bootstrap, HTTP plumbing, routes, domain helpers, data) and for `frontend/src/` (shell and guards, data access, pages, feature components, the vendored drag engines, Base UI primitives, the CSS-first theme), the data model grouped by area, and the authorization model — the JWT payload, the twelve permissions, the five built-in roles, the project and customer visibility rules, 404-not-403 for hidden resources, and the Pipeline ownership gate. New **API** section: the conventions every route follows (Zod validation, the `{ error, code, details }` error shape, the plain-day date contract and the `today` query, partial-save semantics, row caps), a mount-by-mount endpoint table with each gate, and the key flows (sign-in, task ordering, baseline lock, stage moves, won-deal handoff, import). The Tech Stack table lists the current dependencies and versions (Node.js 22, TanStack Table and Virtual, Base UI, ExcelJS and jsPDF, vite-plugin-pwa) and describes the CI gate as it runs today; Getting Started adds the installer's environment-variable form, the production-shaped local stack from `ci/docker-compose.ci.yml`, and the `_test` database rule for the backend suite; a short Branches and releases section explains `develop`, `main`, and the GHCR publish gate. Why: the previous README dated from 2026-08-15 and described neither the weekly rhythm nor the internals; a reader had no single page for how requests flow, who may see what, and which routes exist.

### Changed — 2026-09-10 — Weekly Sync: one row per achievement, with its own outstanding issue, lesson learned, next week focus and decision

- **`backend/prisma/schema.prisma`**, migration `20260909180922_weekly_achievements` — the customer weekly update (`WeeklyUpdate`) loses its five Reflection text columns (`achievement`, `outstanding_issue`, `lesson_learned`, `next_week_focus`, `manager_decision`) and gains a child table, `weekly_achievements` (`WeeklyAchievement`): one row per achievement with a one-line `title` (200 characters), an optional `detail`, and that achievement's own outstanding issue, lesson learned, next week focus and manager decision, kept in the order the form saved them (`position`, unique per week) and deleted with the week. The migration creates the table and moves every existing update's text before dropping the columns: the first line of the old Weekly achievement becomes the row's title (cut at 200 characters, line endings normalised), the rest becomes its detail (the whole text when the first line was cut), the four other Reflection texts move onto that same row, and a week with a Reflection text but no achievement gets the title "Untitled" — nothing already written is lost, every Done week keeps one row, and every manager decision keeps its pin. **`backend/src/routes/customers.ts`**, **`backend/src/routes/dailyReview.ts`**, **`backend/test/weeklyUpdates.test.ts`**, **`backend/test/dailyReview.test.ts`**, **`backend/test/customerVisibility.test.ts`** — no longer read or write the five columns. Why: Monday's Reflection table had one row per customer, so it could not separate two achievements in the same week; an achievement is a title per row now, with the outstanding issue, lesson learned, next week focus and decision that belong to it.
- **`backend/src/routes/customers.ts`** — `PUT /customers/:id/weekly-updates/:weekStart` takes an optional `achievements` array with the same contract as `highlights`: up to 20 items, each with a one-line title of 1–200 characters (counted as characters), an optional detail, and that achievement's own outstanding issue, lesson learned, next week focus and manager decision (up to 8000 characters each); when present it replaces the week's list in the order sent, inside one transaction; when omitted the list stays as it was; an empty array clears it. Marking a week Done now needs health and at least one achievement — the list sent, else the rows already stored — instead of health and an achievement text; the error code stays `weekly_update_incomplete`. `GET /customers/:id/weekly-updates` and the save response return the achievement list ordered by position. **`backend/test/weeklyUpdates.test.ts`** — the Done-rule tests cover the four cases (health only, an empty list, a one-item list, stored rows with the list omitted); 11 new tests cover create with ordering and trimming, omit, clear, replace, the title and item limits (including a 200-character title that ends in an emoji), and that a highlights-only save leaves the achievements untouched and the reverse.
- **`backend/src/routes/dailyReview.ts`** — `GET /daily-review` now includes each customer's Reflection achievements: `weeklyUpdate.achievements` lists every achievement row for that week (`id`, `position`, `title`, `detail`, `outstandingIssue`, `lessonLearned`, `nextWeekFocus`, `managerDecision`), ordered by position, in place of the five removed fields. `previousWeeklyUpdate` (last Friday's carry-over for the Mid-week form) now carries `achievements`: last week's rows that have an outstanding issue, a next week focus, or a manager decision (`title` plus those three texts), or `[]` when none does — `null` only when last week has no update at all. Each list loads through one extra batched query alongside the existing weekly-update queries, so the number of database calls per page stays fixed. **`backend/test/dailyReview.test.ts`** — the full-field test expects `achievements: []` and confirms the five old keys are gone; new tests cover achievements returned in position order when saved out of order with exactly eight fields each, a customer with no weekly update still returning `weeklyUpdate: null`, and the carry-over keeping only the rows with an open item (a row with only a lesson learned is left out), in position order with exactly four keys each, while a row two weeks back is ignored.
- **`frontend/src/lib/queries.ts`** — `WeeklyUpdate.achievements` replaces the five Reflection text fields with an ordered list of achievement rows (id, position, title, detail, outstanding issue, lesson learned, next week focus, manager decision); the weekly-update save input takes an optional `achievements` list under the same present-replaces / omitted-unchanged contract as `highlights`; last Friday's carry-over carries an `achievements` list (title and the three open-item texts) instead of three flat texts. **`frontend/src/lib/weeklyDraft.ts`** — `draftWeeklyAchievements` drafts a customer's achievement list: this week's saved Mid-week highlights first, copied as they are, then one achievement per Thursday–Sunday note (day order, project notes before operations notes, titled with the day and the project name or the operations-note bracket, cut at 200 characters); a week with no saved highlights drafts from the whole week instead (7 new tests). Removed: `draftWeeklyUpdate`, the old free-text Reflection draft, and its helper `buildDayRows`, with their tests — nothing calls them now that the Reflection draft produces a list. **`frontend/src/lib/weeklySyncTable.ts`** — the Reflection "Copy as table" writes one row per achievement, with the Customer repeated on every row and the Weekly achievement cell carrying the title and, under it, the detail; a customer with no achievement still gets one row with "—"; a customer counts as having a Reflection update when the week is Done or has at least one achievement, and pins to the top when any of its achievement rows carries a manager decision (2 new tests). **`frontend/src/lib/dailyReviewStats.test.ts`** — its weekly-update fixture carries `achievements: []` instead of the five removed fields. Why: the Friday form and Monday's Reflection table could not separate two achievements in the same week, and the draft stacked the whole week into one paragraph.
- **`frontend/src/components/daily-review/ReflectionSyncModal.tsx`** — the Reflection sync form edits achievements as a list of cards instead of five text boxes: each card holds its own one-line title (200 characters max), a Detail hidden behind an "Add detail" link, and that achievement's Outstanding issue, Lesson learned, Next week focus and Need manager decision; a week without achievements opens with one empty card; "Add achievement" appends a card (up to 20 per customer per week), "Remove" deletes one, and saving drops a card left entirely blank while a card with text but no title stops the save with "Every achievement needs a title." "Draft from this week" fills the cards from this week's Mid-week highlights, then one card per Thursday–Sunday note (after a confirm when a card already holds text; cut at 20). "Mark done" needs Health and at least one card with a title; "Save draft", "Reopen as draft", ⌘/Ctrl+Enter and the footer are unchanged. The form is wider (`max-w-3xl`). Why: every Reflection text belongs to the achievement it describes, matching the one-row-per-achievement table.
- **`frontend/src/components/daily-review/MidweekSyncModal.tsx`** — the Wednesday form's "From last Friday" panel lists last week's achievements that still carry an outstanding issue, a next week focus, or a manager decision — one block per achievement with only the texts it has — instead of three per-customer lines, and stays hidden when last week has none. The highlights list, Health and Category are unchanged.
- **`frontend/src/pages/WeeklySync.tsx`** — the Reflection table lists one row per achievement: the customer's name, category line, health and status print once, on the customer's first row, and each row carries its own Weekly achievement, Outstanding issue, Lesson learned, Next week focus and Need manager decision, with a note icon next to an achievement that has a detail; a customer with no achievements still shows one row of dashes. A customer sits in "Needs a manager decision" when any of its rows carries a decision; the tab still counts customers. The subtitle now reads "One row per highlight and per achievement. Wednesday and Friday tables, read on Monday." The Mid-week tab, the week navigation and the hidden-customers toggle are unchanged. Why: the old single row ran every achievement together; an achievement is its own row now, so Monday's read can scan it.
- **`frontend/src/pages/CustomerDetail.tsx`** — each weekly update on the customer page lists its achievements — title, detail, then the four Reflection texts as labelled cells, the decision with the amber label — under an "Achievements · N" label, instead of the five-field grid; a week with no achievements says "No achievements." The mid-week section is unchanged.
- **`e2e/tests/daily-review.spec.ts`** — the weekly-update step drafts the Reflection form's achievement cards from the week's notes and checks that the first card's title carries the project note, that another card's title carries the operations note's title in brackets, then picks Amber, marks the week done, and finds the first achievement's title on the customer page. **`e2e/tests/weekly-sync.spec.ts`** — the Reflection flow fills two achievement cards (one with a manager decision) and checks that both show as their own rows under the manager-decision pin, and that the row stays pinned after a reload; the copy flow fills one card's title and finds it on the clipboard. The Mid-week highlights flow is unchanged.
- **Code comments** across the Weekly Sync files (`backend/src/routes/customers.ts`, `frontend/src/lib/queries.ts`, `weeklyDraft.ts`, `weeklySyncTable.ts`, `frontend/src/pages/WeeklySync.tsx`, `frontend/src/components/daily-review/MidweekSyncModal.tsx`, `ReflectionSyncModal.tsx`, `WeeklySyncRow.tsx`, `SyncField.tsx`, both Weekly Sync Playwright specs) cite their design plans by the plans' archive path (`docs/archive/plans/…`). Why: a plan moves to the archive when its feature ships, so a live path in a comment went stale.

### Changed — 2026-09-09 — Weekly Sync: one row per highlight, with its own risk, action and detail

- **`backend/prisma/schema.prisma`**, migration `20260909030050_weekly_highlights` — the customer weekly update (`WeeklyUpdate`) loses its three Mid-week text columns (`highlight`, `risk`, `action`) and gains a child table, `weekly_highlights` (`WeeklyHighlight`): one row per highlight with a one-line `title` (200 characters), an optional `detail`, and that highlight's own `risk` and `action`, kept in the order the form saved them (`position`, unique per week) and deleted with the week. The migration creates the table and moves every existing update's text before dropping the columns: the first line of the old Highlight becomes the row's title (cut at 200 characters), the rest of the text becomes its detail (the whole text when the first line was cut), the old Risk and Action move onto that same row, and a week with a Risk or Action but no Highlight gets the title "Untitled" — nothing already written is lost. **`backend/src/routes/customers.ts`**, **`backend/src/routes/dailyReview.ts`**, **`backend/test/weeklyUpdates.test.ts`**, **`backend/test/dailyReview.test.ts`** — no longer read or write the three columns. Why: Monday's Mid-week table had one row per customer, and the Highlight cell held the whole Wednesday update — 12 lines for one customer — so it could not be scanned; a highlight is now a title per row, with the risk and action that belong to it.
- **`backend/src/routes/customers.ts`** — `PUT /customers/:id/weekly-updates/:weekStart` takes an optional `highlights` array (up to 20 items: a one-line title of 1–200 characters — counted as characters, so an emoji counts once — plus detail, risk and action of up to 8000 characters each). When present it replaces the customer's saved highlight list for that week, in the order sent, inside one transaction; when omitted the list stays as it was; an empty array clears it. Saving the highlight list stamps `midweekSavedAt`, the same as saving Category. `GET /customers/:id/weekly-updates` returns each week's highlights in the order they were saved. **`backend/test/weeklyUpdates.test.ts`** — 12 new tests: create with ordering, trimming and empty detail; a 200-character title that ends in an emoji is accepted and stored intact; omit leaves the list; empty array clears; a shorter list replaces a longer one; a title over 200 characters, with a line break, or whitespace-only is rejected; a 21st item is rejected; the mid-week stamp fires on highlights alone; a Done week stays Done across a highlights save; the list endpoint orders by position. Why: a highlight is its own row with its own risk and action now, not text packed into one Mid-week cell.
- **`backend/src/routes/dailyReview.ts`** — `GET /daily-review` now includes each customer's weekly-update highlights: `weeklyUpdate.highlights` lists every highlight row for that week (`id`, `position`, `title`, `detail`, `risk`, `action`), ordered by position, in place of the removed `highlight`/`risk`/`action` fields. The list loads through one extra batched query alongside the existing weekly-update query, so the number of database calls per page stays fixed regardless of how many customers or highlights are on it. `previousWeeklyUpdate` (last week's carry-over) is unchanged. **`backend/test/dailyReview.test.ts`** — the full-field test now expects `highlights: []` and confirms the three old keys are gone; two new tests cover highlights returned in position order when saved out of order, with exactly six fields each, and a customer with no weekly update still returning `weeklyUpdate: null` alongside one that has highlights.
- **`frontend/src/lib/queries.ts`** — `WeeklyUpdate.highlights` replaces the single `highlight`/`risk`/`action` fields with an ordered list of highlight rows (id, position, title, detail, risk, action); the weekly-update save input takes an optional `highlights` list under the same present-replaces / omitted-unchanged partial-save contract as every other field. **`frontend/src/lib/weeklyDraft.ts`** — `draftWeeklyHighlights` drafts one highlight per Monday–Wednesday note (day order, project notes before operations notes), titled with the day and the project name or the operations-note bracket and cut at 200 characters, with the rest of the note kept as its Detail; `draftWeeklyUpdate` (the Friday Weekly achievement draft) is unchanged (14 new tests). **`frontend/src/lib/weeklySyncTable.ts`** — the Mid-week "Copy as table" writes one row per highlight, with Customer, Health and Category repeated on every row, the Highlight cell carrying the title and, under it, the detail; a customer with no highlight still gets one row with "—"; a customer counts as having a Mid-week update when it has a highlight, a category, or a Mid-week save (4 new tests). **`frontend/src/lib/dailyReviewStats.test.ts`** — its weekly-update fixture carries `highlights: []` instead of the three removed fields. Why: Monday's table could not be scanned when a whole week's notes sat in one Highlight cell — a highlight is a title per row now, with its own risk, action and detail.
- **`frontend/src/components/daily-review/MidweekSyncModal.tsx`** — the Mid-week sync form edits highlights as a list of cards instead of one shared Highlight, Risk and Action block: each card holds its own one-line title (200 characters max), Risk, Action, and an optional Detail hidden behind an "Add detail" link until needed; a week without highlights opens with one empty card; "Add highlight" appends an empty card (up to 20 per customer per week), "Remove" deletes one, and saving drops a card left entirely blank while a card with text but no title stops the save with "Every highlight needs a title." "Draft from Mon–Wed notes" fills one card per Monday–Wednesday note (after a confirm when a card already holds text) instead of stacking every note into one text block; a draft that would exceed 20 highlights is cut at 20, and a week with no notes keeps its one empty card. Each card carries a `data-testid` for the Playwright flow (attribute only). The form is wider (`max-w-3xl`); Health, Category, last Friday's carry-over panel, ⌘/Ctrl+Enter and the footer are unchanged. Why: Risk and Action belong to the highlight they describe, matching the one-row-per-highlight table.
- **`frontend/src/pages/WeeklySync.tsx`** — the Mid-week table lists one row per highlight: the customer's name, category line, health and status print once, on the customer's first row, and the rows after it leave those columns blank, with a lighter divider between highlights. A highlight with a detail shows a small note icon next to its title (hover to read the detail). A customer with no highlights still shows one row of dashes, as before. The page subtitle now reads "One row per highlight. Wednesday and Friday tables, read on Monday." The copy confirmation reads "Copied 1 row" for a single row (it said "1 rows"). The Reflection tab, the groups, the week navigation and the hidden-customers toggle are unchanged. Why: the old single Highlight cell ran every highlight together in one block; a highlight is its own row now, so Monday's read can scan it.
- **`frontend/src/pages/CustomerDetail.tsx`** — the customer page's "Show mid-week" section lists every highlight of that week as its own block — title, its detail when there is one, then that highlight's own Risk and Action — under a "Highlights · N" label, with a divider between highlights. Why: a week can carry more than one highlight now, each with its own risk and action, and the customer page is where past weeks are read back.
- **`e2e/tests/weekly-sync.spec.ts`** — a third Playwright flow, on desktop and mobile: open a customer's Mid-week form from the Weekly Sync table, save two highlights (one with its own risk and action, one with a detail), and check that the table shows both as rows under the customer with the "Saved" stamp and one detail icon, also after a reload; on desktop, "Copy as table" puts both titles, the detail and the customer name twice on the clipboard.

### Fixed — 2026-09-08 — Pipeline: an unassigned deal can be given a PIC

- **`backend/src/routes/opportunities.ts`**, **`backend/src/lib/pipelineAccess.ts`**, **`backend/test/opportunities.test.ts`** — a new `POST /opportunities/:id/assign` (body `{ picId }`) sets a deal's PIC. A holder of `pipeline:edit_own` may use it only on a deal that has no PIC yet; a holder of `pipeline:edit_all` may use it on any deal. An unknown user answers 400 `pic_not_found`. Every actual PIC change writes an "Assigned to <name>" activity note in the same transaction; repeating the same PIC changes nothing and writes no note. Nothing else changes: an unassigned deal stays locked for edits, stage moves, links and deletion until it has a PIC, and the existing PIC-only rules then apply. Why: the own-permission compares the deal's PIC to the caller, and a deal without a PIC matched nobody, so an SA could neither claim it nor unlock it — only an admin could. 14 new tests cover the route and guard the lock on the other routes.
- **`frontend/src/components/pipeline/boardLogic.ts`**, **`frontend/src/lib/queries.ts`**, **`frontend/src/components/pipeline/boardLogic.test.ts`** — `canAssignDeal` mirrors the server rule for the UI, and `useAssignOpportunity` calls the new route and refreshes the deal's list entry, detail and activity feed. 5 new unit tests.
- **`frontend/src/pages/OpportunityDetail.tsx`**, **`frontend/src/components/AssignPicModal.tsx`** (new) — an "Assign PIC" button on the opportunity detail page, shown only on a deal without a PIC to a user who may assign one. It opens a small dialog with one required PIC select (every user, preselected to the caller) and a line that says what the PIC can do; Assign closes it and the deal unlocks for its new PIC. Edit, Delete, the stage menu and Add link keep their existing gates.
- **`frontend/src/components/OpportunityFormModal.tsx`** — a new opportunity now starts with its creator as PIC instead of "No PIC" (still selectable), so an SA no longer locks themself out of a deal they just created. Editing an existing deal is unchanged.
- **`frontend/src/lib/auth.tsx`** — the Admin › Roles hint for "Edit own opportunities" now also says it lets the holder assign a PIC to an unassigned opportunity.
- **`e2e/tests/pipeline-form.spec.ts`** — desktop end-to-end coverage for the flow: a user with edit-own permission opens an unassigned deal, sees no Edit or Delete, assigns themself through the Assign PIC dialog, and then sees the PIC, the Edit and Delete buttons, and the "Assigned to" activity entry, also after a reload.

### Fixed — 2026-09-07 — Weekly Sync: a long unbreakable word no longer shifts a row's columns

- **`frontend/src/pages/WeeklySync.tsx`** — the header and every row of the Weekly Sync table are separate CSS grids that share one column template. The text columns were `1fr` tracks, whose minimum is the content's minimum width, so a cell with one long unbreakable word — a pasted Google Docs URL in "Next week focus" — widened that column in its own row only and squeezed the row's other text columns, leaving the row out of line with the header. The text columns are now `minmax(0,1fr)` and every cell breaks long words (`wrap-break-word`), so a URL wraps inside its column and every row keeps the header's column widths.

### Changed — 2026-09-07 — Weekly Sync: customers without an update are hidden

- **`frontend/src/pages/WeeklySync.tsx`**, **`frontend/src/lib/weeklySyncTable.ts`** — each tab now lists only the customers with an update for that tab this week. On Mid-week that is a customer whose Mid-week form was saved, or that carries any Mid-week text; on Reflection, a customer whose week is done, or that carries any Reflection text. Health alone does not count, because it is also set on Wednesday and would otherwise keep every Mid-week-only customer on the Reflection table as an empty row. A line under the table says how many customers in scope have no update for that tab, with a "Show them" / "Hide them" toggle that lists them again (a row is still the way to open a customer's sync form from this page). "Copy as table" copies the rows on screen, so the pasted table carries no empty rows either. When every customer is hidden, the table gives way to "No Mid-week updates this week." / "No Reflection updates this week.". The page subtitle reads "One row per customer with an update." The rule lives in `hasTabUpdate` (4 new tests). **`e2e/tests/weekly-sync.spec.ts`** — both tests now use the toggle to reach a fresh customer's row, check that the row stays listed on a fresh page load once it carries a saved Reflection, and that the same customer is hidden on the Mid-week tab until the toggle shows it. Why: the Monday read of the table was padded with "—" rows for customers no one had updated.

### Changed — 2026-09-04 — CI: faster end-to-end gate

- **`.github/workflows/ci.yml`**, **`ci/docker-compose.ci.yml`** — the `e2e` job is split into `e2e (desktop)` and `e2e (mobile)`, one Playwright project each on its own stack, so the two halves run side by side; each keeps a single worker because the specs share one database. The backend and frontend images are built with BuildKit through the GitHub Actions layer cache (`docker/build-push-action`, `cache-from`/`cache-to: type=gha`) and started with `compose up --no-build`, so the `npm ci` layers inside the Dockerfiles rebuild only when a lock file changes; the compose services carry explicit `image:` names as the handshake. The Chromium download is cached on the e2e lock file. The job limit drops from 25 to 20 minutes. Every `npm ci` in the workflow now fails a hung registry request after 60 seconds and retries up to 5 times (`npm_config_fetch_timeout` / `npm_config_fetch_retries` / `npm_config_fetch_retry_maxtimeout`), instead of waiting out npm's 5-minute default — the same stall also cancelled a typecheck job at its 15-minute limit. Why: a run took 13–17 minutes on a normal runner and 26 on one with a slow npm registry — two runs in a row were cancelled at the limit with every test passing — and about half of that time was `npm ci` and browser downloads repeated on every run.

### Added — 2026-09-03 — Playwright coverage for the weekly sync tables

- **`e2e/tests/weekly-sync.spec.ts`** (new) — on desktop and mobile: a seeded customer's row on `/weekly-sync` starts under "Other customers", moves into "Needs a manager decision" after a Reflection sync saved through the row's form, the tab label's decision count rises by one, the saved achievement shows in the row, and the Mid-week tab reports "Not filled"; on desktop, "Copy as table" puts a table on the clipboard that carries the customer name and the achievement text. **`e2e/tests/daily-review.spec.ts`** — the weekly-update step now drives the Reflection sync form (draft from notes, Amber, Mark done) instead of the removed inline textarea, and checks that the customer page shows the saved achievement text.

### Added — 2026-09-03 — Weekly Sync page

- **`frontend/src/pages/WeeklySync.tsx`** (new), **`frontend/src/App.tsx`**, **`frontend/src/lib/navCommands.ts`** — a new "Weekly Sync" page at `/weekly-sync`, in the sidebar and the ⌘K palette right after Daily Review: one row per customer in the user's scope, the same Previous/Next week control as Daily Review (`?week=2026-W36`), and two tabs. "Mid-week" lists Health, Highlight, Risk, Action, and when the Wednesday half was saved; "Reflection" lists Health, Weekly achievement, Outstanding issue, Lesson learned, Next week focus, Need manager decision, and the week's status, with the customers that need a manager decision grouped on top and counted in the tab label. On Monday the page opens on last week's Reflection tab; Tuesday to Thursday on this week's Mid-week tab; Friday to Sunday on this week's Reflection tab (`?tab=` overrides). Clicking a row opens that customer's sync form for the active tab (users with `project:write`). A "Copy as table" button copies the active tab with the meeting table's own columns (Mid-week: Customer, Health, Category, Highlight, Risk, Action; Reflection: Customer, Weekly achievement, Outstanding issue, Lesson learned, Next week focus, Need manager decision), rows in display order, as an HTML table with a tab-separated fallback, so it pastes into Google Docs as a real table; it copies only the sync fields, never daily notes. The table scrolls sideways inside its own container on a phone. **`frontend/src/lib/weeklySyncTable.ts`** (new, 16 tests) — the pure table builders: ordering, column headers, "—" for empty cells, HTML escaping, and the TSV form. Why: the Monday Weekly Sync with the VP and the Wednesday and Friday meetings each read one table across all customers, and the meeting doc still needs a pasted copy.

### Changed — 2026-09-03 — Daily Review: the weekly update becomes a sync row with two forms

- **`frontend/src/components/daily-review/WeeklySyncRow.tsx`** (new), **`CustomerGroup.tsx`** — under each customer on Daily Review, the free-text weekly update block is replaced by one compact row: status badge, health pill, a line that says when the Mid-week half was saved and whether the Reflection half is not started, a draft, or done, and two buttons, "Mid-week sync" and "Reflection sync", shown to users with `project:write`. **`MidweekSyncModal.tsx`** (new) — the Wednesday form: Health, Category (one line, 120 characters), Highlight with a "Draft from Mon–Wed notes" shortcut, Risk, and Action; last Friday's Outstanding issue, Next week focus, and Manager decision sit read-only on top when that week has an update. Saving writes only the Wednesday fields and the health value, so it never touches or reopens the Friday half. **`ReflectionSyncModal.tsx`** (new) — the Friday form: Health, Weekly achievement with a "Draft from this week's notes" shortcut, Outstanding issue, Lesson learned, Next week focus, and Need manager decision; "Save draft" and "Mark done" (enabled once health and Weekly achievement are set), or "Reopen as draft" and "Save" on a week already done. Both forms save with ⌘/Ctrl+Enter, confirm before a draft overwrites typed text, and initialise from the server on every open so text never leaks between weeks. **`SyncField.tsx`** (new) — the shared field layout and health selector. Why: the Wednesday and Friday meetings each read a table with fixed columns, and one text box could not feed either.

### Removed — 2026-09-03 — The free-text weekly update block

- **`frontend/src/components/daily-review/WeeklyUpdateBlock.tsx`** — superseded by the weekly sync row and its two forms above.

### Changed — 2026-09-03 — Customer page: weekly updates shown as the Reflection fields

- **`frontend/src/pages/CustomerDetail.tsx`** — each entry in the customer page's "Weekly updates" list now shows the week's Category as its title and the five Reflection fields (Weekly achievement, Outstanding issue, Lesson learned, Next week focus, Need manager decision) as labelled cells in a two-column grid, instead of one free-text paragraph; an empty field shows "—", and Need manager decision spans the row with an amber label. A "Show mid-week" toggle reveals the Wednesday fields (Highlight, Risk, Action) on entries that have any of them. The week header, health chip, status badge, author line, and the Draft muting are unchanged. Why: the weekly update is now two structured tables, and the customer page is where past weeks are read back.

### Changed — 2026-09-03 — Frontend data layer for the weekly sync tables

- **`frontend/src/lib/queries.ts`** — `WeeklyUpdate` and the weekly-update save input model the two structured sync tables (Mid-week: category, highlight, risk, action; Reflection: achievement, outstanding issue, lesson learned, next-week focus, manager decision, plus the mid-week-saved timestamp) instead of one free-text field; every save field is optional so a Mid-week save and a Reflection save never overwrite each other; `DailyReviewCustomer` carries `previousWeeklyUpdate` (last week's outstanding issue, next-week focus, and manager decision) for the Wednesday form. **`frontend/src/lib/weeklyDraft.ts`** — `draftWeeklyUpdate` takes an optional `throughDay`: the Wednesday Highlight drafts from Monday to Wednesday's notes only, while the Friday Weekly Achievement still drafts the whole week; the draft no longer ends with a "Next week — " stub, because Next week focus is now its own field (3 new tests). **`frontend/src/pages/CustomerDetail.tsx`**, **`frontend/src/lib/dailyReviewStats.test.ts`** — read `achievement` where they read `body`.

### Changed — 2026-09-03 — Weekly update save route: partial saves and the new Done rule

- **`backend/src/routes/customers.ts`** — `PUT /customers/:id/weekly-updates/:weekStart` accepts any subset of the Mid-week fields (`category`, up to 120 characters; `highlight`, `risk`, `action`) and the Reflection fields (`achievement`, `outstandingIssue`, `lessonLearned`, `nextWeekFocus`, `managerDecision`, up to 8000 characters each), plus `health` and `status`. An omitted field is left unchanged; `null` or whitespace-only text clears it; anything else is stored trimmed, never as an empty string. `status` defaults to the stored status, or Draft on a first save, so a Mid-week save never reopens a week that is Done. `midweekSavedAt` is stamped whenever a save carries at least one Mid-week field. Marking a week Done requires the effective health and Weekly Achievement — what the request sends, else what is already stored — to both be present, else 400 `weekly_update_incomplete` as before; `doneAt` keeps its stamp-once semantics. `GET /customers/:id/weekly-updates` returns the same full row. **`backend/test/weeklyUpdates.test.ts`** — partial saves, trimming and clearing, the 120-character limit, the mid-week stamp, a Mid-week save on a Done week, the list shape, and the effective-value Done rule. Why: the Wednesday and Friday forms edit different halves of one weekly row, so a whole-row save would overwrite the other form's work.

### Changed — 2026-09-03 — Daily Review payload: full weekly-update row and last week's carry-over

- **`backend/src/routes/dailyReview.ts`** — `GET /daily-review` returns, per customer, every Mid-week and Reflection field of the weekly update (category, highlight, risk, action, achievement, outstanding issue, lesson learned, next-week focus, manager decision, and the mid-week-saved timestamp) instead of a single free-text field, and adds `previousWeeklyUpdate`: the previous week's outstanding issue, next-week focus, and manager decision, or `null` when that week has no update. The previous-week rows come from one extra batched query inside the existing request, so the number of database calls per page stays fixed. **`backend/test/dailyReview.test.ts`** — the new fields, the `null` case, the exact four-key shape, and a row two weeks back being ignored. Why: the Wednesday form shows last Friday's open items on top, and the new Weekly Sync page reads this same response instead of a route of its own.

### Changed — 2026-09-03 — Weekly update data model: columns for the Mid-week and Reflection sync tables

- **`backend/prisma/schema.prisma`**, migration `20260903161134_weekly_sync_tables` — the customer weekly update (`WeeklyUpdate`, one row per customer per ISO week) loses its single free-text `body` and gains the columns behind two structured tables: the Wednesday Mid-week Sync (`category`, 120 characters; `highlight`; `risk`; `action`) and the Friday Reflection Sync (`achievement`, `outstanding_issue`, `lesson_learned`, `next_week_focus`, `manager_decision`), plus `midweek_saved_at`, stamped when the Mid-week half is saved. All new columns are optional text. The migration adds the columns, copies every existing update's text into Weekly Achievement (trimmed; text that was only spaces, tabs, or newlines becomes NULL), and only then drops `body` — nothing already written is lost, and an update that was Done stays Done. `health`, `status`, `done_at`, and the one-row-per-week rule are unchanged. **`backend/src/routes/customers.ts`**, **`backend/src/routes/dailyReview.ts`**, **`backend/test/weeklyUpdates.test.ts`**, **`backend/test/dailyReview.test.ts`**, **`backend/test/customerVisibility.test.ts`** — read and write `achievement` where they read and wrote `body`; no behaviour change beyond the rename. Why: the weekly meetings read two tables, one row per customer, and a single text box could not be turned into either.

### Added — 2026-09-02 — Duplicate a section from the List view

- **`frontend/src/pages/views/ProjectList.tsx`** — section headers in the List view gain a "Duplicate section" button between Rename and Delete (hidden on the "No section" group) that copies the section — same name and color — with every task and subtask inside it, placed directly after the source; copied tasks and subtasks start at To Do. One click, no confirmation. **`frontend/src/lib/queries.ts`** — `useDuplicateSection(projectId)` calls `POST /sections/:id/duplicate` and refreshes sections, tasks, the overview, and the Daily Review. **`e2e/tests/duplicate.spec.ts`** (new) covers all four duplicate surfaces — Task panel menu, subtask row, Gantt row menu, section header — on desktop and mobile (the Gantt case is desktop-only); **`e2e/fixtures/seed.ts`** gains a shared `createSection` helper. The Rename and Delete buttons beside the new one pick up the app-wide focus ring.

### Added — 2026-09-02 — Duplicate a section (API)

- **`backend/src/routes/sections.ts`** — `POST /sections/:id/duplicate` (`project:write`) copies a section — its name and color, every top-level task in it, and each task's subtasks — into a new section placed directly after the source, all inside one transaction. Copied tasks reset to To Do with dates, assignee, priority, milestone and Critical Path flags, and labels carried over; dependencies and comments are never copied. The copied tasks land right after the source section's own tasks in the project order. Responds `201` with `{ section, taskCount }` (top-level tasks copied). Placement is by identity, not by stored position, so a section list left sparse by an earlier delete still puts the copy directly after its source. The transaction runs with an explicit 30-second timeout — its statement count scales with the whole project (every top-level task gets re-packed), which can exceed Prisma's 5-second default on a large section. **`backend/test/sectionDuplicate.test.ts`** (new) covers ordering (dense and sparse), field copy and resets, section inheritance for subtasks, dependency and comment exclusion, the empty section, visibility, and permission.

### Added — 2026-09-02 — Duplicate a task from the Task panel, subtask rows, and the Gantt row menu

- A task can now be duplicated in one click from the Task panel's options menu (**`frontend/src/components/TaskPanel.tsx`**, "Duplicate task" above "Delete task" — the panel then opens the copy), from a subtask row in that panel (a "Duplicate" icon button beside "Rename"), or from the Gantt row context menu (**`frontend/src/components/gantt-v2/SolvroGantt.tsx`**, "Duplicate" after "Edit", on top-level and subtask rows alike). **`frontend/src/lib/queries.ts`** — `useDuplicateTask(projectId)` calls `POST /tasks/:id/duplicate` and refreshes the project's tasks, the global task list, the overview, and the Daily Review. The copy keeps the same title and lands directly after the source in the same list; duplicating a task also copies its subtasks. The subtask row's Rename and new Duplicate buttons both pick up the app-wide focus ring, replacing their old outline style. Why: repeating a phase (kickoff, UAT, go-live) meant re-typing every task by hand.

### Added — 2026-09-02 — Duplicate a task or subtask (API)

- **`backend/src/routes/tasks.ts`** — `POST /tasks/:id/duplicate` (`task:write`) copies the task (and, for a top-level task, every subtask beneath it) into a new row placed directly after the source in the same list, all inside one transaction. The copy keeps the source's title, description, dates, priority, milestone and Critical Path flags, assignee, section, and labels, but always starts at To Do with no baseline snapshot, no dependency links, and no comments. Responds `201` with the new task in the same shape as task creation. **`backend/src/lib/duplicate.ts`** (new) — `duplicateTaskTree`, the shared copy helper (section duplication reuses it). **`backend/src/lib/taskOrdering.ts`** — `insertManyAfter` places a batch of rows after a given sibling and re-packs the list in one pass. **`backend/test/taskDuplicate.test.ts`** (new) and **`backend/test/taskOrdering.test.ts`** cover field copy and resets, ordering, dependency and comment exclusion, visibility, and permission.

### Added — 2026-09-02 — Customer name beside the project name on the Portfolio Timelines calendar

**`backend/src/lib/portfolio.ts`** — every portfolio row (`GET /overview` → `portfolio`, `GET /reports/executive` → `projects`) gains `customerId` (`number | null`) next to the existing `customerName`; nothing else on the row changes. **`backend/test/portfolioCustomer.test.ts`** — on both routes, a project with a customer carries the customer's id and name, and a project without one carries null for both. **`frontend/src/lib/queries.ts`** — `PortfolioProjectRow.customerId`. **`frontend/src/components/portfolio/PortfolioCalendar.tsx`** — the Calendar view's row label (Executive › Portfolio Timelines › Calendar, and the Overview's portfolio calendar, which share the component) shows the customer after the project name on the same line as `Project · Customer`: the customer in `text-on-surface-variant`, linking to `/customers/:id` and turning primary + underlined on hover — the treatment the Overview already gives its customer links — so the project name stays the only primary-coloured element at rest. A project without a customer shows the name alone. The line truncates at the end with an ellipsis (the customer is what gets cut) and carries the full text in `title`. The label column widens from `w-48` to `w-64` (192 → 256px), hoisted into one `LABEL_COL_CLASS` constant shared by the row label, the month-header spacer and the Today-line spacer so the three cannot drift apart; the calendar's horizontal-scroll floor grows by the same 64px (`min-w-[720px]` → `min-w-[784px]`) so the twelve month columns keep their previous minimum width. The status chip under the project name is now a pill (`items-start` on the label column): on this calendar alone it used to stretch to the full column width — a 192px bar, which the wider column would have made 256px — while every other surface renders it as a pill. The List view is unchanged — it already shows "TAM · customer" on the right of each row. Why: the calendar listed hundreds of projects by name alone, and the customer is how a TAM tells same-named projects apart.

### Added — 2026-09-02 — Critical Path mark on tasks

**`backend/prisma/schema.prisma`**, migration `task_is_critical_path` — `Task.isCriticalPath` (`is_critical_path`, boolean, default false): a manual flag set by the TAM meaning "if this task slips, the project end date slips". Independent of priority; not computed from dependencies (the computed critical path stays deferred). **`backend/src/routes/projects.ts`**, **`backend/src/routes/tasks.ts`** — the create and update schemas accept `isCriticalPath`; gated by `task:write` like every other task field, milestones and subtasks included. **`backend/test/taskCriticalPath.test.ts`** — defaults, create, patch round-trip, milestone and subtask acceptance, 400 on a non-boolean, presence on the project task list. **`frontend/src/lib/queries.ts`** — `Task.isCriticalPath`, `UpdateTaskInput.isCriticalPath`, `CreateTaskInput.isCriticalPath`. **`frontend/src/components/CriticalPathMark.tsx`** — one component, chip and glyph forms: the `chip-violet` pair with the `conversion_path` glyph and the text "Critical Path". Shown on the Kanban card (`kanban-v2/cards.tsx`), the Timeline card (`pages/views/ProjectTimeline.tsx`), and the List view's task and subtask rows (`pages/views/ProjectList.tsx`); edited from the task panel (`TaskPanel.tsx`, a "Critical Path" row after Type, Yes/No) and the task form (`TaskFormModal.tsx`, a checkbox after Status with the caption "Slip here moves the end date."). `StatusChip`, `PriorityBadge` and `LabelChip` are untouched (`kanban-v2/adapter.test.ts` and `commitMapper.test.ts` gain the field in their `Task` fixtures to keep typecheck clean). **`frontend/src/components/gantt-v2/SolvroBar.tsx`**, **`SolvroGantt.tsx`** — the Gantt bar carries a 2px violet inset ring (milestone: a violet diamond outline) when a task is marked, surviving every Color-by mode; the tree name cell shows the glyph, the row menu offers "Mark as Critical Path" / "Remove from Critical Path", and the Color-by key names the mark (the key now renders in every mode, even for a project with no sections). **`frontend/src/lib/gantt/exportPdf.ts`**, **`exportExcel.ts`**, **`geometry.ts`**, **`palette.ts`** (new `CRITICAL_PATH_HEX`, the one violet both exporters paint) — the mark reaches the customer-facing exports: a violet stroke on the PDF bar and milestone, and a "Critical Path" column in both the PDF table and the Excel Tasks sheet; the Excel Gantt sheet frames marked bars top and bottom. A project with no marked task exports exactly as before — the column appears only when at least one exported task carries the mark (`exportPdf.test.ts`, new `exportExcel.test.ts`). **`e2e/tests/critical-path.spec.ts`** (and `e2e/fixtures/seed.ts`, whose task input gains the field) — bar and milestone attribute, task-panel toggle round trip, Kanban card text on desktop and mobile. Why: TAMs know which tasks gate the end date without modelling every dependency; a one-click mark matches the data they enter.

### Changed — 2026-08-31 — Gantt toolbar fits one row

**`frontend/src/components/gantt-v2/SolvroGantt.tsx`** — the toolbar's right-hand cluster was ≈1045px wide and dropped to a second row as one block, leaving the space under the zoom pills empty. Five changes bring it to ≈510px and one row from ≈1130px up. (1) The inline color legend moves inside a new "Color by" menu button (Base-UI `ui/dropdown-menu`): mode radios on top, the full color key below — no 6-entry cap, no "+N more"; picking a mode keeps the menu open so the key updates in place; the native `<select>` is gone. **`frontend/src/components/ui/dropdown-menu.tsx`** — `DropdownMenuContent` gains the `positionerClassName` passthrough `ui/popover.tsx` already has (`// SOLVRO PATCH`), because the menu opens over the Gantt's sticky `z-30` header and a z-index on the popup itself has no effect behind Base-UI's transformed Positioner; the toolbar passes `z-50`. (2) The "Lock baseline" / "Reset baseline" button leaves the toolbar (see `RightSidebar.tsx` below); the Baseline toggle's tooltip now points to the Context panel. (3) Export is icon-only (`aria-label` / `title` "Export"), same Excel / PDF menu. (4) "+ Task" / "+ Section" use the same 11.5px medium sentence case as every other toolbar button instead of 12px bold uppercase. (5) The right cluster is `flex-1 min-w-0 flex-wrap justify-end`, so on a narrow viewport it folds one group at a time, right-aligned, instead of dropping whole. **`frontend/src/components/layout/RightSidebar.tsx`** — new "Baseline" section in the Context panel, between Stakeholders and Export schedule: locked date and user (or "Not yet"), a "Lock baseline" / "Reset baseline" button (shown with `project:write`, the permission `POST /projects/:id/baseline` requires — the toolbar button used to show with `task:write`), the same confirm dialog (as-of date, "Clear baseline instead"), and an inline confirmation line in place of the old floating toast; the closed panel is now `inert`, so its buttons leave the tab order while it is off-screen. After a lock the Gantt no longer switches the ghost bars on by itself — toggle them with the toolbar's Baseline button. **`frontend/src/pages/ProjectDetail.tsx`**, **`frontend/src/pages/views/ProjectOverview.tsx`** — the outlet context gains `openContext()`; the Overview's "Lock baseline in Gantt" link becomes a "Lock baseline" button that opens the Context panel, shown only with `project:write`. **`e2e/tests/gantt-legend.spec.ts`** — drives the menu (`menuitemradio` picks, key read inside the menu, pick survives Escape); **`e2e/tests/gantt-parity.spec.ts`** — the baseline-toggle test also opens the Context panel and checks the Baseline section reports the lock and offers "Reset baseline". Why: at 1490px the toolbar wrapped to two rows with ≈420px of dead space on the left, and the legend grew with the section count.

### Added — 2026-08-31 — Delete a project

**`backend/src/routes/projects.ts`** — `DELETE /projects/:id` (`project:write`, visibility-scoped: 404 for a project the caller can't see) hard-deletes the project. The schema cascades to its tasks (with their subtasks, comments and dependencies), sections, labels, risks, notes, reviews and service assignments; a won deal linked through `Opportunity.projectId` keeps its row and loses the link (`onDelete: SetNull`). No soft-delete and no undo. **`frontend/src/lib/queries.ts`** — `useDeleteProject()` drops the project's cached subtree and refreshes the project lists, the task list, Admin › Projects, Overview, customers, Daily Review, recent notes, the executive roll-up and the pipeline (the linked deal's `projectId` is now null, so its "View project" link goes and "Create project" comes back). **`frontend/src/pages/ProjectDetail.tsx`** — a "Delete project" button next to "Edit project" (shown with `project:write`) confirms with the task count and what else goes, then replaces the history entry with the Projects list; a failure shows inline. **`frontend/src/components/DealCard.tsx`** — header comment names the delete route as the one path that clears a deal's link. **`backend/test/projectDelete.test.ts`** — 204 with tasks, sections, labels, risks and notes gone, handoff link cleared, customer-owner TAM may delete, 404 unknown / not visible, 403 without `project:write`, 400 on a malformed id, 401 without a token. Why: the API was create/read/update only, so the only way to remove a project was a direct database delete.

### Changed — 2026-08-31 — Overview: "Recent notes" replaces "Recent activity"

**`frontend/src/pages/Overview.tsx`** — the right-hand panel now lists the newest daily notes across every customer you can see: project notes and operations notes, last 7 days, newest first, each with its day, customer › project (or "Operations"), author, title, and body; the panel links to the Daily Review, where notes are written. The "Recent activity" feed (the last 5 tasks by id) is gone. **`frontend/src/lib/queries.ts`** — `useRecentNotes()` reads `GET /notes/recent` with `today` in the key (same day-boundary rule as `useOverview`); the six note mutations also invalidate the `recent-notes` prefix, so a note saved on the Daily Review appears on the Overview without waiting out `staleTime`. **`e2e/tests/daily-review.spec.ts`** — after saving both notes, visits `/overview` and expects them in the panel. Why: notes had no cross-customer view — one week per customer on the Daily Review, 14 days per project on the project overview.

### Added — 2026-08-31 — `GET /notes/recent`

**`backend/src/routes/notes.ts`**, mounted at `/notes` in **`backend/src/app.ts`** — `GET /notes/recent?today=yyyy-MM-dd` returns up to 20 notes from the 7 calendar days ending on `today` (optional; defaults to the server's UTC day, like the other `today`-taking routes), merged from `ProjectNote` (project visible through `projectVisibilityFilter` — administrative containers included, since the Daily Review lets you write notes on them) and `CustomerNote` (customer visible through `customerVisibilityFilter`), ordered by note day, then last update, then id. Read-only and in-app only — no export path, so the INTERNAL-notes rule is unaffected. **`backend/test/recentNotes.test.ts`** — owner vs. other TAM vs. view-all scope, both window edges (a note dated after `today` is out), containers in, the no-customer row, the 20-item merge cap, optional `today`, validation and auth.

### Fixed — 2026-08-31 — Overview two-up grid no longer overflows a phone viewport

**`frontend/src/pages/Overview.tsx`** — both panels of the attention/notes grid and the rows inside "Projects needing attention" get `min-w-0`. A grid item's automatic minimum width is its min-content width, so one nowrap `truncate` line inside either panel sized the single mobile column to 425px on a 390px phone and clipped the right edge of both panels; the truncation now works as intended and everything fits in 358px.

### Removed — 2026-08-31 — Overview payload drops `recentProjects` / `recentTasks`

**`backend/src/routes/overview.ts`** — the two "recent" queries and payload fields fed only the removed "Recent activity" panel; `OverviewProject` and `OverviewTask` leave `frontend/src/lib/queries.ts` with them.

### Changed — 2026-08-31 — Daily Review: collapsible project cards and attention lists, customer name links to the customer page

**`frontend/src/components/daily-review/ProjectCard.tsx`** — each project card gets a chevron in its header that folds the card body (phase/progress, overdue tasks, open risks, and the week's notes) down to the header row; while folded, the header shows the overdue and open-risk counts so nothing actionable disappears from view. The overdue/open-risk row gets its own "Hide lists" / "Show lists" toggle that folds the two lists to a one-line count summary. Both folds start expanded and are not persisted. A day-strip click still reaches the first card's note editor: it force-expands a folded card, the same way it already force-expands a folded customer group. **`frontend/src/components/daily-review/CustomerGroup.tsx`** — the customer name is now a link to `/customers/:id`; because a link cannot sit inside a button, the group's collapse toggle is the chevron icon button alone rather than the whole header row. Why: with many overdue tasks and risks, one project card filled the screen, and the customer page was two clicks away. **`e2e/tests/daily-review.spec.ts`** — covers both folds and reaches the customer page through the new link.

### Changed — 2026-08-31 — Owning a customer grants access to its projects

**`backend/src/lib/visibility.ts`** — `projectVisibilityFilter` gains a third arm: a user sees every project of a customer they own as TAM (`Customer.tamId`), next to the projects where they are the project TAM or SA. This is full access, the same as being the project's TAM: every project-scoped route (project list and overview, Kanban, Gantt, tasks, sections, risks, dependencies, notes, reviews, services, baseline, and `PATCH /projects/:id` including status, TAM, and customer changes). Why: the Daily Review lists every active project of an owned customer, and the customer's TAM must be able to review them, log notes, and change task status — not only look at them.

### Added — 2026-08-31 — Backend coverage for the owned-customer project arm

**`backend/test/projectVisibility.test.ts`** — new suite for `projectVisibilityFilter`'s owned-customer arm: a customer's owner sees and can act on (review, note) every active project under it, including ones where another user is the project TAM; a project of a customer they don't own stays hidden with 404, and an unowned customer grants no one access through this arm.

### Added — 2026-08-31 — End-to-end coverage for customer visibility

**`e2e/tests/customer-visibility.spec.ts`** — one Playwright flow, run on desktop and mobile: the admin API creates two TAM users and one customer with one active project each; a TAM logs in through the UI and sees only their own customer on `/customers` and on `/daily-review`, never the other TAM's.

### Changed — 2026-08-31 — Daily Review subtitle names the customer-first page

**`frontend/src/pages/DailyReview.tsx`** — the subtitle now reads "Your customers, their active projects, and each customer's weekly update."

### Changed — 2026-08-31 — Customers page and form follow the customer visibility rule

**`frontend/src/pages/Customers.tsx`** — the subtitle and the empty state say what the list holds: every customer for users with `project:view-all`, otherwise "Customers assigned to you, plus customers of the projects you work on." Each card shows a `TAM:` line when the customer has one. **`frontend/src/components/CustomerFormModal.tsx`** — on create, the TAM select starts on the current user; the "— none —" option shows only for `project:view-all` users, or on edit of a customer that already has no TAM. Moving a customer you own to another TAM asks for confirmation first, because it can remove the customer from your list.

### Changed — 2026-08-31 — Daily Review is scoped by customer ownership

**`backend/src/routes/dailyReview.ts`** — the page now starts from the customers you can see, not from your projects. A customer you own as TAM shows every active project, whoever the project TAM is; a customer you reach only through one of your own projects shows just your active projects; projects with no customer still appear under "No customer" when you are their TAM. Users with `project:view-all` (or `*`) keep the full view. Payload shape and query count are unchanged; the scope cases in `backend/test/dailyReview.test.ts` were rewritten for the customer-first page.

### Changed — 2026-08-31 — Customer routes follow the customer visibility rule

**`backend/src/routes/customers.ts`** — `GET /customers`, `GET /customers/:id`, the operations-notes routes, the weekly-updates routes, `PUT /customers/:id/services`, `PATCH`, and `DELETE` now apply `customerVisibilityFilter` / `ensureCustomerVisible`: a user sees a customer they own as TAM, an unowned customer, or a customer with a project they can already see; users with `project:view-all` (or `*`) see every customer. A hidden customer answers 404 `customer_not_found` on every route, so its existence never leaks. A customer's project list and project count follow `projectVisibilityFilter`, so a customer reached through one visible project never shows its other projects. `POST /customers` without a `tamId` now makes the creator the TAM, so nobody can create a customer they cannot see. Leaving a customer unowned — `tamId: null` on create, or clearing the TAM of an owned customer on `PATCH` — is accepted only from users with `project:view-all`, otherwise 400 `tam_required`; an already-unowned customer may stay unowned. Reassigning a customer to another TAM through `PATCH` stays allowed. New suite `backend/test/customerVisibility.test.ts` covers the rule end to end.

### Fixed — 2026-08-31 — Search hits and project links respect customer visibility

**`backend/src/routes/search.ts`** — customer hits are filtered by `customerVisibilityFilter`, so a customer hidden from the caller no longer appears in search results. **`backend/src/routes/projects.ts`, `backend/src/routes/opportunities.ts`** — `POST /projects`, `PATCH /projects/:id`, and the opportunity handoff check the `customerId` against the caller's visibility and answer 400 `customer_not_found` for a hidden or unknown customer; before, an unknown id crashed `POST /projects` and the handoff with a 500 and answered 404 on `PATCH /projects/:id`. New suite `backend/test/projectCustomerLink.test.ts` covers all three routes.

### Added — 2026-08-31 — Customer visibility rule

**`backend/src/lib/visibility.ts`** — `customerVisibilityFilter(user)`, `isCustomerVisible(user, id)`, and `ensureCustomerVisible(user, id)`, the customer counterparts of `projectVisibilityFilter` / `ensureProjectVisible`. Users with `project:view-all` (or `*`) see every customer; everyone else sees a customer they own as TAM (`Customer.tamId`), an unowned customer (`tamId` null), or a customer with at least one project they can already see. A hidden customer id answers 404 `customer_not_found`, never 403; as a body field (a project link) it answers 400 with the same code.

### Changed — 2026-08-29 — Daily Review: collapsible customer groups and week views

**`frontend/src/components/daily-review/CustomerGroup.tsx`, `WeekNotesEditor.tsx`** — each customer's group header is now one toggle that shows the project count, TAM, how many projects are reviewed today, the weekly-update status, and health, whether the group is open or closed; a group still starts closed once every project is reviewed and the weekly update is done, and a manual click wins from then on. Each project's and operations card's week view opens showing only today's row, with a "Show week · N notes" toggle for the other six days; a click on the day strip opens the week and jumps to that day.

### Added — 2026-08-29 — End-to-end coverage for the Daily Review page

**`e2e/tests/daily-review.spec.ts`** — one Playwright flow, run on desktop and mobile: write a daily note (⌘↵) and an operations note, mark the project reviewed, resolve an overdue task from its card, draft the customer's weekly update from the week's notes, set its health and mark it done (the customer group collapses), then confirm the update appears on the customer page and the note on the project overview, and that week navigation round-trips through `?week=`. Stat-tile assertions are delta-based, because the fixture admin sees every active project in the shared database. **`frontend/src/components/daily-review/StatsBar.tsx`** gains five `data-testid` attributes for the tiles (attribute-only).

### Changed — 2026-08-29 — Daily Review v2: a weekly, per-customer review page

**`frontend/src/pages/DailyReview.tsx`** (rewritten), **`frontend/src/components/daily-review/`** (new) — the Daily Review page is now a weekly, per-customer surface instead of a same-day, write-only form. A seven-day strip and Previous/Next week navigation (URL-addressable: `?week=2026-W35`) sit above five stat tiles (customers reviewed, notes this week, weekly updates done, overdue tasks, open risks). Projects are grouped under their customer; each project card has an explicit, timestamped "Mark reviewed" action, overdue-task and open-risk lists with inline status changes, and a full week of notes — add, edit, and delete your own, backfill a past day, several notes per day. Each customer also gets an operations card for issues that belong to no project (each with a short title) and a weekly update block that can be drafted from the week's notes in one click, saved as a draft, and marked done with a Green/Amber/Red health. A customer group whose projects are all reviewed and whose weekly update is done collapses to one summary row. Projects with no customer sit in their own section with a prompt to assign one. The Internal/Customer-facing toggle is gone from the page: every note it writes is internal, as before. The page loads from one request instead of three per project.

**`frontend/src/lib/dailyReviewStats.ts`** (new) — the pure helpers behind the page: the five stat-tile counts, the group auto-collapse rule, and the day/date label formatters. 22 unit tests.

### Added — 2026-08-29 — Customer TAM on the form, weekly updates on the customer page, note feed on the project overview

**`frontend/src/components/CustomerFormModal.tsx`** — the customer form gains a "TAM" select (any user; "— none —" to clear), saved as the customer's assigned TAM. The account-manager / solution-architect row now holds three fields and stacks on narrow screens.

**`frontend/src/pages/CustomerDetail.tsx`** — the header shows the assigned TAM, and a new "Weekly updates" section lists the customer's per-week status updates newest first: week label and date range, health chip (Green / Amber / Red), Draft or Done badge, the update text, the author, and when it was marked done. Draft updates render muted; done ones at full strength.

**`frontend/src/pages/views/ProjectOverview.tsx`** — a new "Notes" panel shows the last 14 calendar days of daily notes for the project (day, author, text), read-only, with a "Log a note" link to the Daily Review page. The 14-day window is computed in UTC from day strings, never from local clock arithmetic.

### Added — 2026-08-29 — Daily Review v2 frontend data layer: one-request page load, note/review/weekly-update editing, week navigation

**`frontend/src/lib/queries.ts`** — the frontend catches up with the redesigned Daily Review page: a single `GET /daily-review` request backs the whole page (one week-keyed cache entry, kept visible across Previous/Next week navigation); notes can be added, edited, and deleted in place; marking or unmarking a project "reviewed" is instant; operations notes (issues attached to a customer rather than a project) get the same add/edit/delete, including their title; and a customer's weekly status update can be saved as Draft or Done. Each of these edits updates the page's cache immediately and rolls back if the request fails; changing a task's or a risk's status from the Daily Review attention lists also refreshes the page. Customers carry their assigned TAM through the same types the customer form already used.

**`frontend/src/lib/isoWeek.ts`** — ISO-8601 week arithmetic in pure UTC, mirroring the backend module for every shared case, plus the week-navigation and header-label helpers the page needs (shift a week key forward/back, format a week as "24 – 30 Aug"). 26 unit tests; the frontend suite runs under UTC and Asia/Jakarta.

**`frontend/src/lib/weeklyDraft.ts`** — drafts a customer's weekly update text from that week's project and operations notes, grouped by day, so a TAM starts from a filled-in draft instead of a blank textarea. 11 unit tests.

### Added — 2026-08-29 — `GET /daily-review`: one payload for the Daily Review page

**`backend/src/routes/dailyReview.ts`, `backend/src/app.ts`** — the redesigned Daily Review page loads from one request instead of three per project card. `GET /daily-review?week=2026-W35&today=2026-08-28` returns, for the requesting user's scope, the customers they cover (each with its active projects, its operations notes, and its weekly update for that week), the active projects that have no customer, and a seven-day grid of how many customers got a note on each day. Per project it computes the current phase, progress, schedule slip against the locked baseline, the overdue tasks (judged against the caller's calendar day), the open risks, the week's notes, and the caller's own "reviewed" marks. Scope follows the existing project-visibility rules: a TAM sees their own active projects and the customers assigned to them; users with `project:view-all` (or the admin wildcard) see every active project and every customer that has a TAM. A malformed or non-existent ISO week (`2025-W53`) is rejected with 400. A fixed number of batched database calls per request, regardless of how many projects or customers are on the page. 23 tests.

### Added — 2026-08-29 — Project notes get a date, a window, and edit/delete; explicit "reviewed" marks

**`backend/src/routes/projects.ts`** — `POST /projects/:id/notes` accepts an optional `noteDate` (calendar day; defaults to today in UTC), so a note can be backfilled onto the day it belongs to; `GET /projects/:id/notes` accepts `from`/`to` day bounds and now orders by note day. New `PATCH` and `DELETE /projects/:id/notes/:noteId`: only the author may edit; the author or an admin-wildcard user may delete. The Internal/Customer-facing field is still accepted and still defaults to `INTERNAL` — the UI simply stops sending it. New `POST /projects/:id/reviews` (`{ reviewDate }`, idempotent per user, project and day) and `DELETE /projects/:id/reviews/:reviewDate` record that a user reviewed a project on a given day, independent of whether they wrote a note. 18 tests.

### Added — 2026-08-29 — Customer TAM, operations notes, and weekly updates

**`backend/src/routes/customers.ts`** — a customer can be assigned a TAM (`tamId` on create/update; an unknown user is rejected with 400; customer list and detail responses include the assigned TAM). Operations notes — issues that belong to a customer but to no project — live at `GET/POST /customers/:id/notes` and `PATCH/DELETE /customers/:id/notes/:noteId`: a required title (1–120 characters), body, and calendar day; author-only editing, author-or-admin deletion. Weekly status updates live at `GET /customers/:id/weekly-updates` and `PUT /customers/:id/weekly-updates/:weekStart` (the Monday of an ISO week; one row per customer per week): body, health Green/Amber/Red, status Not started → Draft → Done — Done requires a body and a health value and stamps `doneAt`, which clears when the update is reopened. All writes require `project:write`, the same gate as the customer form; reading operations notes and weekly updates requires `project:read`, so a newly signed-in account that has no role yet cannot see them. Saving an already-done update keeps its original done time, and a save that leaves out the health value keeps the stored one. 24 tests.

**`backend/src/routes/admin.ts`** — deleting a user now also refuses (with the existing `user_in_use` message) when that user authored project notes, operations notes, or weekly updates, instead of failing with a database foreign-key error.

### Added — 2026-08-29 — Daily Review v2 data model: customer TAM, dated notes, operations notes, weekly updates, review marks

**`backend/prisma/schema.prisma`, `backend/prisma/migrations/20260829034734_daily_review_v2/`** — the data behind the reworked Daily Review: a customer can now have a designated TAM (`Customer.tamId`, cleared if that user is deleted); project notes carry a calendar day (`ProjectNote.noteDate`, backfilled from each existing note's creation date in UTC) and an `updatedAt` so they can be edited; new `CustomerNote` rows hold operations notes — issues that belong to a customer but to no project — with a required title; new `WeeklyUpdate` rows hold one status update per customer per ISO week (body, Green/Amber/Red health, Not started → Draft → Done); and new `ProjectReview` rows record that a user reviewed a project on a given day. The note-visibility column and its `INTERNAL` default are unchanged — only the schema comment now says the Internal/Customer-facing control is gone from the UI.

**`backend/src/lib/isoWeek.ts`** — ISO-8601 week arithmetic in pure UTC (`parseWeekKey`, `weekKeyOf`, `isMonday`) for the week-keyed Daily Review; handles 53-week years (`2026-W53` exists, `2025-W53` does not). 15 unit tests.

### Changed — 2026-08-15 — README describes the two-role product

**`README.md`** — the readme now presents Solvro as the TAM + SA platform it is: the solution-to-project lifecycle in the overview, the Pipeline module (board, views, detail, import, analytics, handoff) in the feature list, `xlsx` in the stack table, and the Pipeline e2e specs in the repository layout. The long-removed Reports export packet finally left the feature list and the overview loop.

### Added — 2026-08-15 — Pipeline end-to-end tests and the one-time Velora data migration

**`e2e/tests/pipeline-board.spec.ts`, `e2e/tests/pipeline-form.spec.ts`** — Playwright coverage for the whole Pipeline surface: board render (KPI bar, all nine stage columns, per-column value sums), cross-stage drag-and-drop with reload persistence, the Won confirmation dialog (cancel and confirm paths, including the resulting activity entry), view switching with `?view=` URL persistence, keyboard navigation from any card to its detail page, create/edit through the form modal, detail-page notes and links, the full three-step Excel/CSV import flow (template download included), and permission gating of the create/import affordances for view-only users.

**`backend/scripts/import-velora.ts`** — the one-time data migration from the standalone Velora tracker: copies opportunities, their activity history, and links verbatim (same ids, same timestamps, same per-stage ordering), matches Velora profiles to existing Solvro users by email (never creating accounts — unmatched people are reported and their deals import unassigned), understands both Velora's current and legacy stage vocabularies, derives `won_at` for won deals from their last update (the tracker never had a won-date column — this mirrors its own KPI proxy), refuses to run against the wrong database or without an explicit confirmation flag, and is idempotent — a re-run updates rather than duplicates. Run summaries report per-table counts, unmatched profiles, and ordering anomalies.

### Added — 2026-08-15 — Pipeline analytics fold-ins and the won-deal handoff

**`frontend/src/pages/Overview.tsx`, `frontend/src/pages/Executive.tsx`, `frontend/src/components/pipeline/`** — the dashboards learn about the pipeline, for users holding `pipeline:view`: Overview gains a Pipeline panel (pipeline value, active deals, won this month, an On-Hold count that turns amber when non-zero, and a compact stage distribution) linking through to the board; Executive gains a full analytics section — a stage-by-stage conversion funnel, a PIC leaderboard and sortable performance table (default: won value descending; its "Active" column is labeled "Active (incl. On Hold)" to say exactly what it counts), a 12-month created-vs-won trend chart, and a per-PIC workload heatmap, with any PIC clicking through to a drill-down of their deals sorted in board-stage order. All aggregation runs client-side over the already-loaded deal list (the settled full-list pattern); "won this month" and the trend chart read the same UTC calendar month on every surface; the three funnel visualizations share one alpha-ramp source; and the charts use the `recharts` dependency the S-Curve chart already relies on — nothing new installed.

**`backend/src/routes/opportunities.ts`, `frontend/src/components/DealCard.tsx`, `frontend/src/pages/views/ProjectOverview.tsx`, `frontend/src/pages/OpportunityDetail.tsx`, `frontend/src/lib/queries.ts`** — the won-deal handoff: `POST /opportunities/:id/handoff` creates the delivery project, links it to the deal, and writes the deal's activity note in one transaction (won-only, once-only, guarded against concurrent double-handoffs; requires both project-write and deal-edit rights). In the UI, winning a deal immediately offers "Create project" — and the offer stays on the deal's page until used — opening a project form pre-filled from the deal: the description follows the PRD's `From pipeline deal: title — solution — value` format (clamped to the 2000-character project limit), the customer is soft-matched by name into a required picker, and background list refreshes never wipe what the user has typed. The handoff reuses the exact same request schema as plain project creation (now exported from the projects route, so the two can never drift), a lost race against a concurrent handoff reports its accurate reason, and completing one refreshes the Overview, Customers, and Executive dashboards immediately. A linked deal shows "View project" instead, and the project's Overview tab shows a Deal card linking back to its source deal. 21 new tests across the transaction, concurrency, and prefill logic.

### Added — 2026-08-15 — Pipeline Excel import and the Admin import history

**`backend/src/routes/opportunities.ts`, `backend/test/opportunityImport.test.ts`** — bulk opportunity import: `POST /opportunities/import` takes client-parsed spreadsheet rows and validates each one server-side (required fields, numeric bounds, stage literals — Hold is not importable, matching the reference app; case- and spacing-insensitive stage matching), skips duplicates by title + customer (against existing deals and within the batch), appends valid rows to the bottom of their stage, stamps `won_at` on rows imported directly into Won, seeds an optional first activity note per row, and records one import-log entry per run. Import rows obey the same field-length limits as manual entry (an over-length row is reported with the exact limit, never truncated — so an imported deal can always be edited later), deleting a deal now closes the ordering gap it leaves in its stage (so later creates and imports never collide with a surviving card), and a failed import run stores a generic log message while the raw error stays server-side. `GET /opportunities/imports` serves the history. 23 new backend tests.

**`frontend/src/components/PipelineImportDialog.tsx`, `frontend/src/components/pipeline/importParse.ts`, `frontend/src/pages/Pipeline.tsx`, `frontend/src/pages/Admin.tsx`, `frontend/src/lib/queries.ts`** — the Import button (next to "New opportunity") opens a three-step dialog: download a generated `.xlsx` template, pick a workbook or CSV and preview every parsed row with its validation verdict, then import and see per-row results. Parsing runs client-side (43 unit tests) and the server re-validates everything: deadlines get a real calendar check (`31/13/2026` is rejected, not reformatted), deal values understand Indonesian digit grouping (`1.500.000.000` reads as one and a half billion, ambiguous groupings are rejected rather than guessed, and a leading minus fails validation instead of vanishing). The dialog moves focus with each step, announces progress to assistive tech, waits for the PIC list before accepting a file, and reports rows rejected before upload alongside the server's per-row results. Admin gains a Pipeline tab listing every import run — when, who, row counts, and outcome. Keyboard users can open any deal from every view (titles are real links), and the detail page gained the app's standard focus indicators.

**Dependencies** — `xlsx` (SheetJS) joins the frontend, lazy-loaded only when the import dialog opens so the parser never lands in the main bundle. It is the only new dependency this integration introduces.

### Added — 2026-08-14 — Pipeline views, deal detail, and the opportunity form

**`frontend/src/pages/views/PipelineList.tsx`, `PipelineSwimlane.tsx`, `PipelineQuarter.tsx`, `frontend/src/pages/Pipeline.tsx`, `frontend/src/components/pipeline/`** — the Pipeline page grows from a lone board into a four-view workspace behind a URL-persisted switcher with one shared KPI bar: a sortable List on the vendored data-grid (Opportunity, Stage, value, PIC, Win%, Produk, request date, and an overdue-highlighted deadline), a read-only Swimlane (one row per PIC plus Unassigned against every stage except Drop, sticky headers on both axes — the reference app's own swimlane silently mis-rendered its Hold column; this one implements the stated rule), and a Quarter view grouping deals into Q1–Q4 of the current year by request date with a catch-all bucket for missing or other-year dates. Dates on every Pipeline surface use Indonesian short-date formatting (`30 Jun 2026`), and the KPI funnel's click-to-scroll applies on the Kanban view only.

**`frontend/src/components/OpportunityFormModal.tsx`, `frontend/src/pages/OpportunityDetail.tsx`** — deals are now created, inspected, and edited natively: a create/edit modal (stage selectable only at creation — stage changes on an existing deal ride the move flow), and a detail page at `/pipeline/:id` with a stage-change menu (Won/Drop confirmations included), PIC/date/win-probability/lead-source metadata, reference links (add/edit/delete, permission-gated), an activity timeline with a note composer, Edit, and permission-gated Delete. A "New opportunity" button sits in the page header and the board's empty state, and deal cards or list rows in every view click through to the detail page.

### Added — 2026-08-14 — Pipeline board: the first Pipeline module screen

**`frontend/src/lib/queries.ts`, `frontend/src/lib/pipelineFormat.ts`, `frontend/src/components/StageChip.tsx`** — the Pipeline frontend foundations: a `pipelineKeys` query namespace with list/detail/activities/links queries, CRUD and activity/link mutations, and an optimistic board-move mutation that mirrors the server's per-stage ordering; Indonesian Rupiah formatting helpers (full and compact, matching the reference app's `jt`/`M` tiers exactly) plus stage label/order constants; and a bespoke `StageChip` mapping the nine stages onto the existing chip tone system (Hold carries a pause glyph).

**`frontend/src/components/pipeline/`, `frontend/src/pages/Pipeline.tsx`, `frontend/src/App.tsx`, `frontend/src/lib/navCommands.ts`, `frontend/src/components/PipelineGuard.tsx`** — the Pipeline board ships: a nine-stage Kanban of opportunities on the same vendored kanban engine as the task board (pure data adapter + drag-commit mapper), drag-and-drop stage changes gated by the caller's own edit permissions with a confirmation prompt before a deal lands in Won or Drop, per-column value sums, "held from" cues on Hold cards, and a KPI bar (total pipeline value, deadlines due within 7 days, won this month reading `won_at`, active PICs, and a clickable stage funnel). The `/pipeline` route is gated by the `pipeline:view` permission and joins the sidebar and ⌘K palette; the List, Swimlane, and Quarter views arrive next. 35 new frontend unit tests cover the adapter, drag-commit mapping, KPI math, and drag-permission gates.

### Added — 2026-08-14 — Pipeline module foundations: data model, permissions, and the opportunity API

**`backend/prisma/schema.prisma`, `backend/prisma/migrations/`** — the Pipeline module's data model lands natively: `Opportunity`, `OpportunityActivity`, `OpportunityLink`, and `PipelineImportLog` tables with a nine-value stage enum matching the reference app's live schema (`assessment` → `rfp` → `poc` → `technical_clarification` → `deliver_proposal` → `waiting_response` → `won`/`drop`/`hold`; enum order is the board's column order). `Opportunity` also carries `request_date` (when the request came in, same plain-calendar-day semantics as `deadline`) and `pre_hold_stage` (the stage a deal was in before being put on Hold, so leaving Hold can restore it). Opportunity ids are UUIDs so the one-time data import from the old Velora tracker can copy rows verbatim; `won_at` records when a deal entered Won; `project_id` is the future won-deal handoff link to a Solvro project.

**`backend/prisma/seed.ts`, `frontend/src/lib/auth.tsx`, `backend/test/testAuth.ts`** — pipeline permissions: the SA role now grants `pipeline:view`, `pipeline:create`, `pipeline:edit_own`, and `pipeline:delete_own`; all six `pipeline:*` strings (including the `_all` pair) are available in Admin → Roles for custom roles such as an SA-Manager. The test-auth mirror of the role catalog follows suit.

**`backend/src/routes/opportunities.ts`, `backend/src/routes/opportunityItems.ts`, `backend/src/lib/pipelineAccess.ts`, `backend/src/app.ts`, `backend/test/`** — the opportunity API: CRUD plus a dedicated `move` endpoint that is the single writer of stage changes — it resequences a deal within its stage (new deals append at the bottom, matching the reference app), sets/clears `wonAt` on entering/leaving Won (creating a deal directly into Won stamps it too), records `preHoldStage` on entering Hold so leaving Hold can restore it, and logs a stage-change activity note; plain edits reject `stage`, `stageOrder`, and `preHoldStage` outright, and an invalid PIC reference returns a 4xx instead of an error page. Activity notes (any pipeline viewer may log one) and reference links (list/create/edit/delete, restricted to the deal's PIC or holders of full pipeline-edit access) ride on their own router, sharing one ownership-gate module. Deal visibility is global for `pipeline:view` holders; ownership gates writes only. `deadline` and `requestDate` travel as plain `yyyy-MM-dd` calendar days in both directions, and `dealValue` (stored as BigInt) serializes as a number. 44 backend tests cover transitions, Hold bookkeeping, ordering, date round-trips, permission gates, and serialization.

### Changed — 2026-08-14 — Pipeline integration pivots to a native port; the same-day "one address" infra is reverted

**`frontend/nginx.conf`, `frontend/vite.config.ts`, `setup.sh`** — the Velora integration approach changed the same day it first landed (PR #146): instead of running Velora as a separate backing service behind a `/pipeline-api` proxy, its features will be ported natively into this codebase (Prisma models, Express routes, React pages). The `/pipeline-api` proxy (nginx + Vite) and `setup.sh`'s Velora provisioning (the `velora-app`/`velora-cron` services, the dedicated `velora` database and role, and the `CRON_SECRET`/`VELORA_DB_PASSWORD`/`SECURE_COOKIE`/`VELORA_IMAGE`/`VELORA_PORT`/`SKIP_VELORA` handling) are reverted before any production deploy consumed them. One piece is kept: the PWA service worker's `navigateFallbackDenylist` for `/api/` — a pre-existing gap independent of the proxy, where a browser navigation under `/api/` got the cached app shell instead of the network. The local dev stack keeps its Velora services as a behavior reference and one-time data source for the upcoming port; they are not part of the deployable stack.

### Fixed — 2026-08-07 — Two end-to-end tests failed for reasons unrelated to the behavior they cover

**`e2e/tests/date-picker.spec.ts`** — the Jakarta-timezone date-picker regression pins the Gantt tree's date label after picking day 5 and day 6 of the browser's current month, and expected that label to read exactly `05 <Mon> – 06 <Mon>`. From the 7th of a month onward that range is in the past, so the Dates cell appends its screen-reader `(overdue)` cue and the assertion failed — the test passed only during the first six days of any month. The expectation now derives whether the cue is present from the same browser-side clock the app itself reads, so it stays exact on either side of the date.

**`e2e/tests/kanban-dnd.spec.ts`** — the subtask-reorder case found the displaced row by accessible name (`/Sub one/`). Once subtask rows gained an editable title button and a rename control, three elements in one row carried that name and the query became ambiguous. The row is now matched by its sortable-item marker, which is the element the drag transform is applied to.

### Fixed — 2026-08-07 — Gantt PDF export used a fixed A4 sheet, squeezing large schedules and cutting task names

**`frontend/src/lib/gantt/exportPdf.ts`** — the chart page was always A4 landscape (842 × 595 pt) no matter how big the schedule was, so a project with many tasks had its rows compressed toward the 11 pt minimum row height and a long date range was split across pages. The chart sheet is now cut to the chart itself: the page height is the sum of the real row heights, the page width is the whole exported date range at the normal column width, and the schedule lands on a single page. A4 landscape remains the minimum so a small project still exports as an ordinary sheet, the PDF format's own 200-inch page ceiling is respected, and a schedule beyond that ceiling falls back to the previous compress-then-paginate behavior. The task table on the final page keeps its own A4 landscape sheet, since it gains nothing from the wider chart page.

Task names in the left column also stopped being cut off. A name too long for the column ("Setup and Config Amazon Elastic Contai…") now wraps onto further lines and the row grows to hold them, up to four lines; the column width itself is unchanged, so no single long name steals width from the chart. Bars keep one constant height and sit centered in the row, so a taller row means more room for its name rather than a fatter bar. **`frontend/src/lib/gantt/exportPdf.test.ts`** — new tests that read the page dimensions back out of a generated PDF, covering the tall, wide, small-project, and wrapped-label cases.

### Fixed — 2026-08-07 — Task side panel: subtasks could be added but never edited

**`frontend/src/components/TaskPanel.tsx`, `frontend/src/pages/ProjectDetail.tsx`** — a subtask row in the task side panel rendered its title as static text, so the panel offered no way to rename a subtask, delete one, or reach any of its other fields; the only writes available were the done toggle, drag-reorder, and the Add-subtask form. Subtask titles are now buttons that open that subtask in the same panel, where every field is editable — matching the List view, which already routed subtask clicks there — and a hover-revealed rename control edits the title in place without leaving the parent. A subtask's panel shows a breadcrumb back to its parent, deleting a subtask returns to the parent instead of closing the panel, and the Subtasks block is hidden on a subtask entirely, since the maximum nesting depth is one and an Add-subtask form there could only produce a rejected request. **`e2e/tests/subtask-edit.spec.ts`** — new spec covering inline rename, cancel-without-saving, a cancelled rename not swallowing the next one, subtask delete returning to the parent, breadcrumb navigation, and the absence of the Add-subtask form on a subtask. **`e2e/fixtures/seed.ts`** — exports a shared `createTask` helper for specs that need throwaway tasks beyond the seeded fixture.

### Fixed — 2026-08-03 — Project Overview: Status breakdown / Top open risks panels overflowed the viewport

**`frontend/src/pages/views/ProjectOverview.tsx`** — the Overview's right-hand panel column used an implicit grid column, which sizes to its content's minimum width; a long non-wrapping risk description therefore pushed the Status breakdown and Top open risks panels past the page edge instead of truncating. Both the panel-row grid and its nested column now declare `grid-cols-1` (`minmax(0,1fr)` tracks), so the panels stay inside the layout and long risk text ellipsizes as intended.

### Removed — 2026-08-03 — Gantt tree "Due" column (redundant with the Dates range)

**`frontend/src/components/gantt-v2/SolvroGantt.tsx`, `frontend/src/components/gantt-v2/TreeCells.tsx`** — the standalone Due column shipped earlier in this cycle duplicated the end of the editable Dates range; it is removed, and its overdue treatment (red + bold + screen-reader cue, hover-safe) now lives on the Dates cell itself. The tree pane's default/max widths shrink accordingly (558/834 → 498/774) under a new width storage key: widths persisted during the Due-column window migrate down one time (−60px) so the reclaimed space actually appears, and the older-key migrations adjust to match. The `isTaskOverdue` predicate and its tests are unchanged. **`e2e/tests/gantt-parity.spec.ts`** — width-migration expectations updated to the new key.

### Changed — 2026-08-03 — Gantt toolbar controls unified into segmented pill groups

**`frontend/src/components/gantt-v2/SolvroGantt.tsx`** — the toolbar's remaining controls (Add Task/Section, Today + navigation + period title, Baseline pair, Color by, Export) now sit in segmented pill containers matching the Day/Week/Month/Quarter scale selector, replacing the individually outlined buttons. Behavior, disabled states, and keyboard focus are unchanged; the Baseline show/hide toggle additionally reports `aria-pressed`. Every group now renders at the same fixed height, so the toolbar reads as one consistent row instead of visibly mismatched card sizes.

### Added — 2026-08-03 — Gantt tree rows: action menu (Edit / Add subtask / Delete)

**`frontend/src/components/gantt-v2/SolvroGantt.tsx`, `frontend/src/pages/views/ProjectGantt.tsx`** — task rows gained an action menu, opened by right-click or a hover-revealed "…" button: Edit opens the task modal, Add subtask opens the create modal pre-parented (offered on top-level rows only — subtasks cap at one level), Delete confirms first and cascades to subtasks. Hidden for read-only users and on section rows. **`frontend/src/components/ui/context-menu.tsx`** — menu shadows now use the sanctioned `shadow-overlay` token and z-index moved onto the Positioner (Base-UI stacking-context convention); the Gantt export dropdown received the same shadow fix. **`e2e/tests/gantt-parity.spec.ts`** — new row-menu interaction test.

### Added — 2026-08-03 — Gantt tree: status dot, status chip column, overdue-aware due-date column

**`frontend/src/components/gantt-v2/TreeCells.tsx`, `frontend/src/components/gantt-v2/SolvroGantt.tsx`** — every task row in the Gantt tree now shows a colored status dot before its name, a status chip column, and a due-date column that turns red with a bolder weight (plus a screen-reader cue) when an open task is past its due date — calendar-day semantics, DONE tasks never flag. To fit the new columns the tree pane's default width grows 364 → 558 and its max 640 → 834; previously persisted widths migrate one time under a new storage key, so existing layouts keep their title text room. **`e2e/tests/gantt-parity.spec.ts`** — splitter and width-migration tests updated to the new key and math.

### Added — 2026-08-03 — Gantt toolbar: prev/next navigation and a live period title

**`frontend/src/components/gantt-v2/SolvroGantt.tsx`** — prev/next arrows join the Today button, and a period title (e.g. "July 2026") now names the visible window, tracking both navigation and infinite-scroll panning via the engine's own navigation hook. Step through the timeline without dragging.

### Changed — 2026-08-03 — Gantt task bars: hatched remainder, squared rollup caps; floating zoom enabled

**`frontend/src/components/gantt-v2/SolvroBar.tsx`, `frontend/src/lib/gantt/palette.ts`** — a task bar's incomplete portion now renders as a diagonal hatch of the bar's own color over an opaque composite base (labels stay readable) instead of a flat black overlay on the completed portion; done tasks stay fully solid, 0%-progress tasks fully hatched. Section rollup bars changed from a full-width rounded pill to a thin summary bar with squared end caps at the section's true date extents. The PDF export keeps its previous progress-overlay treatment and rounded rollup pill — two accepted screen/export divergences for now.

**`frontend/src/components/gantt-v2/SolvroGantt.tsx`, `frontend/src/components/reui/gantt/gantt-view.tsx`** — the engine's bottom-right floating +/− zoom widget (continuous 0.5–3× column-width zoom) is no longer suppressed; its `shadow-sm` is removed per the no-shadow elevation doctrine.
### Removed — 2026-08-03 — Reports page and its export-packet builder

The Reports screen (pick an active project → generate a markdown packet for an external AI tool) is retired: it no longer has a place in the current workflow.

- **`frontend/src/pages/Reports.tsx`** — deleted, with its route in `App.tsx`, its Sidebar/⌘K entry in `lib/navCommands.ts` (tests updated), and its `reports` breadcrumb label in `components/layout/TopBar.tsx`.
- **`frontend/src/lib/export/`** — the whole module (`projectExport.ts` + test) deleted; the Reports page was its only consumer. The INTERNAL/CUSTOMER_FACING note-visibility contract is unchanged — `ProjectNote.visibility`, the Daily Review toggle, and the backend notes routes all stay, so a future export surface can rebuild on them.
- **`frontend/src/lib/auth.tsx`** — the now-orphaned `report:read` permission removed from the role-editor catalog (`report:executive` and the Executive dashboard are unrelated and stay). Custom roles that stored `report:read` keep the string harmlessly; nothing checks it anymore. **`backend/prisma/seed.ts`, `backend/test/testAuth.ts`** — the dead `report:read` grant dropped from the seeded STAKEHOLDER role for the same reason.
- **`frontend/src/pages/DailyReview.tsx`** — the customer-facing toggle's tooltip and confirmation callout no longer promise the export packet; they now say the note is safe to share outside the team. **`backend/src/routes/projects.ts`, `backend/prisma/schema.prisma`** — comment-only rewording of the note-visibility contract off the deleted packet (no schema or migration change).

### Changed — 2026-08-03 — Project Overview tab: attention/status/risk panels fill the empty lower half

**`frontend/src/pages/views/ProjectOverview.tsx`** — the Overview tab now uses the space below the S-Curve for three panels: **Needs attention** (open tasks overdue or due within 7 days, sorted most-urgent first, capped at 6 with a "more in List" link; rows deep-link to the task panel via `?task=`), **Status breakdown** (segmented done/in-progress/to-do bar with counts), and **Top open risks** (three highest probability×impact scores, reusing the risks grid's score badge; links to the Risks tab). Polish in the same pass: the project description now opens the tab (it left the page header earlier today), the Completion KPI gained a thin progress bar, KPI hints step down to `text-xs`, and the S-Curve's current line gained a subtle primary area fill (`LineChart` → `ComposedChart`). All data comes from the existing `useProjectTasks` / `useProjectRisks` hooks — no new endpoints.

### Changed — 2026-08-03 — Project description moved from the page header to the Context sidebar

**`frontend/src/pages/ProjectDetail.tsx`** — the description paragraph is removed from the meta row above the tabs; the row now holds only the SA → TAM roles line and the actions, freeing vertical space for the tab content. **`frontend/src/components/layout/RightSidebar.tsx`** — the Context sidebar's description loses its `line-clamp-3` and now shows the full text.

### Removed — 2026-08-03 — Secure Ingestion Port cancelled; Blueprint remnants deleted

The planned SA-blueprint webhook (`POST /webhook/blueprint`) is cancelled: Solvro is a TAM-only tool for now, with no Solution Architect ingestion path. The feature was never built — this removes its dormant scaffolding.

- **`backend/prisma/schema.prisma` + migration `20260803000000_remove_blueprints`** — dropped the never-written `Blueprint` model and its empty `blueprints` table (plus the `Project.blueprints` relation). The table had zero rows and zero writers; its only reader was the project-detail `_count`.
- **`backend/src/routes/projects.ts`, `frontend/src/lib/queries.ts`** — `_count.blueprints` removed from the project-detail include and its TypeScript type.
- **`frontend/src/components/layout/RightSidebar.tsx`** — removed the "Blueprint reference" card (hardcoded "SA Blueprint v2.4" placeholder linking to a non-existent docs URL) and its two unused props.
- **`frontend/src/components/gantt-v2/SolvroBar.tsx`** — removed the dormant AI-Breakdown amber-ring hook (`data-ai-breakdown` + `ring-chip-amber-text` on a `blueprintId` field that never existed); it could never fire. **`frontend/src/lib/auth.tsx`** — dropped the stale `blueprint:*` mention from the permission-catalog comment.
- **`README.md`** — intro reworded to the TAM-only scope; the Secure Ingestion Port bullet removed from the Roadmap.

The SA user role, `Project.saId`, and the SA stakeholder row stay — role-based access is unrelated to the ingestion webhook.

### Fixed — 2026-08-02 — Backend tests start from a clean database; dead diagram CSS removed

**`backend/test/globalSetup.ts`, `test/env.ts`** — the backend suite now truncates every table in the isolated `solvro_test` database before each run, killing the intermittent `taskOrdering.test.ts` failure caused by rows accumulating past the task-listing endpoint's cap across invocations. Truncation is hard-guarded to databases whose name ends in `_test` — invoked with the dev database's URL it fails loudly instead of wiping data. **`.github/workflows/ci.yml`** — the backend-tests job's ephemeral database is renamed `solvro_test` to satisfy that guard (the guard refused the old name, by design). **`e2e/tests/search.spec.ts`** — the failed-search test blocks service-worker registration: the built CI app registers a PWA worker whose fetches bypass Playwright's request mocking, so the mocked 500 never fired there.

**`frontend/src/index.css`** — removed 179 lines of unused Network Diagram CSS (a feature decided never-to-build; zero consumers verified).

### Changed — 2026-08-02 — Service Catalogue and project Risks tables on the data grid; long text wraps

**`frontend/src/components/services/ServiceCatalogueManager.tsx`, `frontend/src/pages/views/ProjectRisks.tsx`** — the last two hand-rolled tables now render on the vendored data grid with the app's grid conventions; every edit/toggle/delete flow and the risks tab's score badges, status selects, and mobile card list behave exactly as before (risk rows keep their highest-score-first default order). **`ProjectRisks.tsx`, `ProjectTimeline.tsx`** — long risk and task descriptions now wrap inside their containers instead of stretching them, preserving manual line breaks.

### Fixed — 2026-08-02 — ⌘K palette: toggle-close, failed-search message, and a scroll-lock collision

**`frontend/src/components/layout/Shell.tsx`** — a second ⌘K press now closes the palette even though its own search input holds focus; the editable-target guard now applies only to the open direction. **`frontend/src/components/CommandPalette.tsx`** — a failed search renders "Could not load results. Try again." instead of the zero-hits copy, and reopening within the debounce window can no longer flash the previous session's rows. **New `frontend/src/hooks/useBodyScrollLock.ts`** (consumed by `Modal.tsx` + the palette) — a shared ref-counted body scroll lock: closing the palette above an open modal no longer unlocks page scroll behind it. All three fixes carry new e2e regression tests.

### Fixed — 2026-08-02 — Focus/shadow stragglers unified; duplicate filter chips guarded

**`frontend/src/components/ui/scroll-area.tsx`, `reui/autocomplete.tsx`, `reui/gantt/gantt-bar.tsx`, `reui/gantt/gantt-view.tsx`, `gantt-v2/SolvroBar.tsx`** — the last carriers of the old 3px focus ring and stray shadows now use the design system's 2px primary outline and shadow-free treatment. **`frontend/src/components/reui/filters.tsx`** — adding a filter is now idempotent at every append path: a raced double-activation can no longer create two identical chips (a shared guard checks field+values before appending; the multiselect flow adopts an existing chip instead of duplicating it). The guard's matching rules are locked by a new unit-test file, and a new e2e spec covers chip-count behavior on the Tasks toolbar.

### Fixed — 2026-08-02 — Overdue follows the viewer's calendar day; the status filter is no longer discarded

**`backend/src/routes/tasks.ts`, `routes/overview.ts`, `routes/reports.ts`, `lib/portfolio.ts`, new `lib/dateBoundary.ts`; `frontend/src/lib/queries.ts`** — "overdue" now means "due before the viewer's own calendar day": the frontend sends its local day (`today=yyyy-MM-dd`, validated) with overdue-filtered task queries and with the overview/executive roll-ups, and the backend compares against that day's UTC midnight (falling back to the server's UTC day for direct API callers). Previously the backend compared against the server's exact current instant — a task due later today read as overdue — and the portfolio roll-up used the server's local midnight, which shifted with the host timezone. A task due at a non-midnight instant now also counts a full day overdue instead of rounding down to zero, and query caches key on the day, so results pick up the new day on the next visit or refresh after midnight.

**`backend/src/routes/tasks.ts`** — combining a status filter with `overdue=true` no longer silently discards the status: `status=TODO&overdue=true` returns overdue to-dos, and `status=DONE&overdue=true` returns nothing — Done tasks are never overdue. Both fixes are covered by three new backend test suites (41 tests) spanning timezone extremes and the day-boundary edges.

### Changed — 2026-08-02 — Admin's Roles and Project Override tabs join the data grid; KPI strip stops flashing zeros

**`frontend/src/pages/Admin.tsx`** — the Roles and Project Override tabs' hand-rolled tables now render on the vendored data grid with the same conventions as the Users tab (sortable columns, dense rows, loading skeletons instead of a blocking message), unifying all three tabs' panel styling. Every action flow — role rename/permissions editing, delete guards, TAM reassignment — behaves exactly as before. The KPI strip (Users, Pending, Custom roles, Inactive) shows a dash while data loads instead of asserting zeros. **`frontend/src/lib/tableSort.ts`** — the shared person-name sort helper is now properly generic instead of `any`-typed.

### Changed — 2026-08-02 — Error callouts on the vendored Alert everywhere

**24 callout sites across `frontend/src/pages/`, `pages/views/`, `components/`** (incl. the Gantt and Kanban engines' error banners) — the remaining ad-hoc error boxes now render on the vendored `Alert` (destructive variant), matching Login and the form modals: identical show/hide conditions and message text, spacing preserved. Chip/badge-style uses of the error token (risk-score badges, status pills, hover states) are deliberately unchanged — only callout boxes moved.

### Changed — 2026-08-01 — Admin users and customer-detail projects on the data grid; customer cards on Frame

**`frontend/src/pages/Admin.tsx`** — the admin panel's user table now renders through the vendored data grid: sortable name/email/role/projects/status columns with locale-aware comparison on the person columns (a codepoint sort would have placed capitalized names first), unpaginated, denser rows. Every action cell — role changes, activate/deactivate, password reset, delete, including both confirmation flows — behaves exactly as before, and inactive users keep their dimmed appearance. The Roles and Project-Override tabs' small tables are unchanged.

**`frontend/src/pages/CustomerDetail.tsx`** — the Overview tab's linked-projects table is now the vendored data grid with sortable headers (locale-aware on TAM/SA person columns) and the same dense, horizontally self-scrolling layout as the other grids. Project status now renders through the shared `ProjectStatusChip` instead of a plain uppercase text span. Tabs, notes, placeholders, and the zero-projects empty state are unchanged.

**`frontend/src/pages/Customers.tsx`** — customer card shells now compose the vendored `Frame` component instead of a hand-rolled bordered container — same radius, hairline, padding, hover, and layout; presentation-only.

**`frontend/src/lib/tableSort.ts`** (new) — a shared `personNameSortingFn`, used by the Admin user table's Name column and the customer-detail projects table's TAM/SA columns above. TanStack's auto-detected sort samples rows from index 10 onward, so any table with 10 or fewer rows is never sampled and silently falls back to raw codepoint comparison (capitalized names sort before lowercase ones); declaring this sortingFn explicitly avoids that regardless of row count.

### Changed — 2026-08-01 — Tasks list renders through the vendored data grid

**`frontend/src/pages/Tasks.tsx`** — the cross-project task list's hand-rolled table is now the vendored ReUI data grid: same filter chips, checkboxes, row-click-to-edit, loading and empty states; sorting moves onto sortable column headers (default due-ascending) with denser rows and no pagination — the full filtered list renders, and on narrow screens the grid scrolls horizontally inside its own container while the page body stays still. Column widths are content-proportional, and project-name sorting deliberately switches to natural number ordering (recorded in-code; accented characters now sort after "z").

**`frontend/src/lib/utils.ts`** (+ new **`utils.test.ts`**) — the class-merging helper now registers the design system's six named typography roles (`h1`, `h2`, `body-lg`, `body-sm`, `data-mono`, `label-caps`) as font sizes. They previously fell through to the merger's catch-all colour matcher, which could silently discard a real text colour used alongside them in vendored components — the cause of an invisible-header bug caught in review. Five regression tests lock the behavior.

**`frontend/src/components/reui/data-grid/data-grid-column-header.tsx`, `data-grid-table.tsx`** — column-header labels use the design system's label-caps role on both header paths, giving uniform 12px/700/uppercase grid headers.

### Added — 2026-08-01 — Vendored ReUI Data Grid family, Badge, and three primitives (first migration dependencies)

**`frontend/package.json`** — three new dependencies, user-approved 2026-08-01: `@tanstack/react-table` + `@tanstack/react-virtual` (headless table logic and row virtualization for the vendored data grid) and `@dnd-kit/modifiers` (drag-constraint helpers its column/row drag uses). These are the first dependency additions of the ReUI migration; the lockfile is written from inside the dev container, not the host — host and CI npm versions disagree about lockfile shape.

**`frontend/src/components/reui/data-grid/`** (new directory, 10 files) — the ReUI data-grid family: grid context, table + virtualized renderers, sortable column headers, column filters/visibility, pagination, drag helpers, scroll wrapper. Local deviations are marked `// SOLVRO PATCH`: the registry's icon-placeholder build artifact was replaced with lucide icons; the pinned-column separators used an inset shadow with an undefined custom property (it silently painted nothing, upstream included) and hardcoded-rgba pinned-row shadows — both replaced with real hairline borders; all bare border utilities were paired with the hairline token; a decorative shadow was dropped; dead generics and an unsupported submenu prop were cleaned.

**`frontend/src/components/reui/badge.tsx`** — status badge riding the tone tokens added earlier in this release; the orphaned "focus" variants were dropped (their tokens exist nowhere, upstream included), and tint-variant text follows the app's text-on-tint convention.

**`frontend/src/components/ui/select.tsx`** (hand-authored on Base UI — the upstream registry version is Radix-based and ReUI's re-export is license-gated), **`ui/skeleton.tsx`, `ui/spinner.tsx`** (shadcn registry, verified Radix-free). Consumers land with the table migrations in this release.

### Fixed — 2026-07-31 — Cross-project task specs follow the chip filter flow

**`e2e/tests/kanban-dnd.spec.ts`**, **`e2e/fixtures/seed.ts`** — the modal-path specs scoped `/tasks` through the old customer `<select>`, which the filter-chip toolbar replaced, so three tests timed out looking for a control that no longer exists. The shared helper now drives the chip flow (open "+ Filter", pick Customer, pick the fixture customer by display name), and the seed fixture exposes the customer's display name alongside its id for that purpose.

### Fixed — 2026-07-31 — Popup menus no longer draw a text-colored border

**`frontend/src/components/ui/dropdown-menu.tsx`, `context-menu.tsx`, `popover.tsx`** — every popup surface carried a bare `border` with no color source, so the border fell back to the text color: a near-white outline in dark mode and near-black in light. All five popup class lists now use the standard hairline (`border-border` → `outline-variant`), matching every other bordered surface in the app.

### Fixed — 2026-07-31 — Vendored controls forward refs on React 18; date-picker keyboard focus restored

**`frontend/src/components/ui/button.tsx`, `input-group.tsx`** (with the earlier `input.tsx`/`textarea.tsx` fixes) — the vendored controls now forward refs (`React.forwardRef`); the upstream registry targets React 19, where refs are plain props, so on this project's React 18 every ref silently arrived null. Restored behavior: keyboard navigation in the date pickers now moves focus to the highlighted day (the calendar always had this code — its ref was dead), the filter menus' anchor refs are live, and the "Function components cannot be given refs" console warning is gone.

### Changed — 2026-07-31 — Filter chips replace the dropdown filter rows on Tasks and Projects

**`frontend/src/pages/Tasks.tsx`** — the cross-project task list's four always-visible dropdowns (status, priority, assignee, customer) are now filter chips added on demand from a single "+ Filter" control, backed by the vendored Filters component. The overdue and top-level checkboxes, column sorting, and the Reset behavior are unchanged, and filter requests to the server keep their exact previous shape, so cached results stay valid.

**`frontend/src/pages/Projects.tsx`** — the customer filter is the same chip control instead of a plain dropdown. Deep links with `?customerId=`, clearing the filter, and the automatic reset when a customer no longer exists all behave exactly as before.

### Changed — 2026-07-31 — One focus style for all vendored form controls

**`frontend/src/components/ui/button.tsx`, `checkbox.tsx`, `calendar.tsx`, `input.tsx`, `textarea.tsx`, `input-group.tsx`** — every vendored form control now uses the design system's focus treatment — a 2px primary outline at 30% opacity — replacing the mixed 3px half-opacity ring the vendored files shipped with. The remaining drop shadows in `button` (outline variant), `checkbox`, and `calendar` were removed (shadows are reserved for overlays), and text inputs sit on the standard deepest-inset surface with the same small radius as every hand-written form field. Focused controls across the app now match the form modals.

### Added — 2026-07-31 — Vendored ReUI Filters and six form primitives

**`frontend/src/components/reui/filters.tsx`** (new) — vendored ReUI's Filters chip-toolbar system (Base UI + class-variance-authority; zero npm dependency changes). Local deviations are marked `// SOLVRO PATCH`: the upstream demo's icon placeholder was replaced with lucide icons, and a submenu `side` prop that Solvro's dropdown does not forward was dropped (Base UI already opens nested submenus on the inline-end side); the filter chip's `sm`/`lg` control heights were aligned to the app's button ladder, and an upstream radius formula that relies on a custom property this codebase does not define was replaced with the standard small radius. Three later additions: when a field pins a single operator, the chip renders a compact static "is" segment instead of a dropdown that could never change anything; the default "+ Filter" trigger inherits the toolbar's size so the whole row shares one control height; and when only one filterable field is available — always on Projects, or on Tasks once the other fields are chipped — "+ Filter" opens that field's option list directly instead of a one-item field menu.

**`frontend/src/components/ui/button-group.tsx`, `input.tsx`, `input-group.tsx`, `kbd.tsx`, `textarea.tsx`** (new) — generic form primitives vendored from the canonical shadcn registry (ReUI's re-export of these is license-gated); drop shadows stripped per the design system, and `button-group` drops the upstream Slot-based `asChild` composition (unused by the filter toolbar; matches how the project's other Base-UI primitives dropped it). **`frontend/src/components/ui/separator.tsx`** (new) — hand-authored on Base UI's Separator because the upstream registry version is Radix-based, which the project's Base-UI-only rule forbids. These components are consumed by the Tasks and Projects filter-toolbar updates in this release.

### Changed — 2026-07-31 — Empty states, the Timeline tab, and form errors render on the vendored ReUI components

**`frontend/src/components/EmptyState.tsx`** — the shared empty-state placeholder now composes the vendored `Frame` and `IconTile` instead of a hand-rolled div: same dashed `outline-variant` border, small radius, muted surface, and centered layout (verified at desktop and 375px widths in both themes); the glyph now sits in a quiet bordered tile sized to the tile's proportions. The props API is unchanged, so the five consuming views are untouched (`Projects.tsx` defines its own local empty state and never imported the shared one).

**`frontend/src/pages/views/ProjectTimeline.tsx`** — the Timeline tab renders its task list on the vendored ReUI `Timeline` primitives (spine, dot indicators, separators) instead of a hand-rolled line-and-dot layout, keeping the previous 16px card rhythm and keeping list semantics intact for screen readers. Task ordering, overdue highlighting, the status buttons, and the edit dialog are unchanged; the DONE indicator now uses the theme-aware chip-emerald token instead of a fixed palette green, the tab's empty placeholder reuses the shared `EmptyState` component, and the vendored component's built-in step-highlighting is disabled because this view has no notion of a "current step".

**`frontend/src/pages/Login.tsx`**, **`frontend/src/components/TaskFormModal.tsx`, `ProjectFormModal.tsx`, `CustomerFormModal.tsx`, `RiskFormModal.tsx`** — form-error messages now render in the vendored `Alert` (destructive variant) instead of ad-hoc colored boxes, with identical show/hide conditions and message text. Messages use the alert's description slot rather than its title slot (whose one-line clamp would have truncated long API error text), and the vendored alert's destructive variant was patched so the message text renders in the error palette rather than muted grey.

### Added — 2026-07-31 — Vendored ReUI presentation components (Timeline, Alert, Frame, IconTile, IconStack)

**`frontend/src/components/reui/timeline.tsx`, `alert.tsx`, `frame.tsx`, `icon-tile.tsx`, `icon-stack.tsx`** (new) — vendored the five ReUI presentation components (Base-UI + class-variance-authority; zero new dependencies). Local deviations are marked `// SOLVRO PATCH`: drop shadows were removed from `Frame` and `IconTile` (the design system reserves shadows for overlays), the `Alert` `default` variant gained an explicit `border-border` (upstream leaves that variant's hairline at `currentColor`), the `Alert` `destructive` variant colors its message text with the error palette (upstream leaves it muted grey), and dead class fragments that ship in the upstream `frame` registry item were deleted.

**`frontend/src/index.css`** — the shadcn semantic bridge gained `--color-success`, `--color-info`, `--color-warning`, `--color-invert`, and `--color-invert-foreground`, each aliasing an existing theme token (the chip emerald/amber/violet text values and the inverse-surface pair) so `Alert`'s variants render from the established palette in both light and dark mode; no new custom properties were introduced. These components are consumed by the empty-state, timeline, and form-error updates in this release.

### Changed — 2026-07-31 — Corrected the PDF-in-tab code comment

**`frontend/src/lib/gantt/exportPdf.ts`** — the comment above the browser-viewer branch attributed production's failing Gantt export downloads to a Safe Browsing check stalling on the plain-HTTP origin, and cited a planning document that has since moved. Both were wrong: Chromium-family browsers block downloads that originate from a non-trustworthy origin, independently of Safe Browsing, of network reachability, and of file type — which is why opening the PDF in a tab still works. The comment now records that cause and drops the stale path. Comment only; export behaviour is unchanged.

### Fixed — 2026-07-30 — Gantt tree pane shows task start/due dates (#118)

**`frontend/src/components/gantt-v2/SolvroGantt.tsx`** — the tree pane's name column previously mirrored the engine's 208px default and absorbed all splitter drag on top of it, which pushed the fixed-width "Dates" (132px) and color (24px) columns past the pane's right edge at every pane width — start/due dates were clipped by default, and widening the pane never revealed them (GitHub issue #118). Three coordinated changes: (1) the name column is now the pane remainder after the fixed columns (`treeWidth − 156`, floored at its 100px minimum), so the columns fit inside the pane and splitter drag still widens the title 1:1; (2) the default pane width widened 288 → 364, so a first-visit gantt keeps the same 208px title room as before while also showing the full `DD/MM – DD/MM` range and the section color swatch; (3) persisted pane widths migrate once from the `solvro.gantt.treeWidth` localStorage key to `solvro.gantt.treeWidth.v2` at +76px (clamped to the 640px pane max), preserving each user's title width exactly; the old key is left in place. The two column widths moved into named constants (`TREE_DATES_COLUMN_WIDTH`, `TREE_COLOR_COLUMN_WIDTH`) shared by the sizing formula and the column definitions. Known residuals: a pane deliberately narrowed below 256px clips the fixed columns again, and on narrow desktop viewports (~768–850px) the engine can render the pane narrower than the configured width without reporting it, so a wide persisted width can still clip the columns there.

**`e2e/tests/gantt-parity.spec.ts`** — regression guards for #118: at the default pane width, a task row's Dates and color cells must end inside the tree pane and the date range must render untruncated; a legacy `solvro.gantt.treeWidth` value must migrate +76 into the v2 key. The existing splitter test's persistence reads follow the new key, and its comments describing the old width formula were refreshed.

### Changed — 2026-07-30 — Subtask-reorder e2e spec follows the drag-handle flow

**`e2e/tests/kanban-dnd.spec.ts`** — the TaskPanel subtask-reorder test now reorders through the drag handle's keyboard flow (focus the handle → Space → ArrowUp → Space) instead of the removed up/down arrow buttons, keeping its original position and parent assertions. The handle locator matches the accessible name exactly, because the drag library also exposes each row as a button whose accessible name contains the handle's label. Each keyboard step syncs on an observable drag signal (live-region activity for pickup, then the displaced sibling row's non-zero transform for the move), so the flow stays deterministic on slow CI runners; the server position is then polled instead of read after a fixed wait.

### Added — 2026-07-30 — Vendored ReUI Sortable component

**`frontend/src/components/reui/sortable.tsx`** — vendored ReUI's Sortable drag-to-reorder engine (Base-UI + dnd-kit; zero new dependencies — all four of its runtime deps were already installed) as shared infrastructure for upcoming reorder surfaces: task subtasks and project sections. Exports `Sortable`, `SortableItem`, `SortableItemHandle` (plus the registry's `SortableOverlay`); dnd-kit's `KeyboardSensor` is wired for keyboard reordering, which each consuming surface enables by rendering the drag handle as a focusable button.

### Added — 2026-07-30 — "Reorder sections" modal in the List view

**`frontend/src/components/SectionReorderModal.tsx`** (new) — a `Modal`-based dialog (opened from `ProjectList.tsx`'s toolbar, shown once a project has 2+ sections and the user can edit) listing a project's sections as a vertically-draggable list (color dot + name + drag handle) via the vendored ReUI Sortable. Dropping a section sends a single `PATCH` for the moved section's new position; the backend re-packs every sibling, and the section list refetches on settle so the List view's section groups (which already order by `position`) pick up the new order. Keyboard reorder works the same as pointer drag: focus a row's drag handle, then Space → arrows → Space. Pressing Escape during an in-progress drag cancels the drag without closing the modal — the modal ignores close requests while a drag is active, tracked via the Sortable's drag callbacks.

**`frontend/src/lib/queries.ts`** — `useUpdateSection` now optimistically re-packs the cached section list when a `position` patch is sent (mirroring the backend's dense `0..n-1` re-pack), so the List view's group order updates instantly instead of showing a stale order until the refetch; concurrent section PATCHes for the same project are serialized so two fast drops can no longer land out of order.

### Changed — 2026-07-30 — Subtask reorder in the task panel is now drag-and-drop

**`frontend/src/components/TaskPanel.tsx`** — subtasks in the task detail panel now reorder via drag (pointer or keyboard, using the vendored ReUI Sortable) instead of up/down buttons, matching the reorder pattern already used elsewhere in the app. Read-only users see no drag affordance. Persistence is unchanged: moving a subtask still sends a single `PATCH` with its new position, and the backend re-packs its siblings.

### Changed — 2026-07-30 — `PATCH /sections/:id` re-packs sibling order on a position move

**`backend/src/routes/sections.ts`** — moving a section (`position` in the PATCH body) now re-packs the project's whole section list dense `0..n-1` inside a transaction, mirroring the existing task-reorder contract: siblings are fetched excluding the moved section, the requested index is clamped to `[0, siblings.length]`, and every section is rewritten to its new dense position. Previously the endpoint wrote the raw `position` value with no re-pack, leaving gaps and duplicate indices after a move. Name/color changes sent in the same request still apply. Lays the groundwork for the upcoming "Reorder sections" UI.

**`backend/test/sections.test.ts`** (new) — vitest coverage for the re-pack: move-to-front, move-to-back, clamping a position past the end of the list, a negative position rejected with a 400 before any re-pack runs, a name/color-only patch leaving order untouched and vice versa, positions staying dense `0..n-1` across a sequence of moves, and a position PATCH on a section in a project invisible to the caller 404ing without re-packing.

### Added — 2026-07-29 — Automated timezone regression coverage for the date-picker fix

**`e2e/tests/date-picker.spec.ts`** — added a browser-timezone regression test that opens the app under a forced `Asia/Jakarta` (UTC+7) context, picks two dates through the task date picker, and asserts the saved values are the exact UTC-midnight instants of the picked calendar days — not a day shifted backward, which is what the app used to save for users east of UTC. The test also confirms the picked days still display correctly after a page reload, in the task list, in the Gantt tree's Dates cell (desktop), and when reopening the picker. The suite's existing date-picker tests were updated to match: a helper that used to reproduce the old backward-shifting behavior for its assertions now expects the corrected behavior directly, and comments describing the old bug were rewritten as historical notes.

### Fixed — 2026-07-28 — Every task-date read path unified on the UTC date-part (date contract)

Local-timezone `new Date(iso)` parses of the four day-semantic fields (`Task.startDate`/`dueDate`/`baselineStartDate`/`baselineDueDate`) could render a different calendar day than the Gantt bar or the date picker on hosts east of UTC. All display/comparison reads now derive the day via `dayFromIso` (UTC date-part), matching the picker seeds and the Gantt engine:

- **Display labels** — `gantt-v2/TreeCells.tsx` (`isoToDate`), `pages/views/ProjectList.tsx` (`fmt`), `pages/Tasks.tsx` (`fmt`), `pages/views/ProjectTimeline.tsx` (`fmt`), `components/TaskPanel.tsx` (`fmtShort`), `components/kanban-v2/cards.tsx` (`getDuration` no-start fallback) — all via `dayToDate(dayFromIso(iso))`, identical output formatting preserved.
- **Overdue checks** — `pages/Tasks.tsx`, `pages/views/ProjectTimeline.tsx`, `pages/DailyReview.tsx`, `pages/views/ProjectOverview.tsx` — `new Date(dueDate) < today` replaced with lexicographic day-string comparison (`dayFromIso(dueDate)! < dateToDay(today)!`); existing status/null guards preserved.
- **"Today" derivation** — `pages/views/ProjectOverview.tsx`'s S-curve "today" reference (`startOfToday().toISOString().slice(0,10)` — read as *yesterday* before 07:00 UTC+7) now derives via `dateToDay(startOfToday())`. (A second UTC-clock "today", the export filename, is covered in the export entry below.)
- **Portfolio rollups** — `components/portfolio/PortfolioCalendar.tsx`'s `fmtDate` (also used by `Executive.tsx`) now derives its day via the UTC date-part of the portfolio rollup instant, matching the bars it labels — the rollup indirection (`PortfolioProjectRow.start`/`.end`, min/max of task dates server-side) had hidden it from a field-name search. The per-row `dateToDay(startOfToday())` calls in `Tasks.tsx`/`ProjectTimeline.tsx` were also hoisted to one per list render.
- Already-canonical UTC-slice readers (`gantt-v2/adapter.ts`, `GanttOverlay.tsx`, `lib/gantt/geometry.ts`), absolute-instant comparators (sorts, duration deltas), and true-instant fields (`createdAt`, `baselineLockedAt`) were audited and deliberately left unchanged.

### Added — 2026-07-28 — One-off data-normalization script for pre-fix corrupted day dates (date contract)

**`backend/scripts/normalize-day-dates.ts`** (new) — repairs `Task.startDate`/`dueDate`/`baselineStartDate`/`baselineDueDate` rows written by the pre-fix local-midnight serialization bug (see the dateField.ts entry below). Exports a pure `roundToUtcMidnight(d: Date): Date`: UTC time-of-day `>= 12:00:00.000` rounds up to the next UTC midnight (repairs the east-of-UTC write pattern, e.g. `17:00:00.000Z` → next-day `00:00:00.000Z`); `< 12:00:00.000` rounds down to same-day UTC midnight (repairs a hypothetical west-of-UTC write); exact midnight untouched. Dry-run by default (per-project counts, before→after per row, distinct-time-part summary); `--apply` performs the updates in 500-row `$transaction` batches and re-verifies 0 remaining non-midnight rows. Audit-instant columns (`createdAt`, `updatedAt`, `baselineLockedAt`, `receivedAt`, …) are never touched — only the four day-semantic columns are scanned. The `PrismaClient` is constructed inside `main()` rather than at module scope, so importing the module (as the pure-helper test does) can never open a DB connection.

**`backend/test/normalizeDayDates.test.ts`** (new) — pure-helper vitest suite for `roundToUtcMidnight` (no DB): exact-midnight, `17:00:00.000Z`/`23:59:59.999Z` round-up, `11:59:59.999Z`/`00:00:00.001Z` round-down, month/year rollover.

**Dev DB (`solvro`) — repaired** (2026-07-28): 37 non-midnight rows across 25 tasks / 16 projects, all with the expected `17:00:00.000Z` UTC+7 signature, normalized to UTC midnight; post-apply verification confirmed 0 remaining. Prod is untouched — the script must be run once against the existing deployment (`docker compose exec backend npx tsx scripts/normalize-day-dates.ts` to dry-run, then again with `--apply`); it is idempotent, so re-running is safe.

### Fixed — 2026-07-28 — Local "today" and export-overdue boundaries derive from calendar days (date contract)

**`frontend/src/components/gantt-v2/SolvroGantt.tsx`** — the baseline-lock dialog's default "as of" day now derives from the local calendar date (`dateToDay(new Date())`) instead of the UTC clock (`toISOString().slice(0,10)`), which read as *yesterday* before 07:00 on hosts east of UTC. The `baselineLockedAt` instant path is deliberately untouched (locally written, locally displayed — self-consistent).

**`frontend/src/lib/export/projectExport.ts`** — the export's overdue-task count now compares calendar-day strings (`dayFromIso(dueDate) < dateToDay(today)`, lexicographic on `yyyy-MM-dd`) instead of an ISO instant against local now, so a task due today is never miscounted as overdue near a timezone boundary. Status/null guards unchanged; note filtering (CUSTOMER_FACING-only) untouched.

**`frontend/src/lib/export/projectExport.test.ts`** (new) — first test coverage for the export module: overdue boundary cases (due-today, due-yesterday, DONE-yesterday) plus a guardrail regression test asserting an INTERNAL note never appears in export output.

The export packet's downloaded **filename** also stamps the local calendar day (`dateToDay(startOfToday())`) instead of the UTC clock date — before 07:00 on a UTC+7 host it named the file with yesterday's date — with a matching filename regression test in the suite. Note filtering (CUSTOMER_FACING-only) is untouched throughout.

### Changed — 2026-07-28 — CI + gates run the frontend suite a second time under `TZ=Asia/Jakarta`

**`.github/workflows/ci.yml`** — new step after the frontend test run repeats `npm test` with `TZ: Asia/Jakarta`. The date-contract invariant (`dateField.ts`'s UTC-midnight serialization) is indistinguishable from the old local-midnight bug under a UTC clock — the single-zone run was structurally unable to catch a regression; Asia/Jakarta (UTC+7) is the zone that exposed the original walk-back.

### Fixed — 2026-07-28 — Date pickers no longer walk task dates back one day east of UTC (date contract)

**`frontend/src/lib/dateField.ts`** — `isoFromDay` now derives the stored ISO instant from **UTC midnight** of the picked day (`${day}T00:00:00.000Z`) instead of local midnight. Root cause of the reported bug (picking 5–6 July rendered 4–5 July in the Gantt on a UTC+7 host): the writer serialized local midnight while every canonical reader (`dayFromIso`, the Gantt adapter's `slice(0,10)`) takes the UTC date-part, so east of UTC the stored day-part had already walked back one day at save time. `isoFromDay`/`dayFromIso` are now exact inverses in every timezone; the canonical rule — a task date's calendar day is the UTC date-part of its stored instant — is documented in the module doc, which drops its former "byte-identical to legacy" framing. `commitDraft`'s untouched-draft passthrough is unchanged and still load-bearing (untouched fields stay byte-identical; pre-fix corrupted instants persist until the one-off normalization script — see the entry above — repairs them).

**`frontend/src/lib/dateField.test.ts`** — the "legacy equivalence" describe block (which pinned byte-parity with the defective local-midnight helper) and its legacy fixtures are replaced by inverse-invariant tests: `isoFromDay(day) === ${day}T00:00:00.000Z` and `dayFromIso(isoFromDay(day)) === day` across the sample + DST-adjacent + leap-day sets, plus non-midnight-instant slicing. Suite verified green under both `TZ=UTC` and `TZ=Asia/Jakarta`. All other tests byte-untouched.

**`frontend/src/components/TaskFormModal.tsx`** — `passthroughDate` and its 17-line "out of scope" comment deleted; edit-mode date commits now reuse `commitDraft`, which post-fix is semantically identical (untouched passthrough + UTC-midnight emit).

Additionally, create-mode Start/Due conversion also goes through `isoFromDay` (was a hand-rolled `new Date(...).toISOString()`; byte-identical output for picker-shaped input, but unparsable input now yields `null` instead of a thrown `RangeError`), edit-mode draft seeding goes through `dayFromIso` instead of a raw `.slice(0, 10)`, `dayFromIso`'s validity probe is Z-suffixed so both ISO helpers read UTC on their face, and stale doc comments in `dateField.ts`, `dateField.test.ts` (prose only, assertions untouched), `DateRangeField.tsx`, `DateField.tsx`, and `InlineDateRangeEditor.tsx` were aligned with the new convention.

### Changed — 2026-07-28 — `.gitignore` consolidated: one `docs/` rule, dead entries dropped, root env template anchored

**`.gitignore`** — cleanup pass so the tracked surface stays exactly the app's core (`backend/`, `frontend/`, `e2e/`, `ci/`, `.github/`, `setup.sh`, `README.md`, `CHANGELOG.md`, `.gitguardian.yaml`, `.gitignore` — verified via `git ls-files` before and after; **the tracked set is unchanged by this commit**, only which *untracked* paths stay invisible):

- Seven per-subdirectory docs rules (`docs/ideas/` … `docs/superpowers/`) plus the root-doc rules (`DESIGN.md`, `ISSUES.md`, `CONFIGURATION.md`) are replaced by a single `docs/` rule. The per-subdir list ignored-by-enumeration, so any newly created docs subfolder started out trackable by accident — exactly what happened when `docs/reference/` was created during the 2026-07-28 local docs restructure (papered over machine-locally in `.git/info/exclude` at the time; that entry is now removed). All local-only docs live under `docs/`, so one rule is both complete and future-proof.
- Dead rules dropped: `UI Design/`, `PRD.md`, and `tasks/` (none exist on disk — and unanchored `tasks/` was a latent trap that would have silently ignored any future `src/**/tasks/` directory), the duplicate `frontend/{tailwind,vite}.config.js` block at the old file's tail, `backend/dist/` + `frontend/dist/` (covered by unanchored `dist/`), and `ci/.env` (covered by unanchored `.env`).
- `.env.example` anchored to `/.env.example`. The root template is deliberately local-only (it pairs with the local `docker-compose.yml`; `setup.sh` is the canonical deploy path), but the old unanchored form also matched `backend/.env.example` — which IS tracked as the public backend template and would have been silently ignored if ever deleted and re-added (proven via `git check-ignore --no-index -v` before the change).
- Comments now document the two load-bearing unanchored rules in place (`CLAUDE.md` covering the area contract files; `.env` covering every depth).
- Added `/frontend/.env.example` (follow-up commit, same PR): the anchoring above surfaced this pre-existing local file — a secret-free dev note whose only variable (`VITE_API_PROXY_TARGET`) is optional with a sensible default. Decision: not public-repo material (unlike `backend/.env.example`, which documents the required `DATABASE_URL`), so it stays local and explicitly ignored.
- Added `.superpowers/`: the skill's state directory was never covered by any repo rule — it stayed invisible only because the tool self-ignores its own directory. Now repo policy, so the local workflow layer (`CLAUDE.md` files, `.claude/`, `docs/`, `.superpowers/`, `.understand-anything/`) is ignored end-to-end by `.gitignore` alone, machine-independent.

### Added — 2026-07-28 — Playwright coverage for the ReUI date pickers (ReUI date field swap, plan Task 5)

**`e2e/tests/date-picker.spec.ts`** (new file) — e2e coverage for the date-picker components landed across this branch's Tasks 1-4 (`DateField.tsx`, `DateRangeField.tsx`, `InlineDateRangeEditor.tsx`, and `ProjectList.tsx`'s `DueDateEditor`), the final task before this branch's acceptance sweep. One `describe` block, seven tests, each seeding its own dedicated task via the API (gantt-parity.spec.ts/search.spec.ts convention) rather than mutating the shared `seededProject` fixture, plus a `beforeEach` guard that asserts Node and the browser resolve the same IANA timezone (`Intl.DateTimeFormat().resolvedOptions().timeZone`) before any test body runs — every day-string helper in this file assumes both share one zone, and a runner that sets `TZ=` for only one of the two processes would otherwise silently break every TZ-dependent assertion below with no indication why:

- **TaskPanel range flow** — opening a seeded task's panel and clicking its DATES value opens `InlineDateRangeEditor`'s range calendar immediately (`defaultOpen`); Clear + a start-day pick + a later end-day pick + Apply persists both dates (asserted via API day-part readback, TZ-agnostic) and survives a page reload (self-referential trigger-text comparison, not a hardcoded format string).
- **Due-only passthrough guard** (regression: the wipe class `DateRangeField.tsx`'s own module doc describes at length) — a task seeded with `dueDate` only (`startDate: null`), Apply with zero calendar interaction: readback is `startDate: null`, `dueDate` byte-identical to the seeded ISO — not just same-day, the exact string.
- **Milestone re-click guard** — a seeded milestone (`isMilestone: true`, `startDate === dueDate`), clicking its single highlighted day (react-day-picker's own re-click-to-deselect signal, which `nextDraftFromSelection` in `dateField.ts` explicitly ignores) then Apply: the readback (`startDate`/`dueDate` byte-identical, `isMilestone` still `true`) is the actual regression guard, not the PATCH's own `200` — `TaskPanel`'s dates-apply patch body (`patch({ startDate: s, dueDate: e })`) never includes `isMilestone`, so the backend's `isMilestone`+null-`dueDate` 400 refine (`backend/src/routes/tasks.ts`) cannot fire from this call site regardless of whether a wipe happened, meaning `patchRes.ok()` alone would stay green even on a reintroduced wipe.
- **TaskFormModal drawer flow** — opened via `ProjectTimeline`'s edit button (not the cross-project `/tasks` list, which `fixtures/seed.ts`'s own comment flags as unsafe for a freshly seeded row given its unscoped `take: 200` window): the Dates popover renders above the drawer and clicking a day does not close it (proven structurally — Drawer.tsx's backdrop-mousedown-to-close is stopped by its own inner dialog div before it can reach the popover's React-portalled content, plus the day clicks actually landing rather than hitting a covered-element actionability failure); Clear + pick + Apply updates the trigger text; Save persists both dates (UTC-midnight convention at this call site's `passthroughDate`, so day-part readback equals the picked day literally, unlike the two cases below); other fields (title/status/priority) survive untouched.
- **ProjectList direct commit** — clicking a seeded task's due-date cell, picking a different day, and PATCH persists + cell text changes (asserted via a retrying `toHaveText`, not a fixed `waitForTimeout` + one-shot `textContent()`); re-opening and re-clicking the day `DateField` itself currently shows as selected — the API-readback day-part, not the originally-picked day-of-month, since those two diverge on any host east of UTC per `isoFromDay`'s local-midnight walk-back (re-clicking the literal picked day there would be an ordinary new selection, not react-day-picker's re-click-to-deselect signal) — fires zero `PATCH`/`POST /api/tasks*` requests (`captureTaskRequests`, `fixtures/test.ts`) and leaves the value byte-identical to the first pick; a follow-up pick of a genuinely different day then asserts exactly one `PATCH` fires, pinning `ProjectList.tsx`'s separate `setDates` unchanged-value guard's "else" branch so the zero-request assertion isn't vacuous.
- **Gantt tree Dates cell** (new case) — opening the tree pane's Dates cell editor (`gantt-v2/TreeCells.tsx`'s `TaskDatesCell` → `InlineDateRangeEditor`, `defaultOpen`) on `/projects/:id/gantt` and clicking the calendar popover's own padding (`ui/calendar.tsx`'s `data-slot="calendar"` root, not a day button) leaves the popover open and does not open the "Edit task" drawer underneath — guards `DateRangeField.tsx`'s `stopPropagation` wrapper div, a hand-fixed regression (React's synthetic event system bubbles a Base-UI-portalled popover's clicks through the REACT tree, not the DOM tree, straight to the Gantt row's own `onResourceClick`) that had zero automated coverage before this case, despite this file's own header comment naming Gantt's `TreeCells` among `InlineDateRangeEditor`'s call sites since first authored.
- **Mobile calendar fit** (mobile project, viewport forced to 375px — this repo's actual mobile-support floor per CLAUDE.md, narrower than the iPhone-13 device profile's 390px default) — opening the Dates popover in `TaskFormModal` renders exactly one `.rdp-month` grid (not two — `DateRangeField.tsx`'s `numberOfMonths={isDesktop ? 2 : 1}`) and the popover's own bounding box (`[data-slot="popover-content"]`) fits fully inside the viewport width.

**Finding surfaced during authoring, not a defect in this new test:** `dateField.ts`'s `isoFromDay`/`commitDraft` derive a freshly-picked day's persisted ISO from LOCAL midnight before serializing to UTC, which walks the calendar day-part back by one on any host east of UTC (positive UTC offset) — reproduced here against a UTC+7 sandbox and independently confirmed as pre-existing, accepted, unchanged-from-before-this-plan behavior by this same CHANGELOG's 2026-07-28 "ProjectList's inline due-date editor swapped to DateField" entry (which recorded the identical walk-back against a live `Asia/Jakarta` Playwright context). The TaskPanel-range and ProjectList-direct-commit tests above compare their readback against a `persistedDayPart` helper that mirrors this exact conversion (documented inline at its definition) rather than the literal picked-day string, so the suite stays green on either side of UTC without masking a real regression in `isoFromDay` itself. `TaskFormModal`'s separate `passthroughDate` is unaffected (UTC-midnight parsing of a bare date string is TZ-independent), which is why that test's assertions compare the picked day directly.

**Fix round (this entry, same task):** a code-review pass on the first draft of this spec found that the ProjectList re-click case (above) re-clicked the originally-*picked* day-of-month rather than the day `DateField` itself currently renders as selected — on a UTC+7 host (this branch's own sandbox) those are one calendar day apart, so the case's "zero requests" outcome was actually coming from `ProjectList.tsx`'s `setDates` unchanged-value guard (`~:240-242`), not `DateField`'s re-click-to-deselect branch it claimed to guard, and neither guard was durably pinned across host timezones. Fixed by re-clicking the API-readback day-part instead, and adding a second `captureTaskRequests` block (a genuinely different day, asserting exactly one `PATCH`) so both branches of `setDates` are actually exercised. Also added: the Gantt `TreeCells` case (bullet above) closing a coverage gap this file's own header comment had claimed was covered since it was first written; the TZ-agreement `beforeEach` guard (intro paragraph above); a reworded milestone-case comment naming the readback (not the PATCH's `200`) as the real guard; a retrying `toHaveText` in place of a bare `waitForTimeout` + one-shot `textContent()` in the ProjectList case; and forcing the mobile case's viewport to 375px instead of relying on the iPhone-13 device profile's 390px default.

Verified: frontend/backend stack already running (`docker compose ps`); `cd e2e && npx tsc --noEmit` clean; `BASE_URL=http://localhost:5173 npx playwright test tests/date-picker.spec.ts --project=desktop` and `--project=mobile` each green twice in a row, against a live `Asia/Jakarta` (UTC+7) host — the exact east-of-UTC condition the re-click-target and TZ-agreement fixes target. The new "pin setDates's inverse branch" assertion captured exactly one request: `PATCH /api/tasks/<id>` with body `{"startDate":null,"dueDate":"2026-07-14T17:00:00.000Z"}` (picking day-of-month 15 walked back to the 14th in UTC, as expected on this host).

### Changed — 2026-07-28 — ProjectList's inline due-date editor swapped to DateField — project-wide exit criterion (ReUI date field swap, plan Task 4/5)

**`frontend/src/pages/views/ProjectList.tsx`'s `DueDateEditor` (`:970-998`, post-fix-round line numbers — see the fix round below for what moved)** — the last remaining native `<input type="date">` in the app — is collapsed from a hand-rolled popover (local `open`/`value` state, a manual `fixed inset-0 z-10` backdrop, the native input, and Cancel/Save buttons) into a single `<DateField/>`:

- `value={dayFromIso(dueISO)}`, `onChange={(next) => onSave(startISO, commitDraft(next, dueISO))}` — `dayFromIso`/`commitDraft` newly imported from `@/lib/dateField` (`formatDisplay` too, for the aria-label). `clearable` replaces the old input's browser-native "clear to empty" affordance with the popover's own Clear action, which now persists `dueDate: null` directly.
- **Interaction change: direct-commit-on-pick, no Save button.** The old flow required an explicit Save click after picking a day in the native input; picking a day in `DateField`'s calendar now commits immediately via `onChange`, matching every other inline editor already swapped on this branch (TaskPanel/TreeCells commit on Apply — a deliberate multi-field exception documented in Task 2/3.5's entries below — while kanban/list inline edits, and now this one, commit immediately with no intermediate confirm step). Cancel is gone; dismissing the popover without picking (outside-click/Escape) simply leaves the value unchanged, same net effect as the old Cancel button.
- `variant="bare"` + `className="text-[12px] text-on-surface-variant hover:text-primary"` (see fix-round correction below re: font-weight).
- `!canEdit` still renders the plain `<span className="text-[12px] text-on-surface-variant">{fmt(dueISO)}</span>` byte-identically (`fmt` is retained — still used by the mobile card view at `:805` and the `!canEdit` branch here, so it is NOT dead).
- Value-bearing `aria-label` (see fix-round correction below re: which formatter it's derived from).
- **`frontend/src/index.css:276`** — removed the now-dead `.dark input[type="date"]` selector from the shared `.dark input[type="...] { color-scheme: dark }` rule (the rule itself, and its other selectors — `text`/`email`/`password`/`number`/`search`/`textarea`/`select` — are untouched and still live).
- **Exit criterion confirmed:** `grep -rn 'type="date"' frontend/src` now returns exactly one hit app-wide — `DateField.tsx:42`'s own docstring mention (`` * Shared calendar-popover date field replacing native `<input type="date">` ``) — zero JSX attributes remain.
- **Verified against the running dev app** (`localhost:5173`, Playwright browser context `timezoneId: "Asia/Jakarta"`, real login, a seeded project/task via the API — project id 1003, customer id 290, left over, no `DELETE /projects/:id` route exists to remove them): zero `input[type="date"]` elements on the List page; clicking the trigger opens the themed Base-UI calendar popup (`[data-slot="popover-content"]`), not a native picker; re-clicking the already-selected day fires **zero** `PATCH`/`POST /api/tasks*` requests (`DateField`'s own re-click-to-deselect guard intercepts it before `onChange`) and leaves the persisted `dueDate` byte-identical (`2026-08-01T00:00:00.000Z` unchanged); picking a different day (Aug 3) persisted via a single `PATCH` with body `{"startDate":"2026-07-28T00:00:00.000Z","dueDate":"2026-08-02T17:00:00.000Z"}` — local midnight of the picked day in UTC+7, byte-identical to what the pre-swap `new Date(\`${value}T00:00:00\`).toISOString()` conversion would have produced; Clear persisted a single `PATCH` with `{"dueDate":null}`. `docker compose exec frontend npm run typecheck` clean; `npm test` and `-e TZ=Asia/Jakarta npm test` both 119/119 green (no new pure-logic surface — this task only wires already-covered `dateField.ts` helpers into a new call site).

**Fix round (2026-07-28, four verified findings, amended in place — still uncommitted at review time, same append-only exception this branch's other entries already use):**

- **BLOCKER — resting-cell day regression, fixed.** The `canEdit` trigger rendered `formatDisplay(dayFromIso(dueISO))` — the UTC-slice day, `dd/MM/yyyy` — where the pre-swap cell showed `fmt(dueISO)` (local-timezone `"Jul 28"`-style short format). East of UTC this made the resting cell permanently read one calendar day earlier than the picked day (pick Aug 3 → `PATCH` correctly stores `2026-08-02T17:00:00.000Z` → cell read `02/08/2026`, i.e. Aug 2), and it diverged from the mobile card's `fmt` for the same task — the exact hazard the previous draft of this entry's "Noted, not fixed here" bullet (above, now removed) had flagged as deferred instead of fixing. Every other swapped call site in this plan kept a separate local-format resting label for this reason (`TreeCells`'s `fmtDateRangeDDMM`, `TaskPanel`'s `fmtShort`) — this was the one site that didn't. Fixed by adding a display-only `triggerLabel?: string` prop to **`frontend/src/components/DateField.tsx`** (`:30-42` doc, `:75` destructure, `:138` render: `triggerLabel !== undefined ? triggerLabel || "—" : formatDisplay(value) || "—"`) — purely a rendering override, `value`/`onChange`/`commitDraft` semantics are untouched, so byte-parity with the picked-day contract is preserved. `DueDateEditor` (`ProjectList.tsx:987-996`) now passes `triggerLabel={fmt(dueISO)}`, so the resting cell always matches the mobile card's format for the same `dueDate`.
- **SHOULD-FIX — font-weight leak, fixed.** `bare`'s variant classes hardcode `font-semibold` (weight 600); every other cell in this row renders at `font-[450]`, so the due-date trigger was the one visually heavier cell in its own row. Fixed by appending `font-[450]` to the caller's className (`ProjectList.tsx:990`, now `"text-[12px] font-[450] text-on-surface-variant hover:text-primary"` — `tailwind-merge` resolves the conflict against `bare`'s `font-semibold` in the caller's favor, confirmed via `twMerge('font-semibold font-[450]')` → `font-[450]`). `DateField.tsx`'s `bare` variant itself is untouched — `TaskFormModal.tsx`'s Start/Due fields depend on its `font-semibold` default and were out of scope for this fix.
- **NIT — missing unchanged-guard, fixed.** `setDates` (`ProjectList.tsx:240-243`) fired a `PATCH` + optimistic write + three invalidations even when neither date actually changed (e.g. re-picking a day that maps to the already-stored ISO instant). Added the same early-return its siblings `setStatus`/`setAssignee` already had: `if (startDate === task.startDate && dueDate === task.dueDate) return;`.
- **Corrected wording in the bullets above (this entry's own drift, not a code change):** the `variant="bare"` bullet's "reproduces the old button's exact trigger classes" claim was wrong — the font weight differed (600 vs the row's 450), which is exactly what the SHOULD-FIX bullet above fixes; and the aria-label bullet's `formatDisplay(day)` is now `fmt(dueISO)` (`ProjectList.tsx:995`: `` `Due date, currently ${fmt(dueISO)}` `` when set, else `"Due date"`), matching the same local-format switch the BLOCKER fix makes to the trigger label. The `formatDisplay` import in `ProjectList.tsx` is no longer used by this file and was removed from its `@/lib/dateField` import list.

### Added — 2026-07-28 — DateRangeField between-style range picker for paired dates (user add-on, ReUI date field swap, plan Task 3.5/5)

**Amended in place (still uncommitted) after a fix round found nine verified issues, including a BLOCKER — see the "Amendment note" at the end of this entry for what changed and why.**

Mid-implementation user request (screenshot reference: ReUI's `date-selector` component's *between* mode — two-month range calendar, range highlight, Apply/Cancel): replace paired START/DUE editing with ONE range interaction instead of two separate `DateField` pickers (Task 2/3's shipped shape). Scope explicitly excludes the filter-grammar parts of that reference — the `is`/`before`/`after` operator chips and the Quarter/Half-year granularity pills are filter-bar vocabulary, not applicable to editing a task's start+due pair, and are not built here; only the range calendar itself.

- **New `frontend/src/components/DateRangeField.tsx`** — sibling of `DateField.tsx`, reusing its conventions (day-string contract, `ui/popover.tsx` with `positionerClassName="z-101"` to outrank Drawer/Modal's `z-100`, `boxed`/`bare` variants, `cn()`). Trigger shows `formatDisplay(start) – formatDisplay(end)` with an em-dash placeholder per missing side (e.g. `"26/07/2026 – 30/07/2026"`, `"— – 30/07/2026"`, or just `"—"` when both are null). Popover hosts `<Calendar mode="range" numberOfMonths={2|1} selected={...} onSelect={...} defaultMonth={...} />` plus a footer row (Clear left when `clearable`, Cancel + Apply right — Apply styled like the old `InlineDateRangeEditor` Save: `bg-primary text-on-primary font-display text-label-caps`). `numberOfMonths` is 2 at `md:` (768px) and 1 below, via a small local `useIsDesktopViewport` hook (`matchMedia` + `useSyncExternalStore`) — no existing shared media-query hook was found in this codebase when first written; `@base-ui/react` does ship `unstable-use-media-query`, still marked unstable in the pinned version, so this stays hand-rolled. `start`/`end`/the values handed to `onApply` are plain `"yyyy-MM-dd"` day strings, not ISO instants — ISO conversion stays at call sites, matching `DateField`'s own contract.
- **Fix round — BLOCKER, due-only (and start-only) tasks silently wiped on an untouched Apply.** The original draft shape (`draft: DateRange | undefined`, derived from props via `toDraftRange`) returned `undefined` whenever `start` was null, discarding `end` in the process — opening the editor on a due-only task (a first-class shape per the `Task` schema; no start required) and clicking Apply with zero calendar interaction committed `(null, null)`, deleting the due date. React-day-picker v10's `addToRange` has no `{ !from && to }` branch, so seeding RDP's own selection as `{ from: undefined, to: theDay }` was never a viable fix either. **Architecture correction: the draft is now a PAIR of day strings — `draftStart`/`draftEnd`, `string | null` each — seeded verbatim from `start`/`end` on every open/reopen, not an RDP `DateRange` object.** Two new pure functions in `frontend/src/lib/dateField.ts` translate the pair to/from RDP's shape ONLY for the `Calendar`'s `selected` prop and its `onSelect` callback, never for what Apply emits: `rangeFromPair(start, end)` — both null → `undefined` (nothing highlighted); one-sided → `{ from: theDay, to: theDay }` (RDP has no one-sided `selected` shape, so a single-day range is the closest display that still highlights the known day); both set → `{ from, to }`. `pairFromRange(range)` — the inverse, used in `onSelect`: `draftStart = dateToDay(range?.from ?? null)`, `draftEnd = dateToDay(range?.to ?? range?.from ?? null)`; `range === undefined` (RDP's own re-click-to-deselect signal) → both null. **Apply now emits `draftStart`/`draftEnd` directly** (`DateRangeField.tsx:225-239` as of the fix-round-2 edits below, which added an ordering-correction pass — see that round's SHOULD-FIX bullet; originally `:200-207`), never re-derived from an RDP object — this is what makes an untouched popover session (open → Apply, no calendar clicks) reproduce the seeded day strings byte-identically, including the due-only case (a null start passes through as null, the due date passes through unchanged) and, after fix round 2, the historically-inverted-pair case too. `defaultMonth` now derives from the pair too (`dayToDate(draftStart ?? draftEnd) ?? undefined`) instead of the old `draft?.from ?? startDate ?? undefined`, which ignored `end` entirely and opened a due-only task's calendar on today's month rather than the due date's. Pure-logic coverage for both functions, including the due-only/start-only/both/null cases and a round-trip describe-block demonstrating exactly why Apply can't route through RDP's shape, added to `frontend/src/lib/dateField.test.ts` (11 new cases — corrected here from an earlier "19" in this entry, which was wrong; suite total 63 was correct; suite total climbs again in the fix-round-2 bullets below).
- **Fix round — capability trade-off, documented, ratified by the user 2026-07-28.** Because RDP's `addToRange` sets BOTH `from` and `to` to the clicked day on a first click into an empty selection (this component leaves `min` at its default of 0), the between-style calendar can no longer interactively CREATE a fresh one-sided date (start-only or due-only) the way the old two-field form could — a first click always produces a same-day range, never a one-sided pick. Existing one-sided data is unaffected by this — it survives an untouched Apply via the pair architecture above — and Clear still resets both sides together. This is a real, user-facing regression in what the picker can *do* (not just how it looks), traded for the simpler between-style UI; it was not present in the two-`DateField` shape Task 2/3 shipped. **Ratified by the user 2026-07-28:** interactively creating a start-only or due-only date is accepted as gone, in exchange for the simpler between-style UI; existing one-sided data stays preserved through an untouched Apply, and Clear continues to reset both sides together — no further follow-up work is expected against this trade-off.
- **Fix round — SHOULD-FIX: clicks on non-button popover regions (calendar padding, the month caption, footer gaps) no longer bubble to a host row's `onClick`.** Base-UI's Popover renders `PopoverContent` through a Portal to `document.body`, but React's synthetic event system still bubbles through the REACT component tree (`DateRangeField` → `InlineDateRangeEditor` → `TaskDatesCell` → the Gantt row), not the DOM tree — so a click landing anywhere inside the open popover was reaching the Gantt tree row's `onResourceClick` and firing `onEditTask`, opening the task drawer on top of the picker. Fixed with an `onClick={e => e.stopPropagation()}` wrapper `div` directly inside `PopoverContent` (`DateRangeField.tsx:284` as of the fix-round-2 edits below — corrected here from an earlier "`:249`" in this entry, which was already wrong even before those edits; the correct line at that time was `:252`), enclosing both the `Calendar` and the footer row — Clear/Cancel/Apply are nested inside it too, so their own clicks are contained the same way. Verified: clicking the calendar's own root padding at the Gantt tree's Dates cell no longer navigates to `?task=`.
- **Fix round — two stale/incorrect code comments corrected.** The claim that RDP "restarts" the range when a click lands before the current `from` was wrong: RDP v10's `addToRange` EXTENDS the range backwards instead (`{from:A,to:B}` + a click at `C < A` → `{from:C,to:B}`) — it never resets to a fresh single-day selection. The end-never-before-start invariant holds because of that extension, not a restart, and that's the actual reason no manual clamp is needed in `handleSelect`. The old "mid-selection `{from, to: undefined}` is a legal draft" comment was also wrong: that RDP shape is unreachable from user interaction with the default `min={0}` this component uses (`addToRange`'s empty-range branch always sets `to` too when `min` is 0), and it can't arise from a seeded `selected` either — `rangeFromPair`'s one-sided branch always returns `{from,to}` with both sides equal, never a bare `to: undefined`.
- **Fix round — nits.** (1) `useIsDesktopViewport`'s `subscribe`/`getSnapshot` closures hoisted to module scope (`subscribeToDesktopViewport`/`getIsDesktopViewport`/`getServerIsDesktopViewport`) — the previous inline-per-render closures gave `useSyncExternalStore` a fresh function identity every render, making React tear down and re-add the `matchMedia` change listener on every re-render instead of once per mount. (2) Default `aria-label` when both endpoints are null now reads plain `"Date range"` (was `"Date range, currently —"`), guarding the null case the same way `DateField.tsx:119-121` does. (3) `DateRangeField`'s `PopoverContent` shadow is now `shadow-overlay!` (`!important`) instead of `shadow-overlay`, so the sanctioned DESIGN.md §4 shadow doesn't silently lose to the vendored `shadow-md` default depending on stylesheet load order. **`DateField.tsx`'s own popup was deliberately left as plain `shadow-overlay`** (out of scope, per the dispatch brief) — this is now a parity gap between the two sibling components, flagged here for `solvro-docs-keeper`/a future pass rather than fixed silently.
- **`frontend/src/components/InlineDateRangeEditor.tsx` rebuilt as a thin wrapper around `DateRangeField`.** External contract unchanged (`{ startISO, endISO, onSave, onCancel, className }`), so neither call site — `TaskPanel.tsx`'s DATES editor, `gantt-v2/TreeCells.tsx`'s Gantt tree Dates cell — needed edits. `defaultOpen` is set: both call sites already mount this component only once editing begins (`{editing && canEdit && <InlineDateRangeEditor .../>}`-shaped guards), so the calendar now opens immediately — one less click than the old two-field form. Drafts are seeded via `dayFromIso`; Apply runs the exact same per-endpoint `commitDraft(draftStart, startISO)` / `commitDraft(draftEnd, endISO)` passthrough as before, preserving the untouched-field byte-identical round-trip that avoids the local-midnight walk-back (`dateField.ts`'s module doc); Cancel/dismiss calls `onCancel`. The old two-field shell, its own Save/Cancel buttons, the hand-rolled outside-click/Escape `document` listeners, and the submit-time end<start clamp are all removed — range mode enforces start ≤ end structurally (`commitDraft` still guards null per side).
- **Fix round — SHOULD-FIX: `className` (the caller's positioning classes, e.g. `TreeCells.tsx`'s `"absolute right-0 top-full z-50 mt-1"`) now positions a wrapping `<span>` around `DateRangeField` instead of forwarding straight into `DateRangeField`'s own `className` prop.** That prop is documented on `DateRangeField` as "extra classes on the trigger button" — a styling hook, not a positioning one — so routing caller-supplied layout classes through it conflated the wrapper's placement with the trigger's own look and made that placement fragile to any future change in the trigger's markup. The wrapping `<span>` gives each call site its own dedicated positioning surface; the trigger itself now renders with no positional classes.
- **`frontend/src/components/TaskFormModal.tsx`** — the separate "Start Date" and "Due Date" `FieldRow`s are merged into one "Dates" `FieldRow` (`calendar_month` icon) hosting a bare-variant, non-`defaultOpen` `DateRangeField` (`:385-397` — corrected here from an earlier "`:384-397`" in this entry, which included the comment line above the `FieldRow`, not the `FieldRow` itself). State stays the two existing day-string states (`startDate`/`dueDate`); `onApply` sets both (`setStartDate(s ?? ""); setDueDate(e ?? "")`). `handleSubmit` — including its `passthroughDate` UTC-midnight picked-day conversion — is byte-identical, untouched. The now-unused per-field `calendarProps` block (before-Start disabled matcher, own-month-open `defaultMonth`) is deleted; range mode's structural `from ≤ to` supersedes it, and the now-unused `dayToDate`/`formatDisplay` imports are dropped. `disabled={!canEdit}`, `clearable`.
- **Payload parity, verified against the running dev app** (`localhost:5173`, Asia/Jakarta timezone, real admin login, a seeded customer/project/task via the API): TaskPanel DATES opens the two-month calendar immediately on click, a range pick + Apply persists both dates through `InlineDateRangeEditor`'s local-midnight `commitDraft` convention (observed `...T17:00:00.000Z` for a UTC+7 picked day, e.g. `2026-06-30T17:00:00.000Z` / `2026-07-12T17:00:00.000Z`); the Gantt tree Dates cell (same wrapper) matches; an untouched-draft Apply (open, click Apply with zero calendar interaction) reproduced the exact pre-existing ISO byte-for-byte, confirming the passthrough still holds; Cancel and an outside-click both left the task's persisted dates unchanged; Clear + Apply persisted `startDate: null, dueDate: null`; TaskFormModal's Dates row opens only on click (not `defaultOpen`), updates its trigger text instantly after Apply, and Save persists through the untouched UTC-midnight `passthroughDate` convention (observed `...T00:00:00.000Z`); at a 375px viewport the popover renders exactly one month (`numberOfMonths={1}` below `md:`) and fits fully inside the viewport. Fixture rows left over in the dev database (no `DELETE /projects/:id` route exists to remove them): project id 984 ("DRF Verify …", customer already deleted so `customerId` is now null) and task ids 5143–5145.
- **Fix round — re-verified against the running dev app** (`localhost:5173`, Asia/Jakarta timezone, `qa@solvro.test` login, a throwaway customer/project/task via the API — project id 990 "DRF Fix Round Verify Project", customer id 283 "DRF Fix Round Verify Customer"; the task itself, id 5193, was `DELETE /tasks/:id`'d afterward, so only the project/customer are left over, same as the precedent above): (i) a due-only task (`startDate: null`) opened from TaskPanel, Apply clicked with zero calendar interaction — `GET /projects/:id/tasks` readback showed `startDate` still `null` and `dueDate` byte-identical to before; (ii) same due-only task, reopened, clicked an earlier calendar day, Apply — readback showed the new `startDate` at that day's local midnight and `dueDate` unchanged; (iii) the Gantt tree's Dates column (only visible once the tree-pane splitter is scrolled right past the name column) opens the same floated boxed trigger + popover below the row as before this fix round — screenshotted both the pre-fix (`className` forwarded straight to the trigger) and post-fix (wrapping `<span>`) code paths side by side and the rendered output was pixel-identical in this scenario, so the specific "duplicate chip" visual this SHOULD-FIX targeted did not reproduce as a distinguishable regression here; the architectural fix (dedicated positioning surface, decoupled from the trigger's own `className` contract) still stands on its own reasoning and is captured above — noted here rather than claimed as a confirmed visual fix; (iv) clicking the calendar's own root padding at the Gantt tree's Dates cell left the URL unchanged (no `?task=` navigation, task drawer did not open); (v) the same due-only task opened its calendar on July 2026 (the due date's month), not the current month. `docker compose exec frontend npm run typecheck` and `npm test` (both `TZ=UTC` and `TZ=Asia/Jakarta`) all green throughout.
- **Fix round 2 (micro fixes) — BLOCKER: a click on the single highlighted day of a one-sided draft, OR of ANY milestone task, silently wiped the draft to both-null.** `rangeFromPair` fabricates a same-day `{from: D, to: D}` `selected` for BOTH a one-sided draft (start-only/due-only) AND a genuine same-day pair — and every milestone is a same-day pair, since the backend forces `startDate === dueDate` in the milestone lockstep (`backend/src/routes/tasks.ts:189-193`). React-day-picker's range selection (`selection/useRange.js`'s `select()`, via `utils/addToRange.js`'s "adding a date that is equal to both start and end of the range" branch) treats a click on that already-fully-selected same day as a re-click-to-DESELECT, firing `onSelect(undefined)` whenever `required` is left at its default `false` (which this component does — see the new NIT-B comment below). The pre-fix `handleSelect` routed that straight through `pairFromRange(undefined)` → `[null, null]`, so the very next Apply committed a double-null wipe — for a milestone specifically, either a silent full clear or a backend 400, depending on which field's `undefined`→`null` patch landed. **Fixed with an early return in `handleSelect`, `if (!range) return;` (`DateRangeField.tsx:198`)** — RDP's own deselect signal is now ignored entirely and never reaches the draft; the Clear button (`DateRangeField.tsx:309-311`) remains the only path that resets the draft to both-null. The adjacent comment block explaining the end<start invariant is also corrected (see the SHOULD-FIX bullet below) — its previous wording claimed the invariant held unconditionally, which is false for a range SEEDED already-inverted from outside RDP.
- **Fix round 2 — SHOULD-FIX: a historically inverted stored pair (`startDate > dueDate`) could commit a still- or newly-inverted pair after being edited.** Nothing normalizes an inverted pair once it exists: `rangeFromPair` doesn't validate `from <= to` before handing RDP a `selected` range, so seeding from inverted data hands `addToRange` a shape it never produces from its own click-by-click logic, there's no relational check on the backend, and the old two-field editor's submit-time `start > end` clamp was removed when this component replaced it (range mode's structural ordering only covers pairs `addToRange` itself builds up from an empty selection). **New pure helper `normalizePair(draftStart, draftEnd, seedStart, seedEnd)` added to `frontend/src/lib/dateField.ts`**, called from `handleApply` (`DateRangeField.tsx:236`): swaps `draftStart`/`draftEnd` when both are set, `draftStart > draftEnd` (plain string comparison — correct ordering for `"yyyy-MM-dd"`), AND at least one draft differs from the seed (`start`/`end`, the props the draft was last reseeded from on open) it started from. That last condition is load-bearing, not incidental: an UNTOUCHED open→Apply on an inverted stored pair (`draftStart === start && draftEnd === end`, both still inverted) must still emit those seed values verbatim, unswapped — swapping an untouched pair would fabricate a change the user never made and break `commitDraft`'s untouched-passthrough byte-parity at the call site (`InlineDateRangeEditor`/`TaskFormModal`). Also corrected the stale `handleSelect` comment — its citation here, corrected: `DateRangeField.tsx:195-207` in the file as fix round 3 below leaves it (that round trimmed the comment and extracted the underlying logic into a new `nextDraftFromSelection` helper); it was actually `:185-197` as of fix round 2 itself (this entry's own `:184-198` citation was already one line off at each end even then), and roughly `:187-188` before that — that claimed the end<start invariant "holds no matter which branch of RDP's `addToRange` fires" — that's only true for a range RDP built up itself from an already-ordered selection; it does not self-correct a range seeded already-inverted from outside, which is exactly the gap `normalizePair` closes. 9 new cases added to `dateField.test.ts`'s new `normalizePair` describe block (ordered stays ordered, inverted swaps, one-sided/both-null untouched by the swap logic — all "changed from seed" — plus three dedicated untouched-passthrough cases: an inverted seed, an ordered seed, and both-null, each returned verbatim) — suite total 72, green under `TZ=UTC`.
- **Fix round 2 — NIT: added a comment directly above the `Calendar` call site (`DateRangeField.tsx:285-298`)** documenting that the pair↔RDP mapping this whole file relies on (the same-day fabrication in `rangeFromPair`, and the BLOCKER fix's deselect guard in `handleSelect`) depends on `min`, `max`, `required`, `resetOnSelect`, and `excludeDisabled` all staying absent/default on this `Calendar` — citing the exact branches in `react-day-picker`'s `selection/useRange.js` (`select()`) and `utils/addToRange.js` this round's investigation read directly (`frontend/node_modules/react-day-picker/dist/esm/{selection/useRange.js,utils/addToRange.js}`) — so a future edit doesn't add e.g. `required` (which would silently stop RDP from ever emitting the deselect signal the BLOCKER fix depends on ignoring) without re-auditing this file's whole draft-pair contract.
- **Fix round 3 (final polish) — mutation-pinning tests for `normalizePair`'s `changed` guard, a `nextDraftFromSelection` extraction with its own regression coverage, and a seed-race fix in `handleApply`.** (1) Two new cases in `dateField.test.ts`'s `normalizePair` describe block target the `changed = draftStart !== seedStart || draftEnd !== seedEnd` guard specifically: one where only START moves into inversion while END stays at its seed value, and the symmetric case where only END moves. A `&&` typo, or a guard that only ever checks one side, would evaluate `changed` false in one or the other case (since the untouched side still equals its seed) and skip the swap — these two cases are mutation-verified to catch both. (2) Fix round 2's BLOCKER-fix logic — ignoring RDP's `range === undefined` re-click-to-deselect signal rather than routing it through `pairFromRange` — is extracted out of `handleSelect` into a new pure `nextDraftFromSelection(range, current)` in `frontend/src/lib/dateField.ts`: returns `current` unchanged, by reference, when `range` is `undefined`; otherwise `pairFromRange(range)`. `handleSelect` (`DateRangeField.tsx:195-207`) is now a one-line delegation to it, with the surrounding comment trimmed accordingly — the deselect-ignore mechanism is now documented on the pure function itself and covered by its own `dateField.test.ts` describe block (4 cases: identity-and-value-equality on `undefined`, a dedicated one-sided-draft case documenting why the ignore is load-bearing — the same milestone/one-sided-wipe scenario fix round 2's BLOCKER addressed — and two defined-range cases asserting parity with `pairFromRange`). The stale in-file comment above the `Calendar` call site that referenced "`handleSelect`'s `if (!range) return;` deselect guard" is also updated to point at `nextDraftFromSelection` instead, since that literal line no longer lives in `handleSelect`. (3) **Seed-race fix in `handleApply`:** it previously called `normalizePair(draftStart, draftEnd, start, end)` — the live `start`/`end` PROPS as the seed — rather than the values the draft was actually seeded from at open time. Because `TreeCells.tsx`/`TaskPanel.tsx` mount this component `defaultOpen` against live TanStack Query data, a background refetch while the popover is still open could change `start`/`end` mid-session; comparing against those live props instead of the true seed made an untouched draft capable of spuriously evaluating as "changed" (and, worst case, swapping an untouched inverted pair the user never touched). Fixed by holding dedicated `seedStart`/`seedEnd` state (`DateRangeField.tsx:164-165`), written in exactly the two places the draft itself is seeded — mount init (same lines) and the reopen branch of `handleOpenChange` (`:182-183`) — and passing those, not the live props, to `normalizePair` in `handleApply` (`:230`). 6 new test cases total (2 `normalizePair`, 4 `nextDraftFromSelection`) — suite total 78, green under both `TZ=UTC` and `TZ=Asia/Jakarta`.

**Amendment note (2026-07-28, fix round):** this entry was amended in place — not appended as a separate "fix round" entry — for the same append-only exception the Task 2 and Task 3 fix rounds below already used: the whole of Task 3.5 was still uncommitted at review time. Nine verified findings, all resolved in `DateRangeField.tsx`, `InlineDateRangeEditor.tsx`, and this entry (`dateField.ts`/`dateField.test.ts` gained the pure-logic split this fix required, and are documented inline above rather than as separate top-level bullets since they're new files' worth of surface, not edits to an already-described file): (1) BLOCKER — the RDP-`DateRange`-as-draft architecture silently wiped due-only (and start-only) tasks on an untouched Apply; replaced with a day-string pair as the actual source of truth, RDP's shape used only for `Calendar`'s `selected`/`onSelect` boundary; (2) SHOULD-FIX — the resulting incapacity to interactively *create* a fresh one-sided date, documented as a trade-off rather than solved — ratified by the user 2026-07-28 (see the "Ratified by the user" sentence on that bullet above); (3) SHOULD-FIX — `InlineDateRangeEditor`'s positioning `className` forwarded into `DateRangeField`'s trigger-styling `className` instead of a dedicated wrapper; (4) SHOULD-FIX — popover clicks bubbling through React's synthetic-event tree (despite the DOM Portal) to a host row's `onClick`, opening the Gantt tree's task drawer over the picker; (5) NIT — the media-query hook's `subscribe`/`getSnapshot` closures re-created (and the `matchMedia` listener re-subscribed) every render; (6) NIT — the null-case `aria-label` reading "Date range, currently —" instead of a plain fallback; (7) NIT — a stale comment claiming RDP "restarts" the range on a before-`from` click, when `addToRange` actually extends it backwards; (8) NIT — a stale "mid-selection `{from,to:undefined}` is a legal draft" comment describing a shape this component's own interaction model can't produce; (9) NIT — the popup shadow depending on stylesheet load order against the vendored default instead of an explicit `!important`. Two findings from the dispatch brief could not be independently confirmed as originally described and are reported as such rather than claimed fixed: SHOULD-FIX 3's "duplicate boxed chip" did not visually reproduce as a distinguishable regression in this session's own before/after screenshot comparison (see the re-verification bullet above) — the architectural correction was still made on its own merits.

**Amendment note (2026-07-28, fix round 2 — micro fixes):** amended in place again for the same still-uncommitted reason as the amendment note above. Four verified findings, all resolved in `DateRangeField.tsx`, `frontend/src/lib/dateField.ts`/`dateField.test.ts`, and this entry: (1) BLOCKER — RDP's own re-click-to-deselect signal, fired by clicking the single highlighted day of a one-sided draft or ANY milestone (every milestone is a same-day pair per the backend's lockstep), was routed straight through to a both-null draft instead of being ignored; fixed with an early `if (!range) return;` in `handleSelect`; (2) SHOULD-FIX — a historically inverted stored pair (`startDate > dueDate`) had no normalization path and could commit still-inverted after an edit; fixed with a new `normalizePair` helper called from `handleApply`, guarded so an untouched Apply on an inverted pair still passes the seed through verbatim; (3) NIT — three stale line references in this entry (an "19 new cases" test count that should have read "11"; the stopPropagation wrapper `div`'s line number, which had already drifted from `:249` to `:252` before this round's further edits moved it again to `:284`; and the `TaskFormModal.tsx` Dates `FieldRow` range, off by one line at `:384-397` instead of `:385-397`) are corrected in place, inline, above; (4) NIT — a documentation-only comment added at the `Calendar` call site recording that the pair↔RDP mapping this file depends on `min`/`max`/`required`/`resetOnSelect`/`excludeDisabled` staying absent, so a future edit doesn't add one of them without re-auditing the fix in (1) above, which depends on `required` staying at its default.

**Amendment note (2026-07-28, fix round 3 — final polish):** amended in place again for the same still-uncommitted reason as the two amendment notes above. Four items from a reviewer's exactly-specified polish list, all resolved in `DateRangeField.tsx`, `frontend/src/lib/dateField.ts`/`dateField.test.ts`, and this entry: (1) two `normalizePair` test cases added specifically to pin the `changed` guard's `||` against a `&&` typo or a single-side-only variant, mutation-verified; (2) fix round 2's BLOCKER-fix deselect-ignore logic extracted out of `handleSelect` into a new pure, independently-tested `nextDraftFromSelection(range, current)` helper in `dateField.ts`, with `handleSelect` reduced to a one-line call through it and its comment trimmed to match (the in-file comment above the `Calendar` call site that referenced `handleSelect`'s own early return was also updated to point at the new helper, since that literal guard no longer lives in `handleSelect`); (3) a seed-race bug in `handleApply` — it compared the draft against live `start`/`end` props rather than the values the draft was actually seeded from, reachable because `TreeCells`/`TaskPanel` mount this component `defaultOpen` against live TanStack Query data and a background refetch could move the props while the popover stayed open — fixed with dedicated `seedStart`/`seedEnd` state, written only in the two places the draft itself is seeded (mount init, and the reopen branch of `handleOpenChange`); (4) this entry's own stale line reference for the `handleSelect` comment (previously `:184-198`, itself already wrong even as of fix round 2) corrected in place, inline, above to `:195-207` — the true range in the file as this round leaves it. `docker compose exec frontend npm run typecheck` and `npm test` (both `TZ=UTC` and `TZ=Asia/Jakarta`) green throughout — 119 total frontend tests (113 + 6 new), `dateField.test.ts` alone at 78. No browser round was performed for this round — pure refactor plus test/bookkeeping changes, confirmed instead by grepping that `handleSelect` calls `nextDraftFromSelection`.

### Changed — 2026-07-28 — TaskFormModal and Gantt baseline dialog swapped to DateField (ReUI date field swap, plan Task 3/5)

**Amended in place (still uncommitted) after a reviewer fix round found a shared silent-wipe hazard plus five smaller defects — see the "Amendment note" at the end of this entry for exactly what changed from the original text of this bullet list and why.**

- **`frontend/src/components/TaskFormModal.tsx:384-396`** (Start Date) **and `:398-420`** (Due Date) — the Start Date and Due Date `FieldRow`s' native `<input type="date">`s are replaced with bare-variant `<DateField/>` (`variant="bare"`, matching the previous borderless `text-xs font-semibold` look with zero layout shift — `DateField`'s `bare` variant classes already reproduce the old input's exact class list). Both are `clearable` (the native inputs could be emptied via the browser's own clear affordance; that's now the popover's Clear action) and carry value-bearing `aria-label`s (`` `Start date, currently ${formatDisplay(startDate)}` `` / the Due equivalent, same shape as `InlineDateRangeEditor.tsx:101`).
- **Corrected: the submit path is not unconditionally untouched.** The original text of this bullet (now split out) claimed `handleSubmit`'s `startDate ? new Date(startDate).toISOString() : null` conversion was "deliberately left untouched" for both create and edit. A fix-round reviewer finding showed that was a real defect in edit mode: `startDate`/`dueDate` draft state is seeded from the persisted ISO via `.slice(0, 10)` (`TaskFormModal.tsx:119-120`), so saving the form WITHOUT touching a date unconditionally re-ran `new Date(day).toISOString()` on that seeded day string — rewriting a local-midnight-written ISO (e.g. one saved by the Gantt/`InlineDateRangeEditor` path) to a different instant, and in some timezones a different calendar day. Fixed with a new hand-written passthrough, `passthroughDate(draftDay, originalIso)` (`TaskFormModal.tsx:73-76`, doc at `:56-72`): if the draft still equals the day sliced from the original ISO, the original ISO is returned unchanged (no re-derivation); otherwise the pre-existing conversion runs exactly as before. `handleSubmit` uses it for `startIso`/`dueIso` in edit mode only (`:180-196`) — create mode has no original ISO to compare against, so it always uses the picked-day conversion, unchanged. **Deliberately NOT** Task 2's `commitDraft` (`dateField.ts`): `commitDraft`'s changed-day branch derives the ISO via `isoFromDay`'s LOCAL-midnight parse, whereas this call site's picked-day conversion has always been `new Date("yyyy-MM-dd").toISOString()` — a UTC-midnight parse, since a bare date-only string parses as UTC per the ECMAScript date-string grammar. Reusing `commitDraft` wholesale would have silently switched this site's picked-day payload convention from UTC-midnight to local-midnight, which was out of scope for this fix — `passthroughDate` changes *only* the untouched-draft case. Verified via a throwaway Playwright script against the dev app (Asia/Jakarta timezone, real login + seeded project/task, rows deleted after): opening the edit form for a task with `startDate: "2026-07-19T17:00:00.000Z"` / `dueDate: "2026-07-21T17:00:00.000Z"` and hitting Save without touching either field round-tripped both fields byte-identically per `GET /projects/:id/tasks`; picking a genuinely different Start day (the 15th) still persisted `"2026-07-15T00:00:00.000Z"` (UTC-midnight, the unchanged picked-day conversion) rather than the original ISO, confirming the passthrough only intercepts the untouched case; the Clear button still persists `startDate: null` as before.
- **New: the Due field gained the same before-Start clamp + own-month-open affordance `InlineDateRangeEditor`'s Due field already has.** `calendarProps={{ disabled: startDate ? { before: dayToDate(startDate)! } : undefined, defaultMonth: dayToDate(dueDate) ?? dayToDate(startDate) ?? undefined }}` (`TaskFormModal.tsx:407-418`). Submit-time validation (`new Date(dueDate) < new Date(startDate)` in `handleSubmit`) remains the actual enforcement — the calendar clamp is a UX nicety, same division of labor as Task 2's `InlineDateRangeEditor`. Verified: opening the Due calendar for a task with a Start date shows disabled day buttons (`button[data-disabled]`) before that date.
- **`frontend/src/components/gantt-v2/SolvroGantt.tsx:1197-1207`** — the baseline "as-of date" native input inside the Lock/Overwrite Baseline `ConfirmModal` is replaced with a boxed-variant `<DateField/>`. Not `clearable` (it's a required field that an effect defaults to today's date whenever the dialog opens, `SolvroGantt.tsx:322-326` — unchanged). The label + helper text ("Baseline as-of date" / "Defaults to today…") are untouched; the mutation payload (`lockBaseline.mutateAsync({ asOfDate: ... })`, `SolvroGantt.tsx:1157-1158`) was not touched — same reasoning as TaskFormModal, `baselineAsOf` stays a plain day string.
- **Fixed: the baseline field had no accessible name.** `DateField`'s default `aria-label` fallback (`` value ? `Select date, currently ...` : "Select date" ``) outranks the wrapping `<label>` text in accessible-name computation, so without an explicit override this swap silently dropped the field's accessible name relative to the native input it replaced (which inherited the `<label>`'s text via implicit `<label>`-wraps-control association). Fixed by passing `aria-label={baselineAsOf ? \`Baseline as-of date, currently ${formatDisplay(baselineAsOf)}\` : "Baseline as-of date"}` (`SolvroGantt.tsx:1202-1206`; `formatDisplay` newly imported from `@/lib/dateField` at `:5`).
- **Fixed: the boxed variant is a smaller, monospace inline-editor look than the input it replaced.** `variant="boxed"`'s default classes (`px-1.5 py-0.5 font-mono text-[12px]`) are `InlineDateRangeEditor`'s compact style, not this dialog's — per `git show 88c7590`, the original native input here was `px-2 py-1.5 text-xs` with `focus:ring-2 focus:ring-primary/30` and no explicit font class (inheriting `font-body`/Source Sans 3 from the page, not monospace). Restored via caller-side `className` overrides, which win through `tailwind-merge`: `className="w-full px-2 py-1.5 text-xs font-body focus:ring-2 focus:ring-primary/30"` (`SolvroGantt.tsx:1199`). Verified via `getComputedStyle` on the live trigger in the dev app: `padding: 6px 8px` (top/bottom 6px = `py-1.5`, left/right 8px = `px-2`), `font-size: 13px` (the `--text-xs` token), `font-family: "Source Sans 3", system-ui, sans-serif` — matching the pre-swap input, not `font-mono`.
- **Shared fix (`frontend/src/components/DateField.tsx:66-81`): re-clicking the selected day no longer wipes the value when `clearable` is true.** react-day-picker fires `onSelect(undefined)` when the user re-clicks the already-selected day; `handleSelect` previously only swallowed that into a close-only no-op `if (day === undefined && !clearable)` — with `clearable` (which both of this task's new call sites use, plus Task 2's `InlineDateRangeEditor`), a re-click fell through to `onChange(null)`, silently clearing the field with no undo. Changed to treat `day === undefined` as close-only in ALL cases; `clearable` now controls only whether the explicit Clear button renders, never whether a re-click can clear. Because the fix lives in the shared component, it applies automatically everywhere `DateField` is mounted — `InlineDateRangeEditor.tsx` needed no edit, but its Start/Due fields (both `clearable`) inherit the same fix; the explicit Clear button's own behavior (`onChange(null)`) is unchanged. Verified in the dev app (Asia/Jakarta): re-clicking the selected day in TaskFormModal's Start Date field closes the popover and leaves the trigger's displayed date unchanged; the Clear button still empties the field and persists `null` on Save.
- Both sites' `DateField`s render inside their respective host (`Drawer`/`Modal`, both `z-100`) with no changes needed beyond what Task 1 already shipped — no new `// SOLVRO PATCH` sites, no `ui/calendar.tsx`/`ui/popover.tsx` edits.
- Project-wide `grep -rn 'type="date"' frontend/src --include='*.tsx'` now returns exactly one JSX hit — `frontend/src/pages/views/ProjectList.tsx:1003` (Task 4's remaining site) — plus `DateField.tsx`'s own docstring mention.
- **Noted, not fixed here:** verifying this round's changes surfaced (and a reviewer finding separately flagged) a pre-existing display divergence — `TaskFormModal`/`SolvroGantt`'s day strings are UTC-slice-derived (`.slice(0, 10)` of the stored ISO) while `ProjectList`/`TaskPanel` format the same ISO through `new Date(iso).toLocaleDateString()` (local timezone), so the same stored `dueDate` can read as two different calendar days across views in a non-UTC timezone (observed directly in Asia/Jakarta: `21/07/2026` in the Gantt tree/TaskFormModal vs `Jul 22` in List/TaskPanel for one `dueDate`). Out of scope for this fix round; tracked in `ISSUES.md`.

**Amendment note (2026-07-28, fix round):** this entry was amended in place — not appended as a separate "fix round" entry — because the whole of Task 3 was still uncommitted at review time, the same append-only exception Task 2's own fix rounds (below) already used. Six verified reviewer findings, all resolved in the three files above plus this entry: (1) the shared `DateField` re-click-wipe hazard, generalized to a close-only behavior regardless of `clearable`; (2) the Gantt baseline field's missing accessible name; (3) the Gantt baseline field's visual regression from the native input's padding/font/focus-ring; (4) `TaskFormModal`'s edit-mode submit unconditionally rewriting untouched dates, fixed via a hand-written `passthroughDate` (deliberately not `commitDraft`, to avoid silently changing this call site's UTC-midnight picked-day convention); (5) `TaskFormModal`'s Due field missing the before-Start/own-month calendar affordance `InlineDateRangeEditor` already has; (6) this entry's own line references, which had drifted 1-2 lines from the files as originally written and are now re-derived from the post-fix files. The two bullets this note's changes split out of (the original combined TaskFormModal and SolvroGantt bullets) are corrected above rather than left standing, since the "deliberately left untouched" claim in the original TaskFormModal bullet is no longer true and leaving it uncorrected would misdescribe the shipped behavior.

### Changed — 2026-07-28 — InlineDateRangeEditor rebuilt on DateField; TaskPanel dates form consolidated (ReUI date field swap, plan Task 2/5)

**Amended in place (still uncommitted) after a reviewer fix round found a UTC+7 walk-back bug plus four smaller defects — see the "Amendment note" at the end of this entry for exactly what changed from the original text of this bullet list and why.**

- **DateField's contract changed: `value`/`onChange` now carry a plain calendar day (`"yyyy-MM-dd"`), not an ISO instant.** This supersedes the `value`/`onChange` description in the "Added" entry below (Task 1/5) — that entry is left as-is per changelog append-only discipline, but its "ISO string" wording for `DateField`'s props no longer reflects the shipped contract. Root cause this fixes: with an ISO-instant contract, `DateField` round-tripped every pick through local-midnight → `.toISOString()` before redisplaying it; in a timezone east of UTC (e.g. Asia/Jakarta, UTC+7) that round-trip shifts the ISO's date-part back one day, so clicking July 28 in the calendar immediately redisplayed 27/07/2026 in the trigger — a live, visible walk-back on every single pick, not just a save-time issue. Moving `DateField`'s own contract to a day string (`frontend/src/components/DateField.tsx:64` `dayToDate(value)` for the Calendar's `selected`, `:75` `dateToDay(day ?? null)` on select, `:120` `formatDisplay(value)` for the trigger) removes the ISO round-trip from the picker's interactive display path entirely — click day N, see N/MM/YYYY, instantly, in every timezone. **The persisted API payload is unchanged**: `Task.startDate`/`dueDate` are still ISO instants: the day string exists only as `DateField`/draft-state currency, converted at the save boundary (see `commitDraft` below).
- **`frontend/src/lib/dateField.ts` restructured around the day-string/ISO-instant split** (supersedes the "Added" entry's `isoToLocalDate`/`localDateToIso`/`formatDisplay` description below): `dayFromIso(iso)` (ISO → day string, was `toInputValue`/`isoToLocalDate`'s slice half), `isoFromDay(day)` (day string → ISO via local midnight, was `fromInputValue`/`localDateToIso`'s other half — both byte-identical to the pre-DateField-swap `InlineDateRangeEditor.tsx:12-22` pair **for parsable ISO input**; `dayFromIso` additionally probes the sliced day for validity, a check the legacy `toInputValue` lacked, so the two diverge only on unparsable input, unreachable with Prisma timestamps — deliberately reproducing the classic UTC-slice off-by-one for payload-parity otherwise, not fixing it there), `dayToDate`/`dateToDay` (day string ⇄ `Date`, for the Calendar — trivially TZ-independent, no ISO involved), `formatDisplay(day)` (dd/MM/yyyy, now takes a day string), and a new `commitDraft(draftDay, originalIso)` (`dateField.ts:115-118`) — the save-boundary rule, see the fix-for-walk-back bullet below.
- **`frontend/src/components/InlineDateRangeEditor.tsx`** — full internal rebuild, external contract unchanged (`{ startISO, endISO, onSave, onCancel, className }`, so `gantt-v2/TreeCells.tsx:46` and `TaskPanel.tsx`'s call site needed no edits). The two native `<input type="date">`s are replaced with boxed-variant `<DateField/>`s (Start, Due). Draft state is now day-string-or-null (`InlineDateRangeEditor.tsx:26-27`, `dayFromIso(startISO)`/`dayFromIso(endISO)`), fed by `DateField`'s `onChange`; `startISO`/`endISO` themselves stay untouched for the mount's lifetime as what `commitDraft` compares each draft against at save time (`:77`). Both fields are `clearable` (previously only implicitly cleared via native input semantics — the boxed `DateField` swap had silently dropped the Clear affordance; restored explicitly here). The submit-time clamp (`:73`, `if (start && end && new Date(start) > new Date(end)) { setEnd(start); return; }`) now compares day strings directly rather than full ISO timestamps — legacy-exact logic, and calendar-day-correct in every timezone (day strings parse as UTC-midnight-of-that-day on both sides, so ordering is preserved) rather than correct-only-because-monotonic as the ISO-comparison version was. The DUE field's `calendarProps={{ disabled: startDate ? { before: startDate } : undefined, defaultMonth: dayToDate(end) ?? startDate ?? undefined }}` (`:80`, `:114-126`) derives `startDate` from `dayToDate(start)` (the draft) for the `disabled` clamp; `defaultMonth` prefers the DUE field's own existing value (`dayToDate(end)`) so an existing due date in a different month than start still opens on its own month, falling back to `startDate` for the no-due-yet nicety and finally `undefined` (today) — see the fix-round note below, this superseded an earlier `defaultMonth: startDate ?? undefined` that always opened the Due picker on the Start month.
- **Untouched-draft passthrough is a FIX for a legacy walk-back bug, not mere byte-parity.** `commitDraft(draftDay, originalIso)`: if `draftDay === dayFromIso(originalIso)` (the field wasn't actually edited, including both null), returns `originalIso` **unchanged**; otherwise returns `isoFromDay(draftDay)`. Without this, a form re-saved without touching a field would re-derive its ISO from the day string every time — in a positive-offset timezone (e.g. UTC+7) that walks the *stored* date back one calendar day per save, because `dayFromIso` is a UTC slice and `isoFromDay`'s local-midnight re-derivation doesn't invert it. Verified directly: three consecutive reopen-and-save-without-touching cycles against a real task in Asia/Jakarta left `dueDate` at exactly `2026-07-29T17:00:00.000Z` all three times (see Acceptance section of this task's dispatch for the browser-check transcript) — pre-fix, each cycle would have shifted it a day earlier.
- **Nested-dismissal fix, corrected: the pointerdown guard no longer also matches `[role="dialog"]`.** The original text of this bullet (now corrected) described guarding the outside-click-cancel pointerdown listener with `closest('[data-slot="popover-content"], [role="dialog"]')`. That extra `[role="dialog"]` clause was overbroad: `TaskPanel.tsx`'s own `<aside role="dialog">` host also matches it, so once this editor is mounted inside TaskPanel, *every* click anywhere in the panel — not just inside the calendar popover — was treated as "inside the editor," killing outside-click dismissal for the editor at that call site. Fixed by matching only `[data-slot="popover-content"]` (`InlineDateRangeEditor.tsx:49`) — Base-UI's popover popup carries both attributes, so the portal-click guard this selector exists for is still fully covered.
- **Both `DateField`s' `aria-label`s are now value-bearing.** Previously static (`"Start date"`/`"Due date"`); now `` start ? `Start date, currently ${formatDisplay(start)}` : "Start date" `` and the Due equivalent (`InlineDateRangeEditor.tsx:101`, `:113`), so a screen-reader user hears the currently-selected day, not just the field's purpose.
- **Editor shell shadow: `shadow-lg` → `shadow-overlay`** (`InlineDateRangeEditor.tsx:88`). DESIGN.md sanctions only `shadow-overlay` for overlay surfaces; this editor floats as an overlay in both its Gantt-tree and TaskPanel mountings, same rationale as the `DateField` popover's own `shadow-overlay` (Task 1's fix round, below). Supersedes the earlier text of the `TaskPanel.tsx` bullet below, which had described the editor's shadow as `shadow-lg`.
- **`frontend/src/components/TaskPanel.tsx`** — unaffected by this round (the file already reads `<InlineDateRangeEditor startISO={task.startDate} endISO={task.dueDate} onSave={(s, e) => { patch({ startDate: s, dueDate: e }); setEditingDates(false); }} onCancel={() => setEditingDates(false)} />` per the original Task 2 pass); `patch({ startDate: s, dueDate: e })` still sends whatever `onSave` is called with — now `commitDraft`'s output, ISO-or-null, matching the API's existing currency.
- **`frontend/src/components/DateField.tsx`** — removed the capture-phase `document` Escape listener effect added in the "DateField fix round" entry below (kept the `disabled → setOpen(false)` reset effect and the `isOpen = open && !disabled` derivation, both independently correct and unchanged). That listener was itself the fix for an earlier keyboard-unclosable trap, added on the theory that Base-UI's own bubble-phase Escape-to-dismiss could co-fire alongside a host Drawer/Modal's bubble-phase Escape-to-close without either's `stopPropagation()` suppressing the other. Empirically re-measured at a real call site (TaskPanel's DATES editor, now mounting `InlineDateRangeEditor`/`DateField` end-to-end): pressing Escape while the calendar popover is open closes only the popover — `InlineDateRangeEditor`'s own document-level Escape listener (which would cancel the whole inline editor) does not fire on that keypress, confirming Base-UI's Popover stops the dismissing Escape from ever reaching document-level bubble listeners at all. **Corrected wording for the second-Escape case** (the original text of this bullet claimed the second Escape "is picked up by whichever bubble listener was registered first," implying only one fires — verified false): both `InlineDateRangeEditor`'s own document `keydown` listener and `TaskPanel`'s pre-existing top-level "Escape closes the whole panel" listener are ordinary bubble-phase `document` listeners with no `stopPropagation()`/`stopImmediatePropagation()` anywhere in either handler, so **both fire** on a single second Escape (`InlineDateRangeEditor`'s calls `onCancel` → `setEditingDates(false)`; `TaskPanel`'s calls `onClose`). The net *visible* effect is identical to what the original wording claimed (the whole panel closes) since closing the panel subsumes closing the editor — but the mechanism is "both listeners independently fire," not "exactly one listener wins by registration order." Verified via a throwaway Playwright script driven against the real dev app (localhost:5173 + seeded project/task via the API): 1st Escape → popover gone, editor form still visible; 2nd Escape → editor form and panel both gone. Also re-verified the Gantt tree "Dates" cell (`TreeCells.tsx` → `InlineDateRangeEditor` → `DateField`, the other call site, which has no panel-level Escape listener) still opens its calendar, picks a day, and the submit clamp (start > end) correctly blocks the first Save and snaps due→start before a second Save persists — confirming the removed listener was genuinely redundant, not load-bearing, at either mounting site.

**Amendment note (2026-07-28, fix round):** this entry was amended in place — not appended as a separate "fix round" entry — because the whole of Task 2 was still uncommitted at review time (branch `feat/reui-date-field` over commit `7a1ff4c`), so there was no shipped historical record yet to preserve; the append-only changelog rule applies to committed entries, and the four items above marked "corrected"/"supersedes" are exactly the wording the reviewer verified as wrong in the original draft of this bullet list: (i) the submit clamp was described as behavior-preserving purely via ISO-timestamp comparison — it wasn't monotonic by accident, it's now a direct day-string comparison, legacy-exact; (ii) the untouched-draft passthrough was originally going to be described as byte-parity busywork — it is in fact the fix for a real UTC+7 walk-back bug, now documented as such with a verification transcript; (iii) the second-Escape mechanism was going to be described as "whichever listener registered first" (implying exclusivity) — both listeners actually fire, no `stopPropagation()` involved, same net effect; (iv) the `DateField` value/onChange contract change (ISO instant → plain day string) and its cause (interactive picker walk-back east of UTC) is now called out explicitly, including that it supersedes wording in the already-committed Task 1 "Added" entry below without editing that entry's text. Task 1's three entries below (Added, and both Fixed rounds) are untouched.

**Amendment note (2026-07-28, fix round 2 — micro fixes):** amended in place again for the same still-uncommitted reason as the first amendment note above. Three verified findings: (i) **DUE-picker month bug** — the DUE field's `calendarProps.defaultMonth` was unconditionally `startDate ?? undefined`, so opening the Due calendar always landed on the START field's month, hiding an existing due date set in a different month (react-day-picker computes `initialMonth = month || defaultMonth || today` and never consults `selected`). Fixed to `dayToDate(end) ?? startDate ?? undefined` (`InlineDateRangeEditor.tsx:125`) — the bullet above documenting this file now reflects the corrected expression, not the buggy one. (ii) **Test-fixture blind spot** — every `commitDraft` passthrough/walk-back fixture in `dateField.test.ts` used a midnight-UTC ISO, for which `isoFromDay(dayFromIso(iso)) === iso` under a UTC system clock, making the untouched-draft passthrough branch unobservable: mutation-verified that deleting the `if (draftDay === dayFromIso(originalIso)) return originalIso;` guard from `commitDraft` (`dateField.ts:116`) left those tests green under `TZ=UTC`. Switched the passthrough/walk-back fixtures to a non-midnight ISO (`"2026-07-26T15:42:07.123Z"`) so the guard is red-on-regression in every zone including UTC, and added a dedicated new test keeping one midnight-UTC case for the Gantt-written shape (`dateField.test.ts`'s `commitDraft` describe block). (iii) **Overstated doc claim** — `dateField.ts`'s module doc and this entry's `dateField.ts` bullet above both called `dayFromIso`/`isoFromDay` "byte-for-byte" identical to the legacy `toInputValue`/`fromInputValue` pair; `dayFromIso` actually adds a validity probe the legacy helper lacked, so the two diverge on unparsable input (unreachable with Prisma timestamps, but the claim was still overstated). Both now say "byte-identical for parsable ISO input."

### Added — 2026-07-28 — Shared DateField calendar-popover component + date helpers (ReUI date field swap, plan Task 1/5)

Groundwork for replacing all native `<input type="date">` sites with one themed calendar-popover control (`docs/plans/reui-date-field-swap-plan.md`, local-only). No call sites changed yet — this task only adds the pure helpers and the component itself, unmounted.

- **`frontend/src/lib/dateField.ts`** — pure module, no React: `isoToLocalDate(iso)` (ISO string -> Date at local midnight of the calendar date, `iso.slice(0, 10)` then `new Date(\`${slice}T00:00:00\`)`), `localDateToIso(d)` (Date -> ISO string, deriving `yyyy-MM-dd` from the Date's local year/month/day via `date-fns` `format`, then re-parsing as local midnight and calling `toISOString()`), and `formatDisplay(d)` (`dd/MM/yyyy` via `date-fns` `format`, empty string for null). These reproduce `InlineDateRangeEditor.tsx`'s existing `toInputValue`/`fromInputValue` semantics byte-for-byte so later call-site migrations are behavior-preserving.
- **`frontend/src/lib/dateField.test.ts`** — Vitest suite (node-environment pure-module test, same pattern as `kanban-v2/commitMapper.test.ts`): ISO->Date->ISO round-trip across sample dates including a leap day; null/empty/garbage input handling for all three helpers; DST-transition-adjacent dates (late March / late October 2026) still round-trip to the same calendar day; `formatDisplay` output shape; and an equivalence check against a reimplemented fixture of the legacy `toInputValue`/`fromInputValue` pair from `InlineDateRangeEditor.tsx:12-22`. 33 tests, verified green under both `TZ=UTC` and `TZ=Asia/Jakarta` (a positive-offset zone) — see the fix-round entry below for why the round-trip assertions had to be rewritten to hold in any timezone.
- **`frontend/src/components/DateField.tsx`** — controlled component (`value`/`onChange` ISO string, `disabled`, `variant: "boxed" | "bare"`, `clearable`, `calendarProps` pass-through, `className`, `aria-label`). Composes the existing vendored `ui/calendar.tsx` (react-day-picker v10) inside `ui/popover.tsx` (Base-UI), the same composition already validated in dark mode by `reui/gantt/gantt-nav.tsx`'s `GanttDatePicker` (`<PopoverContent align="start" className="w-auto p-0!">` wrapping `<Calendar mode="single" .../>`) — no edits to `ui/calendar.tsx` were needed. Trigger is a real `<button type="button">` (Base-UI's `PopoverTrigger` renders one natively, so no `render` prop indirection was needed — passing `className`/`disabled`/`aria-label`/children straight through was sufficient); it shows `formatDisplay(isoToLocalDate(value))` or an em-dash placeholder, left-aligned, no icon. `variant="boxed"` matches the bordered font-mono inline-editor look (`InlineDateRangeEditor.tsx:78`); `variant="bare"` matches `TaskFormModal.tsx`'s borderless FieldRow text (`TaskFormModal.tsx:352`). `clearable` renders a "Clear" row under the calendar styled like the existing Cancel buttons (`InlineDateRangeEditor.tsx:93-99`). Zero new dependencies; not yet imported by any call site (later tasks in the plan migrate the five existing native-input sites).

### Fixed — 2026-07-28 — DateField fix round 2: Positioner z-index, disabled-while-open Escape trap, aria-label, test gap (plan Task 1 verification response)

A verification review of fix round 1 (below) confirmed most fixes but found the z-index fix didn't actually work, one new defect the round-1 Escape fix introduced, and three small items. All resolved:

- **Popover still painted under Drawer/Modal (blocker — round 1's z-index fix didn't work).** Round 1 added `z-101` to `PopoverContent`'s Popup className, but Base-UI's `PopoverPrimitive.Positioner` carries an inline `transform`, which creates its own stacking context; a z-index on the Popup (nested inside the Positioner) is trapped inside that context and can't outrank a sibling z-100 layer, while the Positioner itself was still `z-index: auto`. Live DOM hit-testing confirmed a z-100 Modal/Drawer still painted over the popup and stole its clicks. Fixed at the source: `frontend/src/components/ui/popover.tsx`'s `PopoverContent` (2 new `// SOLVRO PATCH` sites, first vendored-patch touch to this file) gained an optional `positionerClassName?: string` prop applied via `cn(positionerClassName)` to `PopoverPrimitive.Positioner`'s className — additive only, no default z-index change, so `gantt-nav.tsx`'s existing popover usage is unaffected. `DateField.tsx` now passes `positionerClassName="z-101"` instead of putting `z-101` on the Popup; the Popup keeps `w-auto p-0! shadow-overlay`.
- **Escape trap when `disabled` flips while open (new defect from round 1's fix).** The round-1 Escape capture-listener effect gated on `open` state, but the Popover renders with `open={open && !disabled}` — if `disabled` went true while open, the popup hid but the capture listener stayed attached, swallowing every document Escape (host Modal/Drawer became keyboard-unclosable), and the popover could spring back open once `disabled` cleared. Fixed by deriving one `const isOpen = open && !disabled` (`DateField.tsx`) used for both the Popover's `open` prop and the effect's gate/dependency, plus a small effect that resets `open` to `false` when `disabled` becomes `true` so the popup can't resurrect.
- **CHANGELOG rationale correction.** Round 1's shadow-token bullet below claimed `tailwind-merge` resolves the `shadow-md`/`shadow-overlay` conflict in favor of the later class. Verified false: `twMerge` treats them as different shadow keys and keeps both; the override actually works because `.shadow-overlay`'s CSS rule is emitted later in the built stylesheet than `.shadow-md`'s, at equal specificity. Corrected in place in the round-1 bullet since it was still uncommitted.
- **Accessible name masked the current value.** `ariaLabel ?? "Select date"` meant screen-reader users never heard the selected date. Changed to `ariaLabel ?? (date ? \`Select date, currently ${formatDisplay(date)}\` : "Select date")` (`DateField.tsx`).
- **Test gap: `localDateToIso`'s non-midnight normalization was never exercised.** Every existing test passed already-local-midnight `Date`s into `localDateToIso`, so its `format` → re-parse-as-local-midnight → `toISOString()` line never had an observable effect (a non-normalized implementation would have passed every prior test). Added one test asserting `localDateToIso(new Date(2026, 6, 26, 23, 30))` equals `localDateToIso(new Date(2026, 6, 26))`, TZ-independently. Suite is now 34 tests, verified green under both `TZ=UTC` and `TZ=Asia/Jakarta`.

### Fixed — 2026-07-28 — DateField fix round: TZ-independent tests, z-index/dismiss/clear/type-safety fixes (plan Task 1 review response)

Nine findings from `solvro-reviewer`'s pass on Task 1 (`feat/reui-date-field`), all resolved in the same three files:

- **Timezone-dependent tests (blocker).** `frontend/src/lib/dateField.test.ts`'s round-trip assertions (previously at :41, :61, :114) compared the UTC-slice of `localDateToIso`'s output ISO to the originally-picked calendar day — wrong under a positive-offset timezone, since `.toISOString()` legitimately shifts that substring back a day east of UTC (documented behavior, not a bug; 14/33 tests failed under `TZ=Asia/Jakarta`). Rewrote those assertions to check a same-instant invariant instead (`new Date(roundTripped).get{FullYear,Month,Date}()` matches the source `Date`'s local getters), which holds in every timezone by construction. Verified green under both `TZ=UTC` and `TZ=Asia/Jakarta`.
- **Popover painted under Drawer/Modal (blocker).** `frontend/src/components/DateField.tsx`'s `PopoverContent` was `z-50` (vendored default) while `Drawer.tsx`/`Modal.tsx` are `z-100` full-viewport layers — inside a drawer/modal host (e.g. the upcoming `TaskFormModal` migration) the calendar would paint behind the shell and clicks would hit the shell's `onMouseDown={onClose}` instead. Added `z-101` to `PopoverContent`'s className.
- **`clearable={false}` bypassable.** react-day-picker fires `onSelect(undefined)` when the user re-clicks the already-selected day; `handleSelect` mapped that straight to `onChange(null)` regardless of `clearable`. Now guards: when `day` is `undefined` and `!clearable`, the popover just closes without calling `onChange` (mirrors `reui/gantt/gantt-nav.tsx:401-406`'s `if (next)` pattern).
- **Misleading docstring.** `dateField.ts`'s top comment claimed the classic UTC-slice off-by-one was avoided; it's actually deliberately reproduced for byte-parity with `InlineDateRangeEditor.tsx:12-22`. Reworded to state that plainly. Also qualified this entry's own earlier "33 new tests, all green" claim above (see the timezone-dependent-tests bullet).
- **Escape closes the popover *and* the host Drawer/Modal.** Base-UI's dismiss listener and `Drawer.tsx`/`Modal.tsx`'s close listeners are all bubble-phase `document` keydown listeners — `stopPropagation()` from inside one doesn't suppress co-located listeners on the same node. Added a capture-phase `document` keydown listener (registered only while `open`) that on Escape calls `stopImmediatePropagation()` + `preventDefault()` and closes via `setOpen(false)`, removed on close so a second Escape reaches the host shell normally.
- **Shadow token.** DESIGN.md sanctions only `shadow-overlay` for overlay surfaces; the vendored `PopoverContent` hard-codes `shadow-md`. Added `shadow-overlay` to `DateField`'s `PopoverContent` className override. Correction: this does *not* work via `tailwind-merge` conflict resolution as originally stated here — verified `twMerge` treats `shadow-md` and `shadow-overlay` as different shadow keys (`shadow-overlay` isn't one of Tailwind's recognized `shadow-*` scale values, so `twMerge` doesn't dedupe against it) and keeps both classes in the output. The override actually takes effect purely from CSS cascade order: `.shadow-overlay`'s rule is emitted later in the built stylesheet than `.shadow-md`'s, and at equal specificity (single class selector, no `!important`) the later rule wins.
- **Disabled-while-open could strand the popover open.** `onOpenChange={disabled ? undefined : setOpen}` meant a `disabled` flip while open would leave Base-UI unable to close it. Replaced with `open={open && !disabled}` + unconditional `onOpenChange={setOpen}`.
- **Accessible name defaulted to the em-dash placeholder.** With no `aria-label` and a null value, the trigger's accessible name was "—". Now defaults to `ariaLabel ?? "Select date"`.
- **`calendarProps` type let callers silently pass the pinned props.** Changed to `Partial<Omit<React.ComponentProps<typeof Calendar>, "mode" | "selected" | "onSelect">>` so `mode`/`selected`/`onSelect` can't be passed through even silently; runtime merge order (`defaultMonth` caller-wins) unchanged.

### Fixed — 2026-07-27 — Final-review fix wave: humanized palette status hints, Enter-key e2e coverage (plan Task 6)

Four small fixes from the branch's final whole-branch review (`solvro-reviewer`, `final-review.md` §C), all on `feat/global-search`:

- **S1 — raw project-status enum rendered in the palette.** `frontend/src/components/CommandPalette.tsx`'s Projects hint fell back to `p.status` (e.g. `ON_HOLD`, `PLANNING`) for the ~34% of dev projects with no customer assigned. Added an exported `projectStatusLabel()` helper next to the existing `PROJECT_LABEL` map in `frontend/src/components/StatusChip.tsx` and used it for the fallback (`hint: p.customerName ?? projectStatusLabel(p.status)`), matching the humanized text ("On hold", "Planning", ...) used everywhere else project status is shown.
- **S2 — Enter-key selection uncovered in e2e.** `e2e/tests/search.spec.ts`'s project-hit test selected only via row `.click()`, leaving the palette's primary keyboard gesture (`autoHighlight` + Enter) untested despite the spec's own Testing Strategy naming it. Changed the project test to select via `dialog.getByPlaceholder(/search projects/i).press("Enter")` after asserting the row is visible, keeping the existing `waitForURL` assertion. The task-hit test's `.click()` is left as-is, so both selection gestures stay covered across the two tests.
- **N-a — duplicated `hasQuery` predicate.** `CommandPalette.tsx`'s `AutocompleteEmpty` gate re-expressed `debounced.trim().length >= 2` inline instead of reusing the `hasQuery` constant already defined a few lines above — the same predicate-divergence shape that caused an earlier blocker (B1). Replaced with `{hasQuery ? ... : null}`.
- **N-c — stale comment in `frontend/src/components/layout/Sidebar.tsx`.** The comment above `SIDEBAR_BG` claimed the `bg-sidebar` token was "defined in tailwind.config.ts" — that file was deleted 2026-07-24. Corrected to say the token lives in `frontend/src/index.css`'s `@theme inline` block.

### Added — 2026-07-27 — Playwright coverage for the ⌘K command palette (plan Task 5)

- E2E coverage for the ⌘K palette (`e2e/tests/search.spec.ts`): open/close, run-unique task + project hits, task deep-link `?task=` assertion, mobile icon entry point. Also covers the four review-mandated addendum assertions from Task 4's review: Escape closing the palette from the actual focused input (not just an arbitrary keydown target), input autofocus on open, no stale rows surviving a close/reopen cycle (B1 regression guard), and mobile viewport fit (no horizontal overflow, dialog height within viewport).

### Fixed — 2026-07-27 — Task 5 mobile-fit assertion measured the wrong element (review fix rounds 1–2)

`e2e/tests/search.spec.ts`'s mobile viewport-fit test (Task 5 addendum #4) went through two review rounds before it actually measured the bug it claims to guard:

- **Round 1** replaced an initial `document.documentElement.scrollWidth/clientWidth` poll (blind to overflow inside the palette's own `position: fixed; inset: 0` overlay) with the same poll against the dialog element itself, plus `boundingBox()` x/height assertions.
- **Round 2 re-review** measured against the live palette and found round 1's fix still targeted the wrong element: the dialog itself has no `overflow` set, so row overflow never reaches it — it terminates one level down, at `[data-slot="scroll-area-viewport"]` (`frontend/src/components/ui/scroll-area.tsx`, computed `overflow-x: scroll`), the `ScrollArea` sitting between the dialog and the result rows. Measured 0px on the dialog under a simulated truncation regression that produced 784px of real overflow on the viewport element. Separately, the seeded task title (~24 chars) was too short to overflow a 390px row even when measured correctly (0px up to 40 chars, 7px at 60, 836px at 200) — `title` allows up to 200 chars server-side (`backend/src/routes/tasks.ts`), so a padded seed is legal.
- **Final fix**: the test now polls `[data-slot="scroll-area-viewport"]`'s `scrollWidth − clientWidth` instead of the dialog's, and seeds a dedicated long task (`createLongUniqueTask`, ~100+ char title, local to this test) via a short search query — `GET /search`'s own `q` param is capped at 100 chars (`backend/src/routes/search.ts`), so the palette input is filled with a short prefix while the full padded title is what's asserted visible and what stresses the row. The round-1 `boundingBox()` x/height assertions were dropped: the dialog is `w-full` inside `fixed inset-0 flex items-stretch justify-center`, so its box is structurally pinned to the viewport regardless of content and those assertions added no coverage. Renamed to `"mobile: a long result row doesn't overflow the palette's scroll viewport horizontally"` to match what's actually measured.

### Fixed — 2026-07-27 — Command palette: stale results below the 2-char gate, permanent focus-ring glow, dead loading indicator (plan Task 4 review fix round 1)

Three fixes to the ⌘K command palette from code review, all in `frontend/src/components/CommandPalette.tsx` unless noted:

- **Stale search hits below the 2-char gate / across reopen (blocker).** `useSearch`'s
  `placeholderData: (prev) => prev` (`frontend/src/lib/queries.ts`) resolves against React
  Query's `#lastQueryWithDefinedData`, which never clears on a key change, on `enabled:
  false`, or on the observer staying mounted (`Shell.tsx` keeps `<CommandPalette>` mounted
  always). Result: after any successful search, reopening the palette or backspacing below
  2 characters still rendered the previous query's Projects/Tasks/Customers rows
  (`isPlaceholder: true`) — `AutocompleteEmpty`'s own `>=2`-char gate didn't help, since
  there *were* items. Fix: added `hasQuery = debounced.trim().length >= 2` and gated the
  `remote` items array on it (`!hasQuery || !data ? [] : [...]`), added as a `useMemo` dep.
  `placeholderData` itself is unchanged — it's correct for in-flight keystrokes at ≥2 chars.
- **Permanent 3px focus-ring glow on the palette input, exceeding DESIGN.md §4's 2px cap.**
  The vendored `AutocompleteInput`'s `inputVariants` base survives `cn()`-merging with the
  call site's className for several classes that don't share a Tailwind variant with any
  override the call site had set: `dark:bg-input/30` (a visible slab in dark mode),
  `rounded-lg`/`h-9`/`px-2.5` (a boxed look inside the palette's own padded row), and
  `focus-visible:ring-3` (a permanent glow on the `autoFocus`ed input). Fix: added
  `dark:bg-transparent rounded-none h-auto px-0 focus-visible:ring-0
  focus-visible:border-transparent` to the input's className and dropped `size="lg"`
  (its only surviving contribution was the now-overridden `h-9 px-2.5`). Verified via the
  repo's own `tailwind-merge` that the previously-surviving classes are displaced in the
  merged output (`focus-visible:ring-ring/50` remains in the class list but is inert once
  paired with `ring-0`, since ring width and ring color are independent Tailwind utilities
  and a 0px ring has no visible color regardless).
- **Dead "Searching…" indicator.** `isLoading` (`isPending && isFetching`) is forced false
  by `placeholderData` after the first successful search of a session (`queryObserver`
  sets `status: "success"` once a placeholder value exists), so the indicator rendered
  once and never again — the opposite of useful for a debounced palette. Fix: destructure
  `isFetching` instead of `isLoading` from `useSearch` and gate the indicator on
  `isFetching && hasQuery`.

### Added — 2026-07-27 — ⌘K command palette wired to `GET /search` + nav commands (plan Task 4)

- `frontend/src/components/CommandPalette.tsx`: searches projects/tasks/customers via
  `GET /search` (debounced `useSearch` hook, 200ms) plus permission-gated page commands
  from `navCommands.ts`'s `filterNavCommands`; task hits deep-link through the existing
  `?task=` param on `/projects/:id/list`. Rendered as a Modal-convention centered overlay
  (Esc + body-scroll-lock recipe from `Modal.tsx`) via `createPortal`.
- `frontend/src/lib/queries.ts`: `SearchProjectHit`/`SearchTaskHit`/`SearchCustomerHit`/
  `SearchResults` types mirroring the `GET /search` response contract, `queryKeys.search`,
  and the `useSearch(q)` hook (`enabled` gates on the backend's 2-char minimum;
  `placeholderData` keeps the prior results rendered while a keystroke's query is in flight).
- Composition deviates from the plan brief's literal Step 3 code, reconciled against the
  vendored component's real Base UI API (verified against `@base-ui/react`'s bundled
  `.d.ts` files and its own docs, not assumed): uses `AutocompleteGroup`/
  `AutocompleteGroupLabel`/`AutocompleteCollection` for the four result groups instead of
  heading-row `div`s; uses `inline`+`open` (unconditional) instead of the anchored
  `AutocompleteContent`/`Portal`/`Positioner`/`Popup` stack, per Base UI's own documented
  "command palette" recipe — the anchored popup is built for a dropdown below an input
  and fights this centered overlay; controls the search text via `value`/`onValueChange`
  on the `Autocomplete` root (both official Base UI examples for externally-filtered data
  do this) rather than via raw `value`/`onChange` on `AutocompleteInput`; passes
  `filter={null}` since results are already server/permission-filtered; keeps
  `AutocompleteEmpty` unconditionally mounted per Base UI's a11y guidance (it warns
  against conditionally rendering the component itself) and instead conditionally renders
  only its *children* to avoid a premature "no results" flash before 2 characters are
  typed. Full detail and file:line citations in the Task 4 report.

### Changed — 2026-07-27 — TopBar search trigger, Shell ⌘K listener, Sidebar/`navCommands` unification (plan Task 4)

- `frontend/src/components/layout/TopBar.tsx`: the decorative search box is now a live
  palette trigger button (`onOpenSearch`, now a required prop) with a mobile-only search
  icon button below `md:`.
- `frontend/src/components/layout/Shell.tsx`: hosts `<CommandPalette>` and a single
  app-wide ⌘K/Ctrl+K `keydown` listener that skips editable targets (`INPUT`/`TEXTAREA`/
  `contentEditable`) so typing "k" with a modifier inside a text field never hijacks focus.
- `frontend/src/components/layout/Sidebar.tsx`: now derives its nav items directly from
  `NAV_COMMANDS` (`frontend/src/lib/navCommands.ts`) instead of a hand-copied local
  `NAV_ITEMS`/`NavItem` — single source of truth for page destinations. Scope amendment
  approved 2026-07-27, resolving Task 2 review finding I1 (the catalogue must not be a
  second, hand-copied source of truth). Rendered output is unchanged (same order, labels,
  icons, Executive/Admin permission gating).
- `frontend/src/lib/navCommands.ts`: `NAV_COMMANDS` export is now `readonly NavCommand[]`
  (guards against consumer mutation now that Sidebar also consumes it); absorbed the
  Work Logs/Tasks sidebar-absence explanatory comment from the deleted `Sidebar.tsx`
  `NAV_ITEMS`.
- `frontend/src/lib/navCommands.test.ts`: renamed the route-list test from "keeps every
  route in sync with the app's route table" to "pins the catalogue's route list" — with
  Sidebar now consuming the catalogue directly, the pin is genuinely load-bearing rather
  than an aspirational cross-check against `App.tsx`.

### Fixed — 2026-07-27 — Vendored autocomplete: stop `scrollFade`/`scrollbarGutter` leaking to the DOM (plan Task 3 review fix round 1)

- `frontend/src/components/reui/autocomplete.tsx`'s `AutocompleteList` declared
  `scrollFade`/`scrollbarGutter` in its props type but never destructured them, so both
  fell into the JSX spread `...props` and landed on the rendered `<div>` as unknown DOM
  attributes. Upstream ReUI's own scroll-area implementation consumed these props; our
  Base-UI `ui/scroll-area.tsx` substitute does not.
- Fix: destructure and discard both (`scrollFade: _scrollFade, scrollbarGutter:
  _scrollbarGutter`), marked with a 5th `// SOLVRO PATCH` comment — kept in the type so
  callers passing them still typecheck and a future re-pull diff stays minimal.

### Added — 2026-07-27 — Vendored ReUI autocomplete component (plan Task 3)

- Hand-vendored `frontend/src/components/reui/autocomplete.tsx` (Base-UI-backed) for
  the ⌘K palette — zero new npm dependencies (`@base-ui/react`,
  `class-variance-authority`, `scroll-area` all pre-existing).
- Vendored by hand from the registry JSON (`https://reui.io/r/new-york/autocomplete.json`)
  rather than via `npx shadcn@latest add @reui/autocomplete`: the CLI's `scroll-area`
  registryDependency 401s against the `@reui` registry and falls back to the default
  shadcn registry's Radix-based `scroll-area`, which pulled `radix-ui` (plus the full
  `@radix-ui/*` tree) into `frontend/package.json`/`package-lock.json` — a direct
  violation of the CLAUDE.md guardrail that `radix-ui` must never be reintroduced. The
  attempted CLI install was reverted before vendoring by hand; final diff touches only
  the one component file.
- Two minimal hand-edits to the vendored file, each marked `// SOLVRO PATCH`: added the
  `import * as React from "react"` the registry source omitted (required for
  `React.ComponentProps<...>` under this repo's `jsx: "react-jsx"` tsconfig), and swapped
  the registry's `IconPlaceholder` import (a ReUI demo-app-only path that doesn't exist
  in this repo) for the two `lucide-react` icons it mapped to (`XIcon`,
  `ChevronsUpDownIcon`), matching this repo's existing `*Icon` lucide-react convention.

### Added — 2026-07-27 — Palette nav-command catalogue (plan Task 2)

- Palette page-navigation catalogue: `frontend/src/lib/navCommands.ts` (pure module + tests) mirroring the sidebar's permission-gated destinations for the ⌘K palette.

### Fixed — 2026-07-27 — `GET /search`: escaped LIKE metacharacters, top-level tasks only (plan Task 1 review fix round 1)

Two fixes to the `GET /search` endpoint added earlier today, from code review:

- **ILIKE metacharacter escaping** — Prisma's `contains` passes `q` straight
  into the SQL `ILIKE` pattern unescaped, so a literal `%`/`_` in a search
  term acted as a SQL wildcard (e.g. `q="%%"`, which passes the `min(2)`
  check, matched every row). `backend/src/routes/search.ts` now escapes
  `\`, `%`, and `_` in `q` via a Zod `.transform` on the query schema before
  it reaches any Prisma `contains` filter.
- **Subtasks excluded from task results** — the task query now adds
  `parentTaskId: null` (mirrors the `topLevel=true` convention in
  `tasks.ts`): a command-palette row can't convey a parent task, and the
  planned `?task=` deep-link is only proven for top-level tasks.
- Tests added to `backend/test/search.test.ts`: literal `%` in `q` matches
  only the literal row (not a wildcard-inflated set), `q="%%"` returns all
  three groups empty, and a seeded subtask is excluded from `tasks` while
  its top-level sibling is returned.

### Added — 2026-07-27 — Global search API: `GET /search` endpoint for the command palette (plan Task 1)

Backend half of the ⌘K command palette (frontend wiring lands in later plan
tasks). Returns visibility-scoped project/task/customer matches for a query
string.

- `GET /search?q=<2–100 chars>` — case-insensitive `contains` match against
  project name, task title, and customer name; each group capped at 8
  results, ordered by name/title asc. `401` unauthenticated, `400`
  invalid/missing `q`. `backend/src/routes/search.ts`, mounted in
  `backend/src/app.ts` (`app.use("/search", searchRouter)`, after `/reports`).
- Projects and tasks are scoped via the existing
  `projectVisibilityFilter(user)` (`backend/src/lib/visibility.ts`) — same
  TAM/SA/admin visibility rules as `/projects`. Customers aren't
  project-scoped in the schema, so all customers matching `q` are returned
  regardless of caller.
- `ProjectNote` is deliberately NOT searched — the INTERNAL-notes guardrail
  must hold even at a search surface, so Daily Review notes (INTERNAL by
  default) can never leak through search results.
- Tests: `backend/test/search.test.ts` — auth (401), validation (400 on
  short/missing `q`), response shape, case-insensitive matching, 8-result
  cap per group, and TAM-vs-admin visibility scoping (6 cases).

### Removed — 2026-07-27 — Dependabot disabled entirely (config deleted + both repo settings turned off)

User decision: the PR volume was not worth the benefit. Grouping and a
monthly cadence (previous entry) were tried first and still did not settle
it — a further major-version PR arrived while that change was in review — so
Dependabot is switched off completely rather than tuned again.

Three separate switches, all now off:

- **`.github/dependabot.yml` deleted** — stops *version* updates, which are
  driven solely by this file.
- **`DELETE /repos/:owner/:repo/automated-security-fixes`** — stops
  *security update* PRs. These come from a repository setting, not from the
  config file, so deleting the file alone would not have stopped them.
- **`DELETE /repos/:owner/:repo/vulnerability-alerts`** — stops Dependabot
  alerts, removing the Security-tab list as well as the PRs.

**Consequence, recorded deliberately:** ~29 open advisories were still
outstanding when this was turned off, and they are no longer tracked
anywhere in the repo. Dependency vulnerabilities will now surface only if
someone runs `npm audit` by hand. The remaining known-unfixed items at
time of writing were `brace-expansion` ×3 (high), `react-router` ×3 +
`react-router-dom` ×1 (medium, fix requires the v7 major), `dompurify` ×9,
`vite` ×3, `uuid`, `@babel/core`, `esbuild` ×2, `tmp`, `fast-uri`,
`postcss`, `js-yaml` ×2 and `body-parser` — most of which had working PRs
that were closed as part of the noise cleanup.

To re-enable later: restore this file and `PUT` the same two endpoints.

### Changed — 2026-07-27 — Dependabot version updates grouped and moved to monthly (≈9 PRs/week → 1–2 PRs/month)

Removing `target-branch` (previous entry) released the version-update stream
that had been suppressed, and nine PRs arrived in one sweep — `zod` 3→4,
`@prisma/client` 5→7, `recharts` 2→3, `dotenv` 16→17, `react-dom`, plus four
routine bumps. **None of them closed a security alert.** One PR per package
per week is unusable noise, and the noise was pushing toward disabling
Dependabot altogether, which would also have discarded the security updates
that found the critical `tar` advisory.

Version and security updates are separate systems: this file governs only
version updates, while security updates come from a repository setting and
are untouched by anything here. So the version stream is throttled and the
security stream is left alone.

- **`.github/dependabot.yml`**: every ecosystem gains a `groups:` block
  collapsing all `minor` + `patch` bumps into one PR per ecosystem;
  `schedule.interval` weekly → monthly; `open-pull-requests-limit` 5 → 2.
- Majors are deliberately left **ungrouped** rather than ignored, so they
  arrive individually and each stays an explicit accept/close decision.
- No `ignore:` rules were added, on purpose: `ignore` can also suppress
  *security* updates for the same package, and some security fixes exist
  only behind a major (react-router's advisories require v7). Silencing
  majors here would hide those.

Security updates continue to arrive one PR per advisory, promptly and
ungrouped — the behaviour worth keeping.

### Removed — 2026-07-27 — `target-branch: develop` dropped from `.github/dependabot.yml` (all 6 entries)

The option was added when `main` was the repository's default branch, to
push dependency PRs onto `develop`. It never achieved that for **security**
updates: those always target the default branch and ignore `target-branch`,
which is why all 8 security PRs opened against `main` despite the config.

Once the default branch was changed to `develop` (so security updates would
land there by themselves), the option became actively harmful — Dependabot
now read it as describing a *non-default* branch and disowned every open PR:

> The dependabot.yml entry that created this PR has been deleted so this PR
> can't be rebased. Please close the PR so Dependabot can create a new one
> with the current dependabot.yml.

Those 8 PRs could then be neither rebased nor retargeted, only closed and
recreated. With `develop` as the default branch the option is redundant for
version updates too, so it is removed from all six ecosystem entries;
schedules, directories, and `open-pull-requests-limit` are unchanged.

`main` remains the release branch, advancing only via develop→main release
PRs — a convention enforced by `docker-publish.yml`, not by this file.

- **`.github/dependabot.yml`**: `target-branch: develop` removed ×6; header
  comment rewritten to record why it must not be reintroduced.

### Changed — 2026-07-27 — `bcrypt` 5.1.1 → 6.0.0 to clear the entire `tar` alert cluster (12 Dependabot alerts, incl. the only critical)

Dependabot could not auto-fix `tar` in `/backend`: its update job failed with
"A patched version exists for tar, but the available update path still
resolves it to 6.2.1", because `bcrypt@5.1.1` pins `tar@^6.1.11` through
`@mapbox/node-pre-gyp@1.0.11`. `tar` was reachable by exactly one path in
`backend/package-lock.json` — that one — so removing `node-pre-gyp` removes
every `tar` alert rather than papering over them with an `overrides` pin.

`bcrypt@6.0.0` drops `@mapbox/node-pre-gyp` in favour of `node-gyp-build`
(prebuildify), so its only runtime deps are `node-addon-api` +
`node-gyp-build`. Net effect on the lockfile: **52 packages removed**, and
both `tar` and `@mapbox/node-pre-gyp` are gone entirely.

- **`backend/package.json`**: `bcrypt` `^5.1.1` → `^6.0.0`; `@types/bcrypt`
  `^5.0.2` → `^6.0.0`.
- **`backend/package-lock.json`**: regenerated (−572/+30 lines).

Call sites are unchanged — the app only uses `bcrypt.hash(pw, 10)` and
`bcrypt.compare(...)` (`backend/src/routes/auth.ts`,
`backend/src/routes/admin.ts`, `backend/scripts/create-admin.ts`), and both
signatures are identical in v6.

**Hash compatibility verified explicitly**, since a regression here would
lock every existing user out: hashes generated by bcrypt 5.1.1 (`$2b$10$`,
`$2b$12$`, and `$2a$10$`) were all confirmed to verify correctly under
6.0.0, with wrong passwords still rejected. No password reset or rehash is
required, and stored `passwordHash` values need no migration. Note that the
backend Vitest suite does *not* cover this — `backend/test/testAuth.ts`
mints JWTs directly with `passwordHash: null` — so the cross-version check
was done by hand rather than being caught by a gate.

`bcrypt@6` requires Node ≥ 18; the backend image and all three CI jobs are
already on Node 22. A from-scratch `backend/Dockerfile` build was run to
confirm the new native module compiles and loads in `node:22-slim`.
### Fixed — 2026-07-27 — CI no longer depends on the repo secret store, unblocking every Dependabot PR

All 8 open Dependabot PRs failed `backend-tests` and `e2e` identically, with
`Database is uninitialized and superuser password is not specified` and
`required variable POSTGRES_PASSWORD is missing a value`. The cause is not
the dependency bumps: GitHub passes **only the Dependabot secret store** to
Dependabot-triggered runs, so every `secrets.CI_*` reference in `ci.yml`
resolved to an empty string. Populating that store was tried first and did
not resolve it (verified on run `30227846101` — a fresh, fully
Dependabot-actored run raised after the secrets existed, still empty), so
the dependency on the secret store is removed instead. This fixes the whole
class of failure regardless of which secret store is at fault, and puts
human and bot PRs on an identical code path.

- **`.github/workflows/ci.yml`** (`e2e`): `POSTGRES_PASSWORD` and
  `ADMIN_PASSWORD` are now generated per run with `openssl rand -hex 24` and
  exported via `$GITHUB_ENV`, alongside the `JWT_SECRET` that already worked
  this way. The step is renamed to "Generate ephemeral run credentials".
  `$GITHUB_ENV` makes them visible to every later step — compose
  interpolation, admin creation, and Playwright's fixtures, which read
  `ADMIN_PASSWORD` from the environment (`e2e/fixtures/test.ts`). The
  48-character output clears `create-admin.ts`'s 8-character minimum.
- **`.github/workflows/ci.yml`** (`backend-tests`): the postgres service
  container now uses the literal `ci-ephemeral-postgres`. A service
  container's `env:` is resolved before any step runs, so a generated value
  is impossible there. The database is localhost-only and dies with the job,
  so the literal protects nothing that secret status was protecting.
- The `CI_POSTGRES_PASSWORD` / `CI_ADMIN_PASSWORD` secrets in both the
  Actions and Dependabot stores are now unused and can be deleted.

### Fixed — 2026-07-27 — `latest` image tag pinned to `main` instead of the repo default branch

`docker-publish.yml` gated the `latest` tag on `enable={{is_default_branch}}`.
That silently couples the production tag to a **repo setting**: when the
default branch was switched to `develop` (so Dependabot security updates
would stop targeting `main`, which they always aim at the default branch),
`is_default_branch` became false for `main` and release builds would have
stopped publishing `latest` — the tag production pulls. No release ran in
that window, so nothing shipped mistagged.

- **`.github/workflows/docker-publish.yml`**: `latest` is now gated on the
  literal branch name (`workflow_run.head_branch == 'main'`, plus
  `workflow_dispatch` on `refs/heads/main` to preserve manual-publish
  behaviour), so no repo setting can move the production tag. Tag pushes
  remain excluded, matching previous behaviour.

### Changed — 2026-07-27 — Kanban cutover: `/projects/:id/kanban` now serves the ReUI-engine board (plan T11)

`docs/plans/kanban-reui-swap/plan.md` T11 — the deliberate cutover commit
that ends the parallel-route trial. `SolvroKanban` (the ReUI-engine board,
`frontend/src/components/kanban-v2/`) now renders on the real `/kanban`
route; the trial `/kanban2` route is gone.

- **`frontend/src/pages/views/ProjectKanban.tsx`**: the old hand-rolled board
  deleted and replaced by the former `ProjectKanban2.tsx` thin wrapper
  (renamed onto this path) — `useProjectContext()` → `<SolvroKanban
  project={...}/>`. Header comment updated to describe the wrapper as the
  live `/kanban` route rather than the trial route.
- **`frontend/src/App.tsx`**: `kanban` child route now renders the new
  wrapper; the `kanban2` route and its `ProjectKanban2` import removed.
  `ProjectDetail.tsx`'s tab list needed no change — its `kanban` tab already
  pointed at this route.
- **`frontend/src/components/kanban-v2/cards.tsx`, `SolvroKanban.tsx`,
  `MobileMoveSheet.tsx`**: stale `/kanban2`/"trial window" comments updated
  to describe the post-cutover state (no behavior change).
- **`e2e/fixtures/test.ts`**: `KANBAN_ROUTE` flipped from `"kanban2"` to
  `"kanban"` — the single source of truth for the route segment under test.
- **`e2e/tests/kanban-dnd.spec.ts`**: stale `KANBAN_ROUTE`/"trial board"
  comment updated; `kanban-dnd` now exercises the real `/kanban` route.
- **`.claude/agents/solvro-qa.md`** (R4): added two standing guardrail
  checks — `frontend/src/components/reui/kanban.tsx` exists, and its
  `// SOLVRO PATCH` marker count matches the count recorded in this
  CHANGELOG (currently 0; any future sanctioned patch must update both in
  the same turn).

**Removed**: `ProjectKanban.tsx`'s legacy hand-rolled board (1,182 lines,
dnd-kit orchestration + collision-detection logic) — git history preserves
it in full.

**Final measurements** (recorded at CP2, reconfirmed at cutover): Solvro-owned
runtime 1,363 lines (`kanban-v2/` + the thin wrapper) including 314 pure
`adapter.ts`/`commitMapper.ts` lines under 36 unit tests
(`adapter.test.ts` + `commitMapper.test.ts`); vendored `reui/kanban.tsx` 947
lines, 0 patches (Gantt precedent was 3); `e2e/tests/kanban-dnd.spec.ts` 21
cases, green on both the desktop and mobile Playwright projects against
`/kanban`.

### Changed — 2026-07-27 — kanban-dnd e2e spec final stabilization: fixture isolation, drag geometry, settle timing, locator perf (plan T10 follow-up)

Second follow-up to the T10 e2e rewrite/hardening entries below — spec and
fixture files only, no frontend source touched. Every failure was
root-caused against the live dev stack rather than assumed; several of the
prescribed fixes turned out to be necessary-but-insufficient once verified,
so this entry documents what was actually found, not just what was
attempted.

- **`e2e/fixtures/seed.ts`**: `seedFixture` now always creates a fresh,
  isolated customer instead of reusing `customers[0]` (GET /customers,
  ordered alphabetically by name) when one already existed. Root cause of
  the modal-trio ("via Tasks") failures: every prior seedFixture call across
  this repo's e2e/QA history kept attaching fresh projects to whichever
  customer sorts first by name (empirically "Acme Corp", id 1), which has
  accumulated 380+ projects as a result — `GET /tasks?customerId=1` alone
  still returns enough other, lower-id rows from Acme Corp's other projects
  to fill the backend's `take: 200` window (`backend/src/routes/tasks.ts`)
  before a freshly seeded project's own rows are reached. `SeededFixture`
  gained a `customerId` field so specs can scope `/tasks` queries
  (`TasksFilter.customerId`) to just their own fixture.
- **`e2e/tests/kanban-dnd.spec.ts`**:
  - Modal trio (subtask re-parent, subtask promote, G10): `/tasks` now
    scoped via the Customer filter (new `openTasksPage(page, customerId)`
    signature) before locating rows, using the `customerId` above.
  - G2/G9a same-column one-slot drags: a keyboard-driven lift was
    investigated first as prescribed and found to be a genuine dead end —
    `reui/kanban.tsx` spreads dnd-kit's `attributes` (role/tabIndex, what
    makes an element focusable) onto `KanbanItem`'s outer wrapper but its
    `listeners` (the actual onKeyDown activator) only onto the inner
    `KanbanItemHandle`, which carries no tabIndex/role of its own — no real
    keyboard interaction can ever reach the sensor's activator. Fell back to
    the prescribed mouse overshoot, but a height-*multiplied* overshoot
    (1.5x) doesn't scale safely: verified live against a 3-card column with
    a tall (subtask-bearing) distractor card, it skipped two slots instead
    of one. Switched to (a) measuring the full card box (`cardBoxFor`, new
    helper) instead of just the title text's bbox, and (b) a small FIXED
    pixel clearance (20px) past that box's edge — verified across a 0–30px
    sweep against both plain and tall cards. G9a also had a second,
    independent bug: measuring drag-target geometry immediately after
    closing the priority filter raced dnd-kit's `animateLayoutChanges` CSS
    transition as the filtered-out card left the DOM — a settle wait
    (400ms) was needed before measuring, not just before dragging; added to
    G9a and G9b.
  - G9b column-space drop: retargeted from a card-adjacent offset to the
    `[data-slot="kanban-column"][data-value="TODO"]` column's own bottom
    padding, so the append signal (`over.id === "TODO"`) fires instead of a
    card-drop being (correctly) read as an insert.
  - G1: pins a deterministic fixture before dragging (three named roles plus
    a sweep of any further top-level tasks into `IN_PROGRESS`) instead of
    trusting whatever earlier tests left the shared project's global order
    as — previously only passed reliably when a Playwright retry happened to
    restart the worker with a fresh project. The sweep also fixed a latent
    bug in G9a's pre-existing pin (which predates this task): it only forced
    its own three named tasks into place and left any additional top-level
    task untouched, so an unswept 4th task could sit in TODO alongside the
    fixture and shift the overshoot's landing slot.
  - Modal trio's `parentSelect`/`statusSelect` locators switched from
    `dialog.locator("select").filter({ has: dialog.getByRole("option", {
    name: ... }) })` to a CSS `:has()` selector scoped to the field's own
    `FieldRow` row (`div.flex.items-center.gap-3:has(span:text-is("..."))
    select`). Root cause of a reproducible 60s+ timeout on every "via Tasks"
    modal interaction: `GET /users` (no pagination) returns every
    accumulated test user from this repo's e2e/QA history — thousands — and
    TaskFormModal's Assignee field renders all of them as `<option>`s.
    `getByRole("option", ...)` resolves via the browser's accessibility
    tree, and evaluating that role query anywhere on a page holding a
    `<select>` that large never completed in practice (confirmed live: even
    a 30s timeout wasn't enough); the CSS form sidesteps the accessibility
    tree entirely and resolves in well under a second.
- Verified: `docker compose exec frontend npm test` (36/36, commitMapper
  unchanged by this entry), `npx tsc --noEmit` (e2e package), and the full
  `kanban-dnd` spec (desktop + mobile) run twice consecutively with zero
  retries.
- Not touched: any `frontend/src/` file, `CLAUDE.md`.

### Fixed — 2026-07-27 — kanban-v2 commitMapper WYSIWYG append-signal fix + kanban-dnd e2e hardening (plan T10 follow-up)

Follow-up to the T10 e2e rewrite below: that run reported 14 passed, 2
flaky-passed (G1, G2), 5 failed (G9a, G9b, and the three Gantt-path modal
cases). Root-caused and fixed; the earlier entry below is left as-is
(append-only) and documents the attempt this one corrects.

- **`frontend/src/components/kanban-v2/commitMapper.ts`** (+
  `commitMapper.test.ts`, 3 new tests, 27→30): `mapCommitToPatch`'s
  `appendToStatus` signal (M2 fix, Phase 2 review) is now advisory only — it
  takes effect ONLY when the committed arrangement independently agrees the
  moved item landed LAST in the target column (`meta.overIndex ===
  targetColumn.length - 1`); when the signal disagrees with the arrangement,
  it's ignored and ordinary neighbor-based `resolvePosition` math runs
  instead ("the committed arrangement is the truth"). Root cause (G9a
  failure): dnd-kit's `rectIntersection` can resolve
  `meta.event.over?.id` to the column itself even while the live-preview
  arrangement shows a genuine mid-column card-to-card insert; the old
  unconditional check took the append branch, computed a position equal to
  the moved card's own current slot, and the no-op guard silently swallowed
  it — nothing committed while the user watched the card visually move. New
  tests (describe block "T10 (2026-07-27) M2 refinement"): (a) signal set +
  moved mid-column → neighbor math wins (the G9a shape, hand-derived to
  `{ status: "TODO", position: 0 }`); (b) signal set + moved last →
  unfiltered-anchor append still fires (FA-5 unchanged); (c) no signal +
  moved last-visible with a hidden true-last → neighbor math anchors on the
  visible predecessor, not the hidden card (documents the original M2 case
  as still-correct WYSIWYG behavior for a card-targeted drop — append-to-
  true-end semantics are reserved for genuine column-space drops).
  `docs/plans/kanban-reui-swap/scenarios.md`'s FA-5 amendment annotated with
  a "(T10, 2026-07-27)" follow-up clarifying signal + arrangement agreement.
- **`e2e/tests/kanban-dnd.spec.ts`**:
  - G9a/G9b/G1/G2 retargeted from near-card-edge drop points (`y + 8`,
    `height - 4`) to card vertical centers (`y + height / 2`) — the shared
    geometry-sensitivity root cause: a drop that close to a card's edge (or
    a column's own top boundary, for G9a/G1's first-card cases) risked
    dnd-kit's `rectIntersection` resolving `over` ambiguously. G9b's
    column-body drop retargeted from `height + 60` to `height + 150` to land
    unambiguously in genuine column space. All four now wrap their drag in
    `captureTaskRequests` and assert exactly one PATCH with the derived
    request body (not just the relative-order/readback assertions, which
    stay in place unweakened) so a geometry miss fails loudly instead of
    only a vague ordering mismatch.
  - Subtask re-parent, subtask promote, and G10 (the modal trio) moved off
    the Gantt/Timeline paths — the Gantt route never actually opened the
    dialog in practice (timeout waiting for the parent select) — onto
    `/tasks` (`Tasks.tsx`), whose every `Row.onClick` reliably opens
    `TaskFormModal` mode="edit". Added `openTasksPage`, `taskRowByProject`,
    and `clickTaskRow` helpers: `/tasks` lists tasks across every project,
    so rows are scoped to both the exact title AND the seeded project (via
    the Project column's `<Link href="/projects/:id">`, not its display
    name) to avoid collisions with other specs' fixture projects in the
    shared dev DB. Re-parent/promote uncheck the page's default
    `topLevel: true` ("Top-level only") filter first, since Sub one/Sub two
    aren't top-level; G10 keeps the default filter (Alpha is top-level).
- **`backend/test/`**: verified, not touched. This task's Fix 4 asked for
  three new `PATCH /tasks/:id` error-contract tests (cross-project parent →
  `invalid_parent`, parent-with-a-parent → `max_depth_exceeded`,
  task-with-subtasks-given-a-parent → `max_depth_exceeded`); all three
  already exist verbatim in `backend/test/taskOrdering.test.ts`'s
  pre-existing "depth and parent validation" describe block (predates this
  branch — commit `471892d`, 2026-07-22) and pass. No duplicate tests added.

### Changed — 2026-07-27 — kanban-dnd e2e spec rewritten against kanban-v2 + shared request-capture fixture (plan T10)

Kanban → ReUI Engine Swap plan (`docs/plans/kanban-reui-swap/plan.md`), Task 10
(e2e augmentation), against the binding scenario table + e2e Coverage Audit
(`docs/plans/kanban-reui-swap/scenarios.md`).

- **`e2e/fixtures/test.ts`**: `openKanban` now navigates via a new exported
  `KANBAN_ROUTE` constant (currently `"kanban2"`) instead of a hardcoded
  `/kanban` path — T11's cutover is a one-line flip of this constant back to
  `"kanban"`. Added `captureTaskRequests(page, fn)`, promoted from the T8
  scratch spec's pattern: attaches a `page.on("request")` listener before
  `fn` runs, filters to PATCH/POST requests whose URL contains `/api/tasks`,
  captures `{ method, url, body }` (parsed via `postDataJSON()`), and
  detaches after an 800ms settle window — the shared request-**absence**
  tool (no-op guards) AND request-**body-capture** tool (position-key
  presence) used throughout the rewritten spec below.
- **`e2e/tests/kanban-dnd.spec.ts`** rewritten against `/kanban2`:
  - **Kept** (route-constant change only, via the updated `openKanban`):
    reorder-within-column (SC-1), cross-column column-body drop (CC-2), WIP
    badge, desktop/mobile "no page errors", mobile touch reorder, mobile
    action-sheet move.
  - **Rewritten to the modal path** (board-level subtask drag is retired,
    Architecture Decision 2/8): subtask reorder now goes through
    `TaskPanel`'s "Move subtask up" arrow (T13b path — open Alpha's card,
    open its panel, move Sub two up), keeping the original position-0 +
    parentTaskId assertions — this supersedes scenarios.md's T2 disposition
    (which classified RG-1 as "no modal equivalent, drop") per CP0 decision
    log #3, made after that audit: Task 13 added the modal reorder controls
    specifically to replace this case, so it is rewritten, not dropped.
    Subtask re-parent (Sub one → Delta) and subtask promote (Sub two →
    top-level DONE) now go through `TaskFormModal`'s Parent field, reached
    via the **Gantt** tree's row-label click (`onResourceClick` →
    `onEditTask`, `SolvroGantt.tsx:1111-1116`) rather than Timeline —
    Timeline (`ProjectTimeline.tsx`) renders only top-level task titles as
    clickable buttons; subtask rows there are plain, non-interactive text,
    so Sub one/Sub two's own edit modals aren't reachable from Timeline at
    all. Timeline's title-click path (verified reachable per T13, dialog
    aria-label "Edit task") is used instead for G10 below, where the edited
    task (Alpha) is top-level. The subtask-promote case preserves the
    load-bearing GLOBAL-order assertion verbatim in spirit (promoted task
    lands last in the project's global top-level order, other tasks'
    relative order unchanged) — this is what actually pins the
    unified-task-ordering fix, since a modal-driven parent change never
    sends a `position` key.
  - **Added gap cases** (scenarios.md's e2e Coverage Audit, all via
    `captureTaskRequests` + API readback): G1 (cross-column card-to-card
    drop, CC-1), G2 (same-column downward one-slot drop, the
    must-not-no-op case, SC-2), G3 (drop-in-place, zero requests,
    SC-3/NO-1), G4 (already-last card onto its own column body, zero
    requests, NO-2), G5 (Escape mid-drag, zero requests + DOM order
    unchanged, NO-3), G6 (drop into a genuinely empty column, status-only
    body with no `position` key, CC-3 — run early, before the DONE column
    gets a real member from the subtask-promote rewrite), G9a/G9b/G9c
    (priority-filter trio, CP0 decision log #2 — FA-1-shape hidden-card
    shift, FA-5-shape hidden-true-last-member column-append anchor via the
    M2 fix, and filtered drop-in-place), G10 (modal error path: giving
    Alpha — guaranteed to have a subtask via a fresh API-created one,
    decoupling this case from whatever the re-parent/promote rewrites did
    to Alpha's original seeded subtasks — a Parent surfaces the backend's
    `max_depth_exceeded` message inline, no state change), and R3
    (cross-view parity: List view's rendered top-level row order matches
    the API global order after the file's accumulated drag sequence).
  - Every new case pins its own task roles/positions via direct API
    PATCHes at test start (rather than assuming fixed seed identities
    survive the file's earlier gestures) — same idiom as the pre-existing
    "subtask promote" case's dynamic `othersBefore`/`othersAfter` snapshot,
    generalized across the new gap cases so file-order changes don't
    silently break unrelated assertions.
- **`backend/test/`**: no new file added. `backend/test/taskOrdering.test.ts`'s
  pre-existing "depth and parent validation" describe block (unrelated to
  this plan — shipped under the earlier unified-task-ordering plan) already
  covers RG-4's three specified cases verbatim: `PATCH /tasks/:id` with a
  `parentTaskId` from another project → 400 `invalid_parent` ("rejects a
  parentTaskId that belongs to a different project"), a `parentTaskId`
  belonging to a task that itself has a parent → 400 `max_depth_exceeded`
  ("rejects setting a parent that itself has a parent"), and a task with
  subtasks given a parent → 400 `max_depth_exceeded` ("rejects giving a
  parent to a task that already has subtasks"). Verified rather than
  duplicated.
- Not touched: `frontend/src/pages/views/ProjectKanban.tsx` (byte-identical),
  `frontend/src/components/kanban-v2/*`, `frontend/src/components/reui/
  kanban.tsx`, `CLAUDE.md`.

### Fixed — 2026-07-27 — Phase 2 review fixes (drag-freeze leak, filter-aware column append, modal arrow gating, drag overlay treatment, route/view relocation + minor design tokens)

Kanban → ReUI Engine Swap plan (`docs/plans/kanban-reui-swap/plan.md`), Phase 2
review fixes pass — the accepted findings from the T6–T13 review (B1 blocker,
M2–M4 majors, six minors). Test-first for both behavioral fixes (B1, M2).

- **B1 [Blocker] — `frontend/src/components/kanban-v2/SolvroKanban.tsx`:
  `liveColumns` leaked (never released) on column-body drops.** Root cause
  traced in the vendored engine (`reui/kanban.tsx:437-552`): a column-body
  drop lands in the same-container `arrayMove` branch at drag end (the item
  was already spliced into the target column during a prior `dragOver`, so
  `over.id` — the column's own id, not an item id — resolves `overIndex` to
  `-1`), and that branch calls the container's `onDragEnd` prop (which nulled
  `liveColumns`) BEFORE its own `setColumns`/`onValueChange` call (which
  re-armed `liveColumns` with a non-null snapshot) — both synchronously
  within the same `handleDragEnd` invocation, so the re-arm always wins. Fix:
  a new `isDraggingRef` (a ref, not state, so the write is synchronously
  visible within that same call stack) set `true` in `handleDragStart`,
  `false` in `handleDragEnd` AND `handleDragCancel`; `handleValueChange` now
  ignores every call when the ref is `false`, so it never writes
  `liveColumns` outside a live gesture. Verified via a temporary scratch
  Playwright spec (`e2e/tests/kanban-fix2-scratch.spec.ts`, deleted after the
  run, `e2e/test-results` also cleared): (a) a column-body drop (Beta -> In
  Progress), (b) an out-of-band API rename of Gamma (bypassing
  `useUpdateTask` entirely), (c) a second real UI mutation (open Alpha's
  panel, cycle its priority) to force a genuine React Query invalidate, then
  asserted Gamma's renamed title reached the board within 3s — proving the
  freeze released rather than staying permanently stuck on the pre-rename
  snapshot. Re-run once with the fix's guard line temporarily reverted:
  failed exactly as predicted (rename never surfaced); restored, re-ran
  green.
- **M2 [Major] — `frontend/src/components/kanban-v2/commitMapper.ts` +
  `SolvroKanban.tsx`: filter-active column-append anchored on the last
  VISIBLE card, not the column's true last member.** A column-body drop
  under an active filter was inferring position from the committed
  (possibly filtered) arrangement's visible neighbors — correct for
  card-to-card drops, wrong for column-body appends, where a hidden true-last
  card would get skipped and the moved card would land before it instead of
  after. Fix: `KanbanCommitMetaLike` gained an optional `appendToStatus`
  field — an explicit column-append signal. `SolvroKanban.tsx`'s
  `handleValueCommit` sets it from a real drag by checking whether
  `meta.event.over?.id` resolves to a `KANBAN_STATUSES` member (the column's
  own droppable id) rather than a card id; `buildColumnAppendCommit` (the
  mobile move sheet's synthesized commit) sets it directly to the same
  `targetStatus`. When `appendToStatus === overContainer`, `mapCommitToPatch`
  now anchors on the UNFILTERED last member of that status via a new
  `columnAppendPosition` helper (factored out of `resolvePosition`'s own
  empty-neighbor fallback, which now delegates to it) — bypassing committed-
  arrangement inference entirely. Card-to-card drops never set the signal,
  so `resolvePosition`'s neighbor-based math is unchanged for them.
  `docs/plans/kanban-reui-swap/scenarios.md` gained a new FA-5/FA-5-MS row
  pair (fixture A,B,C TODO / D IN_PROGRESS / E DONE, filter hides C, drag D
  onto the TODO column body -> `{status:"TODO", position:3}`, the true end)
  plus an amendment block, marked "(Phase 2 review, 2026-07-27,
  orchestrator-accepted)". `commitMapper.test.ts` (+3, 30→33): FA-5
  (drag-shaped meta), FA-5-MS (move-sheet-shaped meta, both written against
  the failing mapper first and confirmed red before the fix), and a
  mismatched-`appendToStatus` guard test proving filtered card-to-card drops
  still use neighbor math. Empirically confirmed live: a scratch e2e case
  (priority filter hides Gamma — the true last TODO card — drag Delta from
  In Progress onto the TODO column body) captured the literal PATCH
  `{status:"TODO", position:3}` and an API readback confirmed the correct
  global order `[Alpha, Beta, Gamma, Delta]`.
- **M3 [Major] — `frontend/src/components/TaskFormModal.tsx`: subtask
  reorder arrows ungated.** Both arrow `disabled` expressions now include
  `!canEdit ||` (`disabled={!canEdit || index === 0}` /
  `disabled={!canEdit || index === subtasks.length - 1}`), matching
  `TaskPanel.tsx`'s existing gating. The pre-existing checkbox gap (subtask
  DONE toggle isn't itself `canEdit`-gated in either file) is unchanged —
  out of this fix's scope.
- **M4 [Major] — `frontend/src/components/kanban-v2/cards.tsx` +
  `SolvroKanban.tsx`: drag overlay lost the DESIGN.md dragging treatment.**
  `TaskCard` gained a `dragging?: boolean` prop restoring the old board's
  overlay classes (`ProjectKanban.tsx:917`:
  `rotate-[-1.2deg] border-[1.5px] border-primary shadow-overlay
  ring-2 ring-primary`). `SolvroKanban.tsx`'s `<KanbanOverlay>` now wraps the
  ghost card in a real `<KanbanItem>` (so `KanbanItemHandle` resolves its
  context from the actual overlay — `listeners: undefined`/inert,
  `isDragging: true` — instead of a disconnected drag-disabled render) and
  passes `canDrag dragging` so the grip renders and the ghost visually
  matches the source card it stands in for.
- **Minors** — `frontend/src/components/kanban-v2/SolvroKanban.tsx`: (m1)
  the `../../pages/ProjectDetail` relative import is gone — folded into the
  m2 refactor below. (m2) `SolvroKanban` now takes `project: ProjectDetail`
  as an explicit prop instead of calling `useProjectContext()` itself,
  matching the `ProjectGantt` -> `SolvroGantt` precedent; a new thin
  `frontend/src/pages/views/ProjectKanban2.tsx` owns the context read and
  passes `project` down. `App.tsx`'s `kanban2` route now points at
  `ProjectKanban2`. (m3) investigated whether the vendored `KanbanColumn`/
  `KanbanColumnContent` expose an is-over signal usable without patching
  `reui/kanban.tsx`: they don't — `KanbanContext` only tracks `activeId`
  (what's being dragged, never an over/hover target), and `KanbanColumn`'s
  own `data-dragging` reflects the COLUMN being dragged for column
  reordering, not an item hovering over it. Took the documented fallback:
  removed the dead `transition-all` (nothing ever toggled a class it would
  have animated) and added a comment naming the live-preview reshuffle as
  the replacement affordance. (n1) collapsed `canMove`/`dragEnabled` (two
  identically-computed consts) to one, kept under the greppable
  `dragEnabled` name. (n4) `getItemValue` is now `useCallback`-wrapped
  (empty deps) — it feeds the vendored `Kanban` root's `columnIds`
  `useMemo`/`findContainer` `useCallback` deps, so a fresh identity on every
  unrelated render (e.g. toggling the filter popover) was defeating both
  memos even when `columns` itself hadn't changed. (m6) the card "…" menu
  (opens `MobileMoveSheet`) is now gated on `dragEnabled` — non-writers get
  no move affordance at all, not just a disabled drag handle, matching
  `canDrag`. `frontend/src/components/kanban-v2/MobileMoveSheet.tsx`: (m5)
  `rounded-t-2xl` -> `rounded-t-xl` (the `2xl` radius token is `initial` —
  resolves to nothing; DESIGN.md forbids `2xl`).
- **CHANGELOG formatting fix (m4, QA gate failure)**: added the missing
  `### Added — 2026-07-27 — kanban-v2 static board slice at /kanban2 (T6)`
  header above the T6 entry body, which had been orphaned (no header of its
  own) directly below the T7 entry — a formatting header addition only, T6's
  entry content is unchanged.
- **Out of scope (deliberately not done here)**: n2/n3 (copied hardcoded
  colors/px, deferred to T11), n5 (aria on non-writer cards, parity-neutral),
  and no vendor patch to `reui/kanban.tsx` (m3's fallback branch was taken
  instead) — `ProjectKanban.tsx` stays byte-identical.
- **Verification**: `docker compose exec frontend npm test` — 33/33 green (2
  files: 6 adapter + 27 commitMapper, up from 30). `docker compose exec
  frontend npm run typecheck` — 0 errors. Scratch spec
  `e2e/tests/kanban-fix2-scratch.spec.ts` (desktop project,
  `BASE_URL=http://localhost:5173`) — 5/5 green: the M2 case above, the B1
  case above (plus one run against a temporarily-reverted guard, confirmed
  red), and a fast regression trio (column-body drop -> exactly 1 PATCH
  `{status:"IN_PROGRESS",position:3}`; drop-in-place -> 0 PATCH; card-to-card
  cross-column drop payload shape still exactly `{status,position}`, no
  `appendToStatus` leakage into the request body). Spec file + test-results
  deleted after the run per plan.
- Scope: `frontend/src/components/kanban-v2/{SolvroKanban.tsx,cards.tsx,
  commitMapper.ts,commitMapper.test.ts,MobileMoveSheet.tsx}`,
  `frontend/src/pages/views/ProjectKanban2.tsx` (new),
  `frontend/src/App.tsx`, `frontend/src/components/TaskFormModal.tsx`,
  `docs/plans/kanban-reui-swap/scenarios.md`, this file. Not touched:
  `frontend/src/components/reui/kanban.tsx` (0 vendor patches, unchanged),
  `frontend/src/pages/views/ProjectKanban.tsx` (byte-identical), `CLAUDE.md`.

### Added — 2026-07-27 — subtask up/down reorder controls in TaskPanel (board-adjacent path, T13b/CP0 follow-up)

Kanban → ReUI Engine Swap plan (`docs/plans/kanban-reui-swap/plan.md`), Task 13b —
follow-up to Task 13. T13's investigation found the Kanban board's `?task=`
deep-link opens `TaskPanel.tsx`, not `TaskFormModal.tsx`, so the board-adjacent
reorder path CP0's decision log intended didn't actually exist yet; this closes
that gap by mirroring T13's shipped pattern onto `TaskPanel`.

- **`frontend/src/components/TaskPanel.tsx`**: the subtask list derivation
  (`subtasks`, near the top of the component) gained the same explicit
  `.sort((a, b) => a.position - b.position || a.id - b.id)` comparator T13
  added to `TaskFormModal` — it previously had no sort at all and relied on
  `GET /tasks`'s incidental order surviving the `parentTaskId` filter. Each
  subtask row gains the same `keyboard_arrow_up`/`keyboard_arrow_down` button
  pair (aria-labels "Move subtask up"/"Move subtask down",
  `disabled:pointer-events-none disabled:opacity-30`), calling a new
  `moveSubtask(index, direction)` helper that no-ops outside the list bounds
  and otherwise sends `{ position: <targetIndex> }` through the panel's
  existing `useUpdateTask(projectId)` mutation — the same mutation
  `toggleSubtask` already uses. Buttons are additionally disabled when
  `!canEdit`, matching how the panel already gates the checkbox toggle and the
  add-subtask form. The title `<span>` picked up `flex-1` (mirroring T13) so
  the new button pair right-aligns instead of crowding the row. Everything
  else in the panel (toggle, add form, delete warning, comments) is unchanged.

### Added — 2026-07-27 — subtask up/down reorder controls in TaskFormModal (modal-path replacement for retired board subtask drag, plan T13/CP0)

Kanban → ReUI Engine Swap plan (`docs/plans/kanban-reui-swap/plan.md`), Task 13
(CP0 Decision Log item 3). Board-level subtask drag has no equivalent on the new
`/kanban2` board (RG-1 scenario gap); this restores a reorder path in the shared
task-edit modal instead of dropping the capability.

- **`frontend/src/components/TaskFormModal.tsx`**: the edit-mode subtask panel
  gains per-row up/down icon buttons (`keyboard_arrow_up`/`keyboard_arrow_down`,
  right-aligned via a `flex-1` title span) that swap a subtask one slot via the
  panel's existing `useUpdateTask(projectId)` mutation, sending `{ position:
  <targetIndex> }` — the same optimistic/rollback path the checkbox status
  toggle already uses, and the same `{ position }` contract the parent's
  per-parent sibling list expects (`backend/src/lib/taskOrdering.ts`). Up is
  `disabled` on the first row, down on the last, so both are visual no-ops at
  the list boundaries (disabled buttons fire no click, hence no request). The
  subtask list gained an explicit `.sort((a, b) => a.position - b.position ||
  a.id - b.id)` comparator — it previously relied on `GET /tasks`'s incidental
  global `(position asc, id asc)` order surviving the `parentTaskId` filter;
  now the per-parent ordering is asserted directly in the component. Checkbox
  behavior and the rest of the modal are unchanged.

### Added — 2026-07-27 — kanban-v2 mobile pager + touch verification, incl. deferred move-sheet cases (T9)

Kanban → ReUI Engine Swap plan (`docs/plans/kanban-reui-swap/plan.md`), Task 9
(Phase 2, "mobile slice"). Old `ProjectKanban.tsx` remains byte-for-byte
untouched; `adapter.ts`/`commitMapper.ts` untouched; vendor patch count
stays 0.

- **Root cause fixed**: below `md:`, `/kanban2` was broken — the vendored
  `KanbanBoard`'s default className (`grid auto-rows-fr gap-4
  sm:grid-cols-3`) has no layout of its own below `sm:`, so it collapsed to
  an implicit single-column grid whose `auto-rows-fr` squeezed all three
  columns into equal-height rows; each column's actual card content
  overflowed its row's allotted height and visually bled into the next
  column, intercepting its clicks (T8's deferred finding — the DONE column's
  "Drop tasks here" placeholder intercepted a click aimed at a TODO card's
  `[aria-label="Card options"]` button).
- **`frontend/src/components/kanban-v2/SolvroKanban.tsx`**: ports the old
  board's swipeable-columns mobile pager (chevrons + centered label/count
  chip + dot indicators, `ProjectKanban.tsx` lines 576-616; scoped
  `IntersectionObserver` tracking the centered page, lines 225-243). The
  scroll-snap container is now a genuine plain `<div>` (not the vendor's
  `<KanbanBoard>`) carrying the exact old-board classes (`flex h-full
  snap-x snap-mandatory gap-4 overflow-x-auto md:grid md:min-h-0 md:flex-1
  md:grid-cols-3 md:overflow-visible md:snap-none`, ported from
  `ProjectKanban.tsx` lines 624-634); `<KanbanBoard className="contents">`
  is reduced to a transparent pass-through so its children (the new
  per-column wrapper divs, `w-full shrink-0 snap-center md:w-auto md:shrink
  md:min-h-0 md:snap-align-none`, also ported verbatim) become the plain
  div's direct flex/grid items, while `KanbanBoard`'s own `SortableContext`
  (a React-context wrapper, not a DOM concern) keeps functioning unaffected
  by its box disappearing. This routing was necessary, not cosmetic:
  `@base-ui/react/merge-props` documents "ref is not merged," so passing a
  ref straight to `<KanbanColumn>` would silently drop dnd-kit's own
  `setNodeRef` (breaking that column as a drop target), and React 18 (this
  repo's version) doesn't forward `ref` as a plain prop to non-`forwardRef`
  function components either (rules out refing `<KanbanBoard>` itself) — the
  per-column wrapper divs and the new scroll-container div are ordinary
  native elements instead, sidestepping both. The `IntersectionObserver`
  effect's dependency array is `[isLoading, isError]` rather than the old
  file's `[]`: this component's loading/error branches return an entirely
  different subtree with no pager DOM nodes at all, so a mount-only effect
  could fire once against `null` refs before the real board ever renders and
  never re-attach; re-running once more when the loading gate clears
  guarantees the nodes exist.
- **Sensor verdict: vendor defaults left untouched, 0 patches.** The
  vendored `reui/kanban.tsx` hardcodes its `TouchSensor` activation
  constraint (`delay: 250, tolerance: 5`) directly in `useSensors(...)` with
  no prop escape hatch, so verifying it meant exercising it live rather than
  configuring it. Confirmed via the temporary mobile e2e spec (below): a
  touch-hold-then-drag gesture on a card's grip still produces exactly one
  PATCH (Alpha appended to end of TODO), and a fast (~75ms, well under the
  250ms delay) horizontal swipe starting on that same grip — the only
  element in the DOM that actually carries dnd-kit's touch listeners, since
  the card body itself has no pointer-down listener (handle-only
  activation, T7) — fires zero requests, letting native scroll-snap handle
  it. No sensor-tuning patch was needed; the sanctioned patch site in
  `reui/kanban.tsx` was not used.
- **Verification** (temporary scratch spec `e2e/tests/kanban9-scratch.spec.ts`,
  deleted after the run, plus `e2e/test-results`): mobile project — (1)
  no-overlap regression: Gamma's `[aria-label="Card options"]` button opens
  the sheet reliably (this exact click previously timed out); (2) deferred
  MS-1/MS-2 from T8: tapping "In Progress" on Gamma's sheet fires exactly
  one PATCH `{status:"IN_PROGRESS",position:3}` + API readback confirming
  Gamma last in the IN_PROGRESS column order, then reopening on Delta
  (already IN_PROGRESS) and tapping "In Progress" again fires zero requests;
  (3) touch-hold drag: Alpha dragged to the TODO column's empty background
  produces exactly one PATCH `{status:"TODO",position:1}` + readback
  confirming Alpha last in TODO order; (4) pager: chevron-tap navigates to
  the In Progress page (header label updates, Delta becomes visible) and a
  fast swipe gesture fires zero PATCH. A fifth, desktop-only sanity check
  (not part of T9's mobile brief, added because this task made
  `<KanbanBoard>` `display:contents` and inserted wrapper divs around every
  vendor component) confirmed the three columns still render side-by-side
  and a same-column drag still produces exactly one PATCH — no desktop
  regression from the restructuring. `docker compose exec frontend npm run
  typecheck` — 0 errors. `docker compose exec frontend npm test` — 30/30
  green, unchanged (adapter/commitMapper untouched).
- Scope: `frontend/src/components/kanban-v2/SolvroKanban.tsx`, this file.
  Not touched: `frontend/src/components/kanban-v2/adapter.ts`,
  `frontend/src/components/kanban-v2/commitMapper.ts`,
  `frontend/src/components/reui/kanban.tsx`,
  `frontend/src/pages/views/ProjectKanban.tsx`.

### Added — 2026-07-27 — kanban-v2 filters, subtask toggle, mobile move sheet, per-column add menu (T8)

Kanban → ReUI Engine Swap plan (`docs/plans/kanban-reui-swap/plan.md`), Task 8.
Old `ProjectKanban.tsx` remains byte-for-byte untouched; vendor patch count
still 0.

- **`frontend/src/components/kanban-v2/SolvroKanban.tsx`**: assignee/priority
  filter popover ported (render-only visibility predicate into
  `projectToColumns`; the commit path still hands the mapper the UNFILTERED
  global list per the FA-row contract), plus the per-column "…" menu with
  "Add task here" (initialStatus preselect) restoring T6's parity gap.
- **`frontend/src/components/kanban-v2/cards.tsx`**: subtask checkbox wired to
  the DONE↔TODO toggle via `useUpdateTask` (permission-gated); mobile-only
  card `more_horiz` menu button restored.
- **`frontend/src/components/kanban-v2/MobileMoveSheet.tsx`** (new): copy of
  the old sheet, routing moves through the same mapper column-append path as
  a column-body drop (no hand-rolled position math).
- Verification (temporary scratch spec, deleted after the runs): filtered
  card-drop with hidden card between → exactly one PATCH
  `{status:"TODO",position:0}` matching FA-1 math + readback; filtered
  drop-in-place → zero PATCH (plan addendum 8's desktop leg, empirically
  clean); subtask toggle → one PATCH each way; "Add task here" → correct
  preselect, zero requests on close. **Mobile move-sheet verification
  deferred to T9**: below `md:` the /kanban2 columns currently overlap
  (vendor grid stacking without the mobile pager), intercepting card-menu
  clicks — T9 owns the mobile layout and will verify the sheet (MS-1..MS-3)
  once the pager exists.

### Added — 2026-07-27 — kanban-v2 drag persistence (live preview, single-PATCH commit via mapper, restoreOnCancel) at /kanban2 (T7)

Kanban → ReUI Engine Swap plan (`docs/plans/kanban-reui-swap/plan.md`), Task 7
(Phase 2, "drag slice — the core"). Wires the vendored engine's drag
lifecycle into `commitMapper.ts` and the existing `useUpdateTask` optimistic
mutation; old `ProjectKanban.tsx` remains byte-for-byte untouched.

- **`frontend/src/components/kanban-v2/SolvroKanban.tsx`**: `<Kanban>` now
  wires `onValueCommit`, `restoreOnCancel`, and `onDragStart`/`onDragEnd`/
  `onDragCancel`. Drag-live local projection (Architecture Decision 5): a new
  `liveColumns` state, set by `onValueChange`, is authoritative while
  non-null; `columns = liveColumns ?? derivedColumns` freezes query-derived
  updates mid-gesture and resumes deriving from query data once
  `onDragEnd`/`onDragCancel` clear it back to `null`. `onValueCommit` calls
  `mapCommitToPatch(sortTasksCanonical(topLevelAll), committedValue, meta)`
  and, on a non-null result, fires exactly one
  `useUpdateTask.mutate({ id, patch })` — the mapper's no-op guards (drop in
  place, cancelled drag, unchanged arrangement) mean no request at all in
  those cases. `dragEnabled` now reads `hasPermission(user, "task:write")`
  (T6's hardcoded `false` removed). Each `KanbanItem` gets an explicit
  `className={dragEnabled ? undefined : "opacity-100"}` to cancel out the
  vendored `reui/kanban.tsx`'s own `disabled && "opacity-50"` styling
  (`KanbanItem`'s `className` composes via `cn()`/`twMerge`, so a
  later-in-order `opacity-100` wins over the vendor's baked-in `opacity-50`
  for the same utility group) — non-writers see normal-looking, non-draggable
  cards instead of T6's all-cards-faded regression (orchestrator screenshot
  finding), with zero vendor file changes. `<Kanban>` itself now carries
  `className="flex h-full flex-col md:min-h-0 md:flex-1"`, giving the root a
  definite height as a flex item of `ProjectDetail.tsx`'s Outlet wrapper so
  `KanbanBoard`'s existing `h-full`/`md:flex-1` (and, via CSS Grid's default
  `align-content: stretch`, `KanbanColumn`'s `md:h-full`) actually resolve —
  matching the old board's `md:h-full md:min-h-0` full-height column chain
  (previously a no-op because the vendored `Kanban` root had no defined
  height of its own).
- **`frontend/src/components/kanban-v2/cards.tsx`**: the card's
  `drag_indicator` grip is now wrapped in the vendored engine's
  `KanbanItemHandle` (rendered only when `canDrag`), making it the sole real
  drag activator — its `listeners` come from the enclosing `<KanbanItem>`'s
  React context, so the card body itself still has no pointer-down listener,
  preserving the old board's handle-only drag activation.
- **Verification**: `docker compose exec frontend npm test` — 30/30 green
  (unchanged from T5/Phase 1, no mapper/adapter changes this task);
  `docker compose exec frontend npm run typecheck` — clean. A temporary
  Playwright spec (`e2e/tests/kanban7-scratch.spec.ts`, deleted before this
  entry) exercised all six scenario-table cases named in the T7 dispatch
  brief against `/kanban2` on the desktop project with `page.on('request')`
  payload capture: same-column reorder (1 PATCH), cross-column drop-on-card
  top-half vs bottom-half (plan Phase 1 Review Addendum 6's WYSIWYG check —
  see finding below), column-body drop (1 PATCH, ends last), drop-in-place (0
  PATCH), Escape mid-drag (0 PATCH, DOM order unchanged), and empty-column
  drop (`status`-only body, no `position` key). All six passed.
- **Addendum 6 finding**: the vendored engine's cross-column drop-on-card
  reshuffle (`reui/kanban.tsx`'s `handleDragOver`) always splices the moved
  card in at the *over*-card's own current index — i.e. always "insert
  before" — regardless of which half of the target card the pointer
  releases over. Both a top-half and a bottom-half drop of Beta onto Delta
  produced the *identical* captured payload
  (`{ status: "IN_PROGRESS", position: 2 }`, committed arrangement
  `["Beta", "Delta"]`) against a fresh, otherwise-identical seeded project
  for each half. Only the CC-1/FA-2 arrangement (moved-before-over-card) is
  reachable through a card-to-card drop in practice; CC-1b/FA-2b (moved
  after) remain valid mapper unit-test coverage for an arrangement the live
  engine does not appear to produce via this gesture — this resolves
  addendum 6's open question in favor of "engine only ever produces one of
  the two."

### Added — 2026-07-27 — kanban-v2 static board slice at /kanban2 (T6)

Kanban → ReUI Engine Swap plan (`docs/plans/kanban-reui-swap/plan.md`), Task 6
(Phase 2, "static board slice"). Trial route only — no tab registered in
`ProjectDetail.tsx`; old `ProjectKanban.tsx` stays byte-for-byte untouched
(Architecture Decision 1). Drag persistence lands in T7.

- **`frontend/src/components/kanban-v2/cards.tsx`** (new): `TaskCard`,
  `SubtaskRow`, `getDuration` copied from `ProjectKanban.tsx` (Architecture
  Decision 2 — copy, don't extract; the duplicate dies with the old file at
  cutover, T11). Stripped of drag plumbing (`dragHandleProps`/`dragHandleRef`/
  `dragging`/`isDragging`) and the mobile `MobileMoveSheet` menu button
  (ports in T8). `SubtaskRow` drops its drag handle entirely — subtask
  dragging is retired from the board for good, not deferred — and renders its
  checkbox visually but disabled until T8 wires the toggle mutation.
- **`frontend/src/components/kanban-v2/SolvroKanban.tsx`** (new): container
  rendering the vendored `reui/kanban.tsx` engine over `adapter.ts`'s
  `projectToColumns` projection. WIP-limit count chips (amber over-limit
  state), toolbar `Add task` button + `TaskFormModal` create wiring, card
  click → `?task=` deep link, loading/error states, and an empty-column "Drop
  tasks here" placeholder are all ported from `ProjectKanban.tsx`. Every
  `KanbanItem` renders `disabled={!dragEnabled}` with `dragEnabled` hardcoded
  `false` (single greppable flag for T7 to flip); `onValueChange` is a
  no-op placeholder pending T7's live-drag projection. `KanbanOverlay` is
  wired with a minimal `TaskCard` ghost render function, unreachable in
  practice while every item is drag-disabled. Filter popover and mobile pager
  chrome are explicitly out of scope (T8/T9).
- **`frontend/src/App.tsx`**: registers `Route path="kanban2"` under the
  existing `projects/:id` route block, alongside (not replacing) `kanban`.

### Changed — 2026-07-27 — kanban-v2 mapper/adapter review hardening + frontend vitest wired into CI (Phase 1 review fixes)

Kanban → ReUI Engine Swap plan (`docs/plans/kanban-reui-swap/plan.md`), Phase 1
Review Addenda (`plan.md`, dated 2026-07-27) — the accepted findings from the
T3–T5 review pass (reviewer found no blockers). Test-first for every
behavioral fix.

- **`frontend/src/components/kanban-v2/commitMapper.test.ts`** (+4 tests,
  20→24): **CC-1b**/**FA-2b** — sibling cases for CC-1/FA-2 covering the
  *other* reachable arrangement of a cross-column drop-on-card commit (review
  finding 1). The orchestrator accepted WYSIWYG semantics: ReUI's live-preview
  commit is arrangement-faithful and a card-to-card cross-column drop can land
  the moved card on either side of the over-card depending on pointer
  position — both CC-1 (moved before over-card) and CC-1b (moved after,
  committed `TODO: [A, B, D, C]` → `{ status: "TODO", position: 2 }`) are
  reachable engine outputs, same for FA-2/FA-2b under an active filter
  (FA-2b: moved before over-card, committed `IN_PROGRESS: [A, D]` →
  `{ status: "IN_PROGRESS", position: 2 }`). Each new test derives its
  expected patch by hand from the moved-excluded global list in an inline
  comment. Also added: an **unknown-`overContainer`** test (review finding 5)
  and a **stale-predecessor clamp** test (review finding 6, see below).
- **`frontend/src/components/kanban-v2/adapter.test.ts`** (+1 test, 5→6): a
  full task list including subtasks (`parentTaskId` set) now asserts no
  subtask ends up in any projected column (review finding 8, see below).
- **`frontend/src/components/kanban-v2/commitMapper.ts`**: (a) Guard 2's
  comment now states explicitly that it is defensive-only — analytically
  unreachable because Guard 1 (`arrangementsEqual`) already subsumes it for
  every input reachable through this function, kept only as a cheap invariant
  against future refactors (review finding 2; no test added to reach it, per
  the review's own instruction not to chase it). (b) `resolvePosition` now
  clamps its returned index to `[0, movedExcludedGlobal.length]`, mirroring
  `backend/src/lib/taskOrdering.ts`'s `insertAt` clamp
  (`Math.max(0, Math.min(requestedPosition, others.length))`) — the
  neighbor-anchored `+1` branches could otherwise return one past the valid
  append slot when a committed predecessor/anchor isn't found in the
  unfiltered global order (stale-drag input), which the new clamp test
  exercises directly (review finding 6). (c) `meta.overContainer` is now
  validated via a new `isKanbanStatus` type guard against `KANBAN_STATUSES`
  (imported from `./adapter.ts`) instead of an unchecked `meta.overContainer
  as TaskStatus` cast — an unrecognized container now returns `null` instead
  of silently producing a patch with a garbage `status` (review finding 5).
  160 → 200 lines.
- **`frontend/src/components/kanban-v2/adapter.ts`**: `projectToColumns` now
  filters out `parentTaskId !== null` tasks itself instead of trusting the
  caller to have already narrowed to top-level tasks (review finding 8) — the
  board has no subtask-drag surfaces, so a subtask leaking into a column would
  render unexpectedly. 58 → 64 lines.
- **`.github/workflows/ci.yml`**: added a "Run frontend test suite" step
  (`working-directory: frontend`, `run: npm test`) to the `typecheck` job,
  immediately after "Typecheck frontend" and before the `e2e` `npm ci` step —
  the frontend Vitest suite (R2's mitigation) wasn't previously wired into CI
  and ran only locally (review finding 3).
- **`docs/plans/kanban-reui-swap/scenarios.md`**: amended the CC-1 and FA-2
  rows (adjacent notes under each table, rows themselves unchanged) recording
  the WYSIWYG semantics delta from the old board's always-lands-after
  behavior and both expected patches for the alternate arrangement, marked
  "(Phase 1 review, 2026-07-27, orchestrator-accepted)".
- Informational (review finding 9, no code follows from this): T3's vendored
  `frontend/src/components/reui/kanban.tsx` differs from the raw `@reui/kanban`
  registry payload by exactly the shadcn CLI's `rsc:false` header transform —
  3 lines (`eslint-disable` comment, `"use client"` pragma, blank line) that
  the Gantt engine's vendored files (installed with React Server Components
  support) retain but this file's install target config omits. Recorded here
  so a future re-pull diff isn't misread as hand-editing; no `// SOLVRO PATCH`
  marker applies since this is a CLI install-config artifact, not a hand edit.
- Verified: `docker compose exec frontend npm test` — 2 test files, 30 tests,
  all passed (6 adapter + 24 commitMapper — up from 25). `docker compose exec
  frontend npm run typecheck` — 0 errors. Ruby's `YAML.load_file` confirms
  `ci.yml` still parses.
- Scope: `frontend/src/components/kanban-v2/{adapter.ts,commitMapper.ts,
  adapter.test.ts,commitMapper.test.ts}`, `.github/workflows/ci.yml`,
  `docs/plans/kanban-reui-swap/scenarios.md`, this file. Not touched:
  `frontend/src/components/reui/kanban.tsx`,
  `frontend/src/pages/views/ProjectKanban.tsx`, `CLAUDE.md`.

### Added — 2026-07-26 — kanban-v2 adapter + commit-mapper with scenario-table unit tests

Kanban → ReUI Engine Swap plan (`docs/plans/kanban-reui-swap/plan.md`), Task 5 —
the highest-stakes task in the migration (R2: the global-order drop math). Written
test-first against `docs/plans/kanban-reui-swap/scenarios.md`'s CP0-approved
scenario table: every SC/CC/FA/NO/MS row became a named unit test before either
pure module was implemented; a deliberate mutation run (temporarily stubbing out
the empty-column fallback) confirmed the FA-3 test fails without it, proving the
suite isn't tautological against its own implementation.

- **`frontend/src/components/kanban-v2/adapter.ts`** (new, 58 lines): pure
  projection `projectToColumns(topLevelTasks, isVisible?)` →
  `Record<TaskStatus, Task[]>` for ReUI Kanban's `value` prop. Columns
  TODO/IN_PROGRESS/DONE always present (empty arrays allowed); ordering within a
  column is position ascending, id ascending tiebreak — identical to the old
  board's `groupedAll`/`grouped` (`ProjectKanban.tsx:204-217`). Also exports
  `compareTasksByPosition`/`sortTasksCanonical`, the canonical global-order
  comparator, so T6's container doesn't re-derive it.
- **`frontend/src/components/kanban-v2/commitMapper.ts`** (new, 160 lines): pure,
  dnd-free `mapCommitToPatch(unfilteredGlobalOrder, committedValue, meta)` →
  `{ taskId, patch: { status, position? } } | null` per Architecture Decision 3.
  `KanbanCommitMetaLike` is a locally-defined structural type mirroring
  `reui/kanban.tsx`'s `KanbanCommitMeta<T>` shape (`kind`, `activeContainer`,
  `activeIndex`, `overContainer`, `overIndex`, `previousValue`) — **not
  imported** from the vendored file, satisfying the acceptance criterion that
  this module stay import-free of `@dnd-kit/*`/the vendored kanban. Two no-op
  guards run before any position math: (1) `previousValue` arrangement
  (id-sequence per column) structurally equal to the committed value → `null`;
  (2) the resolved `{status, position?}` already matches the moved task's
  current state → `null`. Position is resolved neighbor-based from the
  committed target column: a visible predecessor → its moved-excluded global
  index + 1; no predecessor but a visible successor → the successor's
  moved-excluded global index; neither → falls back to the **unfiltered**
  global order restricted to the target status (last member, moved excluded,
  +1) before concluding the column is genuinely empty — this fallback is what
  makes FA-3 (a filter hiding the column's only card) resolve to `position: 3`
  instead of wrongly looking empty, the exact hazard scenarios.md calls out.
  Only when the unfiltered fallback also comes up empty does the patch become
  status-only, constructed **without** a `position` key at all (not
  `position: undefined`) — verified by an explicit `"position" in patch`
  assertion on the CC-3/MS-3 tests. `kind: "column"` short-circuits to `null`
  unconditionally (column reordering unsupported).
- **`frontend/src/components/kanban-v2/adapter.test.ts`** (new, 5 tests):
  grouping + DONE/TODO/IN_PROGRESS bucketing, always-present empty columns,
  position/id-tiebreak ordering on shuffled/tied input, filter hiding without
  mutating input order or `position`, and the exported comparator's consistency
  with the internal sort.
- **`frontend/src/components/kanban-v2/commitMapper.test.ts`** (new, 20 tests):
  all 18 scenario-table rows (SC-1..SC-5, CC-1..CC-3, FA-1..FA-4, NO-1..NO-3,
  MS-1..MS-3), each test name prefixed with its scenario ID and using the
  scenario table's reference/EC fixtures literally, plus one test proving MS
  rows share the exact column-append code path CC rows use (no move-sheet
  special-casing exists in the mapper's signature) and one proving
  `kind: "column"` always no-ops independently of the arrangement guard. No
  table discrepancies found — every row's expected `{status, position?}` or
  NO REQUEST reproduced exactly as written.
- **`frontend/src/components/kanban-v2/setup.test.ts`** (deleted): T4's
  placeholder, superseded by the real test files above per its own comment.
- Meta-shape sufficiency (Checkpoint 1 input): `KanbanCommitMeta`'s 6 fields
  (`kind`/`activeContainer`/`activeIndex`/`overContainer`/`overIndex`/
  `previousValue`) proved sufficient for all 18 rows — no field was missing.
  Notably, `activeContainer`/`activeIndex` end up unused by the mapper's own
  logic (the moved task's current server-known status/position is instead
  looked up by id in `unfilteredGlobalOrder`, which is more robust than
  trusting the pre-drag index) — kept in `KanbanCommitMetaLike` for structural
  completeness/documentation rather than because the implementation needs them.
- Verified: `docker compose exec frontend npm test` — 2 test files, 25 tests,
  all passed (5 adapter + 20 commitMapper). `docker compose exec frontend npm
  run typecheck` — 0 errors. `git status --porcelain` — only
  `frontend/src/components/kanban-v2/*`, this file (plus the pre-existing
  uncommitted `frontend/package.json`/`package-lock.json`/`vitest.config.ts`
  from T3/T4 and the untracked `reui/kanban.tsx` from T3).
- Scope: `frontend/src/components/kanban-v2/adapter.ts`,
  `commitMapper.ts`, `adapter.test.ts`, `commitMapper.test.ts` (all new),
  `setup.test.ts` (deleted), this file. Not touched:
  `frontend/src/pages/views/ProjectKanban.tsx`, `frontend/src/lib/queries.ts`,
  `frontend/src/components/reui/kanban.tsx`, any other kanban-v2 UI file (T6+).

### Added — 2026-07-26 — Frontend unit test runner (Vitest) + `npm test` script

Kanban → ReUI Engine Swap plan (`docs/plans/kanban-reui-swap/plan.md`), Task 4.
`frontend/` had typecheck only (no unit test runner) until now; this unblocks T5's
mapper-first testing requirement (R7/R2 mitigation — pure `commitMapper`/`adapter`
tests written against the scenario table before any UI wiring).

- **`frontend/package.json`**: added `vitest` as a devDependency, pinned `^4.1.10` —
  matching the backend's installed major/minor (`backend/package.json` also pins
  `vitest@^4.1.10`, resolved `4.1.10` in both `package-lock.json`s) so the two
  workspaces stay on the same Vitest generation. Added a `"test": "vitest run"`
  script alongside the existing `dev`/`build`/`preview`/`typecheck` scripts. No
  React testing libraries, no jsdom, no coverage packages — deliberately out of
  scope; T5's tests are pure node-environment function tests.
- **`frontend/vitest.config.ts`** (new): standalone config (not merged with
  `vite.config.ts`, to avoid pulling in the Tailwind/React/PWA plugins pure
  function tests don't need) — `test.environment: "node"`,
  `test.include: ["src/**/*.test.ts"]` (`.tsx` intentionally excluded — no
  component tests in scope), `test.globals: false` (explicit `import { describe,
  it, expect } from "vitest"` per test file, no ambient globals). Mirrors
  `vite.config.ts`'s `resolve.alias` (`"@" → path.resolve(__dirname, "src")`) via
  an explicit `resolve.alias` entry so modules under test can import `@/lib/...`
  identically to app code.
- **`frontend/src/components/kanban-v2/setup.test.ts`** (new): trivial placeholder
  assertion (`1 + 1 === 2`) proving the runner works end to end (config resolution,
  node environment, `npm test` script) — comment notes T5 replaces this file with
  the real `adapter.test.ts`/`commitMapper.test.ts`.
- Installed per the node-modules sync rule: `npm install` on the host (IDE
  typecheck tree) and `docker compose exec frontend npm install` (container tree).
  No native bindings, no container restart needed.
- No `frontend/tsconfig.json` change needed: it already has no `exclude` and
  `"include": ["src"]`, so `*.test.ts` files under `src/` are picked up by
  `npm run typecheck` (`tsc --noEmit`) automatically; explicit `vitest` imports
  (globals off) resolve fine under the existing config with no `types` array to
  extend.
- Verified: `docker compose exec frontend npm test` — 1 test file, 1 test, passed.
  `docker compose exec frontend npm run typecheck` — 0 errors. `git status
  --porcelain` — only `frontend/package.json`, `frontend/package-lock.json`,
  `frontend/vitest.config.ts`, `frontend/src/components/kanban-v2/setup.test.ts`,
  this file (plus the untouched, already-uncommitted T3 `reui/kanban.tsx`).
- Scope: `frontend/package.json`, `frontend/package-lock.json`,
  `frontend/vitest.config.ts` (new), `frontend/src/components/kanban-v2/setup.test.ts`
  (new), this file. Not touched: `frontend/vite.config.ts`, any tsconfig, any
  existing source file.

### Added — 2026-07-26 — Vendored ReUI Kanban engine (`@reui/kanban`), zero patches

Kanban → ReUI Engine Swap plan (`docs/plans/kanban-reui-swap/plan.md`), Task 3. Same
vendoring pattern as the Gantt engine: `npx shadcn@latest add @reui/kanban` run from
`frontend/`, no files touched by hand.

- **`frontend/src/components/reui/kanban.tsx`** (new, 947 lines): the registry item
  installs as a single file (not a directory like the 9-file Gantt engine) — headless
  primitives (`Kanban`, `KanbanBoard`, `KanbanColumn`, `KanbanColumnHandle`,
  `KanbanItem`, `KanbanItemHandle`, `KanbanColumnContent`, `KanbanOverlay`) built on
  `@dnd-kit/core`/`@dnd-kit/sortable`/`@dnd-kit/utilities` and `@base-ui/react`
  (`merge-props`, `use-render`), all already present in `package.json` — the CLI dry
  run and post-install diff both confirm zero new dependencies were added, so no
  `package.json`/`package-lock.json` change and no container `npm install` sync was
  needed. Zero modifications made to the vendored file (patch count = 0); no
  `// SOLVRO PATCH` markers.
- Install-time inspection findings (informational only, no code follows from these
  yet — recorded for T5/T7/T9): (a) sensors are pre-configured — `MouseSensor`
  `{ activationConstraint: { distance: 10 } }`, `TouchSensor`
  `{ activationConstraint: { delay: 250, tolerance: 5 } }`, `KeyboardSensor` with
  `sortableKeyboardCoordinates` — i.e. the touch sensor already ships the 250ms
  delay the plan's T9 flagged as a possible sanctioned patch, so that patch may turn
  out to be unnecessary; (b) no `collisionDetection` prop is passed to `DndContext`,
  so it falls back to dnd-kit's library default (`rectIntersection`); (c)
  `onValueCommit`'s second argument (`KanbanCommitMeta<T>`) carries `kind`,
  `activeContainer`, `activeIndex`, `overContainer`, `overIndex`, `previousValue`
  exactly as the plan's Architecture Decision 3 assumed, plus one extra field
  (`event: DragEndEvent`) the plan didn't name; (d) no `Math.random`/`Date.now`/
  other non-deterministic calls anywhere in the file — the only side effect is a
  dev-mode-only `console.warn` on duplicate item ids; (e) every import resolves to a
  dependency already in `package.json` (`react`, `react-dom`, `@base-ui/react/*`,
  `@dnd-kit/*`) or the internal `@/lib/utils` alias — nothing new to install.
- Verified: `docker compose exec frontend npm run typecheck` — 0 errors.
  `git status --porcelain` / `git diff --stat` show only the new vendored file (plus
  this entry) — no other files touched.
- Scope: `frontend/src/components/reui/kanban.tsx` (new), this file. Not touched:
  `frontend/src/pages/views/ProjectKanban.tsx`, any `reui/gantt/` file,
  `package.json`/`package-lock.json` (unchanged — no new deps).

### Fixed — 2026-07-25 — PWA/home-screen icons rendered as an unrecognizable dark square with a white blob

All 4 icons under `frontend/public/icons/` composited the on-dark Elitery mark (off-white `#f2f2f2` arc + `#3aae51` green crescent) onto a `#3aae51` GREEN plate — the green crescent visually disappeared into the same-color plate, leaving only the off-white arc as an unrecognizable blob. Alpha wasn't limited to `apple-touch-icon.png`: pre-regeneration measurement found `apple-touch-icon.png` (transparent, pre-rounded corners), `icon-192.png` (3.73% transparent pixels), and `icon-512.png` (4.03% transparent pixels) all carried transparent `#000000` corners — iOS flattens that alpha onto black when applying its own mask, producing the dark-square frame seen in the reported screenshot; only the old `icon-maskable-512.png` was already fully opaque. The maskable icon's glyph was also undersized (~22% of tile width, near-empty).

- Regenerated all 4 icons (`frontend/public/icons/apple-touch-icon.png`, `icon-192.png`, `icon-512.png`, `icon-maskable-512.png`) from `frontend/src/assets/brand/elitery-mark-on-dark.png`, composited onto an **opaque `#232321` charcoal plate** with the full two-tone mark (both arc and crescent tones preserved against the darker plate), square corners (no pre-rounding — iOS applies its own mask), and the alpha channel force-dropped (`sharp().flatten().removeAlpha()`) so the output PNGs are truly opaque (3 channels, no alpha) rather than iOS flattening residual alpha onto black. Source glyph was trimmed (`sharp().trim()`) from its large transparent border before compositing, then centered. `icon-maskable-512.png`'s glyph is sized to ≈52% of tile width (266×284px, diagonal ≈389px) to sit inside the standard 80% maskable safe-zone circle (409px); the other three use ≈60% width.
- Regenerated `frontend/public/favicon.png`: same trim step as the plate icons (`sharp().trim()` on `elitery-mark-on-light.png`, 2020×2045 source) to strip the large transparent border, then resized to fill the 64×64 canvas with only ~1–2px bleed/margin, keeping the on-light artwork and alpha transparency (no plate). Not a pure downsize — the first pass carried the source's transparent padding through verbatim (glyph only ~41×44px of the 64×64 canvas, ~10px at the 16×16 size browsers actually render), which this trim-and-fill corrects; the glyph's alpha bounding box now spans 58×62px (90.6%×96.9%) of the canvas.
- `frontend/vite.config.ts`: added explicit `purpose: "any"` to the `icon-192.png`/`icon-512.png` manifest entries (`icons` array) alongside the existing `purpose: "maskable"` entry, so browsers don't infer the "any" purpose implicitly. `theme_color` (`#3aae51`, asserted by `e2e/tests/pwa.spec.ts:51`) and `background_color` unchanged.
- Regeneration tooling: throwaway Node script using `sharp` in the session scratchpad, never added to any repo `package.json`.
- Scope: `frontend/public/icons/*`, `frontend/public/favicon.png`, `frontend/vite.config.ts`, this file.

### Fixed — 2026-07-25 — Login (and sidebar rail) always-dark pin broken by non-inline `@theme` freezing token values at `:root`

`Login.tsx:99` and `Sidebar.tsx:59` pin a `dark` class on a nested (non-`<html>`) element so those subtrees stay dark regardless of OS/app theme (DESIGN.md:292). The Tailwind v4 CSS-first migration (commit `e00ed06`) silently broke this: `frontend/src/index.css`'s primary `@theme { ... }` block (line 12) was non-inline, so Tailwind emitted `--color-background: rgb(var(--background))` etc. as custom properties at `:root`, with utilities compiling to `var(--color-background)`. The inner `var(--background)` substitutes at computed-value time on the *declaring* element (`:root`) itself, and that resolved (light-mode) value then simply inherits down — a `.dark` class on a nested element has nothing left to override. Whole-app theme flips kept working because `ThemeProvider` puts `.dark` on `<html>` = `:root` itself, masking the regression outside of subtree pins.

- **`frontend/src/index.css`**: changed the primary `@theme {` block (was line 12) to `@theme inline {`. With `inline`, each utility compiles the RGB triplet directly into its own rule (e.g. `.bg-background { background-color: rgb(var(--background)) }`), so `var(--background)` now resolves at the *consuming* element instead of at `:root` — restoring the subtree-pin semantics `Login.tsx`/`Sidebar.tsx` already assumed. Opacity modifiers (`bg-background/40`) keep working, now via `color-mix` wrapping the inline RGB triplet. Rewrote the stale block comment (previously lines 8-11) that incorrectly asserted var-in-var already resolved at the consuming element — that was the wrong assumption behind the regression.
- Added a short comment after the shadcn-bridge `@theme inline` block documenting why the vendored ReUI Gantt's raw `var(--color-primary/background/border/destructive)` reads (`reui/gantt/gantt-bar.tsx:275`; `gantt-view.tsx:1801,2053,2117,3365,3736`; `gantt-dnd.tsx:297,313,370,673,674`) keep working unaided: Tailwind's Oxide scanner treats any bare `var(--color-x)` found in scanned source as a used-variable candidate and keeps emitting it at `:root,:host` under its generated `@layer theme` regardless of `inline` — confirmed by rebuilding with a manually-added `:root { ... }` re-declaration removed and diffing the output (all four still emitted, byte-identical). A manual compat block was drafted and then deleted after this check disproved its premise — it would also have been actively harmful: living outside `@layer theme`, an unlayered `:root { --color-border: ... }` copy has higher cascade priority than the `@theme` blocks and would silently shadow them, so a future repoint of one of these tokens would update every utility but leave the Gantt's raw reads stuck on a stale value. No vendored gantt files touched — no new `// SOLVRO PATCH` sites needed. (Note: `gantt-bar.tsx:49-58` separately reads 10 raw Tailwind default-palette vars, e.g. `--color-blue-500` — out of scope here, unaffected by the Solvro/shadcn token bridge.)
- Verified: `docker compose exec frontend npx vite build` succeeds; built `dist/assets/index-*.css` shows `.bg-background{background-color:rgb(var(--background))}` (inlined, not `var(--color-background)`) and its `/40`/`/60` opacity variants using `color-mix`; `--color-primary`/`--color-background`/`--color-border`/`--color-destructive` remain emitted at `:root,:host` with no manual re-declaration present anywhere in the source. `docker compose exec frontend npm run typecheck` — 0 errors.
- Scope: `frontend/src/index.css` only, this file. Not touched (per plan): `Login.tsx`, `Sidebar.tsx`, `theme.tsx`, any file under `frontend/src/components/reui/` or `frontend/src/components/gantt-v2/`.

### Fixed — 2026-07-25 — Gantt tree pane: draggable, persisted splitter so truncated task names can be revealed (walkthrough finding F6)

The tree pane's "Resources" name cell truncated long task titles (e.g. "Finalize Eltrader A…") with no on-screen way to widen it. Investigation (before writing any code, per the task brief) found the vendored ReUI engine already ships exactly this capability as a controlled prop plus a fully built-in draggable splitter — `GanttTreePanelConfig` (`frontend/src/components/reui/gantt/gantt.tsx:1218-1231`: `width`/`minWidth`/`maxWidth`/`resizable`/`nameColumnWidth`/`onWidthChange`, forwarded via `VIEW_CONFIG_KEYS:1479`) and the splitter's own pointer/keyboard/double-click-reset DOM + drag handling (`frontend/src/components/reui/gantt/gantt-view.tsx:2260-2308,1043-1088`). No vendored-file patch was needed or made — this is wiring only, in `frontend/src/components/gantt-v2/SolvroGantt.tsx`.

- **`SolvroGantt.tsx`**: added a `treeWidth` state seeded from `localStorage["solvro.gantt.treeWidth"]` (same pattern as the existing `solvro.gantt.colorBy` key), clamped to the engine's own default bounds (180–640px, matching `gantt-view.tsx`'s `DEFAULT_TREE_PANEL`). Passed to `<Gantt treePanel={...}>` as a memoized object (`width`, `minWidth`, `maxWidth`, `nameColumnWidth`, `onWidthChange`) — memoized because `gantt.tsx:1623-1634` only skips a re-render-triggering context update when the view-config object is reference-stable, and a fresh `treePanel` literal every render would force a full tree-pane reflow on every unrelated re-render (e.g. every task refetch). `onWidthChange` persists the new width back to `localStorage` on every commit (drag release, arrow-key step, or the splitter's own double-click reset).
  - **Why the name column had to move too, not just the pane**: the "Resources" name cell is a *fixed*-width flex item (`nameColumnWidth`, default 208px) sitting to the LEFT of the fixed-width Dates/color columns inside the tree pane — widening the outer pane alone would only reveal more of those columns (or blank space), not more of the name text itself. `nameColumnWidth` is now derived as `208 + (treeWidth - 288)` (1:1 delta from the engine's own defaults, floored at 100px) so dragging the splitter grows the name column by the exact same pixel amount, directly revealing more of a truncated title. At an untouched (no-localStorage) width this evaluates to exactly 208 — pixel-identical to before this change.
  - Added a `title` attribute (full task/section name) to the truncated `renderResourceLabel` span — a zero-cost native-tooltip fallback for names that still overflow even after widening.
- E2E: `e2e/tests/gantt-parity.spec.ts` test "(j) tree-pane splitter widens the Resources column, reveals a truncated title, and persists across reload" — seeds a task with a title long enough to truncate at the default width, drags `[data-slot="gantt-splitter"]` 300px, asserts the pane widens, the title's `scrollWidth`/`clientWidth` prove it's no longer clipped, the width persists to `localStorage`, and both the width and the un-truncated title survive a reload. All 12 tests in the file pass (`BASE_URL=http://localhost:5173 npx playwright test tests/gantt-parity.spec.ts --project=desktop`). Screenshots: `e2e/test-results/f6-tree-before.png` / `f6-tree-after.png`.
- Gates: `docker compose exec frontend npm run typecheck` — 0 errors. `docker compose exec frontend npm run build` — succeeds.
- Scope: `frontend/src/components/gantt-v2/SolvroGantt.tsx`, `e2e/tests/gantt-parity.spec.ts`, this file. Vendored `frontend/src/components/reui/gantt/` untouched.

### Fixed — 2026-07-25 — F6 post-review follow-up: double-click reset restored; persistence moved to an effect

Review of the F6 entry above found the splitter's double-click "reset to default" (`reui/gantt/gantt-view.tsx:2283-2286`) had become a permanent no-op: it resets to whatever `treePanel.width` evaluates to on that render, and `SolvroGantt.tsx` was binding that prop directly to the live, drag-tracking `treeWidth` state — so a reset always read back the value it had just set.

- **`SolvroGantt.tsx`**: split the single `treeWidth` state into two — `initialTreeWidth` (`useState`, frozen at mount, never updated — the value read from `localStorage` when the gantt first opened) and `treeWidth` (live, still following every drag/keyboard/reset commit via `onWidthChange`, and still what `nameColumnWidth` derives from). `treePanel.width` now binds to the frozen `initialTreeWidth` instead of the live state, so double-click genuinely resets to the width the page loaded with — a real "undo my drag(s) this session" affordance — while drag/persist/derive behavior is otherwise unchanged. Confirmed (by tracing `gantt-view.tsx:2283-2286`) that the reset path does fire `onWidthChange`, so `treeWidth`/localStorage/`nameColumnWidth` all correctly follow a reset with no further wiring needed.
- **`SolvroGantt.tsx`**: moved the `localStorage.setItem` call out of the `onWidthChange` mutator and into its own `useEffect(() => {...}, [treeWidth])`, matching the existing `colorBy` persistence pattern exactly (state is the single source of truth; the effect is a pure side-mirror of it).
- E2E: extended `e2e/tests/gantt-parity.spec.ts` test "(j)" with a double-click-reset assertion — after the drag-and-persist checks, double-clicks `[data-slot="gantt-splitter"]` and asserts the pane returns to within 2px of its own pre-drag width (`paneBefore`, self-referential rather than a hardcoded 288 — immune to any width a prior test left in `localStorage`, and per-test browser contexts mean there wouldn't be any anyway), the title re-truncates, and the reset value is what's persisted; then re-widens before the existing reload-persistence checks so those still exercise a real non-default width. All 12 tests in the file pass.
- Gates: `docker compose exec frontend npm run typecheck` — 0 errors. `docker compose exec frontend npm run build` — succeeds. `BASE_URL=http://localhost:5173 npx playwright test tests/gantt-parity.spec.ts --project=desktop` — 12/12 passed.
- Scope: same three files as the F6 entry above (`frontend/src/components/gantt-v2/SolvroGantt.tsx`, `e2e/tests/gantt-parity.spec.ts`, this file). Branch `fix/gantt-tree-splitter`.

### Removed — 2026-07-25 — Dead export-layer code orphaned by the engine deletion

Final-review cleanup following Plan B Task 9's engine deletion (below): that entry's "`frontend/src/lib/gantt/` ... is retained in full as the export/data layer" turned out to be slightly optimistic — the deleted `GanttFrame.tsx` was the last consumer of one whole file and several exports inside another. Corrected here rather than editing that entry (already-shipped history; append-only per CLAUDE.md's Changelog Discipline).

- **Deleted `frontend/src/lib/gantt/constants.ts`** (list-pane/axis/row-geometry pixel constants for the old hand-rolled engine's own layout — `AVATAR_COL_WIDTH`, `NAME_COL_WIDTH`, `AXIS_HEIGHT`, `ROW_HEIGHT`, `COLUMN_MIN_WIDTH`, etc.). Verified zero consumers repo-wide: `grep -rn "gantt/constants"` and every individual exported symbol name both came back with only the file's own definitions as hits (one stray comment in `connector-paths.ts` mentions `ROW_HEIGHT` in prose, not an import).
- **Excised 8 confirmed-dead exports from `frontend/src/lib/gantt/geometry.ts`**: `positionFor`, `dateFromX`, `iterColumns`, `Column` (interface), `computeChartStart`, `computeChartEnd`, `fmtMonthYear`, `toUtcMidnightISO` — all pixel/date-column math for the old engine's analytical (non-DOM-measured) chart geometry, superseded by the ReUI engine's own layout plus `GanttOverlay.tsx`'s DOM-measurement approach (Plan B Task 6). Zero external references confirmed via grep before removal.
- **Also removed 6 exports/consts that became transitively dead as a direct consequence** (not on the original list, but unreachable from any surviving export once the 8 above were gone — traced their only call sites and confirmed each was exclusively used by one of the 8): `ViewMode` (type — only consumed as a parameter type by the 5 removed geometry functions), `startOfMondayWeek`, `startOfMonth`, `startOfQuarter`, `quarterNumber` (only called from inside `computeChartStart`/`computeChartEnd`/`positionFor`/`dateFromX`/`iterColumns`), and the `PAD_YEARS` const (only read by `computeChartStart`/`computeChartEnd`). Leaving these in place would have satisfied the letter of "remove these 8 exports" while failing its actual purpose — a second orphaned layer sitting behind the first.
- **Surviving `geometry.ts` exports, verified reachable from a live import site**: `Row`/`RowKind` (types — `SolvroGantt.tsx`, `exportExcel.ts`, `exportPdf.ts`, `connector-paths.ts`, `Tasks.tsx`, `adapter.ts`), `buildRows` (`SolvroGantt.tsx`), `rowsDateRange` (`SolvroGantt.tsx`), `progressForTask` (`adapter.ts`), `parseISODate` (`PortfolioCalendar.tsx`, `exportExcel.ts`, `exportPdf.ts`), `startOfDay`/`addDays` (`SolvroGantt.tsx`, `exportExcel.ts`, `exportPdf.ts`, `GanttOverlay.tsx`), `isoWeekNumber` (`exportPdf.ts`, F4's week-grain axis), `fmtDateRangeDDMM` (`TreeCells.tsx`) plus its internal dependency `fmtDateDDMM` (no external importer, kept as a live function's own helper). File shrank 480 → 247 lines.
- **`frontend/components.json`**: restored the trailing newline the Task 9 deletion commit dropped (file now ends `}\n` again, matching every other repo config file; one-line diff, no content change).
- Gates: `docker compose exec frontend npx tsc --noEmit` — 0 errors. `docker compose exec frontend npm run build` — succeeds (green build is the actual proof no live import path was cut, beyond the grep trail above).
- Scope: exactly `frontend/src/lib/gantt/constants.ts` (deleted), `frontend/src/lib/gantt/geometry.ts`, `frontend/components.json`, this file. Deferred to `ISSUES.md` per the review (not touched here): emerald-toast retokening, `parseSectionId` consolidation, reorder-handler split.

### Removed — 2026-07-25 — Hand-rolled Gantt engine deleted (Plan B Task 9)

- `frontend/src/components/gantt/` (all 11 files, ~2.9k LOC: GanttFrame, GanttBar, GanttConnectors, GanttListRow, GanttChartPane, GanttListPane, GanttColumnGrid, GanttDateAxis, GanttRow, GanttSectionBar, GanttTodayLine) — replaced by the ReUI-based engine in `frontend/src/components/reui/gantt/` + `frontend/src/components/gantt-v2/`, which reached full parity (Plan B Tasks 1–8 + walkthrough fix rounds F1–F5). `frontend/src/lib/gantt/` (geometry, palette, exports, exportContext, constants) is retained in full as the export/data layer. Verified: zero imports of the deleted directory remain anywhere in `frontend/src`.

### Changed — 2026-07-25 — components.json iconLibrary corrected to lucide (Plan B Task 9 housekeeping)

- `frontend/components.json` `iconLibrary`: `"radix"` → `"lucide"` — the CLI-written value pointed future `shadcn add` icon insertions at radix, but the project uses `lucide-react` and `radix-ui` was removed in Plan B Task 1 (B1 review Minor, deferred to closeout).

### Fixed — 2026-07-25 — Project tab views scroll internally on desktop (walkthrough findings F5 + F5b)

- List, Kanban, Timeline, Risks, and Services project tabs scroll internally on desktop (`md:`+) instead of the whole page — `frontend/src/pages/views/ProjectList.tsx` (task-row container now `md:min-h-0 md:flex-1 md:overflow-y-auto`), `frontend/src/pages/views/ProjectKanban.tsx` (board row bounded via `md:min-h-0 md:flex-1`; each Kanban column now scrolls its card list independently — column header stays pinned), `frontend/src/pages/views/ProjectTimeline.tsx` (new wrapper div scrolls while the `<ol>`'s spine still runs the full list), `frontend/src/pages/views/ProjectRisks.tsx` (Stat badges + filter row stay pinned, table/mobile-card region scrolls), and `frontend/src/pages/views/ProjectServices.tsx` (bulk-actions row stays pinned, the service catalogue — `ServiceMappingList`, unmodified and still shared with `CustomerDetail` — scrolls in its own wrapper). All mirror the Gantt's B8 containment fix. `ProjectOverview` was intentionally left as content-flow (not named in scope). Mobile (`<md`) behavior is untouched everywhere — containment classes are all `md:`-gated, page scroll remains correct on phones. Known trade-off: any `position: absolute` popover opened very close to a new scroll container's bottom edge (List's row dropdowns, Kanban's column "⋯" menu) can now clip instead of overlaying past it, since the ancestor is `overflow-y-auto` instead of an unbounded page — same latent trade-off the Gantt's own B8 fix carries for its overlays; flagged, not fixed.

### Changed — 2026-07-25 — PDF export redesigned to match the ReUI Gantt's visual language (walkthrough Finding F4, supersedes Plan B Task 7's export freeze)

Plan B Task 7 (`768583d`) explicitly froze the Excel/PDF export layer at "re-register on the new geometry data, zero visual rebuild" when the Gantt engine swapped to ReUI. The user has now explicitly directed a full visual redesign of the PDF export to match the new engine's on-screen look (`SolvroBar.tsx`, `GanttOverlay.tsx`, `SolvroGantt.tsx`'s F3 axis system) — this entry records that supersession. Excel export (`exportExcel.ts`) is untouched; this is PDF-only. Full design-mapping table, connector-reuse notes, and verification trail: `.superpowers/sdd/task-f4-report.md`.

- **`frontend/src/lib/gantt/exportPdf.ts`** — full visual rewrite:
  - **Bars**: rounded-corner solid fills in the resolved Color-by hex (unchanged resolver, `barFillHex`); label rendered INSIDE the bar when it fits — measured via `pdf.getTextWidth` against the actual bar width (the PDF analogue of GH #58's measured-fit rule, replacing the old character-count-guess truncation), else immediately to the right in on-surface-variant gray. Inside-label text color follows the same luminance rule as `SolvroBar.tsx` (white on dark fills, near-black on light fills).
  - **Progress**: a darker overlay (true alpha via jsPDF's `GState`, not a manual color blend) on the completed fraction, only for 0%<progress<100%, matching `palette.ts`'s `PROGRESS_OVERLAY_ALPHA` and on-screen behavior (not-started/fully-done bars stay clean solid fills).
  - **Milestones**: a filled diamond in primary green (`#2d9042` — `index.css`'s `:root` **light**-theme `--primary`, since the PDF stays light-background/print-appropriate regardless of the app's dark-default theme; DESIGN.md: "Primary is Elitery Green — never blue: `#3aae51` dark / `#2d9042` light"), anchored on the due date, label beside it. **Fixes a latent gap**: the pre-F4 file gated ALL bar/milestone drawing on `row.start && row.end`, but a due-only milestone (no explicit `startDate`) has `row.start === null` (`geometry.ts`'s `taskDates()`) — so due-only milestones silently drew nothing at all pre-F4. Now anchored on `row.end` alone, independent of the general bar gate.
  - **Sections**: header band restyled to `surface-container-low` (was a raw slate literal), plus a ~3pt rollup pill spanning the section's children's date range in the section color — parity with `SolvroBar.tsx`'s `data-rollup` pill.
  - **Dependencies (new)**: stepped connector arrows between bars, HARD solid / SOFT dashed, small fixed right-pointing arrowhead — reusing `buildConnectorRoute` from `frontend/src/components/gantt-v2/connector-paths.ts` **directly, unmodified**, fed plain `{x,y,width,height}` rects computed in PDF coordinate space (milestones get a synthetic rect around the diamond so they can anchor a connector too). `buildConnectorRoute` returns an SVG `<path d>` string, not a point list, so a small regex parser (`parsePathPoints`) recovers the polyline jsPDF's `line()` calls need. `exportPdf.ts`'s `ExportPdfOpts` gained an optional `dependencies: TaskDependency[]` field (default `[]`); `SolvroGantt.tsx`'s `pdf`/`pdfTab` registration callbacks now pass `dependencies` (already fetched via `useProjectDependencies` for the live overlay) through. A dependency whose predecessor or successor isn't drawn on a given export page (paginated-off, or off the export window) is simply skipped on that page — same acceptance `GanttOverlay.tsx` documents for a collapsed-away endpoint.
  - **Baselines — implemented, then explicitly excluded per user direction (2026-07-25).** A first pass added a 3pt muted baseline-ghost rect (`#888780`, ported from `GanttOverlay.tsx`'s `BASELINE_COLOR`) under the bar whenever the project's baseline was locked, matching the on-screen ghost. Reviewing the sample PDF, the user asked for it to be removed from the PDF entirely — it is **not implemented** in the shipped version of this file. The on-screen baseline toggle and its ghosts (`GanttOverlay.tsx`, gated behind the `showBaseline` state in `SolvroGantt.tsx`) are completely unaffected; this is PDF-export-only. `ExportPdfOpts` has no baseline-related field.
  - **Axis — F3-consistent scale system**: top band stays calendar months; sub-columns are DAYS (with day numbers) when the exported range is ≤60 days, else they coarsen to ISO WEEKS (divider + `W<n>` label at each Monday) — mirroring the on-screen scale system's own coarsening (the "Week" pill is day-grain over a ~1-month window, the "Month" pill is week-grain over a ~1-quarter window; 60 days is roughly that boundary). Bar/milestone/connector geometry stays day-precise in both grains — only the axis's drawn ticks/labels and, in week-grain, the pagination width budget change. The tight ±7-day export window (owned by `SolvroGantt.tsx`'s registration, unchanged by this task) keeps most real exports well under the threshold, so day-grain is the common case; week-grain exists for projects whose task range genuinely spans months and was implemented but not exercised in the sample PDF (would need a second, wide-range sample — noted as a follow-up if the user wants one). Today line recolored from red to primary green to match the on-screen indicator. Weekend/holiday tints unchanged (`WEEKEND_HEX`/`HOLIDAY_HEX`, `palette.ts`).
  - **Task-table page**: header/alternate-row styling restyled to `surface-container`/`surface-container-low`/`on-surface` tokens (was raw slate literals). **Bonus fix, opportunistic**: the subtask-indent glyph `"└"` (U+2514) isn't in jsPDF's core-font WinAnsi encoding and rendered as mojibake (`"%"`) — confirmed via the F4 sample render — replaced with an ASCII-safe `"- "` indent. Pre-existing bug (predates this task), fixed while this section was already being touched.
  - **Removed**: the old file's priority-colored left-edge border strip on bars — dropped for on-screen fidelity, since `SolvroBar.tsx` has no equivalent element (priority is still visible via Color-by-Priority mode's fill color).
  - **Deliberate non-port**: `SolvroBar.tsx`'s milestone label uses `insideLabelTextColor` keyed on the bar's resolved fill color even though the milestone branch renders no colored backdrop behind that label on screen — literally porting that to the PDF's white page risked invisible white-on-white text for any colorBy mode whose fill luminance sits under the 0.6 threshold (e.g. IN_PROGRESS blue). The PDF always uses on-surface (near-black) for milestone labels instead; print legibility over literal fidelity for this one spot.
  - **Typography**: jsPDF's built-in helvetica remains the accepted print substitute for Source Sans 3 (unchanged from the pre-F4 file; noted here since this task touched every text-drawing call site).
- **`frontend/src/components/gantt-v2/SolvroGantt.tsx`** — `pdf`/`pdfTab` export registration callbacks (inside the `useGanttExport` registration effect) now pass `dependencies` through to `exportGanttToPdf`; the effect's dependency array gained `dependencies`. No `baselineLocked` is passed (see above). Excel registration (`exportGanttToExcel` call) untouched.
- `ExportPdfOpts.dependencies` is optional with a safe default (`[]`) specifically so `frontend/src/components/gantt/GanttFrame.tsx` — the OLD hand-rolled engine's own PDF registration call, still live and unmodified until Plan B Task 9 removes it — keeps compiling and behaving exactly as before (no connectors drawn there, matching its pre-F4 output).
- Gates: `docker compose exec frontend npm run typecheck` — 0 errors. `docker compose exec frontend npm run build` — succeeds; verified `exportPdf`/`jspdf`/`jspdf-autotable`/`exceljs` all still chunk-split out of the main bundle (`grep -c 'jspdf|exceljs' dist/assets/index-*.js` → 0). `cd e2e && BASE_URL=http://localhost:5173 npx playwright test tests/gantt-parity.spec.ts --project=desktop` — 11/11 passing, no regression from the `SolvroGantt.tsx` registration change. Sample PDF generated via a throwaway Playwright script (project with a section, a HARD + a SOFT dependency, a subtask, a due-only milestone, a locked-then-slipped baseline — the baseline lock/slip is kept in the fixture specifically to prove the PDF renders no ghost either way) and visually inspected page-by-page (rasterized with `pdftoppm`), including a final pass confirming the baseline-ghost rect is absent after its removal; script deleted after each capture, confirmed via `git status`.

### Fixed — 2026-07-25 — Zoom-pill scale remap: each pill now renders its labeled column grain (Plan B Task 9 walkthrough Finding F3)

User walkthrough finding, with screenshot evidence: the zoom pills rendered one level too fine — clicking "Day" showed hour columns, "Week" showed... days, but so did "Month", etc. Root cause: ReUI's `GanttScale` names (`"day"`/`"week"`/`"month"`/`"quarter"`/`"year"`) are CALENDAR-period names (how much time the initial window spans), not column-GRAIN names (what each column represents) — the two only coincide for `"day"` itself. Traced the actual column grain each scale renders in `gantt-view.tsx`'s unit-building `useMemo` (:393-553):

| ReUI scale | units (columns) | groups (bands) |
|---|---|---|
| `"day"` | hour-ish intervals | days |
| `"week"` | days | weeks |
| `"month"` | days | weeks |
| `"quarter"` | weeks | months |
| `"year"` | months | quarters |

`"week"` and `"month"` render an IDENTICAL column grain (days) — they only differ in how many days the initial window spans. `frontend/src/components/gantt-v2/SolvroGantt.tsx`'s `SCALES` array previously mapped each pill's label to the ReUI scale of the SAME name (`"Day"` → `mode: "day"`, etc.), which is why every pill rendered one level finer than its label promised.

- **Fix**: remapped `SCALES` one ReUI-scale step coarser per pill — `"Day"` pill → ReUI `"week"` (day columns, ~1-week initial window); `"Week"` pill → ReUI `"month"` (day columns, ~1-month initial window — closest visual match to the old hand-rolled engine's Week-mode default, so it stays the default scale, `useState<GanttScale>("month")`, changed from `"week"`); `"Month"` pill → ReUI `"quarter"` (week columns under month bands); `"Quarter"` pill → ReUI `"year"` (month columns under quarter bands). ReUI's own `"day"` scale (hour columns) has no pill — same as the old engine, which never exposed an hour-granular mode either. Verified all four pills visually (screenshots — `test-results/scale-{day,week,month,quarter}.png` from the new e2e test below): each renders exactly the grain its label promises, and weekend/holiday shading (only meaningful on day-granular columns) correctly appears on the "Day"/"Week" pills and correctly disappears (not "broken," just absent — no `isOff` field exists on week/month-granularity units in `gantt-view.tsx`) on "Month"/"Quarter".
- **Baseline math re-verified at "year" scale, NOT gated off**: `task-b6-report.md` speculated the `GanttOverlay.tsx` single-donor px/day baseline derivation "would break under ReUI's unreachable year scale... via non-uniform month-length columns" — the Quarter pill now reaches it, so this needed a real answer, not another guess. Traced `gantt-view.tsx`'s year-scale unit sizing: each month's `weight` is set to its REAL day count (`gantt-view.tsx:482`, `"nominal-day units so a month reads ~30 wide"`), and columns are sized via `flex: weight 0 0px` (`gantt-view.tsx:2027`) — i.e. proportional to weight. Since `width_i = (weight_i / totalWeight) × trackRemWidth` and `weight_i` IS the day count, `width_i / days_i = trackRemWidth / totalWeight` — a constant, independent of `i`. Per-day pixel width is therefore mathematically uniform across every month in year scale (a 31-day month is proportionally wider, not per-day-wider), exactly the property the single-donor extrapolation needs. The same argument applies to quarter scale's week-unit columns (near-exactly, modulo negligible DST-week weight variance). Empirically confirmed too: locked a baseline, rescheduled a task across a month boundary, viewed at the Quarter pill — the ghost rect's offset from the live bar matched the reschedule delta exactly (cross-checked the derived px/day against TWO different bars in two different months — June and September — both yielding the identical `5.059375 px/day`). Screenshot: baseline ghosts render correctly aligned at Quarter-pill zoom, no misplacement. **Not gated off** — the original "would break" premise doesn't hold. Connector routing (DOM-measured per bar, scale-independent by construction) also confirmed visually sane at this zoom despite bars rendering narrow.
- **E2E**: new `e2e/tests/gantt-parity.spec.ts` test `(i) zoom pills render each label's column grain; bar stays visible across all four` — clicks each pill, asserts it visually activates (`bg-primary`, the only signal available — no `aria-pressed` on this toolbar) and a task dated exactly "today" stays visible with no extra scrolling (the anchor date never moves on a scale change — only Task 8's one-shot fit effect touches it — so it's inside every scale's window by construction). Captures the four reference screenshots referenced above. Re-ran `gantt-parity.spec.ts`, `gantt-bar-labels.spec.ts`, `gantt-legend.spec.ts`, `list-dnd.spec.ts` together per the task brief's concern about the default scale's px-per-day changing (~114 → ~45, since the default pill's underlying scale went from ReUI `"week"` to `"month"`) affecting raw-coordinate drag tests — all passing assertions compare dates/positions relationally (before/after, direction), not fixed pixel magnitudes, so none needed changes.
- Scope: `frontend/src/components/gantt-v2/SolvroGantt.tsx`, `e2e/tests/gantt-parity.spec.ts`. `GanttOverlay.tsx` untouched — the baseline-gating branch of this task turned out not to be needed. Old engine and vendored ReUI files untouched.
- Gates: `docker compose exec frontend npm run typecheck` — 0 errors. `docker compose exec frontend npm run build` — succeeds. `cd e2e && BASE_URL=http://localhost:5173 npx playwright test tests/gantt-parity.spec.ts tests/gantt-bar-labels.spec.ts tests/gantt-legend.spec.ts tests/list-dnd.spec.ts --project=desktop` — full results and flake analysis in `task-b9f3-report.md`.

### Fixed — 2026-07-25 — Gantt initial-view-fit + internal scroll containment (Plan B Task 8 app-bug findings fix round)

Two app-side regressions Task 8's browser pass found (`task-b8-report.md`'s "App-bug findings"), fixed here; full evidence and porting notes in `task-b8fix-report.md`.

- **Finding #1 — empty initial view.** `frontend/src/components/gantt-v2/SolvroGantt.tsx` never told the vendored engine where to anchor its initial visible window, so it defaulted to `new Date()` (`gantt.tsx`: `date: initial.defaultDate ?? new Date()`) — a single week at Week scale — regardless of where the project's actual tasks fell. A project whose tasks were more than a few days from today opened to a completely empty timeline (the task's row existed in the tree pane; its bar was never in the DOM), with no on-screen affordance hinting data existed off-screen. Old engine parity: it always derived its chart window from the tasks' own min/max dates.
  - Rejected fix: a computed `defaultDate` prop. Verified by reading `createGanttStore` (`gantt.tsx:331-343`) that `defaultDate` is consumed exactly once, inside a lazy `useState` initializer (`gantt.tsx:844`) — a later render's different value is silently ignored. Since `tasks` loads asynchronously (React Query) and can also change under an already-mounted `<Gantt>` on a warm-cache project switch (`SolvroGantt` doesn't remount per `projectId`), a mount-time-only prop can't reliably track the right window.
  - Shipped fix: a `fitProjectIdRef`-guarded effect calls `apiRef.current?.goTo(date)` (`gantt.tsx:569`) once per `projectId` — the same imperative `setField("date", ...)` path the existing "Today" toolbar button already uses, live-reanchoring with no remount. Fit target: today, if it falls within the project's task date range (old-engine parity — an in-progress project still opens on today); otherwise the project's earliest task date, so a fully past- or future-dated project opens on its own data. `allRows`/`allDateRange` (renamed from Task 7's `exportRows`/`exportDateRange` — now genuinely dual-purpose: export input AND view-fit target; `rowsDateRange` scans section-header rows too, whose start/end is computed before `geometry.ts`'s collapse early-return, so the range is collapse-independent) supply the date range.
  - Regression coverage: `e2e/tests/gantt-parity.spec.ts`'s `test.fixme("opening the Gantt shows an existing task's bar without manual scrolling, regardless of its dates", ...)` flipped to a real `test(...)` and passing (2 consecutive clean runs). Switched from the shared `seededProject` fixture to an isolated project (`createIsolatedProject`, already used by this file's checklist test) — the shared project's pre-seeded alpha/beta/gamma/delta tasks (dated near today) meant today legitimately fell within the shared project's overall date range even with the far-past task added, so the fit correctly (and, for this specific assertion, unhelpfully) chose "today" as the anchor; an isolated project containing only the far-past task exercises the "outside range → anchor on task data" branch cleanly.
- **Finding #2 — no internal scroll containment past ~a viewport of rows.** With enough rows to exceed the viewport, the whole page scrolled instead of the Gantt's own internal pane — toolbar, breadcrumb, tabs, and the tree/date-axis headers all scrolled away with the rows. Root-caused via live browser measurement (`getComputedStyle`/`getBoundingClientRect` walked up the DOM from `[data-testid="solvro-gantt"]`): `frontend/src/pages/ProjectDetail.tsx`'s `<Outlet>` wrapper div (`min-h-0 min-w-0 flex-1`) is `display: block`, not `display: flex` — under a block parent, a child's `flex-1`/`min-h-0` Tailwind classes are inert (flex properties only apply to children of a flex container), so `ProjectGantt.tsx`'s wrapper (and everything inside it, including `SolvroGantt.tsx`'s own `h-full` root) rendered at its natural, unbounded CONTENT height instead of being clipped to the viewport. With nothing constraining it, the vendored engine's own internal `ScrollArea` never detected overflow (its bounds had grown to fit the content, so `scrollHeight === clientHeight` inside it), and the overflow bubbled, unclipped (`overflow: visible` at each broken link), up to `<main>` (`Shell.tsx`) — the first ancestor that actually had `overflow-y: auto` — which took over scrolling the ENTIRE page content as one block.
  - Fix: added `flex flex-col` to `ProjectDetail.tsx`'s Outlet wrapper (`min-h-0 min-w-0 flex-1` → `flex min-h-0 min-w-0 flex-1 flex-col`) — the single missing link. Verified via the same live measurement before/after: `<main>`'s `scrollHeight`/`clientHeight` went from `1140/844` (page-level overflow) to `844/844` (no outer scroll); the vendored engine's own `[data-slot="scroll-area-viewport"]` went from no detected overflow to `955/635` (internal overflow correctly detected and handled). Confirmed visually with before/after screenshots of a 21-row project scrolled via real wheel input: toolbar, breadcrumb, tabs, and both header rows stay fully visible after scrolling; only the rows themselves scroll.
  - Verified the fix doesn't regress the other five project tabs (Overview, List, Kanban, Timeline, Risks, Services) — all screenshot-checked post-fix, no visual change (each renders a single child under the new flex-column wrapper; `align-items: stretch`'s default cross-axis behavior is width-equivalent to a block child's natural full-width flow, so nothing shifts for views that don't use `flex-1` themselves).
  - Regression coverage: `e2e/tests/gantt-parity.spec.ts`'s `(checklist)` test (already scrolls a ~20-row isolated project via real wheel input, `checklist-04a`/`04b` screenshots) gained three deterministic assertions post-scroll — the "Today" toolbar button and both `[data-slot="gantt-tree-header"]`/`[data-slot="gantt-timeline-header"]` vendored header slots stay visible.
- Scope: `frontend/src/components/gantt-v2/SolvroGantt.tsx`, `frontend/src/pages/ProjectDetail.tsx` (the one line — verified the chain genuinely broke there via live measurement before touching it), `e2e/tests/gantt-parity.spec.ts`. Old engine and vendored ReUI files untouched.
- Gates: `docker compose exec frontend npm run typecheck` — 0 errors. `docker compose exec frontend npm run build` — succeeds. `cd e2e && BASE_URL=http://localhost:5173 npx playwright test tests/gantt-parity.spec.ts tests/gantt-bar-labels.spec.ts --project=desktop` — 11/11 passing, run twice back-to-back with no flakes.

### Added — 2026-07-24 — Gantt e2e adapted to the ReUI engine + new parity coverage (Plan B Task 8)

- `e2e/tests/gantt-bar-labels.spec.ts`: adapted to the new engine's label DOM. The old engine exposed the measured-fit decision as `[data-label-for="<id>"]` (a sibling floated element) vs. plain inline text; `SolvroBar.tsx` instead reports it via a `data-label-outside` attribute on the bar's own content span (`[data-task-id="<id>"]`) — present (React serializes it as the literal string `"true"`, not an empty string) iff the name floats, with the floated label itself living at `[data-slot="solvro-bar-label-outside"]` inside that same span. Switched from `getByText(...).toBeVisible()` to `toContainText`/`toHaveAttribute` — the span always carries an invisible measurer copy of the title alongside the real visible label (`SolvroBar.tsx`'s `useLabelFits`), so `getByText` matched both and tripped Playwright's strict-mode single-match rule. Behavioral assertion (short name inside, long name floats outside) is unchanged.
- `e2e/tests/gantt-legend.spec.ts`: **no changes needed** — `SolvroGantt.tsx`'s toolbar ports the legend/color-by select verbatim (same `data-testid="gantt-legend"`, same implicit `<label>` wrapping the `<select>`, same option values/labels), confirmed by running the existing spec unmodified against the new engine before touching anything.
- `e2e/tests/list-dnd.spec.ts`: the Gantt row-drag case's grip lookup now uses aria-label `"Reorder"` (`gantt-i18n.tsx`'s `labels.reorder`, the vendored engine's own row-grip label) instead of the old engine's `"Drag handle"`. The List-view and Kanban cases in this file needed no changes — their own drag mechanism is unrelated to the Gantt engine swap. **Separately, a full-suite flake fix**: `workers: 1`/`fullyParallel: false` (`playwright.config.ts`) means the worker-scoped `seededProject` fixture is not necessarily re-created between every spec file in a run, despite `fixtures/test.ts`'s comment calling that "effectively per test file" — in practice `gantt-parity.spec.ts` (alphabetically earlier) can share its seeded project with this file, and it seeds a milestone task with no `startDate` (legitimate — only `dueDate` is required for a milestone). The Gantt row-drag test's "grab the globally-last top-level task" logic picked that up and tripped its own not-null guard. Fixed by filtering to top-level tasks that actually have both dates before selecting the drag/drop-target pair — a general robustness fix, not specific to this one milestone task.
- `e2e/fixtures/seed.ts`: new `isoDateOffset(offsetDays, from?)` helper; the seeded fixture's `alpha`/`beta`/`gamma`/`delta` tasks are now dated relative to today (same relative offsets/durations as before: alpha 0→+4, beta +1→+7, gamma +2→+8, delta 0→+11) instead of the hardcoded `"2026-07-01"`-etc. calendar dates. Required because of an app-bug finding (see below): the new engine's initial rendered window anchors on `new Date()`, so a hardcoded date drifts out of it as wall-clock time advances past it — as it now has. No existing spec asserts the literal date *values* (only null-checks and before/after equality), so this is a pure robustness fix with no behavior-coverage loss.
- New `e2e/tests/gantt-parity.spec.ts` — 8 new-engine parity behaviors plus a visual-checklist smoke test, all against the ReUI-engined Gantt: (a) drag-move commits new dates and survives reload; (b) resize-end changes `dueDate` only; (c) connector create via dot-drag + delete via hover-×, HARD type asserted, persists across reload; (d) baseline toggle shows/hides `[data-baseline-rect]` ghosts (baseline locked via the API in test setup); (e) milestone renders `[data-milestone]`; (f) section rollup pill (`[data-rollup]`); (g) row reorder via the `[data-slot="gantt-row-grip"]` grip commits the canonical order, verified in both Gantt and List view (one shared `position` order — `CLAUDE.md`); (h) section collapse — chevron `aria-expanded` + row visibility toggle correctly (collapsed rows stay in the DOM, hidden — `toHaveCount(0)` doesn't apply, `not.toBeVisible()` does), export menu opens (download automation intentionally skipped — heavy/flaky in headless Chromium, out of scope). A `connectorHoverPoint` helper parses a connector's own rendered `d` path and hovers the midpoint of its vertical run instead of relying on `.hover()`'s bounding-box-center default, which reliably misses an axis-aligned stepped polyline entirely.
- One `test.fixme()` regression documenting the correct expected behavior for the app-bug finding below (opening the Gantt should show an existing task's bar without manual scrolling, regardless of its dates) — currently fails, kept unskipped-but-not-run so it starts passing (and gets noticed) once the app is fixed.
- **App-bug finding**: `frontend/src/components/gantt-v2/SolvroGantt.tsx` never passes `defaultDate` to `<Gantt>`, so the engine's initial visible window anchors on `new Date()` (a ~1-week span at the default Week scale) and nothing widens it to fit the project's actual task dates on mount. A task dated even a few weeks from today is not in the DOM at all until the user manually scrolls — confirmed via manual investigation: reaching a task 24 days in the past took 40 wheel-scroll steps, with no on-screen affordance indicating data exists off-screen. The old hand-rolled engine derived its chart window from the tasks' own min/max dates, so a project's data was always visible immediately regardless of "today" — this is a real regression, not a hand-rolled-engine parity gap. Filed for the app-side implementor; not fixed here (out of scope for an e2e-only task).
- **App observation (not a blocking finding, reported for the record)**: with enough task rows to exceed the viewport height, the browser's OUTER page scrolls as a whole (confirmed via before/after screenshots) rather than an internal Gantt pane scrolling with a pinned header — the toolbar (zoom pills, Baseline/Export buttons) and the date-column header scroll away entirely, not just a connector-bleed cosmetic issue. This reframes the B6 review's deferred "connector bleed over the sticky header" question: there is no sticky header in this configuration for a connector to bleed over. Full detail and screenshots in `.superpowers/sdd/task-b8-report.md` (local-only, not tracked).
- Full suite run (`cd e2e && BASE_URL=http://localhost:5173 npx playwright test`, desktop + mobile projects, all spec files): 43 passed, 4 failed (the known `pwa.spec.ts`-on-dev-server caveat, pre-existing and unrelated to this task), 29 skipped (desktop-only specs on mobile / mobile-touch specs on desktop / the one `test.fixme()` above), 0 flaky.

### Added — 2026-07-24 — Excel/PDF export re-registered on geometry data layer (Plan B Task 7)

- `frontend/src/components/gantt-v2/SolvroGantt.tsx`: ported the export-registration effect from `frontend/src/components/gantt/GanttFrame.tsx:597-684` verbatim in shape — builds `Row[]` via geometry's untouched `buildRows()` from the SAME `tasks`/`sections` this container already queries, computes the same ±7-day export window around the actual task date range (anchored on today when no tasks are dated, resolved at export time), and registers `{ excel, pdf, pdfTab }` handlers through the existing `useGanttExport()` context (`frontend/src/lib/gantt/exportContext.tsx`, already provided by `ProjectDetail.tsx` around the whole route `Outlet`) — unregistering on unmount. **`frontend/src/lib/gantt/exportExcel.ts` and `exportPdf.ts` are untouched** — zero export-layer rebuild, exactly per plan.
- Replaced B3's disabled "Export — wired in Plan B Task 7" toolbar stub with the real Excel/PDF dropdown button, ported verbatim from `GanttFrame.tsx:882-910` (same click-outside-to-close `exportMenuRef`/`exportMenuOpen` state, same `exporting` busy state, same `runExport` callback). `frontend/src/components/layout/RightSidebar.tsx`'s "Export schedule" section needed no changes — it already consumes `useGanttExport()` independently and was inert only because nothing had called `register()` yet.
- **Collapse-state decision — full parity restored (fix pass, post-review)**: the first pass of this task assumed ReUI's tree collapse/expand was entirely internal and unreachable from `SolvroGantt.tsx`, and shipped exports that always rendered fully expanded as an "accepted deviation." That premise was wrong — `gantt.tsx:1344-1348` exposes a first-class controlled `collapsedGroups`/`onCollapsedGroupsChange` pair (same controlled/uncontrolled pattern as `selectedRows`; forwarded through `<Gantt>`'s own prop type via `Partial<GanttViewConfig>`, confirmed by reading `gantt.tsx:1513-1516`). Fixed by holding `const [collapsedGroups, setCollapsedGroups] = useState<string[]>([])` in `SolvroGantt.tsx` (default `[]` = fully expanded, matching the old engine's initial `collapsed` Set, `GanttFrame.tsx:158`) and wiring it straight to `<Gantt collapsedGroups={collapsedGroups} onCollapsedGroupsChange={setCollapsedGroups}>` — the built-in chevron toggle UI keeps working unchanged (`gantt-view.tsx:1778-1787`'s `onToggleRow` calls `onCollapsedGroupsChange` regardless of controlled/uncontrolled mode; it only skips its own internal `setInternalCollapsed` when controlled). The SAME `collapsedGroups` state now feeds the export effect's `buildRows()` call, via a new `toGeometryCollapsedIds()` mapper: ReUI's collapse ids are resource-node ids (`adapter.ts`'s `sectionNodeId`/`taskNodeId` — `section-<id>`/`section-none` for sections, `task-<id>` for tasks-with-subtasks), which do NOT align 1:1 with `geometry.ts`'s row-id shape (`sec-<id>`/`sec-none` for sections, confirmed by reading `geometry.ts:458-467` — only the section prefix differs; task ids already match, `geometry.ts:413`). The mapper translates the section prefix and passes task ids through unchanged. Net result: exports now follow on-screen collapse exactly like the old engine did — the deviation is gone, not just documented-away.
- **Baseline columns finding**: verified by reading `exportExcel.ts` and `exportPdf.ts` in full that neither file references `baselineStartDate`/`baselineDueDate` anywhere, locked or not — the premise that "the old exports include baseline data when the project baseline is locked" does not hold against the actual export-layer code; no baseline columns exist in Excel or PDF output today. `Row.task` (from `buildRows()`) already carries the full, unfiltered `Task` object including both baseline fields, so nothing here blocks that from being wired up later — there was simply nothing to preserve because the feature doesn't exist yet.
- **Dynamic-import discipline**: `exportGanttToExcel`/`exportGanttToPdf` are now imported via `await import("@/lib/gantt/exportExcel" | "exportPdf")` inside each handler body, one layer more aggressive than the old engine's static top-level import (which relied solely on `exceljs`/`jspdf` being dynamically imported *inside* those modules). Verified via `docker compose exec frontend npm run build`: `exportExcel-*.js` (5.15 kB) and `exportPdf-*.js` (5.78 kB) land as their own chunks, and the heavy libs land in their own chunks too — `exceljs.min-*.js` (938.56 kB), `jspdf.es.min-*.js` (390.26 kB), `jspdf.plugin.autotable-*.js` (31.08 kB), plus jsPDF's own `html2canvas.esm-*.js`/`purify.es-*.js` transitive chunks. `grep -c "ExcelJS\|jsPDF\|autoTable" dist/assets/index-*.js` → `0`: none of those strings appear in the main bundle.
- Gates: `docker compose exec frontend npm run typecheck` — 0 errors. `docker compose exec frontend npm run build` — succeeds, chunk separation confirmed as above. Re-run clean after the collapse-state fix pass (same two gates, same chunk-separation result). No browser automation available this session; verification was structural (DOM-slot/state citations, hand-traced export-window math, direct inspection of the export-layer and vendored-component source to settle the collapse-state and baseline-column claims) rather than live in-browser export diffing against the old engine — deferred to Task 8's browser-verification pass, same caveat as Tasks 5/6's entries above.

### Added — 2026-07-24 — DOM-measured overlay: dependency connectors, drag-create, baselines (Plan B Task 6)

- New `frontend/src/components/gantt-v2/connector-paths.ts`: pure path math ported VERBATIM from `frontend/src/components/gantt/GanttConnectors.tsx` — `polylineToPath` (:52-56), `trimPolyline` (:63-93), and the constants `FORWARD_NUDGE`/`BACK_NUDGE`/`ARROW_INSET`/`HIT_TRIM` (:42-48). The stepped-route builder (old file's inline `useMemo` body, :164-224) is extracted into `buildConnectorRoute(predRect, succRect)`, taking plain `{x,y,width,height}` rects instead of `Row`+`chartStart`+`viewMode`+`columnWidth` — the new engine derives geometry from real DOM measurement, not analytical layout, so there's nothing for those old geometry types to do here. One adaptation, not a straight port: the old back-route detour stepped by a fixed `ROW_HEIGHT / 2` (30px, a static-layout constant that doesn't exist in the new dynamic-row-height engine); `succRect.height / 2` — the successor's own measured bar height — stands in as the analogous "half a row's vertical buffer." No React; pure functions only.
- New `frontend/src/components/gantt-v2/GanttOverlay.tsx`: an absolutely-positioned `<svg>` mounted via `createPortal` into `[data-slot="gantt-timeline-pane"]` (`frontend/src/components/reui/gantt/gantt-view.tsx:2310-2313` — already `position: relative`, so `inset-0` lands exactly over the visible timeline viewport with no manual rect math; the same technique the vendored engine's own internal `GanttOffscreenChips` uses at `gantt-view.tsx:3568-3757`, reached from outside the vendored file instead of baked into it, so the vendored file stays untouched). The actual scrolling node is one level down, `[data-slot="scroll-area-viewport"]` (`gantt-view.tsx:294-298`'s `getPaneViewport` helper re-derived locally since it isn't exported).
  - **Measurement**: `measureBars(viewport)` — ported verbatim from the task-6 brief — walks every `[data-task-id]` element (Task 4's `SolvroBar` anchor) up to its nearest `[data-slot="gantt-bar"]` ancestor and records the bar's rect in scroll-content coordinates (viewport-relative + `scrollLeft`/`scrollTop` added back). Re-measured, batched through one `requestAnimationFrame`, on: viewport scroll, a `ResizeObserver` on the pane (container/splitter/window resize), a `ResizeObserver` on the scroll content's own root element (catches scale-zoom and section-collapse/expand content-size changes — collapse state lives inside `GanttView` and isn't exposed upward, so observing the content root's own box is how both are caught without threading that state out of the vendored engine), and whenever the `events` prop changes identity (a drag-commit landed and the tasks query refetched).
  - **Connectors**: for every `TaskDependency` with both endpoints currently measured, routes predecessor-right → successor-left through `buildConnectorRoute`. HARD solid / SOFT `stroke-dasharray "5 4"`, shared arrowhead marker, 14px transparent hit path, hover state + × delete (`canEdit` only) calling `onDelete`. Colors ported verbatim as the same semantic-token `rgb(var(--x))` inline-style syntax the old engine used (`--on-surface-variant` default, `--primary` on hover/delete) — not translated to Tailwind classNames, to keep this a literal port. Each connector carries `data-connector-id`/`data-connector-type` (B8 e2e hooks). A dependency whose endpoint bar isn't currently measured (section collapsed, virtualized out of range) is silently skipped — accepted per the task brief, not a bug.
  - **Drag-create**: a `document`-level **capture-phase** `pointerdown` listener (fires before any bubble-phase `stopPropagation()` a descendant calls, so it always sees the press) watches for `[data-connect-dot]` (new in `SolvroBar.tsx`, see below); on hit it starts a rubber-band line tracked via `window` `pointermove`/`pointerup`/`Escape` listeners — same lifecycle as the old engine's `handleConnectStart` (`frontend/src/components/gantt/GanttFrame.tsx:215-306`), including its `elementFromPoint` + `[data-task-id]` walk on release (:249-260) and its left/right-dot direction semantics (predecessor/successor swap, :265-278). Creation is always `type: "HARD"` with `sourceHandle: "right-source"`/`targetHandle: "left-target"` regardless of which dot started the drag (parity, `GanttFrame.tsx:274-276` — schema fields exist, no shipped UI reads them). Calls `onCreate` (a plain prop — `GanttOverlay` holds no React Query hooks of its own).
  - **Baselines**: when `showBaseline` and any task has both baseline dates, derives ONE px-per-day scale from a single measured bar + its live event dates (`pxPerDay = rect.width / durationDays`, `x(date) = rect.x + diffDays(date, rect's event start) * pxPerDay`) — this is a safe approximation given Solvro's four exposed scales (day/week/month/quarter all use uniform per-day column widths; only ReUI's `"year"` scale would break it via non-uniform month-length columns, and `SolvroGantt.tsx`'s scale toolbar never exposes `"year"`, matching the old engine's own four-mode toolbar). Draws a 3px muted (`rgb(136, 135, 128)`, ported verbatim as a raw literal — no matching CSS custom property for this exact shade) rect at `rect.bottom + 2` for every task with both `baselineStartDate`/`baselineDueDate` AND a currently-measured live bar, spanning the baseline range with the same +1-day exclusive-end padding live bars use. `data-baseline-rect`/`data-baseline-task-id` attributes (B8 hooks). No bars measured → nothing drawn.
- `frontend/src/components/gantt-v2/SolvroBar.tsx`: new `canEdit` prop (was implicit via `event.readOnly` only) and a `ConnectDots` sub-component — left/right edge dots (`data-connect-dot`, `data-connect-side`), visual spec ported verbatim from the old engine's `GanttBar.tsx:424-441,463-494` (12px white-bordered primary circle, hidden until hover via the SAME `group-hover/gantt-bar-group` class `gantt-bar.tsx`'s own resize handles react to). Rendered in both the milestone and regular-bar branches when `canEdit && !event.readOnly` (parity: "Milestones have connector dots too", old engine's milestone branch had its own pair). The dot's own `onPointerDown` only calls `stopPropagation()`/`preventDefault()` — it carries no drag logic itself; `GanttOverlay`'s capture-phase listener owns the entire lifecycle (see above), which is what lets this stay a thin, prop-free affordance.
- `frontend/src/components/gantt-v2/SolvroGantt.tsx`: wires it all up — `useProjectDependencies` (previously fetched-but-unconsumed, warmed ahead of this task in B4/B5) now actually feeds the overlay; new `useCreateDependency`/`useDeleteDependency` (invalidate-only, `queries.ts:1308,1336` — no optimistic connector add/remove, matching the old engine); `handleCreateDependency`/`handleDeleteDependency` surface errors through the existing `actionError` banner (mirrors `GanttFrame.tsx:308-322`); `renderEvent` now passes `canEdit` to `SolvroBar`; a new `ganttContainerRef` wraps the `<Gantt>` mount point so `<GanttOverlay>` (rendered as a **sibling** of `<Gantt>`, not a child — it needs no gantt-context hooks, only the DOM the vendored tree already committed) can locate the timeline pane to portal into.
- Gates: `docker compose exec frontend npm run typecheck` — 0 errors. `docker compose exec frontend npm run build` — succeeds. No browser automation available this session; verification was structural/code-reading (DOM-slot citations, hand-traced measurement/drag/baseline math) rather than live in-browser confirmation — recommend a manual/Playwright pass before merge (Task 8), same caveat as Task 5's entry above.

### Fixed — 2026-07-24 — Connect-dot/resize-handle overlap + mid-drag listener leak (Plan B Task 6 review fix pass)

- `frontend/src/components/gantt-v2/SolvroBar.tsx`'s `ConnectDots`: repositioned each dot from centered-on-the-bar-edge to fully OUTSIDE the bar, 4px gap (same gap constant the old engine's milestone dots used, `GanttBar.tsx:329`). Centered-on-edge (the original placement, `-translate-x-1/2`/`translate-x-1/2`) put the dot's [-6px,+6px] span in direct conflict with `gantt-bar.tsx`'s resize handle, which occupies [2px,10px] INWARD from the same edge (`start-0.5 w-2`/`end-0.5 w-2`, `gantt-bar.tsx:226,242`) — in the [2px,6px] overlap the later-painted dot won every pointerdown, so the resize handle was only grabbable in a ~4px sliver (worse on touch, no visual cue it had shrunk). Now `start-0 -translate-x-[16px]` (left dot spans [-16px,-4px]) / `end-0 translate-x-[16px]` (right dot spans [+4px,+16px]) — both ranges sit entirely outside the handle's [2px,10px] inward span, zero overlap. Dots stay always-hit-testable (unchanged) since the capture-phase drag-start listener in `GanttOverlay.tsx` depends on that.
- `frontend/src/components/gantt-v2/GanttOverlay.tsx`'s drag-create effect: the effect's own cleanup previously only removed the delegated `document` `pointerdown` listener, leaving an in-flight drag's `window` `pointermove`/`pointerup`/`keydown` listeners (and its `Escape`-cancel path) attached if the effect re-ran (`canEdit`/`viewportEl` changing mid-drag) or the overlay unmounted mid-drag (e.g. the project's task list emptying out under it) — those three listeners' own `endDrag()` (renamed from `cleanup()` to avoid shadowing the effect's own cleanup) only ever ran from a normal pointerup/Escape, never from teardown initiated elsewhere. Fixed by tracking the active drag's teardown in a `teardownActiveDrag` closure variable and invoking it from the effect's `return` cleanup too, alongside resetting `connectDrag` state.
- `frontend/src/components/gantt-v2/SolvroGantt.tsx`: dropped the unnecessary `relative` on the `<Gantt>`-wrapping `ganttContainerRef` div (reviewer nit) — `GanttOverlay` locates its portal target via `querySelector('[data-slot="gantt-timeline-pane"]')` on that ref, which is unaffected by the wrapper's own `position`.
- Gates re-run: `docker compose exec frontend npm run typecheck` — 0 errors. `docker compose exec frontend npm run build` — succeeds.
- Deferred to Task 8's browser-verification pass (not touched here, per reviewer triage): connector bleed over the sticky header band, milestone connector/dot endpoints landing at the day-column edge rather than the diamond glyph, the pane-resolution effect running every render, and the unused `tipX`/`tipY` fields on `ConnectorRoute`.

### Added — 2026-07-24 — Drag/resize/reorder commit pipeline via optimistic mutations (Plan B Task 5)

- `frontend/src/components/gantt-v2/SolvroGantt.tsx` wires `onEventUpdate` and `onResourceReorder` on the `<Gantt<Task>>` element, turning the interaction surface B3/B4 left inert into real commits. Scope was this file only — `adapter.ts` (locked for this task) needed no changes; both handlers compose its existing `eventPatch`/`parseTaskId`/`sectionNodeId`/`taskNodeId` exports.
- `handleEventUpdate`: `eventPatch(update)` (adapter.ts) converts ReUI's exclusive `end` back to Solvro's inclusive `dueDate`; `null` (non-task event), `!canEdit`, or a rollup-pill id (`section-rollup-*`) all return `false` (reject). Rollup pills are already `readOnly: true` (excluded from gestures at the engine level) and carry no `data` (so `eventPatch` would reject them too) — the id check is a third, deliberately redundant guard. Accepted updates call `useUpdateTask(projectId).mutate(patch)` (optimistic, `queries.ts:660-696`) and return `true`.
- `handleResourceReorder`: mirrors `GanttFrame.tsx:420-569`'s `handleDragEnd` drop semantics — the old engine's constraints are the spec — mapped onto ReUI's single `{resourceId, parentId, index}` proposal:
  - Section-group reorder (root level only): rejects the "(No section)" pseudo-group (no backing `Section` row) and any `parentId !== null` (sections never nest under a task); otherwise re-derives the desired root order from the current `resources` list with the move spliced in, and patches every real section whose position actually changed via `useUpdateSection`.
  - Subtask reorder: rejects any `parentId` other than the subtask's current parent (no re-parenting via drag, matching `GanttFrame.tsx:474-495`); ReUI's `index` already excludes the moved row when counting, so it maps 1:1 onto the backend's `insertAt` convention with no extra math.
  - Top-level task reorder: rejects drops under a task node (no promote/demote-via-drag); otherwise computes one GLOBAL dense `position` across the project's whole top-level order (`taskOrdering.ts:17-19` — the sibling key for `parentTaskId === null` is project-wide, not per-section) by locating where the target section's other tasks sit in that order — unifying `GanttFrame.tsx`'s two old drop paths (`:431-471` row-target, `:500-536` section-target-append) into one index-based computation. Same-section no-op drops (`position` unchanged) are rejected without a mutation.
  - Every accepted branch calls `updateTask`/`updateSection.mutate` with an `onError` that surfaces `setActionError` (existing banner), matching `GanttFrame.tsx`'s catch-and-report behavior for drag failures.
  - The `<Gantt>` element only passes `onResourceReorder` when `canEdit` — passing it unconditionally would render the row-drag grip (`gantt-view.tsx:1591`'s `reorderEnabled = !!settings.onResourceReorder`, wired to `onGripPointerDown` at `:1888` and rendered at `:2659-2670`) for read-only users even though the handler would no-op on drop.
- Gates: `docker compose exec frontend npm run typecheck` — 0 errors. `docker compose exec frontend npm run build` — succeeds. No browser automation available this session; verification was six hand-traced patch computations (bar drag, resize, cross-section top-level drop, rejected subtask re-parent, section reorder, mutation-failure rollback) documented in the task report rather than live in-browser confirmation — recommend a manual/Playwright pass before merge (Task 8).

### Added — 2026-07-24 — Solvro bar rendering: solid fills, milestones, measured-fit labels (Plan B Task 4)

- New `frontend/src/components/gantt-v2/SolvroBar.tsx`: the `renderEvent` content renderer wired into `SolvroGantt.tsx`'s `<Gantt>` (`renderEvent`, `classNames.event`, `barLabel="inside"`). Setting `renderEvent` makes every bar "consumer-owned" per `gantt-bar.tsx:186-194` — this component now owns 100% of a bar's inner visualization; the vendored engine still owns the wrapper (position, drag/resize, a11y, selection, tooltip).
- **Solid fills**: `classNames.event` neutralizes ReUI's default `bg-(--gantt-event-color)/20` ghost track across all three of its variants — base, `hover:`, and `data-selected:` are each a separate tailwind-merge conflict group, so all three needed overriding to `bg-transparent` or the washed-out look would flash back on hover/selection. `SolvroBar` then renders its own opaque `bg-(--gantt-event-color)` backdrop (`inset-0`, anchored to the button so it reaches the true edges including padding), reactive to hover via `group-hover/gantt-bar-group:brightness-110` and to selection via `isSelected` (an `outline`, not another `ring`, so it can coexist with the AI-glow ring below without the two fighting over the same tailwind-merge color-conflict group). Rollup pills and milestones deliberately skip this backdrop (see below), so `classNames.event`'s neutralization — not a same-color no-op — is what keeps their track clean.
- **Progress overlay**: rendered by `SolvroBar` itself, black at `PROGRESS_OVERLAY_ALPHA` (imported from `frontend/src/lib/gantt/palette.ts`, never inlined), left-anchored, only when `0 < progress < 100`. ReUI's own built-in progress span (`gantt-bar.tsx`'s `data-slot="gantt-bar-progress"`) still exists in the DOM underneath but is fully opaque-covered by our backdrop + overlay, so it's inert rather than fought.
- **Milestones**: diamond (`rotate-45` square) + label, `data-milestone` + `data-task-id`. No solid backdrop — a milestone is a point-in-time marker, not a duration bar, so the surrounding (ReUI hands milestones a 1-day-wide event, not a zero-width one) day-slot stays visually empty around the diamond, matching the old engine's zero-width convention as closely as the new engine's non-zero-width events allow. **Fix pass (post-review)**: the diamond is `bg-primary`, not `bg-(--gantt-event-color)` — the brief's skeleton used the event color, but the old engine hardcodes the diamond to primary green with an explicit "not section color" comment (`GanttBar.tsx:318-320`); reverted to that parity across all colorBy modes. `frontend/src/components/gantt-v2/adapter.ts`'s `taskToEvent` now emits `progress: undefined` for milestones (was `progressForTask(...)` unconditionally) — a milestone has no progress bar, and without a covering backdrop ReUI's own built-in progress-tint span (`gantt-bar.tsx`'s `data-slot="gantt-bar-progress"`, gated only on `progress !== null`) was bleeding a translucent strip around the diamond for any milestone with partially-complete subtasks. Suppressing it at the adapter (the event source) rather than in `SolvroBar` kills it at that gate directly; the `taskToEvent`/`buildEvents` signatures the Task 2 lock covers are unchanged.
- **Rollup pills**: events whose id starts with `section-rollup-` render as a ~6px solid `rounded-full` pill in the event color (`h-1.5`, matching the old engine's `GanttSectionBar.tsx`'s `SUMMARY_BAR_HEIGHT = 6`), no label/progress/backdrop/interaction affordances, `data-rollup` attribute — no `data-task-id` (rollups carry no task).
- **AI-glow hook**: `(task as { blueprintId?: number }).blueprintId != null` → `data-ai-breakdown` + `ring-2 ring-chip-amber-text` (semantic chip-amber tokens, no raw `amber-*`). `Task` has no `blueprintId` field yet (Secure Ingestion Port is still "not yet built" per CLAUDE.md), so this is always false today; the conditional stays live so the hook activates with zero further changes once that ships.
- **`data-task-id`**: every task bar's content root carries it (milestones included); rollup pills carry `data-rollup` instead, per the task brief.
- **Labels vs. GH #58 — label path taken**: confirmed by reading `gantt-view.tsx` directly (`AUTO_LABEL_MIN_REM = 7` at line 202, the comparison itself at lines 3210-3216) that ReUI's `barLabel="auto"` flip compares the bar's *rendered width* against a flat rem threshold — it never measures the title text, so a short title on a narrow bar can flip outside while a long title on a "wide enough" bar stays inside and clips. This is the width-threshold case the task brief predicted. **Path taken: replace, not tune.** `SolvroGantt.tsx` passes `barLabel="inside"` (already the engine default, made explicit) so `gantt-view.tsx`'s row never computes or renders its own outside-label sibling at all; `SolvroBar` decides and renders 100% of the inside/outside placement itself, every render. Fit is a real measurement: an invisible `nowrap` measurer span (real DOM, real font) reports the title's true rendered width, and a `ResizeObserver` on the bar's content row reports the actual available width, re-checked on resize, on title change, and once webfonts finish loading. This is a deliberate adaptation of the old engine's approach (`frontend/src/components/gantt/GanttBar.tsx:34-74`, offscreen-canvas `measureText` + a hardcoded font string + a width cache) rather than a literal port: ReUI's `renderEvent` is never handed the bar's pixel width the way the old engine's explicit geometry was, so a DOM-measured overflow check standing in for the canvas approach avoids needing a font-string constant that could drift from the actual rendered CSS. The luminance-based inside-text-color picker (`hexLuminance`/`insideLabelTextColor`, old `GanttBar.tsx:60-74`) is ported verbatim. The outside variant always renders after (to the end side of) the bar with a fill-colored connector dot, matching the old engine's own always-after placement (it never implemented ReUI's near-edge flip either, so no parity is lost) — escaping the bar's clipped box is only possible because `classNames.event` also flips `overflow-hidden` to `overflow-visible`.
- `frontend/src/components/gantt-v2/SolvroGantt.tsx`: wiring only — imports `SolvroBar`, adds `renderEvent`, `classNames={{ event: SOLVRO_EVENT_CLASSNAMES }}`, and `barLabel="inside"` to the `<Gantt<Task>>` element. No other changes.
- Old engine (`frontend/src/components/gantt/GanttBar.tsx` and siblings) and every vendored `frontend/src/components/reui/gantt/*` file are untouched, per this task's scope. `frontend/src/components/gantt-v2/adapter.ts` (Task 2's file, otherwise out of this task's stated scope) picked up the one-line milestone-progress fix above — a source-level fix, not a scope creep, since `SolvroBar` has no way to suppress ReUI's built-in progress span short of the event never carrying a progress value in the first place.
- Gates: `docker compose exec frontend npm run typecheck` — 0 errors. `docker compose exec frontend npm run build` — succeeds. Dev server module transform verified directly (`curl` against the Vite dev endpoint for both changed/new files returns valid compiled JS). Full in-browser visual verification (solid bars across all three Color-by modes, diamond milestones, progress overlay, inside/outside label flip, AI-glow dormant check) was not performed — no browser-automation tool was available in this session; recommend a manual/Playwright pass before merge.

### Added — 2026-07-24 — `SolvroGantt` container mounted at `/projects/:id/gantt` (Plan B Task 3)

- New `frontend/src/components/gantt-v2/SolvroGantt.tsx`: the ReUI-engine container consuming Task 2's adapter (`buildResources`/`buildEvents`/`buildRollupEvents`, merged into one `events` array so section rows carry a read-only rollup pill) and the vendored `Gantt`/`GanttView`. Owns `colorBy`/`scale`/`showBaseline` state. `frontend/src/pages/views/ProjectGantt.tsx` now mounts `SolvroGantt` instead of `GanttFrame` (identical props, `hidden md:block` wrapper unchanged) — this is the first time the ReUI engine is live on a route. `GanttFrame.tsx`/`GanttChartPane.tsx`/`GanttListPane.tsx`/`GanttListRow.tsx` are untouched and still exist (deletion is Task 9).
- New `frontend/src/components/gantt-v2/TreeCells.tsx`: `TaskDatesCell`/`SectionColorCell`, the tree-pane inline editors mounted via ReUI's `GanttColumn` render-prop contract. `TaskDatesCell` reuses the shared `InlineDateRangeEditor` (`frontend/src/components/InlineDateRangeEditor.tsx`) as-is — it was already a standalone component, so it's imported rather than copied. `SectionColorCell` reproduces the section color-picker popover that used to be inline JSX in `GanttListRow.tsx:151-194` (now its own small component, same markup/classNames, same `SECTION_COLOR_PRESETS` swatches). Dates commit via `useUpdateTask`, color picks via `useUpdateSection`.
- Ported from `GanttFrame.tsx` verbatim: the `canEdit = hasPermission(user, "task:write")` gate, the Color-by `localStorage` key (`solvro.gantt.colorBy`) incl. its actual runtime default of `"section"` (the task brief's skeleton stated a `"status"` default, which disagreed with the shipped `GanttFrame.tsx` behavior — verbatim porting was chosen so existing users' stored picks and first-run visuals don't regress), the zoom-pill toolbar (Day/Week/Month/Quarter), the legend capped at 6 entries with a "+N more" chip, the baseline lock/reset/clear flow (`ConfirmModal` + toast), and the `+Task`/`+Section` toolbar affordances.
- `"(No section)"` (with parens) is applied at the UI layer via a `renderResourceLabel` override keyed on `resource.id === sectionNodeId(null)` — the adapter's internal orphan-group node title stays the plain `"No section"` sentinel Task 2 shipped; only the display label is overridden here, so the two layers can't drift out of sync independently.
- Adaptations from the brief's skeleton (real ReUI API vs. sample code): `yearsCoveredBy` is re-derived from the adapter's Date-valued events' min/max year rather than porting the old geometry module's padded `chartStart`/`chartEnd` window (ReUI has no such upfront window — it scrolls infinitely). The "Today" button calls the engine's own `apiRef.current.today()` instead of the old manual `scrollTo` math. `weekStartsOn={1}` (Monday) is passed explicitly to match `geometry.ts`'s `startOfMondayWeek`, which the engine doesn't default to. `rowCheckboxes` and the floating `zoomControl` (both ReUI defaults-on features with no equivalent in the old design) are turned off to avoid introducing undesigned UI ahead of a DESIGN.md pass. Single-click on a task bar or tree row now opens the task editor directly (`onEventClick`/`onResourceClick` → `onEditTask`) — core "click a task to edit" functionality the old engine had that isn't itself called out in the brief's parity list but is required for the view to be usable.
- **Deferred to later Plan B tasks, explicitly not wired here**: `onEventUpdate`/`onResourceReorder` (Task 5) — `interactions.drag`/`resize` are left on (`canEdit`-gated) since `events` is a controlled prop, so an unwired drag/resize gesture shows its live preview but reverts on release rather than mutating anything; baseline ghosts/ TaskDependency connector arrows (Task 6) — the `showBaseline` toggle state lives here but has no visual effect yet, and `useProjectDependencies` is called (cache-warming only, result unused) rather than omitted, matching this task's stated consumed-hooks list. Export (Excel/PDF, Task 7) is a disabled toolbar stub with a tooltip rather than omitted, so the toolbar doesn't visually regress ahead of that task.
- **Accepted deviation**: the old engine shaded weekends only at Day/Week zoom while holidays shaded at all zooms (`GanttColumnGrid.tsx:41-61`); ReUI's `offDays` config is zoom-uniform, so both now shade at every zoom level.
- Gates: `docker compose exec frontend npm run typecheck` — 0 errors. `docker compose exec frontend npm run build` — succeeds (`tsc -b && vite build`, PWA precache regenerated). Dev server module transform verified directly (`curl` against the Vite dev endpoints for both new/changed files returns valid compiled JS, no transform errors). Full in-browser interaction verification (drag, click-to-edit, popovers, zoom, legend) is Task 8/the controller's job — not done here.

### Added — 2026-07-24 — Gantt v2 data adapter (Plan B Task 2)

- New `frontend/src/components/gantt-v2/adapter.ts`: pure `Task`/`Section` (from `@/lib/queries`) → ReUI `GanttResource`/`GanttEvent<Task>` mapping layer, no React, no side effects. Exports `taskNodeId`/`sectionNodeId`/`parseTaskId` (shared `task-<id>`/`section-<id>` id scheme for the future container, overlay, and e2e specs), `buildResources` (section groups → top-level task nodes → subtask children, ordered by `position`/`id`), `taskToEvent`/`buildEvents` (task → bar), `buildRollupEvents` (one synthetic read-only pill per section spanning its children's date range, parity with the old engine's `GanttSectionBar`), and `eventPatch` (ReUI drag/resize result → Solvro `{ startDate, dueDate }` patch).
- **The adapter is the single owner of the inclusive/exclusive date boundary**: Solvro `Task.dueDate` is inclusive (a task due "2026-07-03" occupies that whole day); ReUI `GanttEvent.end` is exclusive. `taskToEvent`/`buildRollupEvents` add one day going in (`addDays(parseISO(dueDate), 1)`), `eventPatch` subtracts one day coming out (`addDays(update.end, -1)`) before formatting back to `yyyy-MM-dd`. Due-only and start-only tasks anchor a 1-day bar on whichever date is present (carried over from `geometry.ts`'s due-only rule); tasks with neither date produce no event. `progressForTask` (bar completion overlay) exported from `frontend/src/lib/gantt/geometry.ts` (was module-private) and reused as-is rather than duplicated.
- Deviation from the task brief's sample code: replaced the module-level mutable `cachedChildren`/`progressForTaskSafe` pattern with a pure `buildChildrenById(tasks)` helper threaded through `taskToEvent`'s new 5th parameter — avoids a shared-mutable-state hazard across concurrent/re-entrant calls. `taskToEvent` was not in the brief's locked "exact signatures later tasks rely on" list, so this is a safe, non-breaking adaptation; all seven locked signatures (`taskNodeId`, `sectionNodeId`, `parseTaskId`, `buildResources`, `buildEvents`, `buildRollupEvents`, `eventPatch`) are unchanged from the brief.
- Not yet wired into any route/component — Task 3 (`SolvroGantt` container) is the first consumer. `docker compose exec frontend npm run typecheck` and `npm run build` both pass.

### Added — 2026-07-24 — ReUI Gantt vendored + `ui/*` primitives ported to Base UI (Plan B Task 1)

- Vendored via `npx shadcn@latest add @reui/gantt` into `frontend/src/components/reui/gantt/`: `gantt.tsx`, `gantt-bar.tsx`, `gantt-dnd.tsx`, `gantt-i18n.tsx`, `gantt-lib.tsx`, `gantt-nav.tsx`, `gantt-recurrence.tsx`, `gantt-types.tsx`, `gantt-view.tsx` (9 files, exactly as expected). New npm deps: `@base-ui/react@1.6.0`, `@date-fns/tz@1.5.0` (`date-fns@4.4.0` already present from Plan A Task 4). `frontend/components.json` picked up two CLI-added keys (`"iconLibrary": "radix"`, a `registries.@reui` entry) as an unavoidable side effect of the `add` command.
- Replaced all 13 `IconPlaceholder` (`@/app/(create)/components/icon-placeholder`, a ReUI demo-app-only component not present in this repo) usages across the 3 files that imported it (`gantt-nav.tsx` ×4, `gantt-bar.tsx` ×2, `gantt-view.tsx` ×7) with inline `<svg>` markup using the exact path data of the corresponding `lucide-react@1.26.0` icon — `currentColor` stroke, same `className`/`aria-hidden` as the original slot, no shared icon module added.
- **Decision (2026-07-24, user-approved): `frontend/src/components/ui/*` primitives moved from Radix to Base UI.** First pass at this task hit 23 TS errors at the primitive seam: the vendored Gantt source composes `Button`/`Tooltip`/`Popover`/`DropdownMenu`/`ContextMenu` via Base UI's `render`-prop pattern (`useRender`/`mergeProps` from `@base-ui/react`), but the Plan-A-Task-4 primitives were Radix-`asChild`-based (confirmed byte-identical to `@reui/gantt`'s own registry copies via `shadcn add --diff` — an inconsistency in the upstream registry item itself, not this vendoring step). Since nothing in Solvro app code consumed `ui/*` yet, the fix was to rewrite the primitives rather than patch the vendored source: `button.tsx`, `tooltip.tsx`, `popover.tsx`, `dropdown-menu.tsx`, `context-menu.tsx`, `checkbox.tsx`, `scroll-area.tsx` now wrap `@base-ui/react/{button,tooltip,popover,menu,context-menu,checkbox,scroll-area}` behind the same exported component names and semantic-token class strings as before. `calendar.tsx` is unchanged (still `react-day-picker`-based) and typechecks against the new `button.tsx` unmodified. `radix-ui` removed from `package.json`/`package-lock.json` (host + container) — single behavior stack now (`@base-ui/react` only).
  - Data-attribute selectors were rewritten to Base UI's presence-based model (confirmed via `@base-ui/react` source, not guessed): Radix's `data-[state=open]` / `data-[state=closed]` → `data-open` / `data-ending-style` (the transient unmount-grace attribute, the precise analog of Radix's "still mounted while closing" window); Radix's real-DOM-focus-driven `focus:` menu-item highlight → Base UI's `data-highlighted` (Base UI menus track the active item via a data attribute, not native focus); submenu-trigger's `data-[state=open]` → `data-popup-open`; checkbox's `data-[state=checked]` → `data-checked`. `data-[side=...]`/`data-[align=...]` and the `origin-(--radix-*-transform-origin)` CSS var needed no semantic change beyond the var name (→ `--transform-origin`, Base UI's equivalent) — both frameworks use the same attribute names/values there. Verified in the built CSS (`dist/assets/index-*.css`): all rewritten selectors compile to real rules (`data-highlighted` ×14, `data-open` ×6, `data-ending-style` ×6, `data-popup-open` ×4, `data-checked` ×8, `data-side=bottom/left/right/top` present, `transform-origin:var(--transform-origin)` present) and every consumed semantic token (`bg-popover`, `bg-accent`, `bg-destructive`, `bg-primary`, `border-input`, `bg-foreground`, `text-muted-foreground`, `bg-border`, etc.) still resolves — no theme regression.
  - API-surface deltas vs. the Radix versions (documented, none consumed elsewhere in the repo yet): `Button`'s `asChild` prop dropped in favor of Base UI's native `render` (same idiom, `buttonVariants` cva export unchanged — `calendar.tsx` still imports it). `PopoverAnchor` dropped (Base UI has no direct equivalent part; was unused). `PopoverTitle`/`PopoverDescription` upgraded from plain styled `<div>`/`<p>` to Base UI's real `Popover.Title`/`Popover.Description` (adds automatic `aria-labelledby`/`aria-describedby` wiring — a strict a11y improvement, same visual classes).
  - Three pre-existing issues in the vendored Gantt source itself (not ui/* primitives) were authorized as local patches, each marked `// SOLVRO PATCH (Base-UI swap, 2026-07-24): ...` for future `shadcn add @reui/gantt --overwrite` re-pulls: `gantt-lib.tsx` — removed unused `PackedPosition` interface (TS6196 under this repo's `noUnusedLocals: true`); `gantt.tsx` — removed unused `ComponentType` import (TS6133, same cause); `gantt.tsx:1647` — `apiRef.current = instance.api` cast locally (`RefObject<GanttApi<TData> | null>`'s `.current` is typed read-only for consumers, but this effect is the component's own intended writer of the imperative handle — TS2540 upstream, a genuine type-declaration bug in the vendored source, not a Base-UI-swap side effect).
- **Gates, all green**: `docker compose exec frontend npm run typecheck` — 0 errors (was 23). `docker compose exec frontend npm run build` — `tsc -b && vite build` succeeds, same output CSS/asset hashes across repeat runs (deterministic). No edits outside `frontend/src/components/reui/gantt/` (3 `SOLVRO PATCH` sites only) and `frontend/src/components/ui/*` (7 files rewritten, `calendar.tsx` untouched).

### Changed — 2026-07-24 — Tailwind v4 exit gate passed (Plan A Task 5)

- Frontend typecheck + build, backend tsc, and the Playwright suite are green on Tailwind v4 (33 passed; 4 failed = `pwa.spec.ts` against the dev server, the documented vite-plugin-pwa caveat — `sw.js` confirmed generated at build; 1 flaky passed on retry, a seed-data precondition unrelated to the migration). Full visual sweep (all sidebar screens, dark + light, desktop + 375px) completed by the user: no regressions; fix-ups found: none. Plan B (ReUI Gantt swap) is unblocked.

### Added — 2026-07-24 — shadcn ui primitives for the Gantt swap (Plan A Task 4)

- Vendored via shadcn CLI into `frontend/src/components/ui/`: button, calendar, checkbox, context-menu, dropdown-menu, popover, scroll-area, tooltip (+ their npm peer deps: `radix-ui` ^1.6.5, `date-fns` ^4.4.0, `react-day-picker` ^10.0.1, `class-variance-authority` ^0.7.1, `lucide-react` ^1.26.0). Required imports of the ReUI Gantt (Plan B). Themed via the Task 3 semantic bridge, not per-file edits. `class-variance-authority` and `lucide-react` are imported by the generated components (`checkbox.tsx`, `context-menu.tsx`, `dropdown-menu.tsx`, `calendar.tsx`, `button.tsx`) but the shadcn CLI (v4.14.1) omitted them from `package.json`/`package-lock.json` — added by hand via `npm install` in the same change; `typecheck` and `build` fail without them. `components.json` and `frontend/src/index.css` were untouched by the CLI (Task 3's bridge already covered every semantic token the components needed) — verified via `git diff`.

### Added — 2026-07-24 — shadcn bootstrap (Plan A Task 3)

- `frontend/components.json`, `cn()` at `frontend/src/lib/utils.ts` (`clsx` + `tailwind-merge`), `tw-animate-css`, and a `@theme inline` bridge in `frontend/src/index.css` mapping shadcn semantic color names onto Technical Precision tokens (both themes). Reverses the 2026-07-22 "no shadcn stack" stance per the 2026-07-24 spec.

### Changed — 2026-07-24 — Theme ported to CSS-first `@theme` (Plan A Task 2)

- `frontend/tailwind.config.ts` deleted; all Technical Precision tokens (colors, +1px text scale, named type roles, `shadow-overlay`, sidebar/context-panel spacing, radius prohibitions) now live in a `@theme` block at the head of `frontend/src/index.css`, still routed through the existing `:root`/`.dark` RGB triplets. Dark mode is the `@custom-variant dark` class variant — `theme.tsx` unchanged. The Task 1 `@config "../tailwind.config.ts";` shim is removed in the same change (deleting either the shim or the config alone would break the build).
- Applied the deferred bare-class renames across `frontend/src/**/*.tsx` now that the v3-semantics shim is gone: `rounded` → `rounded-sm` (284 occurrences / 34 files), `shadow` → `shadow-sm` (7 occurrences / 4 files, e.g. `GanttBar.tsx`), `outline-none` → `outline-hidden` (77 occurrences / 20 files). Variant-prefixed forms (`md:rounded`, `focus:outline-none`, `hover:shadow`, …) renamed correctly; `rounded-full`, `rounded-sm` (pre-existing), `shadow-overlay`, and `flex-shrink` were left untouched (verified via before/after grep counts).

### Changed — 2026-07-24 — Tailwind v4 toolchain swap (Plan A Task 1)

- Frontend build moved to Tailwind CSS 4 via `@tailwindcss/vite` (`frontend/vite.config.ts`); `postcss.config.js`, `postcss`, `autoprefixer` removed (v4 handles both). Official upgrade codemod applied v4 canonicalizations across `frontend/src/` (`flex-shrink-0`→`shrink-0`, `break-words`→`wrap-break-word`, arbitrary-value cleanups like `z-[100]`→`z-100`, opacity fractions `/[0.04]`→`/4`). Bare `rounded`/`shadow`/`outline-none` were intentionally NOT renamed: the temporary `@config` shim keeps their v3 semantics for now — the renames land in the Task 2 theme port where the shim is removed.
- `frontend/src/index.css` carries a **temporary** `@config "../tailwind.config.ts";` compatibility shim alongside the new `@import "tailwindcss";` — needed because `@apply bg-background`/`@apply font-display` reference config-only custom utilities that v4 can't resolve without either this shim or the `@theme` port; the upgrade codemod crashes without it (`Cannot apply unknown utility class 'bg-background'`). Task 2 removes this shim together with `tailwind.config.ts` once the CSS-first `@theme` port lands — do not treat it as permanent.

### Changed — 2026-07-24 — Decision reversal: ReUI Gantt swap approved (docs only, no code change)

- The 2026-07-22 "skip shadcn / ReUI" decision is reversed: a full swap of the hand-rolled Gantt to ReUI's vendored Gantt is approved at full parity (dependency arrows, baselines, milestones, Excel/PDF export), with a full shadcn bootstrap and a Tailwind v3→v4 frontend migration as prerequisite. Grounded in a source-level audit of the ReUI component (shadcn registry pull, 9 files) that confirmed the original four feature gaps and surfaced the Tailwind v4 requirement. Spec and implementation plans live in `docs/superpowers/` (local-only; the directory is now gitignored with the rest of the planning layer — `.gitignore`). Local CLAUDE.md Facts and `docs/ideas/gantt-bar-reskin.md` amended accordingly.

### Changed — 2026-07-24 — Gantt bar labels placed by measured text fit (GH #58, plan Task 4)

- Gantt bar labels are now placed by measured text fit — a name renders inside its bar only when it fully fits (cached canvas measurement against the theme font), otherwise it floats outside with a fill-colored dot tying it to its bar and stronger `on-surface` text (was: arbitrary-looking 90px bar-width threshold, muted gray float) (`frontend/src/components/gantt/GanttBar.tsx`; GH #58). New spec `e2e/tests/gantt-bar-labels.spec.ts`. Excel/PDF export label rules intentionally untouched.

### Changed — 2026-07-24 — Start Date before Due Date in the task form (GH #59, plan Task 3)

- Task form now asks for Start Date before Due Date, matching every other date-pair surface in the app (TaskPanel, inline Gantt editor, Timeline, exports) (`frontend/src/components/TaskFormModal.tsx`; GH #59).

### Fixed — 2026-07-23 — Comment text wraps inside its bubble (GH #57, plan Task 2)

- Comment text now wraps inside its bubble instead of painting past it and outside the 380px panel — user-generated prose standard is `whitespace-pre-wrap break-words`; long usernames truncate instead of pushing the timestamp out (`frontend/src/components/TaskPanel.tsx`; GH #57). Same latent fix applied to the customer and project description paragraphs (`frontend/src/pages/CustomerDetail.tsx`, `frontend/src/pages/ProjectDetail.tsx`). New spec `e2e/tests/comments.spec.ts`.

### Removed — 2026-07-23 — Dead `CommentThread` component (GH #57, plan Task 2)

- Dead `frontend/src/components/CommentThread.tsx` — exported but never imported; it duplicated the comment UI (with the same overflow bug) and risked being wired up unfixed.

### Fixed — 2026-07-23 — Label creation no longer submits/wipes the task form (GH #56, plan Task 1)

- Creating a label from inside the task drawer no longer submits the surrounding task form — `LabelPicker`'s creation UI was a `<form>` nested inside `#task-form`, and React's bubbling submit prematurely created the task, closed the drawer, and destroyed every in-progress field (`frontend/src/components/LabelPicker.tsx`; GH #56). The Add action is now a plain button + Enter handler.
- Task drawer no longer wipes in-progress input when its parent re-renders — the form-reset effect depended on the whole `props` object (fresh identity every render); it now depends on stable primitives only (`frontend/src/components/TaskFormModal.tsx`; GH #56).
- New regression spec `e2e/tests/task-form-labels.spec.ts` covering both paths (Add click + Enter) and, end to end, that a real "Create task" submit still creates exactly one task carrying both labels created during the draft.

### Changed — 2026-07-23 — Gantt "Color by" dropdown + sustained legend (plan Task 3)

- Gantt toolbar color control is now a labeled "Color by" dropdown (native select, theme tokens) replacing the unlabeled segmented buttons (`frontend/src/components/gantt/GanttFrame.tsx`).
- Gantt color legend is sustained in all three modes: Section mode now lists each section's name + resolved color (capped at 6 with "+N more"), and the legend is no longer hidden below 1024px (`GanttFrame.tsx`, `frontend/src/lib/gantt/palette.ts`).
- Section-color fallback resolution extracted to `resolveSectionColors()` in `palette.ts`, shared by `geometry.ts`'s buildRows and the new legend so bars and legend can never disagree (`frontend/src/lib/gantt/geometry.ts`).

### Added — 2026-07-23 — E2E regression coverage for the Gantt color-by legend (plan Task 3)

- `e2e/tests/gantt-legend.spec.ts` (new) — asserts the legend persists across Status/Section/Priority modes. Default `colorBy` is `"section"` (a pre-existing, unrelated 2026-07-20 decision), so the spec's initial assertion checks the select's value is `"section"` and the Section legend shows first — this is also the mode that previously rendered no legend at all.

### Changed — 2026-07-23 — SA optional end-to-end: frontend form, types, renderers, export (plan Task 2)

- New-project form no longer requires a Solution Architect — "No SA" is a valid choice, and edit mode can clear an existing assignment (`frontend/src/components/ProjectFormModal.tsx`, `frontend/src/lib/queries.ts`).
- Flipped `ProjectSummary.saId`/`sa`, `ProjectDetail.sa`, `OverviewProject.sa`, and `AdminProject.sa` to nullable, and `CreateProjectInput.saId`/`UpdateProjectInput.saId` to optional/nullable, matching Task 1's backend contract (`frontend/src/lib/queries.ts`).
- SA renderers are null-safe: project detail header and right sidebar omit the SA row, project cards drop the SA avatar, customer/admin tables show "—" when unassigned (`ProjectDetail.tsx`, `RightSidebar.tsx`, `Projects.tsx`, `CustomerDetail.tsx`, `Admin.tsx`).
- Report export packet omits the Solution Architect identity line when no SA is assigned — customer-facing output never prints a placeholder (`frontend/src/lib/export/projectExport.ts`).
- Consumer enumeration via `tsc --noEmit` after the type flip surfaced exactly these seven files — no additional consumers, no backend/shared type reach, so no other files needed the same treatment.

### Changed — 2026-07-23 — `Project.saId` is now optional (backend)

- `Project.saId` is now nullable — projects can exist without a Solution
  Architect (no SAs use Solvro yet). `POST /projects` no longer requires
  `saId`; `PATCH /projects/:id` accepts `saId: null` to clear an assignment
  (`backend/prisma/schema.prisma`, migration
  `20260722182449_optional_project_sa`, `backend/src/routes/projects.ts`).
  The SA foreign key is now `ON DELETE SET NULL` (was restrict) — deleting a
  user un-assigns them as SA instead of blocking the delete.
- Added `backend/test/projectSaOptional.test.ts` covering: create without
  `saId` → `saId: null` + `sa: null` on GET; create still accepts `saId`;
  PATCH `saId: null` clears an assigned SA; PATCH `saId` assigns one on a
  project created without it.

### Added — 2026-07-22 — E2E regression coverage for List + Gantt reorder; unified-task-ordering closing sweep (plan Task 6)

- `e2e/tests/list-dnd.spec.ts` (new) — desktop-project-only (mirrors
  `kanban-dnd.spec.ts`'s `test.skip(test.info().project.name !== "desktop",
  ...)` guard), asserting through the API exactly like `kanban-dnd.spec.ts`
  does. Three cases:
  - "cross-status reorder in one section sticks: Gamma onto Alpha" — drags
    Gamma's row onto Alpha's on `/projects/:id/list`; asserts via API that
    Gamma lands immediately before Alpha in the global (position, id)
    top-level order, and that every top-level task's status (read
    dynamically, not hardcoded) is unchanged by the reorder.
  - "status chip change keeps the slot: Beta status flips, order stays" —
    flips Beta's status via the List row's `StatusSelect` chip (a `<button>`
    showing the current `STATUS_LABEL`; clicking opens a dropdown of
    sibling `<button>`s for the other two labels) and asserts the sorted
    top-level id sequence is identical before/after, with only Beta's
    status changed. Reads Beta's *current* status via API rather than
    assuming the raw seed value ("TODO"): `seededProject` is a
    worker-scoped Playwright fixture, and when this worker also runs
    `kanban-dnd.spec.ts` first (default file ordering, single worker),
    that file's "cross-column drag: Beta -> In Progress column" case flips
    the *same* seeded project's Beta to `IN_PROGRESS` before this spec's
    tests start — confirmed by reproducing the failure with `git stash`
    against the pre-Task-6 commit (identical failure, so unrelated to this
    diff) and by inspecting per-attempt Playwright artifacts (the failing
    attempt's precondition read `IN_PROGRESS`; a same-worker retry that
    happened to land on a freshly-seeded worker read `TODO` and passed).
    Hardcoding "TODO" was a false assumption about fixture isolation, not
    a real product precondition, so the test now derives its target status
    from whatever Beta's status actually is. Also replaced a fixed
    `page.waitForTimeout(1000)` after the chip click with
    `expect.poll(...)` against the tasks API so the assertions wait for the
    PATCH to actually land instead of a guessed sleep.
  - "gantt row drag: reorder sticks, dates untouched" (same file, not a
    separate spec — keeps the shared local helpers in one place) — on
    `/projects/:id/gantt`, drags the globally-last top-level task's row
    (via its `aria-label="Drag handle"` grip) onto the globally-first
    task's row; asserts via API that the dragged task lands immediately
    before the target in the global order, and that its `startDate`/
    `dueDate` are byte-identical before/after (row drags never touch
    dates). The seed fixture (`e2e/fixtures/seed.ts`) already assigns every
    top-level task a date range at creation, so no extra setup PATCH was
    needed for this assertion to have teeth (explicitly asserted
    non-null before comparing).
  - Selector discipline: no `data-testid` added anywhere — List row grips
    reuse the same `aria-label="Drag to reorder"` + `gripFor` heuristic
    `kanban-dnd.spec.ts` already uses (List and Kanban grips happen to
    share that aria-label), Gantt row grips use their existing
    `aria-label="Drag handle"`, and the List status chip is located via a
    local `desktopRow()` helper — `page.locator('div[class*="grid-cols-"]',
    { hasText: title })` — exploiting the fact that only the column-header
    row and each desktop `TaskRow` grid div carry that arbitrary-value
    Tailwind class token (the mobile-card sibling the same component also
    renders does not), so it uniquely resolves the row without touching
    `ProjectList.tsx`/`GanttListRow.tsx`.
- Confirmed pre-existing, unrelated `pwa.spec.ts` failures (`manifest link
  is present`, `service worker registers`, desktop + mobile) reproduce
  identically against the pre-Task-6 commit (`git stash` verification) —
  a dev-server PWA registration quirk, not caused by this branch; left
  untouched per scope. (Mechanism: `vite-plugin-pwa` serves manifest/SW only
  in build/preview mode, so the spec structurally fails at `BASE_URL=5173`
  and passes on the built CI stack at `:8080`.)
- NFR re-check (200-task worst-case reorder PATCH, dev stack): Task 2's
  calm-host set passed at 0.196/0.132/0.118s; Task 6's re-checks measured
  0.20–0.47s — but every over-budget sample was taken at host load 6–15 on
  an 8-core Mac with all three containers idle (<1% CPU), i.e. host
  contention from the CI/e2e churn itself, not endpoint cost. Recorded
  honestly rather than re-rolled; surfaced to the user per the plan's
  hard-stop rule (2026-07-22) and carried forward on the calm-host set as
  the working verdict — re-time on a quiet host before any release
  decision if in doubt. Follow-up optimization
  (batch the dense repack's per-row UPDATEs into one SQL statement) filed in
  ISSUES.md in case real-world use ever feels slow.

### Changed — 2026-07-22 — `Task.position` doc comment updated for the global top-level order (plan Task 6)

- `backend/prisma/schema.prisma` (`Task.position` doc comment) — rewritten
  to describe the model landed in plan Tasks 1–2: for top-level tasks
  (`parentTaskId` null) the sibling list is the project's single dense
  top-level order (`projectId` alone, status does not partition it, so a
  status change keeps the task's slot); subtasks are unchanged (parent's
  subtask list). The previous comment still described the removed
  per-`(projectId, status)` sibling model (queued in ISSUES.md from plan
  Task 2). Comment-only — `npx prisma migrate diff` against the live dev
  DB confirms an empty migration (no schema drift), and `git diff` shows
  only comment lines changed.

### Added — 2026-07-22 — Gantt list pane: between-row drag reorder (plan Task 5)

- `frontend/src/components/gantt/GanttListRow.tsx` — task and subtask rows
  are now draggable AND droppable (previously only section headers were
  drop targets; task rows could be dragged but had nowhere to land other
  than a section header, and subtask rows couldn't be dragged at all).
  Closes the "cannot drag at all" symptom from the original bug report.
  Dropping on a row shows a top-edge insertion indicator (`bg-primary`
  2px bar as the row's first child; the row root gained `relative` to
  host it). The existing `isOver && isSection` ring affordance for
  section-header drops is unchanged. The indicator is gated to row drags
  only — `showRowInsertIndicator = isOver && !isSection &&
  activeDragKind !== "section"`, reading the active drag's kind off
  `droppable.active?.data.current` — so a section dragged over a task row
  (a no-op drop, per `GanttFrame.handleDragEnd`) doesn't light a
  misleading affordance.
- `frontend/src/components/gantt/GanttFrame.tsx` — added
  `useSensor(KeyboardSensor)` to the Gantt's `DndContext` sensors
  (previously PointerSensor-only, so the row drag handles — which already
  get `role`/`tabIndex` from `draggable.attributes`, per
  `GanttListRow.tsx`'s `{...draggable.attributes}` spread — were
  keyboard-dead). Uses dnd-kit's default `coordinateGetter`, not
  `sortableKeyboardCoordinates`: that getter targets `SortableContext`,
  which the Gantt deliberately doesn't use (raw `useDraggable`/
  `useDroppable` throughout, per Task 5's design) — the default arrow-key
  stepping works against plain droppables.
- `RowDragData`/`RowDropData` (same file, `:24-33`) extended: `RowDragData`
  gains `"subtask"` to its `kind` union plus a `parentTaskId: number |
  null` field (populated from `row.task?.parentTaskId`, `null` for
  section/top-level-task rows); `RowDropData` becomes a discriminated
  union — the existing `{ kind: "section-target"; sectionId }` plus a new
  `{ kind: "row-target"; taskId; parentTaskId; sectionId }`.
- `frontend/src/components/gantt/GanttFrame.tsx` `handleDragEnd`
  (`:409-535`) — new `row-target` branch, added before the existing
  `section-target` early-return, mirroring `ProjectList.tsx`'s
  `handleDragEnd` (plan Task 3) variable-for-variable so the two are
  diffable by eye:
  - Task row dropped on a task/subtask row: a subtask over-row resolves
    to its parent (`overData.parentTaskId ?? overData.taskId`) so the
    drop isn't a silent no-op; `topLevelOrdered` = every top-level task
    sorted `(position, id)`; insert index = the over row's pre-move
    index in that list (moved-INCLUSIVE — arrayMove/insert-before
    semantics matching the top-edge indicator); patches `{ position }`
    same-section or `{ sectionId, position }` cross-section; no-op guard
    when neither the section nor the index actually changes.
  - Subtask row dropped on a row: reorders WITHIN the parent only (List
    parity — no re-parenting via Gantt row drags); requires
    `overData.parentTaskId === moved.parentTaskId`, else returns;
    siblings = the parent's other subtasks sorted `(position, id)`;
    patches `{ position }`.
  - Bars, dates, dependency arrows, baselines, and the section-reorder
    branch are untouched.

### Changed — 2026-07-22 — Gantt section-header drop now appends at section end (plan Task 5)

- `GanttFrame.tsx`'s existing task-on-section-header branch (still gated
  on `overData.kind === "section-target"`) no longer patches bare
  `{ sectionId }`. It now adopts the corrected append-at-section-end rule
  landed in `ProjectList.tsx` (plan Task 3's correction, not the plan's
  original pre-correction block): `topLevelOrdered` filtered to `others`
  (moved task excluded), `block` = that section's tasks within `others`,
  and if non-empty, patch `{ sectionId, position: others.findIndex(last)
  + 1 }` — indexing into the moved-EXCLUDED list because backend
  `insertAt` excludes the moved row before clamping, so indexing the
  moved-INCLUSIVE list would overshoot by one slot whenever the task's
  old position precedes the target section. An empty target section still
  patches `{ sectionId }` only (nothing to append after). Same-section
  early return preserved.
- No changes to `frontend/src/lib/gantt/geometry.ts` — verified by
  reading `buildRows`: `parents = group.filter(t => t.parentTaskId ===
  null)` and the subtask loop over `childrenById.get(p.id)` are plain
  `Array.prototype.filter`/iteration over `tasks`, which preserves the
  fetched `(position, id)` order end to end (the project tasks route
  orders `[{ position: "asc" }, { id: "asc" }]` — `backend/src/routes/
  projects.ts:331/418`), so section groups already render the canonical
  order with zero changes needed here.

### Changed — 2026-07-22 — Kanban speaks the global sibling order; e2e assertions follow (plan Task 4)

- `frontend/src/pages/views/ProjectKanban.tsx` `computeCardDrop` (~:256-322)
  — rewritten to compute every drop index against the project's single
  global top-level order (`globalOrdered`, sorted `(position, id)` over
  `topLevelAll`) instead of the old per-status `groupedAll[status]` list,
  mirroring Task 1's backend re-scope and Task 3's List-view drop math. Two
  branches, deliberately asymmetric (same as `ProjectList.tsx`'s
  header-drop vs. row-drop, and commented the same way):
  - Column-body drop (`isColumnId`) = "append after the column's last
    card." Indexes a **moved-excluded** `globalOthers` list
    (`globalOthers.findIndex(last) + 1`) to match backend `insertAt`,
    which excludes the moved row from the sibling list before clamping.
    An empty target column returns `{ status }` with no `position` —
    status-only patch, the card keeps its global slot.
  - Card drop (`isCardId`) = arrayMove semantics, **moved-inclusive**
    (`globalOrdered.findIndex(overTask)`) — unchanged reasoning from
    before, just against the global list instead of the per-column one.
  - Return type is now `{ status: TaskStatus; position?: number } | null`
    — `position` absent means "status-only, keep the slot."
- `handleDragEnd`'s card-drop guard/patch (~:335-352) — optional-position
  aware: the early-return no-op guard now short-circuits on `drop.position
  === undefined` (status unchanged case) in addition to the old
  `position` match; the mutation patch omits `position` entirely when
  `drop.position` is `undefined` so a same-status card drag never fires,
  and a cross-status drop onto an empty column sends `{ status }` only
  (no repositioning PATCH).
- Mobile move sheet's `onMove` (~:660-680) — no longer computes
  `groupedAll[status].length` inline; now calls `computeCardDrop(task.id,
  idOf("column", status))` and applies the same optional-position patch
  shape, so the "append to end of column" rule has exactly one
  implementation instead of two that could drift.
- `groupedAll`'s doc comment updated: the invariant is now "drop-position
  math MUST use the GLOBAL sorted order," not "the real per-status
  sibling list" (that model no longer exists — see Task 1). `groupedAll`
  itself stays: it's still needed to find each column's boundary card and
  to render columns.
- Subtask drag handlers (`handleSubtaskDrop`, `submitSubtaskPatch`,
  ~:363-423) — untouched, out of scope for this task (per-parent
  sibling lists, which Task 1 never changed).
- `e2e/tests/kanban-dnd.spec.ts` — absolute-position assertions replaced
  with relative-order ones now that `position` is a global index, not a
  per-column one: added a `columnOrder(tasks, status)` helper (filters to
  a status + top-level, sorts `(position, id)`, maps to titles). "reorder
  within column" now asserts `Gamma` sorts before `Alpha` in the TODO
  column instead of pinning `position === 0`. "cross-column drag" keeps
  its status assertion and adds that `Beta` lands **last** in the
  IN_PROGRESS column order, matching the column-body-drop = end-of-column
  rule. Subtask-case and mobile-touch-case assertions are unchanged (not
  in scope — their fixture layout keeps the pre-existing assertions valid
  under the new global model; verified, not just assumed, via a full
  local Playwright run).
- Correction to the above (same task, caught by QA before commit): the
  "subtask drag handlers untouched" bullet was wrong for one branch —
  `handleSubtaskDrop`'s promote-to-top-level path (`isColumnId(overId)`,
  previously ~:395-399) still patched `position: groupedAll[status].length`,
  a correct *per-status-list* append index under the old model but a
  *global* index under the new one: promoting a subtask into a column with
  N existing cards landed it near the FRONT of the project's global order
  (global slot N), not at the end of that column. The reparent
  (`isCardId`) and reorder-within-parent (`isSubtaskId`) branches were
  genuinely fine — per-parent subtask lists are unchanged by Task 1 — only
  the promotion branch crosses into the top-level list. Fixed by extracting
  `columnEndPosition(status, excludeId)` (~:256-283), shared by
  `computeCardDrop`'s column-body branch (`excludeId` = the dragged card's
  id, since it's already a row in `topLevelAll`) and the promote branch
  (`excludeId = null`, since the subtask isn't a top-level row yet — the
  moved-excluded and moved-inclusive views are identical there, so no
  exclusion filter is needed or applied). Non-empty target column: global
  append-after-last-card index, same math as the card-drop case. Empty
  target column: `position` omitted entirely (`{ parentTaskId: null,
  status }`) — backend `insertAt` then appends to the end of the whole
  project's top-level order, which is well-defined for a column with no
  card to anchor after. Traced the optimistic path
  (`frontend/src/lib/queries.ts` `reorderTasksLocally`) for parity with
  this backend behavior in both cases: a promotion's `oldListId`
  (`sub:<parentId>`) always differs from `newListId` (`"top"`), so
  `touchesOrdering` is always true regardless of `position`; on the "top"
  list, `reorderTasksLocally`'s own clamp (`patch.position === undefined ?
  newSiblings.length : ...`) mirrors `insertAt`'s identically, and because
  the promoted subtask was never a member of the top-level sibling group to
  begin with, `newSiblings` there is already the moved-excluded list — no
  edit to `reorderTasksLocally` was needed. `e2e/tests/kanban-dnd.spec.ts`'s
  "subtask promote" case extended: snapshots the other top-level tasks'
  `(position, id)` order via the API immediately before the drag (the
  worker-scoped `seededProject` carries mutations from earlier cases in the
  same file, so the original seed order can't be assumed current), asserts
  the promoted task lands last in `columnOrder(tasks, "DONE")`, and asserts
  that snapshot is unchanged after the promotion — the assertion the stale
  per-column-length math would have failed (it would have inserted near the
  front, reshuffling the others). Re-ran frontend typecheck (exit 0) and
  the full local `kanban-dnd.spec.ts` + `smoke.spec.ts` Playwright pass
  (17 passed, 11 expected skips, 0 failed) after this fix.
- Correction to the above (same task, caught by reviewer before commit):
  overclaimed what the "subtask promote" e2e case's existing assertions
  actually pin. With DONE empty at that point in the worker sequence, "last
  in `columnOrder(tasks, "DONE")`" is trivially true for the only DONE card
  under both the buggy and the fixed code, and the "other top-level tasks'
  relative order unchanged" snapshot does NOT catch the defect either —
  inserting one element via `splice` never permutes the relative order of
  the pre-existing elements regardless of the insertion index, so both
  `position: 0` (buggy) and "append at global end" (fixed) leave that
  snapshot identical (traced concretely: buggy global order ends up
  `[Sub two, Gamma, Alpha, Delta, Beta]`, fixed ends up `[Gamma, Alpha,
  Delta, Beta, Sub two]` — same relative order for the other four either
  way). Added the assertion that actually distinguishes them: the promoted
  task must be last in the GLOBAL top-level order
  (`tasks.filter(parentTaskId === null).sort(position, id)`), not merely
  last within its own column. Both prior assertions are kept (harmless,
  documentation value) but the test comment and this changelog block are
  corrected to not overclaim what they cover. Re-ran the full local
  `kanban-dnd.spec.ts` + `smoke.spec.ts` Playwright pass after adding the
  global-order assertion: 17 passed, 11 expected skips, 0 failed — the
  "subtask promote" case (now including the defect-pinning assertion)
  still passes against the fixed code.

### Fixed — 2026-07-22 — List view drags no longer snap back (plan Task 3)

- `frontend/src/pages/views/ProjectList.tsx` `handleDragEnd` — the two
  top-level drop branches (section-header drop, row drop) previously
  computed the drop index against a same-section/same-status subsequence,
  a leftover from the old per-`(project, status)` sibling key. Since Task 1
  re-scoped top-level `position` to one dense per-project list, that index
  no longer matched what the backend's `insertAt` expected, so the row
  would land in the wrong slot and the next refetch (or the very next
  optimistic pass) would appear to snap it back — the original bug report
  symptom. Fixed by computing drop position against `topLevelOrdered`
  (the full project top-level list sorted by `(position, id)`), mirroring
  the backend exactly: header/empty-group drop appends after the target
  section's last task in that global order (or is a section-only move,
  keeping slot, if the section is empty); row drop inserts at the over
  row's pre-move global index, carrying `sectionId` along only on a
  cross-section drop. The subtask branch (reorder within parent) and the
  row-dropped-on-subtask resolve-to-parent step were untouched — both
  already used the parent-scoped sibling list Task 1 didn't change.
- Correction to the above (same task, caught before commit): the initial
  header-drop append index was computed against the *moved-inclusive*
  `topLevelOrdered` list, one index space off from what `insertAt` expects
  (moved-excluded) — this overshot by one slot whenever the dragged task's
  old position preceded the target section, landing it past the next
  section's first task instead of at the target section's end. Fixed by
  indexing a moved-excluded `others` list instead; verified with a
  standalone repro script for both the drag-down (previously broken) and
  drag-up (previously correct, still correct) directions.

### Changed — 2026-07-22 — List view + optimistic layer speak the global sibling model (plan Task 3)

- `frontend/src/lib/queries.ts` `siblingListId` (~:580-582) — top-level
  tasks now map to a single sibling-list id (`"top"`) instead of
  `` `top:${status}` ``, mirroring Task 1's backend `SiblingKey` (status
  no longer partitions ordering). Doc comment above it rewritten to match.
  Signature keeps the `status` field in its `Pick<Task, ...>` parameter
  type so no call site needed to change. The `listChanged` check inside
  `useUpdateTask`'s `onMutate` needed zero edits — it's generic over
  `siblingListId`, so a status-only patch now computes
  `listChanged === false` and falls through to the plain field merge,
  which is exactly "keeps its slot" for the optimistic cache update,
  matching the backend's non-ordering PATCH branch.
- `frontend/src/lib/queries.ts` `reorderTasksLocally` — correction (same
  task, caught before commit): this one *did* need an edit, contrary to
  the plan's assumption. Its `Pick<UpdateTaskInput, ...>` patch type and
  merged `updatedTask` now also carry `sectionId` (previously only
  `status`/`parentTaskId` were applied on top of `current`). List view's
  new cross-section row drop and non-empty header drop both patch
  `{ sectionId, position }` together — a combination the pre-Task-3 code
  never produced — and without this, the optimistic cache kept the moved
  row under its *old* section (right position, wrong section) until
  `onSettled` refetched. `sectionId` still isn't part of `siblingListId`
  (unchanged — section never partitions ordering), so this only affects
  which section the row renders under, not the position math.
- `frontend/src/pages/views/ProjectList.tsx` — stale "per-section proxy
  ordering" comments (on the `grouped` memo at ~:135-140, and its
  cross-reference inside `groupBySection` at ~:1112) rewritten: `(position,
  id)` sort within a rendered section group is not a stand-in for a
  separate per-section order, it's the canonical global per-project order
  projected onto that section (position is unique per-project, not merely
  per-section).

### Changed — 2026-07-22 — Task index swapped to match the global sibling key (plan Task 2)

- `backend/prisma/schema.prisma:255` — `Task` index
  `@@index([projectId, status, position])` → `@@index([projectId, position])`.
  Why: Task 1 re-scoped the top-level sibling key from
  `(projectId, status, parentTaskId)` to `(projectId, parentTaskId)`; the hot
  list query (`(projectId, parentTaskId) ORDER BY position`) is now
  index-backed by the narrower composite instead of a stale
  status-prefixed one. The single-column `@@index([status])` (line 251)
  is untouched — Kanban/status filters still use it.

### Added — 2026-07-22 — Migration: index swap + section-major position repack (plan Task 2)

- `backend/prisma/migrations/20260722121825_unified_task_ordering/migration.sql`
  — generated non-interactively via `prisma migrate diff` (index DDL) with
  the plan's section-major repack `UPDATE` appended by hand. Drops
  `tasks_project_id_status_position_idx`, creates
  `tasks_project_id_position_idx`, then repacks every project's top-level
  `position` values into one dense `0..n-1` list per project so existing
  data satisfies Task 1's new semantics. Repack order: section `position`
  (tasks with no section sort last via `COALESCE(..., 2147483647)`), then
  the task's old `(position, id)` as a tiebreak — preserves today's List
  view appearance (section-major) even though positions were previously
  scoped per `(project, status)`. Applied via `prisma migrate deploy` +
  `prisma generate` + backend restart on the dev DB; verified via psql that
  every project's top-level tasks now have dense, gapless positions with
  zero anomalies, and spot-checked a real 4-section project
  (`Planning → Pre-Implementation → Implementation → Closing`, mixed
  statuses) landed at positions `0,1,2,3` in section order.
- NFR spot-check (plan Task 2 Step 5): seeded 200 top-level tasks into a
  scratch project, timed three worst-case reorder `PATCH`es alternating the
  last task between position 0 and 199 (full-list shift each time):
  `0.196s`, `0.132s`, `0.118s` — all under the 200ms budget (first includes
  connection warmup). Scratch project deleted after measurement (no
  `DELETE /projects/:id` route exists — Task API is create/read/update
  only — so cleanup went through a direct DB delete, which cascades to the
  project's tasks via the existing `onDelete: Cascade` FK; verified 0 rows
  remain for both). Scratch admin user (`nfr-scratch@example.com`)
  intentionally left in place for reuse by later plan tasks.

### Changed — 2026-07-22 — Top-level task ordering: status leaves the sibling key (plan Task 1)

- `backend/src/lib/taskOrdering.ts` — `SiblingKey` no longer carries a
  `status` field; `siblingWhere` and `siblingKeyEquals` re-scoped
  accordingly. A top-level sibling list is now every top-level task in the
  project (`(projectId, parentTaskId=null)`), one dense per-project manual
  order — exactly how subtask lists already work per-parent
  (`parentTaskId` alone). Status no longer partitions ordering anywhere; a
  status change (alone) keeps the row's slot instead of re-appending it to
  a destination "column."
- `backend/src/routes/tasks.ts` — `PATCH /tasks/:id`: dropped `status` from
  the `oldKey`/`newKey` `SiblingKey` construction (~line 150). A status-only
  patch now takes the non-ordering branch and keeps its position; combined
  `{status, position}` patches still land at the requested global index via
  the existing `touchesOrdering` branch. Updated the two comments this
  invalidated: the "status is part of the sibling key only for top-level
  tasks" note (now false for every task, not just subtasks) and the
  "must not stop genuine column moves" regression-guard comment.
- `backend/src/routes/projects.ts` — `POST /projects/:id/tasks`: dropped
  `status` from the create-path `countSiblings` `SiblingKey` (~line 369),
  so a newly created task appends to the single per-project list regardless
  of its initial status. (The plan text named this site as living in
  `tasks.ts`; it's actually in `projects.ts` — `tsc --noEmit` located the
  real construction site after the interface change.)
- Why: List and Gantt render top-level tasks grouped/filtered by section or
  date, not by status column — per-status positions interleaved three
  independent sequences there, making a manual cross-status order
  impossible to express or preserve. Re-scoping to one canonical
  per-project order (status changes keep the slot) matches how subtasks
  already behave and is required before the List/Kanban/Gantt drag layers
  (later plan tasks) can share one ordering model.
- `backend/test/taskOrdering.test.ts` — added a
  `describe("global top-level ordering (status does not partition)")` block
  (create-append across statuses, status-only patch keeps slot, explicit
  position patch reorders across statuses, combined status+position patch)
  per the plan's Step 1. Also updated two pre-existing tests that asserted
  the now-removed per-status top-level behavior and would otherwise fail
  against the new model: `"move across columns (status change)" > "appends
  to the end of the destination column..."` (renamed to `"does not move or
  re-pack any sibling on a status-only change"`, asserting the opposite of
  its old title) and `"status-only change and sibling ordering" > "still
  moves a top-level task to the destination column on a status change"`
  (renamed to `"keeps a top-level task's slot on a status-only change, same
  as a subtask"`). `backend/test/projectWipLimits.test.ts` asserts no
  per-column positions and needed no changes.
- Not fixed (pre-existing, out of scope): `taskOrdering.test.ts`'s
  `"orders GET /tasks (cross-project) by position asc, then id asc"` test
  fails independently of this change — the in-container `npm test` run
  points at the persistent dev Postgres (not an isolated disposable DB per
  the `globalSetup.ts` comment), which already holds hundreds of task rows
  accumulated from prior work on this branch. The cross-project `/tasks`
  endpoint's `take: 200` (ordered by `position asc, id asc`) is truncated
  before reaching this test's newly-created rows. Reproduced on the
  pre-change baseline run too, so it predates this task.

### Added — 2026-07-22 — Plan + kickoff prompt: unified manual task ordering

- `docs/plans/unified-task-ordering-plan.md` — six-task implementation plan
  for the ordering re-architecture (backend sibling-key change → index swap +
  section-major data repack migration → List + optimistic layer → Kanban +
  its e2e assertions → Gantt between-row drag parity → new e2e + docs sync).
  Contains the exact migration SQL, complete drop-math code per view, and
  the NFR stop condition (reorder PATCH < 200ms at ~200 tasks).
- `docs/prompts/unified-task-ordering.md` — orchestrator kickoff prompt:
  branch `feat/unified-task-ordering` off freshly-pulled `develop`, per-task
  agent pipeline, pre-approved per-task commits, hard stops (NFR miss,
  plan/reality drift, PR draft only — never opened).

### Added — 2026-07-22 — Idea doc: unified manual task ordering

- `docs/ideas/unified-manual-task-ordering.md` — refined from the drag
  bug report (List drags snap back, Kanban arrangements disturbed, Gantt
  rows not reorderable). Diagnosis: `Task.position` is scoped per
  `(projectId, status)` for top-level tasks, so only the Kanban column
  matches the display grouping; List/Gantt interleave three independent
  status sequences, and the Gantt has no between-row drop targets at all.
  Direction (user-confirmed): one canonical per-project order — re-scope
  top-level positions the way subtasks already work — status changes keep
  the slot, and the Gantt list pane becomes a full drag peer of the List
  view. No code changes yet; next step is a docs/plans implementation plan.

### Added — 2026-07-22 — Section rollup summary bars on the Gantt (plan Task 5)

- `frontend/src/components/gantt/GanttSectionBar.tsx` (+ `GanttRow.tsx` wiring):
  new `GanttSectionSummaryBar` — a 6px rounded pill on section header rows
  spanning the section's children date range (min one day-column) in the
  section's resolved color at 0.85 opacity. Renders for collapsed sections
  too; sections with no dated children render nothing. Existing 7% tint
  `GanttSectionBand` unchanged. `pointer-events-none` — no interaction
  changes.

### Added — 2026-07-22 — Task name labels on Gantt bars (plan Task 4)

- `frontend/src/components/gantt/GanttBar.tsx`: bars ≥ 90px wide render the
  task name inside the bar (10px, luminance-aware white/dark text, truncated);
  narrower bars float the name beside the bar's right edge in muted secondary
  text (nowrap, ~240px cap). `pointer-events-none` throughout — drag, resize,
  and connector interactions unaffected. Milestones unchanged (tooltip only).
  Exports draw their own labels and are untouched.

### Changed — 2026-07-22 — Solid Gantt bar fills with progress overlay (plan Task 3)

- `frontend/src/components/gantt/GanttBar.tsx` + `frontend/src/lib/gantt/palette.ts`:
  rendering model inverted. Bars now render solid in their Color-by color
  (was: 28%-opacity track via `BAR_TRACK_OPACITY`, solid only as progress
  filled — the root cause of the washed-out Gantt). Progress is now a darker
  left-anchored overlay (`rgba(0,0,0, PROGRESS_OVERLAY_ALPHA)`, only when
  0% < progress < 100%). `BAR_TRACK_OPACITY` removed (GanttBar was its sole
  consumer); `PROGRESS_OVERLAY_ALPHA = 0.28` added. Bar radius 3px → 4px.
  Screen/export color parity unchanged — exports were already solid-fill.

### Changed — 2026-07-22 — Deterministic vivid fallback for uncustomized section colors (plan Task 2)

- `frontend/src/lib/gantt/geometry.ts`: section color resolution now treats
  `null` / legacy schema-default `#94a3b8` as "never customized" and assigns
  a vivid preset (`SECTION_COLOR_PRESETS[index % length]`) by section
  position instead of flat slate. Explicitly stored custom colors always
  win; rows without a section keep `DEFAULT_SECTION_COLOR`. Single
  resolution point within the Gantt — Gantt list dots, bars, section bands,
  and Excel/PDF exports all inherit. Non-Gantt surfaces (ProjectList,
  Executive, TaskPanel) resolve `section.color` directly and still show
  slate for uncustomized sections — parity gap tracked in ISSUES.md.
  Accepted trade-off
  (per `docs/ideas/gantt-bar-reskin.md`): fallback hues can shift if
  sections are reordered — cosmetic only.

### Changed — 2026-07-22 — Gantt palette re-skin values (plan Task 1)

- `frontend/src/lib/gantt/palette.ts`: `STATUS_FILL_HEX` pastels → solid-intent
  hues (TODO `#94a3b8`, IN_PROGRESS `#3b82f6`, DONE `#10b981`);
  `PRIORITY_BORDER_HEX.LOW` `#94a3b8` → `#64748b` so LOW-priority is
  distinguishable from TODO-status; `SECTION_COLOR_PRESETS` replaced with a
  vivid dark+light-safe set that deliberately omits slate `#94a3b8` (kept as
  the never-customized sentinel for the Task 2 fallback). Hex-value changes
  only — no renames; Excel/PDF exports inherit immediately via `barFillHex`;
  on-screen bars stay 28%-opacity tracks until plan Task 3.

### Added — 2026-07-22 — Gantt bar re-skin planning docs; shadcn adoption declined

- `docs/ideas/gantt-bar-reskin.md` — refined idea for the stale-bar fix. Root
  cause: `BAR_TRACK_OPACITY = 0.28` in `frontend/src/lib/gantt/palette.ts`
  renders 0%-progress bars as 28%-opacity ghosts (exports already render
  solid via the shared `barFillHex`). ReUI Gantt swap evaluated and rejected
  (no dependency lines/baselines/milestones/export in its API; frontend has
  no shadcn stack). Includes a 1:1 before/after mockup artifact as visual
  spec.
- `docs/plans/gantt-bar-reskin-plan.md` — six-task paint-only implementation
  plan: new palette hues → vivid fallback for uncustomized section colors in
  `geometry.ts` (schema default `#94a3b8` treated as "unset" sentinel) →
  solid fills + progress overlay in `GanttBar.tsx` → task labels on bars →
  section summary bars → QA sweep. No new dependencies; backend/DB untouched.
- `CLAUDE.md` Facts: recorded the shadcn/ReUI decision (declined 2026-07-22;
  per-component vendoring policy for future hard primitives) under
  deferred/not-built items.
- `docs/prompts/gantt-bar-reskin.md` — kickoff prompt for executing the plan
  in a fresh session: solvro-* agent pipeline per task, strict task order,
  `feat/gantt-bar-reskin` off `develop`, one commit per task after gates
  (pre-approved in the prompt), hard stop before PR creation.

### Changed — 2026-07-21 — CI/CD hardening (Prisma CLI pinning, Node 22, gated publishing, typecheck gate)

- `prisma` moved from `devDependencies` to `dependencies` in
  `backend/package.json` (+ lockfile). The `runtime` Docker image installs
  with `npm ci --omit=dev` but runs `npx prisma migrate deploy && npx prisma
  db seed` at container start (CI stack and prod via `setup.sh`) and `npx
  prisma generate` at build — with the CLI absent, `npx` fetched the
  **latest** prisma from the registry, an unpinned major-version skew
  against `@prisma/client` 5.22 and a network fetch at container start.
  Now the pinned 5.22 CLI ships in the image.
- `backend/Dockerfile` and `frontend/Dockerfile`: `node:20-slim` →
  `node:22-slim`; `.github/workflows/ci.yml`: `node-version: 20` → `22`
  (three places). Node 20 reached end-of-life April 2026. Both runtime
  images build-verified locally on 22.
- `.github/workflows/docker-publish.yml`: publishing for `main` is now
  gated on CI — trigger changed from `push: branches: [main]` (which ran
  in parallel with CI, so a red build could still ship `latest` to GHCR)
  to `workflow_run` on the CI workflow's success. Builds check out
  `workflow_run.head_sha` (the exact commit CI validated) and the `sha-*`
  image tag is computed from the checked-out commit for the same reason.
  Tag (`v*`) and `workflow_dispatch` publishes are unchanged.
- `.github/workflows/ci.yml`: new fast `typecheck` job (backend
  `tsc --noEmit` after `prisma generate`, frontend `npm run typecheck`,
  e2e `npm run typecheck`) — previously type errors only surfaced inside
  the e2e job's Docker builds, and the e2e suite's own typecheck never ran
  in CI at all. Also: top-level `permissions: contents: read` (least
  privilege for the default token), the `npm ci` retry extended to the e2e
  install (was backend-only), and the service container aligned to
  `postgres:15-alpine` matching both compose files.

### Added — 2026-07-21 — Dependabot configuration

- `.github/dependabot.yml`: weekly update PRs for npm (`/backend`,
  `/frontend`, `/e2e`), GitHub Actions, and the Docker base images in both
  Dockerfiles. All entries `target-branch: develop` — `main` is the release
  branch and only advances via release PRs.

### Changed — 2026-07-21 — README rewritten to match the shipped codebase

- `README.md` fully revised: it still described the original PRD (HTMX,
  "Node.js or Python (FastAPI)", port 8080, shipped ingestion webhook,
  success metrics / user stories). Now documents the real stack
  (React 18 + Vite + Tailwind / Express + Prisma / PostgreSQL 15), the real
  ports (5173 dev, 80/3000 prod defaults), shipped features vs. a Roadmap
  section (Secure Ingestion Port, iTop utilization), the `setup.sh`
  production path, and a native local-dev guide based on the tracked
  `backend/.env.example` — the root `docker-compose.yml` / `.env.example`
  are gitignored, so the old `docker compose` instructions did not work
  from a fresh clone. No links to local-only docs (CLAUDE.md, DESIGN.md,
  CONFIGURATION.md) since those are not in the public repo.

- `@xyflow/react` and `dagre` removed from `frontend/package.json` — never
  imported anywhere in `frontend/src` (verified against the current tree;
  frontend typecheck clean after removal). Leftovers from the shelved
  Network Diagram exploration, which stays not-built by decision. Dev-stack
  note: run `docker compose exec frontend npm install` after pulling this so
  the container's node_modules volume drops both packages.

### Removed — 2026-07-21 — Internal working documents

- Removed internal working documents from the repository: `tasks/`
  (`plan.md`, `todo.md`), `docs/ideas/`, `docs/intent/`, `docs/mockups/`,
  `ISSUES.md`, and `DESIGN.md`. These are maintenance/planning references
  kept locally; the repo now carries only what is needed to pull, run, and
  deploy Solvro. `.gitignore` extended so they cannot return. (Note:
  removed files remain in git history.)

### Fixed — 2026-07-21 — No stray "(No section)" Gantt header for subtask-only buckets

- `buildRows` (`frontend/src/lib/gantt/geometry.ts`) now emits the
  "(No section)" group only when the null-section bucket contains at least one
  top-level task. A subtask created with `sectionId: null` (possible via
  TaskFormModal when a parent is chosen but section left blank) renders nested
  under its parent regardless of its own section, so a subtask-only bucket
  previously produced an empty stray section header row. Verified with a
  `buildRows` simulation (dated parents + undated subtasks + null-section
  subtask): subtasks nest, chevron flags set, no stray header, collapse works.

### Fixed — 2026-07-21 — Gantt renders when tasks exist but none have dates

- `GanttFrame.tsx` (`frontend/src/components/gantt/`): `chartStart`/`chartEnd`
  now fall back to a today-centered window (reusing
  `computeChartStart`/`computeChartEnd`'s ±1-year padding) when `rowsDateRange`
  is null but rows exist. Previously the render guard required a non-null
  chart window while the empty state required `rows.length === 0`, so a
  project with tasks/sections but zero dated tasks fell between the two and
  rendered nothing at all. Undated tasks now appear as bar-less rows —
  `GanttBar` and `GanttConnectors` already null-guard — and can be scheduled
  by clicking the row to open the task editor.
- Reworded the Gantt empty state (same file): it only fires when the project
  has no tasks *and* no sections, but claimed "No tasks have start or due
  dates yet" — now points at the + Task / + Section toolbar actions.
- Excel/PDF export window fallback (same file): with no dated tasks it now
  anchors the tight ±7-day grid on today instead of the previously dead
  chartStart/chartEnd branch, which the render fix would otherwise have made
  live and produced a ±1-year grid of empty columns. The anchor resolves at
  export time (inside the handler closures), not when the registration effect
  runs, so a tab left open across day boundaries can't export a stale window.
- Filed the Phase 2 follow-up (drag-on-canvas to schedule undated tasks) as
  `docs/ideas/gantt-drag-to-schedule.md`.

- `buildRows` (`frontend/src/lib/gantt/geometry.ts`) now emits `subtask` rows
  (depth 2) nested under their parent task, always grouped by the parent's
  section even when the subtask's own `sectionId` diverged. Parent task rows
  gain a `hasChildren` flag + expand/collapse chevron
  (`frontend/src/components/gantt/GanttListRow.tsx`) reusing the existing
  `collapsed` row-id set. Only direct children render (depth caps at 2);
  deeper nesting rolls up into each subtask's `progressPct`. Renderers,
  connectors, and Excel/PDF exports already supported the `subtask` row kind
  — previously nothing emitted it (subtasks were invisible on the Gantt).

### Added — 2026-07-20 — `Project.excludeFromPortfolio` flag (admin containers)

- `Project.excludeFromPortfolio` boolean (`projects.exclude_from_portfolio`,
  default false), migration `project_exclude_from_portfolio` —
  `backend/prisma/schema.prisma`. Marks administrative container projects
  (e.g. per-TAM "Opty Timelines") that must not pollute portfolio roll-ups.
- `computePortfolioRows` (`backend/src/lib/portfolio.ts`) AND-merges
  `excludeFromPortfolio: false` into every caller's filter, covering
  `GET /reports/executive` (Portfolio Timelines, overdue monitoring).
  `GET /overview` (`backend/src/routes/overview.ts`) additionally applies the
  same filter to its own queries (KPI counts, recent projects/tasks) so
  flagged projects don't inflate any Overview roll-up. They stay fully
  usable and visible in the Projects list.
- `POST /projects` / `PATCH /projects/:id` accept `excludeFromPortfolio`
  (`backend/src/routes/projects.ts`); "Administrative project" checkbox in
  `frontend/src/components/ProjectFormModal.tsx`; types + executive-report
  invalidation in `frontend/src/lib/queries.ts`.

### Fixed — 2026-07-20 — Gantt dates column truncation

- Gantt task-list dates column truncated every range ("12 Jul – 1…"); widened
  `DATE_RANGE_COL_WIDTH` 92 → 118 in `frontend/src/lib/gantt/constants.ts` to
  fit the bounded "DD Mon – DD Mon" format (window/divider resizing feeds the
  flex name column, so the fixed sub-column could never grow).

### Added — 2026-07-20 — Explicit `Task.isMilestone` flag

- `Task.isMilestone` boolean (`tasks.is_milestone`, default false) with
  one-time backfill marking previously derived milestones (same-day range or
  due-only) — `backend/prisma/schema.prisma`, migration
  `task_is_milestone`. `POST /projects/:id/tasks` and `PATCH /tasks/:id`
  accept `isMilestone`; both enforce startDate = dueDate for milestones.

### Changed — 2026-07-20 — Gantt milestones follow the explicit flag

- Gantt milestone rendering now follows the explicit `isMilestone` flag
  (Task/Milestone toggle in TaskPanel) instead of inferring from same-day
  dates — `frontend/src/lib/gantt/geometry.ts`,
  `frontend/src/components/TaskPanel.tsx`, `frontend/src/lib/queries.ts`.
  Due-only non-milestone tasks render as 1-day bars.

### Fixed — 2026-07-20 — Milestones can start dependency drags

- Milestone diamonds can now initiate dependency drags (connector dots were
  unreachable in the milestone render branch) —
  `frontend/src/components/gantt/GanttBar.tsx`.

### Added — 2026-07-20 — Gantt "Color by" selector

- Gantt "Color by" selector (Status | Section | Priority) with legend,
  persisted in localStorage (`solvro.gantt.colorBy`), defaulting to Section
  so upgrade-day visuals are unchanged; shared `barFillHex` resolver drives
  live bars and both exports — `frontend/src/lib/gantt/palette.ts`,
  `GanttFrame.tsx`, `GanttBar.tsx`, `exportPdf.ts`, `exportExcel.ts`.

### Changed — 2026-07-20 — Exports color by the selected mode

- Excel/PDF Gantt exports now color by the selected mode instead of always
  status — in the default Section mode with unset section colors they render
  grey until a mode is chosen or colors are set (screen and export now
  always agree).

### Added — 2026-07-20 — Section color swatch picker

- Section color picker (8 preset swatches) on the Gantt section rows,
  feeding the existing sections PATCH `color` field —
  `frontend/src/components/gantt/GanttListRow.tsx`, `GanttListPane.tsx`,
  `GanttFrame.tsx`, `frontend/src/lib/queries.ts`.

### Fixed — 2026-07-20 — Clipboard copy on the HTTP prod origin

- Copy-to-clipboard (Reports export packet, Admin ID copy) failed on the
  plain-HTTP prod origin where `navigator.clipboard` is undefined; added
  `frontend/src/lib/clipboard.ts` fallback (textarea + execCommand).

### Added — 2026-07-20 — "View" opens the Gantt PDF in a browser tab

- "View" export action opening the Gantt PDF in a browser tab (bypasses the
  download pipeline that hangs on the HTTP-only prod origin) —
  `frontend/src/lib/gantt/exportContext.tsx`, `exportPdf.ts`,
  `GanttFrame.tsx`, `frontend/src/components/layout/RightSidebar.tsx`.

### Changed — 2026-07-20 — Review fixes: milestone validation + optimistic section updates

- `useUpdateSection` now uses the canonical optimistic-update pattern
  (snapshot/rollback/invalidate) so section color/rename/reorder feel
  instant — `frontend/src/lib/queries.ts`.
- Milestone validation guards: task create with `isMilestone: true` requires
  a due date; task patch rejects `isMilestone: true` combined with clearing
  the due date — `backend/src/routes/projects.ts`,
  `backend/src/routes/tasks.ts`.
- Section color popover uses the sanctioned `shadow-overlay` token instead
  of `shadow-lg` — `frontend/src/components/gantt/GanttListRow.tsx`.

### Changed — 2026-07-16 — Overview: fake "Portfolio progress" S-curve replaced by real Portfolio timeline

- **[frontend/src/pages/Overview.tsx](frontend/src/pages/Overview.tsx)** — the synthetic S-curve chart (**Removed**: `buildSCurve()` fake 6-bucket ramp, the recharts AreaChart card, and this file's recharts imports — the dep stays for `ProjectOverview.tsx`) is replaced by the shared `PortfolioCalendar` fed by the new `GET /overview` `portfolio` payload, so each user sees a real year-roadmap of exactly the projects they can see (TAMs: their own). Rendered as a full-width bare section (header + the calendar's own bordered container, mirroring Executive — no double-carding) titled "Portfolio timeline"; footnote copy drops "see List view" (Overview has none). "Projects needing attention" + "Recent activity" now sit in a two-up row below; the attention strip's local `ProjectStatusPill` was **Removed** in favor of the canonical `ProjectStatusChip` (it duplicated chip styling with off-token colors and wrong ON_HOLD/CANCELLED semantics). `SkeletonGrid` mirrors the new layout.

### Fixed — 2026-07-16 — Overview health signal is real (TODO(health-signal) resolved)

- **[frontend/src/pages/Overview.tsx](frontend/src/pages/Overview.tsx)** — "Projects needing attention" now sources **all** visible projects from `portfolio` (was the 5-capped `recentProjects`) and ranks by real schedule data: overdue (amber `#F59E0B` left border + `Nd overdue` label in `text-chip-amber-text`, most-overdue first) → ACTIVE on-track (green) → everything else, recency-sorted within the non-overdue tiers, top 6. The previously unreachable amber bucket documented by the three `TODO(health-signal)` comments is now live; the comments are gone. Green/gray border hexes unchanged (`#8DC63F`/`#6B7280`).
- **[ISSUES.md](ISSUES.md)** — logged deferred review findings as follow-ups: Overview's pre-existing off-token styling (KPI icon tones, `AVATAR_PALETTE` hexes incl. the reserved amber, raw `font-mono` for ids/KPI, ad-hoc caption sizes, healthColor hex→token migration), the `ActivityFeed` empty-state edge case, and the two `PortfolioCalendar` carried-over nits (`rounded-full` bar, `font-mono` year).

### Changed — 2026-07-16 — `PortfolioCalendar` extracted into a shared component

- **[frontend/src/components/portfolio/PortfolioCalendar.tsx](frontend/src/components/portfolio/PortfolioCalendar.tsx)** (new) — the Executive dashboard's calendar (month grid, bar positioning, `barTone` status coloring, year switcher, clip chevrons, Today line, legend, tooltips) plus `fmtDate` moved **verbatim** out of `Executive.tsx` so the Overview page can reuse it (next entry). Two additions: exported `sortPortfolioRows()` (the overdue-first → end-asc → name comparator previously inlined in `PortfolioTimelinesSection`) and an optional `unscheduledNote` prop for the footnote copy (default reproduces the Executive wording exactly — Overview has no List view to point at). Known pre-existing nits carried over deliberately to keep the extraction byte-identical: `rounded-full` on the timeline bar and raw `font-mono` for the year display.
- **[frontend/src/pages/Executive.tsx](frontend/src/pages/Executive.tsx)** — imports the shared component/helpers; inline sort replaced by `sortPortfolioRows()`. Zero behavior change (extraction mechanically verified line-by-line against the deleted block).
- **[frontend/src/lib/queries.ts](frontend/src/lib/queries.ts)** — `ExecutiveProjectRow` renamed to `PortfolioProjectRow`, moved next to the overview types, gained `updatedAt: string` (mirrors `backend/src/lib/portfolio.ts`, same field order); `OverviewResponse` gained `portfolio: PortfolioProjectRow[]`; `ExecutiveReport.projects` re-pointed. No new hooks.

### Added — 2026-07-16 — Shared portfolio-row computation + `/overview` portfolio payload

- **[backend/src/lib/portfolio.ts](backend/src/lib/portfolio.ts)** (new) — `computePortfolioRows(where)` extracted verbatim from the `/reports/executive` handler: per-project `start` (min task startDate), `end` (max task dueDate), `totalTasks`/`doneTasks`/`progressPct`, `isOverdue`/`daysOverdue` (end before start-of-today and status not COMPLETED/CANCELLED), ordered `sections`. Row type `PortfolioProjectRow` = old `ExecutiveProjectRow` + `updatedAt` (needed by Overview's attention-strip recency sort). Single `findMany` with scalar task selects — no N+1, per the sub-200ms NFR.
- **[backend/src/routes/overview.ts](backend/src/routes/overview.ts)** — `GET /overview` response now carries `portfolio`: all visible projects (same `projectVisibilityFilter` scope as every other overview query, so TAMs get only their own projects) run through `computePortfolioRows`, added as a 6th member of the existing `Promise.all`. Why: real schedule/overdue data for the Overview "Portfolio timeline" replacing the synthetic S-curve (frontend lands in a follow-up entry).
- **[backend/src/routes/reports.ts](backend/src/routes/reports.ts)** — `/reports/executive` now delegates to `computePortfolioRows({})` (still intentionally org-wide, permission-gated). Output contract unchanged except rows additively gain `updatedAt`.

### Added — 2026-07-15 — `ProjectService` join model + start-fresh catalogue reset

- **[backend/prisma/schema.prisma](backend/prisma/schema.prisma)** — new `ProjectService` model mirroring `CustomerService` exactly: `(projectId, serviceId, tools[] String[], createdAt)`, `@@unique([projectId, serviceId])`, indexes on both FKs, `onDelete: Cascade` both sides, `@@map("project_services")`. Back-relations added: `Project.services` and `Service.projects`. This is the data layer for per-project service scoping (each project declares which catalogue services are in play for that engagement, independent of — and beyond — the customer's subscription set).
- **[backend/prisma/migrations/20260715221031_add_project_services/migration.sql](backend/prisma/migrations/20260715221031_add_project_services/migration.sql)** (new) — creates `project_services`, then **destructively resets the catalogue**: `DELETE FROM "customer_services"; DELETE FROM "services";`. This "start fresh" wipe was explicitly user-approved as part of retiring the admin-curated catalogue (existing mappings were dev-stage throwaway data). Any environment applying this migration loses existing service/customer-service rows by design.

### Fixed — 2026-07-15 — Clean 400 for nonexistent serviceIds on both mapping PUTs

- **[backend/src/routes/projects.ts](backend/src/routes/projects.ts)**, **[backend/src/routes/customers.ts](backend/src/routes/customers.ts)** — `PUT …/services` now pre-checks that every `assignments[].serviceId` exists (`prisma.service.count` on the deduped id set) and throws `HttpError(400, "service_not_found")` before the replace-set transaction. Previously a valid-but-nonexistent id (e.g. a service deleted concurrently) tripped the FK constraint → Prisma P2003 → raw 500 `internal_error` (the error mapper only handles P2025/P2002). Found by code review; the customers.ts gap predated this branch but shares the exact pattern, so both were fixed together. Regression tests added in [backend/test/projectServices.test.ts](backend/test/projectServices.test.ts) (project + customer routes).
- **[ISSUES.md](ISSUES.md)** — logged two deferred review findings: optimistic-update pattern for the service-mapping mutation hooks (inherited debt, both hooks together as follow-up), and the product call on whether `active: false` services should be blocked from new assignments (incl. "Add all subscribed" carry-over).

### Changed — 2026-07-15 — Service catalogue management moved from Admin to Settings

- **[frontend/src/components/services/ServiceCatalogueManager.tsx](frontend/src/components/services/ServiceCatalogueManager.tsx)** (new) — the catalogue management UI (add form, inline rename, active toggle, delete-with-confirm) extracted from `Admin.tsx`'s `ServicesTab` mostly verbatim. Copy updated: intro now says any TAM can add services inline from a customer's or project's Services tab and curate here; delete confirm now warns removal cascades to **customers and projects**.
- **[frontend/src/pages/Settings.tsx](frontend/src/pages/Settings.tsx)** — new "Service Catalogue" section card (between Profile and Change password) rendering the manager, visible only to users with `project:write` (`hasPermission` guard).
- **[frontend/src/pages/Admin.tsx](frontend/src/pages/Admin.tsx)** — **Removed** the "Service Catalogue" tab, its render branch, the `ServicesTab` component, and all now-unused service imports (−261 lines). Catalogue curation is no longer an admin concern.

### Added — 2026-07-15 — Project "Services" tab (per-project service scoping UI)

- **[frontend/src/pages/views/ProjectServices.tsx](frontend/src/pages/views/ProjectServices.tsx)** (new) — project sub-view rendering `ServiceMappingList` with the project's assignments (`useUpdateProjectServices`). When the project has a customer, `useCustomer(project.customerId)` supplies `subscribedServiceIds` so customer-subscribed services are badged "Subscribed" and sorted first, plus an **"Add all subscribed"** bulk action (visible only when unassigned subscriptions exist) that merges the customer's remaining subscriptions into the project set, carrying over the customer's per-service tools while leaving already-assigned services' project-level tools untouched. Projects without a customer render an unbadged picker.
- **[frontend/src/App.tsx](frontend/src/App.tsx)** — registered `projects/:id/services` route; **[frontend/src/pages/ProjectDetail.tsx](frontend/src/pages/ProjectDetail.tsx)** — added `Services` to the project tab list (after Risks), per the two-place registration convention.

### Added — 2026-07-15 — Shared `ServiceMappingList` component + inline service creation

- **[frontend/src/components/services/ServiceMappingList.tsx](frontend/src/components/services/ServiceMappingList.tsx)** (new) — the service-mapping UI (catalogue checkbox rows, per-assignment `ToolsEditor` chip input, full-replace `buildAssignments` logic) extracted verbatim from `CustomerDetail.tsx` into a reusable component consumed by both the customer Services tab and the upcoming project Services tab. Props: `assignments`, `onSave` (full-replace), `canMutate`, `saving`, optional `subscribedServiceIds` (project context: rows badged "Subscribed" and sorted first), `title`/`description` copy overrides. New capability: an inline **"Add service"** form (name + description, styled after the Admin add-form) that creates a catalogue entry via `useCreateService` and immediately auto-assigns it — TAMs no longer need the Admin screen to grow the catalogue. Empty-state copy now points at the inline form instead of the retiring Admin tab.
- **[frontend/src/pages/CustomerDetail.tsx](frontend/src/pages/CustomerDetail.tsx)** — `ServicesTab` reduced to a thin wrapper around `ServiceMappingList` (−231 lines); `ToolsEditor` and the mapping logic now live in the shared component. No behavior change beyond the inline add form.

### Added — 2026-07-15 — Project services query layer

- **[frontend/src/lib/queries.ts](frontend/src/lib/queries.ts)** — added `ProjectServiceAssignment` interface; `ProjectDetail` now carries `services: ProjectServiceAssignment[]` (matches the enriched `GET /projects/:id` payload); new `useUpdateProjectServices(projectId)` mutation hook mirroring `useUpdateCustomerServices` (`PUT /projects/:id/services`, invalidates the project detail + projects namespace). Also fixed stale-cascade invalidation: `useUpdateService`/`useDeleteService` now invalidate `["projects"]` too, since service renames/deletes cascade into project detail payloads.

### Added — 2026-07-15 — `PUT /projects/:id/services` + services in project detail payload

- **[backend/src/routes/projects.ts](backend/src/routes/projects.ts)** — new `PUT /projects/:id/services` endpoint (gated `requirePermission("project:write")` + `ensureProjectVisible`, so hidden projects 404 like every other project-scoped route). Body `{ assignments: [{ serviceId, tools[] }] }`; replaces the whole assignment set in one transaction (deleteMany rows not in the desired set, then upsert each `(serviceId, tools)` on the `projectId_serviceId` key) — the exact pattern of the customer-side mapping in `customers.ts`. Also extracted the previously triplicated full-detail `include` (GET `/:id` + both baseline branches) into a shared `projectDetailInclude` const and added `services: { include: { service } }` (ordered by service name) to it, so every project-detail response now carries the project's service assignments.
- **[backend/test/projectServices.test.ts](backend/test/projectServices.test.ts)** (new) — vitest/supertest coverage: assign + read-back on PUT and GET, replace-by-omission + tools upsert, TAM can `POST /services` (regression for the new permission gate), STAKEHOLDER gets 403 on both writes, unassigned TAM gets 404 (visibility), invalid serviceId → 400.
- **[backend/test/testAuth.ts](backend/test/testAuth.ts)** — generalized `createAdminAndToken` into `createUserWithRole(roleName)` (admin helper now delegates) so tests can mint TAM/STAKEHOLDER tokens.

### Changed — 2026-07-15 — Service catalogue writes opened to TAMs

- **[backend/src/routes/services.ts](backend/src/routes/services.ts)** — `POST /services`, `PATCH /services/:id`, `DELETE /services/:id` are now gated by `requirePermission("project:write")` instead of `requireAdmin`. The catalogue stays shared/global, but any TAM can curate it (create inline from pickers, rename, deactivate, delete) — the admin-only gate was a bottleneck in a solo-use tool. `GET /services` unchanged (any authenticated user). Admin UI relocation to Settings follows in a later change this cycle.

### Fixed — 2026-07-04 — PortfolioCalendar track-alignment bugs

- **[frontend/src/pages/Executive.tsx](frontend/src/pages/Executive.tsx)** — two alignment regressions in the new Calendar view. (1) The 12-month axis header spanned the full `min-w-[720px]` width while each project row indents its bar track behind a `w-48` label column + `gap-3`, so month labels sat ~192px left of the bars ("Jun" was not above the June bars). The header now mirrors the row structure — a `flex items-center gap-3 px-3` wrapper with a `w-48 shrink-0` spacer and the 12-col grid inside a `flex-1`, so its columns sit directly over the bar track. (2) The dashed "Today" line was positioned `left: todayFrac%` of the full `.relative` rows container, which includes the `w-48` label gutter, while bars are positioned as a % of the `flex-1` track only — so the line missed the bars. It's now rendered in a full-height `absolute inset-0` overlay that reuses the same `w-48` spacer + `flex-1` track, so `todayFrac%` is measured against the track and lines up with the bars. Header, per-row gridlines, bars, and today line now share one 12-column coordinate system. Today-line current-year gating and the Today pill are unchanged.

### Changed — 2026-07-04 — Portfolio Timelines: Calendar/List view toggle

- **[frontend/src/pages/Executive.tsx](frontend/src/pages/Executive.tsx)** — the "Portfolio Timelines" block now defaults to a **Calendar** horizontal year-roadmap view, with the previous progress-bar row-list preserved behind a **List** toggle (segmented buttons in the section header, styled after the Gantt's Scale switcher). `PortfolioList` is the extracted, visually-unchanged list view. `PortfolioCalendar` (new) renders a 12-equal-width-month axis for a switchable `‹ {year} ›`; project bars are positioned with percentage math (`leftFrac`/`rightFrac` clamped to `[0,1]` against `[Jan 1 year, Jan 1 year+1)`, min 1% width) so they align under the correct months without any pixel math; a `barTone(p)` helper colors bars `bg-error` (overdue) → `bg-primary` (active) → `bg-chip-amber-bg` (planning/on-hold) → `bg-on-surface-variant/40` (completed/cancelled), with a matching dot legend reusing the same tone constants; projects that start before or end on/after the visible year show a small `‹`/`›` clip chevron; a dashed `border-primary` "Today" marker renders only when the selected year is the current year; projects missing `start` or `end` are excluded from placement and rolled into a single muted footnote line ("N projects have no scheduled dates — see List view."); the roadmap sits in its own `overflow-x-auto` container (`min-w-[720px]`) so only that box scrolls horizontally, never the page body. Frontend-only — reuses the existing `GET /reports/executive` payload and `ExecutiveProjectRow` DTO unchanged; no backend, query-hook, or DTO edits. `npm run typecheck` passes clean.

### Added — 2026-07-03 — Executive dashboard page build-out

- **[frontend/src/pages/Executive.tsx](frontend/src/pages/Executive.tsx)** — replaced the placeholder wiring proof with the full dashboard: an "Overdue Projects" block (compact table, sorted by `daysOverdue` descending, desktop grid + mobile stacked cards, `EmptyState` when nothing is overdue) rendered first, followed by a "Portfolio Timelines" block (one row per project — status chip, TAM/customer, a single horizontal progress bar colored `bg-error` when overdue else `bg-primary`, `start → end` date range, and a subtle section-color dot legend for phases). Sort order for the timelines block is overdue-first (by `daysOverdue` desc), then scheduled projects by `end` ascending, then unscheduled projects last. All colors use existing theme tokens except `section.color`, which is data-driven and applied via inline `style` as instructed. Note: the timeline is intentionally a high-level progress-bar first pass — date-accurate phase segments would require per-section start/end dates from the backend (`ExecutiveProjectRow.sections` only carries `id`/`name`/`color` today), which is a future refinement, not implemented here.

### Added — 2026-07-03 — Executive dashboard frontend wiring

- **[frontend/src/lib/auth.tsx](frontend/src/lib/auth.tsx)** — added `report:executive` to `PERMISSION_CATALOG` (after `report:read`) so admins can tick it onto a role in Admin > Roles.
- **[frontend/src/lib/queries.ts](frontend/src/lib/queries.ts)** — added `queryKeys.executiveReport()`, exported `ExecutiveProjectRow`/`ExecutiveReport` interfaces matching the `GET /reports/executive` response shape, and `useExecutiveReport()` query hook (`apiRequest<ExecutiveReport>("/reports/executive")`).
- **[frontend/src/components/ExecutiveGuard.tsx](frontend/src/components/ExecutiveGuard.tsx)** (new) — route guard cloned from `AdminGuard.tsx`, gating on `hasPermission(user, "report:executive")` (wildcard `*` holders still pass) instead of the admin wildcard.
- **[frontend/src/components/layout/Sidebar.tsx](frontend/src/components/layout/Sidebar.tsx)** — added optional `permission?: string` field to `NavItem`; added an "Executive" nav item (`/executive`, icon `leaderboard`) between Reports and Settings, gated via the new `permission` field; updated the nav filter predicate to account for either `adminOnly` (wildcard) or `permission` (specific permission) gates.
- **[frontend/src/pages/Executive.tsx](frontend/src/pages/Executive.tsx)** (new) — minimal placeholder page calling `useExecutiveReport()` and rendering a loading/error state plus a "N projects · M overdue" summary line, so the wiring is verifiable ahead of the full dashboard build-out.
- **[frontend/src/App.tsx](frontend/src/App.tsx)** — registered `executive` route inside the authed `<Shell/>` tree, wrapped in `ExecutiveGuard`, placed between `reports` and `settings`.

### Added — 2026-07-03 — Executive portfolio report endpoint

- **[backend/src/routes/reports.ts](backend/src/routes/reports.ts)** (new) — `GET /reports/executive`, an org-wide, read-only portfolio roll-up for an Executive/Manager dashboard. Gated by a new permission string `report:executive` (via `requirePermission`) rather than `projectVisibilityFilter` — the permission itself is the org-wide read grant, so this route intentionally queries ALL projects regardless of TAM/SA assignment. Single `prisma.project.findMany` (no N+1) selecting `tam.username`, `customer.name`, ordered `sections`, and lean per-task `{status, startDate, dueDate}`; aggregates in JS into a lean DTO (`ExecutiveProjectRow`): `start`/`end` derived from min(task.startDate)/max(task.dueDate), `progressPct` from done/total tasks, and a new derived `isOverdue`/`daysOverdue` project-level rule (committed end date before local midnight today, and status not COMPLETED/CANCELLED — there is no `Project.deadline` column, so this is computed, not stored).
- **[backend/src/app.ts](backend/src/app.ts)** — mounted `app.use("/reports", reportsRouter)` alongside the other routers (no `/api` prefix, per convention).
- Note: the `report:executive` permission string itself is not yet seeded onto any role — an admin must add it to a role's permissions array (e.g. a new "Executive" custom role) via the existing Admin > Roles UI for this endpoint to be reachable.

### Changed — 2026-06-03 — Track DESIGN.md (remove from .gitignore)

- **[.gitignore](.gitignore)** — removed `DESIGN.md` from the "design/product docs" ignore block so the canonical design source-of-truth is versioned. `PRD.md` and `UI Design/` stay local-only; `CLAUDE.md` remains gitignored (by request — its edits stay local).
- **[DESIGN.md](DESIGN.md)** — now tracked, committed at its current state (Elitery-green/charcoal palette, spec radius scale, body weight 450, body-sm 15px, label-caps 12px, `#ebebe7` typo fix).

### Changed — 2026-06-03 — CLAUDE.md: Daily Review marked SHIPPED

- **[CLAUDE.md](CLAUDE.md)** — Daily Review is built, so: canonical-decisions line changed from "NOT YET BUILT" to "SHIPPED" (keeping the `INTERNAL`-default / never-exported invariant); `DailyReview.tsx` added to the "Shipped pages" routing list; removed the Daily Review spec from "Features Not Yet Built" and renumbered the remaining items (1. Secure Ingestion Port, 2. Reports Screen Revamp).
- **[ISSUES.md](ISSUES.md)** — dropped the now-resolved "CLAUDE.md says Daily Review NOT YET BUILT" drift item.

### Added — 2026-06-03 — ISSUES.md tracking doc

- **[ISSUES.md](ISSUES.md)** (new, repo root) — known bugs / doc-drift, pending features, deferred decisions, tech debt, and verification debt, compiled from CLAUDE.md, this changelog, and session history.

### Fixed — 2026-06-03 — UI review: design-token compliance pass

Reviewer line numbers were stale; located each by content.

- **[ProjectKanban.tsx](frontend/src/pages/views/ProjectKanban.tsx)** — card hover `shadow-[…]` → `hover:border-primary` (border-color shift, per the no-card-shadows rule); `transition-shadow` → `transition-colors`.
- **[ProjectOverview.tsx](frontend/src/pages/views/ProjectOverview.tsx)** — stat value `font-mono` → `font-body` (kills the off-spec monospace stack; kept `text-3xl tabular-nums`). **Note:** did *not* apply the suggested `text-data-mono` here — that token carries a fixed 13px (and weight 500) that would shrink/de-bold the `text-3xl` KPI number; `font-body` + existing `tabular-nums` achieves the intent. Removed the stray `text-[11px]` on the hint (now inherits body size).
- **[Admin.tsx](frontend/src/pages/Admin.tsx)** — all 4 `bg-emerald-100 text-emerald-700` → `bg-chip-emerald-bg text-chip-emerald-text` (theme-aware tokens; dropped the now-redundant manual `dark:` emerald variants and a hardcoded `hover:bg-emerald-200`).
- **[Login.tsx](frontend/src/pages/Login.tsx)** — inline `rgba(255,255,255,0.45)` / `0.2` → `text-on-surface-variant/45` / `/20`; hero pills `borderRadius: 20` → `rounded-full`, `borderWidth: 0.5px` → `border`.
- **[Shell.tsx](frontend/src/components/layout/Shell.tsx)** / **[TopBar.tsx](frontend/src/components/layout/TopBar.tsx)** / **[Sidebar.tsx](frontend/src/components/layout/Sidebar.tsx)** + **[tailwind.config.ts](frontend/tailwind.config.ts)** — extracted the hardcoded collapsed-rail `w-16`/`ml-16` into a shared `sidebar-collapsed` (4rem) spacing token (`w-sidebar-collapsed` / `ml-sidebar-collapsed`) so the rail width and canvas offset can't drift.
- **[Tasks.tsx](frontend/src/pages/Tasks.tsx)** / **[ProjectList.tsx](frontend/src/pages/views/ProjectList.tsx)** — `rounded-lg` → `rounded` on the 3 action buttons (per the small-radius scale). Error banners / inputs left as-is (not buttons).
- **[index.css](frontend/src/index.css)** — diagram `--cp-stroke` hardcoded `#3aae51` → `rgb(var(--primary))` (now follows the theme primary).
- Verified: host typecheck clean; zero leftover hardcoded values for any item.

### Changed — 2026-06-03 — Migrate caps labels to the `text-label-caps` token (now the single source of truth)

Follow-up to the label-caps token bump: the token was previously unused (caps labels were hardcoded). Migrated all usages so the token actually drives card/section labels — they now render at the token's 12px.

- **96 occurrences across 21 files** — replaced the ad-hoc `text-[11px] font-bold uppercase` with `text-label-caps uppercase`. The token supplies font-size (12px), font-weight (700), and letter-spacing (0.05em); only `uppercase` (text-transform, not part of the token) is kept inline. Net visual change vs. before: 11px → 12px, plus the token's 0.05em tracking (≈ `tracking-wider`) and `line-height: 1`.
- Verified: `text-[11px] font-bold uppercase` now appears 0×; `.text-label-caps` compiles to `font-size:12px; font-weight:700; letter-spacing:0.05em`; no size-class collisions; typecheck clean.
- Not migrated (intentional variants, left as-is): 4× `text-[11px] uppercase` (no bold) and 1× `text-[11px] font-semibold uppercase` (lighter weight) — adopting the 700-weight token would change their look.

### Changed — 2026-06-03 — Bump body-sm 14→15px, label-caps 11→12px; login hero headline 26→40px

- **[frontend/tailwind.config.ts](frontend/tailwind.config.ts)** + **[DESIGN.md](DESIGN.md)** — `body-sm` fontSize 14px → 15px; `label-caps` fontSize 11px → 12px (both files kept in sync). `body-sm` is live app-wide (inherited via `@apply text-body-sm` on `<body>`; confirmed 15px in served CSS). **Caveat:** the `text-label-caps` utility is referenced by **zero** components — the app's caps labels are hardcoded as `text-[11px] font-bold uppercase` (96 sites) — so the token bump is correct but has no rendered effect until those usages adopt the token (or are bumped to `text-[12px]`). Flagged for a follow-up decision.
- **[frontend/src/pages/Login.tsx](frontend/src/pages/Login.tsx)** — login hero headline `fontSize` 26 → 40px (`lineHeight` 1.25 → 1.1, `letterSpacing` -0.4px → -1px) so it reads as a proper hero, not body text. Hero copy stays vertically centered via the existing `my-auto`.

### Changed — 2026-06-03 — Login two-tone split (Direction A): hero #1a1a18 / form #232321

- **[frontend/src/pages/Login.tsx](frontend/src/pages/Login.tsx)** — left hero panel `bg-ink` (#191919) → `bg-background` (#1a1a18, darker); right sign-in panel `bg-surface-container-lowest` → `bg-surface` (#232321, slightly lighter). The login is `dark`-pinned so these theme tokens resolve to the requested dark charcoal hexes (`--background` = 26 26 24, `--surface` = 35 35 33) in both app themes. Used the named DESIGN.md tokens rather than inline hex per the theme-token convention. The dark `bg-ink` CTA button and the `bg-surface-container-lowest` input wells now read as darker insets against the lighter form panel.

### Changed — 2026-06-03 — Body text weight 400 → 450 (variable font)

- **[frontend/tailwind.config.ts](frontend/tailwind.config.ts)** + **[DESIGN.md](DESIGN.md)** — `body-lg` / `body-sm` typography tokens `fontWeight` 400 → 450 (DESIGN.md frontmatter updated too, so the canonical spec doesn't drift). Headings (600), `data-mono` (500), and `label-caps` (700) unchanged. Body weight is inherited app-wide via `@apply text-body-sm` on `<body>`.
- **[frontend/index.html](frontend/index.html)** — Source Sans 3 now loaded as the **variable** font (`wght@300..700` range) instead of discrete static instances (`wght@300;400;500;600;700`). Static instances would snap `font-weight:450` to the nearest available (500); the variable axis renders a true 450. Range covers all weights in use (300–700).
- **[frontend/src/index.css](frontend/src/index.css)** — added a comment at the `body` rule documenting the 450 weight + variable-font dependency.
- Two `font-normal` (400) usages (`DailyReview.tsx`, `GanttListRow.tsx`) are `font-mono` numeric labels — intentionally left at 400.

### Fixed — 2026-06-03 — Stop generated tailwind.config.js from shadowing the .ts source (root-caused the session's "stale CSS")

`npm run build` runs `tsc -b`, and `tsconfig.node.json` (`composite: true`) included `tailwind.config.ts` / `vite.config.ts`, so tsc emitted `tailwind.config.js` / `vite.config.js` **in the project root**. PostCSS/Tailwind (and Vite) resolve `.js` before `.ts`, so the stale compiled `tailwind.config.js` silently shadowed the real `tailwind.config.ts` — every `tailwind.config.ts` edit in dev had no effect until a build regenerated the `.js`. This caused repeated "stale CSS" misdiagnoses this session (ink/sidebar/radius/shadow/weight tokens appearing not to apply).

- **[frontend/tsconfig.node.json](frontend/tsconfig.node.json)** — added `"outDir": "./node_modules/.cache/tsconfig-node"` so `tsc -b` emits the compiled config artifacts into a cache dir instead of next to the sources. `composite` forces emit, so redirecting it is the fix.
- Deleted the stale generated `frontend/tailwind.config.js` and `frontend/vite.config.js`; added both to **[.gitignore](.gitignore)** (build artifacts, not sources — `postcss.config.js` is a real source and stays tracked).
- Verified: after `npm run build`, no `*.config.js` shadow reappears in root; dev server serves the live `tailwind.config.ts` (body weight 450 confirmed in served CSS); typecheck clean.

### Added — 2026-06-03 — Elitery brand mark assets + favicon

- **[frontend/src/assets/brand/](frontend/src/assets/brand/)** (new dir) — `elitery-mark-on-dark.png` (light-grey "e" for dark surfaces) and `elitery-mark-on-light.png` (dark-grey "e" for light surfaces). Renamed from the supplied `BRAND MARK E-0{1,2}.png` (spaces removed, role baked into the name) so they import cleanly via the `@/` alias.
- **[frontend/public/](frontend/public/)** (new dir) — `favicon.png` (copy of the on-light mark; dark ink reads on the usual light browser tab strip).

### Changed — 2026-06-03 — Theme-adaptive BrandMark component

- **[frontend/src/components/BrandMark.tsx](frontend/src/components/BrandMark.tsx)** (new) — renders both Elitery marks and toggles them via the `dark:` variant: dark-ink mark (`elitery-mark-on-light.png`) on light surfaces, light-ink mark (`elitery-mark-on-dark.png`) on dark surfaces. Keys off the nearest `.dark` context, so the mark is correct on any surface/theme without hardcoding a variant.
- **[frontend/src/pages/Login.tsx](frontend/src/pages/Login.tsx)**, **[frontend/src/components/layout/Sidebar.tsx](frontend/src/components/layout/Sidebar.tsx)** — replaced the three hardcoded on-dark `<img>` uses with `<BrandMark>`; dropped the direct asset imports. Note: login + sidebar are `dark`-pinned surfaces, so `BrandMark` resolves to the light-ink mark on them in **both** app themes (correct — those surfaces are always dark). The adaptive swap only changes the mark where the surface itself follows the theme.

### Changed — 2026-06-03 — Wire Elitery logo into login + sidebar; set favicon

- **[frontend/src/pages/Login.tsx](frontend/src/pages/Login.tsx)** — replaced the placeholder green `bg-primary` "SV" tiles (desktop hero wordmark + mobile wordmark) with the on-dark Elitery mark (`<img class="h-8 w-8 object-contain">`). Login is pinned dark so both sit on dark surfaces. "Solvro" product wordmark text kept alongside (Elitery = company, Solvro = product).
- **[frontend/src/components/layout/Sidebar.tsx](frontend/src/components/layout/Sidebar.tsx)** — replaced the green `terminal`-icon tile in the expanded-rail wordmark with the on-dark mark. Collapsed rail unchanged (toggle button only).
- **[frontend/index.html](frontend/index.html)** — added `<link rel="icon" type="image/png" href="/favicon.png" />` (there was no favicon before).

### Fixed — 2026-06-03 — Login hero copy vertically centered in the left panel

- **[frontend/src/pages/Login.tsx](frontend/src/pages/Login.tsx)** — the left brand panel used `flex-col justify-between` across three children (wordmark / hero copy / footer), which spread them by equal gaps and pushed the hero copy low. Dropped `justify-between` and added `my-auto` to the hero-copy block: the wordmark stays pinned top, the footer bottom, and the equal auto top/bottom margins center the hero in the remaining space. Layout only.

### Fixed — 2026-06-02 — Sidebar expansion now pushes the main canvas instead of overlaying it

The `fixed`-positioned sidebar expands from 64px (collapsed) to 260px (`w-sidebar`), but the main canvas and top bar had a hardcoded `md:ml-16` (64px) offset, so an expanded sidebar covered the content.

- **[frontend/src/components/layout/Shell.tsx](frontend/src/components/layout/Shell.tsx)** — extracted the layout into an inner `ShellLayout` component rendered *inside* `SidebarProvider` so it can read `useSidebar()`. The `<main>` left margin now tracks the live sidebar width on desktop: `md:ml-sidebar` (260px) when open, `md:ml-16` (64px) when collapsed; added `transition-[margin] duration-200 ease-out` to match the sidebar's width animation. Mobile is unchanged (no margin — the sidebar overlays as a drawer).
- **[frontend/src/components/layout/TopBar.tsx](frontend/src/components/layout/TopBar.tsx)** — `<header>` given the same open-state-driven left offset + transition so it stays aligned with the canvas (was also pinned at `md:ml-16`). Pulled `open` from `useSidebar()`.

### Changed — 2026-06-02 — Pin login + sidebar to dark; hide Work Logs from sidebar

- **[frontend/src/pages/Login.tsx](frontend/src/pages/Login.tsx)** — login now always renders dark regardless of the user's theme preference. Added `dark` to the page root so every CSS-var token in the subtree resolves to its `.dark` value (the `.dark` rule in index.css sets the custom properties on the element and they cascade). No JS/theme-provider change.
- **[frontend/src/components/layout/Sidebar.tsx](frontend/src/components/layout/Sidebar.tsx)** — added `dark` to the `<aside>` so the rail stays fully dark in light mode (fixed brand element per DESIGN.md). Previously only the background was fixed (`bg-sidebar`); token-based accents like `bg-primary`/`text-primary` still flipped to the lighter light-mode green. With `dark` pinned they resolve to the dark-mode Elitery green (`#3aae51`).
- **[frontend/src/components/layout/Sidebar.tsx](frontend/src/components/layout/Sidebar.tsx)** — removed the "Work Logs" nav item (`WorkLogs.tsx` is an unbuilt iTop-integration placeholder). The `work-logs` route stays registered in `App.tsx` (same pattern as the hidden Tasks route). Nav now matches CLAUDE.md's canonical order exactly: Overview → Projects → Customers → Daily Review → Reports → Settings → Admin.

### Changed — 2026-06-02 — Sidebar background → DESIGN.md charcoal #232321

- **[frontend/tailwind.config.ts](frontend/tailwind.config.ts)** — added fixed (non-theme-flipping) `sidebar` color token (`#232321`).
- **[frontend/src/components/layout/Sidebar.tsx](frontend/src/components/layout/Sidebar.tsx)** — `SIDEBAR_BG` was the old AProjectO blue-gray `bg-[#0F1623] dark:bg-[#060912]`; now `bg-sidebar`. Per DESIGN.md the rail stays charcoal in both themes, so there's no `dark:` variant. **Not changed**: the nav item text still uses Tailwind `slate-*` greys (cool-tinted vs the spec's warm `#888780` inactive). Migrating those needs a small set of fixed always-dark text tokens — deferred; contrast on the new charcoal is fine.

### Fixed — 2026-06-02 — Second IDOR review: live GET /projects/:id hole, baseline-field bypass, design-token violations

Follow-up review found a still-open IDOR plus assorted hardening/design items. (Two reported findings were verified as non-issues — see note.)

- **[backend/src/routes/projects.ts](backend/src/routes/projects.ts)** — **live IDOR fixed.** `GET /:id` guarded the result with `"tamId" in filter`, but `projectVisibilityFilter` returns `{ OR: [{tamId},{saId}] }` (or `{}`), so that key never exists and the guard was a dead no-op — any authed user could fetch any project by id. Replaced the `findUnique` + dead 403 guard with `findFirst({ where: { id, ...projectVisibilityFilter(user) } })` → 404. Also removes the 403-vs-404 existence leak (the old guard threw 403; every other swept route returns 404).
- **[backend/src/routes/tasks.ts](backend/src/routes/tasks.ts)** — stripped `baselineStartDate`/`baselineDueDate` from `updateTaskSchema`. These are server-set only (snapshotted by `POST /projects/:id/baseline`); accepting them from clients would let any `task:write` user overwrite the Gantt planned-vs-actual baseline. (The `data` mapping never actually wrote them, so this was latent, not live — but the schema shouldn't advertise them.)
- **[backend/src/routes/admin.ts](backend/src/routes/admin.ts)** — corrected stale comment: `requireAdmin` is permission-based (`"*"` wildcard), not a `role === "ADMIN"` name check (post-e3f1cbd).
- **[backend/src/routes/dependencies.ts](backend/src/routes/dependencies.ts)** — `loadVisibleDependency` now calls the shared `ensureProjectVisible` instead of hand-rolling the project-visibility query; dropped the now-unused `Prisma` import. Behaviour unchanged (still 404 on not-visible).
- **[frontend/tailwind.config.ts](frontend/tailwind.config.ts)** — added fixed (non-theme-flipping) brand tokens `ink` (`#191919`) / `ink-hover` (`#2e2e2e`) for always-dark brand chrome. Replaced the `card`/`sidebar` `boxShadow` tokens with a single `overlay` shadow (`0 4px 24px rgba(0,0,0,0.18)`): DESIGN.md mandates elevation via 1px outlines + tone, with one shadow allowed only on the floating overlay layer — so there is deliberately no `card` token.
- **[frontend/src/pages/Login.tsx](frontend/src/pages/Login.tsx)** — removed stale lime `#8DC63F` focus ring (old AProjectO palette) → `focus-within:border-primary`; recolored the focus glow rgba lime→Elitery green; replaced inlined `#191919`/`#2e2e2e` hex with `bg-ink`/`hover:bg-ink-hover`/`text-ink`.
- **Shadow sweep**: `shadow-card` removed from ~24 card/skeleton surfaces across 14 files (they already carry `border border-outline-variant`, the spec's elevation); genuine overlays — `Modal.tsx`, `Drawer.tsx`, `TopBar.tsx` dropdown — switched to `shadow-overlay`; `Sidebar.tsx` dropped `shadow-sidebar` (keeps its border). **Visual impact**: cards lose a very faint (~4–7% opacity) drop shadow, becoming flat-with-outline per DESIGN.md.
- **Verified non-issues (no change):** (1) reported risks.ts TOCTOU→500 — the global `errorHandler` ([backend/src/http/errors.ts](backend/src/http/errors.ts):40) already maps Prisma `P2025`→404 (and `P2002`→409), and `express-async-errors` routes async throws there, so a concurrent-delete race returns a clean 404, consistent with every sibling router (none carry local catches). (2) Suggestion to fold the visibility filter into `prisma.task.update`'s `where` — not applicable: `update` takes a unique `where` that can't carry a relation filter; `updateMany` would lose the included return record. Left `ensureTaskVisible` as-is.

### Changed — 2026-06-02 — Login hero copy: drop SA/TAM/blueprint framing for plain project-ops language

- **[frontend/src/pages/Login.tsx](frontend/src/pages/Login.tsx)** — reworded the marketing hero. Tagline "TAM Operations Platform" → "Project Operations"; H1 "Bridge SAs and TAMs. / Ship projects on time." → "Manage projects. / Ship on time."; subtitle (Secure Ingestion Port / SA-blueprint wording) → "One place to track projects, log updates, and report to customers."; feature pills "Blueprint ingestion / Daily review / Progress export" → "Project tracking / Daily notes / Customer reports". Copy only — no layout/style changes. (Tagline source stays title-case; it's uppercased via CSS `textTransform`.)

### Changed — 2026-06-02 — Page title "Solvro Command Center" → "Solvro"

- **[frontend/index.html](frontend/index.html)** — `<title>` shortened to "Solvro" to match the canonical app name.

### Changed — 2026-06-02 — Migrate color system to DESIGN.md Elitery-Green/charcoal palette; label default → #3aae51

Completes the DESIGN.md alignment started in the tailwind-token re-sync. The actual color values live as CSS custom properties in `index.css` (the config only references them via `rgb(var(--token))`), so the palette swap happens there. Replaces the old blue-gray/lime "AProjectO" palette with DESIGN.md's warm-charcoal surfaces + Elitery Green primary.

- **[frontend/src/index.css](frontend/src/index.css)** — `.dark` block (canonical default) set to **exact** DESIGN.md dark frontmatter values: surfaces `#1a1a18`→`#3a3a37` charcoal ramp, `--primary` `#3aae51` (`58 174 81`), `--on-primary` `#0f2b16`, `--primary-container` `#2d9042`, neutral grey secondary/tertiary, softer red error family. Notably `--inverse-primary` was `0 88 190` (old Solvro Blue `#0058be`) → now `#2d9042`.
- **[frontend/src/index.css](frontend/src/index.css)** — `:root` (light) block set to DESIGN.md light overrides where defined: off-white surfaces (`#f9f9f7`/`#f2f2ee`/`#ffffff`), `--primary` `#2d9042` (darkened green for WCAG on white), text `#1a1a18`/`#4a4a47`, outlines `#9a9a97`/`#d0d0cc`. **Derived (not specified by DESIGN.md for light mode):** `inverse-surface/-on-surface`, `primary-container` (`#c8e6cf`), `on-primary-container`, `inverse-primary`, `secondary`/`-container`/`on-`, `tertiary`/`on-`, and the error family (kept the existing M3 light reds). These are reasonable palette-consistent fills; adjust if the spec later defines them. Note: DESIGN.md's light `surface-container` comment value `#ebebе7` contains a stray Cyrillic `е` — used the intended `#ebebe7` (`235 235 231`).
- **[frontend/src/index.css](frontend/src/index.css)** — Network Diagram critical-path accent migrated off blue to honor the single-accent rule: light-mode `--diagram-glow` `0, 88, 190` → `58, 174, 81` and `--cp-stroke` `#0058be` → `#3aae51`. Dark-mode diagram accent (white) unchanged.
- **Not changed**: chip/status tokens (`--emerald/amber/rose/violet-*`) — these are intentionally high-saturation status indicators per DESIGN.md "Semantic colors," independent of the brand primary. The `LabelPicker` swatch palette and customer `AVATAR_PALETTE` arrays still list `#0058be` as one selectable option among many — left as-is (palette choices, not the brand accent).
- **[backend/prisma/schema.prisma](backend/prisma/schema.prisma)** — `Label.color` default `#0058be` → `#3aae51`.
- **[backend/src/routes/projects.ts](backend/src/routes/projects.ts)** — label-create fallback `body.color ?? "#0058be"` → `"#3aae51"` (kept in lockstep with the schema default).
- **[backend/prisma/migrations/20260602223228_label_default_color_elitery_green/migration.sql](backend/prisma/migrations/20260602223228_label_default_color_elitery_green/migration.sql)** (new) — `ALTER TABLE "labels" ALTER COLUMN "color" SET DEFAULT '#3aae51'`. Generated via `prisma migrate diff` (non-interactive, per the migration gotcha), applied with `migrate deploy`, client regenerated; `migrate diff --exit-code` confirms zero remaining drift. Only changes the default for **new** labels — existing rows keep their stored color.

### Changed — 2026-06-02 — tailwind.config.ts: re-sync radius + typography tokens to DESIGN.md frontmatter

The literal-value tokens in the Tailwind theme had drifted larger than the canonical `DESIGN.md` frontmatter (`rounded` and `typography` blocks). Re-synced the two token groups that live as real values in the config; DESIGN.md frontmatter wins per CLAUDE.md.

- **[frontend/tailwind.config.ts](frontend/tailwind.config.ts)** — `borderRadius` scale reset to the spec: `sm 0.125 / DEFAULT 0.25 / md 0.375 / lg 0.5 / xl 0.75rem / full 9999px`. Previously `DEFAULT 0.5 / lg 1 / xl 1.5 / 2xl 2rem` — larger than spec, which forbids large radii. **Visual impact**: `rounded` (256 uses) 8px→4px, `rounded-lg` (39) 16px→8px, `rounded-xl` (8) 24px→12px. `2xl` key dropped (DESIGN.md defines none); the single `rounded-2xl` site falls back to Tailwind's built-in `2xl` (1rem). `rounded-full` (50, pills/avatars) unchanged.
- **[frontend/tailwind.config.ts](frontend/tailwind.config.ts)** — named `fontSize` roles reset to spec px: `h1 32 / h2 24 / body-lg 16 / body-sm 14 / data-mono 13 / label-caps 11`. Were inflated +1–2px. The generic `xs..4xl` scale (separate, deliberate +1px readability override, not a DESIGN.md token) is left untouched.
- **Not touched**: color tokens. They are CSS-var-indirected (`rgb(var(--token))`), so their literal values live in `src/index.css`, not the config — and that file currently does **not** match the new DESIGN.md palette (Elitery Green `#3aae51` + warm-charcoal surfaces). `index.css` still carries `--primary: 141 198 63` (`#8DC63F`) and blue-gray surfaces. Migrating colors to DESIGN.md requires a separate `index.css` edit and is left pending a decision (large visual change).

### Fixed — 2026-06-02 — IDOR follow-up: close remaining unguarded item routes; centralise visibility helpers

Review of the prior IDOR sweep found four resources still reachable by id without a visibility check, plus a duplicated helper and a 400-vs-404 oracle. Closed all of them and moved the shared helpers out of the route file.

- **[backend/src/lib/visibility.ts](backend/src/lib/visibility.ts)** (new) — canonical home for `projectVisibilityFilter`, `ensureProjectVisible`, `ensureTaskVisible`. Previously these lived in `routes/projects.ts` and were imported by sibling routers (`risks`, `tasks`, `dependencies`, `overview`), which is a latent circular-import hazard (projects.ts can't import a sibling route that imports it back). Lifting them to `lib/` removes that coupling. Behaviour identical.
- **[backend/src/routes/sections.ts](backend/src/routes/sections.ts)** — `PATCH /:id` and `DELETE /:id` were gated only by `requirePermission("project:write")`; any writer could mutate sections on projects they can't see by guessing the id. Added `ensureSectionVisible` (resolve `projectId` → `ensureProjectVisible`, 404 if not visible) to both.
- **[backend/src/routes/labels.ts](backend/src/routes/labels.ts)** — same IDOR on `PATCH /:id` / `DELETE /:id` (gated only by `task:write`). Added `ensureLabelVisible`.
- **[backend/src/routes/tasks.ts](backend/src/routes/tasks.ts)** — `PATCH /:id` ran `ensureTaskVisible` *after* the `parentTaskId === id` self-parent guard, so a caller could distinguish "task exists but not visible" (400) from "no such task" (404) — an existence oracle. Moved the visibility check ahead of all field validation. Import now from `../lib/visibility.js`.
- **[backend/src/routes/risks.ts](backend/src/routes/risks.ts)** — removed the local `ensureProjectVisible` copy (which carried a `req as never` cast hack) in favour of the canonical helper; calls now pass `req.user!` directly.
- **[backend/src/routes/projects.ts](backend/src/routes/projects.ts)** — `POST /:id/baseline` had `project:write` but no visibility check; added `ensureProjectVisible`. Replaced six inline find-or-404 visibility blocks (risks/notes/dependencies GET+POST) with `ensureProjectVisible` calls. Helper definitions removed (now imported from `lib/visibility.js`).
- **[backend/src/routes/dependencies.ts](backend/src/routes/dependencies.ts)**, **[backend/src/routes/overview.ts](backend/src/routes/overview.ts)** — import path updated to `../lib/visibility.js`; no logic change.
- No schema/migration changes. Backend `tsc --noEmit` clean.

### Fixed — 2026-05-20 — IDOR cluster on task/section/label/project-PATCH endpoints

A read-only audit found that `projectVisibilityFilter` was correctly applied on the routes added later (risks, notes, dependencies) but skipped on the older task/section/label routes and on the project PATCH route. As a result, any authed user with `task:write` or `project:write` (the default TAM role grants both globally) could read or mutate resources in any project by guessing the ID — the permission gate was the only thing scoping them, and permission ≠ visibility. Closed in one sweep across 11 routes.

- **[backend/src/routes/projects.ts](backend/src/routes/projects.ts)** — added `ensureProjectVisible(user, projectId)` and `ensureTaskVisible(user, taskId)` helpers right under `projectVisibilityFilter`. Both follow the existing find-or-404 pattern used at risks/notes/dependencies (return 404, not 403, so the caller can't probe project existence). Wired into: `PATCH /:id`, `GET /:id/tasks`, `POST /:id/tasks`, `GET /:id/sections`, `POST /:id/sections`, `GET /:id/labels`, `POST /:id/labels`. The collection POSTs (`/tasks`, `/sections`, `/labels`) and the project PATCH were the data-mutation holes; the GETs were enumeration holes.
- **[backend/src/routes/tasks.ts](backend/src/routes/tasks.ts)** — extended the `./projects.js` import to pull in `ensureTaskVisible`. Wired into: `PATCH /:id`, `DELETE /:id`, `GET /:id/comments`, `POST /:id/comments`. The task lookup is gated on the parent project's visibility filter, so a TAM with global `task:write` can no longer reach into tasks on projects they aren't assigned to.
- **Behaviour unchanged** for users with `project:view-all` or `*` (admin / STAKEHOLDER): `projectVisibilityFilter` short-circuits to `{}`, so the visibility lookup finds the row and the request proceeds. No schema/migration changes; the helpers are pure async functions added to existing files.

### Removed — 2026-05-20 — `blueprint:create` / `blueprint:read` permissions (dead — not enforced anywhere)

The two `blueprint:*` permission strings were placeholders for the Secure Ingestion Port (the planned SA blueprint → tasks webhook), which is not yet built. A repo-wide grep confirmed zero enforcement: no backend `requirePermission("blueprint:…")` or `hasPermission(user, "blueprint:…")` call sites, no `/webhook/blueprint` route, no frontend gate. Their only presence was the SA role seed and the PERMISSION_CATALOG tick-box, where they read as functional permissions but did nothing. Removed to stop confusing the editor; when the ingestion port is implemented they'll be re-introduced alongside the actual gate.

- **[frontend/src/lib/auth.tsx](frontend/src/lib/auth.tsx)** — dropped from `PERMISSION_CATALOG` (no more tick-boxes for them in Admin > Roles).
- **[backend/prisma/seed.ts](backend/prisma/seed.ts)** — `SA` role permissions reduced from `["blueprint:create", "blueprint:read", "project:read"]` to `["project:read"]`. Seed upserts on every deploy, so existing SA roles get the two strings stripped on next backend start. No behavior change (they weren't enforcing anything).

### Changed — 2026-05-20 — Admin > Roles: tidy the layout (visual only)

Polish pass on the Roles tab after Phase 1. No logic changes; typecheck clean.

- **[frontend/src/pages/Admin.tsx](frontend/src/pages/Admin.tsx)** — `PermissionPicker` is now a vertical **single-column list** (one permission per row, hairline dividers, hover highlight, `checkbox · mono-key · — label`), instead of a multi-column grid where short keys (`*`) sat next to wider ones (`project:view-all`) and made the layout look ragged. The create-role form is **stacked** (Role name on top, Permissions below, Add-role button right-aligned in a footer row) — no more side-by-side fields, and the Role-name input stretches to the full form width so it visually anchors with the permissions list. The help paragraph is trimmed to two short sentences with `code` highlights; the "Reserved" badge is recoloured to a neutral surface tone so it no longer competes with the green `*` chip; in the table, the permissions cell renders **per-permission chips** (mono pill each), with `*` shown as a "★ full access" primary-tone chip for scannability.

### Changed — 2026-05-20 — RBAC Phase 1: role-name teardown (visibility + admin/services + role rename + UI)

Follow-up to the scoped-safe RBAC change below. Operator decided the 5 "built-in" roles should no longer be special. Phase 1 (no schema migration) removes the role-name dependency from project visibility, the admin gate, services writes, project reassignment, and the frontend role-name gates; built-in protection collapses to PENDING only (Google first-login still finds it by name — Phase 2 turns that into a configurable default role on `AuthConfig`).

- **Backend visibility (the actual fix)** — [backend/src/routes/projects.ts](backend/src/routes/projects.ts) `projectVisibilityFilter` no longer switches on `STAKEHOLDER`/`TAM`/`SA`. New rule: `hasPermission(user, "project:view-all")` (which `"*"` also satisfies) → all projects; otherwise → `{ OR: [{ saId: user.sub }, { tamId: user.sub }] }` (you see what you're attached to). [backend/src/routes/overview.ts](backend/src/routes/overview.ts) now imports the same helper instead of its own switch — single source of truth.
- **Seed** — [backend/prisma/seed.ts](backend/prisma/seed.ts) adds `project:view-all` to `STAKEHOLDER` so it keeps seeing every project after the name-switch is gone (seed upserts on every deploy, so this lands automatically; existing STAKEHOLDER JWTs are stale until re-login, ≤8h).
- **Services + admin de-naming** — [backend/src/routes/services.ts](backend/src/routes/services.ts) replaces `requireRole("ADMIN")` with the permission-based `requireAdmin`. [backend/src/routes/admin.ts](backend/src/routes/admin.ts): `BUILTIN_ROLES` collapsed to `PROTECTED_ROLES = {"PENDING"}` (only PENDING is still reserved); ADMIN-immutable in `PATCH /roles/:id` removed (anti-lockout `ensureAdminsRemain` now protects); the "reassign target must be TAM/ADMIN" check on `PUT /projects/reassign` is gone (any active user is eligible).
- **Role rename** — `PATCH /admin/roles/:id` accepts an optional `roleName` (same uppercase regex as create, blocks renaming a reserved role or taking a reserved name, blocks collisions). [frontend/src/lib/queries.ts](frontend/src/lib/queries.ts) `useAdminUpdateRolePermissions` extended to send `roleName`; also invalidates the users query so the user-tab role labels refresh after a rename.
- **Frontend de-naming** — [frontend/src/components/ProjectFormModal.tsx](frontend/src/components/ProjectFormModal.tsx) + [frontend/src/components/CustomerFormModal.tsx](frontend/src/components/CustomerFormModal.tsx) SA/TAM dropdowns list all users (role-name filter dropped; auto-default of self-as-TAM removed). [frontend/src/pages/views/ProjectKanban.tsx](frontend/src/pages/views/ProjectKanban.tsx) drag-gate switched from `role === "TAM"||"ADMIN"` to `hasPermission(user, "task:write")`. [frontend/src/pages/Admin.tsx](frontend/src/pages/Admin.tsx): Roles tab now has an inline rename input (disabled for the reserved PENDING row); the "Built-in" badge becomes "Reserved" and only shows for PENDING; "Edit perms" → "Edit" (covers name + perms); reassign-target list (`tamCandidates`) drops the TAM/ADMIN name filter (lists all active users). Help text rewritten to explain `*` = admin and `project:view-all` = see-all. [frontend/src/lib/auth.tsx](frontend/src/lib/auth.tsx) PERMISSION_CATALOG gains `project:view-all`.

Known caveats (flagged, not fixed): (1) existing JWTs for STAKEHOLDER users won't have `project:view-all` until they re-login (≤8h token expiry); during the gap they will only see assigned projects. (2) `useUsers()` returns no `active` field, so the SA/TAM dropdowns list all users including deactivated; cleanup if it becomes a UX issue. (3) Phase 2 (deferred): replace the hardcoded `roleName: "PENDING"` in Google provisioning with `AuthConfig.defaultRoleId` (Prisma migration); PENDING stays reserved until then. (4) CLAUDE.md's "built-in roles are structural" architecture note is now partially stale (it's gitignored, not rewritten here).

### Changed — 2026-05-16 — RBAC: permission-based admin gate + tick-box permission editor

Admin requested roles/permissions to feel admin-managed rather than hardcoded, and the permissions field to be a picker. Scoped to the safe core (the user explicitly chose this over a full role-name teardown, which would have broken relational project visibility and risked admin lockout — SA/TAM/STAKEHOLDER/PENDING name-based logic is intentionally left intact).

- **[backend/src/http/auth.ts](backend/src/http/auth.ts)** — `requireAdmin` no longer checks `role === "ADMIN"`; it now requires the `*` wildcard permission (`hasPermission(req.user, "*")`). Any role granted `*` is an admin, so an admin can create their own admin-equivalent custom role.
- **[backend/src/routes/admin.ts](backend/src/routes/admin.ts)** — added `ensureAdminsRemain(tx)`: after a role-permission edit (`PATCH /roles/:id`) or a user role reassignment (`PATCH /users/:id/role`), a transaction-wrapped count asserts ≥1 active user still has a `*` role, else it rolls back with HTTP 409 `would_lock_out`. Prevents the new model's lockout (removing the last full-access admin would make `/admin` unreachable). Existing self-demote/self-deactivate guards retained. Built-in role rename/delete protections + ADMIN-immutable retained.
- **[frontend/src/lib/auth.tsx](frontend/src/lib/auth.tsx)** — added `PERMISSION_CATALOG` (curated vocabulary: `*`, `project:read|write`, `task:read|write`, `blueprint:create|read`, `report:read`) for the editor. Backend still stores permissions as a free string array; the catalogue is a UI affordance, not server-enforced.
- **[frontend/src/components/AdminGuard.tsx](frontend/src/components/AdminGuard.tsx)**, **[frontend/src/components/layout/Sidebar.tsx](frontend/src/components/layout/Sidebar.tsx)** — admin route guard + sidebar "Admin" item now gate on `hasPermission(user, "*")` instead of `role === "ADMIN"`.
- **[frontend/src/pages/Admin.tsx](frontend/src/pages/Admin.tsx)** — new `PermissionPicker` checkbox component replaces the comma-separated free-text input for both create-role and edit-perms; `*` supersedes (implies + disables the rest). Roles-tab help text rewritten to explain the permission-based admin model.

Known gap (flagged, not fixed): `PATCH /users/:id/deactivate` is not wrapped by `ensureAdminsRemain` — deactivating the last *other* admin user could still lock out (self-deactivate is already blocked). Lower-likelihood vector via the UI; can add the same guard if needed. No schema/migration changes.

### Changed — 2026-05-16 — Prod deploy: configurable bind address (BIND_ADDR)

Follow-up to the "configurable, local-only host ports" entry below. That change bound every published port to `127.0.0.1`, which the operator discovered makes the app unreachable from their machine (loopback only) — "local only" was meant as "our private network", not "loopback". `setup.sh` now exposes the bind interface as a knob; the secure `127.0.0.1` default is unchanged so nobody who doesn't set it is affected.

- **[setup.sh](setup.sh)** — adds `BIND_ADDR` (env var or interactive prompt, same intake pattern as the ports; default `127.0.0.1`). `0.0.0.0` publishes the website + API on all interfaces (reachable on the network); a specific IPv4 publishes on just that interface. Validated via a new `is_ipv4` helper (dotted-quad, octets 0–255; rejects hostnames/IPv6). Threaded into `write_compose_file` as `${BIND_ADDR:-127.0.0.1}:` on the frontend and backend mappings (literal in the single-quoted heredoc → resolved by compose from `~/solvro/.env`), persisted to `.env`, and reused on the update branch (it already sources `.env`). The readiness probe now targets a computed `HEALTH_HOST` (`127.0.0.1` for `127.0.0.1`/`0.0.0.0`, else the bind IP) so a specific-IP bind doesn't break the wait loop. Success/update banner, tunnel-vs-network guidance, and the Google-OAuth origin hint are now `BIND_ADDR`-aware.
- **Postgres stays loopback by design:** the conditional `postgres` `ports:` block remains hardcoded to `127.0.0.1` regardless of `BIND_ADDR` — exposing the database on the network just because the web app is exposed would be a footgun. Documented in-script. Security note: with `BIND_ADDR=0.0.0.0`/a LAN IP, only the in-app login protects the app at the network layer (CORS is `*`); keep it behind a trusted network/VPN/firewall.
- No application/image/schema changes; container ports (80/3000/5432) and the internal nginx→`backend:3000` proxy are untouched.

### Fixed — 2026-05-16 — Random Postgres password could break DATABASE_URL (P1013)

Surfaced while testing the configurable-ports change on the server (not caused by it — the lines below predate that commit). `POSTGRES_PASSWORD` was generated with `openssl rand -base64 24`, whose alphabet includes `/`. When the random draw contained a `/`, the backend's `DATABASE_URL` (`postgresql://solvro:<pw>@postgres:5432/...`) had its authority truncated at that `/`, so the parser read a bogus port and crash-looped with `P1013: invalid port number in database URL`. ~40% of fresh installs were affected (probabilistic — earlier installs drew safe passwords); Postgres itself was Healthy, only the URL string was mis-parsed.

- **[setup.sh](setup.sh)** — `POSTGRES_PASSWORD` is now `openssl rand -hex 24` (48 chars, 192 bits, alphabet `[0-9a-f]` only — URL-safe everywhere it is used), mirroring the adjacent `JWT_SECRET` hex generation. Single line changed; the fresh-install path already wipes `solvro_pgdata` and re-initialises Postgres with the new password, so there is no stale-credential mismatch. No change to `${POSTGRES_PASSWORD}` interpolation, the `.env` write, or the compose template.

### Changed — 2026-05-16 — Prod deploy: configurable, local-only host ports in setup.sh

Deploying onto a server with other containers (host port 80 already taken by another app; another Postgres on 127.0.0.1:5432). The prod stack had hardcoded `80:80` / `3000:3000` host publishes and no knob to change them. Ports are now configurable at install, and—per the operator's decision that this instance is accessed locally only—every port binds to `127.0.0.1` instead of `0.0.0.0`.

- **[setup.sh](setup.sh)** — adds `FRONTEND_PORT` (default 80), `BACKEND_PORT` (default 3000), and optional `POSTGRES_PORT` (default: **not published** — DB stays private as before). Each is taken from an env var or an interactive `/dev/tty` prompt with the default pre-filled (mirrors the existing `ADMIN_EMAIL`/`ADMIN_PASSWORD` intake; non-interactive runs fall back to defaults). Validated as integers 1–65535, must be distinct. Persisted to `~/solvro/.env`; frontend/backend resolve via compose `${VAR:-default}` interpolation so they can be changed later by editing `.env` + `docker compose up -d`. Compose generation moved into a `write_compose_file` function called **after** ports are known (both the fresh-install and update branches; the update branch sources `~/solvro/.env` first), because the Postgres `ports:` block is conditional (emitted only when `POSTGRES_PORT` is set) — interpolation can't express an optional key. Healthcheck wait, success/update messages, and the Google-OAuth origin hint now use the chosen ports and an SSH-tunnel note. Container ports (80/3000/5432) and the app images are unchanged; nginx still proxies `/api` to the internal `backend:3000`.
- **Behavior change to note:** all published ports now bind to `127.0.0.1` (local-only) instead of `0.0.0.0`. A *re-run/update of any existing install* therefore also flips it to localhost-only (reach it via SSH tunnel). Intended per the approved plan; no application code, schema, or image changes.

### Changed — 2026-05-16 — Overview: personalized welcome, project health signal, "needs attention" list

Three targeted UI fixes to the global Overview page (no other files touched; no new imports).

- **[frontend/src/pages/Overview.tsx](frontend/src/pages/Overview.tsx)** — (1) Heading is now `Welcome back, {firstName}.` via a new `firstNameOf` helper: `AuthUser` carries no name field, so the first name is derived from `username` (falling back to `email`) by splitting on `.`/`@` and capitalizing. (2) Each card in the recent-projects list gets a 3px health-signal left border (inline `borderLeft*` style — layout/padding unchanged): ACTIVE → `#8DC63F`, PLANNING/ON_HOLD/COMPLETED → `#6B7280`. (3) Section heading renamed "Recently updated projects" → "Projects needing attention"; the list is sorted by health rank (at-risk → on-track → neutral) then `updatedAt` desc within a bucket, before `slice(0, 6)`.

Limitation flagged in-code: the overview query (`OverviewProject`) returns no per-project overdue count, so the amber `#F59E0B` "at risk" state is unreachable and ACTIVE always reads as on-track. `TODO(health-signal)` comments on `healthColor`/`healthRank` mark where to re-rank ACTIVE+overdue once that data is exposed.

### Changed — 2026-05-16 — Login screen restyled to the Elitery split-panel design

Visual-only revamp of the sign-in screen. **No auth logic, handlers, API calls, or conditional rendering were touched** — `messageForApiError`, all state, `handleGoogleCredential`, `handlePasswordSubmit`, the authenticated redirect, the Google config ternary, and the `<details>` admin form are byte-for-byte unchanged.

- **[frontend/src/pages/Login.tsx](frontend/src/pages/Login.tsx)** — split panel: dark `#191919` brand panel (left 44%, `md:grid-cols-[44%_1fr]`, `h-screen overflow-hidden`) with three decorative rings, "SV" wordmark, eyebrow/headline/body/pills hero block, and the version string; white right panel with a 280px-max centered column, restyled "Sign in" header, the existing Google block, the OR divider, the admin password `<details>`, and an "Internal use only · Elitery © 2026" footer. Greens are expressed via the `primary` token with alpha (`text-primary`, `border-primary/30`, `border-primary/[0.12]`) since `--primary` is already `#8DC63F` — keeps the screen themed per CLAUDE.md rather than hardcoding the brand hex. The bespoke dark surface (`#191919`/`#2e2e2e`) and white-overlay opacities have no token and are inline per the explicit spec. Admin inputs now use the spec focus ring (`focus-within:border-[#8DC63F]` + `0 0 0 3px rgba(141,198,63,0.15)` shadow); the admin submit button is `#191919` → `#2e2e2e` on hover.

Flagged deviation: the spec's custom green "Sign in with Google" button was **not** applied — the Google sign-in is the `@react-oauth/google` `<GoogleLogin>` iframe widget, which cannot be recolored without switching to `useGoogleLogin` (an auth-handler change explicitly forbidden by the task). The official widget + its surrounding block are kept verbatim. "No scrolling" is honored at the page level (`overflow-hidden`); the collapsed-by-default admin form fits typical viewports but is not independently scrollable if expanded on a very short screen.

### Fixed — 2026-05-15 — ADMIN (wildcard) users see all active projects on Daily Review & Reports

The Daily Review / Reports rework scoped the project list to `tamId === user.id`, which left built-in ADMIN (and any custom role with `*`) seeing an empty list — flagged at the time. Now wildcard-permission users see every `ACTIVE` project; a TAM stays scoped to the ones they own.

- **[frontend/src/pages/Reports.tsx](frontend/src/pages/Reports.tsx)**, **[frontend/src/pages/DailyReview.tsx](frontend/src/pages/DailyReview.tsx)** — filter is now `status === "ACTIVE" && (hasPermission(user, "*") || p.tamId === user.id)`, using the canonical `hasPermission` gate from `@/lib/auth` (the same wildcard convention used across the app and mirroring the backend `projectVisibilityFilter`). Empty-state copy de-assumes ownership ("No active projects to export/review"). Scope stays **ACTIVE-only** on both screens (they are active-project tools); wildcard users are not shown non-active projects here. STAKEHOLDER is not special-cased (request was ADMIN-specific); flag if it should also see all.

### Changed — 2026-05-15 — Daily Review reworked into a cross-project review console

UI + logic pass on the existing Daily Review page (not a rebuild). Replaced the two-column "note rows + notes-log pane" layout with a single scrollable cross-project view: a session stats bar plus one metric-rich card per active project. This makes it the morning review console described in CLAUDE.md "Daily Review screen".

- **[frontend/src/pages/DailyReview.tsx](frontend/src/pages/DailyReview.tsx)** — rewritten in place (named `export function DailyReview()` kept, so the `/daily-review` route is unchanged). Each `ProjectCard` pulls per-project data via the requested hooks (`useProjectTasks`/`useProjectRisks`/`useProjectNotes`/`useAddProjectNote`) and shows: name, customer, current phase, progress %, overdue count, open-risk count, and a schedule-variance chip. Cards lift their metrics to the parent, which aggregates the top stats bar (projects reviewed, notes written today, overdue total, open-risks total). The visibility toggle now makes **CUSTOMER_FACING visually prominent** (brand-accent fill + `campaign` icon + an explicit "will be included in the customer export" caption); INTERNAL stays the quiet default. Save still relies on the server's automatic `createdAt`; a transient "Saved HH:MM" confirms it.

Decisions / changes from prior behaviour (flagged): (1) Project scope tightened to `tamId === user.id && status === "ACTIVE"` — previously the page showed all `ACTIVE || PLANNING` projects to everyone with no TAM scoping; PLANNING is now excluded and non-TAM roles see an empty list, matching the Reports screen's scoping. (2) The right-hand **Notes-log / history pane was removed** — the new spec defines the page as the logging console (stats + cards) and doesn't include a history browser; per-project history still lives on the project pages. (3) "Current phase" / schedule variance reuse the same derivations as the Reports export (earliest unfinished section by `position`; max `dueDate` vs max `baselineDueDate`) — kept inline rather than imported from `lib/export/projectExport.ts` so that dynamically-imported export module stays out of the main bundle. (4) "Notes written today" / "projects reviewed" count only the logged-in user's own notes dated today (session-accurate), not all authors'.

### Changed — 2026-05-15 — Reports rebuilt as the customer export-packet screen

Replaced the Reports analytics dashboard (recharts pie charts + KPI strip) with the export flow from CLAUDE.md "Reports screen (revamp pending)". Reports is now the **output** screen of the core TAM loop: pick an active project → generate a structured markdown packet → copy/download → paste into an external AI tool. No native AI summarisation (deliberately deferred per CLAUDE.md).

- **[frontend/src/lib/export/projectExport.ts](frontend/src/lib/export/projectExport.ts)** (new) — pure, React-free builder `buildProjectExportMarkdown(input)` plus `downloadMarkdownFile()` / `exportFileName()` helpers. Packet sections: identity, health (progress %, schedule variance vs. baseline), phase breakdown, task signals (overdue/blocked/completed counts — not the task list), open risks with score = probability×impact, and customer-facing notes from the last 14 days. Loaded via dynamic `import()` at the call site so it stays out of the main bundle (same discipline as the Gantt export layer).
- **[frontend/src/pages/Reports.tsx](frontend/src/pages/Reports.tsx)** — rewritten. Lists the logged-in TAM's `ACTIVE` projects (`p.tamId === user.id && p.status === "ACTIVE"`); selecting one fetches its data via existing hooks (`useProjectTasks`/`useProjectRisks`/`useProjectSections`/`useProjectNotes`/`useProjectDependencies`), renders a live markdown preview, and offers Copy + Download .md. The notes hook is queried with `visibility: "CUSTOMER_FACING"` and the builder **re-filters** to `CUSTOMER_FACING` defensively, so INTERNAL notes cannot reach the export under any path. `recharts` is no longer imported by this page. Kept the named `export function Reports()` so the `App.tsx` `/reports` route is unchanged.

Decisions / limitations (flagged): (1) "blocked" has no first-class model field, so it is derived as a not-done task with a not-done predecessor — this required `useProjectDependencies`, one hook beyond the five named in the request, because the named hooks carry no blocked signal. (2) `Task` has no completion timestamp, so "completed" is cumulative DONE count, not a 14-day window — labelled as such in the packet. (3) "Current phase" has no model concept; derived as the earliest section (by `position`) with unfinished tasks. (4) Project scoping is `status === "ACTIVE"` only (PLANNING/ON_HOLD excluded) and `tamId === user.id`, so non-TAM roles (e.g. ADMIN) see an empty list on this screen by design.

### Changed — 2026-05-15 — Primary color rebranded to Elitery green

App primary action color changed from Solvro Blue (`#0058be`) to the Elitery brand green (`#8DC63F`), with the hover/active variant set to `#7AB52F`. Brand change only — surface, semantic status (success/warning/error/info), and chip tokens are untouched.

- **[frontend/src/index.css](frontend/src/index.css)** — `--primary` `0 88 190` → `141 198 63` (#8DC63F) and `--primary-container` `33 112 228` → `122 181 47` (#7AB52F) in **both** the `:root` (light) and `.dark` blocks so the brand is consistent across themes. `--primary-container` is the codebase's de-facto hover/active variant (the dominant button pattern is `hover:bg-primary-container`), so the requested "hover/active variant" maps onto it.
- **[frontend/tailwind.config.ts](frontend/tailwind.config.ts)** — no change required: `primary` / `primary-container` are defined as `rgb(var(--primary) / <alpha-value>)`, indirected through the CSS vars above, so they pick up the new ramp automatically (Tailwind opacity utilities like `bg-primary/90` still work).

Out of requested scope, flagged for follow-up: `--on-primary` stays white in light mode — white-on-`#8DC63F` is low-contrast (~1.8:1, fails WCAG AA); `--inverse-primary` and the `.diagram-canvas` `--cp-stroke` / `--diagram-glow` literals remain blue.

### Changed — 2026-05-15 — Task drawer slides out on close (exit animation)

Follow-up to the task-drawer change below. The drawer slid in but vanished instantly on close because every call site conditionally unmounts the form (`{editTask && <TaskFormModal …/>}`), so an exit animation couldn't be driven off `open` alone. Rather than touch the 7 call sites, the close is now orchestrated in `TaskFormModal` (it owns every close trigger) and `Drawer` defers the real unmount until the slide-out transition finishes.

- **[frontend/src/components/Drawer.tsx](frontend/src/components/Drawer.tsx)** — added a `closing` prop (drives the slide-out) and an `onClosed` callback (fired on the panel's `transitionend` for `transform`, with a 280ms fallback for reduced-motion / hidden-tab). Esc and click-outside call `onClose` so the owner can start the animated close instead of unmounting synchronously.
- **[frontend/src/components/TaskFormModal.tsx](frontend/src/components/TaskFormModal.tsx)** — added a `closing` state + `requestClose()`; every close path (Cancel, header ×, Esc, click-outside, and post-submit / post-delete success) now calls `requestClose()` which sets `closing`. The parent's real `onClose` (which unmounts the component) is passed as `onClosed`, so it only runs after the slide-out completes. No call-site or `TaskFormModalProps` changes.

### Changed — 2026-05-15 — Task drawer offset below the TopBar

Follow-up to the task-drawer change below. The drawer (and its click-catcher) covered the full viewport including the TopBar. Now the whole overlay starts at `top-14` so the TopBar stays visible **and** interactive (search / notifications / account) above the drawer — matching the `RightSidebar` offset. Click-outside-closes now applies only to the board area below the TopBar.

- **[frontend/src/components/Drawer.tsx](frontend/src/components/Drawer.tsx)** — wrapper `fixed inset-0` → `fixed inset-x-0 bottom-0 top-14`. Panel `h-full` now fills the space between the TopBar and the viewport bottom (desktop + mobile).

### Changed — 2026-05-15 — Task form opens as a right-side drawer instead of a centered blurred modal

The Add/Edit task form was a centered modal with a `backdrop-blur-sm` scrim that hid the board. TAMs wanted to keep the List/Kanban/Gantt visible while creating or editing a task. Now it slides in from the right with no blur; the board stays visible behind it and a click outside the panel closes the drawer. Applies to **both** create and edit (one consistent flow — not a split where create is a drawer and edit a modal).

- **[frontend/src/components/Drawer.tsx](frontend/src/components/Drawer.tsx)** (new) — right-anchored slide-in panel mirroring the `RightSidebar` transform pattern (`translate-x-full` → `translate-x-0`, `duration-200 ease-out`). Transparent full-area click-catcher (`onMouseDown={onClose}`) — no dim, no blur, so the board behind reads normally but the first outside click dismisses. Esc closes. Mobile collapses to a full-screen sheet (`w-full`), matching the app's `md:` breakpoint convention. Same prop shape as `Modal` (`title` / `customHeader` / `footer` / `widthClass`) so it's a drop-in for form panels. No exit animation — call sites already conditionally unmount the form on close (parity with `Modal`).
- **[frontend/src/components/TaskFormModal.tsx](frontend/src/components/TaskFormModal.tsx)** — swapped `Modal` → `Drawer` (import + open/close tags only). All props, the custom header, `widthClass="max-w-lg"`, and the 7 call sites are unchanged — `TaskFormModalProps` is untouched, so Tasks / ProjectGantt / ProjectKanban / ProjectTimeline / ProjectList need no edits.
- **[frontend/src/components/Modal.tsx](frontend/src/components/Modal.tsx)** — left as-is. `ConfirmModal` and the Admin Sign-in modal still want the centered/blur treatment; only the task form moved to a drawer.

Body scroll is intentionally **not** locked (unlike `Modal`) so the board stays usable until the click that closes the drawer. Frontend `npm run typecheck` clean.

### Fixed — 2026-05-15 — Gantt: connector hit-testing no longer shadows bar resize handles

Regression from the "deletable connectors" change immediately below (caught in testing — bar resize only worked on the left edge). The transparent 14px connector hit path sits above the bars and, near each endpoint, overlapped the bars' 6px resize handles; the invisible `opacity-0` connector dots were also still capturing pointer-downs at the bar edges.

- **[frontend/src/components/gantt/GanttConnectors.tsx](frontend/src/components/gantt/GanttConnectors.tsx)** — connector routes are now built as a point list; the visible path uses the full route while the **hit path is arc-length-trimmed `HIT_TRIM=14`px off both ends** (`trimPolyline` helper), keeping the fat hit strip clear of the resize handles + connector dots at each bar edge. Falls back to the full route only for pathologically short connectors (still deletable). Visible arrows are unchanged (axis-aligned `L` segments render identically to the prior `H`/`V`).
- **[frontend/src/components/gantt/GanttBar.tsx](frontend/src/components/gantt/GanttBar.tsx)** — both connector dots get `pointer-events-none` + `group-hover:pointer-events-auto`, so while a row isn't hovered the (invisible) dots don't intercept resize-handle pointer-downs; they only become interactive when revealed on hover.

Frontend `npm run typecheck` clean.

### Added — 2026-05-15 — Gantt: left+right hover-revealed dependency handles, deletable connectors

Two gaps in the Gantt dependency interaction. Frontend-only — no schema/API change; the `useDeleteDependency` hook and `DELETE /dependencies/:id` route already existed and were simply unwired.

- **Left-edge dependency handle** added alongside the existing right one. Right handle keeps today's semantics (grabbed task = predecessor, drop target = successor). Dragging from the **left** handle creates a *reverse* dependency: the drop target becomes the predecessor and the grabbed task the successor — the standard Gantt "this task depends on that one" gesture. Arrows still always render predecessor-right → successor-left, so left-handle deps render identically to right-handle ones and `GanttConnectors` path math is unchanged. The persisted `sourceHandle: "right-source"` / `targetHandle: "left-target"` is unchanged for the same reason.
- **Both handles are now hover-revealed per bar row** instead of sitting at a permanent `opacity-70` (visual noise). Gated via a `group` class on the `GanttRow` container + `group-hover:opacity-100` on the handle dots.
- **Connectors are now hover-highlightable and deletable.** Hovering a connector thickens/brightens it and shows an inline × button at the midpoint of its main run; one click removes the dependency. No confirm dialog — deletion is trivially redoable by re-dragging, and creation has no confirm either, so a modal would be inconsistent friction. A transparent 14px-wide hit path (`pointer-events: stroke`) makes the thin 1.5px line hoverable; the connector `<svg>` was raised to `zIndex: 5` (above bars at 2–3 and the rubber-band overlay at 4) with `pointer-events-none` retained on the `<svg>` so only the hit strip and × capture events — bars stay fully draggable.

Files: **[frontend/src/components/gantt/GanttBar.tsx](frontend/src/components/gantt/GanttBar.tsx)** (left handle, hover-gate, `side` arg on `onConnectStart`), **[frontend/src/components/gantt/GanttRow.tsx](frontend/src/components/gantt/GanttRow.tsx)** (`group` on row container, prop type), **[frontend/src/components/gantt/GanttChartPane.tsx](frontend/src/components/gantt/GanttChartPane.tsx)** (thread `onDeleteDependency`, prop type), **[frontend/src/components/gantt/GanttConnectors.tsx](frontend/src/components/gantt/GanttConnectors.tsx)** (hit paths, hover state, × control, anchor math, z-index), **[frontend/src/components/gantt/GanttFrame.tsx](frontend/src/components/gantt/GanttFrame.tsx)** (`useDeleteDependency`, `handleDeleteDependency`, directional predecessor/successor swap in `handleConnectStart`). Read-only users (`canEdit` false) see no handles and no × — connectors render but are non-interactive. Frontend `npm run typecheck` clean.

### Changed — 2026-05-15 — UI tidy-up: login placeholder, Network Diagram removal, Daily Review two-pane log

Three bundled cleanups after the OAuth work shipped.

**Login placeholder** ([frontend/src/pages/Login.tsx](frontend/src/pages/Login.tsx)) — admin sign-in disclosure's email input no longer prefills with `admin@solvro.local` (leaked the seeded admin's email to anyone hitting `/login`). Now `you@example.com`.

**Network Diagram feature removed.** It duplicated Gantt's dependency arrows and wasn't used in production. The `TaskDependency` model, its routes, and the dependency hooks are **kept**: Gantt actively renders connector arrows ([frontend/src/components/gantt/GanttConnectors.tsx](frontend/src/components/gantt/GanttConnectors.tsx)) and lets users create new dependencies via drag ([frontend/src/components/gantt/GanttFrame.tsx](frontend/src/components/gantt/GanttFrame.tsx) → `useCreateDependency`). Anyone reading the schema in the future shouldn't be confused by the orphan-looking model — it powers Gantt's arrows.

- Deleted: `frontend/src/pages/views/ProjectDiagram.tsx`, `frontend/src/lib/diagram/{autoLayout,criticalPath,colorUtils}.ts`, `frontend/src/lib/diagram/` directory.
- **[frontend/src/App.tsx](frontend/src/App.tsx)** — dropped `import { ProjectDiagram }` and `<Route path="diagram" element={<ProjectDiagram />} />`. Visiting `/projects/<id>/diagram` now falls through to the catch-all `Navigate to="/"`.
- **[frontend/src/pages/ProjectDetail.tsx](frontend/src/pages/ProjectDetail.tsx)** — removed the `{ to: "diagram", label: "Diagram" }` entry from `TABS`. New tab order: Overview · List · Kanban · Gantt · Timeline · Risks.
- **[frontend/src/components/TaskFormModal.tsx](frontend/src/components/TaskFormModal.tsx)** — stripped the `isMilestone` checkbox UI (FieldRow + label), the `isMilestone` state, and the field from both `useCreateTask`/`useUpdateTask` payloads. Existing tasks load and save without it.
- **[frontend/src/lib/queries.ts](frontend/src/lib/queries.ts)** — removed `isMilestone`, `diagramX`, `diagramY` from `Task`, `UpdateTaskInput`, and `CreateTaskInput`. `useProjectDependencies`, `useCreateDependency`, `useUpdateDependency`, `useDeleteDependency`, `TaskDependency`, `DependencyType` all stay (Gantt depends on them).
- **[backend/src/routes/tasks.ts](backend/src/routes/tasks.ts)** — removed `isMilestone`/`diagramX`/`diagramY` from `updateTaskSchema` and the PATCH handler's `data` block.
- **[backend/src/routes/projects.ts](backend/src/routes/projects.ts)** — removed `isMilestone` from `createTaskSchema` and the create handler's `data`. Dependencies routes intact.
- **[backend/prisma/schema.prisma](backend/prisma/schema.prisma)** — dropped `Task.isMilestone`, `Task.diagramX`, `Task.diagramY` and the surrounding "Network Diagram fields" comment block. `predecessors`/`successors` relations on Task remain — Gantt reads them.
- **[backend/prisma/migrations/20260515120000_remove_diagram_task_fields/migration.sql](backend/prisma/migrations/20260515120000_remove_diagram_task_fields/migration.sql)** — `ALTER TABLE "tasks" DROP COLUMN ...` for the three columns. Non-rewriting Postgres DDL. Generated via `prisma migrate diff` (non-TTY shell, same workflow as the prior OAuth migrations).

**Daily Review two-pane layout** ([frontend/src/pages/DailyReview.tsx](frontend/src/pages/DailyReview.tsx)). Restructured the page into a `md:grid-cols-2` split: **left pane** is the existing per-project input cards (textarea + visibility toggle + save), **right pane** is a new `NotesLogPane` with a project `<select>` dropdown + date-grouped read view. The inline "Recent notes" sub-block under each project card is gone — replaced by the dedicated log pane that the user picks a project for. Mobile (`< md`) collapses to a single column with the log pane stacked below the input cards (per the established `md:` breakpoint pattern in CLAUDE.md). Notes are grouped under `Today` / `Yesterday` / locale-formatted dates (`Mon, May 13`) via a pure `groupNotesByDate` helper — no external deps. Each entry shows a visibility chip, author username, and `HH:MM`. The right pane is sticky on desktop (`md:sticky md:top-4 md:self-start`) so the log stays in view as the input list scrolls.

Where the persistent log lives, for the record: `project_notes` table in Postgres, indexed `(project_id, created_at)`, read via `GET /projects/:id/notes?limit=50` ([backend/src/routes/projects.ts](backend/src/routes/projects.ts)). The new Daily Review right pane is its canonical UI surface; the Reports export packet will read the same table later, filtered by visibility + last-14-days.

Backend `tsc --noEmit` and frontend `npm run typecheck` clean. No CHANGELOG-tracked compose/CI changes — pure code + schema + docs.

### Changed — 2026-05-15 — Admin > Sign-in: button + modal pattern, Client ID masked by default

The always-visible Client ID input and inline form felt like a configuration screen even when nothing was happening. Switched to a **connected-service summary**: status pill (Connected / Half configured / Not connected), domain count, a `Connect` / `Manage` button that opens a modal, and a read-only Client ID row with `123…xyz.apps.googleusercontent.com` masking + Reveal/Copy actions. The modal holds the actual edit form (Client ID with show/hide toggle, domain chip list with inline add) plus a `Disconnect` button in the footer that clears both fields in one PATCH. Form state resets on each open so reopening after Save reflects the latest server state.

The Client ID is still **not actually secret** — it ships in any Google sign-in button's HTML and is verifiable by anyone who inspects the network tab. Masking is purely a chrome decision: it stops the admin page from looking like a paste-bin and matches the user's expectation of how "connected identity provider" UIs typically present.

- **`frontend/src/pages/Admin.tsx`** — Replaced the inline `SignInTab` form with a status card (icon, status chip, domain count, `Connect` / `Manage` action). Added a `ClientIdField` component for the read-only display with masking + Reveal + Copy. Added a `SignInModal` component holding the actual edit form with show/hide on the Client ID input, domain chips, Cancel / Save / Disconnect actions. Added a `maskClientId()` helper that keeps the first 3 + last 3 chars of the project prefix and the full `.apps.googleusercontent.com` suffix. The modal resets its draft state on each open via a `useEffect` keyed off `open` so reopening doesn't surface stale edits.
- **`frontend/src/pages/Admin.tsx`** — Imported the existing `Modal` component (no new dep, no new abstraction).

No backend changes — the same `PATCH /admin/settings/auth` endpoint handles both fields, including `googleClientId: null` to clear it on Disconnect. Frontend `npm run typecheck` clean.

### Changed — 2026-05-14 — Google OAuth Client ID moved from env into DB-backed Admin > Sign-in

The hybrid model (Client ID in env, allowed-domains in DB) still required hardcoding the Client ID into compose/`.env`/CI build-args before any admin could turn on Google sign-in — and the frontend's build-time `VITE_GOOGLE_OAUTH_CLIENT_ID` forced a full rebuild every time the admin wanted to switch projects. Replaced with a fully **in-app** configuration model: both Client ID and allowed-domains live in the `AuthConfig` singleton, edited from `Admin > Sign-in`. Frontend fetches the Client ID at runtime from a new public endpoint and wraps `<GoogleOAuthProvider>` locally on the Login page when configured.

**Schema**

- **`backend/prisma/schema.prisma`** — `AuthConfig` gains `googleClientId String?`. Nullable so the singleton is valid before the admin configures it.
- **`backend/prisma/migrations/20260514130000_authconfig_google_client_id/migration.sql`** — single non-rewriting `ADD COLUMN`.

**Backend**

- **`backend/src/authConfig.ts`** — extended the in-process cache to include `googleClientId` and a **memoised `OAuth2Client` instance** keyed off it. Building a new `OAuth2Client` per request would re-derive the JWKS verifier cache; caching it means warm verification on every sign-in. Cache bust on PATCH propagates both the new ID and the new verifier together.
- **`backend/src/routes/auth.ts`** — removed the module-level `OAuth2Client` (was created from `env.GOOGLE_OAUTH_CLIENT_ID` at boot — dead now). `POST /auth/google` reads `googleClient` + `googleClientId` + `googleAllowedDomains` from the cached `AuthConfig` instead. Added `GET /auth/google/config` (public, no auth) returning `{ clientId, enabled }` so the Login page can decide whether to render the Google button.
- **`backend/src/routes/admin.ts`** — `GET/PATCH /admin/settings/auth` now read and write `googleClientId`. PATCH body schema accepts the field as `string | null | undefined`: `undefined` leaves it untouched, empty-string or `null` clears it, a non-empty string is validated against the Google Client ID format (`<digits>-<alnum>.apps.googleusercontent.com`). `googleAllowedDomains` is similarly optional in the body — admin can update either field independently. Each PATCH busts the in-process cache so changes take effect within the same request.
- **`backend/src/env.ts`** — removed `GOOGLE_OAUTH_CLIENT_ID` entirely. No env var, no Zod preprocess workaround, nothing to misconfigure.

**Frontend**

- **`frontend/src/lib/queries.ts`** — `AuthSettings.googleClientId: string | null`. New `useGoogleAuthConfig()` hook (public, `auth: false`) backed by `GET /auth/google/config`. `useUpdateAuthSettings` accepts partial updates (`UpdateAuthSettingsInput { googleClientId?, googleAllowedDomains? }`) and invalidates the public-config query so the Login page picks up changes immediately if it's currently mounted.
- **`frontend/src/main.tsx`** — removed `<GoogleOAuthProvider>` from the app root. It now lives inside the Login page, wrapped tightly around `<GoogleLogin>` and conditioned on `googleConfig.enabled`. No more empty-string client ID pollution at app boot.
- **`frontend/src/pages/Login.tsx`** — uses `useGoogleAuthConfig()` to decide rendering: skeleton while loading, `<GoogleOAuthProvider clientId={…}><GoogleLogin /></GoogleOAuthProvider>` when enabled, "Ask an admin to set it up in Admin → Sign-in" hint when not. Removed the `import.meta.env.VITE_GOOGLE_OAUTH_CLIENT_ID` read.
- **`frontend/src/pages/Admin.tsx`** — Sign-in tab grew a Client ID input above the domain list, with `Clear` action, inline format validation matching the backend regex, and a unified Save/Cancel that ships both fields in one PATCH. "How to set up" disclosure rewritten — no env vars, no rebuild step. The empty-state banner now adapts based on whether Client ID, domains, or both are missing.
- **`frontend/src/vite-env.d.ts`** — dropped the `VITE_GOOGLE_OAUTH_CLIENT_ID` declaration.

**Stripped (no longer needed)**

- **`docker-compose.yml`** (dev) — removed `GOOGLE_OAUTH_CLIENT_ID` and `VITE_GOOGLE_OAUTH_CLIENT_ID` from both service env blocks.
- **`frontend/Dockerfile`** — removed the `ARG`/`ENV VITE_GOOGLE_OAUTH_CLIENT_ID` from the `build` stage.
- **`.github/workflows/docker-publish.yml`** — removed the `build-args:` block. No more dependency on a GitHub repo variable.
- **`setup.sh`** — removed the env line from the generated prod compose. Updated the post-install help text to point admins straight at `Admin → Sign-in`.
- **`.env.example`**, **`backend/.env.example`**, **`frontend/.env.example`** — removed the OAuth lines.

**Operational notes**

- Existing dev DB rows for `AuthConfig` get `google_client_id = NULL` (column default). Admin must visit Sign-in tab once to populate.
- The 30 s cache TTL still applies, but admin edits explicitly bust the cache, so the same admin session sees the new value instantly. Cross-replica propagation (if you ever run >1 backend) still bounded by TTL.
- Self-serve onboarding: a fresh deploy now needs only `setup.sh` + admin password — no Google Cloud step required ahead of time. Admin configures OAuth from the UI when they're ready.

### Fixed — 2026-05-14 — Backend wouldn't boot when GOOGLE_OAUTH_CLIENT_ID was unset

When the compose-wired `GOOGLE_OAUTH_CLIENT_ID: ${GOOGLE_OAUTH_CLIENT_ID:-}` expands without a host value, Docker passes the empty string `""` to the container, not unset. The previous Zod schema `z.string().min(1).optional()` rejects empty strings (`.min(1)` fires before `.optional()` short-circuits), so the backend exited at env validation and every API call from the frontend returned 500 (proxied to a dead backend) — including the admin password login.

- **`backend/src/env.ts`** — Wrapped `GOOGLE_OAUTH_CLIENT_ID` in a `z.preprocess(v => v === "" ? undefined : v, …)` so empty-string compose input collapses to `undefined`, and `.optional()` accepts it cleanly. Same pattern should be applied to any future env var whose compose default is `${VAR:-}` and whose absence is meaningful at runtime.

### Changed — 2026-05-14 — Docs + compose plumbing aligned with actual dev workflow + Google OAuth env wiring

CLAUDE.md previously described the "Postgres-only-in-Docker, apps native" workflow and called the working-tree `docker-compose.yml` "prod-shaped, pulls GHCR images". Neither matches reality: the working-tree compose is a **dev** compose (gitignored) that builds local `dev` Dockerfile targets with hot-reload + bind mounts + named-volume `node_modules`; production gets its compose generated by [setup.sh](setup.sh) on the server with prebuilt GHCR images. Future Claude sessions kept tripping over this. Fixing the docs and wiring the Google OAuth env vars through both compose paths in the same pass so the feature actually works end-to-end.

- **`CLAUDE.md`** — Rewrote the "Repository status" compose paragraph: replaced the "single compose file, prod-shaped" claim with the two-compose-file reality (dev = working-tree gitignored, prod = generated by setup.sh). Added a "Container-aware tooling" note explaining that host-side `npm install` doesn't propagate into the running container's named-volume `node_modules` — must also run `docker compose exec <svc> npm install`. Rewrote "Common commands" so the Docker-dev path is canonical (with `docker compose exec` recipes for prisma, typecheck, db:seed) and native-host dev is positioned as a fallback. Added a "Migration generation gotcha" section covering the `prisma migrate dev` non-TTY-shell failure and the two workarounds (`exec -it` for a TTY, or host-side `migrate diff` + `migrate deploy`). Removed misleading mention of demo seeded accounts beyond `admin@solvro.local` (the others are referenced in old CHANGELOG entries but no longer auto-seeded). Removed the dangling "see CONFIGURATION.md" reference (file doesn't exist; flagged in this entry).
- **`docker-compose.yml`** (dev, gitignored) — Added `GOOGLE_OAUTH_CLIENT_ID: ${GOOGLE_OAUTH_CLIENT_ID:-}` to the backend service and `VITE_GOOGLE_OAUTH_CLIENT_ID: ${GOOGLE_OAUTH_CLIENT_ID:-}` to the frontend service. Both expand from the host shell environment or a sibling `.env` file. When unset, the backend boots fine (env is optional) and the frontend bundle ships without the Google button — both paths surface a "not configured" hint instead of crashing. Single source of truth (one var, two services) so dev configuration stays consistent.
- **`frontend/Dockerfile`** — Added `ARG VITE_GOOGLE_OAUTH_CLIENT_ID=""` + `ENV` line in the `build` stage. Vite resolves `import.meta.env.VITE_*` at build time, so for the **published GHCR image** the Client ID must be present during `npm run build`, not at container run. Backend Dockerfile is unaffected (no Vite, no `VITE_*` access).
- **`.github/workflows/docker-publish.yml`** — Added `build-args: VITE_GOOGLE_OAUTH_CLIENT_ID=${{ vars.VITE_GOOGLE_OAUTH_CLIENT_ID }}` to the build-push step. Reads from a **repository variable** (Settings → Secrets and variables → Actions → Variables), so admins can enable Google sign-in in prod by setting one variable and pushing a release — no code change. When unset, the variable expands to an empty string and the published frontend ships with the Google button disabled. Backend image silently ignores the build-arg (Vite-only concern).
- **`setup.sh`** — Added `GOOGLE_OAUTH_CLIENT_ID: ${GOOGLE_OAUTH_CLIENT_ID:-}` to the generated prod compose's backend env block (reads from `~/solvro/.env`). Updated the final help-text block to walk the admin through enabling Google sign-in: create OAuth client in Google Cloud Console → append `GOOGLE_OAUTH_CLIENT_ID=...` to `~/solvro/.env` → also set the `VITE_GOOGLE_OAUTH_CLIENT_ID` repo variable and re-run setup to pull a rebuilt frontend image → sign in as admin and add allowed domains under `Admin > Sign-in`.
- **Frontend container node_modules sync** — Because the dev compose stores `node_modules` in a named volume (`solvro_frontend_node_modules`), my earlier host-side `npm i @react-oauth/google` updated `frontend/package.json` but the container kept the stale lockfile-derived deps and Vite failed with `[plugin:vite:import-analysis] Failed to resolve import "@react-oauth/google"`. Fixed by running `docker compose exec frontend npm install`, then `docker compose restart frontend`. Same pattern applied to the backend container for `google-auth-library`. Documented in CLAUDE.md so future installs don't hit the same wall.

No app code changed in this entry — only docs, compose, Dockerfile build-args, and the CI workflow. Backend `tsc --noEmit` and frontend `npm run typecheck` were already clean from the prior commit.

### Added — 2026-05-14 — Google OAuth sign-in (primary auth) + admin-driven RBAC

New end-to-end sign-in flow. Anyone with an email on an admin-allowlisted Google domain can sign in via Google; on first sign-in they're auto-provisioned into a new built-in **PENDING** role with no permissions, and the admin promotes them from `Admin > Users`. Password auth stays as an admin-only break-glass path (`admin@solvro.local` keeps its password; every other user is created with `passwordHash = NULL` and rejected from `/auth/login`).

**Backend**

- **`backend/prisma/schema.prisma`** — `User.passwordHash` is now nullable (Google users have no password); added `User.googleSub @unique` (dedup key from the Google ID token's `sub` claim) and `User.avatarUrl` (from the `picture` claim). New singleton model `AuthConfig { id String @id @default("default"), googleAllowedDomains String[], updatedAt, updatedBy User? }` — the admin-editable allowlist of email domains that may sign in via Google.
- **`backend/prisma/migrations/20260514120000_add_google_oauth_and_pending_role/`** — generated via `prisma migrate diff` (interactive `migrate dev` blocks on the benign "new unique constraint on nullable column" warning in non-TTY shells). All `ALTER TABLE` operations are non-rewriting Postgres DDL; safe to apply via `prisma migrate deploy` against the running prod DB.
- **`backend/prisma/seed.ts`** — added `PENDING: []` to the built-in role map (5 roles total). Also upserts the `AuthConfig` singleton with an empty `googleAllowedDomains` array on every seed, so a fresh deploy forces the admin to make an explicit policy decision before Google sign-in becomes usable. The seed never overwrites admin-edited values on re-runs (`update: {}`).
- **`backend/src/env.ts`** — added optional `GOOGLE_OAUTH_CLIENT_ID`. Kept optional so existing dev environments continue to boot; when missing, `POST /auth/google` returns `503 oauth_not_configured` (same code as an empty domain allowlist). Allowed-domains list is *not* in env — it lives in `AuthConfig` so the in-app admin owns it without redeploys.
- **`backend/src/authConfig.ts`** (new) — in-process cache for the `AuthConfig` singleton with a 30 s TTL. Reads happen on every Google sign-in; the row rarely changes. Cache is busted explicitly from `PATCH /admin/settings/auth` so admin edits propagate immediately.
- **`backend/src/routes/auth.ts`** — added `POST /auth/google`: validates body `{ idToken }`, verifies via `google-auth-library` `OAuth2Client.verifyIdToken({ idToken, audience: GOOGLE_OAUTH_CLIENT_ID })`, gates on `email_verified === true`, then on the `hd` claim or email-suffix against `AuthConfig.googleAllowedDomains`. Finds user by `googleSub`, then by `email` (account-linking case: existing email-matched row with null `googleSub` gets updated). New users are created with `roleId = (PENDING role).id`, `passwordHash: null`, `googleSub`, `avatarUrl`, and a username derived from the email local-part — `createWithUniqueUsername` retries `-2`, `-3`, … on `P2002` so two domains sharing a local-part don't collide. Mints the same `{ sub, role, permissions }` JWT as `/auth/login` (downstream `requireAuth` / `requirePermission` / `projectVisibilityFilter` can't distinguish the two auth paths — that's the design goal). `/auth/login` got a short-circuit before `bcrypt.compare` that returns `401 google_only` if `user.passwordHash === null`. `/auth/change-password` gained the same null-safety guard.
- **`backend/src/routes/admin.ts`** — `GET /admin/users` now selects `googleSub` + `avatarUrl` and maps to a derived `provider: "google" | "password"` field. `PATCH /admin/users/:id/role` rejects target `"PENDING"` with `400 pending_assign_blocked` — PENDING is provisioning-only; use `active: false` to revoke. Added `GET /admin/settings/auth` and `PATCH /admin/settings/auth` (both behind the existing `requireAdmin` router-level gate); the PATCH validates each domain against a hostname regex, deduplicates, caps at 32, sets `updatedById`, and busts the in-process `AuthConfig` cache so the new allowlist takes effect immediately. Added `"PENDING"` to the `BUILTIN_ROLES` set so it can't be deleted/renamed.
- **`backend/package.json`** — added `google-auth-library ^10.x` (server-side ID token verification).

**Frontend**

- **`frontend/src/main.tsx`** — wrapped the app tree in `<GoogleOAuthProvider clientId={import.meta.env.VITE_GOOGLE_OAUTH_CLIENT_ID ?? ""}>` between `ThemeProvider` and `AuthProvider`. Provider sits above the router so any route can call `<GoogleLogin>` if needed later.
- **`frontend/src/vite-env.d.ts`** — declared `ImportMetaEnv.VITE_GOOGLE_OAUTH_CLIENT_ID?: string`.
- **`frontend/src/lib/auth.tsx`** — extended `AuthContext` with `loginWithGoogle(idToken)`; implementation mirrors `login()`, posts to `/auth/google`, stores the returned JWT in `localStorage["solvro.token"]` (no separate Google-vs-password storage — token shape is identical). Appended `PENDING` to the `BUILTIN_ROLES` tuple.
- **`frontend/src/lib/queries.ts`** — extended `AdminUser` with `provider: "google" | "password"` and `avatarUrl: string | null`. Added `AuthSettings` interface, `adminQueryKeys.authSettings`, `useAuthSettings`, and `useUpdateAuthSettings` (mutation `setQueryData`s the fresh row directly — no need to invalidate, since the row is singleton).
- **`frontend/src/pages/Login.tsx`** — restructured: Google button is the primary CTA (`<GoogleLogin theme="filled_blue" text="signin_with" />`). Password form moved behind a collapsible `<details>` labeled "Admin sign-in (password)". Removed the demo-accounts footer (misleading once Google is the canonical path). Tailored error messages by backend `code` (`domain_not_allowed`, `email_not_verified`, `oauth_not_configured`, `account_disabled`, `google_only`, `invalid_credentials`, `invalid_token`). When `VITE_GOOGLE_OAUTH_CLIENT_ID` is unset at build time, the page renders an amber "Google sign-in isn't set up" hint instead of the button, so the password form remains the only path in mis-configured dev environments.
- **`frontend/src/pages/Admin.tsx`** — added a new **Sign-in** tab between Roles and Project Override. Editable chip list of allowed domains with inline add input (regex-validated client-side; backend revalidates), Save/Cancel pair, "Last updated by … on …" footer, and a collapsed "How to set up Google sign-in" disclosure that documents the Google Cloud Console step (since that part can't be done from inside the app). Users tab gained a **Provider** column (Google chip with mail icon vs Password chip with key icon), a **"Needs role"** amber pill next to the role dropdown for `PENDING` users, and a 4-tile KPI strip (`Users` / `Pending` / `Custom roles` / `Inactive`). PENDING is filtered out of every user-facing role dropdown (it's provisioning-only — never selectable as a target). Roles tab description updated to list PENDING as the fifth built-in.
- **`frontend/package.json`** — added `@react-oauth/google ^0.13.x` (provider + `<GoogleLogin>` button — handles GSI script loading and returns the Google ID token via `credentialResponse.credential`).

**Env / config**

- **`.env.example`** (root), **`backend/.env.example`** — documented optional `GOOGLE_OAUTH_CLIENT_ID` and root-only `VITE_GOOGLE_OAUTH_CLIENT_ID` (same value as the backend var; shipped in the frontend bundle, not secret because Google verification is server-side).
- **`frontend/.env.example`** (new) — created with `VITE_GOOGLE_OAUTH_CLIENT_ID` + the existing `VITE_API_PROXY_TARGET` override documented for reference.

**Operational notes**

- The seeded admin (`admin@solvro.local`) is intentionally **exempt** from the Google domain allowlist because they sign in via password, not Google. Don't "fix" this by adding `solvro.local` to the allowlist — Google won't issue a verified ID token for that domain anyway.
- AuthConfig is cached in-process for 30 s. Admin edits via the Sign-in tab bust the cache immediately for the editing process, but with multiple backend replicas behind a load balancer, other replicas observe the change within 30 s. The UI surfaces this lag ("Changes take effect within ~30 seconds").
- Username collision on Google auto-provision: handled via P2002-retry with `-2`/`-3`/… suffixes up to 20 attempts.
- JWT remains provider-agnostic — no `provider` claim, no auth-event audit table. If per-session auditing becomes important, add a DB-side `AuthEvent` table rather than polluting the JWT.

Backend `tsc --noEmit` clean. Frontend `npm run typecheck` clean.

### Added — 2026-05-10 — Daily Review screen (TAM cross-project notes)

New top-level page where TAMs log a note per active project in a single morning session. This is the **input** side of the core SA-to-customer loop documented in CLAUDE.md → Reports will later consume `CUSTOMER_FACING` notes for the export packet.

- **`backend/prisma/schema.prisma`** — Added `NoteVisibility` enum (`INTERNAL` | `CUSTOMER_FACING`) and `ProjectNote` model. Note IDs are `Int @default(autoincrement())` to match every other model in this schema (the spec in CLAUDE.md showed `String @default(cuid())`, but the FK to `Project.id`/`User.id` requires `Int` — flagging as intentional deviation). Cascade-delete on project, plain FK on author. Indexes on `(project_id, created_at)` (chronological-per-project read) and `author_id`. Default visibility is `INTERNAL` so customer-facing is an explicit opt-in.
- **`backend/prisma/migrations/20260510022142_add_project_notes/`** — Generated via `prisma migrate dev --name add_project_notes`. Creates the `NoteVisibility` enum and `project_notes` table.
- **`backend/.env`** — Created from `.env.example` (`DATABASE_URL=postgresql://solvro:solvro_dev@localhost:5432/solvro?schema=public`) so `prisma migrate dev` can resolve the env var on host runs. Required first-time setup that wasn't committed.
- **`backend/src/routes/projects.ts`** — Added `GET /projects/:id/notes` (visibility + limit query params) and `POST /projects/:id/notes`. Both gate visibility through the existing `projectVisibilityFilter` so notes inherit the project's role-scoped access. Write requires `project:write`; read uses the same auth as other project-nested reads.
- **`frontend/src/lib/queries.ts`** — Added `NoteVisibility` type, `ProjectNote` interface, `queryKeys.projectNotes(id, visibility?)`, `useProjectNotes`, `useAddProjectNote`. The query key bucketizes by visibility filter; the `onSuccess` invalidator wipes every visibility bucket for the project (`["projects", id, "notes"]`) so all variants refetch.
- **`frontend/src/pages/DailyReview.tsx`** — New page. Lists TAM's `ACTIVE` + `PLANNING` projects (visibility-filtered backend-side) as a vertical stack of cards, each with project metadata, a textarea (⌘↵ to save), an `Internal | Customer-facing` segmented toggle defaulting to Internal, and a "Recent notes" panel showing the last 5 notes per project with a tone-coded visibility dot. Optimistic-feel: empties the textarea on success and keeps the visibility default.
- **`frontend/src/App.tsx`** — Registered `/daily-review` route. The `/tasks` route is left intact (CLAUDE.md says don't delete the page, only remove the sidebar link).
- **`frontend/src/components/layout/Sidebar.tsx`** — Removed `Tasks` (TAMs think in projects, not tasks; the per-project task views cover this). Added `Daily Review` (icon `edit_note`) between `Customers` and `Work Logs`. New order: Overview → Projects → Customers → Daily Review → Work Logs → Reports → Admin. Settings remains in the user menu (TopBar), as before.

Backend `tsc --noEmit` clean. Frontend `npm run typecheck` clean.

### Changed — 2026-05-10 — Align shared chrome (chips, sidebar, topbar, modal) with the static preview

Follow-up pass to the page-level alignment: the *shared* components used everywhere now match the preview's visual language, so the polish lands once and propagates.

- **`frontend/src/index.css`** — Added theme-aware chip color tokens (`--emerald-bg/text`, `--amber-bg/text`, `--rose-bg/text`, `--violet-bg/text`) under `:root` (light) and `.dark` (dark) using the same RGB triplets the preview HTML defines. Chips now flip with the theme automatically.
- **`frontend/tailwind.config.ts`** — Exposed those tokens as Tailwind colors (`bg-chip-emerald-bg`, `text-chip-emerald-text`, etc.) so any chip can be styled with utilities instead of inline hex.
- **`frontend/src/components/StatusChip.tsx`** — Rewrote chip styling to match the preview spec: `gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold leading-[18px]`. Labels are now Title-cased ("Active", "On hold", "In progress", "To do") instead of UPPERCASED. Exports a generic `<Chip tone="emerald|amber|rose|violet|blue|gray">` for ad-hoc reuse without rebuilding the base styling per call site.
- **`frontend/src/components/PriorityBadge.tsx`** — Same chip shape; tones collapsed to gray (Low/Med), amber (High), rose (Urgent) per preview. Dropped the leading colored dot — the bg/text contrast carries enough signal at this size.
- **`frontend/src/components/LabelChip.tsx`** — Switched from `rounded` to `rounded-full` and weight 600 so user-defined labels read as the same chip family.
- **`frontend/src/components/layout/Sidebar.tsx`** — Restored DESIGN.md's "dark slate, recedes" intent: rail bg is now `#0F1623` (light) / `#060912` (dark), nav links are `text-slate-400` on `hover:bg-white/5`, active item is `bg-primary/20 text-white` with the icon tinted `text-primary`. Brand wordmark is `text-white text-lg font-extrabold tracking-tight`. Backdrop on mobile only (`md:hidden`) so it doesn't grey out the canvas on desktop. Nav icons updated to match the preview set (`folder_managed`, `groups`, `analytics`).
- **`frontend/src/components/layout/TopBar.tsx`** — Height dropped from `h-16` to `h-14` (preview spec). Search input moved into a filled pill (`bg-surface-container`) with a `⌘K` mono kbd hint. Added a notifications bell with a small error dot. User chip on the right pulls a left border separator like the preview. Theme toggle and avatar menu kept; sign-out / settings dropdown unchanged.
- **`frontend/src/components/layout/RightSidebar.tsx`** — Now uses `<ProjectStatusChip>` directly (was a bespoke `STATUS_TONE` map with rings — outdated after the chip refactor). Top offset changed from `top-16` to `top-14` to track the new TopBar height. Export buttons: dropped `uppercase tracking-wider` for a softer `font-semibold` to match the rest of the app's secondary buttons.
- **`frontend/src/components/layout/Shell.tsx`** — Main canvas height adjusted from `calc(100vh-64px)` to `calc(100vh-56px)` to match the new TopBar height.
- **`frontend/src/components/Modal.tsx`** — Switched from `rounded-xl … shadow-xl` to `rounded … shadow-card`, gave the header a real title (`text-[14px] font-semibold text-on-surface` instead of a tiny variant-text label) and removed the `bg-surface-container-low` band on header/footer — the bordered separators alone are enough at the new radius. Edge-to-edge mobile layout preserved (`rounded-none md:rounded`).

Typecheck clean.

### Changed — 2026-05-10 — Bring the real app's visual language up to the static preview

The static `solvro-app-preview.html` mockup set a higher visual bar than the actual app — KPI tiles, the avatar-tile + metric-grid customer card, the S-curve overview, the polished login split-panel, etc. This pass aligns the implementation to that target across every authed page (interactivity unchanged).

- **`frontend/src/pages/Login.tsx`** — Restyled the right form panel: outlined inputs with leading mail/lock icons + show-password toggle, "Remember me" / "Forgot password?" row, primary uppercase "Sign in" button, and a Demo accounts footer that autofills the form on click (password `password123`). Left brand panel keeps the gradient but uses a tighter chip + headline + version-stamp layout matching the preview.
- **`frontend/src/pages/Overview.tsx`** — Replaced the prior 2×2 quadrant tiles with a 4-KPI strip (Active Projects · Open Tasks · Completed · Total) + a Recharts area chart S-curve (Actual vs. Baseline) + an activity feed of recent tasks with seeded avatar colors + a "Recently updated projects" strip. Drops the donut + work-log placeholder.
- **`frontend/src/pages/Projects.tsx`** — Card now leads with a `P-NNN` mono-num ID badge + status chip, then title, description, customer + avatar stack (SA + TAM, both seeded from username), and a footer strip with task count and a baseline-locked badge when set. Filter row simplified to a customer dropdown + result count, no more shadow-card panel.
- **`frontend/src/pages/Customers.tsx`** — Card redesigned around a 40px seed-colored avatar tile + truncated AM line, optional description, then a 2-column metric grid (Projects count, SA lead). Shared seeded `avatarColor` palette mirrors the preview.
- **`frontend/src/pages/CustomerDetail.tsx`** — Header rebuilt as a 3-card strip: identity card with avatar tile + AM/SA + Edit/Delete actions, plus two KPI tiles (Active projects · Services subscribed). Existing tabs (Overview · Services · Topology · Org · Documents) and Services-tab tools editor unchanged.
- **`frontend/src/pages/Tasks.tsx`** — H1 sized `text-2xl font-bold`, filter panel switched from `rounded-xl shadow-card` to `rounded border border-outline-variant`, table container ditto. Sorting/filtering logic untouched.
- **`frontend/src/pages/Reports.tsx`** — Added a 4-KPI strip across the top (Total tasks · In progress · Completed · Backlog), reorganized chart cards into a 2-up layout, and reskinned the Recharts tooltip + legend to use CSS-variable surface colors so they read in dark mode. Pie charts kept.
- **`frontend/src/pages/Settings.tsx`** — Appearance card now shows visual theme-preview tiles (white / dark slate / split) for Light · Dark · System, with a check-circle marker when active. Other surfaces switched from `rounded-xl shadow-card` to `rounded border + shadow-card`.
- **`frontend/src/pages/Admin.tsx`** — Added a 3-KPI strip at the top of the Users tab (Users · Custom roles · Inactive accounts) derived from `users` + `roles` data; introduced a small shared `AdminKpi` component. Users CRUD form + table unchanged.
- **`frontend/src/pages/views/ProjectOverview.tsx`** — Reskinned the 4 KPI tiles (icon top-right, mono-num value, hint inline) and the S-curve section/empty-state/skeletons to use `rounded border border-outline-variant` instead of `rounded-xl shadow-card`. Recharts S-curve rendering logic unchanged.
- **`frontend/src/pages/views/ProjectList.tsx`** + **`ProjectKanban.tsx`** — Swapped the loading skeletons and outer table/card containers from `rounded-xl … shadow-card` to `rounded border border-outline-variant`. Kanban subtask checklist (added earlier today) carries through unchanged.

Typecheck clean across all changes.

### Added — 2026-05-10 — Full-app static UI preview (single shareable HTML)

A standalone HTML file that mirrors every major screen of the app, intended for design review and external sharing. No build, no backend, no auth — just open in a browser.

- **`New UI/solvro-app-preview.html`** — 16 screens covered: Login, Overview (dashboard), Projects, Project · Overview / List / Kanban (with subtask checklist) / Gantt / Timeline / Diagram / Risks tabs, Customers, Customer detail, Tasks (cross-project), Reports, Settings, Admin. Wired with:
  - Manual light/dark toggle (button in the sticky header) using a `darkMode: 'class'` Tailwind config + CSS variables for the M3 surface tokens. Initial state respects OS `prefers-color-scheme`. Chrome bar carries an in-page TOC linking to each screen anchor.
  - Faithful chrome: 64px sidebar rail (dark slate), 56px topbar with project breadcrumb on detail pages, and the same 7-tab order the app uses (Overview · List · Kanban · Gantt · Timeline · Diagram · Risks).
  - Visual fidelity for the load-bearing concepts: AI Breakdown amber glow on machine-generated cards, phase-color left rails on diagram nodes, S-curve baseline-vs-actual + forecast, Gantt grid with dependency arrows + parent-subtask dotted teal edges, Kanban subtask checklist nested inside parent cards, risk register with live-computed score cells, project-level Risks summary tiles.
  - Source Sans 3 + JetBrains Mono via Google Fonts CDN; Material Symbols via Google Fonts CDN; Tailwind via JIT CDN. Self-contained — no asset folder.



Each parent card on the Kanban now renders its subtasks as a compact, indented checklist inside the card (between the description and the meta row). The earlier `subtasksDone/total` badge in the bottom row is removed because the list itself is now the authoritative summary.

- **`frontend/src/pages/views/ProjectKanban.tsx`**:
  - Added `toggleSubtaskStatus` handler in the parent component (flips a subtask's status between `TODO` and `DONE` via the existing `useUpdateTask` mutation, which already does optimistic update + invalidate).
  - Threaded a new `onToggleSubtask: (Task) => void` prop and a `canToggleSubtasks: boolean` flag through `Column` → `TaskCard` (gated on the same `TAM/ADMIN` role check as the drag-to-move).
  - In `TaskCard`, when `subtasks.length > 0`, renders a list with a small status circle (clickable to toggle when permitted), the subtask title (line-through when done), and an optional assignee initial. Inline `onPointerDown` `stopPropagation` keeps the dnd-kit draggable on the parent card from intercepting the toggle click. Removed the redundant subtask-count badge from the meta row.

Subtasks intentionally don't drag independently — moving a parent moves the subtask group with it. To reorganize across statuses individually, use the per-row toggle or open the parent's edit modal (which still lists subtasks).

### Fixed — 2026-05-10 — Project tabs nav no longer shows a stray vertical scrollbar

The project sub-tab nav (`<nav className="… overflow-x-auto …">` in [ProjectDetail.tsx](frontend/src/pages/ProjectDetail.tsx)) was rendering a thin vertical scrollbar along its right edge because of a CSS quirk: when `overflow-x` is set to a non-visible value, `overflow-y: visible` is computed to `auto`. Combined with the active tab's `-mb-px border-b-2` which overhangs the content box by 1px to overlap the nav's own bottom border, the nav had 1px of vertical overflow → vertical scrollbar appeared.

- **`frontend/src/pages/ProjectDetail.tsx`** — Added `overflow-y-clip` to the tabs nav so the y-axis is clipped (not scrolled). `overflow-x-auto` is retained for horizontal tab scroll on narrow viewports. `clip` doesn't make the element a scroll container, so no scrollbar is reserved on either axis when not needed; the 1px overhang is silently clipped (still indistinguishable visually since the active border sits flush against the nav's `border-b`).

### Fixed — 2026-05-10 — Gantt card sizes to its rows, no extra page scrollbar

The Gantt card was forcing a `h-full min-h-[460px]` fixed-fit and an internal `flex-1 overflow-auto` scroller, which (a) padded the card with empty rows below the last task whenever the data was sparse, and (b) on shorter viewports the 460px floor pushed total page height just past `<main>`, surfacing a stray page-level vertical scrollbar on top of the Gantt's own horizontal scroller.

The card should grow with the number of tasks — many rows = tall card and the page scrolls vertically; few rows = short card and nothing extra to scroll.

- **`frontend/src/components/gantt/GanttFrame.tsx`**:
  - Root: dropped `h-full min-h-[460px]` from the outer container so the card height = its natural content height (toolbar + axis + rows × ROW_HEIGHT).
  - Inner scroller: changed `min-h-0 min-w-0 flex-1 overflow-auto` to `min-w-0 overflow-x-auto`. Vertical scroll is now the page's job (`<main>` already has `overflow-y-auto`); the scroller still owns horizontal scrolling for wide date ranges. The inner content div's `minHeight: AXIS_HEIGHT + rows.length * ROW_HEIGHT` style still drives the card's height, so this is purely a wrapper change.

### Changed — 2026-05-10 — Network Diagram is read-only for dependencies

The diagram is now purely a visualization. All dependency creation/deletion goes through the Gantt chart's connector-handle drag.

- **`frontend/src/pages/views/ProjectDiagram.tsx`**:
  - Removed `onConnect` and `onEdgeDoubleClick` handlers, `useCreateDependency` / `useDeleteDependency` hook calls, the `error` state + dismissable error toast (only `onConnect` ever populated it), the `ApiError` import, and the unused `Connection` type import.
  - Added `nodesConnectable={false}` on `<ReactFlow>` so users can't initiate a connection drag.
  - Kept node dragging + position persistence so users can still arrange the canvas layout.
- **`frontend/src/index.css`** — `.diagram-handle` is now `width: 1px; height: 1px; opacity: 0; pointer-events: none;`. Existing edges still attach to the handles as anchor points, but the dots no longer render.

Auto-derived parent → subtask edges, the read-only critical-path toggle, hover/click selection highlight, double-click-to-open-task-modal, and Auto-layout all keep working — only manual edge create/delete is gone.

### Added — 2026-05-09 — Create dependencies directly in the Gantt chart

The Gantt becomes the primary place for managing dependencies. Each editable bar grows a small connector dot at its right edge — drag from there to another bar to create a `TaskDependency`. Both the Gantt's connector overlay and the Network Diagram update immediately because they share the TanStack Query cache.

- **`frontend/src/components/gantt/GanttBar.tsx`** — Added `data-task-id` attribute to every bar (used for hit-testing on pointer-up) plus a small primary-blue circular handle (12px, white-bordered, 70%/100% opacity on hover) anchored to the bar's right edge. `onPointerDown` on the handle calls a new `onConnectStart(sourceTaskId, clientX, clientY)` prop after stopping propagation so the bar's own drag-to-move pointer logic doesn't fire.
- **`frontend/src/components/gantt/GanttRow.tsx`** — Plumbed the `onConnectStart` prop through to `GanttBar`.
- **`frontend/src/components/gantt/GanttChartPane.tsx`** — Accepts a `connectDrag` prop (start/cursor coords in chart-body-local space). When non-null, renders a dashed primary-blue SVG `<line>` with a circle endpoint as a rubber-band that follows the cursor (`overflow: visible` so the line extends outside the SVG's viewBox if the cursor leaves the chart body). Mounted at `z-index: 4` so it sits above bars and the static connectors.
- **`frontend/src/components/gantt/GanttFrame.tsx`** — Added `useCreateDependency`, `connectDrag` state, and `handleConnectStart`. `handleConnectStart` converts client coords → chart-body-local using `scrollerRef.getBoundingClientRect() + scrollLeft/Top - LIST_PANE_WIDTH/AXIS_HEIGHT`, then attaches **window-level** `pointermove` / `pointerup` / `keydown` listeners imperatively (not via useEffect, so state updates during drag don't re-add listeners). On `pointerup`: walks up `document.elementFromPoint(...)` looking for the nearest `[data-task-id]` ancestor; if it differs from the source task, fires the create mutation with `sourceHandle: "right-source"` + `targetHandle: "left-target"` defaults so the new dep also looks natural in the Network Diagram. ESC cancels mid-drag. Errors surface via `setActionError`.

The earlier change that rendered existing TaskDependencies on the Gantt (via `GanttConnectors`) stays as-is — combined, you can both create AND view dependencies in the Gantt without leaving the tab.

### Added — 2026-05-09 — Render TaskDependency arrows on the Gantt chart

The same dependency edges drawn in the Network Diagram now render as stepped arrows on the Gantt chart, so users can see precedence relationships in either view without re-creating them.

- **`frontend/src/components/gantt/GanttConnectors.tsx`** (new) — SVG overlay sized to the chart body. For each `TaskDependency` row, finds the predecessor and successor `Row` (matched by `taskId`), computes their bar endpoints via `positionFor`, and draws a stepped path (`M…H…V…H…`). Forward layouts route forward → vertical → forward; backward dependencies (successor to the left of predecessor) route around with an extra leg above/below the source row. Arrowheads via SVG `<marker>` colored with `currentColor` so they match the path stroke. HARD = solid, SOFT = dashed (`stroke-dasharray="5 4"`).
- **`frontend/src/components/gantt/GanttChartPane.tsx`** — Accepts a new `dependencies: TaskDependency[]` prop and mounts `<GanttConnectors />` between the rows layer and the today-line (z-index: 2 so it sits above bars and grid but under the today line).
- **`frontend/src/components/gantt/GanttFrame.tsx`** — Added `useProjectDependencies(projectId)` and passes the result down. Subscribes to the same TanStack Query cache used by the Network Diagram, so creating/deleting a dep in either view propagates immediately to the other.

Connectors automatically skip dependencies whose endpoints aren't currently visible (e.g. either task is in a collapsed section). No layout adjustments needed when sections expand/collapse — connectors recompute via `useMemo` keyed on `rows`.

### Changed — 2026-05-09 — Two-phase auto-layout: subtasks stack below parents

Previous attempt fed parent → child edges into dagre's main LR graph, which simply pushed subtasks one rank to the **right** of the parent — not below. Now `autoLayout` runs in two phases.

- **`frontend/src/lib/diagram/autoLayout.ts`**:
  - Phase 1: dagre lays out only **top-level tasks** (those without a `parentTaskId`) using the dependency graph. Subtasks are excluded from dagre entirely.
  - Phase 2: subtasks are placed **directly below** their parent — horizontally centered on the parent, vertically stacked in id order with a 24px gap between siblings (`SUBTASK_VGAP`).
  - Stable id-sort means the layout is deterministic across runs.

To apply: click the **Auto-layout** toolbar button — existing diagram positions are persisted in `Task.diagramX/Y`, so they don't move automatically when this code changes.

### Added — 2026-05-09 — Auto-rendered parent → subtask edges in Network Diagram

The diagram now visualizes the existing `Task.parentTaskId` hierarchy. Every task that has a parent gets an auto-derived edge from the parent's bottom handle to its own top handle — distinct in style from real `TaskDependency` edges so the two relations are never confused.

- **`frontend/src/lib/diagram/autoLayout.ts`** — dagre now also receives parent → child edges (in addition to `TaskDependency` rows). Subtasks land one rank deeper than their parent, so the auto-layout reflects the task hierarchy when first opened.
- **`frontend/src/pages/views/ProjectDiagram.tsx`**:
  - `PhaseEdgeData` gained an optional `isParent: true` flag.
  - The edges memo iterates `tasks.filter(t => t.parentTaskId !== null)` after building dependency edges and appends a synthetic edge with id `parent-<childId>`, `sourceHandle: "bottom-source"`, `targetHandle: "top-target"`. The synthetic id namespace can't collide with numeric `TaskDependency` ids.
  - `PhaseEdge` checks `data.isParent` and short-circuits to a muted dotted line (`stroke-dasharray="2 4"`, ~50% opacity, no `markerEnd`) so it reads as a containment line, not an arrow.
  - `onEdgeDoubleClick` skips edges whose id starts with `parent-` — parent links can't be deleted from the diagram (clear `parentTaskId` from the task modal instead).
  - Parent edges aren't included in the critical-path computation (only `TaskDependency` rows are).

User-drawn `TaskDependency` edges and auto parent edges coexist; if a parent also has a real dependency to its subtask, both render and are visually distinct.

### Removed — 2026-05-09 — Comments section from TaskFormModal

- **`frontend/src/components/TaskFormModal.tsx`** — Removed the entire `Comments` section (cosmetic B/I/U toolbar + `CommentThread` embed) that only rendered in edit mode. Dropped the now-unused `CommentThread` import. The comment-thread component itself stays in `src/components/CommentThread.tsx` and the backend `/tasks/:id/comments` endpoints stay live — only the modal's mount of it is removed.

Why: the section made the edit modal substantially taller for marginal value (CommentThread isn't wired to a real toolbar; the BIU/etc buttons are cosmetic). User can re-introduce it later if comments become a primary workflow.

### Changed — 2026-05-09 — Cap modal height + tighten TaskFormModal spacing

The Task form modal was growing past viewport height because the panel container had `md:h-auto` with no `max-h`. Result: very tall content (esp. with comments) pushed the footer off-screen and made the whole page scroll.

- **`frontend/src/components/Modal.tsx`** — Panel now has `max-h-screen` (mobile) and `md:max-h-[calc(100vh-2rem)]` (desktop, accounting for the outer `md:p-4`). Combined with the existing `flex-1 overflow-y-auto` body, the modal is now capped at viewport height and the body scrolls internally; header + footer stay pinned. Affects every modal that uses this component.
- **`frontend/src/components/TaskFormModal.tsx`** — Tightened internal spacing: form `space-y-5` → `space-y-3.5`, field-rows-card `space-y-3 p-4` → `space-y-2 p-3`, all section header margins `mb-2` → `mb-1.5`. Net: ~40px less vertical content, fewer cases where scrolling kicks in at all.

### Changed — 2026-05-09 — Persist diagram handle IDs + render task IDs on nodes

Two fixes for the Network Diagram view.

**1. Edge handle persistence.** The bidirectional handles (added earlier today) let users drag connections from any side of any node, but the chosen sides were thrown away on reload — every edge re-rendered through the default right→left routing, turning a clean vertical drag into an L-shape after refresh. Now the source/target handle IDs travel with the dependency.

- **`backend/prisma/schema.prisma`** — `TaskDependency` gained `sourceHandle String?` and `targetHandle String?` columns (snake_case in SQL, nullable; null = "use defaults").
- **Migration**: `20260509110118_add_dependency_handle_ids` (or similar timestamp). Applied via `DATABASE_URL=… npm run prisma:migrate -- --name add_dependency_handle_ids`. After migration, `docker compose exec backend npx prisma generate && docker compose restart backend` to refresh the container's Prisma client.
- **`backend/src/routes/projects.ts`** `createDependencySchema` accepts optional `sourceHandle` / `targetHandle` strings; the POST handler stores them on insert.
- **`frontend/src/lib/queries.ts`** — `TaskDependency` and `CreateDependencyInput` interfaces gained the two fields.
- **`frontend/src/pages/views/ProjectDiagram.tsx`** — `onConnect` now passes through `params.sourceHandle` / `params.targetHandle`; the edge-mapping memo reads `d.sourceHandle ?? "right-source"` (and the target counterpart) so legacy rows fall back to the LR default while new rows preserve their original handles across reloads.

**2. Task IDs visible on nodes.** Each task and milestone card now shows its `T-NNN` ID in a small mono-font line above the title — matches the format already used in [`ProjectList.tsx`](frontend/src/pages/views/ProjectList.tsx).

- **`frontend/src/pages/views/ProjectDiagram.tsx`** — Inserted `<div className="diagram-task-id">T-{padded id}</div>` above the title in `TaskCardNode`; for `MilestoneNode` (single-line layout) the ID is prefixed inline before the milestone title.
- **`frontend/src/index.css`** — New `.diagram-task-id` rule: 10px JetBrains-Mono, weight 600, `--diagram-node-meta` color at 0.85 opacity. Plays cleanly in both light and dark canvas themes via the existing CSS variables.

### Changed — 2026-05-09 — Bidirectional handles in Network Diagram (4 sides)

Each diagram node now stacks a `source` AND a `target` handle at all four sides (left, right, top, bottom) — **8 handles total per node**. Users can initiate or receive a connection from any side. Top/bottom is especially useful for subtasks laid out vertically below their parent: a clean down-arrow instead of a long L-shape going around.

- **`frontend/src/pages/views/ProjectDiagram.tsx`** — Replaced the single-target/single-source handle pair on `TaskCardNode` and `MilestoneNode` with a shared `<BidirectionalHandles />` helper that renders 8 handles with unique IDs (`left-target`, `left-source`, `right-target`, `right-source`, `top-target`, `top-source`, `bottom-target`, `bottom-source`). Existing edges are explicitly pinned to `sourceHandle: "right-source"` + `targetHandle: "left-target"` so the LR-flow visual default is preserved on reload regardless of which sides the user originally dragged from.

The connection itself is still a `TaskDependency` row — top/bottom is purely a routing/ergonomics choice, not a new relation type.

Caveat: handle IDs aren't persisted on `TaskDependency`, so vertically-drawn edges re-render through the default right→left route after a refresh. Semantic dependency direction (predecessor → successor) is preserved.

### Changed — 2026-05-09 — Apply Projects-card treatment to all entity cards

Extended the compact-but-larger-text card treatment from the Projects grid to the rest of the app's card-style components.

- **`frontend/src/pages/Customers.tsx`** `CustomerCard`:
  - Padding `p-5` → `p-4`, gap `gap-3` → `gap-2.5`.
  - Avatar block `h-10 w-10 text-sm` → `h-9 w-9 text-[13px]`.
  - Title `text-sm font-semibold` → `text-base font-bold`, added `group-hover:text-primary`.
  - AM / SA / description / projects-count rows: `text-[12px]` → `text-[13px]`; description gained `leading-snug`.
  - Footer: collapsed the two stacked divider rows ("N projects" + "Edit/Delete") into a single row sharing one `border-t` — saves ~24px of vertical space and makes Edit/Delete inline-right of the project count.
  - Chevron now flips to primary color on hover.
- **`frontend/src/pages/Overview.tsx`** dashboard cards:
  - All four panels: `p-5` → `p-4`.
  - Card headings: `font-display text-sm font-semibold` → `font-display text-base font-semibold`.
- **`frontend/src/pages/views/ProjectKanban.tsx`** `TaskCard`:
  - Padding `p-4` → `p-3` (cards already feel dense; tightening to compensate for bigger text).
  - Title `text-sm` → `text-[15px]`.
  - Duration / count strip: `text-[12px]` → `text-[13px]` and icons `text-[14px]` → `text-[15px]`.
  - Description `text-[12px]` → `text-[13px]` + `leading-snug`.
  - `mb-2`/`mb-3` between sections trimmed to `mb-1.5`/`mb-2`.

### Changed — 2026-05-09 — Tighter, more readable Project cards on /projects

- **`frontend/src/pages/Projects.tsx`** `ProjectCard`:
  - Padding `p-5` → `p-4` (tighter card).
  - Title: `text-sm` → `text-base` (17px) + `leading-tight`. Edit icon `text-[14px]` → `text-[16px]` to keep parity.
  - Customer name: `text-[12px]` → `text-[13px]`.
  - Description: `text-xs` → `text-[13px]` + `leading-snug`; clamp `line-clamp-3` → `line-clamp-2`; `min-h-[3rem] mb-5` → `min-h-[2.4rem] mb-3`.
  - SA/TAM avatars: `h-7 w-7` → `h-6 w-6` (proportional with the smaller card).
  - "N issues" footer: `text-xs` → `text-[13px]`, icon `text-[15px]` → `text-[16px]`.

Net result: smaller card, larger body text — denser grid plus better readability.

### Changed — 2026-05-09 — Project context right sidebar defaults to closed

- **`frontend/src/pages/ProjectDetail.tsx`** — `contextOpen` state initialized to `false` instead of `true`. The 320px right sidebar (RightSidebar) now stays hidden until the user clicks the Context toggle in the header. Gives the canvas more horizontal room on first load — especially useful for the new Diagram view.

### Added — 2026-05-09 — Network Diagram (Dependency View) tab — full implementation

OmniPlan-style freeform DAG canvas of project tasks, mounted as the 7th project sub-tab at `projects/:id/diagram` (positioned **before** Risks). Tasks are draggable nodes (rectangle for regular, hex for milestone), connected by stepped SVG edges showing predecessor → successor dependencies, grouped into colored phases via `Section.color`, with a togglable critical-path highlight. Both light and dark theme variants honored.

**Backend** (`backend/`):
- **Schema** (`prisma/schema.prisma`):
  - New `DependencyType` enum: `HARD` | `SOFT` (drives solid vs dashed edges).
  - New `TaskDependency` model with `predecessorTaskId`, `successorTaskId`, `type`, `projectId` (denormalised for cascade + visibility), unique on `(predecessorTaskId, successorTaskId)`.
  - `Task` extended: `isMilestone Boolean @default(false)`, `diagramX Float?`, `diagramY Float?` (nullable so dagre auto-layout only runs for tasks the user hasn't manually placed).
  - `Section` extended: `color String @default("#94a3b8")`.
  - `Project` got `taskDependencies TaskDependency[]` back-relation for cascade.
- **Migration**: `20260509102543_add_task_dependencies_and_diagram_fields`. Run with `DATABASE_URL=… npm run prisma:migrate -- --name add_task_dependencies_and_diagram_fields` per CLAUDE.md.
- **Routes**:
  - New `src/routes/dependencies.ts` exporting `dependenciesRouter`. Mounts at `/dependencies` for item-scoped `PATCH /:id` (update type) + `DELETE /:id`. Visibility gated through the project the dep belongs to.
  - `src/routes/projects.ts`: added project-scoped `GET /:id/dependencies` and `POST /:id/dependencies` (with **cycle detection** via DFS reachability from the new successor back to predecessor before insert; rejects with HTTP 400 `cycle`). Also rejects self-deps and tasks not in the project. Extended `createSectionSchema` and `createTaskSchema` to accept `color` and `isMilestone` respectively. Added `color` to all `section: { select }` includes so the frontend gets it.
  - `src/routes/tasks.ts`: extended `updateTaskSchema` to accept `isMilestone`, `diagramX`, `diagramY`. PATCH now writes them.
  - `src/routes/sections.ts`: extended `updateSectionSchema` to accept `color` (validated `/^#[0-9a-fA-F]{6}$/`).
  - `src/app.ts`: mounted `dependenciesRouter` at `/dependencies`.

**Frontend** (`frontend/`):
- **Dependencies**: added `@xyflow/react` (^12.10.2), `dagre` (^0.8.5), `@types/dagre` (^0.7.54) in `package.json`.
- **Types & queries** (`src/lib/queries.ts`):
  - `Task` interface gained `isMilestone`, `diagramX`, `diagramY`. `Task.section` gained `color`.
  - `Section` interface gained `color`.
  - New `DependencyType`, `TaskDependency`, `CreateDependencyInput` types.
  - New hooks: `useProjectDependencies`, `useCreateDependency`, `useUpdateDependency`, `useDeleteDependency`. Added `queryKeys.projectDependencies`.
  - `useUpdateSection` invalidates `projectTasks` too (so section-color changes flow into the cached task data the diagram reads).
  - `UpdateTaskInput`/`CreateTaskInput` extended with `isMilestone` + diagram coordinates.
- **Diagram helpers** (`src/lib/diagram/`, new directory):
  - `autoLayout.ts` — runs `dagre` left-to-right, returns `taskId → {x,y}` top-left positions.
  - `criticalPath.ts` — Kahn topological sort + longest-path relaxation over `effortDays(task)`. Returns `{ taskIds: Set, edgeIds: Set }`. Pure function. Bails out with empty result on cycles (which the backend rejects anyway).
  - `colorUtils.ts` — `phaseColor(section)` falls back to a hash-derived palette when `Section.color` is missing/invalid.
- **New view** (`src/pages/views/ProjectDiagram.tsx`):
  - Wraps everything in `ReactFlowProvider`. Custom node types `task` (rectangle) + `milestone` (hex via clip-path). Custom edge type `phase` using `getSmoothStepPath`, with `strokeDasharray="6 4"` on SOFT and stroke colour from source's section.
  - Node positions seed from `Task.diagramX`/`diagramY`; tasks with null coords get auto-layout via dagre. `onNodeDragStop` PATCHes coords to the server.
  - `onConnect` (drag from right handle to left handle) creates a HARD dependency. Backend cycle rejection surfaced as a dismissible toast.
  - `onEdgeDoubleClick` confirms then deletes the edge.
  - `onNodeClick` selects + highlights upstream/downstream chain (edges fade to 20% for non-related, others stay full opacity). `onNodeDoubleClick` opens the existing `TaskFormModal` for full editing.
  - Floating toolbar (top-left): "Critical Path" toggle (on by default) + "Auto-layout" button (re-runs dagre and persists). Phase legend (top-right) lists every Section the project's tasks belong to with its color swatch + name. MiniMap (bottom-right) auto-colors nodes by phase.
- **Theme-aware canvas** (`src/index.css`): added `.diagram-canvas` block with CSS variables (`--diagram-canvas-bg`, `--diagram-node-bg`, `--diagram-grid`, `--diagram-glow`, `--cp-stroke`) that flip under `.dark` (the existing app-wide dark-mode toggle). Light mode = `#f8fafc` canvas with primary-blue critical-path halo. Dark mode = `#0d0d1a` canvas with white halo. `.diagram-task-node` (rectangle) and `.diagram-milestone-node` (hex via clip-path) styles plus `[data-cp]`/`[data-selected]`/`[data-faded]` highlight states. Also styled `.react-flow__minimap` and `.react-flow__controls` to match.
- **Wiring**:
  - `src/App.tsx`: imported `ProjectDiagram`, added `<Route path="diagram" />` under `projects/:id` (between `timeline` and `risks`).
  - `src/pages/ProjectDetail.tsx`: added `{ to: "diagram", label: "Diagram" }` to the `TABS` array between Timeline and Risks (text-only, no icon — matches the other tabs).
- **Form controls**:
  - `src/components/TaskFormModal.tsx`: added an "Is milestone" `FieldRow` (hex icon + checkbox) between Labels and the existing rows. Wired to the new `isMilestone` field; sends through both create and edit flows.
  - `src/pages/views/ProjectList.tsx`: added a small color-swatch + native `<input type="color">` to each section header (real sections only, not the synthetic No-section group). Plumbed via a new `onColorChange` prop on `SectionBlock`. Updates flow through the existing `useUpdateSection` hook.

Why: per the approved plan at `~/.claude/plans/refactored-sauteeing-bird.md`. The view gives PMs a visual schedule-logic surface that complements the Gantt — Gantt shows time, Diagram shows precedence. Phase colors via `Section.color` (rather than a new `Phase` model) keeps the data model lean. Critical path is computed client-side because typical project sizes (a few dozen tasks) stay well within JS performance.

### Added — 2026-05-09 — Network Diagram preview mockup (review artifact)

- **`New UI/network-diagram-preview.html`** — static, single-file HTML mockup of the planned Network Diagram (Dependency View) tab. Tailwind CDN + Source Sans 3 + Material Symbols + JetBrains Mono. Renders sample 9-task / 3-milestone DAG with phase-colored task nodes, hex-clipped milestone nodes, stepped SVG dependency edges (solid = HARD, dashed = SOFT), arrowheads, "Critical Path" toggle ON state with halo glow on the longest chain, "Implement revisions" shown in selected state, floating toolbar (top-left), phase legend (top-right), and minimap (bottom-right). No JS framework — pure SVG + CSS.
- **Theming**: follows OS appearance via `@media (prefers-color-scheme: dark)`. Canvas/nodes/toolbar/minimap/critical-path glow all flip — light mode uses a `#F8FAFC` canvas with white nodes and a primary-blue critical-path halo; dark mode uses `#0d0d1a` canvas with `#1a1a2e` nodes and a white halo. Tailwind config uses `darkMode: 'media'`. Critical-path arrowhead marker uses `currentColor` so the parent `<g style="color: var(--cp-stroke)">` flips marker fill in tandem with edge stroke.
- **Tab order**: Diagram is positioned **before** Risks (between Timeline and Risks) per user preference.

Why: per the approved plan at `~/.claude/plans/refactored-sauteeing-bird.md`, Deliverable 0 — visual sign-off before any backend schema or frontend code lands. Open the file directly in a browser; no build step.

### Changed — 2026-05-09 — Move project title into TopBar on project routes

The project breadcrumb + name + status chip were eating ~80px of vertical space at the top of every project view. Moved them into the TopBar so the canvas can use that real estate for actual work.

- **`frontend/src/components/layout/TopBar.tsx`** — On routes matching `/projects/:id/*`, the static `My Projects` title is replaced with `Projects / [project.name]` (link + name) plus the live `ProjectStatusChip`. Uses `useProject(id)` which hits the same TanStack Query cache populated by `ProjectDetail` — no extra network request.
- **`frontend/src/pages/ProjectDetail.tsx`** — Removed the in-page breadcrumb, `<h1>`, and status chip from the project header (now in TopBar). Removed the `Link` and `ProjectStatusChip` imports that became unused. Kept the description line, SA→TAM/tasks meta row, and the Edit/Context action buttons; reduced the header's bottom margin from `mb-4` → `mb-3` since it's much thinner.

### Added — 2026-05-09 — Project Overview tab with S-curve (baseline vs current)

New project sub-route `projects/:id/overview` becomes the default landing tab when entering a project (replaces the old default `list`).

- **`frontend/src/pages/views/ProjectOverview.tsx`** (new) — Overview view containing:
  - **KPI strip** (4 cards): total tasks (with top-level/subtask split), completion %, overdue count, baseline lock state.
  - **Progress S-Curve segment** (`recharts` LineChart) plotting cumulative tasks scheduled to complete over time. Two series: dashed gray "Baseline (planned)" using `task.baselineDueDate`, solid blue "Current (re-planned)" using `task.dueDate`. Includes a `ReferenceLine` at "today", a slip-days indicator (delta between baseline final date and current final date), and a custom legend strip.
  - **Empty / lock states**: when no baseline is locked, only the current curve is shown plus a "Lock baseline in Gantt" CTA. When no tasks have dates, an empty-state card replaces the chart.
- **`frontend/src/App.tsx`** — Registered `<Route path="overview" element={<ProjectOverview />} />` under `projects/:id`. Switched the index redirect from `list` → `overview`.
- **`frontend/src/pages/ProjectDetail.tsx`** — Added `Overview` as the first entry in the `TABS` array.

Why: gives TAMs a single-glance status surface — completion, overdue, and schedule-slip — without opening Gantt. The S-curve is the canonical PM view of planned-vs-actual progress; here "actual" is interpreted as the currently-scheduled timeline (since tasks don't carry a `completedAt` timestamp), which still reveals re-plans relative to the locked baseline.

### Changed — 2026-05-09 — Harmonize all modals with TaskFormModal styling

Make every modal in the app share the same chrome/footer language as the redesigned TaskFormModal.

- **`frontend/src/components/Modal.tsx`** — Default header (rendered when no `customHeader` is supplied) now uses the subtle breadcrumb style: `bg-surface-container-low`, `text-xs text-on-surface-variant`, `py-3` (was `text-base font-semibold text-on-surface`, `py-4`, no bg). All modals inheriting the default header now match the task modal's quieter top-bar style.
- **`frontend/src/components/ProjectFormModal.tsx`**, **`CustomerFormModal.tsx`**, **`RiskFormModal.tsx`**, **`ConfirmModal.tsx`** — Footer buttons unified to the TaskFormModal pattern:
  - Cancel: `rounded-lg border border-outline-variant px-4 py-1.5 text-xs font-semibold text-on-surface-variant hover:bg-surface-container` (was a flat link-style `rounded` button with no border).
  - Primary action: `rounded-lg bg-primary … hover:bg-primary/90` (was `rounded bg-primary … hover:bg-primary-container` with `font-display`). Removed `font-display` since TaskFormModal doesn't use it on action buttons.
  - ConfirmModal warning tone updated to match: `rounded-lg`, no `font-display`.

### Changed — 2026-05-09 — Compact spacing in ProjectList (Task List view)

The font bump pushed task rows visually further apart; tightened vertical paddings to restore density.

- **`frontend/src/pages/views/ProjectList.tsx`**:
  - Section header row: `py-2` → `py-1.5`.
  - Task row (desktop grid): `py-3` → `py-1.5`.
  - Task row (mobile card): `py-3` → `py-2`.
  - Subtask row (desktop grid): `py-2` → `py-1`.
  - Subtask row (mobile card): `py-2` → `py-1.5`.
  - "Add task..." button (under section): `py-2` → `py-1`.
  - "Add subtask..." button (desktop, inline): `py-1.5` → `py-1`.
  - Empty-section message: `py-3` → `py-2`.
  - Title + ID-subtext column: removed `gap-0.5` (let line-height handle spacing).

### Changed — 2026-05-09 — Global font-size bump (+1px across the scale)

Default fonts felt too small at desktop viewport. Applied a uniform +1px bump.

- **`frontend/tailwind.config.ts`** — Overrode Tailwind's default `fontSize` scale via `theme.extend.fontSize`: `xs` 12→13, `sm` 14→15, `base` 16→17, `lg` 18→19, `xl` 20→21, `2xl` 24→25, `3xl` 30→31, `4xl` 36→37 (each with proportional `lineHeight`). Bumped app-specific tokens too: `h1` 32→34, `h2` 24→26, `body-lg` 16→17, `body-sm` 14→15, `data-mono` 13→14, `label-caps` 11→12.
- **Mass replacement of arbitrary `text-[Npx]` utilities across `frontend/src/`** (281 occurrences) — applied +1px to every bracket-syntax pixel size, largest-to-smallest order to avoid double-bumping: `[20px]→[21px]`, `[18px]→[19px]`, `[16px]→[17px]`, `[14px]→[15px]`, `[13px]→[14px]`, `[12px]→[13px]`, `[11px]→[12px]`, `[10px]→[11px]`, `[9px]→[10px]`. Scope: all `*.ts` / `*.tsx` files under `frontend/src/`.

Why: keeps the visual hierarchy and density intact while improving readability at default zoom. `npm run typecheck` passes.

### Changed — 2026-05-09 — Screen-by-screen refinement pass (Projects, List, Kanban, Task modal)

Iterated on the AProjectO design revamp per user review of rendered screens:

- **`frontend/src/components/Modal.tsx`** — Added `customHeader?: ReactNode` prop; when provided it replaces the default title/close header so callers can supply custom breadcrumb-style headers without changing shared modal behavior.
- **`frontend/src/pages/Projects.tsx`** — Rebuilt `ProjectCard`: title + hover-reveal edit icon, status chip top-right, 3-line description clamp, bottom row with SA/TAM avatar cluster (amber/blue, -6px overlap) + issues count. Removed the old TAM-text/border-t footer. Filter bar selects/buttons updated to `rounded-lg`.
- **`frontend/src/pages/views/ProjectKanban.tsx`** — Columns no longer have a card background; they float on the bg with a ring-2 ring-primary highlight on drag-over. Column header is bold name + `more_horiz` menu icon. Teal dashed `+` box replaces the bottom "Add task" button. `TaskCard` redesigned: title + duration (`X Days` from start→due diff), 2-label strip, description `line-clamp-2`, bottom row with 📎0/💬N counts + priority badge + assignee avatar. `AssigneeAvatar` and `startOfToday` helpers removed (unused). Added `getDuration` helper.
- **`frontend/src/pages/views/ProjectList.tsx`** — Desktop grid updated from 5 columns to 7: `[36px • 1fr • 190px • 170px • 80px • 48px • 28px]`. New columns: done-toggle | task title+ID subtext | status+priority chips | dates (calendar icon) | timer `--:--:--` placeholder | assignee avatar | comment count. Imported `TaskStatusChip` and `PriorityBadge`. `SubtaskRow` desktop grid and "Add subtask" button row updated to match. Mobile card layout unchanged.
- **`frontend/src/components/TaskFormModal.tsx`** — Full Screen 7 redesign. Modal now uses `customHeader` (breadcrumb `T-XXX` + close button on `bg-surface-container-low`). Form is single-column: large borderless title input + cosmetic timer row (edit mode only); icon field rows (Priority, Status, Assignee, Due Date, Start Date, Parent, Section, Labels) inside a rounded card; Attachments placeholder; Description textarea; Subtasks checklist; Comments section with cosmetic B/I/U toolbar strip above `CommentThread`. All create/edit/delete mutations and validation logic kept intact. Width reduced from `max-w-3xl` to `max-w-lg`.

### Added — 2026-05-09 — Frontend design revamp: AProjectO design language applied across all pages

Full visual overhaul of the Solvro frontend adopting the AProjectO design language (blue-gray base `#F0F4F9`, shadow-based white cards, larger radii, pill-shaped chips, light sidebar). All backend wiring kept intact. Dark mode preserved with a blue-gray dark palette.

**Design tokens** (`frontend/src/index.css`, `frontend/tailwind.config.ts`):
- `--background` and surface-container tokens shifted from lavender (`249 249 255`) to blue-gray (`240 244 249` = `#F0F4F9`) in both light and dark themes. Dark theme rebuilt with blue-gray hue family (`bg: 15 20 30`, surface: `22 28 40` etc.).
- `--outline-variant` lightened to `209 214 226`.
- Border radius scale bumped: `DEFAULT: 0.5rem` (was 0.25), `lg: 1rem` (was 0.5), `xl: 1.5rem` (was 0.75); added `2xl: 2rem`. `sm` kept as 0.25rem.

**Layout chrome** (`Shell.tsx`, `Sidebar.tsx`, `TopBar.tsx`):
- `Shell`: main area bg changed from `bg-surface-container-low` → `bg-background` (the new blue-gray).
- `Sidebar`: background changed from `bg-slate-950` (dark) → `bg-surface-container-lowest dark:bg-surface-container-low` (white/dark-blue-gray). All `slate-*` hardcoded classes removed; active nav item changed from `bg-primary/15 text-inverse-primary` → solid `bg-primary text-on-primary`. Bottom status border updated to `border-outline-variant`.
- `TopBar`: search input changed to `rounded-full` + `border border-outline-variant`; user block now shows a two-line name/role block instead of single username.

**Shared atoms** (`StatusChip.tsx`, `PriorityBadge.tsx`, `Modal.tsx`):
- `StatusChip`: `rounded` → `rounded-full` on both `ProjectStatusChip` and `TaskStatusChip`.
- `PriorityBadge`: `rounded` → `rounded-full`.
- `Modal`: desktop radius bumped `md:rounded-lg` → `md:rounded-xl`.

**Login** (`Login.tsx`): Two-column layout — left `bg-primary` panel with decorative rings + feature icon grid; right white form panel with bottom-border-only inputs and a black "Log in" button. Mobile shows only the form panel.

**Overview** (`Overview.tsx`): Replaced 4 stat cards + 2 list sections with 2×2 dashboard grid: Projects mini-card (count + link), Tasks donut (`recharts PieChart`), Work Log coming-soon placeholder, Performance line chart (`recharts LineChart`). All cards `rounded-xl shadow-sm`.

**Project pages** (`Projects.tsx`, `ProjectDetail.tsx`, `ProjectList.tsx`, `ProjectKanban.tsx`):
- Project cards: outlined → `rounded-xl shadow-sm` (no border). Hover: shadow intensifies instead of border color change.
- ProjectDetail: breadcrumb added above title (`Projects / {name}`); buttons rounded-lg; SA → TAM flow shown in subtitle.
- ProjectList: outer wrapper → `rounded-xl shadow-sm overflow-hidden`; toolbar buttons → `rounded-lg`.
- Kanban: columns `rounded-xl shadow-sm`, `ring-2 ring-primary` on drag-over; task cards `rounded-xl shadow-sm hover:shadow-md`; column count badge → `rounded-full`.

**Form modals** (`TaskFormModal.tsx`, `ProjectFormModal.tsx`): All inputs/selects/textareas → `rounded-lg`; footer buttons → `rounded-lg`; error alerts → `rounded-lg`; subtask list → `rounded-xl`.

**Remaining pages** (`Reports.tsx`, `Settings.tsx`, `Admin.tsx`, `Customers.tsx`): All card sections → `rounded-xl shadow-sm` (border removed); inputs → `rounded-lg`; error/success alerts → `rounded-lg`; theme choice buttons in Settings → `rounded-xl`; role badge → `rounded-full`.

**Work Logs preview** (`WorkLogs.tsx`): New page with "Coming Soon" empty state (icon + heading + description + "Preview only" badge). Route `/work-logs` added to `App.tsx` under `<AuthGuard><Shell/>`. "Work Logs" nav item (`work_history` icon) added to `Sidebar.tsx` between Tasks and Reports.

### Changed — 2026-05-08 — `CLAUDE.md` synced with subtasks, comments, baseline, admin query keys, and CONFIGURATION.md

Four gaps between current code and the orientation doc closed — no code or schema touched:

- **Data model paragraph** now calls out the self-referential `parentTaskId` subtask relation and the `topLevel` query param, the `Comment` entity and its `GET/POST /tasks/:id/comments` thread, and the baseline-locking mechanics (`POST /projects/:id/baseline` snapshot-copies task dates into `baselineStartDate`/`baselineDueDate` and stamps the project).
- **Routes inventory** documents `POST /projects/:id/baseline` — what it does, how `{ clear: true }` resets, and that it operates atomically.
- **Server state hooks** list extended to include sections, comments, and `useLockBaseline`; notes the separate `adminQueryKeys` namespace (distinct from `queryKeys`) and documents the optimistic-update pattern used by `useUpdateTask`/`useUpdateRisk` as the canonical model for instant-feeling inline mutations.
- **Repository status** now references `CONFIGURATION.md` as the env/port/deployment reference.

### Added — 2026-05-04 — `CONFIGURATION.md` reference document

New top-level [CONFIGURATION.md](CONFIGURATION.md) at the repo root — a two-layer (high-level + detailed) configuration reference covering the three deployment shapes (native dev / dockerised dev / prod), every backend/frontend/postgres/GHCR env var with defaults and validation rules, services + ports + volumes, the `/api` reverse-proxy pattern, migrations, seeded credentials, RBAC config, theme tokens, and the `setup.sh` prod bootstrap. User noted they will move it later (it's at the root for now). Documentation-only — no code, schema, or compose changes.

### Changed — 2026-05-04 — `CLAUDE.md` synced with Risk Management + Gantt export additions

[CLAUDE.md](CLAUDE.md) was drifting against recent commits (f44133e Risk Management view, 8c1b78c Gantt Excel/PDF export). Synced the orientation doc so future Claude sessions don't re-discover this from scratch:

- **Routes inventory** updated to include `risks` and explain the split (`PATCH/DELETE /risks/:id` lives in [backend/src/routes/risks.ts](backend/src/routes/risks.ts); creation is nested under `POST /projects/:id/risks` in [backend/src/routes/projects.ts](backend/src/routes/projects.ts)) — both gate via `requirePermission("project:write")` + `projectVisibilityFilter`.
- **Admin sub-tree** now called out explicitly: `/admin` carries user CRUD **and role CRUD** (custom roles with arbitrary permission arrays), which is what makes the project-wide `hasPermission`-not-role-name pattern load-bearing.
- **Project sub-views** updated from four to five (`{list,kanban,gantt,timeline,risks}`) with the wiring rule "register in both [App.tsx](frontend/src/App.tsx) and [ProjectDetail.tsx](frontend/src/pages/ProjectDetail.tsx)".
- **Prisma data-model paragraph** now lists `Risk` (and the `Service` / `CustomerService` join) alongside the other domain models, with a one-line note that `riskScore` is derived (`probability × impact`) — not stored — so future agents don't try to add a column or trigger.
- **Server-state hooks** paragraph mentions `useProjectRisks` / `useCreateRisk` / `useUpdateRisk` / `useDeleteRisk` and the centralised `queryKeys` map.
- **Gantt export layer** added as its own bullet under Frontend conventions: [exportExcel.ts](frontend/src/lib/gantt/exportExcel.ts) (`exceljs`) + [exportPdf.ts](frontend/src/lib/gantt/exportPdf.ts) (`jspdf` + `jspdf-autotable`) + shared [exportContext.tsx](frontend/src/lib/gantt/exportContext.tsx). Documented the rule that the heavy export deps must stay behind dynamic `import()` so they don't enter the main bundle.

No code or schema touched — documentation-only sync.

### Added — 2026-05-03 — Risk Management view (Risk Register Table) on Project Detail

New project sub-view at `/projects/:id/risks`, sitting next to **Timeline** in the project tab nav. Implements a full risk register:

- **Schema** — [backend/prisma/schema.prisma](backend/prisma/schema.prisma): new `Risk` model (`description` text, `category` enum, `probability` 1–5, `impact` 1–5, `status` enum, `mitigationPlan` / `contingencyPlan` long text, timestamps) plus two enums `RiskCategory` (EXTERNAL / INTERNAL / TECHNICAL / ORGANIZATIONAL / FINANCIAL) and `RiskStatus` (OPEN / MITIGATED / CLOSED). `Risk` cascades on project delete. Indexed on `projectId`, `status`, `category`. Migration: [20260502185229_add_risks](backend/prisma/migrations/20260502185229_add_risks/). Score is **not stored** — it's a derived field (`probability × impact`) computed in the UI to keep the source of truth single.
- **Backend routes** — [backend/src/routes/risks.ts](backend/src/routes/risks.ts) for `PATCH /risks/:id` and `DELETE /risks/:id`; project-scoped `GET /projects/:id/risks` and `POST /projects/:id/risks` added to [backend/src/routes/projects.ts](backend/src/routes/projects.ts). Both project-scoped endpoints honour `projectVisibilityFilter` (so SAs/TAMs only see risks on projects they can already see). Item-scoped PATCH/DELETE re-resolve the parent project through the same filter to prevent cross-project access. Writes gated by `requirePermission("project:write")`. Mounted at `/risks` in [backend/src/app.ts](backend/src/app.ts).
- **Frontend data layer** — [frontend/src/lib/queries.ts](frontend/src/lib/queries.ts): `Risk`, `RiskCategory`, `RiskStatus` types; query key `projectRisks(id)`; hooks `useProjectRisks`, `useCreateRisk`, `useUpdateRisk` (with optimistic update for inline cell edits), `useDeleteRisk`.
- **Form modal** — [frontend/src/components/RiskFormModal.tsx](frontend/src/components/RiskFormModal.tsx): create/edit modal with description, category, status, probability/impact (1–5 selects with descriptive labels), live-computed score with color band, and the two long-text plans. Exports the `scoreClass` and `scoreLevel` helpers so the table view can reuse them.
- **View** — [frontend/src/pages/views/ProjectRisks.tsx](frontend/src/pages/views/ProjectRisks.tsx): summary tiles (count by High/Medium/Low + Open), search input (description + plans), category filter, status filter, plus a dense table with inline editable Probability / Impact / Status cells (uses `useUpdateRisk`'s optimistic update to keep the cell snappy). Score cell is color-coded: 1–8 emerald (Low), 9–15 amber (Medium), 16–25 error/red (High). Mobile fallback below `md:` is a stacked card list (matching the project-wide pattern). Tab/route wired in [frontend/src/App.tsx](frontend/src/App.tsx) and [frontend/src/pages/ProjectDetail.tsx](frontend/src/pages/ProjectDetail.tsx).

Why a derived `riskScore` instead of a stored column: any time prob/impact changes the cached score has to be recomputed; storing it would either require a trigger or risk drift between the inputs and the stored score. The UI computes it anywhere it's shown, so there's no source of staleness.

### Changed — 2026-05-03 — Task editor: drop baseline-date fields; List view shows task description under the title

Two unrelated UX trims to the task surface:

- **[frontend/src/components/TaskFormModal.tsx](frontend/src/components/TaskFormModal.tsx)** — removed the entire "Baseline Dates" subsection (the dashed-border block with `baselineStartDate` / `baselineDueDate` inputs and the explanatory caption), along with the four supporting locals (`baselineStartDate`, `baselineDueDate` state, the two `setBaseline*` reset paths in the open-effect, and the `baselineStartIso` / `baselineDueIso` payload fields on the update mutation). Baseline planning is conceptually a *Gantt-only* concern — it's the visual delta between planned vs. actual that only makes sense in the bar-chart context. Mixing it into a per-task editor invited stale baselines and clutter. Schedule edits in the editor still use the regular `startDate` / `dueDate` fields. The backend still accepts `baselineStartDate` / `baselineDueDate` patches; the editor simply no longer writes to them. When a Gantt-side baseline UI is wired up (separate task), it can re-introduce these fields in the right place.
- **[frontend/src/pages/views/ProjectList.tsx](frontend/src/pages/views/ProjectList.tsx)** — task description now renders **inline to the right** of the title (separated by an em-dash, single-line truncated) in all four row variants (top-level desktop, top-level mobile, subtask desktop, subtask mobile). Title is `shrink-0 truncate` so it never collapses; description gets the remaining space (`min-w-0 truncate`) and is clipped if the row is narrow. Picked inline over the original "stacked under title" layout because the row is already a single-line grid — stacking pushed the row height up and broke vertical rhythm with neighbouring rows. Description only renders when present, so empty-description rows look identical to before. Helps users scan the list view without needing to open every task to see what it's actually about.

### Removed — 2026-05-03 — `SOLV-XXX` ID badges everywhere; `T-XXX` from low-value sites

The `SOLV-XXX` and `T-XXX` strings were pure frontend renderings of the database autoincrement integer IDs (`String(id).padStart(3, "0")` with a hardcoded prefix). Audit confirmed they were never used in routing (URLs key off raw int), never sent to the backend API (purely cosmetic), not searchable (TopBar search non-functional), and not in PRD.md / DESIGN.md as product requirements. They came from the mockups as visual filler. Cleaned up the noise:

- **SOLV-XXX dropped everywhere** (4 sites). Users navigate projects by name + status + customer, not by autoincrement ID.
  - **[frontend/src/components/layout/RightSidebar.tsx](frontend/src/components/layout/RightSidebar.tsx)** — header now shows just the status chip + project name, no ID line.
  - **[frontend/src/pages/Projects.tsx](frontend/src/pages/Projects.tsx)** — project card shows status chip aligned right, no ID caption above the title. Status row uses `justify-end` since the ID was the only left-side element.
  - **[frontend/src/pages/ProjectDetail.tsx](frontend/src/pages/ProjectDetail.tsx)** — page header drops the small SOLV-XXX caption above the H1.
  - **[frontend/src/pages/Overview.tsx](frontend/src/pages/Overview.tsx)** — recent-projects list shows just the status chip + name + meta, no ID.
- **T-XXX kept** in 2 sites where users actually reference tasks by short stable code:
  - [frontend/src/pages/Tasks.tsx](frontend/src/pages/Tasks.tsx) — the cross-project Tasks table's monospace ID column (canonical reference for standups/Slack/commits).
  - [frontend/src/components/TaskFormModal.tsx](frontend/src/components/TaskFormModal.tsx) Parent task dropdown — disambiguates two parents that happen to share a similar title.
- **T-XXX dropped** in 3 decoration-only sites:
  - **[frontend/src/components/TaskFormModal.tsx](frontend/src/components/TaskFormModal.tsx)** — modal title bar now reads "Edit task" instead of "Edit task · T-008" (the modal is already scoped to one task).
  - **[frontend/src/components/TaskFormModal.tsx](frontend/src/components/TaskFormModal.tsx)** — subtask list inside the edit modal drops the inline T-XXX next to each subtask title; collapsed the row from `flex items-center justify-between` to `flex items-center gap-2` since there's no longer a right-side element to balance.
  - **[frontend/src/pages/views/ProjectTimeline.tsx](frontend/src/pages/views/ProjectTimeline.tsx)** — timeline rows drop the leading T-XXX chip in front of status/priority; subtask sub-list drops T-XXX in front of titles.
- **No backend / schema / routing change** — purely UI. The mockup HTMLs in [UI Design/](UI Design/) still show SOLV-XXX, but per CLAUDE.md "DESIGN.md frontmatter wins" on drift; those are frozen reference assets.

### Changed — 2026-05-03 — Gantt PDF export rewritten as native vector drawing (no html2canvas)

After the previous "crop the html2canvas capture" attempt still produced 8 mostly-blank pages with no visible Gantt, the PDF export was rewritten end-to-end. The DOM-screenshot approach kept failing — likely a combination of CSS-variable resolution, sticky-positioned axis, and the chart's nested `overflow:auto` ancestor confusing html2canvas's layout pass. Symptoms ranged from blank pages to phantom transparent regions to the bars rendering as the wrong color. Replaced with a deterministic vector renderer.

- **[frontend/src/lib/gantt/exportPdf.ts](frontend/src/lib/gantt/exportPdf.ts)** — completely rewritten. Now draws the Gantt directly using `jspdf` primitives (`rect`, `line`, `text`, `setFillColor`, `setDrawColor`) from the same `rows`/`holidays` data the UI consumes. No html2canvas, no DOM read, no layout-dependent capture. Layout: a 160pt label column on the left + a date grid that auto-fits one A4-landscape page (or paginates if days × min-column-width exceeds the available width). Row height auto-scales to fit all rows on one page (clamped 11–18pt). Renders: month bands + day numbers in a 22pt axis, weekend/holiday tints across the body, a red today line, status-colored bars with priority-colored left borders, section headers with tinted full-row backgrounds, and bar labels inside bars when there's space. Bars that straddle a horizontal page boundary are clamped to the visible day range so they appear on each page they cover. Final page is the unchanged jspdf-autotable task table (Section · Title · Status · Priority · Start · Due).
- **[frontend/src/components/gantt/GanttFrame.tsx](frontend/src/components/gantt/GanttFrame.tsx)** — `exportGanttToPdf` no longer needs `ganttContentEl`/`chartStart`/`viewMode`/`columnWidth`. Call site simplified to `{ projectName, rows, exportStart, exportEnd, holidays }`. Removed the now-unused `ganttContentRef` and the `bg-surface-container-lowest` class on the inner content div (was only added to make the html2canvas capture have a defined background — no longer relevant).
- **[frontend/package.json](frontend/package.json)** — uninstalled `html2canvas` from direct deps (no longer imported). It still appears as a transitive dep of jspdf (jspdf uses it internally for its `pdf.html()` API which we don't call), so a `html2canvas.esm-*.js` chunk still appears in `dist/assets/` — but it's never loaded at runtime.
- **Output is vastly smaller**: previous html2canvas-based PDFs were multi-MB rasterized; the new vector PDF for a typical project is <100KB. Also crisp at any zoom (vectors, not pixels) and the text is searchable.

### Fixed — 2026-05-03 — Gantt PDF export produced ~100 blank pages

- **[frontend/src/lib/gantt/exportPdf.ts](frontend/src/lib/gantt/exportPdf.ts), [frontend/src/components/gantt/GanttFrame.tsx](frontend/src/components/gantt/GanttFrame.tsx)** — symptom: PDF export produced 102 pages, the Gantt screenshot was nowhere visible, and the only meaningful content (the task table) appeared on the last page. Root cause: the on-screen Gantt is padded ±1 year of empty columns on each side for natural scroll headroom (`PAD_YEARS = 1` in [geometry.ts](frontend/src/lib/gantt/geometry.ts)), so `ganttContentEl.scrollWidth` was ~45,000px. html2canvas captured the full 45k-pixel canvas; pagination sliced it into ~100 vertical slabs, each landing in the empty padding region (the actual task bars are in a thin slice ~1% of the way through). Fix: `exportGanttToPdf` now also receives `chartStart`/`viewMode`/`columnWidth` and an `exportStart`/`exportEnd` window (the same ±7-day window used by Excel). After the full canvas is captured, it's cropped to `[list_pane | tight_chart_slice]` via `positionFor()` mapping the export window into element pixels and then into canvas pixels via the html2canvas `scale` factor. Pagination then runs on the cropped canvas, producing typically 1–2 pages of dense Gantt followed by the task table page. Also switched html2canvas's `backgroundColor` from `null` (transparent) to `#ffffff` so blank slices, if any, are explicitly white instead of relying on whatever's underneath.

### Changed — 2026-05-03 — Gantt Excel export: trim Tasks sheet to 6 columns

- **[frontend/src/lib/gantt/exportExcel.ts](frontend/src/lib/gantt/exportExcel.ts)** — Sheet 1 ("Tasks") dropped Task ID, Baseline Start, Baseline Due, Assignee, and Labels. Final columns are Section · Title · Status · Priority · Start · Due. The Sheet 2 ("Gantt") date grid is unchanged.

### Fixed — 2026-05-03 — Gantt export: PDF `autoTable is not a function`; Excel grid spans ±1 year of empty columns

Two follow-up fixes to the Gantt export feature added the same day:

- **[frontend/src/lib/gantt/exportPdf.ts](frontend/src/lib/gantt/exportPdf.ts)** — `jspdf-autotable` v5 (the version pinned by `^5.0.7`) no longer monkey-patches the jsPDF prototype on side-effect import; the previous `(pdf as any).autoTable(opts)` call site threw `autoTable is not a function`. Switched to the canonical v3+ API: `import autoTable from "jspdf-autotable"` (via dynamic-import default export) and call as `autoTable(pdf, opts)`. Removed the obsolete `as unknown as { autoTable: … }` type cast.
- **[frontend/src/components/gantt/GanttFrame.tsx](frontend/src/components/gantt/GanttFrame.tsx)** — the Excel export was being passed `chartStart` / `chartEnd`, which include the chart's `PAD_YEARS = 1` year of padding on each side ([geometry.ts](frontend/src/lib/gantt/geometry.ts)). For a project with tasks spanning a few weeks the resulting "Gantt" sheet was 700+ mostly-empty columns. Now computes a tight ±7-day window around `dateRange.min` / `dateRange.max` (the actual task date range, already memoized) and passes that into `exportGanttToExcel`. Falls back to `chartStart` / `chartEnd` when `dateRange` is null (no dated tasks). The on-screen Gantt visualization itself is unchanged — still uses the wide padding for natural scroll headroom.

### Added — 2026-05-03 — Export Gantt schedule to Excel / PDF

Two new export buttons in the project's right context sidebar (visible only while the Gantt sub-route is active) produce takeaway artefacts of the project schedule:

- **Excel (.xlsx)** — two-sheet workbook. Sheet 1 "Tasks" is a flat sortable table (Section, Task ID, Title, Status, Priority, Start, Due, Baseline Start, Baseline Due, Assignee, Labels). Sheet 2 "Gantt" is a date-grid emulation of the visual Gantt: one column per day from `chartStart` to `chartEnd`, weekends/holidays subtly shaded, today's column outlined in red, task rows with status-colored fills across `[startDate..dueDate]` and a priority-colored left border on the first day of each task.
- **PDF** — A4 landscape multi-page report. Page 1+ is a `html2canvas` screenshot of the **full** Gantt content (chart wider than viewport is auto-sliced into multiple horizontal pages so nothing is clipped); the final page is a `jspdf-autotable` task table.

**Why right sidebar instead of Gantt toolbar**: the toolbar is already busy (Today / Task / Section / Lock Baseline / Scale picker) and the export concept is project-level rather than tool-level. The buttons live next to the rest of the project context (Stakeholders, Documents) where stakeholder reporting actions naturally belong.

- **[frontend/package.json](frontend/package.json)** — added 4 deps: `exceljs` (chosen over `xlsx` because the date-grid sheet needs colored cell fills, which require ExcelJS's first-class style support), `html2canvas`, `jspdf`, `jspdf-autotable`.
- **All four are lazy-loaded** via dynamic `import()` from inside the export functions. Build output confirms separate chunks: `exceljs.min-*.js` (~938KB), `jspdf.es.min-*.js` (~390KB), `html2canvas.esm-*.js` (~201KB), `jspdf.plugin.autotable-*.js` (~31KB) — main bundle (`index-*.js`) grew only ~13KB for the wiring code, not the libs themselves.
- **[frontend/src/lib/gantt/exportContext.tsx](frontend/src/lib/gantt/exportContext.tsx)** — new `GanttExportProvider` + `useGanttExport()` hook. Stores `{ excel, pdf }` handlers in state. The handlers' presence is the gate: when `null`, the sidebar Export section is hidden. Bridges the Gantt sub-route (where data + DOM ref live) and the right sidebar (mounted by ProjectDetail, outside the routed Outlet).
- **[frontend/src/lib/gantt/exportExcel.ts](frontend/src/lib/gantt/exportExcel.ts)** — new. Builds the two-sheet workbook in pure JS, triggers download via Blob + `<a download>`. Filename: `${slug(projectName)}_gantt_${yyyy-mm-dd}.xlsx`.
- **[frontend/src/lib/gantt/exportPdf.ts](frontend/src/lib/gantt/exportPdf.ts)** — new. Renders the `ganttContentRef` element via html2canvas at full `scrollWidth` × `scrollHeight` (the DOM is laid out at full chart size; only the outer `overflow:auto` container crops the viewport, so html2canvas captures off-screen content too). Slices into per-page horizontal slabs with a fresh white-backed canvas per slab so wide projects span multiple pages without clipping. Final page rendered via `jspdf-autotable`.
- **[frontend/src/lib/gantt/palette.ts](frontend/src/lib/gantt/palette.ts)** — new. Single source of truth for status fill hex (sky-200 / blue-400 / emerald-400) and priority border hex (slate-400 / blue-500 / amber-500 / red-500). Used by [GanttBar.tsx](frontend/src/components/gantt/GanttBar.tsx) at the inline `borderLeft` style and by both export modules so the UI and the artefacts share one color table.
- **[frontend/src/components/gantt/GanttBar.tsx](frontend/src/components/gantt/GanttBar.tsx)** — refactor only. Replaced the inline `PRIORITY_BORDER_COLOR` map with the imported `PRIORITY_BORDER_HEX` from `palette.ts`. No behavior change.
- **[frontend/src/components/gantt/GanttFrame.tsx](frontend/src/components/gantt/GanttFrame.tsx)** — added `projectName: string` prop, a `ganttContentRef` on the inner full-content `<div>` (the html2canvas target), and a `useEffect` that calls `useGanttExport().register({ excel, pdf })` whenever `chartStart`/`chartEnd`/`rows`/`holidays`/`projectName` change. Cleanup callback registers `null` so the sidebar section hides when the Gantt unmounts (e.g. user navigates to List/Kanban/Timeline). Errors thrown by either export bubble into the existing `setActionError` toast bar in addition to the per-button error state in the sidebar. Inner content `<div>` got `bg-surface-container-lowest` so the html2canvas capture has a defined background even on transparent themes.
- **[frontend/src/components/layout/RightSidebar.tsx](frontend/src/components/layout/RightSidebar.tsx)** — new "Export schedule" `<section>` block before the Documents section. Two buttons (Excel + PDF) with material icons (`table_view`, `picture_as_pdf`), local `exporting` state for "Exporting…" labels, an inline error block for failures. Reads handlers from `useGanttExport()` and conditionally renders the whole section only when handlers are non-null — so List/Kanban/Timeline sub-routes don't show export buttons that wouldn't have valid Gantt data behind them.
- **[frontend/src/pages/ProjectDetail.tsx](frontend/src/pages/ProjectDetail.tsx)** — wrapped the project page tree (the existing `<div>`-with-context-margin and the trailing `<RightSidebar>`) in a single `<GanttExportProvider>`. Provider lifetime matches a single project's lifetime; no global state pollution.
- **[frontend/src/pages/views/ProjectGantt.tsx](frontend/src/pages/views/ProjectGantt.tsx)** — passes `projectName={project.name}` (already in scope from `useProjectContext()`) into `<GanttFrame>` for the export filename.
- **Permissions**: ungated. Anyone who can view the Gantt can export it (read-only data). STAKEHOLDER role works without `task:write`.
- **Theme**: PDF screenshot captures whatever theme is currently active. Forcing light mode at export time is a future tweak if dark-themed exports look bad on print.

### Added — 2026-05-03 — Delete tasks from the task editor

- Backend `DELETE /tasks/:id` (in [backend/src/routes/tasks.ts](backend/src/routes/tasks.ts), gated by `requirePermission("task:write")`) already existed; this commit only adds the frontend wiring.
- **[frontend/src/lib/queries.ts](frontend/src/lib/queries.ts)** — new `useDeleteTask(projectId)` mutation hook. Invalidates `projectTasks(projectId)`, the cross-project `["tasks"]` list, and the overview query on success so dependent panes (Kanban, Gantt, List, Tasks page, Overview cards) refresh immediately.
- **[frontend/src/components/TaskFormModal.tsx](frontend/src/components/TaskFormModal.tsx)** — added a "Delete task" button in the modal footer, only rendered in edit mode and only for users with the `task:write` permission. Positioned left via `mr-auto` so Cancel and Save stay on the right of the existing footer flex row. Confirmation uses a native `window.confirm()` (matches the Admin → Users delete pattern from 2026-05-02). If the task has subtasks, the confirm message says how many will be cascade-deleted (the backend hard-deletes; child task FKs cascade per the schema). On success the modal closes; on backend error (e.g. FK constraint) the message surfaces in the existing `<div role="alert">` inside the form. The submit/cancel buttons disable while the delete is in flight via the existing `submitting` flag (now also OR'd with `remove.isPending`).
- **No schema or migration change.** Schema-level cascade behavior for subtasks/comments is whatever was already in [backend/prisma/schema.prisma](backend/prisma/schema.prisma); not touching it here.

### Changed — 2026-05-03 — Gantt task labels render outside the bar (right side)

- **[frontend/src/components/gantt/GanttBar.tsx](frontend/src/components/gantt/GanttBar.tsx)** — task names previously rendered inside the bar with `truncate` and a status-conditional text color (white on IN_PROGRESS/DONE, sky-900 on TODO). Now the label sits as an absolute, `pointer-events-none` sibling immediately after the bar's right edge (`left + width + 6px`), uses a single theme-aware `text-on-surface` color, and is `whitespace-nowrap` so it overflows naturally into adjacent columns instead of being clipped — matches the convention in the user's reference image. The progress fill inside the bar is unchanged. Removed the now-unused `STATUS_TEXT` mapping. Label position recomputes from `left` and `width` so it follows the ghost during drag/resize.

### Fixed — 2026-05-03 — Gantt weekend tint invisible in dark mode

- **[frontend/src/components/gantt/GanttColumnGrid.tsx](frontend/src/components/gantt/GanttColumnGrid.tsx)** — weekend columns used `bg-slate-900/[0.04]` with `mixBlendMode: "multiply"`, which multiplies a near-black tint onto whatever's underneath. On the dark theme background that produces ~zero visible contrast, so weekends rendered as plain dark cells indistinguishable from weekdays. Holidays (`bg-rose-500/10`) still showed because rose has enough chroma to survive the multiply. Fix: drop `mixBlendMode` entirely (multiply was working against the design-system's tonal layering anyway) and split the tint by theme — weekend is `bg-slate-900/[0.04] dark:bg-white/[0.05]` (subtle dark wash on light, subtle light wash on dark); holiday is `bg-rose-500/10 dark:bg-rose-400/15` (lighter rose hue on dark for the same perceived saturation). Both themes now render weekends and holidays at the same readability level.

### Fixed — 2026-05-03 — Gantt drag commit shifts dates back one day in positive-UTC timezones

The real cause of the "Gantt drag lands one day earlier than I dropped it" bug, superseding the `+1 day offset on move-drag` workaround from the earlier same-day Changed entry (which has now been reverted). The drag math was always correct; the bug was at the persistence boundary.

- **[frontend/src/lib/gantt/geometry.ts](frontend/src/lib/gantt/geometry.ts)** — new helper `toUtcMidnightISO(d: Date): string` that builds the ISO string for UTC midnight on the same calendar date as the input local Date. Plain `startOfDay(d).toISOString()` would shift the date backward in any positive-UTC timezone (e.g. UTC+7 local `2026-05-15T00:00:00+07:00` → `2026-05-14T17:00:00Z`), and `parseISODate` splits on `"T"` so the round-trip silently lost a day every drag commit — visible as the bar snapping back one column after release.
- **[frontend/src/components/gantt/GanttFrame.tsx](frontend/src/components/gantt/GanttFrame.tsx)** — `handleCommit` now encodes both `startDate` and `dueDate` via `toUtcMidnightISO(...)` instead of `startOfDay(...).toISOString()`. Covers move-drag and both resize-drag paths since they all funnel through `handleCommit`. The optimistic ghost during drag was always correct (it operates on local Dates via `addDays`); only the post-commit rendered position was wrong because of the shifted persisted value.
- **[frontend/src/components/gantt/GanttBar.tsx](frontend/src/components/gantt/GanttBar.tsx)** — reverted the `deltaDays + 1` hack in the move-mode branch of `handlePointerMove`. Move-drag now shifts both edges by the raw rounded `deltaDays` again, matching resize-start and resize-end. With the timezone-encode fix in place the drag math is correct without any compensating offset.
- **`handleUpdateDates` in the same file** intentionally NOT touched — it accepts pre-formatted ISO strings from the inline date editor (`InlineDateRangeEditor`), which uses `<input type="date">` and emits `YYYY-MM-DD` strings that the backend interprets without timezone ambiguity. Only the drag path was building Dates in local time and then losing them through `toISOString()`.

### Fixed — 2026-05-03 — Gantt: don't snap-scroll back to today after a drag-reschedule

- **[frontend/src/components/gantt/GanttFrame.tsx](frontend/src/components/gantt/GanttFrame.tsx)** — the "auto-scroll to today" effect was re-firing whenever `chartStart` changed, and `chartStart` is recomputed from the rows' date range (padded ±1 year) — so dragging a bar to a date that pushed the rows' min/max past the previous bound would silently yank the viewport back to today, losing the user's scroll position. Effect now gated by two refs: `didInitialScrollRef` (fires once on first paint) and `lastScrolledViewModeRef` (re-fires on view-mode swap because the axis coordinate system rebuilds). Plain data updates — including drag-reschedule that extends the chart range — no longer trigger a scroll. Also dropped `columnWidth` from the dep array (constant per view mode, redundant with the viewMode gate).

### Changed — 2026-05-03 — Gantt bar: square corners (move-drag offset reverted, see superseding Fixed entry)

- **[frontend/src/components/gantt/GanttBar.tsx](frontend/src/components/gantt/GanttBar.tsx)** — bar corners squared from `rounded-full` → `rounded` (0.25rem default), on both the live bar and the baseline-ghost rect. Brings the visual in line with DESIGN.md's "Soft (0.25rem) roundedness... large radii are strictly forbidden" rule (CLAUDE.md design-drift section also flagged that the previous pill shape was a spec violation). The section bar (`GanttSectionBar`) was already a flat line with caps so it didn't need touching.
- **The same-turn `+1 day move-drag offset` was a misdiagnosis** of the off-by-one symptom and has been reverted in a later Fixed entry above. The real root cause was a timezone-shift in the drag-commit ISO encoding, not the drag math.

### Changed — 2026-05-03 — Switch all UI fonts to Source Sans 3 (Source Sans Pro family)

The two-typeface system (Space Grotesk for display + Inter for body) collapses to a single typeface across the entire app and reference mockups. The Tailwind alias structure (`font-display` / `font-body`) is preserved — both aliases now resolve to the same family — so the ~201 component sites using those classes pick up the new typeface with zero code changes.

- **Family loaded is "Source Sans 3"**, Adobe's rebrand of Source Sans Pro with a full 100–900 weight range. The legacy "Source Sans Pro" name on Google Fonts has no 500 weight, but the codebase uses `font-medium` (500) extensively; Source Sans 3 covers it natively without weight synthesis. The `font-family` literal in the Tailwind config is `"Source Sans 3"` to match the family name the Google Fonts response actually registers.
- **[DESIGN.md](DESIGN.md)** — frontmatter typography tokens (`h1`, `h2`, `body-lg`, `body-sm`, `data-mono`, `label-caps`) all switched from `Space Grotesk` / `Inter` → `Source Sans 3`. Typography prose section rewritten from the dual-font strategy paragraph to a one-typeface paragraph noting `data-mono` retains tabular numerics via `font-feature-settings: "tnum"` (the technique, not the typeface, is what aligns numbers). Components prose's button-label reference updated from "Space Grotesk for labels" → "Source Sans 3 for labels".
- **[frontend/tailwind.config.ts](frontend/tailwind.config.ts)** — `extend.fontFamily` aliases `display` and `body` both point at `['"Source Sans 3"', "system-ui", "sans-serif"]`. No `mono` override added; `font-mono` keeps Tailwind's default monospace stack so the ~21 component sites using it for IDs/numerics retain columnar alignment via a true monospace.
- **[frontend/index.html](frontend/index.html)** — Google Fonts `<link>` now requests `family=Source+Sans+3:wght@300;400;500;600;700` (single family). Replaces the previous two-family request for `Space+Grotesk` + `Inter`. The two `preconnect` links and the separate Material Symbols `<link>` are unchanged.
- **[frontend/src/index.css](frontend/src/index.css)** — no edit required. `body { @apply font-body; }` and `h1–h4 { @apply font-display; }` automatically resolve to Source Sans 3 through the Tailwind alias indirection.
- **[UI Design/*/code.html](UI Design/)** — all 4 mockups (`solvro_command_center_updated_branding`, `solvro_project_view`, `solvro_settings`, `solvro_table_view`) updated alongside: each file's Google Fonts `<link>` rewritten to load Source Sans 3 only, and every `["Inter"]` / `["Space Grotesk"]` value in the inline Tailwind CDN config's `fontFamily` block replaced with `["Source Sans 3"]`. The 6 token keys (`h1`, `h2`, `body-lg`, `body-sm`, `data-mono`, `label-caps`) are unchanged. Mockup weight ranges per file were preserved as their own pre-existing patterns (300–700 for command_center / table_view; 400–700 for project_view / settings).
- **[CLAUDE.md](CLAUDE.md)** — "Two fonts, distinct roles" bullet in the Design system essentials section rewritten to "Single typeface app-wide", documenting the alias-points-at-one-family decision, the `font-feature-settings: "tnum"` mechanism for tabular numerics, and the explicit decision not to remap `font-mono`. Future Claude sessions reading the doc won't reintroduce a dual-font assumption.
- **No component edits.** The ~201 `.tsx` sites using `font-display` / `font-body` and ~21 sites using `font-mono` were intentionally not touched — the Tailwind alias indirection handles the swap. Backend has no font references.

### Changed — 2026-05-02 — CLAUDE.md: fix stale API base-URL description, add mobile responsiveness convention

- **[CLAUDE.md](CLAUDE.md)** — `/init` audit found two pieces of drift in the Frontend conventions section:
  - **API layer bullet** described `BASE_URL` as runtime-computed from `window.location` (`<protocol>//<hostname>:3000`). That hasn't been true since the 2026-05-02 same-origin nginx-proxy change — `BASE_URL` is the literal string `"/api"` and requests inherit `window.location.origin` via the nginx (prod) and Vite (dev) proxies. Rewrote the bullet to describe the actual proxy chain, the `/api` prefix stripping, and the `VITE_API_PROXY_TARGET` override for containerised dev. The earlier CHANGELOG entry that introduced the proxy explicitly flagged this doc bullet as stale; this is the followup.
  - Added a new bullet documenting the **`md:` (768px) mobile-responsiveness convention** that the 2026-05-02 mobile-support changes established (Sidebar drawer via `useSidebar()`, RightSidebar full-screen overlay, Modal edge-to-edge on phone, Gantt's `<ProjectList />` mobile fallback, ProjectList's two-layout-one-component pattern). Future Claude sessions adding new pages or modals now have a single source describing the desktop-first-then-gate-with-`md:` pattern instead of having to reverse-engineer it from the diff history.
- **No code change.** Pure doc update; no behavior, dependencies, or config affected.

### Changed — 2026-05-02 — Hide Gantt tab in ProjectDetail nav on phone

- **[frontend/src/pages/ProjectDetail.tsx](frontend/src/pages/ProjectDetail.tsx)** — the Gantt tab in the project sub-nav is now `hidden md:inline-block`. Below 768px users see only List / Kanban / Timeline. Reason: the Gantt route already swaps to ProjectList on mobile (no real Gantt rendered), so showing a "Gantt" label on phone was misleading. The `/projects/:id/gantt` route still works for deep links and renders the list view as before.

### Added — 2026-05-02 — Mobile-browser support across the frontend (md:768px breakpoint)

Frontend is now usable on a 375px-wide phone viewport in mobile Safari / Chrome on Android, while desktop (≥768px) renders identically to before. Every change is gated behind Tailwind `md:` so the existing tri-panel layout is preserved.

- **[frontend/src/components/layout/Shell.tsx](frontend/src/components/layout/Shell.tsx)** — main reclaims full viewport on phone: `ml-16` → `md:ml-16`; `p-6` → `p-4 md:p-6`. Below 768px the collapsed sidebar rail is hidden so it no longer eats 64px of viewport.
- **[frontend/src/components/layout/Sidebar.tsx](frontend/src/components/layout/Sidebar.tsx)** — when `!open` on mobile the rail is fully hidden (`hidden w-16 md:flex`); on desktop the icon-only rail behavior is unchanged. The existing backdrop + auto-close-on-nav now serve as the mobile drawer.
- **[frontend/src/components/layout/TopBar.tsx](frontend/src/components/layout/TopBar.tsx)** — added a hamburger button (`md:hidden`) before the title that calls `useSidebar().toggle()`; gated `ml-16` and `px-6` behind `md:`; hid the (currently non-functional) search input below `md:` to free up phone width.
- **[frontend/src/components/layout/RightSidebar.tsx](frontend/src/components/layout/RightSidebar.tsx)** — width is `w-full md:w-context-panel` so the project-context panel becomes a full-screen overlay on phone; added a tap-outside backdrop (`md:hidden`) mirroring Sidebar's. Z-index bumped above hamburger on mobile.
- **[frontend/src/pages/ProjectDetail.tsx](frontend/src/pages/ProjectDetail.tsx)** — `mr-80` gated behind `md:` (no right-margin reservation on phone since RightSidebar overlays full-screen); header flex row stacks vertically below `md:`; tab nav wraps in `overflow-x-auto whitespace-nowrap` so the four tabs scroll horizontally if pinched.
- **[frontend/src/pages/views/ProjectGantt.tsx](frontend/src/pages/views/ProjectGantt.tsx)** — Gantt is hidden below `md:` (`hidden md:block`) and `<ProjectList />` is rendered as the mobile fallback. The Gantt is desktop-only by design (476px list pane + wide chart pane); the list view conveys the same task data in a phone-friendly shape. TaskFormModals stay outside both branches so create/edit flows work in either mode.
- **[frontend/src/pages/views/ProjectList.tsx](frontend/src/pages/views/ProjectList.tsx)** — desktop 5-column grid (~752px wide) is preserved with `hidden md:grid`; below `md:` each task and subtask renders as a stacked card (title + status, then assignee + dates + overdue indicator). Same component, two layouts. Subtask expand/collapse and inline date editor work in both modes.
- **[frontend/src/components/Modal.tsx](frontend/src/components/Modal.tsx)** — modals go edge-to-edge full-screen on phone (`rounded-none`, no border, body scrolls independently via `flex-1 overflow-y-auto`); on `md:` the centered card with rounded corners and border returns. Single edit cascades to ConfirmModal, TaskFormModal, CustomerFormModal, ProjectFormModal, and the Gantt baseline-confirm modal — no per-modal pass needed.
- **[frontend/src/pages/Admin.tsx](frontend/src/pages/Admin.tsx)** — three forms (Users, Roles, Services): every `<label className="flex-1 min-w-[…]">` becomes `w-full md:flex-1 md:min-w-[…]` so labels stack one-per-row on phone; submit buttons add `w-full md:w-auto`. Header and body padding gated behind `md:` (`px-4 md:px-6`, `p-4 md:p-6`). Tab strip wrapped in `overflow-x-auto`. Tables stay horizontal-scrolling on phone (existing `overflow-x-auto` is sufficient; stacked-card conversion deferred as future polish).
- **[frontend/src/components/Tabs.tsx](frontend/src/components/Tabs.tsx)** — added `whitespace-nowrap` so tab labels don't wrap inside the (now scrollable) container.
- **[frontend/src/pages/Settings.tsx](frontend/src/pages/Settings.tsx)** — Profile dl: `grid-cols-[140px_1fr]` → `grid-cols-1 md:grid-cols-[140px_1fr]` (label/value rows stack on phone). Theme picker: `grid-cols-3` → `grid-cols-1 sm:grid-cols-3` so the three theme cards stack on narrow phones.
- **[frontend/src/pages/CustomerDetail.tsx](frontend/src/pages/CustomerDetail.tsx)** — header flex-row → `flex-col md:flex-row md:items-start md:justify-between`, matching ProjectDetail's mobile treatment.

Reused existing primitives: `useSidebar()` for the mobile drawer toggle, the existing `Modal` component (single-file edit cascades to all callers), the existing Sidebar backdrop pattern (copied into RightSidebar). No new dependencies, no new hooks. CLAUDE.md note: `frontend/src/lib/api.ts` uses `BASE_URL = "/api"` (relative, with Vite proxy in dev and nginx in prod) — the runtime `window.location` description in the doc is stale, flag for separate update.

### Changed — 2026-05-02 — CLAUDE.md: refresh RBAC section to reflect permission gates

- **[CLAUDE.md](CLAUDE.md)** — "Auth & RBAC" and "Visibility filter" bullets in the Backend conventions section were describing the old role-name-only world. Updated to document `requirePermission("project:write" | "task:write" | …)` as the canonical action gate, the JWT `permissions[]` claim, the `hasPermission(user, "*")` wildcard short-circuit, the narrow remaining uses of `requireRole`/`requireAdmin`, and the fact that custom admin-defined roles without `*` only see projects they're directly assigned to. Brings the doc in line with commit `fcd8bd2` (RBAC permission-gate switch) so future Claude sessions don't fall back to stale role-name patterns.

### Fixed — 2026-05-02 — Stale cached user blocks UI permission gates after upgrade

- **[frontend/src/lib/auth.tsx](frontend/src/lib/auth.tsx)** — `AuthProvider` now calls `GET /auth/me` on boot whenever a token is present, and overwrites the cached user with the fresh response. Symptom this fixes: deployments upgraded from a pre-`permissions` bundle had `user` objects in localStorage without a `permissions` array, so `hasPermission(user, "project:write")` returned false and the "+ New Customer" / "+ New Project" buttons were hidden even for admins with `*`. Previously the only workaround was to log out and back in. If `/auth/me` 401s (token expired/invalid), the user is logged out cleanly.

### Added — 2026-05-02 — Admin can permanently delete users

- **[backend/src/routes/admin.ts](backend/src/routes/admin.ts)** — new `DELETE /admin/users/:id` endpoint. Refuses self-delete (admin cannot delete themselves). Pre-checks all FK relations: if the target user has any projects (as TAM or SA), locked baselines, assigned tasks, or comments, returns 400 with a list of blockers (e.g. `"3 project(s) as TAM, 12 assigned task(s)"`). Admin must reassign or clear those first. If clean, hard-deletes the row.
- **[frontend/src/lib/queries.ts](frontend/src/lib/queries.ts)** — new `useAdminDeleteUser` mutation hook. Invalidates both admin and global user queries plus the role list (so role user counts update).
- **[frontend/src/pages/Admin.tsx](frontend/src/pages/Admin.tsx)** — added a "Delete" button to each row in Admin > Users (after Reset Password). Disabled for the current user (you can't delete yourself). Shows a `confirm()` dialog before firing. Backend errors (e.g. user-in-use) surface in the existing error banner above the table.

### Changed — 2026-05-02 — Customer form: AM is free text, SA stays as user dropdown

- **[frontend/src/components/CustomerFormModal.tsx](frontend/src/components/CustomerFormModal.tsx)** — Account Manager reverted to a free-text input. AMs are often external sales contacts who don't have user accounts in this system, so a hard dropdown of TAM-role users was the wrong shape. Solution Architect stays as a dropdown of literal SA-role users.

### Changed — 2026-05-02 — Customer form picks AM/SA from user dropdowns; wildcard users eligible for SA/TAM

- **[backend/src/routes/users.ts](backend/src/routes/users.ts)** — `GET /users` now returns each user's `permissions: string[]` alongside their role. Lets the frontend filter dropdowns by capability (e.g. "anyone with `*`") instead of only by literal role name.
- **[frontend/src/lib/queries.ts](frontend/src/lib/queries.ts)** — `UserSummary.permissions: string[]` added to match.
- **[frontend/src/components/CustomerFormModal.tsx](frontend/src/components/CustomerFormModal.tsx)** — replaced the free-text "Account Manager" and "Solution Architect" inputs with `<select>` dropdowns populated from `useUsers()`. AM list = users with `TAM` role OR `*` permission; SA list = users with `SA` role OR `*` permission. If the customer was created earlier with a free-text AM/SA value that doesn't match any current user, that legacy value is preserved as a `(current)` option so editing the customer doesn't silently lose it. Field still stored as a string (no schema change).
- **[frontend/src/components/ProjectFormModal.tsx](frontend/src/components/ProjectFormModal.tsx)** — SA and TAM dropdowns now include any user with `*` permission, not just literal SA/TAM-role users. So an admin (or any custom-role-with-`*`) user can be selected as the project's SA or TAM, and admins can self-assign when no SA/TAM-role users exist yet on a fresh deployment. `canPickTam` switched from `user.role === "ADMIN"` to `user.permissions.includes("*")` so DIRECTOR/MANAGER-equivalents can also reassign.

### Changed — 2026-05-02 — RBAC switched from role-name gates to permission gates

- **[backend/src/http/auth.ts](backend/src/http/auth.ts)** — `JwtPayload` now carries `permissions: string[]` alongside `role`. New helper `hasPermission(payload, perm)` returns `true` if the user has `*` (full access) or the specific permission. New middleware `requirePermission(perm)` for action-level authorization. `verifyToken` parses `permissions` from the JWT defensively (old tokens issued before this change get `[]` and re-acquire perms on next login). `requireRole` and `requireAdmin` are kept for the admin-only namespace.
- **[backend/src/routes/auth.ts](backend/src/routes/auth.ts)** — `/auth/login` and `/auth/me` now read `role.permissions` (a JSONB string[] in the DB) and return it both inside the JWT (so backend gates can see it) and in the user payload (so frontend gates can see it). Old logged-in sessions need to log out + log in to pick up the new shape.
- **[backend/src/routes/projects.ts](backend/src/routes/projects.ts), [customers.ts](backend/src/routes/customers.ts), [sections.ts](backend/src/routes/sections.ts)** — six write routes in projects, four in customers, two in sections all swapped from `requireRole("TAM", "ADMIN")` to `requirePermission("project:write")`. Now any role with `project:write` (or `*`) can mutate, regardless of role name.
- **[backend/src/routes/labels.ts](backend/src/routes/labels.ts), [tasks.ts](backend/src/routes/tasks.ts)** — label and task write routes use `requirePermission("task:write")` instead of `requireRole("TAM", "ADMIN")`.
- **[backend/src/routes/services.ts](backend/src/routes/services.ts)** — kept as `requireRole("ADMIN")` (services catalogue stays admin-only by name).
- **[backend/src/routes/admin.ts](backend/src/routes/admin.ts)** — kept under `requireAdmin` (the entire `/admin` tree stays role-name-gated; only the literal ADMIN role manages users/roles).
- **Visibility filter (`projectVisibilityFilter` in projects.ts and `projectScope` in overview.ts)** — added an early check: any user with `*` permission sees all projects (so DIRECTOR/MANAGER-style custom roles with full perms work like ADMIN). Without `*`, the existing role-name switch handles built-ins (TAM sees own as TAM, SA sees own as SA, STAKEHOLDER sees all). The default branch (custom roles without `*`) now returns `{ OR: [{ tamId: user.sub }, { saId: user.sub }] }` so they at least see projects they're directly assigned to.
- **[frontend/src/lib/auth.tsx](frontend/src/lib/auth.tsx)** — `AuthUser.permissions: string[]` added. New `hasPermission(user, perm)` helper, defensive against stale localStorage users that pre-date the permissions field.
- **Frontend gate swaps (8 files)** — [Projects.tsx](frontend/src/pages/Projects.tsx), [Customers.tsx](frontend/src/pages/Customers.tsx), [CustomerDetail.tsx](frontend/src/pages/CustomerDetail.tsx), [ProjectDetail.tsx](frontend/src/pages/ProjectDetail.tsx) → `hasPermission(user, "project:write")`. [ProjectList.tsx](frontend/src/pages/views/ProjectList.tsx), [ProjectTimeline.tsx](frontend/src/pages/views/ProjectTimeline.tsx), [GanttFrame.tsx](frontend/src/components/gantt/GanttFrame.tsx) → `hasPermission(user, "task:write")`. The Sidebar admin nav gate, the SA/TAM dropdown filters in `ProjectFormModal`, and the Admin-page reassign-TAM filter remain role-name checks (those are structural — only literal SA/TAM-role users can be assigned to those columns; admin-only nav stays admin-only).
- **End result:** the four built-in roles still work as before (their seed permissions match the old behavior). Custom roles created in Admin > Roles now actually grant access matching their permissions list — a DIRECTOR or MANAGER with `*` works like ADMIN for everything except the admin-only routes; a custom role with just `project:write` can create/edit projects but not tasks; etc. **Existing logged-in users must log out and log back in** to get a fresh JWT with permissions.

### Fixed — 2026-05-02 — Vite dev proxy target is configurable for dockerised dev

- **[frontend/vite.config.ts](frontend/vite.config.ts)** — `server.proxy["/api"].target` now reads from `process.env.VITE_API_PROXY_TARGET`, defaulting to `http://localhost:3000` (native dev). When Vite runs *inside* the frontend container of a docker-compose dev stack, "localhost" resolves to the container itself (no backend listening), which surfaced as `Request failed with status 404` on login. Setting `VITE_API_PROXY_TARGET=http://backend:3000` in the frontend container's env makes the proxy forward to the backend container via the docker network. Native-dev workflow is unchanged because the default still works without setting anything.

### Added — 2026-05-02 — Admin can create custom roles (RoleName enum → free-text + CRUD)

- **Schema migration** — [backend/prisma/migrations/20260502140000_dynamic_roles/migration.sql](backend/prisma/migrations/20260502140000_dynamic_roles/migration.sql) converts `roles.role_name` from the `RoleName` Postgres enum to plain `TEXT` and drops the enum type. The four built-in role rows (ADMIN, SA, TAM, STAKEHOLDER) are preserved as text values, so no data loss. Migration is idempotent under `prisma migrate deploy`. **Why:** the old enum locked the role set to those four at schema-time; admins can now create custom roles at runtime.
- **[backend/prisma/schema.prisma](backend/prisma/schema.prisma)** — dropped the `RoleName` enum block; `Role.roleName` is now `String @unique`.
- **[backend/src/http/auth.ts](backend/src/http/auth.ts)** — `JwtPayload.role` is `string` instead of `RoleName`. JWT verifier no longer checks `role in RoleName` (just non-empty string). `requireRole(...roles: string[])` keeps working — string compare. `requireAdmin` keeps working (compares `role === "ADMIN"`).
- **[backend/src/routes/admin.ts](backend/src/routes/admin.ts)** — new endpoints under `/admin/roles`:
  - `GET /admin/roles` — list with `{ id, roleName, permissions, userCount, builtIn }`.
  - `POST /admin/roles` — create with `{ roleName, permissions: string[] }`. roleName must match `^[A-Z0-9_]+$` and not collide with built-ins.
  - `PATCH /admin/roles/:id` — update permissions only (name is immutable). Refuses to touch ADMIN (always full access).
  - `DELETE /admin/roles/:id` — refuses built-ins and any role with users still attached.
  - `createUserSchema` and `updateRoleSchema` switched from `z.nativeEnum(RoleName)` to `z.string().min(1).max(50)` and validate against the Role table at runtime.
- **[backend/src/routes/projects.ts](backend/src/routes/projects.ts), [backend/src/routes/overview.ts](backend/src/routes/overview.ts)** — `projectVisibilityFilter` and `projectScope` switches added a `default:` case returning `{ id: { in: [] } }` (no rows match) for custom roles. Built-in roles still get their existing visibility behavior. **Custom roles default to no project visibility**; admin grants access by assigning users as TAM/SA on specific projects.
- **[backend/prisma/seed.ts](backend/prisma/seed.ts)** — `Record<RoleName, string[]>` → `Record<string, string[]>`. Still upserts the four built-in roles on every container start (idempotent).
- **[frontend/src/lib/auth.tsx](frontend/src/lib/auth.tsx)** — `Role` type changed from `"SA" | "TAM" | "ADMIN" | "STAKEHOLDER"` to `string`. New `BUILTIN_ROLES` constant for code that needs to differentiate.
- **[frontend/src/lib/queries.ts](frontend/src/lib/queries.ts)** — new `AdminRole` interface and four hooks: `useAdminRoles`, `useAdminCreateRole`, `useAdminUpdateRolePermissions`, `useAdminDeleteRole`. `adminQueryKeys.roles` added.
- **[frontend/src/pages/Admin.tsx](frontend/src/pages/Admin.tsx)** — new "Roles" tab between Users and Project Override. Lists all roles with built-in badge and user count. Form to create role (name uppercased automatically, permissions as comma-separated input). Edit perms inline (disabled for ADMIN). Delete (disabled for built-ins or in-use roles). The Users tab's Add User form and the per-row role dropdown now read the role list dynamically via `useAdminRoles` instead of the previous hardcoded `ROLE_OPTIONS` constant — custom roles appear immediately.
- **Built-in protections** (enforced both in backend and visually in UI):
  - ADMIN, SA, TAM, STAKEHOLDER cannot be deleted or renamed.
  - ADMIN's permissions are always `["*"]` (PATCH refused).
  - Cannot delete a role that still has users attached.
  - Custom role names must match `^[A-Z0-9_]+$`.

### Changed — 2026-05-02 — Same-origin /api proxy (Cloudflare Tunnel / TLS-friendly)

- **[frontend/nginx.conf](frontend/nginx.conf)** — added a `location /api/ { proxy_pass http://backend:3000/; ... }` block (placed before the SPA fallback so it matches first). Forwards `Host`, `X-Real-IP`, `X-Forwarded-For`, `X-Forwarded-Proto` headers; sets `proxy_http_version 1.1` and `client_max_body_size 1m` to match Express's `json({ limit: "1mb" })`. The trailing slash on `proxy_pass` strips the `/api` prefix so `/api/auth/login` → `http://backend:3000/auth/login` (backend routes don't have an `/api` prefix per CLAUDE.md). nginx is now the same-origin gateway: the browser only ever talks to whatever hostname serves the page.
- **[frontend/src/lib/api.ts](frontend/src/lib/api.ts)** — `BASE_URL` is now the literal string `"/api"`. Replaces the previous `${protocol}//${hostname}:3000` runtime computation. **Why:** the runtime-URL trick worked for direct LAN access but broke under any reverse proxy (Cloudflare Tunnel, future TLS terminator, k8s ingress) because port 3000 isn't exposed at the proxy edge AND mixed HTTPS-page → HTTP-backend is browser-blocked. Relative `/api` paths inherit `window.location.origin` and `window.location.protocol` automatically — works on `https://solvro-dev.bapi.my.id`, `http://10.10.1.10`, `http://localhost`, anywhere.
- **[frontend/vite.config.ts](frontend/vite.config.ts)** — added `server.proxy: { "/api": { target: "http://localhost:3000", changeOrigin: true, rewrite: (p) => p.replace(/^\/api/, "") } }`. Mirrors the nginx behaviour for the dev workflow (`npm run dev` on :5173 forwards `/api/*` to the host-side backend on :3000). Without this, the new `BASE_URL = "/api"` would 404 in dev because Vite has no backend behind `/api`.
- **No backend changes.** Routers stay mounted at `/auth`, `/projects`, etc. — the proxy strips `/api` before forwarding.
- **No setup.sh / docker-compose changes.** The compose file keeps the backend's `:3000` host port mapping (harmless leftover for LAN debugging; not used by the proxy path which goes container-to-container over the docker network).
- **Followups deferred:** (1) tighten `CORS_ORIGIN` from `*` to `https://solvro-dev.bapi.my.id` (now redundant for production since same-origin requests skip CORS preflight, but cleaner); (2) optionally drop the `:3000` host port mapping for tighter LAN attack surface; (3) add `proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "upgrade";` to the nginx `/api/` block if/when the app adds WebSockets or SSE.

### Added — 2026-05-02 — Admin can create new users from the Admin → Users tab

- **[backend/src/routes/admin.ts](backend/src/routes/admin.ts)** — new `POST /admin/users` endpoint. Body: `{ email, username, password, role }`. Validates with Zod (email format, username 1–50 chars, password 8–200 chars, role from RoleName enum), rejects duplicate emails with 409, hashes the password with bcrypt, creates the user with the requested role. Returns the created user in the same shape `GET /admin/users` returns (so the frontend can drop it into the existing list cache).
- **[frontend/src/lib/queries.ts](frontend/src/lib/queries.ts)** — new `useAdminCreateUser()` mutation hook. Invalidates both `adminQueryKeys.users` (admin user list) and `queryKeys.users` (the global lookup list used by assignee dropdowns) on success so the new user appears everywhere immediately.
- **[frontend/src/pages/Admin.tsx](frontend/src/pages/Admin.tsx)** — added an "Add user" form at the top of the Users tab. Inputs: email, username, password, role (defaults to TAM). Submit button disables until all fields are filled and the password meets the 8-char minimum. Uses the same form layout pattern as the Service Catalogue's add-service form for visual consistency.

### Removed — 2026-05-02 — Untrack design/product docs from the repo

- **UI Design/, PRD.md, DESIGN.md, .env.example** — `git rm --cached` and added to [.gitignore](.gitignore). Local copies preserved on the maintainer's machine; just no longer tracked. **Why:** these are design/reference assets, not deploy artifacts. The repo is now closer to "just what's needed to build and ship the app." Anyone who actually deploys the app uses `bash <(curl ...setup.sh)` and never browses the file tree, so the trimming is purely cosmetic — but it keeps the repo focused.

### Fixed — 2026-05-02 — Runtime image now ships `scripts/create-admin.ts`

- **[backend/Dockerfile](backend/Dockerfile)** — added `COPY scripts ./scripts` to the runtime stage. Without it, `docker compose exec backend npx tsx scripts/create-admin.ts` (run by setup.sh after the backend is healthy) failed with `ERR_MODULE_NOT_FOUND` because the runtime image only had `prisma/` and `dist/`. The dev stage was unaffected (it does a full `COPY . .` for hot reload).

### Fixed — 2026-05-02 — Backend image's `dist/index.js` was at the wrong path (longstanding latent bug)

- **[backend/tsconfig.json](backend/tsconfig.json)** — `rootDir` changed from `"."` to `"src"`, and `include` reduced from `["prisma/**/*.ts", "src/**/*.ts"]` to `["src/**/*.ts"]`. **Why:** with the previous config, tsc preserved the project structure when emitting and produced `dist/src/index.js` + `dist/prisma/seed.js`. The Dockerfile's runtime `CMD ["node", "dist/index.js"]` looked at the wrong path — there was never a `dist/index.js` at the top of `dist/`. The container died at startup with `Error: Cannot find module '/app/dist/index.js'`. Earlier deploys never noticed because the backend was crashing earlier in its startup chain (P1000 from postgres password mismatch) before it ever reached `node dist/index.js`. Once setup.sh fixed the postgres state, this latent bug surfaced. After the fix, `npm run build` emits `dist/index.js` directly. **`prisma/seed.ts` and `scripts/create-admin.ts` are unaffected** — both run via `tsx` (which interprets TypeScript at runtime) and don't need to be in tsc's compile set.

### Changed — 2026-05-02 — setup.sh accepts env vars; docker-compose.yml untracked

- **[setup.sh](setup.sh)** — extended input handling: if `ADMIN_EMAIL` and/or `ADMIN_PASSWORD` are present in the environment, those are used directly and the prompt is skipped. If either is empty, the script falls back to `read ... </dev/tty` for an interactive prompt (so it still works behind `curl | bash`). If neither path is available (no env vars AND no `/dev/tty`), it errors out with the env-var invocation example. **Why:** the pure `/dev/tty` approach was inconsistent across some shells / SSH terminal setups and a user kept hitting "invalid email" because `read` returned empty without ever showing a prompt. The env-var path is a deterministic escape hatch:
  ```
  ADMIN_EMAIL=you@x.com ADMIN_PASSWORD=secret bash <(curl -sSL <url>)
  ```
  README/docs should recommend `bash <(curl -sSL ...)` over `curl ... | bash` because the former leaves stdin attached to the terminal so the interactive prompts work without the `/dev/tty` dance.

### Removed — 2026-05-02 — docker-compose.yml no longer tracked in the repo

- **docker-compose.yml** — `git rm --cached` and added to [.gitignore](.gitignore). The canonical compose definition now lives **inside [setup.sh](setup.sh)** as a heredoc; tracking a separate copy in the repo was duplicated information that could drift from the script. Local overrides (`docker-compose.override.yml`) were already gitignored. Anyone who wants to inspect the compose file looks at the heredoc inside setup.sh, or grabs the rendered file from a deployed server at `~/solvro/docker-compose.yml` (which setup.sh writes there).

### Fixed — 2026-05-02 — setup.sh prompts now work under `curl | bash`

- **[setup.sh](setup.sh)** — all `read` calls now redirect from `/dev/tty` instead of stdin (`read ... </dev/tty`). When the script is invoked via `curl -sSL .../setup.sh | bash`, the script's stdin is the curl pipe, not the terminal — so the previous `read -p "Admin email: "` immediately returned empty and failed validation with `invalid email.`. Reading from `/dev/tty` bypasses stdin entirely and reaches the user's terminal directly. Added a guard at the top that prints a fallback instruction (`curl ... -o setup.sh && bash setup.sh`) if `/dev/tty` is also unavailable (rare — happens in some unattended/CI shells).

### Changed — 2026-05-02 — Per-deployment admin via setup.sh; demo seed users removed

- **[setup.sh](setup.sh)** — NEW. The one-shot deploy script. Pasted onto a fresh Ubuntu server (with Docker + Docker Compose installed), it prompts for an admin email and password, generates random `POSTGRES_PASSWORD` and `JWT_SECRET` via `openssl`, writes `~/solvro/.env` (`chmod 600`) and `~/solvro/docker-compose.yml`, wipes any prior `solvro_pgdata` volume to clear stale postgres state, brings the stack up, polls `/health` until ready, then runs the new `create-admin.ts` script to create the admin user. **Idempotent**: re-running on a server that already has `~/solvro/.env` skips prompts and just does `docker compose pull && up -d` — that's the update flow. Distributes via terminal paste — no scp, no git clone, no PAT required.
- **[backend/prisma/seed.ts](backend/prisma/seed.ts)** — stripped the `SEED_USERS` array and user-upsert loop. Seed now only upserts the four roles (ADMIN, SA, TAM, STAKEHOLDER). **Why:** users are tenant-specific and don't belong in a shared seed; a shared `admin@solvro.local` / `password123` was a security smell for "anyone can deploy this." Roles stay because RBAC checks (`requireRole`) reference them structurally.
- **backend/scripts/create-admin.ts** — NEW. Reads `ADMIN_EMAIL` and `ADMIN_PASSWORD` from `process.env`, validates email format and 8-char password minimum, finds the ADMIN role, upserts the user. Idempotent — re-running with the same email updates the password (acts as the password reset flow until a proper one exists). Called by setup.sh via `docker compose exec`.
- **backend/scripts/create-temp-admin.ts** — DELETED. Replaced by `create-admin.ts` (which takes credentials via env vars instead of hardcoding them).
- **[backend/package.json](backend/package.json)** — renamed script `dev:admin` → `admin:create` (now `tsx scripts/create-admin.ts`). The `db:seed` script is unchanged but now creates only roles.
- **[docker-compose.yml](docker-compose.yml)** — removed the demo defaults for `POSTGRES_PASSWORD` and `JWT_SECRET`. They're now required env vars sourced from a sibling `.env` file (which setup.sh writes). The header comment tells anyone reading the file directly to use setup.sh instead of `docker compose up`. `CORS_ORIGIN: "*"`, `IMAGE_OWNER` hardcoded as `alfi-rajasyah`, and the auto-seed command line are unchanged.

**Recovery for the existing 10.10.1.10 server (chronic P1000):** SSH in, paste setup.sh, answer the two prompts. The script's wipe-then-init step replaces the corrupt postgres volume cleanly.

### Changed — 2026-05-02 — Plug-and-play single-file deployment

- **[docker-compose.yml](docker-compose.yml)** — every value is now hardcoded (no `.env` required). `IMAGE_OWNER` baked to `alfi-rajasyah`, `IMAGE_TAG` baked to `latest`, `POSTGRES_PASSWORD`/`JWT_SECRET` set to demo defaults documented in a banner comment, `CORS_ORIGIN: "*"`. Backend command extended to run `npx prisma db seed` between `migrate deploy` and `node dist/index.js`, so the admin user (`admin@solvro.local` / `password123`) exists on first boot. The seed in [backend/prisma/seed.ts](backend/prisma/seed.ts) is idempotent (uses `upsert`) so this is safe to re-run on every container start. **Why:** "anyone can `docker compose up -d` and the app works" was the actual goal; the multi-file `.env` setup kept producing avoidable config errors (P1000 password mismatches, CORS misconfigs). **Trade-off:** the demo secrets are public — this file is for private-LAN demos, not internet-facing production. The banner says so.
- **[backend/src/app.ts](backend/src/app.ts)** — `CORS_ORIGIN=*` is now interpreted as "allow all origins" (passed to the cors package as `origin: true`). Other values still work as before (comma-separated allowlist).
- **[backend/package.json](backend/package.json)** — moved `tsx` from `devDependencies` to `dependencies`. Production image runs `npm ci --omit=dev`; the seed script (`tsx prisma/seed.ts`) needs `tsx` at runtime.
- **[.gitignore](.gitignore)** — added `CLAUDE.md` and `.claude/` so Claude Code working files stay local. Existing tracked copies were untracked with `git rm --cached` (local files preserved).

### Changed — 2026-05-02 — Single compose file (prod-shaped); dev-in-Docker workflow removed

- **[docker-compose.yml](docker-compose.yml)** — replaced the previous dev-shaped file with the prod content (pulls images from GHCR, runs `prisma migrate deploy` on backend startup, exposes nginx on `:80`). Added one line vs. the previous prod file: `ports: - "${POSTGRES_PORT:-5432}:5432"` on postgres so the host-side dev workflow (`npm run dev` natively) can still connect. **Why:** two compose files (`docker-compose.yml` + `docker-compose.prod.yml`) forced everyone — humans and the docs — to remember which file to use where; one file with one shape is simpler. **Trade-off:** running the entire stack in Docker on a laptop with hot reload is no longer a one-liner; dev now means "Postgres in Docker, backend/frontend native via `npm run dev`." Anyone who needs full-stack-in-Docker for testing can `docker compose up` after setting `IMAGE_OWNER`/`IMAGE_TAG` in `.env` (pulls the published GHCR images), or reintroduce a `docker-compose.override.yml` later.
- **docker-compose.prod.yml** — deleted; merged into `docker-compose.yml`.
- **[CLAUDE.md](CLAUDE.md)** — updated the "Common commands" intro and the production-deployment paragraph in "Repository status" to reflect the single-file layout. The dev recipe is now `docker compose up -d postgres` + native `npm run dev`. The prior `docker compose up` one-liner that started everything dockerized has been removed because it would now try to pull from GHCR and fail without `IMAGE_OWNER` set — the new doc calls that out explicitly.
- **[.env.example](.env.example)** — rewrote the "Server-side" header to describe the GHCR image selectors (`IMAGE_OWNER`, `IMAGE_TAG`) as the variables `docker-compose.yml` reads when running the full stack, instead of as `docker-compose.prod.yml`-specific settings.
- **Server impact (manual step required, no push needed):** the compose file is local to each server, not baked into any image and not subject to the CI/GHCR cycle. To migrate an existing server, SSH in and run `mv ~/docker-compose.prod.yml ~/docker-compose.yml`. After that, `docker compose up -d` (no `-f` flag) is the canonical command.

### Changed — 2026-05-02 — Frontend API URL is now runtime-derived; `VITE_API_BASE_URL` removed

- **[frontend/src/lib/api.ts](frontend/src/lib/api.ts)** — `BASE_URL` is now computed at module load from `window.location` as `${protocol}//${hostname}:3000`, with a fallback to `http://localhost:3000` for SSR/test contexts where `window` is undefined. Previously read `import.meta.env.VITE_API_BASE_URL`, which baked the backend URL into the bundle at build time. **Why:** the deployed frontend now works on any host (LAN IP, Tailscale IP, public DNS, localhost) without rebuilding — the previous setup required republishing the GHCR image whenever the access URL changed (e.g. moving from `10.10.1.10` LAN to `100.96.187.78` Tailscale broke API calls). **Constraint introduced:** the backend must always be reachable on port 3000 of whatever host serves the frontend; if you ever put a reverse proxy in front that terminates the backend on a different port or path, this file needs to change again.
- **[frontend/Dockerfile](frontend/Dockerfile)** — removed `ARG VITE_API_BASE_URL` and `ENV VITE_API_BASE_URL=...` from the `build` stage; nothing consumes them anymore.
- **[.github/workflows/docker-publish.yml](.github/workflows/docker-publish.yml)** — removed the `build_args` matrix field and the `build-args` input on `docker/build-push-action`. The repo-level Actions variable `VITE_API_BASE_URL` is now unused — safe to delete from `https://github.com/<owner>/<repo>/settings/variables/actions` but leaving it costs nothing.
- **[docker-compose.yml](docker-compose.yml)** — removed the `VITE_API_BASE_URL` environment block from the dev `frontend` service. Vite dev server still works because the runtime computation gives `http://localhost:3000` when the page is on `localhost:5173`.
- **[.env.example](.env.example)** — removed the `VITE_API_BASE_URL=http://localhost:3000` line; replaced with a comment explaining the new runtime-derivation approach.
- **frontend/.env.example** — deleted; the file held only `VITE_API_BASE_URL` and is now empty of meaningful content. The frontend has no env vars.
- **[CLAUDE.md](CLAUDE.md)** — updated the "API layer" bullet under Frontend conventions to describe runtime URL derivation and call out the port-3000 constraint.

### Changed — 2026-05-02 — CLAUDE.md accuracy + coverage pass

- **[CLAUDE.md](CLAUDE.md)** — fixed `npm run typecheck` documentation (actual script is `tsc --noEmit`, not `tsc -b --noEmit`). Added a production-deployment paragraph in "Repository status" describing [docker-compose.prod.yml](docker-compose.prod.yml), the GHCR images published by [.github/workflows/docker-publish.yml](.github/workflows/docker-publish.yml), the nginx-served frontend in prod, and the prod env contract — future Claudes touching env/Docker need this. Added a routes-inventory bullet to "Backend conventions" naming all twelve route files (incl. the previously undocumented `services.ts`) and a `prisma migrate dev --name <slug>` warning (it hangs without `--name` in non-interactive shells). Expanded the "Frontend conventions" routing bullet to enumerate all shipped pages (Customer is a first-class entity; Admin uses a separate `AdminGuard`). Added bullets for [frontend/src/lib/theme.tsx](frontend/src/lib/theme.tsx) (runtime theme provider) and the hand-rolled Gantt implementation in [frontend/src/components/gantt/](frontend/src/components/gantt/) — explicit drift from PRD §6's `gantt-task-react` claim, called out so a future Claude doesn't `npm install` the wrong library.

### Added — 2026-05-02 — Production Docker images, GHCR publish workflow, and server-side compose

- **Backend Dockerfile** ([backend/Dockerfile](backend/Dockerfile)) rewritten as a 4-stage build (`deps` / `dev` / `build` / `runtime`). The `dev` stage preserves today's `npm run dev` watch workflow (used by [docker-compose.yml](docker-compose.yml) via `target: dev`); the default last stage `runtime` produces a deployable image that runs `node dist/index.js` with prod-only `node_modules` (`npm ci --omit=dev`) plus the generated Prisma client and the compiled `dist/`. Final image ≈ 200–250 MB.
- **Frontend Dockerfile** ([frontend/Dockerfile](frontend/Dockerfile)) rewritten as a 4-stage build. The `dev` stage runs `vite --host 0.0.0.0`; the `runtime` stage is `nginx:1.27-alpine` serving the Vite-built `dist/`. `VITE_API_BASE_URL` is wired as a `--build-arg` because Vite inlines `import.meta.env.*` at build time.
- **frontend/nginx.conf** ([frontend/nginx.conf](frontend/nginx.conf)) — SPA fallback (`try_files ... /index.html`) so React Router deep links survive a refresh, long-cache headers for hashed `/assets/`, no-store on `index.html`, and gzip for text mimetypes.
- **GitHub Actions workflow** ([.github/workflows/docker-publish.yml](.github/workflows/docker-publish.yml)) — builds backend + frontend in parallel via a matrix and pushes to GHCR (`ghcr.io/<owner>/solvro-{backend,frontend}`) on push to `main`, on `v*` tags, and on manual dispatch. Tags include `sha-<short>`, branch name, version, and `latest` (main only). Uses GitHub Actions cache (`type=gha`, scoped per service) so subsequent builds reuse layers. Reads `vars.VITE_API_BASE_URL` (a repo-level Actions variable) for the frontend build arg — set this to the server's public API URL before the first push.
- **docker-compose.prod.yml** ([docker-compose.prod.yml](docker-compose.prod.yml)) — server-side compose. No `build:` blocks; only `image:` references to GHCR with `pull_policy: always`. The backend container runs `npx prisma migrate deploy && node dist/index.js` so schema migrations apply automatically on first boot and on each upgrade. Frontend is exposed on `:80`. `IMAGE_OWNER` and `IMAGE_TAG` come from the host's `.env`. Designed to be the only compose file shipped to the server (no need to clone the repo there).
- **.env.example** ([.env.example](.env.example)) — appended a `Server-side (docker-compose.prod.yml)` section with `IMAGE_OWNER` and `IMAGE_TAG`. The dev compose ignores these vars; the prod compose requires them.

### Changed — 2026-05-02 — Compose dev target pin + ignore-file hygiene

- **[docker-compose.yml](docker-compose.yml)** — `backend` and `frontend` services now use `build: { context, target: dev }` instead of `build: ./backend`. Without this, a default `docker build ./backend` outside compose would still produce the dev container; pinning `target: dev` here makes the intent explicit and lets CI / GHCR workflows pick up the default last stage (`runtime`) for production.
- **[backend/.dockerignore](backend/.dockerignore), [frontend/.dockerignore](frontend/.dockerignore)** — tightened to exclude `dist`, `*.tsbuildinfo`, `.vite`, `coverage`, IDE folders, and the repo's `README.md` / `CHANGELOG.md`. Keeps the build context small and prevents stale local artifacts from sneaking into the image.
- **[.gitignore](.gitignore)** — added explicit `backend/dist/` and `frontend/dist/` paths (the existing root-anchored `dist/` doesn't recurse), plus `*.tsbuildinfo`, `.vite/`, and `docker-compose.override.yml`. Some build artifacts (`frontend/tsconfig.tsbuildinfo`, `tsconfig.node.tsbuildinfo`) currently exist on disk and will be excluded from the first commit.

### Changed — 2026-05-02 — Customer field renames + clickable detail page with placeholder resource tabs

- **Schema** ([backend/prisma/schema.prisma](backend/prisma/schema.prisma)) — Customer model rewritten:
  - Dropped: `industry`, `website`.
  - Renamed: `contactName` → `accountManager`, `contactEmail` → `solutionArchitect`, `notes` → `description`.
  - `description` is now NOT NULL (was nullable).
  - Per user direction, AM and SA stay as plain text strings — a structured Roles model + User FKs will land in a later turn.
- **Migration** ([backend/prisma/migrations/20260502123923_rename_customer_fields_drop_extras/migration.sql](backend/prisma/migrations/20260502123923_rename_customer_fields_drop_extras/migration.sql)) — **hand-written** because Prisma's auto-generated migration uses DROP+ADD for renames, which would null out existing data. The hand-written SQL uses `ALTER TABLE ... RENAME COLUMN` so all existing values for the three renamed fields are preserved. Backfills `description = ''` for any pre-existing NULL rows before adding the NOT NULL constraint. **Action required**: the sandbox blocked Claude from running `prisma migrate deploy`; the user must run it: `cd backend && DATABASE_URL='...' npx prisma migrate deploy && docker compose exec backend npx prisma generate && docker compose restart backend`. Without this, the customer endpoints will error at runtime even though `tsc` passes (host-side `prisma generate` was run for type-checking purposes).
- **Backend** ([backend/src/routes/customers.ts](backend/src/routes/customers.ts)) — `createCustomerSchema` and `updateCustomerSchema` rewritten with the new field names; `description` validated as `min(1).max(5000)` (required); AM/SA validated as `max(200).optional()`. Email format validation removed from SA since it's now a plain text name. POST/PATCH handlers updated to write the four new columns. Role gates unchanged.
- **Frontend types** ([frontend/src/lib/queries.ts](frontend/src/lib/queries.ts)) — `CustomerSummary`, `CustomerDetail` (extends Summary), and `CustomerInput` updated to the new field shape; `description: string` (not nullable).
- **Modal** ([frontend/src/components/CustomerFormModal.tsx](frontend/src/components/CustomerFormModal.tsx)) — 4-field rewrite: Name (required) / Account Manager (text, optional) / Solution Architect (text, optional) / Description (textarea, required, ~5 rows). Client-side block on submit if either Name or Description is empty/whitespace.
- **List page** ([frontend/src/pages/Customers.tsx](frontend/src/pages/Customers.tsx)) — each card is now a `<Link to="/customers/:id">`. The Edit/Delete buttons stop event propagation so they don't trigger card navigation. Card body shows the 2-letter avatar, name, AM line ("AM: Alice Chen"), SA line, description excerpt, and project count link. Removed the industry badge and the external website link. Inline `EmptyState` extracted into a shared component.
- **New detail page** ([frontend/src/pages/CustomerDetail.tsx](frontend/src/pages/CustomerDetail.tsx)) at `/customers/:id`:
  - Header: back link to `/customers`, customer name, AM/SA + project count summary line, full description (whitespace-pre-line preserved). TAM/ADMIN see Edit/Delete buttons in the header.
  - Tabs (using the new shared `Tabs` primitive): **Overview** / **Topology** / **Documents** / **Organization Structure**.
  - Overview lists the customer's projects in a table with Project / Status / TAM / SA / Tasks columns, each row linking to `/projects/:id`. Empty state shown when no projects.
  - Topology / Documents / Organization Structure are placeholder tabs per user direction — each renders a styled `EmptyState` with an icon and a short "coming soon" message. Pages are accessible immediately even though there's no data model yet.
  - Edit button opens the same `CustomerFormModal` already used by the list. Delete uses `useDeleteCustomer`, navigates back to `/customers` on success.
- **New shared components**:
  - [frontend/src/components/Tabs.tsx](frontend/src/components/Tabs.tsx) — generic underline tab nav (`<Tabs items={[{key,label}]} active onChange />`). Extracted from the inline `TabButton` in `Admin.tsx` so it can be reused by the customer detail page (and any future tabbed surface).
  - [frontend/src/components/EmptyState.tsx](frontend/src/components/EmptyState.tsx) — generic empty state with icon, optional title, message, and optional action slot. Extracted from the inline `EmptyState` in `Customers.tsx`. Used by Customers list, CustomerDetail's three placeholder tabs, and CustomerDetail's Overview empty state.
- **Refactor** ([frontend/src/pages/Admin.tsx](frontend/src/pages/Admin.tsx)) — replaced the inline `TabButton` definition with the new shared `<Tabs>` primitive. Behavior identical.
- **Routing** ([frontend/src/App.tsx](frontend/src/App.tsx)) — new `<Route path="customers/:id" element={<CustomerDetail />} />` as a sibling of the existing `/customers` route, both inside the authed `Shell` block.
- **Project form** ([frontend/src/components/ProjectFormModal.tsx](frontend/src/components/ProjectFormModal.tsx)) — customer dropdown's secondary label changed from `· {industry}` (now removed from schema) to `· AM {accountManager}` so the AM is visible during project creation.
- **Verification**: `cd backend && npm run build` exits 0; `cd frontend && npm run typecheck` exits 0. End-to-end verification waits on the user-applied migration.
- **Out of scope this turn (flagged for follow-up)**:
  - Real Topology / Documents / Org Structure data models.
  - Roles model + User FKs replacing the AM/SA text fields.
  - Search / filter on the Customers list.

### Added — 2026-05-02 — Project Baseline: lock snapshot + per-task baseline date overrides

- **Schema**: new migration `20260502051432_add_project_baseline` ([backend/prisma/migrations/](backend/prisma/migrations/)) adding:
  - `Task.baselineStartDate DateTime?` and `Task.baselineDueDate DateTime?` — per-task snapshot of the locked schedule.
  - `Project.baselineLockedAt DateTime?` and `Project.baselineLockedById Int?` (FK to `User`) with relation `ProjectBaselineLockedBy` — single canonical anchor for "this project has a baseline locked at T by user U". A project-level flag was preferred over inferring from task data so the toolbar button state is one boolean check and survives manual edits that null individual task baselines.
- **Backend endpoint** ([backend/src/routes/projects.ts](backend/src/routes/projects.ts)): `POST /projects/:id/baseline` (gated by `requireRole("TAM", "ADMIN")`) — copies every task's live `start_date` / `due_date` into `baseline_*` columns via raw SQL inside a `prisma.$transaction` (Prisma's `updateMany` can't do column-to-column copies), then stamps `Project.baselineLockedAt = now()` and `baselineLockedById = req.user.sub`. Idempotent — same endpoint serves first-time lock and reset; the frontend distinguishes the two by reading `baselineLockedAt`. Returns the updated project including `baselineLockedBy: { id, username }` for tooltip rendering.
- **Backend manual edits** ([backend/src/routes/tasks.ts](backend/src/routes/tasks.ts)): extended `updateTaskSchema` with `baselineStartDate` and `baselineDueDate` (both `z.coerce.date().nullable().optional()`). No new endpoint — `PATCH /tasks/:id` already spreads the validated body into `prisma.task.update`. Permission gate unchanged.
- **`GET /projects/:id`** now `include`s `baselineLockedBy: { select: { id, username } }`.
- **Frontend types** ([frontend/src/lib/queries.ts](frontend/src/lib/queries.ts)):
  - `Task` extended with `baselineStartDate / baselineDueDate: string | null`.
  - `ProjectSummary` + `ProjectDetail` extended with `baselineLockedAt / baselineLockedById`; `ProjectDetail` adds `baselineLockedBy: { id, username } | null`.
  - `UpdateTaskInput` accepts the two new baseline fields (flow through the existing `useUpdateTask` optimistic mutation untouched).
  - New `useLockBaseline(projectId)` mutation — POSTs the empty body, on success invalidates `queryKeys.project(id)`, `queryKeys.projectTasks(id)`, and `["projects"]` so toolbar restyles and any future ghost-bar visualization picks up fresh baselines.
- **New** [frontend/src/components/ConfirmModal.tsx](frontend/src/components/ConfirmModal.tsx) — small reusable wrapper over the existing [Modal.tsx](frontend/src/components/Modal.tsx). Props: `open / onClose / onConfirm / title / body / confirmLabel / confirmTone: "primary" | "warning" / busy`. Built on top of the existing modal so styling stays consistent and avoids `window.confirm()`'s jarring native dialog. Likely future reuse for delete confirmations.
- **Toolbar button** ([frontend/src/components/gantt/GanttFrame.tsx](frontend/src/components/gantt/GanttFrame.tsx)):
  - New props `baselineLockedAt: string | null` and `baselineLockedBy: { id, username } | null` passed from [ProjectGantt.tsx](frontend/src/pages/views/ProjectGantt.tsx) (which already had `project` in scope from `useProjectContext()`).
  - Two button states (canEdit-only block, after the "Section" button):
    - No baseline: **"Lock Baseline"** with `bookmark_add` icon, primary fill (`bg-primary text-on-primary border border-primary`) — stands out per the spec.
    - Baseline exists: **"Reset Baseline"** with `bookmark` icon, muted style (`border border-gray-300 text-on-surface-variant`) — less prominent so the user knows it overwrites. `title` attribute shows `"Baseline locked <timestamp> by <username>"`.
  - Click → `ConfirmModal`. First-lock copy is informational + primary tone; reset copy is a warning tone (amber) with explicit "previous snapshot will be replaced ... cannot be undone" language.
- **Per-task baseline edits** ([frontend/src/components/TaskFormModal.tsx](frontend/src/components/TaskFormModal.tsx)): new "Baseline Dates" section in the right sidebar (edit mode only — create mode has no live dates yet, baseline makes no sense). Visually distinguished as a dashed-border block with a `bookmark` icon and a small footnote: "Override only if project scope officially changes — does not affect the live schedule." Two `<input type="date">` fields wired to local state and flowed through the same `useUpdateTask` patch as the live dates.
- **Container hygiene**: ran `docker compose exec backend npx prisma generate && docker compose restart backend` after the migration so the running container picks up both the regenerated client and the new `/projects/:id/baseline` route. Verified with `curl -X POST http://localhost:3000/projects/2/baseline` → 401 (route mounted, unauth as expected). Without these two commands the route would 404 because `node_modules` is a separate Docker named volume from the source mount.
- **Verification**: `cd backend && npm run build` exits 0; `cd frontend && npm run typecheck` exits 0. End-to-end (manual): log in as `tam.charlie@solvro.local` / `password123`, open `/projects/2/gantt` → primary "Lock Baseline" button visible → click → confirm modal → confirm → button switches to muted "Reset Baseline" with the lock-timestamp tooltip → open any task → "Baseline Dates" section shows snapshotted values → edit and save → values persist on reopen → "Reset Baseline" → amber warning modal → confirm → snapshot refreshed.
- **Follow-on — Reset feedback toast, "as-of date" picker, and "Clear baseline" action**: the user reported "Reset baseline still not working" — root cause was UX, not a bug: when live == baseline, `useLockBaseline` re-snapshots silently and the ghost stays hidden (because there's no diff), so the user sees nothing change. Fixes:
  - **Visible success feedback**: emerald pill toast at the bottom of the viewport ("Baseline locked as of 2026-05-02" / "Baseline overwritten — now anchored to ..." / "Baseline cleared"), auto-dismisses after 4s. Lives at `z-[110]` so it floats above the modal layer.
  - **Backend** ([backend/src/routes/projects.ts](backend/src/routes/projects.ts)): `POST /projects/:id/baseline` now accepts an optional body `{ asOfDate?: ISO date, clear?: boolean }`. Validated via new `lockBaselineSchema`. When `asOfDate` is provided, it's used as `Project.baselineLockedAt` instead of `new Date()` — lets a TAM backdate or anchor to a milestone date. When `clear: true`, both `Project.baselineLockedAt` / `baselineLockedById` are NULLed and every task's `baseline_start_date` / `baseline_due_date` are reset to NULL — actually removes the snapshot. Clear and lock are mutually exclusive paths inside the existing `$transaction`.
  - **Frontend** ([frontend/src/lib/queries.ts](frontend/src/lib/queries.ts)): `useLockBaseline` now takes `LockBaselineInput { asOfDate?, clear? }` and posts it as the body. Default-empty input still works (calls with `()` legal).
  - **Confirm modal redesign** ([GanttFrame.tsx](frontend/src/components/gantt/GanttFrame.tsx)): inside the `ConfirmModal` body — date input labelled "Baseline as-of date" defaulting to today, with explanatory help text ("Defaults to today. Use a different date to backdate the snapshot — e.g. 'May 1 baseline'."). When a baseline already exists, a small destructive "Clear baseline instead" link appears below the divider — fires the `clear: true` mutation directly from the modal without needing a separate menu.
- **Follow-on, same turn — visual baseline ghost bar** ([GanttBar.tsx](frontend/src/components/gantt/GanttBar.tsx)): the user pushed back that locking without visual feedback is meaningless. Added an outline-only ghost bar at the baseline position, rendered behind the live bar (`zIndex: 1` vs the live bar's `zIndex: 2`). Style: dashed slate border (`border-dashed border-slate-500/70`) with a faint slate fill so it's visible but doesn't fight the colored live bar for attention. **Self-hiding when there's no slip** — if `baselineStartDate === startDate && baselineDueDate === dueDate`, the ghost is not rendered (matches an empty diff → no visual noise). When dates diverge, the ghost shows the original schedule and the live bar shows the new one — slip is the visual gap between them. Tooltip on the ghost: `"Baseline: 2026-05-12 → 2026-05-19 · slip: start +3d, end +5d"`. `pointer-events-none` so the ghost never blocks interaction with the live bar's drag handles. Re-renders on every drag (no special wiring — `row.task.baselineStartDate` flows through the existing optimistic mutation cache).
- **Remaining out of scope (flagged for follow-up)**:
  - Project-level bulk baseline edits (e.g. "all tasks in section X").
  - Baseline history / multiple baselines per project (only the latest snapshot is kept).
  - Baseline-aware reporting / overdue logic (e.g. "tasks slipping more than N days").

### Added — 2026-05-02 — Admin RBAC: strict gate, user management, project reassignment

- **Schema**: new `User.active Boolean @default(true)` column ([backend/prisma/schema.prisma](backend/prisma/schema.prisma)). Migration name: `add_user_active`. **Action required**: run `cd backend && npx prisma migrate dev --name add_user_active` to apply — the sandbox blocked Claude from running it. The schema file change is staged; without applying, the new admin endpoints will fail at runtime even though `tsc` passes.
- **Backend middleware**: new `requireAdmin` in [backend/src/http/auth.ts](backend/src/http/auth.ts) — strict `role === "ADMIN"` check (rejects everything else with 403). Use as router-level middleware AFTER `requireAuth`, not per-route.
- **Backend login gate**: [backend/src/routes/auth.ts](backend/src/routes/auth.ts) `/login` now rejects deactivated users with 403 `account_disabled` even when credentials are correct, per the requirement that deactivated users cannot log in at all.
- **New router** [backend/src/routes/admin.ts](backend/src/routes/admin.ts) mounted at `/admin` (existing convention, not `/api/admin/` — the repo strips the `/api/` prefix everywhere). All endpoints sit behind `requireAuth + requireAdmin`:
  - `GET /admin/users` — full user list with `active`, role, created date, project counts (TAM/SA).
  - `PATCH /admin/users/:id/role` — change role; rejects self-demote (admins can't change their own role).
  - `PATCH /admin/users/:id/deactivate` — toggle `active`; rejects self-deactivate.
  - `POST /admin/users/:id/reset-password` — generates a 12-char URL-safe temp password (`crypto.randomBytes`), bcrypt-hashes and stores it, returns the plaintext **once** in the response (no mail infra in dev — admin relays out-of-band). Per the user's "Change password for now (Development)" decision, no forced-change-on-next-login flag was added; the user just logs in with the temp password.
  - `GET /admin/projects` — all projects, bypasses the standard visibility filter (admins see everything per the user's "Admins can CRUD all projects" decision).
  - `PUT /admin/projects/reassign` — body `{ projectId, newTamId }`; updates `Project.tamId`. Validates that the new TAM exists, is active, and has TAM or ADMIN role. This is the only path for *force-reassign by an admin*; regular TAMs can still PATCH their own projects via `/projects/:id` but cannot use `/admin/*` (403 from middleware).
- **Frontend**:
  - New types + queries/mutations in [frontend/src/lib/queries.ts](frontend/src/lib/queries.ts): `AdminUser`, `AdminProject`, `useAdminUsers`, `useAdminUpdateRole`, `useAdminSetActive`, `useAdminResetPassword`, `useAdminProjects`, `useAdminReassignProject`. All invalidate `adminQueryKeys.*` plus the relevant non-admin keys (so the regular `/users` and `/projects` queries also refresh).
  - New [frontend/src/components/AdminGuard.tsx](frontend/src/components/AdminGuard.tsx): redirects non-ADMIN users to `/overview`. Doesn't fight `AuthGuard` — it's a separate layer applied only on the `/admin` route.
  - New [frontend/src/pages/Admin.tsx](frontend/src/pages/Admin.tsx) with two tabs:
    - **Users**: data table with role dropdown (inline change), Deactivate/Reactivate toggle, Reset Password action. Self-row's role select + Deactivate are disabled. Reset Password shows the generated temp password ONCE in a banner the admin must dismiss.
    - **Project Override**: data table of all projects with a TAM dropdown next to each row that fires `useAdminReassignProject` on change. Candidate list filters to active TAM + ADMIN users. If a project's current TAM isn't in the candidates (deactivated or wrong role), they're appended as a "(current)" option so the dropdown shows reality rather than blanking.
  - **Skipped per user direction**: SA Webhook API Key (deferred — Secure Ingestion Port unimplemented), Global Holidays editor (keep `date-holidays` package as-is), System Logs.
  - New `/admin` route in [frontend/src/App.tsx](frontend/src/App.tsx) wrapped in `AdminGuard`.
  - Sidebar gets a sixth item "Admin" (icon: `admin_panel_settings`) in [frontend/src/components/layout/Sidebar.tsx](frontend/src/components/layout/Sidebar.tsx), filtered to `user.role === "ADMIN"` only.
- **Verification**: `cd backend && npm run build` exits 0; `cd frontend && npm run typecheck && npm run build` both exit 0 (754KB bundle, +10KB for the admin page). Runtime verification still requires the user-applied migration; once applied, log in as `admin@solvro.local` / `password123` → sidebar shows "Admin" → both tabs render and mutate correctly.

### Fixed — 2026-05-02 — Project-wide build/typecheck cleanup

- **Backend build was failing** on ~40 TS errors. Two root causes:
  1. `date-holidays` was declared in [backend/package.json:25](backend/package.json) but never installed — `npm install` resolved this and added the missing types.
  2. The generated Prisma client at `backend/node_modules/.prisma/client/` was 3 migrations stale (only knew Role/User/Project/Task; schema actually has Customer/Section/Label/Comment/Blueprint as well). `npx prisma generate` regenerated it. All `Property 'section' does not exist` / `Priority not exported` errors cleared.
  3. [backend/src/http/validate.ts](backend/src/http/validate.ts) generic signature `validate<T>(source, schema: ZodSchema<T>)` rejected schemas that use `z.transform()` (input ≠ output type) — affected the cross-project tasks list query schema's `overdue: "true"|"false" → boolean` coercion. Loosened to `validate(source: Source, schema: ZodTypeAny)` — the parsed value is still type-safe at the call site via the existing `as z.infer<typeof schema>` cast.
- **Frontend typecheck was failing** on 6 errors:
  1. `@types/node` was never installed → [vite.config.ts](frontend/vite.config.ts) couldn't resolve `node:path` / `__dirname`. Added with `npm install -D @types/node`.
  2. [frontend/tsconfig.node.json](frontend/tsconfig.node.json) had the invalid combo `composite: true` + `noEmit: true` (TS6310). Dropped `noEmit` from the node config; the `tsc -b --noEmit` build script also conflicted with composite-referenced projects, so changed [frontend/package.json](frontend/package.json) `typecheck` from `tsc -b --noEmit` to `tsc --noEmit` (typechecks src/ only — config files are still typechecked during `npm run build` via `tsc -b`).
  3. [GanttColumnGrid.tsx:69](frontend/src/components/gantt/GanttColumnGrid.tsx) unused `col` parameter → renamed `_`.
  4. [GanttFrame.tsx:224-232](frontend/src/components/gantt/GanttFrame.tsx) section-reorder dispatch used `.map(...).filter((p): p is Promise<unknown> => ...)` with an invalid type predicate (supertype not subtype) — refactored to `.flatMap((s, i) => skip ? [] : [promise])` which avoids the null-and-narrow dance entirely.
  5. [ProjectList.tsx:732](frontend/src/pages/views/ProjectList.tsx) `groups` array's inferred type was too narrow to accept `{ section: null, ... }` for the synthetic "(No section)" row → added explicit `: { section: Section | null; tasks: TaskNode[] }[]` type annotation matching the function's declared return.
- **Verification**: `cd backend && npm run build` exits 0; `cd frontend && npm run typecheck && npm run build` both exit 0 (vite reports `built in 1.77s`, 925 modules).

### Removed — 2026-05-02 — Unused `gantt-task-react` dependency

- The Gantt rewrite removed all imports of `gantt-task-react` from `frontend/src/`, but the dep stayed pinned in [frontend/package.json](frontend/package.json). `npm uninstall gantt-task-react` removed it (-1 package). `grep -r "gantt-task-react" frontend/src` now returns nothing.

### Changed — 2026-05-02 — DESIGN.md prose color now matches its frontmatter

- The frontmatter token at [DESIGN.md:19](DESIGN.md) defines `primary: '#0058be'` (correctly mirrored in [frontend/tailwind.config.ts:26](frontend/tailwind.config.ts)), but the prose at line 111 said "Solvro Blue (#3B82F6)" — Tailwind's default blue, a different shade. Updated the prose to `#0058be` so future contributors aren't misled by the contradiction. CLAUDE.md "Known design drift" notes that frontmatter wins; this aligns the prose with that rule.

### Changed — 2026-05-02 — InlineDateRangeEditor reworked as a popover with stacked fields

- **Problem**: the previous turn rendered the editor inline INSIDE the date cell, but two 110px date inputs + chevron + OK/✕ + paddings exceeded the Gantt list pane's 76+76=152px Start/Due column space, so the inputs visibly clipped each other (`01/05/2026 → 04/05/0226` — the "2026" got truncated and overlapped).
- **Fix**: [InlineDateRangeEditor.tsx](frontend/src/components/InlineDateRangeEditor.tsx) rewritten as a **220px popover panel** with Start and Due **stacked vertically** (each on its own line with a tiny `Start` / `Due` label), and Cancel + Save right-aligned at the bottom. Popover positioning is the consumer's responsibility via the new optional `className` prop (e.g. `"absolute right-0 top-full z-50 mt-1"`). The popover layer floats out of the cell — no clipping, no column-width contortions. Added `Escape` to cancel (was only click-outside before).
- **Consumer updates**:
  - [GanttListRow.tsx](frontend/src/components/gantt/GanttListRow.tsx): the Start and Due cells stay visible underneath; the editor anchors absolute-right under the Due cell. Both date cells stay clickable to open the editor.
  - [ProjectList.tsx](frontend/src/pages/views/ProjectList.tsx) `TaskRow` and `SubtaskRow`: editor anchors absolute-left under the Start–Due text.
- **Verification**: `npm run typecheck` passes (only pre-existing config-file noise). Manual: open `/projects/2/gantt` → click any Start or Due cell → tidy popover appears below the cell with stacked inputs; date strings are no longer truncated.

### Added — 2026-05-02 — Editable "(No Section)" + click-to-edit dates in List and Gantt list pane

- **New shared component** [components/InlineDateRangeEditor.tsx](frontend/src/components/InlineDateRangeEditor.tsx): two native `<input type="date">` inputs (Start, Due) + OK / ✕ buttons, with click-outside dismiss and basic clamp (Due < Start auto-corrects to Start). Returns ISO strings via `onSave(startISO, dueISO)`. Used by both [ProjectList.tsx](frontend/src/pages/views/ProjectList.tsx) and [GanttListRow.tsx](frontend/src/components/gantt/GanttListRow.tsx) so the inline edit UX is identical across views.
- **List view — edit "(No Section)"**:
  - The synthetic `(No section)` group's edit pencil is now enabled (was hidden because `section` was null). Clicking it opens the same inline rename input the real sections use, with placeholder "Name this section to promote it" and a "Create" button (real sections still say "Save").
  - Submitting the new name in [ProjectList.tsx](frontend/src/pages/views/ProjectList.tsx#L80-L113) calls `useCreateSection` to create a real section, then PATCHes every orphan task (those with `sectionId === null`) into the new section in parallel via `useUpdateTask`. The synthetic row disappears (because no orphans remain) and the new real section appears in the list — a one-shot promotion.
  - Delete is still hidden for the synthetic row (nothing to delete in the DB).
  - State rename: `renamingSectionId: number | null` → `renamingSectionKey: number | "none" | null` so the same input flow keys both real sections and the synthetic one.
- **List view — click date to edit**: in [TaskRow](frontend/src/pages/views/ProjectList.tsx#L406-L525) and [SubtaskRow](frontend/src/pages/views/ProjectList.tsx#L527-L594) the Start–Due text is now a `<button>` (with hover affordance and "Click to edit dates" tooltip) that swaps to `<InlineDateRangeEditor>` on click. Save fires `useUpdateTask({ startDate, dueDate })` (existing optimistic mutation — date change is instantly visible in the list, the bar in any open Gantt view, etc.). Disabled for non-editors (STAKEHOLDER role).
- **Gantt list pane — click date to edit**: the Start and Due cells in [GanttListRow.tsx](frontend/src/components/gantt/GanttListRow.tsx) become buttons that, on click, swap into a single `<InlineDateRangeEditor>` spanning both columns. Same optimistic `useUpdateTask` mutation. New `onUpdateDates` prop chain: `GanttFrame.handleUpdateDates` → `GanttListPane` → `GanttListRow`.
- **Why this shape for "(No Section)"**: the synthetic row has no `Section` row in the DB, so "edit name + save in place" is meaningless. Promotion (create real section + migrate orphans) was the only behavior that maps cleanly to the existing schema and is what the user actually wants — they want unsectioned tasks to be organizable. Alternative considered: rename the synthetic row in the UI only (no DB write); rejected because it'd be cosmetic and would lose state on reload.
- **Files**: new [components/InlineDateRangeEditor.tsx](frontend/src/components/InlineDateRangeEditor.tsx); modified [pages/views/ProjectList.tsx](frontend/src/pages/views/ProjectList.tsx), [components/gantt/GanttListRow.tsx](frontend/src/components/gantt/GanttListRow.tsx), [components/gantt/GanttListPane.tsx](frontend/src/components/gantt/GanttListPane.tsx), [components/gantt/GanttFrame.tsx](frontend/src/components/gantt/GanttFrame.tsx). No deletions.
- **Verification**: `npm run typecheck` passes (only pre-existing `vite.config.ts` / `tsconfig.json` config-file noise remains). Manual QA: as `tam.charlie@solvro.local` / `password123` — in `/projects/2/list`, click the edit pencil on `(No section)` → type a name → Create → orphan tasks (Test) move into the new section, synthetic row disappears. Click any task's Start–Due text → inline date editor opens → change a date → OK → list updates instantly and the Gantt bar (if open) reflects the new dates. Same in `/projects/2/gantt` list pane.

### Changed — 2026-05-02 — Gantt list pane: drop inline "+ Add task" rows; add drag-to-move tasks between sections and drag-to-reorder sections

- **Removed** the inline `+ Add task` row that appeared under each section in the list pane. The toolbar's `+ TASK` button is now the only entry point. Cleanup chain:
  - [lib/gantt/geometry.ts](frontend/src/lib/gantt/geometry.ts): dropped `"add-task"` from `RowKind`; removed the `add-task` row push in `buildRows`. `RowKind` is back to `"section" | "task" | "subtask"`.
  - [components/gantt/GanttListRow.tsx](frontend/src/components/gantt/GanttListRow.tsx): removed the `add-task` render branch and the `onAddTask` prop.
  - [components/gantt/GanttListPane.tsx](frontend/src/components/gantt/GanttListPane.tsx): removed the `onAddTask` prop pass-through.
  - [components/gantt/GanttFrame.tsx](frontend/src/components/gantt/GanttFrame.tsx): removed `handleAddTaskInSection`. The `onCreateTaskOpen(sectionId)` API still accepts a sectionId for forward compatibility, but every caller now passes `null`.
- **Added** drag-and-drop in the list pane via `@dnd-kit/core` (already a dep, used the same pattern as [ProjectKanban.tsx](frontend/src/pages/views/ProjectKanban.tsx)). Two affordances live on the same `DndContext` and dispatch by the dragged item's kind:
  - **Move a top-level task between sections**: grab the drag handle on a task row → drop on a section header → fires the existing optimistic [useUpdateTask](frontend/src/lib/queries.ts#L355-L381) mutation with `{ sectionId: target }`. Optimistic so the row jumps to its new section instantly.
  - **Reorder sections**: grab the drag handle on a section header → drop on another section header → moved section is inserted **before** the target. Then [useUpdateSection](frontend/src/lib/queries.ts#L481-L490) fires in parallel for every section whose `position` actually changed (renumbered to dense `0..N-1`). Sections without an `onMutate` optimistic path will briefly flicker; acceptable for MVP — promote to optimistic later if it bothers anyone.
  - **Subtasks are not draggable** (they always inherit their parent's section).
  - **The "(No section)" pseudo-row** is droppable (drop a task on it to clear the task's `sectionId`), but never draggable (it's not a real section).
  - **Drag handle**: a `drag_indicator` material-symbol icon appears in the leftmost slot of the name column for draggable rows; gray at rest, on-surface-variant on hover. Cursor: `grab` / `grabbing`. Drop target: 2px primary ring on the section header while a draggable hovers over it.
  - **PointerSensor activation distance = 6px**: clicks (toggle status, open editor, expand/collapse) still work cleanly because dnd-kit only activates after the pointer travels >6px.
  - **Permission gate**: drag is disabled entirely when `canEdit` is false (STAKEHOLDER role); handle icon is hidden.
- **New exported types** in `GanttListRow`: `RowDragData` (`{ kind: "task" | "section", taskId?, sectionId }`) and `RowDropData` (`{ kind: "section-target", sectionId }`). `GanttFrame.handleDragEnd` consumes them via `active.data.current` / `over.data.current`.
- **Files**: modified [lib/gantt/geometry.ts](frontend/src/lib/gantt/geometry.ts), [components/gantt/GanttListRow.tsx](frontend/src/components/gantt/GanttListRow.tsx), [components/gantt/GanttListPane.tsx](frontend/src/components/gantt/GanttListPane.tsx), [components/gantt/GanttFrame.tsx](frontend/src/components/gantt/GanttFrame.tsx). No new files; no deletions.
- **Verification**: `npm run typecheck` passes (only pre-existing `vite.config.ts` / `tsconfig.json` config-file noise remains). Manual QA path: log in as `tam.charlie@solvro.local` / `password123` → `/projects/2/gantt` → grab the Migration task's drag handle → drop on the Planning section header → Migration appears under Planning, both in the list and in the chart pane (the bar's vertical position shifts). Then grab the Closing section header → drop on the Pre-Implementation header → Closing appears above Pre-Implementation. As `stakeholder.evan@solvro.local` (STAKEHOLDER), drag handles are absent and drag-and-drop is no-ops.

### Fixed — 2026-05-02 — Gantt list pane was painted under the date axis (z-index inversion)

- [GanttListPane.tsx](frontend/src/components/gantt/GanttListPane.tsx): the list pane was `z-10` and its sticky header was `z-30`, while the chart's date axis ([GanttDateAxis.tsx](frontend/src/components/gantt/GanttDateAxis.tsx)) is `z-20`. With list pane < axis, the axis row painted ON TOP of the sticky list pane — so when scrolling horizontally the day numbers (01, 02, 03…) were visible bleeding under the Name/Start/Due/% columns.
- Fix: list pane → `z-30`, list-pane header → `z-40`. Now: axis (z-20) < list pane body (z-30) < list pane header / corner (z-40). The list pane's opaque white background hides the axis on the X axis; the corner header hides the axis on the Y axis.

### Added — 2026-05-02 — Gantt auto-scrolls to today on open and on scale change

- [GanttFrame.tsx](frontend/src/components/gantt/GanttFrame.tsx): on initial mount of the chart and on every view-mode / column-width / chart-start change, the chart pane auto-scrolls so today's column is centered. Wrapped in a `requestAnimationFrame` so the scroll happens after the browser has laid out the new content (otherwise `scrollTo` can fire against a stale `scrollWidth`).
- Refactored: `scrollToToday` (button handler) is now a thin wrapper over `scrollToTodayPos(behavior)`. Button uses `"smooth"`; the auto-scroll effect uses `"auto"` (instant) so the chart doesn't visibly animate from `0` on load.
- **Why**: with the ±1 year padding from the previous turn, opening the Gantt would dump the user at Jan-of-(year-before-earliest-task), forcing a manual click on Today every time. Auto-scroll matches Instagantt / Asana / monday.com default behavior.

### Changed — 2026-05-02 — Gantt timeline pads ±1 year around the project's task range

- **Why**: at default zoom the chart axis previously hugged the task range with only one unit of breathing room (1 day in Day mode, 1 week in Week mode, 1 month in Month mode). For a project that runs May–June 2026, you couldn't scroll back to e.g. Jan 2026 or forward to Sep 2026 to plan around adjacent work — the chart simply ended.
- **Fix** — [computeChartStart / computeChartEnd in lib/gantt/geometry.ts](frontend/src/lib/gantt/geometry.ts): both helpers now subtract / add a `PAD_YEARS = 1` constant to the actual min/max task date, then snap to the appropriate unit boundary (start-of-day for Day, Monday for Week, first-of-month for Month). The chart spans `[earliest task − 1 year, latest task + 1 year]` at minimum.
- **Holiday fetch** — [GanttFrame.tsx](frontend/src/components/gantt/GanttFrame.tsx): `yearsCovered` now derives from `chartStart` / `chartEnd` (post-padding) instead of `dateRange.min` / `dateRange.max`. So a project that visually spans 2025–2027 now triggers `useHolidays([2025, 2026, 2027])` — three parallel cached requests — and the holiday tints render across the full visible range, not just the un-padded task window.
- **Trade-off accepted**: more columns to render at default zoom (Day mode for a 1-month project becomes ~26 months × 30 days ≈ 780 columns at 60px each = ~47k px wide). The chart's own `overflow-auto` handles this; performance is fine for typical project sizes since each column is a tiny `<div>`. If a future project pushes 5+ years of tasks in Day mode, we'd want column virtualization — defer until it's an actual problem.

**Layout fix (the actual scroll bug — turns out it wasn't in the Gantt at all)**

- **Root cause**: in [pages/ProjectDetail.tsx:133](frontend/src/pages/ProjectDetail.tsx) the outlet wrapper `<div className="flex-1">` was a flex child without `min-w-0`. In flexbox, a child's default `min-width: auto` refuses to shrink below the content's intrinsic width. The Gantt's inner 2640px-wide content forced this flex child to be ≥2640px, which propagated up the chain (ProjectDetail outer flex → `<main>` → page `<div>`) and pushed the entire page wider than the viewport. Result: the **body** scrolled horizontally, not the Gantt's internal scroller. The previous turn's `columnWidth` stretch hack was masking, not fixing, this.
- **Fix** — three small changes to break the min-width-auto chain:
  - [Shell.tsx](frontend/src/components/layout/Shell.tsx): outer wrapper `min-h-screen` → `h-screen w-full overflow-hidden`. `<main>` `min-h-[...]` → `h-[calc(100vh-64px)] overflow-y-auto overflow-x-hidden`. The page is now strictly viewport-locked; non-Gantt pages still scroll vertically inside `<main>`.
  - [ProjectDetail.tsx](frontend/src/pages/ProjectDetail.tsx): outer flex container gets `min-w-0`; the outlet wrapper gets `min-h-0 min-w-0 flex-1` (was just `flex-1`). This is the load-bearing change — it lets the Gantt's wide inner content stay contained.
  - [GanttFrame.tsx](frontend/src/components/gantt/GanttFrame.tsx): outer container `h-[calc(100vh-220px)]` → `h-full min-w-0 overflow-hidden`. The fixed `220px` magic-number assumption is gone; height now comes from the parent flex chain.
- **Why the previous turn's "fixed default columnWidth" patch wasn't enough**: it correctly made the Gantt's internal content wider than its scroller, but with the broken flex chain the scroller itself was also wider than the viewport — so the only scrollbar to appear was on the body, not on the Gantt.

**Visual redesign — Instagantt-style data grid**

- **Default scale**: `useState<ViewMode>("week")` → `"day"` in [GanttFrame.tsx](frontend/src/components/gantt/GanttFrame.tsx). Day mode shows the month band on top + day numbers (just `"18"`, no day-of-week letter) on the bottom row.
- **List pane columns** ([GanttListPane.tsx](frontend/src/components/gantt/GanttListPane.tsx) + [GanttListRow.tsx](frontend/src/components/gantt/GanttListRow.tsx)): five columns now — `[◯ checkbox] [Name] [Start] [Due] [%]`. Total list pane width grows from 360px to `CHECKBOX(32) + NAME(220) + DATE(76) + DATE(76) + PCT(56) = 460px` (constants in [lib/gantt/constants.ts](frontend/src/lib/gantt/constants.ts)). Density tightened: row height `32 → 30`, padding reduced. Borders are `border-gray-200` per the spec.
- **Completion checkbox**: an interactive circular checkbox in the leftmost column for each task/subtask (sections have no checkbox). Click toggles `status` between `TODO ↔ DONE` via the existing [useUpdateTask](frontend/src/lib/queries.ts#L355-L381) mutation. Done tasks render with `line-through` on the name + filled emerald-500 check.
- **Section styling**: bold uppercase + `bg-gray-50` resting / `bg-gray-100` hover. Tasks/subtasks: `bg-white` / `bg-gray-50` hover.
- **Inline `+ Add task` per section**: a new `RowKind = "add-task"` pseudo-row is emitted from [buildRows](frontend/src/lib/gantt/geometry.ts) at the end of each non-collapsed section. The list pane renders a `+ Add task` button (only for `canEdit`); the chart pane renders an empty body row that keeps vertical alignment perfect. Click opens the existing `TaskFormModal` with `initialSectionId` pre-scoped — the create modal now accepts the sectionId from the originating row, so tasks land in the right section without manual reassignment.

**Visual redesign — bars + today marker**

- **GanttBar** ([GanttBar.tsx](frontend/src/components/gantt/GanttBar.tsx)): `rounded-full` (pill shape, was `rounded`). Fill color now driven by **status** (TODO=sky-200 / IN_PROGRESS=blue-400 / DONE=emerald-400) instead of priority. **Priority** is surfaced as a 3px left border (LOW=slate / MED=blue / HIGH=amber / URGENT=rose). Text auto-contrasts (light on dark fills, dark on the sky-200 TODO fill). IN_PROGRESS bars show a 50%-width darker overlay as a progress indicator.
- **GanttSectionBar** ([GanttSectionBar.tsx](frontend/src/components/gantt/GanttSectionBar.tsx)): rewritten from a thick rounded gray bar to the Instagantt summary look — a thin 2px slate-800 line with **downward bracket caps** (2px × 6px verticals) at both ends. Non-interactive.
- **Today marker** ([GanttTodayLine.tsx](frontend/src/components/gantt/GanttTodayLine.tsx) + [GanttDateAxis.tsx](frontend/src/components/gantt/GanttDateAxis.tsx)): the rose-500 vertical line is now centered exactly on today's column (was at the left edge) and topped with a **solid red 28px circle containing the day number in white** sitting on the date axis at the same X. The circle floats slightly above the bottom row of the axis so it reads as a marker, not part of the date label.

**Toolbar reorganization**

- The View toggle moves to the **right side** of the toolbar (relabeled `Scale: Day/Week/Month`), grouped as a segmented control. Today / Add task / Add section stay on the left. Per the user's choice in this turn, `Undo/Redo` and `Columns` buttons are **explicitly skipped** (not even rendered as placeholders) — they need real history-stack and persisted column-toggle infrastructure to be useful, deferred to a future turn. **Minimap** is also deferred (we removed `gantt-task-react` two turns ago and this would need a separate scaled-overview implementation).

**Files**

- Modified: [Shell.tsx](frontend/src/components/layout/Shell.tsx), [ProjectDetail.tsx](frontend/src/pages/ProjectDetail.tsx), [pages/views/ProjectGantt.tsx](frontend/src/pages/views/ProjectGantt.tsx), [components/gantt/GanttFrame.tsx](frontend/src/components/gantt/GanttFrame.tsx), [components/gantt/GanttBar.tsx](frontend/src/components/gantt/GanttBar.tsx), [components/gantt/GanttSectionBar.tsx](frontend/src/components/gantt/GanttSectionBar.tsx), [components/gantt/GanttTodayLine.tsx](frontend/src/components/gantt/GanttTodayLine.tsx), [components/gantt/GanttDateAxis.tsx](frontend/src/components/gantt/GanttDateAxis.tsx), [components/gantt/GanttListRow.tsx](frontend/src/components/gantt/GanttListRow.tsx), [components/gantt/GanttListPane.tsx](frontend/src/components/gantt/GanttListPane.tsx), [components/gantt/GanttRow.tsx](frontend/src/components/gantt/GanttRow.tsx), [components/gantt/GanttChartPane.tsx](frontend/src/components/gantt/GanttChartPane.tsx), [lib/gantt/constants.ts](frontend/src/lib/gantt/constants.ts), [lib/gantt/geometry.ts](frontend/src/lib/gantt/geometry.ts).
- **No new files**. **No deletions**.

**Verification**

- `npm run typecheck` passes (only pre-existing `vite.config.ts` / `tsconfig.json` config-file noise remains).
- Manual QA: `cd frontend && npm run dev` → log in `tam.charlie@solvro.local` / `password123` → `/projects/2/gantt`. Day mode is default; chart overflows the viewport horizontally and **the Gantt's own scroller** scrolls (no body horizontal scrollbar). Today marker renders as a red circle with day number on the axis + a thin red line through the chart. Click a task's circle → toggles complete and the name strikes through. Click `+ Add task` under a section → modal opens pre-scoped to that section. As `stakeholder.evan@solvro.local` (STAKEHOLDER), checkboxes are disabled and `+ Add task` rows render as empty spacer rows.

### Changed — 2026-05-02 — Gantt: drop responsive column-width entirely; always use fixed defaults so the chart overflows

- **Bug recap**: the previous turn introduced a "stretch when natural-content < available" rule. For the GCP Migration project at Day mode, natural content (40px × 38 cols = 1520px) was 4px less than available (1524px), so the stretch branch fired, columns grew to exactly fill, and the chart still didn't scroll. The "stretch when small" rule turns out to be a footgun: any project that lands within a few px of viewport width silently collapses.
- **Fix**: removed the responsive computation in [GanttFrame.tsx](frontend/src/components/gantt/GanttFrame.tsx). `columnWidth` is now just `COLUMN_DEFAULT_WIDTH[viewMode]`. Bumped defaults in [constants.ts](frontend/src/lib/gantt/constants.ts) to `{ day: 60, week: 140, month: 220 }` — wider columns are also more legible per the user's "shrunk" complaint. `scrollerWidth` state and the ResizeObserver in `GanttFrame` are deleted (no consumer left); `scrollerRef` stays for the Today button's `scrollTo`. Dropped now-unused `useEffect`, `COLUMN_MIN_WIDTH` imports.
- **Trade-off accepted**: a project too small to fill the viewport at default width will leave empty space on the right of the chart. This is honest and matches Instagantt — better than a chart that silently collapses-or-scrolls based on column-count arithmetic.
- **Day-mode axis label**: also (carried from previous turn): dropped the day-of-week letter prefix (was `"M18"`, now `"18"`). Removed the unused `DAY_NAMES` constant from [GanttDateAxis.tsx](frontend/src/components/gantt/GanttDateAxis.tsx). Weekends are visually marked via the column tint.

### Changed — 2026-05-02 — Gantt view rewritten without `gantt-task-react` (Instagantt-style two-pane layout)

- **Why**: the user wants a project-management-grade Gantt — sticky list pane that never scrolls horizontally, scrollable timeline, dual-row date axis (month band + W##/day band), section/task/subtask hierarchy with section bars spanning their children's range. `gantt-task-react@0.3.9` couldn't deliver this without continuous fights against its internal layout (we'd already had to ship a scroll-sync hack against its `_CZjuD` / `_2B2zv` CSS-module hashes earlier today). Custom render makes the architecture cleaner and unblocks future PM features.
- **Architecture (Layout C — single outer scroller + `position: sticky` panes)**: the project Gantt now mounts a single scroll container; inside, the list pane is `position: sticky; left: 0`, the date axis is `position: sticky; top: 0`, and the top-left corner pins both. Vertical scroll moves both panes together for free (one scroll context = no JS sync). Horizontal scroll moves the chart content under the sticky list. This eliminates the entire class of overlay-drift bugs we hit earlier and is the canonical "frozen first column" pattern. Notable rejection: a chart-pane-only `overflow-x: auto` + `overflow-y: visible` setup was considered but doesn't work — the CSS spec promotes `visible` to `auto` whenever the orthogonal axis is non-`visible`, breaking the outer sticky context.
- **New geometry module** [frontend/src/lib/gantt/geometry.ts](frontend/src/lib/gantt/geometry.ts): typed `ViewMode = "day" | "week" | "month"` (replaces gantt-task-react's enum), `Row` interface (`section | task | subtask`, with `depth`, `parentRowId`, `taskId`, `start`/`end`), and the math: `computeChartStart` / `computeChartEnd` (per-mode unit snap with one unit of breathing room — the legacy `-7` Week snap from gantt-task-react's `preStepsCount=1` is gone), `positionFor` (preserved verbatim from the deleted `GanttHolidayOverlay`), `dateFromX` (NEW — inverse of `positionFor`, snaps to whole days, used by drag), `iterColumns` (per-mode column iterator with weekend + week-number annotations), `buildRows` (rewritten from the deleted `buildGanttRows` to emit a flat array — section row with aggregated start/end from descendants, then parent tasks, then subtasks; orphan-subtask fallback preserved). `parseISODate`, `addDays`, `startOfDay`, `startOfMondayWeek`, `isoWeekNumber`, `fmtDateDDMM`, `fmtDateRangeDDMM`, `fmtMonthYear` colocated as helpers.
- **New constants** [frontend/src/lib/gantt/constants.ts](frontend/src/lib/gantt/constants.ts): `LIST_PANE_WIDTH = 360`, `AXIS_HEIGHT = 56` (28+28 dual-row), `ROW_HEIGHT = 32`, `BAR_HEIGHT = 22`, `RESIZE_HANDLE_PX = 6`, `COLUMN_MIN_WIDTH = { day: 36, week: 80, month: 120 }`, `NAME_COL_WIDTH = 200`, `DATES_COL_WIDTH = 160`.
- **New components** under [frontend/src/components/gantt/](frontend/src/components/gantt/):
  - `GanttFrame` — page-level shell. Owns `viewMode`, `collapsedSections`, `actionError`, `addingSection` form state. Hooks `useProjectTasks`, `useProjectSections`, `useUpdateTask`, `useCreateSection`, `useHolidays`. Memos `rows`, `dateRange`, `chartStart`, `chartEnd`, `columnCount`, `columnWidth` (responsive: fits available width with `COLUMN_MIN_WIDTH[viewMode]` floor). Renders the toolbar (View Day/Week/Month + Today + Add task + Add section), the inline Add-section form, error banner, and the scroller.
  - `GanttListPane` — sticky `left: 0`, `width: 360px`, opaque background. Internal sticky-`top: 0` header row (Name | Start → Due) at z-30; rows below at z-10.
  - `GanttListRow` — chevron+collapse for sections, depth-indent for subtasks, name button (click → modal for tasks, toggle for sections), Start/Due via `fmtDateDDMM`.
  - `GanttChartPane` — composes `GanttDateAxis`, `GanttColumnGrid`, list of `GanttRow`s, `GanttTodayLine`.
  - `GanttDateAxis` — sticky `top: 0`, dual-row. Top row: month-label spans (computed from contiguous columns sharing the same `fmtMonthYear`). Bottom row: per-mode label (`Mon01` for day, `W##` for week, `Apr` for month).
  - `GanttColumnGrid` — replaces the deleted `GanttWeekendOverlay` + `GanttHolidayOverlay`. Renders one column-divider div per column + per-day weekend/holiday tints in normal flow (no scroll-sync needed; positions are content-relative). Holiday tooltip via native `title` attribute.
  - `GanttRow` — single horizontal strip; switches to `GanttSectionBar` (kind=section) or `GanttBar` (task | subtask).
  - `GanttBar` — draggable. `pointerdown` on body → `mode="move"`; on left 6px → `resize-start`; on right 6px → `resize-end`. `setPointerCapture` + `pointermove` updates a transient `ghost` rectangle (renders bar at new position, no commit yet). On `pointerup`, if movement crossed at least one day, calls `onCommit(taskId, start, end)` which fires the existing optimistic [useUpdateTask](frontend/src/lib/queries.ts#L355-L381) mutation (instant UI update + rollback on error). Click without drag opens the task editor modal. Escape cancels mid-drag. `clientX` deltas are viewport-relative for both endpoints, so scroll position never enters the drag math. Resize-start clamps at `<= origEnd`; resize-end at `>= origStart`. Section bars don't attach drag listeners. When `!canEdit`, listeners are no-ops and resize handles aren't rendered.
  - `GanttSectionBar` — non-draggable thin gray bar with end-caps; spans aggregated descendants' range.
  - `GanttTodayLine` — `position: absolute` 1-px rose line at `positionFor(today, ...).x`; full body height; only renders if today is within `[chartStart, chartEnd]`.
- **Modified** [frontend/src/pages/views/ProjectGantt.tsx](frontend/src/pages/views/ProjectGantt.tsx): collapsed from ~750 LOC to ~37 LOC. Just `useProjectContext` + `<GanttFrame>` + the two `TaskFormModal` slots. All Gantt logic moved into `GanttFrame`.
- **Deleted** (replaced by the new architecture): `frontend/src/components/GanttHolidayOverlay.tsx`, `frontend/src/components/GanttWeekendOverlay.tsx`, `frontend/src/lib/useGanttScrollSync.ts`, `frontend/src/lib/ganttConstants.ts` (replaced by `lib/gantt/constants.ts`). The CSS-module-class-hash assumption against `gantt-task-react` is gone with them.
- **Untouched**: `gantt-task-react` is still in [frontend/package.json](frontend/package.json) (no other view imported it, but `npm uninstall` is a destructive action — leaving for a separate user call). All other views (`ProjectKanban`, `ProjectList`, `ProjectTimeline`), the server, the schema, and DESIGN.md tokens are untouched. The design-system Tailwind tokens (`surface-*`, `outline-variant`, `on-surface-variant`, etc.) drive all styling — no inline hex.
- **What v1 ships vs. defers**: list pane v1 = Name (with hierarchy + collapse) + Start/Due dates only. Progress % column and Assignee avatar are deferred per user choice. View modes (Day/Week/Month), Today button, Add task / Add section, and drag-to-reschedule (move + resize) are all kept.
- **Verification**: typecheck passes (only the pre-existing `vite.config.ts` / `tsconfig.json` config-file noise remains, unrelated to this change). Manual QA path: `cd frontend && npm run dev` → log in `tam.charlie@solvro.local` / `password123` → `/projects/2/gantt` → scroll horizontally (list stays pinned), scroll vertically (both panes scroll together), toggle Day/Week/Month, click Today, drag a bar / resize an edge, collapse a section. As `stakeholder.evan@solvro.local` (STAKEHOLDER role), bars render but resize handles are absent and drag is disabled.

### Fixed — 2026-05-02 — Gantt holiday/weekend overlays drifting when chart scrolls

- **Problem**: the rose holiday strips and gray weekend strips painted at the correct positions only at scroll=0; horizontal scrolling caused a growing visible drift between the overlays and the column headers (verified via two user screenshots of `/projects/2/gantt` taken before vs. after dragging the chart's bottom scrollbar).
- **Root cause**: in [pages/views/ProjectGantt.tsx](frontend/src/pages/views/ProjectGantt.tsx) both overlays were mounted as `position:absolute` children of the OUTER `chartContainerRef` (with a static `left: listWidth`). gantt-task-react renders its calendar SVG and task bars inside its own internal scroll container — confirmed in [node_modules/gantt-task-react/dist/index.js](frontend/node_modules/gantt-task-react/dist/index.js) at line 2117: `styles$9 = {"ganttVerticalContainer":"_CZjuD","horizontalContainer":"_2B2zv", ...}`. `._CZjuD` owns `scrollLeft` (header SVG + body inherit), `._2B2zv` (nested) owns `scrollTop` for the body. Our overlays sat on a different element, so the chart scrolled under them and they stayed pinned.
- **Why not a public API**: `gantt-task-react@0.3.9` (`dist/index.d.ts` `GanttProps`) exposes no `onScroll` or `scrollX` — `EventOption | DisplayOption | StylingOption` carry no scroll-state callback. So we have to read scroll from the DOM.
- **Fix**:
  - **New** [frontend/src/lib/ganttConstants.ts](frontend/src/lib/ganttConstants.ts): single source of truth for `GANTT_HEADER_HEIGHT = 50` (deduped — was previously duplicated in both overlay files) and the two CSS-module class hashes `GTR_HORIZONTAL_SCROLL_SELECTOR = "._CZjuD"` / `GTR_VERTICAL_SCROLL_SELECTOR = "._2B2zv"`. Comment in the file documents the grep command to re-derive on a `gantt-task-react` upgrade.
  - **New** [frontend/src/lib/useGanttScrollSync.ts](frontend/src/lib/useGanttScrollSync.ts): `useGanttScrollSync(containerRef, deps)` — finds the two scroll elements via `querySelector`, attaches `passive: true` `scroll` listeners, coalesces updates with `requestAnimationFrame`, and returns `{ x, y }`. The `deps` arg lets callers force re-binding when gantt-task-react remounts its inner SVG (task list length, viewMode, columnWidth changes — these cause new DOM nodes and the listeners need to re-attach).
  - **Modified** [frontend/src/pages/views/ProjectGantt.tsx](frontend/src/pages/views/ProjectGantt.tsx): import and call `useGanttScrollSync(chartContainerRef, [ganttTasks.length, viewMode, dynamicColumnWidth])`; pass `scrollX` / `scrollY` props to both overlays.
  - **Modified** [frontend/src/components/GanttWeekendOverlay.tsx](frontend/src/components/GanttWeekendOverlay.tsx) and [frontend/src/components/GanttHolidayOverlay.tsx](frontend/src/components/GanttHolidayOverlay.tsx): import `GANTT_HEADER_HEIGHT` from `@/lib/ganttConstants` (was a duplicated local const); add `scrollX` / `scrollY` to props; apply `transform: translate3d(${-scrollX}px, ${-scrollY}px, 0)` + `willChange: "transform"` on the overlay root. Existing `positionFor` math is unchanged — only the mount/scroll-coupling was broken.
- **Why this approach over alternatives**:
  - Portal into `_2B2zv` was rejected: that container's child is an `<svg>`, while our overlays are HTML divs — would force a bigger overlay rewrite.
  - A controlled `scrollX` prop was rejected: not exposed by gantt-task-react v0.3.9.
  - Reading from the rendered DOM after each render was rejected: scroll-listener + `transform` is cheaper (no layout reads on the hot path) and naturally keeps strict alignment because we apply the *exact* `scrollLeft` value the library writes.
- **Coupling note**: the class-hash selectors are package-version-coupled. They live in the package's bundled `index.css` (which we already import in `ProjectGantt.tsx`), so they're stable for the pinned `0.3.9`. If the lib is bumped, re-derive via `grep -E "horizontalContainer|ganttVerticalContainer" frontend/node_modules/gantt-task-react/dist/index.js` and update [ganttConstants.ts](frontend/src/lib/ganttConstants.ts).

### Changed — 2026-05-02 — CLAUDE.md refresh to match shipped implementation

- [CLAUDE.md](CLAUDE.md): refreshed via `/init` to reflect the actual built state of the repo. Preserved the existing changelog discipline, product-domain orientation, design-system rules, and known mockup/spec drift notes. Added: (1) **Common commands** section with the Docker Compose flow, host-side `npm` scripts for backend (`prisma:generate`, `prisma:migrate`, `db:seed`, `dev`, `dev:admin`, `build`, `start`, `prisma:studio`, `db:reset`) and frontend (`dev`, `typecheck`, `build`, `preview`), seeded dev credentials, and an explicit note that **no test runner / linter / formatter is wired in** (so future Claude doesn't fabricate `npm test`); (2) **Backend conventions** capturing the no-`/api/`-prefix mount pattern, the Zod-via-`env.ts` rule, the shared Prisma client singleton, the `requireAuth` + `requireRole` middleware stack, the `projectVisibilityFilter` helper as the canonical role-scoping pattern, the `validate()` middleware contract, the `HttpError` + global error-handler model, pino logging, and migration discipline (`@map` snake_case ↔ camelCase TS); (3) **Frontend conventions** capturing the `App.tsx` route tree (auth-guarded `Shell` with nested project sub-routes for list/kanban/gantt/timeline), the `frontend/src/components/layout/` shell composition, the `@/` path alias, the `apiRequest`-only fetch rule, the centralized `lib/queries.ts` TanStack Query layer, and the Tailwind theme as the runtime port of DESIGN.md frontmatter; (4) updated **target architecture** notes to mention the additional shipped models (`Customer`, `Section`, `Label`, `Comment`) and the `(projectId, version)` blueprint uniqueness; (5) revised **working on this repo** to flag that the **Secure Ingestion Port webhook is not yet implemented** and to describe the expected shape (separate auth path, transactional blueprint→tasks fanout, preserved projectId↔blueprint linkage for AI Breakdown styling).
- **Why**: the previous CLAUDE.md said "when the user asks to start building, the natural first step is scaffolding..." — but the backend (Express + Prisma + ~10 route modules + JWT/RBAC + Zod validation) and frontend (Vite + React + TanStack Query + dnd-kit + gantt-task-react + recharts + four project views) are well-built. Future Claude needs the conventions of the *existing* code (visibility filter, validate middleware, queries.ts hook layer, no-/api-prefix mount, `@/` alias) to extend it correctly, plus accurate commands so it doesn't invent ones.

### Added — 2026-05-01 — Gantt: Today button, inline add task/section, weekend shading

- **Today button** in the toolbar: scrolls the chart container to today's column with `el.scrollTo({ left, behavior: "smooth" })`. Centering math: `target = positionFor(today, chartStart, viewMode, columnWidth).x − (clientWidth − listWidth) / 2`. Reuses `positionFor` (now exported from [GanttHolidayOverlay.tsx](frontend/src/components/GanttHolidayOverlay.tsx)) so the same axis math drives both holiday placement and Today scroll.
- **Add task / Add section** buttons (TAM/ADMIN only):
  - Add task → opens the existing `TaskFormModal` in `mode="create"` with no pre-set section/parent.
  - Add section → reveals an inline form (input + Add + Cancel) below the toolbar; submits via `useCreateSection`. Mirrors the pattern in [ProjectList.tsx](frontend/src/pages/views/ProjectList.tsx) so the UX feels consistent.
- **Weekend shading**: new [components/GanttWeekendOverlay.tsx](frontend/src/components/GanttWeekendOverlay.tsx) iterates from `chartStart` to `taskDateRange.max`, picks Saturdays + Sundays, and paints them with `bg-slate-900/[0.06] mix-blend-multiply`. Rendered with `zIndex: 0` (below holidays at `z: 1`) so a holiday on a weekend reads as red, not gray. `aria-hidden`, `pointer-events-none` — purely decorative, doesn't block bar drag.

### Added — 2026-05-01 — Indonesian public holidays in the Gantt view

- **Backend dep**: added `date-holidays` to [backend/package.json](backend/package.json) (zero-runtime-config, ships full ID holiday calendar; queried by year).
- **Backend route**: [routes/holidays.ts](backend/src/routes/holidays.ts) — `GET /holidays?year=YYYY` (Zod-validated, defaults to current year, range 1970–2100). JWT-required via `requireAuth`. Returns `{ date: "YYYY-MM-DD", name, type }[]` filtered to `type === "public"`. In-process `Map<year, Holiday[]>` cache so each year is computed once per backend lifetime — holidays are static for a given year, no TTL needed. Mounted at `/holidays` in [app.ts](backend/src/app.ts) alongside other authed routes (no `/api/` prefix, matching the rest of the app).
- **Frontend hook**: `Holiday` type + `useHolidays(years: number[])` in [lib/queries.ts](frontend/src/lib/queries.ts). Uses `useQueries({ combine })` to fetch each year as a separate cache entry (24h `staleTime`) and flatten the results — so a Gantt that spans 2026–2027 makes two parallel requests, each independently cached.
- **Overlay component**: [components/GanttHolidayOverlay.tsx](frontend/src/components/GanttHolidayOverlay.tsx). Renders one absolutely-positioned `<div>` per holiday with `bg-rose-500/10` + `border-r border-rose-500/30 mix-blend-multiply`, sized and positioned per `viewMode`:
  - **Day**: `x = daysFromChartStart × columnWidth`, `width = columnWidth` (whole column tinted).
  - **Week**: `width = columnWidth / 7` (one slice of the week column).
  - **Month**: `width = columnWidth / daysInMonth` (a thin vertical strip in the month column).
  - Native `title` attribute = `"<holiday name> — <yyyy-mm-dd>"` so hover tooltip works without a tooltip lib. `pointer-events-auto` on each marker so the tooltip fires; outer wrapper is `pointer-events-none` so drag-to-reschedule is unaffected.
- **Wire-in** at [pages/views/ProjectGantt.tsx](frontend/src/pages/views/ProjectGantt.tsx):
  - New `taskDateRange` memo (min/max across all dated tasks) → `yearsCovered` array → `useHolidays(yearsCovered)`.
  - New `computeChartStart(minTaskStart, viewMode)` helper that mirrors `gantt-task-react`'s `preStepsCount=1` snap-back: Day → 1 day before; Week → previous Monday minus 7d; Month → 1st of previous month. The overlay's X math is anchored to this date.
  - Container div gains `relative` so the overlay's `absolute` positioning is scoped correctly. Overlay's `left` = `nameColWidth + datesColWidth` (the list panel) so markers only paint inside the chart pane, never under the list.
  - Overlay only renders when at least one holiday and a non-null `chartStart` exist; on view-mode swap or column-width drag, the X positions recompute via dependent `useMemo`s.
- **Why**: requested by user. Indonesian TAMs need to see holidays inline with task bars so they don't schedule work on `Hari Kemerdekaan` etc. Library has no native non-working-days API, so we recompute the date axis ourselves and overlay markers — small drift risk if `gantt-task-react` ever changes its `preStepsCount` default, mitigated by visual smoke-test in the verification block.

### Added — 2026-05-01 — Project context: right-side slideover (`RightSidebar`)

- **New** [components/layout/RightSidebar.tsx](frontend/src/components/layout/RightSidebar.tsx): a 320px (`w-80`) glassmorphic panel pinned to the right edge of the viewport (`fixed right-0 top-16 bottom-0 z-30 border-l border-outline-variant bg-surface-container-low/95 backdrop-blur-md`). Slides in/out via `transform translate-x-0 ↔ translate-x-full` with a 200ms ease-out transition.
  - **Project Context header**: small uppercase `PROJECT CONTEXT` title, then `SOLV-NNN` ID next to a status badge tinted by `ProjectStatus` (PLANNING amber / ACTIVE primary blue / ON_HOLD slate / COMPLETED emerald / CANCELLED rose). Project name + description below.
  - **Blueprint Reference** card: bordered `surface-container-lowest` block with a filled `schema` material icon, the version string (default `SA Blueprint v2.4`, override via prop), a one-line caption, and a `View source documentation` link with `open_in_new` icon. URL defaults to `https://docs.solvro.dev/blueprints/v2.4` and is overridable via `blueprintDocsUrl`.
  - **Stakeholders** mini-table: TAM, SA, Customer (when present), task count.
  - Close button (`×`) calls `onClose`.
- [pages/ProjectDetail.tsx](frontend/src/pages/ProjectDetail.tsx) integration:
  - Local `contextOpen` state (default `true`) — visible-by-default per the DESIGN.md tri-panel layout, still toggleable.
  - Outer container gets a dynamic right margin (`mr-80` when open, `mr-0` when closed) with `transition-[margin] duration-200 ease-out` so the main canvas resizes alongside the panel rather than being overlapped.
  - New **Context** toggle button in the project header (next to `Edit project`), icon swaps between `right_panel_close` / `right_panel_open` and styled with `border-primary bg-primary/10 text-primary` when active.
- **Why**: requested by user. Surfaces project metadata + blueprint linkage without leaving the project page; keeps the main table/Kanban/Gantt/Timeline canvas as the focal area while letting context recede.

### Changed — 2026-05-01 — Sidebar: collapsible icon rail + slideover panel

- **New** [components/layout/SidebarContext.tsx](frontend/src/components/layout/SidebarContext.tsx): tiny context (`open`, `toggle`, `close`) shared between `Sidebar`, `Shell`, and any consumer that needs sidebar state.
- [components/layout/Sidebar.tsx](frontend/src/components/layout/Sidebar.tsx): rewritten as a fixed left rail.
  - **Collapsed (default)**: 64px wide (`w-16`), icons only. Each `NavLink` becomes a centered 40×40 hit target with a `title` tooltip showing the label. Brand block hidden; only the menu/expand button remains in the header.
  - **Expanded**: animates to `w-sidebar` (260px) revealing labels, brand mark, and "Backend: UP" pill. A **backdrop** (`fixed inset-0 z-40 bg-black/40 backdrop-blur-[1px]`) renders behind the sidebar; clicking it closes the panel. Clicking any nav link also closes (so navigation feels like a slideover dismiss).
  - Icon swap on the toggle: `menu` ↔ `menu_open`.
  - `transition-[width] duration-200 ease-out` so the slide is smooth.
- [components/layout/Shell.tsx](frontend/src/components/layout/Shell.tsx): wraps the page in `SidebarProvider`. Main content now uses a fixed `ml-16` regardless of sidebar state — so the open panel **slides over** the content rather than pushing it (true slideover).
- [components/layout/TopBar.tsx](frontend/src/components/layout/TopBar.tsx): switched `ml-sidebar` → `ml-16` to match the new rail width and dropped its z-index from `z-40` → `z-30` so the sidebar's backdrop (`z-40`) and panel (`z-50`) layer correctly over it.
- **Why**: user requested a slideover sidebar with only icons visible when closed. Replaces the previous always-expanded 260px sidebar.

### Changed — 2026-05-01 — Project Gantt view: full-screen, section-grouped, drag-editable

- [pages/views/ProjectGantt.tsx](frontend/src/pages/views/ProjectGantt.tsx): rewrote to mirror the Asana-style layout in the List view.
  - **Section grouping**: pulls `useProjectSections` and synthesizes a `type: "project"` row per section (auto-spanning min(start)…max(end) of its tasks). Tasks inside link via `project: "sec-{id}"`. A `(No section)` group catches tasks without a section.
  - **Subtasks**: rendered immediately after their parent within the section, name prefixed with `↳ ` so the indentation reads visually. Orphan subtasks (parent dateless or in another section) still show under their own section.
  - **Editable**: `onDateChange` calls `useUpdateTask` with `startDate` + `dueDate` (ISO) so dragging the bar moves the window and dragging an edge resizes it. Section rows have `isDisabled: true`. Errors surface in a banner above the chart.
  - **Click name → editor**: removed the bar-`onSelect` handler so dragging a bar only reschedules. Clicking the **task name** in the left list opens `TaskFormModal`; clicking a **section name** toggles its collapse. Custom `TaskListHeader` + `TaskListTable` props render the left column with our typography and explicit click targets, so the timeline bar is drag-only.
  - **Dates column**: the custom list now has two sub-columns (`Name` 200px + `Dates` 110px). Dates render as `dd Mmm – dd Mmm` (e.g. `01 May – 05 May`) in `font-mono`. Section rows display the auto-spanning range of their child tasks.
  - **Resizable columns**: each column header has a `ResizeHandle` (1px wide, full-height, `cursor-col-resize`) at its right edge. Drag to resize Name (clamped 120–480px) or Dates (clamped 80–240px). The total list width is fed back into `listCellWidth={(name+dates)/3}px` so the chart panel still starts in the right place. Width state lives in `ProjectGantt` so it survives HMR but resets on remount — fine for now.
  - **Collapsible sections**: `onExpanderClick` toggles `hideChildren` per section row, mirroring the List view's collapse behavior.
  - **View-mode toggle**: Day / Week / Month buttons in the toolbar.
  - **Dynamic columnWidth**: a `ResizeObserver` on the chart wrapper feeds its width into a `useMemo` that estimates column count from the task date range (days for Day mode, weeks for Week, months for Month) and computes `columnWidth = floor((containerWidth - listWidth - 16) / cols)`, clamped to a per-mode minimum (Day 36 / Week 60 / Month 120). Whenever the viewport, sidebar, or column widths change, the chart fills the available canvas instead of leaving whitespace on the right.
  - **Fills the screen**: outer container is `h-[calc(100vh-220px)] min-h-[420px] flex flex-col`, with the Gantt itself inside `flex-1 overflow-auto`. No more squashed 200px box.
  - Custom `TooltipContent` shows title + start–end range in the project's typography.
  - Bar fill still tinted by priority (LOW/MED/HIGH/URGENT); progress bar still keyed off status (TODO 0% / IN_PROGRESS 50% / DONE 100%).
- **Why**: previous Gantt was a fixed-height widget with no sectioning and no editing. User asked for an Asana-style Gantt that fills the canvas, groups by section, and supports drag/resize for rescheduling.

### Changed — 2026-05-01 — Project List view: due date column → start–due range

- [pages/views/ProjectList.tsx](frontend/src/pages/views/ProjectList.tsx): renamed the rightmost column from "Due date" to "Start – Due" and widened it from `140px` to `220px` (header + `TaskRow` + `SubtaskRow` + "Add subtask…" grid templates) to fit two formatted dates side-by-side.
- New `fmtRange(start, end)` helper renders all four cases: `May 1 – May 20` (both), `May 1 – —` (start only), `— – May 20` (due only), `—` (neither). Replaces the per-row `fmt(task.dueDate)` call site for both top-level and subtask rows.
- `overdue` styling logic unchanged — still keyed on `dueDate < today && status !== "DONE"`. The "· OVERDUE" suffix on top-level rows is preserved.
- **Why**: surfaces both ends of a task's window in the List view (matches how Gantt/Timeline already render). User saw a single date and asked to expose the range.

### Added — 2026-05-01 — Project List view (Asana-style sections + tasks + subtasks)

- **Schema** ([backend/prisma/schema.prisma](backend/prisma/schema.prisma)) and migration `20260501040932_add_sections`:
  - New `Section` model: `id`, `projectId` FK with `onDelete: Cascade`, `name`, `position Int @default(0)`, `createdAt`. Index `@@index([projectId])`.
  - `Task.sectionId Int?` (nullable) with `onDelete: SetNull` — deleting a section keeps the tasks but clears the link. Tasks with `sectionId === null` render under a synthetic "(No section)" group at the bottom.
  - Back-relation `Project.sections: Section[]`.
  - Index `@@index([sectionId])` on `tasks` for filter performance.
- **Backend routes**:
  - New [routes/sections.ts](backend/src/routes/sections.ts): `PATCH /sections/:id` (rename / reorder), `DELETE /sections/:id`. TAM/ADMIN only.
  - [routes/projects.ts](backend/src/routes/projects.ts): added nested `GET /projects/:id/sections` (any auth) and `POST /projects/:id/sections` (TAM/ADMIN). New section auto-positions to `max(position) + 1`. `createTaskSchema` accepts optional `sectionId`. `GET /projects/:id/tasks` and `POST /projects/:id/tasks` responses include `section: { id, name, position }`.
  - [routes/tasks.ts](backend/src/routes/tasks.ts): `updateTaskSchema` accepts `sectionId`; PATCH connects/disconnects via Prisma relation update. Response includes section.
  - [app.ts](backend/src/app.ts): mounted `/sections` router.
- **Frontend types + hooks** ([lib/queries.ts](frontend/src/lib/queries.ts)):
  - New `Section` type. `Task` now has `sectionId` and `section: { id, name, position } | null`.
  - `CreateTaskInput` / `UpdateTaskInput` accept `sectionId`.
  - New hooks: `useProjectSections`, `useCreateSection`, `useUpdateSection`, `useDeleteSection`. `queryKeys.projectSections(id)`.
- **Project detail tab** ([pages/ProjectDetail.tsx](frontend/src/pages/ProjectDetail.tsx)) — added **List** as the first tab. Default landing route changed from `kanban` to `list` ([App.tsx](frontend/src/App.tsx) project-detail `<Route index>`).
- **ProjectList page** ([pages/views/ProjectList.tsx](frontend/src/pages/views/ProjectList.tsx)) — Asana-style grouped table (matches user's reference screenshot):
  - Toolbar: "Add task" (creates a top-level task with no section) and "Add section" (inline form), task/section counts on the right.
  - Column headers: `# / Name / Assignee / Due date` (with a chevron column for subtask expand).
  - Sections render as collapsible blocks (chevron toggle) with rename (inline form) and delete buttons (TAM/ADMIN, with confirm). Each section ends with an inline "Add task..." button that opens `TaskFormModal` with `initialSectionId` pre-set.
  - Tasks: clickable round status checkbox (toggles DONE/TODO via existing `useUpdateTask` optimistic update), title click opens `TaskFormModal` in edit mode, subtask count badge.
  - Subtasks render indented under the parent (expand chevron only enabled when subtasks exist). Inline "Add subtask…" button per expanded task opens `TaskFormModal` with `initialParentTaskId` + same `initialSectionId`.
  - Overdue due dates display in red bold (matches Kanban + Timeline overdue rule).
  - "(No section)" synthetic group catches tasks without a section assignment so legacy tasks remain visible.
- **TaskFormModal** ([components/TaskFormModal.tsx](frontend/src/components/TaskFormModal.tsx)) — added a **Section** dropdown field in the right sidebar (between Parent task and Labels). Accepts `initialSectionId` in create mode for inline-from-section flows.

### Added — 2026-05-01 — Customers tab + customer mapping & filtering

- **Schema** ([backend/prisma/schema.prisma](backend/prisma/schema.prisma)) and migration `20260501035712_add_customer_model_and_link_projects`:
  - New `Customer` model: `id`, `name @unique`, `contactName?`, `contactEmail?`, `industry?`, `website?`, `notes? @db.Text`, `createdAt`. Back-relation `projects: Project[]`.
  - `Project.customerId Int? @map("customer_id")` with `onDelete: SetNull` — linking a project to a customer is **required at the API/UI layer**, but the column is **nullable in the DB** so existing pre-customer projects survive the migration without a backfill. Index `@@index([customerId])` for filter performance.
  - Why nullable in DB but required in app: enforces "customer required" for new/edited projects from day one without forcing a synthetic "Unassigned" customer to backfill historical rows. Pre-existing rows show `—` until reassigned through the UI.
- **Backend routes**:
  - New [routes/customers.ts](backend/src/routes/customers.ts): `GET /customers` (auth, includes `_count.projects`), `GET /customers/:id` (with linked projects), `POST/PATCH/DELETE` (TAM/ADMIN).
  - [routes/projects.ts](backend/src/routes/projects.ts): `createProjectSchema` makes `customerId` **required** via `z.number().int().positive()` (returns 400 `validation_error` when missing). `updateProjectSchema` accepts optional `customerId`. `GET /projects?customerId=` filters; response includes `customer: { id, name }`. `GET /projects/:id` includes the customer.
  - [routes/tasks.ts](backend/src/routes/tasks.ts): cross-project `GET /tasks` accepts `?customerId=` (filters via `project.customerId`); response shape adds `project.customer` so cards/rows can show the customer name.
  - [app.ts](backend/src/app.ts): mounted `/customers` router (before `/projects`).
- **Frontend types + hooks** ([lib/queries.ts](frontend/src/lib/queries.ts)):
  - New `CustomerSummary`, `CustomerDetail` types. Existing `ProjectSummary`/`ProjectDetail` gain `customerId` and `customer: { id, name } | null`. `TaskWithProject.project` includes the nested customer.
  - `TasksFilter` and new `ProjectsFilter` add `customerId`. `useProjects(filter)` accepts a customer filter; `useTasks(filter)` likewise.
  - New hooks: `useCustomers`, `useCustomer(id)`, `useCreateCustomer`, `useUpdateCustomer`, `useDeleteCustomer`. `queryKeys.projects` is now a function of filter (still backwards-compatible for invalidations via the `["projects"]` prefix).
  - `CreateProjectInput.customerId` is now **required** in the TS type (matches backend).
- **New components** under [frontend/src/components/](frontend/src/components/):
  - `CustomerFormModal.tsx` — create/edit modal with name (required), contact name/email, industry, website, notes.
- **Customers page** at [frontend/src/pages/Customers.tsx](frontend/src/pages/Customers.tsx) — card grid, "New Customer" CTA (TAM/ADMIN), inline Edit + Delete on each card with confirm prompt, "N projects" link that deep-links to `/projects?customerId=<id>`. Empty state with CTA.
- **ProjectFormModal** ([frontend/src/components/ProjectFormModal.tsx](frontend/src/components/ProjectFormModal.tsx)) — added **required Customer dropdown** as a top-level field (above SA + Status). Empty-state hint when no customers exist ("Create one in the Customers tab first"). Submit blocks with "Customer is required." until selected.
- **Projects page** ([frontend/src/pages/Projects.tsx](frontend/src/pages/Projects.tsx)) — new customer filter toolbar; reads `?customerId=` from URL (so customer cards' "N projects" links land filtered). Each project card now shows the customer name with a `business` icon. Header subtitle reflects active filter ("Filtered by customer: …").
- **Tasks page** ([frontend/src/pages/Tasks.tsx](frontend/src/pages/Tasks.tsx)) — added Customer filter to the toolbar (alongside status/priority/assignee).
- **Sidebar** ([frontend/src/components/layout/Sidebar.tsx](frontend/src/components/layout/Sidebar.tsx)) — new **Customers** nav item with `business` icon, placed between Projects and Tasks. [TopBar.tsx](frontend/src/components/layout/TopBar.tsx) adds the "Customers" page title.
- **Routing** ([App.tsx](frontend/src/App.tsx)) — registered `/customers` inside the AuthGuard'd Shell.

### Added — 2026-05-01 — Enterprise PM features (priority, dueDate, subtasks, labels, comments, full task editor)

- **Schema** ([backend/prisma/schema.prisma](backend/prisma/schema.prisma)) and migration `20260501033712_add_task_pm_fields_subtasks_labels_comments`:
  - New `enum Priority { LOW MEDIUM HIGH URGENT }`.
  - `Task`: **renamed `endDate` → `dueDate`** (column `end_date` → `due_date`); added `priority Priority @default(MEDIUM)` (existing rows backfill to MEDIUM via column default); added `parentTaskId Int?` self-FK with `onDelete: Cascade`; added `labels Label[]` (Prisma implicit M2M) and `comments Comment[]`. Indexes on `priority`, `dueDate`, `parentTaskId`.
  - New `Label` model: project-scoped (`@@unique([projectId, name])`), `color` defaults `#0058be`. Cascades on project delete.
  - New `Comment` model: append-only, `body @db.Text`, `authorId` FK to User, indexes on `taskId` and `authorId`.
  - Back-relations on `User.comments` and `Project.labels`.
- **Backend routes**:
  - [routes/projects.ts](backend/src/routes/projects.ts): `createTaskSchema` accepts `priority`, `dueDate` (renamed), `parentTaskId`, `labelIds`. `GET /projects/:id/tasks` includes `assignedTo`, `labels`, `_count.{subtasks,comments}`. New nested `GET/POST /projects/:id/labels`.
  - [routes/tasks.ts](backend/src/routes/tasks.ts): `updateTaskSchema` mirrors create with the same renames + `labelIds` (uses Prisma `set:` to replace label set). New `GET /tasks` cross-project endpoint with filters `?status=, ?priority=, ?assignedToId=, ?labelId=, ?overdue=true, ?topLevel=true`. New `GET/POST /tasks/:id/comments` (any auth user with task visibility can post).
  - New [routes/labels.ts](backend/src/routes/labels.ts): `PATCH /labels/:id` and `DELETE /labels/:id` for TAM/ADMIN.
  - [app.ts](backend/src/app.ts): mounted `/labels` router. Exported `projectVisibilityFilter` from projects.ts so the cross-project tasks endpoint shares the role-scope rule.
- **Frontend types + hooks** ([lib/queries.ts](frontend/src/lib/queries.ts)):
  - Added `Priority`, `Label`, `Comment`, `TaskWithProject`, `TasksFilter` types.
  - `Task` now has `priority`, `dueDate`, `parentTaskId`, `labels[]`, `_count.{subtasks,comments}`.
  - New hooks: `useTasks(filter)`, `useProjectLabels`, `useCreateLabel`, `useDeleteLabel`, `useComments`, `useAddComment`. `useUpdateTask` extended to invalidate cross-project task queries on settle.
- **Reusable components** under [frontend/src/components/](frontend/src/components/):
  - `PriorityBadge.tsx` — colored dot pill (LOW/MEDIUM grey, HIGH amber, URGENT red).
  - `AssigneeAvatar.tsx` — initials circle with `title` tooltip; size variants xs/sm/md; renders dashed-border placeholder for unassigned.
  - `LabelChip.tsx` — pill with auto-contrasted (black/white) text against `label.color`.
  - `LabelPicker.tsx` — multi-select with inline "+ Label" affordance (name + 8-color palette swatch).
  - `CommentThread.tsx` — fetches/renders comments with author avatar + relative timestamps; textarea+Post form with optimistic refetch.
  - `TaskFormModal.tsx` — the new core editor (3-col layout, `max-w-3xl`). Modes: `create` (takes `initialStatus` + `initialParentTaskId`) and `edit` (takes `task`). Sidebar fields: status (edit only), priority, start/due dates (`<input type="date">`), assignee, parent task, labels. Inline subtask checklist + `<CommentThread>` render only in edit mode. Validates title-required + dueDate≥startDate + cannot self-parent.
- **Removed**: `components/AddTaskInline.tsx` — replaced by `TaskFormModal` in create mode (Linear/Jira-style full-form path).
- **Kanban** ([pages/views/ProjectKanban.tsx](frontend/src/pages/views/ProjectKanban.tsx)): cards now show label chips (max 3 + `+N`), priority badge + assignee avatar, **red overdue due-date pill** when `dueDate < today && status !== "DONE"`, subtask progress (`✓ 2/5`) and comment count (`💬 3`). Clicking a card (without dragging) opens the editor. Top-level tasks only on the board; subtasks live inside their parent's edit modal. "+ Add task" per column opens the modal in create mode with that column's status.
- **Timeline** ([pages/views/ProjectTimeline.tsx](frontend/src/pages/views/ProjectTimeline.tsx)): sort by startDate → dueDate → priority. Each row shows priority badge, label chips, assignee avatar, overdue-styled date range. Subtasks render as an indented checklist under the parent. Click title → editor.
- **Gantt** ([pages/views/ProjectGantt.tsx](frontend/src/pages/views/ProjectGantt.tsx)): all `endDate` references renamed to `dueDate`. Tasks with subtasks render as `gantt-task-react` `type: "project"`; subtasks as nested `type: "task"` referencing the parent. Bar background tinted by **priority** (URGENT=red, HIGH=amber, MEDIUM=blue, LOW=slate).
- **Tasks tab** ([pages/Tasks.tsx](frontend/src/pages/Tasks.tsx)): replaced placeholder with a real cross-project list. Filter toolbar (status / priority / assignee / overdue / top-level only) and dense sortable table (ID · Title · Project · Labels · Priority · Assignee · Due · Status). Click row → opens editor. Project name links to its detail page.
- **Reports** ([pages/Reports.tsx](frontend/src/pages/Reports.tsx)): added second pie chart for **priority distribution** (per-project scope only — global priority counts aren't on `/overview`). Status pie remains.
- **Vite types**: created [frontend/src/vite-env.d.ts](frontend/src/vite-env.d.ts) with `declare module "*.css"` to silence the TS warning on the `gantt-task-react/dist/index.css` side-effect import.

### Changed — 2026-05-01

- **Backend container restart required after Prisma migration** (in addition to the named-volume `npm install` quirk noted earlier): `tsx watch` reloads on source changes but holds the previously-imported `PrismaClient` in memory. After `prisma migrate dev` regenerates `node_modules/@prisma/client`, the running process keeps using the old client and queries the renamed-away column (`tasks.end_date`) until the container is restarted. Workflow: `docker compose exec backend npx prisma migrate dev …` → `docker compose restart backend`.

### Added — 2026-05-01 — Project management (create/edit, Kanban, Gantt, Timeline, Reports)

- **Frontend deps** ([frontend/package.json](frontend/package.json)):
  - `@dnd-kit/core@^6.1.0` — Kanban drag-and-drop primitive (lighter and more accessible than `react-beautiful-dnd`).
  - `gantt-task-react@^0.3.9` — Gantt visualization (React 18 compatible; chosen over `frappe-gantt-react` for active maintenance).
  - `recharts@^2.13.0` — pie chart for Reports.
- **Reusable UI primitives**:
  - [components/Modal.tsx](frontend/src/components/Modal.tsx) — portal-based modal with backdrop click + Escape close, body-scroll lock.
  - [components/StatusChip.tsx](frontend/src/components/StatusChip.tsx) — `ProjectStatusChip` and `TaskStatusChip` factored out for reuse across Overview, Projects, Kanban, Timeline, Reports.
  - [components/ProjectFormModal.tsx](frontend/src/components/ProjectFormModal.tsx) — used for **both** create and edit. Validates name+saId required; ADMINs can pick the TAM, otherwise the current user is auto-assigned. Calls `POST /projects` or `PATCH /projects/:id` via TanStack Query mutations.
  - [components/AddTaskInline.tsx](frontend/src/components/AddTaskInline.tsx) — per-Kanban-column "Add task" input that POSTs to `/projects/:id/tasks` with the column's status pre-set.
- **Data hooks** in [lib/queries.ts](frontend/src/lib/queries.ts):
  - Queries: `useUsers`, `useProjects`, `useProject(id)`, `useProjectTasks(id)`, `useOverview` (existed).
  - Mutations: `useCreateProject`, `useUpdateProject`, `useCreateTask`, **`useUpdateTask`** (with optimistic update + rollback on error — drives Kanban drag-drop snappiness).
  - Centralized `queryKeys` for invalidation.
- **Projects page** ([pages/Projects.tsx](frontend/src/pages/Projects.tsx)) — replaces the placeholder. Card grid (3-up at xl, 2-up at sm), each card click-throughs to `/projects/:id`. "+ New Project" button (visible to TAM/ADMIN) opens the modal. Empty state with primary CTA.
- **Project detail** ([pages/ProjectDetail.tsx](frontend/src/pages/ProjectDetail.tsx)) now fetches the real project, renders a header (SOLV-ID + name + status chip + description + TAM/SA/task count), and exposes an **Edit project** button (TAM/ADMIN) that opens the same `ProjectFormModal` in edit mode. Tabs (Kanban / Gantt / Timeline) pass the project to nested views via `Outlet context`.
- **Kanban view** ([pages/views/ProjectKanban.tsx](frontend/src/pages/views/ProjectKanban.tsx)):
  - Three columns: To Do · In Progress · Done.
  - `@dnd-kit/core` `DndContext` + `useDraggable` (cards) / `useDroppable` (columns). PointerSensor with 6px activation distance to avoid accidental drags on click.
  - Drop fires `useUpdateTask.mutate({ id, patch: { status } })` → `PATCH /tasks/:id` → optimistic UI update, rollback on server error, refetch on settle.
  - Stakeholders see read-only cards; TAM/ADMIN can drag and use the inline "Add task" input per column.
- **Gantt view** ([pages/views/ProjectGantt.tsx](frontend/src/pages/views/ProjectGantt.tsx)) — `gantt-task-react` rendering tasks with `startDate`/`endDate`. Progress derived from status (`TODO=0, IN_PROGRESS=50, DONE=100`). Bar color tinted by status. Tasks lacking dates show an explanatory empty state instead of being silently dropped.
- **Timeline view** ([pages/views/ProjectTimeline.tsx](frontend/src/pages/views/ProjectTimeline.tsx)) — chronological vertical timeline (sorted by `startDate`, then id) with status dot indicator and inline status pills (TAM/ADMIN can change status directly per PRD §4.6).
- **Reports page** ([pages/Reports.tsx](frontend/src/pages/Reports.tsx)) — replaces the placeholder. Scope selector (All projects / specific project), `recharts` donut PieChart of TODO/IN_PROGRESS/DONE counts, plus a side panel with Completion % (= done / total), in-progress count, and backlog count. Uses `useOverview` for global stats and `useProjectTasks(id)` for per-project drill-down.

### Changed — 2026-05-01

- **Frontend `node_modules` volume re-synced**: after adding new deps, ran `docker compose exec frontend npm install` to populate `solvro_frontend_node_modules`, then `docker compose restart frontend` so Vite re-optimized. Same workflow as backend, documented earlier under Iteration 3 caveats.

### Added — 2026-05-01 — Overview tab

- **Sidebar** ([frontend/src/components/layout/Sidebar.tsx](frontend/src/components/layout/Sidebar.tsx)) now leads with **Overview** (`dashboard` icon), matching the first item in the [solvro_command_center_updated_branding](UI Design/solvro_command_center_updated_branding/code.html) mockup. Order: Overview → Projects → Tasks → Reports.
- **Overview page** at [frontend/src/pages/Overview.tsx](frontend/src/pages/Overview.tsx). Four stat cards (Projects total, Tasks In Progress, Tasks To Do, Completion %) plus two panels: Recent Projects (last 5 by `updatedAt`, click-through to `/projects/:id`) and Recent Tasks (last 5). Loading skeleton + error state included.
- **Backend `GET /overview`** ([backend/src/routes/overview.ts](backend/src/routes/overview.ts)) — JWT-gated, role-scoped (ADMIN/STAKEHOLDER see all; TAM filters by `tamId`; SA by `saId`). Returns `{ projectCount, projectStatusCounts, taskCounts, recentProjects, recentTasks }`. Wired into [app.ts](backend/src/app.ts) router mount table.
- **TanStack Query hook** [`useOverview`](frontend/src/lib/queries.ts) — first proper data layer; types for `OverviewResponse`, `OverviewProject`, `OverviewTask` defined in the same file.

### Changed — 2026-05-01

- **Default authenticated landing route** is now `/overview` (was `/projects`). Updated in [App.tsx](frontend/src/App.tsx) (root `<Route index>`) and [Login.tsx](frontend/src/pages/Login.tsx) (`from` fallback).
- **TopBar title** ([frontend/src/components/layout/TopBar.tsx](frontend/src/components/layout/TopBar.tsx)) now reflects the active route segment (Overview / My Projects / Tasks / Reports) instead of the static "My Projects" label.

### Added — 2026-05-01

- **CHANGELOG.md** created as the canonical change-history / configuration document source.
- **CLAUDE.md** updated with a "Changelog discipline (mandatory)" section so future Claude Code sessions in this repo append to CHANGELOG.md on every code/config/schema/dep/Docker change.

### Fixed — 2026-05-01

- **Backend no longer crashes on async route errors.** The first `prisma.user.findUnique` against an unmigrated database threw a `PrismaClientKnownRequestError`; Express 4 does not auto-forward async rejections, so the unhandled rejection killed the Node process and `tsx watch` did not restart it. Added [`express-async-errors`](https://www.npmjs.com/package/express-async-errors) (^3.1.1) and imported it as the first line of [backend/src/app.ts](backend/src/app.ts:1) so async errors flow into the central [errorHandler](backend/src/http/errors.ts).
- **Database initialized.** Ran first migration (`migrations/20260501024905_init`) inside the backend container — `public.users` and friends now exist; seed and temp-admin script work end-to-end.

### Changed — 2026-05-01

- **Backend container `node_modules` workflow noted.** The `solvro_backend_node_modules` named volume in [docker-compose.yml](docker-compose.yml) shadows the image's `/app/node_modules`, so adding a new dep requires either `docker compose exec backend npm install` (to populate the volume) or removing the volume before `docker compose up --build`. Documented here because the symptom (`Cannot find package …`) is non-obvious.

### Added — 2026-05-01 — Iteration 3: Full Docker stack + temp admin

- **Express backend (TAM-side).** New `backend/src/` tree:
  - Boot: [index.ts](backend/src/index.ts), [app.ts](backend/src/app.ts), [env.ts](backend/src/env.ts) (Zod-validated; requires `JWT_SECRET` ≥ 32 chars), [prisma.ts](backend/src/prisma.ts) singleton, [logger.ts](backend/src/logger.ts) pino instance.
  - Middleware: [http/auth.ts](backend/src/http/auth.ts) (JWT sign/verify, `requireAuth`, `requireRole`), [http/errors.ts](backend/src/http/errors.ts) (`HttpError`, error mapper for `ZodError` and `Prisma.PrismaClientKnownRequestError`), [http/validate.ts](backend/src/http/validate.ts) (Zod source validator).
  - Routes: [health](backend/src/routes/health.ts), [auth](backend/src/routes/auth.ts) (`POST /auth/login`, `GET /auth/me`), [users](backend/src/routes/users.ts), [projects](backend/src/routes/projects.ts) (CRUD + nested `/projects/:id/tasks`, role-scoped visibility), [tasks](backend/src/routes/tasks.ts) (PATCH/DELETE).
  - Mount order: helmet → cors → pino-http → json → routes → 404 → error mapper.
- **Backend deps** (in [backend/package.json](backend/package.json)): `express`, `cors`, `helmet`, `jsonwebtoken`, `pino`, `pino-http`, `zod` + `@types/*` for express/cors/jsonwebtoken. Scripts: `dev` (`tsx watch src/index.ts`), `build`, `start`, `dev:admin`.
- **Temporary admin script** at [backend/scripts/create-temp-admin.ts](backend/scripts/create-temp-admin.ts). Idempotent upsert keyed on `admin@solvro.local`; sets username `admin`, password `admin` (bcrypt). Run via `docker compose exec backend npm run dev:admin`. **Not** part of the seed — `npm run db:seed` reverts it to `password123`.
- **Docker images** for backend and frontend:
  - [backend/Dockerfile](backend/Dockerfile) — Node 20 slim, `openssl` for Prisma engines, `prisma generate` baked at build, `npm run dev` (tsx watch) at runtime.
  - [frontend/Dockerfile](frontend/Dockerfile) — Node 20 slim, Vite dev server with `--host 0.0.0.0` so the container is reachable from the host.
  - [.dockerignore](backend/.dockerignore) for both projects.
- **Compose stack** ([docker-compose.yml](docker-compose.yml)): added `backend` (port 3000, `depends_on: postgres { condition: service_healthy }`) and `frontend` (port 5173, `depends_on: backend`). Source bind-mounted on both for HMR; named volumes `solvro_backend_node_modules` / `solvro_frontend_node_modules` keep host/container Linux ABI separate.
- **Env additions** in [.env.example](.env.example): `JWT_SECRET`, `JWT_EXPIRES_IN` (default `8h`), `CORS_ORIGIN` (default `http://localhost:5173`), `LOG_LEVEL` (default `info`), `VITE_API_BASE_URL` (default `http://localhost:3000`).
- **Lockfiles generated** for both projects (`backend/package-lock.json`, `frontend/package-lock.json`) — required by `npm ci` inside both Dockerfiles.

### Added — 2026-05-01 — Iteration 2: Frontend scaffold

- **Vite + React 18 + TypeScript** under [frontend/](frontend/). Build: `vite`, `@vitejs/plugin-react`. Routing: `react-router-dom@6`. Server state: `@tanstack/react-query@5`. Styling: `tailwindcss@3`, `postcss`, `autoprefixer`.
- **Tailwind theme** ([frontend/tailwind.config.ts](frontend/tailwind.config.ts)) ports the [DESIGN.md](DESIGN.md) frontmatter as canonical tokens (primary `#0058be`, full surface palette, radius scale, Space Grotesk + Inter, sidebar/context-panel widths). **Deliberately diverges** from the static mockups under [UI Design/](UI Design/), whose inline Tailwind configs use defaults — see [CLAUDE.md](CLAUDE.md) "Known design drift."
- **Auth plumbing**:
  - [src/lib/api.ts](frontend/src/lib/api.ts) — typed `fetch` wrapper, attaches `Authorization: Bearer <jwt>` from `localStorage`, throws `ApiError` with `status` + parsed body.
  - [src/lib/auth.tsx](frontend/src/lib/auth.tsx) — `AuthProvider` + `useAuth`. `login()` POSTs to `${VITE_API_BASE_URL}/auth/login`; persists `token` and `user` in `localStorage`.
  - [src/components/AuthGuard.tsx](frontend/src/components/AuthGuard.tsx) — gates protected routes, redirects to `/login` preserving `from`.
- **Layout shell**: [Sidebar.tsx](frontend/src/components/layout/Sidebar.tsx) (260px dark slate, links: Projects / Tasks / Reports), [TopBar.tsx](frontend/src/components/layout/TopBar.tsx) (search + user menu with logout), [Shell.tsx](frontend/src/components/layout/Shell.tsx) composes them around `<Outlet />`.
- **Routes** ([App.tsx](frontend/src/App.tsx)):
  - Public: `/login`.
  - Protected: `/projects`, `/projects/:id` (tabbed `ProjectDetail` with nested `/kanban`, `/gantt`, `/timeline`), `/tasks`, `/reports`. `/` redirects to `/projects`.
- **Pages**: [Login.tsx](frontend/src/pages/Login.tsx) (email + password form, distinguishes invalid-creds vs network errors), placeholder bodies for [Projects](frontend/src/pages/Projects.tsx), [Tasks](frontend/src/pages/Tasks.tsx), [Reports](frontend/src/pages/Reports.tsx), [ProjectDetail](frontend/src/pages/ProjectDetail.tsx), and the three view stubs under [pages/views/](frontend/src/pages/views/).
- Project detail explicitly supports **Kanban + Gantt + Timeline** as nested routes (Table view dropped per scope correction).

### Added — 2026-05-01 — Iteration 1: Foundation

- **Postgres 15 service** in [docker-compose.yml](docker-compose.yml) — `postgres:15-alpine`, named volume `solvro_pgdata`, healthcheck via `pg_isready`, env-driven via `${POSTGRES_USER}` etc.
- **Prisma schema** at [backend/prisma/schema.prisma](backend/prisma/schema.prisma):
  - Enums: `RoleName` (`SA / TAM / ADMIN / STAKEHOLDER`), `ProjectStatus` (`PLANNING / ACTIVE / ON_HOLD / COMPLETED / CANCELLED`), `TaskStatus` (`TODO / IN_PROGRESS / DONE`).
  - Models: `Role`, `User`, `Project`, `Task`, `Blueprint`. **`Blueprint.payload` is `Json @db.JsonB`** per PRD §6.4. **`@@unique([projectId, version])`** on `Blueprint` enforces the version-control requirement (PRD §4.3). Cascade delete from `Project → Tasks/Blueprints`. Snake-case via `@map`/`@@map`. Indexes on FK + status columns.
  - Added `User.passwordHash` beyond PRD §6.4 because seeded users need a credential to be usable with the planned JWT auth.
- **Seeder** at [backend/prisma/seed.ts](backend/prisma/seed.ts) — idempotent `upsert` of 4 Roles (with default permission arrays) and 6 Users (1 ADMIN, 2 SA, 2 TAM, 1 STAKEHOLDER). Dev password `password123`, bcrypt-hashed (cost 10). Wired via `prisma.seed` field in [backend/package.json](backend/package.json).
- **Backend project skeleton**: [backend/package.json](backend/package.json) (Prisma, bcrypt, dotenv, tsx, TypeScript), [backend/tsconfig.json](backend/tsconfig.json) (strict, NodeNext, ES2022), [backend/.env.example](backend/.env.example).
- **Repo hygiene**: root [.env.example](.env.example), [.gitignore](.gitignore) (node_modules, .env, dist, OS/editor cruft), [CLAUDE.md](CLAUDE.md) orienting future Claude to the spec sources, target architecture, and DESIGN.md ↔ mockup drift.
