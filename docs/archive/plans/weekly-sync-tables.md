# Implementation Plan: Weekly Sync Tables

**Branch:** `feat/weekly-sync-tables` — cut from `origin/develop` @ `9ae091e` (`git fetch origin` first; local `develop` was level with origin on 2026-09-03).
**Phase = branch = one PR into `develop`.** Tasks = commits. No commit or PR without explicit user approval.
**Source:** user request, 2026-09-03 — the week has 3 sync meetings (Mon Weekly Sync with the VP, Wed Mid-week Sync, Fri Reflection Sync). The Wednesday and Friday meetings each read a table, one row per customer. The customer weekly update in Solvro is one free-text box; it becomes those two structured tables, filled through form modals, read on a new Weekly Sync page, and copied into the meeting doc.
**Review surfaces (approved 2026-09-03):** proposal page https://claude.ai/code/artifact/c3c59dd5-034e-47c3-9008-e65c7607e0d5 · screen mockups https://claude.ai/code/artifact/f5417975-c6bb-46ed-a23f-6a41847fbeb2.

---

## 1. Decisions (settled — do not re-ask)

| # | Decision | Detail |
|---|---|---|
| D1 | One record per customer per ISO week | `WeeklyUpdate` stays the row. It holds both tables. `health` is one value per week: Wednesday sets it, Friday can change it. |
| D2 | Column names (English) | Mid-week: Customer, Health, Category, Highlight, Risk, Action. Reflection: Customer, Weekly Achievement, Outstanding Issue, Lesson Learned, Next Week Focus, Need Manager Decision. (Kategori → Category, Risiko → Risk.) |
| D3 | Category is free text | 1 line, max 120 characters, same input as the operations-note title. No pick-list. |
| D4 | Risk is free text | Typed by hand each Wednesday. These are operational updates; there is no link to the project `Risk` rows. |
| D5 | Done rule | Done needs `health` and `achievement` (non-empty after trim). Nothing else is required. A Mid-week save never marks done. |
| D6 | Old text moves | The migration copies every existing `body` into `achievement`, then drops `body`. Existing Done rows stay Done (they had text + health). |
| D7 | Output | New sidebar page `/weekly-sync` (not a Daily Review tab): week navigation, two tabs, one row per customer, "Copy as table". |
| D8 | Monday view | On Monday the page opens on last week's Reflection tab. Tuesday to Sunday it opens on the current week. `?week=` and `?tab=` always win. |
| D9 | Carry-over | The Mid-week modal shows last Friday's Outstanding Issue, Next Week Focus, and Need Manager Decision, read-only, on top. |
| D10 | Pinned rows | On the Reflection tab, rows with a non-empty Need Manager Decision sit on top, in their own group. |
| D11 | Draft from notes | Highlight drafts from Mon–Wed notes. Weekly Achievement drafts from the full week, as today (the proposal page said Mon–Fri; weekend notes must not be lost). |
| D12 | Partial saves | The save route takes any subset of the fields; an omitted field is unchanged. The two modals edit different halves of one row, so a whole-row PUT would clobber the other form's work. |
| D13 | Copy as table | Writes an HTML `<table>` plus a tab-separated `text/plain` fallback to the clipboard. Only the sync fields are copied. Daily notes are never part of the copy. |
| D14 | Unchanged | Daily notes, operations notes, "Mark reviewed", the stat tiles (the "weekly updates done" tile still counts `DONE`), the collapse rule for a finished customer group, permissions (`project:write` to save, `project:read` to view), customer visibility, the Monday `weekStart` key, `NOT_STARTED → DRAFT → DONE`. |

## 2. Data model

`backend/prisma/schema.prisma`, model `WeeklyUpdate` — spine (instant review after T1).

| Column (TS) | DB column | Type | Notes |
|---|---|---|---|
| `category` | `category` | `String? @db.VarChar(120)` | Mid-week |
| `highlight` | `highlight` | `String? @db.Text` | Mid-week |
| `risk` | `risk` | `String? @db.Text` | Mid-week |
| `action` | `action` | `String? @db.Text` | Mid-week |
| `achievement` | `achievement` | `String? @db.Text` | Reflection. Receives the old `body`. |
| `outstandingIssue` | `outstanding_issue` | `String? @db.Text` | Reflection |
| `lessonLearned` | `lesson_learned` | `String? @db.Text` | Reflection |
| `nextWeekFocus` | `next_week_focus` | `String? @db.Text` | Reflection |
| `managerDecision` | `manager_decision` | `String? @db.Text` | Reflection. Non-empty = pinned on Monday. |
| `midweekSavedAt` | `midweek_saved_at` | `DateTime?` | Stamped on every save that carries at least one Mid-week field. Drives "Mid-week saved Wed 2 Sep" on the row and the Mid-week tab status. |
| ~~`body`~~ | ~~`body`~~ | removed | See D6. |

Unchanged: `id`, `customerId`, `weekStart`, `authorId`, `health`, `status`, `doneAt`, `createdAt`, `updatedAt`, `@@unique([customerId, weekStart])`.

**Migration** (`prisma migrate dev --name weekly_sync_tables`, then hand-edit the generated SQL so the data move sits between the ADD and the DROP — the file is new, so editing it before it is committed is allowed):

```sql
ALTER TABLE "weekly_updates" ADD COLUMN "category" VARCHAR(120), ADD COLUMN "highlight" TEXT, ADD COLUMN "risk" TEXT, ADD COLUMN "action" TEXT, ADD COLUMN "achievement" TEXT, ADD COLUMN "outstanding_issue" TEXT, ADD COLUMN "lesson_learned" TEXT, ADD COLUMN "next_week_focus" TEXT, ADD COLUMN "manager_decision" TEXT, ADD COLUMN "midweek_saved_at" TIMESTAMP(3);
UPDATE "weekly_updates" SET "achievement" = NULLIF(BTRIM("body"), '');
ALTER TABLE "weekly_updates" DROP COLUMN "body";
```

Storage rule: a text field is stored as `null` when its trimmed value is empty. Never store `""`.

## 3. API

`backend/src/routes/customers.ts` — not spine. `backend/src/routes/dailyReview.ts` — not spine.

### `PUT /customers/:id/weekly-updates/:weekStart` (changed)

Body — every key optional:

```ts
{
  health?: WeeklyHealth | null,      // omitted = unchanged; null clears (as today)
  status?: WeeklyStatus,             // omitted = existing status, or DRAFT on create
  category?: string | null,          // ≤ 120
  highlight?, risk?, action?,
  achievement?, outstandingIssue?, lessonLearned?, nextWeekFocus?, managerDecision?: string | null  // each ≤ 8000
}
```

Rules:
1. Omitted field = unchanged (D12). `null` or whitespace-only = stored `null`.
2. `status: "DONE"` needs effective `health` and effective `achievement` (what the body sends, else what is stored), else 400 `weekly_update_incomplete` (same code as today).
3. `doneAt` semantics unchanged: stamped once on the transition into DONE; any non-DONE status clears it.
4. `midweekSavedAt = now()` when the body carries any of `category`, `highlight`, `risk`, `action` (present, even if null). Otherwise unchanged.
5. A body with no fields at all is still a valid save (touches `authorId`/`updatedAt`, creates the row as DRAFT). Keep it simple; no special error.
6. Response: the full row (all fields above, `midweekSavedAt`, `author`), 201 on create, 200 on update — as today.

### `GET /customers/:id/weekly-updates` (changed)

Returns the same full row shape. Ordering, `limit`, permissions unchanged.

### `GET /daily-review` (changed)

Per customer:
- `weeklyUpdate`: the full row shape (drop `body`, add the 9 fields + `midweekSavedAt`).
- **New** `previousWeeklyUpdate: { weekStart, outstandingIssue, nextWeekFocus, managerDecision } | null` — the row for `weekStart − 7 days`. One extra batched `findMany` over the same `customerIds`. Only those 3 fields, nothing else (D9).

Everything else on the response is unchanged. The Weekly Sync page reads this same endpoint (D7) — no new route.

### Admin

`backend/src/routes/admin.ts` user-delete blocker for weekly-update authors: unchanged.

## 4. Frontend

### Data layer — `frontend/src/lib/queries.ts` (spine, instant review after T4)

- `WeeklyUpdate`: drop `body`; add the 9 fields (`string | null`) and `midweekSavedAt: string | null`.
- `DailyReviewCustomer`: add `previousWeeklyUpdate: { weekStart: string; outstandingIssue: string | null; nextWeekFocus: string | null; managerDecision: string | null } | null`.
- `SaveWeeklyUpdateInput`: `{ weekStart: string } & Partial<...the body above...>`. `useSaveWeeklyUpdate` keeps its shape and its invalidation (daily-review key + the customer weekly-updates prefix).

### Draft helper — `frontend/src/lib/weeklyDraft.ts`

`draftWeeklyUpdate(customer, week, opts?: { throughDay?: string })`. When `throughDay` is given, only days `<= throughDay` (string compare on `yyyy-MM-dd`) are drafted. Mid-week passes `week.days[2]`; Reflection passes nothing (D11). Existing 11 tests keep passing; add 2 for the cut-off.

### Daily Review — `frontend/src/components/daily-review/`

- **Remove** `WeeklyUpdateBlock.tsx`.
- **Add** `WeeklySyncRow.tsx`: the compact row (mockup "Daily Review — after"). Same container as the old block (`rounded-sm border border-outline-variant bg-surface-container`, now `px-4 py-3`). Left to right: "Weekly sync" title, `Week N · Customer` caps label, status `Badge` (same variants as `CustomerGroup`), health chip, a 13px line `Mid-week saved {Wed 2 Sep} · Reflection {not started | draft | done}`; right: `Mid-week sync` (outline) and `Reflection sync` (primary) buttons. Buttons need `project:write` (the page already knows `hasPermission`); without it the row is read-only text.
- **Add** `MidweekSyncModal.tsx` and `ReflectionSyncModal.tsx` on `Modal.tsx` (`widthClass="max-w-2xl"`), field markup in the `RiskFormModal.tsx` vocabulary (label-caps + `rounded-sm border border-outline-variant bg-surface-container-lowest` inputs, `rounded-lg` footer buttons). Share the label/textarea markup through one small `SyncField` component in the same folder — no copy-paste between the two modals.
  - Mid-week: carry-over panel on top (D9; hidden when `previousWeeklyUpdate` is null), Health button group, Category (`Input`, `maxLength=120`, helper "One line. 120 characters max."), Highlight (`Textarea` + "Draft from Mon–Wed notes" link; `ConfirmModal` before overwriting non-empty text, as today), Risk (`Textarea`), Action (`Textarea`). Footer: Cancel · **Save mid-week**. Sends only its 5 fields + health; never `status`.
  - Reflection: Health button group with the helper "Set on Wednesday. Change it here if the week ended differently.", Weekly Achievement (`Textarea` + "Draft from this week's notes", "required to mark done" hint), Outstanding Issue, Lesson Learned, Next Week Focus, Need Manager Decision (helper "Leave empty if no decision is needed. A filled row pins to the top of Monday's table."). Footer: Cancel · Save draft · **Mark done** (disabled until health + achievement are non-empty). Sends its 5 fields + health + `status`.
  - Both: local draft state per `week.key` as the old block did (never leak text between weeks); ⌘/Ctrl+Enter = primary save; `Escape` closes (Modal.tsx does this); server refetch overwrites local state only when not dirty.
- `CustomerGroup.tsx`: replace the `WeeklyUpdateBlock` mount with `WeeklySyncRow`. Header (status badge + health chip) unchanged.
- `StatsBar.tsx`, `dailyReviewStats.ts`, `isGroupCollapsible`: unchanged.

### Weekly Sync page — `frontend/src/pages/WeeklySync.tsx` (new)

- Route `weekly-sync` in `App.tsx` under the same `AuthGuard` as `daily-review`. Nav entry `{ to: "/weekly-sync", label: "Weekly Sync", icon: "table_chart" }` right after Daily Review in `navCommands.ts`; update the pinned route list in `navCommands.test.ts`.
- Header: h1 "Weekly Sync", subtitle "One row per customer. Wednesday and Friday tables, read on Monday.", week nav identical to Daily Review (`?week=`), and the "Copy as table" button (`content_copy` icon, `rounded-lg` outline).
- Default week/tab (D8): compute from `dateToDay(new Date())`: Monday → `shiftWeek(currentWeek, -1)` and tab `reflection`; Tue–Thu → current week, tab `midweek`; Fri–Sun → current week, tab `reflection`. `?week=` / `?tab=midweek|reflection` override.
- Data: `useDailyReview(week)`; rows = `data.customers` (already visibility-scoped by the backend).
- Tabs (ProjectDetail tab vocabulary): "Mid-week" and "Reflection · N decisions" (N = customers with a non-empty `managerDecision`; omit the suffix when 0).
- Mid-week table columns: Customer (+ Category as a 12px second line), Health, Category is NOT repeated, Highlight, Risk, Action, Status (`Saved {Wed 2 Sep}` from `midweekSavedAt`, else "Not filled" muted).
- Reflection table columns: Customer (+ Category line), Health, Weekly Achievement, Outstanding Issue, Lesson Learned, Next Week Focus, Need Manager Decision, Status (`Badge`: Not started / Draft / Done).
- Groups on the Reflection tab (D10): "Needs a manager decision · N" (amber caps group row) then "Other customers · M". Inside a group, rows keep the backend's customer order. Mid-week tab has no groups.
- Empty cells render "—" in `text-on-surface-variant`. A `NOT_STARTED` customer renders all cells "—".
- Row click opens that customer's modal for the active tab (reuse the two modal components from T5; they take `customer` + `week` from the same response).
- Layout: a CSS grid per row is acceptable (the vendored DataGrid is not required for 8 fixed columns; do not install anything). Horizontal scroll inside the table container below `md:`; the page body never scrolls sideways.
- Copy as table (D13): build the active tab's header + rows in display order; `navigator.clipboard.write([new ClipboardItem({ "text/html": ..., "text/plain": ... })])`, fallback `writeText(tsv)` when `ClipboardItem` is undefined; escape HTML in cells; toast/inline confirmation "Copied N rows" for 2 s. Put the builders in `frontend/src/lib/weeklySyncTable.ts` (pure, unit-tested: header order, escaping, "—" for empty, TSV line breaks replaced by spaces).

### Customer page — `frontend/src/pages/CustomerDetail.tsx`

`WeeklyUpdateRow`: header line unchanged (week key, range, health chip, status badge); then Category as a 15px semibold title (omit when null); then a 2-column grid of the 5 Reflection fields with 11px caps labels (Need Manager Decision spans both columns and its label uses the amber text token); then a "Show mid-week" / "Hide mid-week" toggle that reveals Highlight, Risk, Action in the same grid; footer meta line unchanged. Draft rows stay muted.

## 5. Task list

8 tasks. `solvro-implementor` each; scoped checks only; report CHANGELOG entry text, never write `CHANGELOG.md` (one writer at integration). Backend implementors that run in parallel use separate test DBs (`solvro_t1_test`, `solvro_t2_test`) — see `backend/CLAUDE.md`'s `TEST_URL` recipe and swap the DB name.

### T1 — Schema and migration
**Files:** `backend/prisma/schema.prisma`, `backend/prisma/migrations/<ts>_weekly_sync_tables/migration.sql` — **spine**.
1. Apply §2 exactly (names, `@map`s, `VarChar(120)`).
2. `docker compose exec -it backend npx prisma migrate dev --name weekly_sync_tables`; then insert the `UPDATE` between the ADD and the DROP in the generated SQL (the generated file drops `body` — keep that, but the data move must precede it). Re-run `prisma migrate reset`-free verification: `npx prisma migrate status` clean, `npx tsc --noEmit` green.
3. Fix the compile breaks the removed `body` causes in `routes/customers.ts`, `routes/dailyReview.ts`, and `prisma/seed.ts` (if it seeds weekly updates) with the minimum change: the routes read/write `achievement` where they read/wrote `body`. T2/T3 do the real route work.
4. Acceptance: migration applies on a DB that has existing weekly-update rows and every old `body` lands in `achievement` (write a throwaway row before migrating, check after); backend typecheck green; existing `weeklyUpdates.test.ts` passes with `body` → `achievement` renamed in the test bodies only (no new tests here).
5. CHANGELOG (Changed): schema + migration, why (two structured sync tables), the data move.

### T2 — Save and list routes
**Files:** `backend/src/routes/customers.ts`, `backend/test/weeklyUpdates.test.ts`.
1. `saveWeeklyUpdateSchema` per §3: every key optional, `.trim()` + empty → null normalisation in one helper, `category` max 120, texts max 8000.
2. Effective-value Done check (health + achievement), `midweekSavedAt` stamping rule, `status` default rule, response shape.
3. Tests — update the 12 existing to the new field names; add: partial save leaves other fields unchanged; whitespace becomes null; `category` of 121 chars → 400; `midweekSavedAt` stamped only when a Mid-week field is present; `status` omitted keeps DONE (a Mid-week edit after Friday does not reopen); list returns all fields.
4. Scoped checks: backend `tsc --noEmit` + `weeklyUpdates.test.ts` on `solvro_t1_test`.
5. CHANGELOG (Changed): route contract, validation codes, partial-save semantics.

### T3 — Daily-review payload
**Files:** `backend/src/routes/dailyReview.ts`, `backend/test/dailyReview.test.ts`.
1. `weeklyUpdate` select = full row shape; add the `previousWeeklyUpdate` batched query and DTO (§3).
2. Tests: `weeklyUpdate` carries the new fields; `previousWeeklyUpdate` is null with no prior row, and carries exactly the 3 fields when one exists; the query count stays fixed (extend the existing "batched calls" assertion if there is one).
3. Scoped checks on `solvro_t2_test`.
4. CHANGELOG (Changed).

### T4 — Types, hooks, draft helper
**Files:** `frontend/src/lib/queries.ts` (**spine**), `frontend/src/lib/weeklyDraft.ts`, `frontend/src/lib/weeklyDraft.test.ts`, plus the minimum edits that keep `WeeklyUpdateBlock.tsx` and `CustomerDetail.tsx` compiling (`body` → `achievement ?? ""`), which T5/T7 then replace.
1. §4 data layer + `throughDay` option; 2 new draft tests.
2. Scoped checks: frontend `npm run typecheck`, `weeklyDraft.test.ts`.
3. CHANGELOG (Changed).

### T5 — Daily Review row and the two modals
**Files:** `frontend/src/components/daily-review/WeeklySyncRow.tsx`, `MidweekSyncModal.tsx`, `ReflectionSyncModal.tsx`, `SyncField.tsx` (new); `CustomerGroup.tsx`; delete `WeeklyUpdateBlock.tsx`.
1. §4 Daily Review, to the mockups. Reuse `Modal`, `ConfirmModal`, `Input`, `Textarea`, `ButtonGroup`, `Badge`, the `HEALTH_OPTIONS` classes from the old block.
2. Accessibility: the modal `aria-label` is its title; textareas carry `aria-label="{Field} for {customer}"` (the e2e flow keys on `Weekly achievement for {customer}`); the health group stays a `radiogroup`.
3. Scoped checks: typecheck. No browser — the reviewer and T8 verify pixels.
4. CHANGELOG (Changed / Removed).

### T6 — Weekly Sync page, nav, copy
**Files:** `frontend/src/pages/WeeklySync.tsx`, `frontend/src/lib/weeklySyncTable.ts` + `.test.ts` (new); `frontend/src/App.tsx`, `frontend/src/lib/navCommands.ts`, `frontend/src/lib/navCommands.test.ts`.
1. §4 Weekly Sync page. Imports T5's modals. `data-testid`s: `weekly-sync-tab-midweek`, `weekly-sync-tab-reflection`, `weekly-sync-copy`, `weekly-sync-row-{customerId}`.
2. Scoped checks: typecheck, `weeklySyncTable.test.ts`, `navCommands.test.ts`.
3. CHANGELOG (Added).

### T7 — Customer page list
**Files:** `frontend/src/pages/CustomerDetail.tsx`.
1. §4 Customer page. Keep the "Weekly updates" heading text (the e2e flow finds the section by it) and the Amber/Done chips.
2. Scoped checks: typecheck.
3. CHANGELOG (Changed).

### T8 — Playwright
**Files:** `e2e/tests/daily-review.spec.ts`, `e2e/tests/weekly-sync.spec.ts` (new).
1. Rewrite step 6: click `Reflection sync` in the customer group, click "Draft from this week's notes" in the modal, assert the `Weekly achievement for {customer}` textarea contains the project note body, the operations note body and title; pick Amber; `Mark done`; assert the tile delta and the collapsed group as today. Step 7 additionally asserts the achievement text is visible in the customer page section.
2. New flow (desktop + mobile): open `/weekly-sync?week={key}&tab=reflection`; the customer's row shows its achievement text; with a manager decision saved through the modal (`Need manager decision for {customer}`), the row sits inside the "Needs a manager decision" group and the tab label reads `Reflection · 1 decision`; the copy button is visible. Desktop only: grant `clipboard-read`/`clipboard-write`, click copy, `navigator.clipboard.readText()` contains the customer name and the achievement text.
3. Scoped checks: `cd e2e && npm test` against the dev stack (`BASE_URL=http://localhost:5173`).
4. CHANGELOG (Changed / Added).

## 6. Waves and gates

| Wave | Tasks | Notes |
|---|---|---|
| W1 | T1 | Solo. `gates.sh` + **instant opus review** (schema spine) before W2. Start Docker first (`open -a Docker`, wait for `docker compose ps` healthy). |
| W2 | T2 ∥ T3 | Two backend implementors, DBs `solvro_t1_test` / `solvro_t2_test`. Gates once at integration. |
| W3 | T4 | Solo. Gates + **instant opus review** (`queries.ts` spine). |
| W4 | T5 ∥ T7 | Both frontend, disjoint files. Gates at integration. |
| W5 | T6 | Needs T5's modals. Gates. |
| W6 | T8 | Gates (Playwright smoke runs inside gates on frontend diffs; the full e2e run is T8's own check). |
| Close | — | One `solvro-reviewer` phase review on the combined diff (design lens: `docs/DESIGN.md`); `solvro-docs-keeper` only if a trigger fires (none expected: no `index.css`/env/compose change); stage, draft commit messages per task and the PR body → **stop for approval**. `TaskStop` every agent. |

Fix rounds continue the same implementor via `SendMessage`. Sonnet floor. Never poke an idle agent for a report — read the tree.

## 7. Out of scope

Category pick-list (later, if titles repeat) · a Monday form (there is none) · export packets/PDF · reminders or calendar links · linking Risk to project `Risk` rows · any change to daily notes, operations notes, or review marks.
