# Implementation Plan: Weekly Sync Highlight Rows

**Branch:** `feat/weekly-sync-highlight-rows` — cut from `origin/develop` @ `8561003` (`git fetch origin` first; local `develop` was level with origin on 2026-09-09).
**Phase = branch = one PR into `develop`.** Tasks = commits. No commit or PR without explicit user approval.
**Source:** TAM feedback 2026-09-09 (the user and other TAMs) — the Mid-week table has one row per customer and the Highlight cell holds the whole Wednesday update (Bursa Efek Indonesia on 9 Sep: 12 lines). Monday's read cannot scan it. Root: `WeeklyUpdate.highlight`, `risk`, `action` are one `String? @db.Text` each per customer per week (`backend/prisma/schema.prisma` lines 462–464); the draft helper stacks same-day notes into that one cell; nothing asks for a title.
**Review surfaces (approved 2026-09-09):** proposal page https://claude.ai/code/artifact/233ccea1-7968-44cd-bd49-bf9f5eb0c42b · screen mockups https://claude.ai/code/artifact/de9620e5-5fe9-48bf-957c-feee7c1c4c93.

---

## 1. Decisions (settled — do not re-ask)

| # | Decision | Detail |
|---|---|---|
| D1 | One highlight, one row | The Mid-week table lists one row per highlight. The customer name, Category line, Health and Status sit on the customer's first row and span the rest. A customer with a saved Mid-week but no highlight keeps one row with "—". |
| D2 | Risk and Action per row | Each highlight carries its own Risk and Action. Health and Category stay per customer per week. |
| D3 | Detail per highlight | Each highlight has a Detail text. The Mid-week form and "Copy as table" show it. The table on screen shows the title only, plus a small note icon on a row that has a Detail (hover = the detail as a native tooltip). |
| D4 | Child table, not a split | New `WeeklyHighlight` model / `weekly_highlights` table. The three old columns are dropped after a data move. No split on line breaks anywhere. |
| D5 | Title | One line, 1–200 characters after trim, no `\r`/`\n`. 20 highlights per customer per week max. Detail, Risk, Action: ≤ 8000, trimmed, empty stored as `null` (same `normalizeText` rule as every other sync text). |
| D6 | Save contract | `PUT …/weekly-updates/:weekStart` takes `highlights[]`. Present = replaces the week's list in one transaction, positions in list order. Omitted = unchanged (the Reflection form never sends it — D12 of the tables phase stays). `[]` clears. `midweekSavedAt` is stamped when `category` or `highlights` is present. |
| D7 | Old text moves | Per week with a Highlight, Risk or Action: one row at position 0. Title = first line of the old Highlight cut at 200; Detail = the rest (the full text when the first line was cut); Risk and Action onto that row; no Highlight → title `Untitled`. |
| D8 | Copy as table | Mid-week: one `<tr>` per highlight. Customer, Health, Category repeat on every row. No `rowspan`. Highlight cell = title, `\n`, detail. TSV keeps its newline→space rule. |
| D9 | Draft from Mon–Wed notes | One highlight per note, day order; within a day project notes (customer's project order) then operations notes. Title = `Tue 8 [Ops title]: first line` for an operations note, `Tue 8 Project name: first line` for a project note, cut at 200. Detail = the rest of the body (full body when the first line was cut). Replaces the list after a confirm when the list is not empty. |
| D10 | Unchanged | The Reflection tab, `ReflectionSyncModal.tsx`, `WeeklySyncRow.tsx`, `SyncField.tsx`, Daily Review, the Done rule, `previousWeeklyUpdate`, pinning, the hidden-customers toggle mechanics, permissions, visibility, the Monday key, `draftWeeklyUpdate` for Weekly achievement. |
| D11 | Out of scope | Drag to reorder highlights (list order = entry order) · carry-over of highlights into next week · a link from a highlight to a project or note · merged cells in the copy · Category pick-list. |

## 2. Data model

`backend/prisma/schema.prisma` — **spine** (instant review after T1).

```prisma
model WeeklyUpdate {
  // … unchanged: id, customerId, weekStart, authorId, category, achievement,
  // outstandingIssue, lessonLearned, nextWeekFocus, managerDecision,
  // midweekSavedAt, health, status, doneAt, createdAt, updatedAt,
  // @@unique([customerId, weekStart]), @@index([authorId]), @@map
  highlights        WeeklyHighlight[]
  // removed: highlight, risk, action
}

// One Mid-week highlight — one row of Monday's table. Risk and Action live
// here, not on the week (D2). `position` is the list order the form saved.
model WeeklyHighlight {
  id             Int          @id @default(autoincrement())
  weeklyUpdateId Int          @map("weekly_update_id")
  weeklyUpdate   WeeklyUpdate @relation(fields: [weeklyUpdateId], references: [id], onDelete: Cascade)
  position       Int
  title          String       @db.VarChar(200)
  detail         String?      @db.Text
  risk           String?      @db.Text
  action         String?      @db.Text
  createdAt      DateTime     @default(now()) @map("created_at")
  updatedAt      DateTime     @updatedAt @map("updated_at")

  @@unique([weeklyUpdateId, position])
  @@map("weekly_highlights")
}
```

**Migration** `weekly_highlights` (`docker compose exec -it backend npx prisma migrate dev --name weekly_highlights`, then hand-edit the generated SQL so the data move sits between the CREATE and the DROP — the file is new, so editing it before it is committed is allowed). Target shape:

```sql
-- CreateTable (generated; keep Prisma's names)
CREATE TABLE "weekly_highlights" (
  "id" SERIAL NOT NULL,
  "weekly_update_id" INTEGER NOT NULL,
  "position" INTEGER NOT NULL,
  "title" VARCHAR(200) NOT NULL,
  "detail" TEXT,
  "risk" TEXT,
  "action" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "weekly_highlights_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "weekly_highlights_weekly_update_id_position_key" ON "weekly_highlights"("weekly_update_id", "position");
ALTER TABLE "weekly_highlights" ADD CONSTRAINT "weekly_highlights_weekly_update_id_fkey"
  FOREIGN KEY ("weekly_update_id") REFERENCES "weekly_updates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Data move (D7): one row at position 0 per week that has any Mid-week text.
-- Title = first line of the old highlight, cut at 200 ("Untitled" when there is
-- none). Detail = the text after the first line break; the full text when the
-- first line was longer than 200. Risk and action move onto the same row.
INSERT INTO "weekly_highlights" ("weekly_update_id", "position", "title", "detail", "risk", "action", "created_at", "updated_at")
SELECT
  h."id",
  0,
  COALESCE(NULLIF(LEFT(h."first_line", 200), ''), 'Untitled'),
  CASE
    WHEN h."text" IS NULL THEN NULL
    WHEN LENGTH(h."first_line") > 200 THEN h."text"
    WHEN POSITION(E'\n' IN h."text") = 0 THEN NULL
    ELSE NULLIF(BTRIM(SUBSTRING(h."text" FROM POSITION(E'\n' IN h."text") + 1), E' \t\r\n'), '')
  END,
  h."risk",
  h."action",
  h."updated_at",
  h."updated_at"
FROM (
  SELECT
    wu."id", wu."risk", wu."action", wu."updated_at",
    NULLIF(BTRIM(wu."highlight", E' \t\r\n'), '') AS "text",
    BTRIM(split_part(COALESCE(NULLIF(BTRIM(wu."highlight", E' \t\r\n'), ''), ''), E'\n', 1), E' \t\r') AS "first_line"
  FROM "weekly_updates" wu
) h
WHERE h."text" IS NOT NULL OR h."risk" IS NOT NULL OR h."action" IS NOT NULL;

-- AlterTable
ALTER TABLE "weekly_updates" DROP COLUMN "highlight", DROP COLUMN "risk", DROP COLUMN "action";
```

Storage rule (unchanged): a text field is stored as `null` when its trimmed value is empty. Never store `""`. `title` is never empty.

## 3. API

`backend/src/routes/customers.ts`, `backend/src/routes/dailyReview.ts` — not spine.

### `PUT /customers/:id/weekly-updates/:weekStart` (changed)

Body — every key optional:

```ts
{
  health?: WeeklyHealth | null,
  status?: WeeklyStatus,
  category?: string | null,                       // ≤ 120 after trim (as today)
  highlights?: Array<{                            // ≤ 20 items
    title: string,                                // trim → 1–200 chars, no \r or \n
    detail?: string | null,                       // ≤ 8000
    risk?: string | null,                         // ≤ 8000
    action?: string | null,                       // ≤ 8000
  }>,
  achievement?, outstandingIssue?, lessonLearned?, nextWeekFocus?, managerDecision?: string | null
}
// removed keys: highlight, risk, action (an unknown key is rejected by the existing strictness, or ignored — keep whatever `validate` does today for unknown keys; do not add a special error)
```

Rules:
1. Omitted field = unchanged. `null` / whitespace-only text = stored `null` (`normalizeText`). Title: `z.string().transform(trim).pipe(z.string().min(1).max(200).refine(no \r\n))`; `highlights: z.array(...).max(20).optional()`. A bad title or a 21st item → 400 from `validate`.
2. `highlights` present → in the same `prisma.$transaction` as the upsert: `weeklyHighlight.deleteMany({ where: { weeklyUpdateId } })`, then `createMany` with `position = index`, texts normalised. `[]` → only the delete. Omitted → the list is untouched.
3. `midweekTouched = category !== undefined || body.highlights !== undefined`.
4. Done rule, `doneAt`, `status` default: unchanged.
5. Response: the full row + `author` + `highlights` (`orderBy: { position: "asc" }`, fields `id, position, title, detail, risk, action`), 201 on create, 200 on update.

### `GET /customers/:id/weekly-updates` (changed)

Same full row shape, `highlights` included and ordered by position. Ordering, `limit`, permissions unchanged.

### `GET /daily-review` (changed)

Per customer `weeklyUpdate`: drop `highlight`, `risk`, `action`; add `highlights: { id, position, title, detail, risk, action }[]` via a relation `select` with `orderBy: { position: "asc" }` on the existing batched `findMany` (Prisma issues one extra query for the relation, not one per row — the per-request call count stays fixed). `previousWeeklyUpdate` unchanged (3 Reflection fields).

### Unchanged

`backend/src/routes/admin.ts` user-delete blockers (a highlight has no author). `backend/src/lib/visibility.ts`. `backend/prisma/seed.ts` (seeds no weekly updates).

## 4. Frontend

### Data layer — `frontend/src/lib/queries.ts` (**spine**, instant review after T4)

```ts
export interface WeeklyHighlight {
  id: number; position: number; title: string;
  detail: string | null; risk: string | null; action: string | null;
}
export interface WeeklyHighlightInput {
  title: string; detail?: string | null; risk?: string | null; action?: string | null;
}
// WeeklyUpdate: remove highlight/risk/action; add `highlights: WeeklyHighlight[]`.
// SaveWeeklyUpdateInput: remove highlight/risk/action; add `highlights?: WeeklyHighlightInput[]`.
```

`useSaveWeeklyUpdate` keeps its shape and invalidation. Update the partial-save comment above `SaveWeeklyUpdateInput` so it names `highlights` as the list the Mid-week form owns.

### Draft helper — `frontend/src/lib/weeklyDraft.ts`

Add `draftWeeklyHighlights(customer, week, opts?: { throughDay?: string }): WeeklyHighlightInput[]` per D9. Reuse `groupNotesByDay`, `dayLabel`, `bracketFor`. Export a small `splitTitle(text): { title, detail }` (first non-empty line cut at 200, rest → detail, full text when cut) — the same rule the migration applies. `draftWeeklyUpdate` unchanged. Tests: one row per note across two days; ops note bracket; project note prefix; cut at 200 puts the full body in detail; `throughDay` cut-off; empty week → `[]`.

### Table builders — `frontend/src/lib/weeklySyncTable.ts`

- `hasTabUpdate("midweek")`: `u.midweekSavedAt != null || hasText(u.category) || u.highlights.length > 0`.
- `buildSyncTable("midweek")`: per customer, one row per highlight (`[name, health, category, detail ? \`${title}\n${detail}\` : title, cellText(risk), cellText(action)]`); a customer with no highlight → one row with `—` in the three text cells. Header unchanged. Reflection unchanged. Update the file's header comment (row = highlight now).
- Tests: fixture `weeklyUpdate()` gains `highlights: []`; update the three `hasTabUpdate` mid-week cases; add: two highlights → two rows with the customer repeated; title+detail joined with `\n`; no-highlight customer → one dash row; `toHtmlTable` renders that `\n` as `<br>` (existing test covers).

### Mid-week form — `frontend/src/components/daily-review/MidweekSyncModal.tsx`

To the mockup ("Mid-week sync form · AFTER").
- `widthClass="max-w-3xl"`.
- State: `{ health, category, highlights: HighlightDraft[] }` with `HighlightDraft = { key: string; title; detail; risk; action; detailOpen: boolean }`; initialised from `customer.weeklyUpdate?.highlights` (`detailOpen = detail !== ""`). Keys from a counter, never the server id (rows are replaced on save).
- Section header: `SyncField`-style caps label **Highlights** with the action link "Draft from Mon–Wed notes"; helper line "One row in Monday's table per highlight. Title: one line, 200 characters max. Detail shows in the form and in Copy as table, not in the table on screen."
- One block per highlight: `rounded-sm border border-outline-variant bg-surface-container-low p-3 space-y-2.5`; top line `HIGHLIGHT n` (11px caps) + "Remove" link (`text-on-surface-variant hover:text-error`, `aria-label="Remove highlight n"`); Title `Input` (`maxLength={200}`, `aria-label="Highlight n title for {customer}"`); a 2-column grid of Risk and Action `Textarea` (`min-h-16`, `aria-label="Highlight n risk for {customer}"` / `… action …`); Detail: link "Add detail" until `detailOpen`, then a `Textarea` (`min-h-[120px]`, `aria-label="Highlight n detail for {customer}"`).
- "Add highlight" button (outline `rounded-sm`, `add` icon) appends an empty block and focuses its title. Max 20 → button disabled with helper "20 highlights max."
- Draft: `draftWeeklyHighlights(customer, week, { throughDay: week.days[2] })`; `ConfirmModal` when the list is not empty: body "Replace the highlights with a draft from this week's notes?".
- Submit: blocks with an empty title and no other text are dropped; a block with text but no title blocks the save with the inline `Alert` "Every highlight needs a title." Sends `{ weekStart, health, category, highlights }` — never `status`.
- Keep: carry-over panel, Health group, Category, ⌘/Ctrl+Enter, the Escape/confirm interplay, footer.

### Weekly Sync page — `frontend/src/pages/WeeklySync.tsx`

To the mockup ("Weekly Sync · Mid-week · AFTER").
- Subtitle: "One row per highlight. Wednesday and Friday tables, read on Monday."
- Mid-week `SyncRow` → a customer **block**: one wrapper `div` (keeps `role="button"`, `tabIndex`, `data-testid="weekly-sync-row-{id}"`, hover/focus classes, click → `onOpen`) containing one grid row per highlight. First row: Customer (+ Category line), Health, Status as today. Continuation rows: empty Customer/Health/Status cells with no top border (`border-t-0`); Highlight/Risk/Action cells with `border-t border-surface-container` (the fainter divider). No highlights → the one dash row as today.
- Highlight cell: the title; when `detail` is non-empty, append `<span className="material-symbols-outlined ml-1.5 align-[-2px] text-[14px] text-on-surface-variant" title={detail} aria-label="Has detail">notes</span>`.
- Reflection rows, groups, header, week nav, copy wiring, hidden-customers toggle: unchanged. `MIDWEEK_GRID_COLS` unchanged. `handleCopy`'s "Copied N rows" now counts highlight rows — fine.

### Customer page — `frontend/src/pages/CustomerDetail.tsx`

`hasMidweekContent = update.highlights.length > 0`. The expanded section: caps label `Highlights · N`, then per highlight (divided by `border-t border-outline-variant/60`, `pt-2.5`): title (14px on-surface), detail under it (13px on-surface-variant, `whitespace-pre-wrap`), then a 2-column grid of `WeeklyUpdateField` Risk / Action. Everything else in `WeeklyUpdateRow` unchanged.

### Fixtures

`frontend/src/lib/dailyReviewStats.test.ts` line 94 fixture: replace the three fields with `highlights: []`.

## 5. Tests

### Backend — `backend/test/weeklyUpdates.test.ts` (21 today)

Update: the partial-save test (line 228) and the whitespace test (249) use `category` / `highlights` instead of `highlight` / `risk`; the mid-week stamp test (285) sends `highlights`; the list-shape test (327) asserts `highlights` instead of the three fields. Add: `highlights` with 2 items → 201, positions 0/1 in order, texts trimmed, empty detail → null; a save that omits `highlights` leaves the 2 rows; `highlights: []` clears them; a save with 1 item replaces the 2; title of 201 chars → 400; title with `\n` → 400; whitespace-only title → 400; 21 items → 400; `midweekSavedAt` stamped on `highlights` alone; DONE stays DONE across a `highlights` save; list endpoint returns `highlights` ordered by position.

### Backend — `backend/test/dailyReview.test.ts` (30 today)

Update the "every Mid-week and Reflection field" test (492): no `highlight`/`risk`/`action` keys, `highlights: []`. Add: two highlight rows come back ordered by position with the six fields; a customer without a weekly update still gives `weeklyUpdate: null`.

### Frontend unit — `weeklySyncTable.test.ts` (20), `weeklyDraft.test.ts` (14)

Per §4.

### Playwright — `e2e/tests/weekly-sync.spec.ts` (new third test, desktop + mobile)

Same fixtures as the two tests there (`seedActiveCustomer`, `currentWeekKey`, serial mode). Open `/weekly-sync?week={key}&tab=midweek`; the fresh customer is hidden → "Show them" → click the row → dialog `Mid-week sync — {name}, week N`; fill `Highlight 1 title for {name}` = `Server request {name}`, its risk and action; click "Add highlight"; fill `Highlight 2 title for {name}` = `Remote trading test {name}`; pick Amber; "Save mid-week"; assert both titles visible inside `weekly-sync-row-{id}` and the row shows `Saved`; reload with no toggle → the row is listed with both titles. Desktop only: grant clipboard permissions, click copy, `readText()` contains both titles and the customer name twice. Existing two tests: unchanged (step 4 of the first still asserts "Not filled").

## 6. Task list

8 tasks. `solvro-implementor` each; scoped checks only; report CHANGELOG entry text, never write `CHANGELOG.md` (one writer at integration). Backend implementors that run in parallel use separate test DBs (`solvro_t1_test`, `solvro_t2_test`) — see `backend/CLAUDE.md`'s `TEST_URL` recipe and swap the DB name.

### T1 — Schema and migration
**Files:** `backend/prisma/schema.prisma`, `backend/prisma/migrations/<ts>_weekly_highlights/migration.sql` — **spine**; plus the minimum edits that keep the backend compiling: `backend/src/routes/customers.ts` and `backend/src/routes/dailyReview.ts` drop the three removed fields (schema keys, `normalizeText` calls, upsert data, `select`, DTO); `backend/test/weeklyUpdates.test.ts` and `backend/test/dailyReview.test.ts` swap `highlight`/`risk`/`action` for `category` where a test only exercises the partial-save mechanics, and drop the three assertions elsewhere. T2/T3 add `highlights`.
1. §2 exactly (names, `@map`s, `VarChar(200)`, the unique, cascade).
2. `docker compose exec -it backend npx prisma migrate dev --name weekly_highlights`; insert the data move between the CREATE block and the DROP. Before migrating, write a throwaway `weekly_updates` row with a 3-line highlight + risk + action and one with only a risk; after: two `weekly_highlights` rows (title = line 1 / `Untitled`, detail = lines 2–3 / null, risk and action carried), columns gone. Delete the throwaway rows. `npx prisma migrate status` clean.
3. Scoped checks: backend `npx tsc --noEmit`; `weeklyUpdates.test.ts` + `dailyReview.test.ts` on `solvro_t1_test`.
4. CHANGELOG (Changed): schema + migration, why (one row per highlight, risk and action per row), the data move rule.

### T2 — Save and list routes
**Files:** `backend/src/routes/customers.ts`, `backend/test/weeklyUpdates.test.ts`.
1. §3 PUT + GET list: the `highlights` schema, the transaction, `midweekTouched`, the response `include`.
2. §5 backend tests.
3. Scoped checks: backend `tsc --noEmit` + `weeklyUpdates.test.ts` on `solvro_t1_test`.
4. CHANGELOG (Changed): route contract, validation, replace-in-order semantics.

### T3 — Daily-review payload
**Files:** `backend/src/routes/dailyReview.ts`, `backend/test/dailyReview.test.ts`.
1. §3 `highlights` relation select + DTO.
2. §5 tests.
3. Scoped checks on `solvro_t2_test`.
4. CHANGELOG (Changed).

### T4 — Types, draft helper, table builders
**Files:** `frontend/src/lib/queries.ts` (**spine**), `frontend/src/lib/weeklyDraft.ts` + `.test.ts`, `frontend/src/lib/weeklySyncTable.ts` + `.test.ts`, `frontend/src/lib/dailyReviewStats.test.ts`; plus the minimum interim edits that keep the app compiling until T5/T6/T7 land: `MidweekSyncModal.tsx` reads/writes the first highlight (`highlights[0]?.title` etc.; submit sends `highlights: [{ title, risk, action }]` when the title is non-empty, else `[]`), `WeeklySync.tsx` renders `highlights[0]` in the three cells, `CustomerDetail.tsx` uses `highlights.length > 0` and shows `highlights[0]`.
1. §4 data layer, draft helper, table builders, fixtures.
2. Scoped checks: frontend `npm run typecheck`, `weeklyDraft.test.ts`, `weeklySyncTable.test.ts`, `dailyReviewStats.test.ts`.
3. CHANGELOG (Changed): data layer + builders + draft. (The interim edits are replaced in W4 — no separate entry.)

### T5 — Mid-week form
**Files:** `frontend/src/components/daily-review/MidweekSyncModal.tsx`.
1. §4 Mid-week form, to the mockup. Reuse `Modal`, `ConfirmModal`, `Input`, `Textarea`, `SyncField`, `HealthButtonGroup`, `Alert`.
2. Accessibility: the aria-labels in §4 verbatim (the e2e flow keys on them); "Add highlight" and "Remove highlight n" are the accessible names; the Health group stays a `radiogroup`.
3. Scoped checks: typecheck. No browser — the reviewer and T8 verify pixels.
4. CHANGELOG (Changed).

### T6 — Weekly Sync page
**Files:** `frontend/src/pages/WeeklySync.tsx`.
1. §4 Weekly Sync page, to the mockup. Keep every `data-testid`.
2. Scoped checks: typecheck.
3. CHANGELOG (Changed).

### T7 — Customer page
**Files:** `frontend/src/pages/CustomerDetail.tsx`.
1. §4 Customer page. Keep the "Weekly updates" heading and the "Show mid-week" / "Hide mid-week" toggle text.
2. Scoped checks: typecheck.
3. CHANGELOG (Changed).

### T8 — Playwright
**Files:** `e2e/tests/weekly-sync.spec.ts`.
1. §5 Playwright flow.
2. Scoped checks: `cd e2e && npm test` against the dev stack (`BASE_URL=http://localhost:5173`).
3. CHANGELOG (Added).

## 7. Waves and gates

| Wave | Tasks | Notes |
|---|---|---|
| W1 | T1 | Solo. Start Docker first (`open -a Docker`, wait for `docker compose ps` healthy). `gates.sh` + **instant opus review** (schema spine) before W2. |
| W2 | T2 ∥ T3 | Two backend implementors, DBs `solvro_t1_test` / `solvro_t2_test`. Gates once at integration. |
| W3 | T4 | Solo. Gates + **instant opus review** (`queries.ts` spine). |
| W4 | T5 ∥ T6 ∥ T7 | Three frontend implementors, disjoint files (`MidweekSyncModal.tsx` / `WeeklySync.tsx` / `CustomerDetail.tsx`). Gates at integration. |
| W5 | T8 | Needs the dev stack on W4's tree (`docker compose restart backend` if a route 404s). Gates (Playwright smoke runs inside gates on frontend diffs; the full e2e run is T8's own check). |
| Close | — | One `solvro-reviewer` phase review on the combined diff (design lens: `docs/DESIGN.md`; data lens: the migration's data move); `solvro-docs-keeper` only if a trigger fires (none expected: no `index.css`/env/compose change); stage, draft one commit message per task and the PR body → **stop for approval**. `TaskStop` every agent. |

Fix rounds continue the same implementor via `SendMessage`. Sonnet floor. Never poke an idle agent for a report — read the tree.

## 8. CHANGELOG headline (draft, orchestrator-owned)

Under `[Unreleased]` → `### Changed — Weekly Sync: one row per highlight, with its own risk, action and detail`. One entry per task, merged serially at integration. Public wording: what changed, where, why (Monday's table could not be scanned; a highlight is a title per row now). No pipeline vocabulary.

## 9. Out of scope

Everything in D11 · any change to the Reflection half · a Highlight column on the Reflection copy · reminders or exports.
