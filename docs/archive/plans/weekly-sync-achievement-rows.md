# Implementation Plan: Weekly Sync Achievement Rows

**Branch:** `feat/weekly-sync-achievement-rows` — cut from `origin/develop` @ `4074836` (the merge of the Mid-week phase, PR #176; `git fetch origin` first; local `develop` was level with origin on 2026-09-10).
**Phase = branch = one PR into `develop`.** Tasks = commits. No commit or PR without explicit user approval.
**Source:** user request 2026-09-09, right after the Mid-week phase was staged — "the same thing should be applicable to Reflection sync: every weekly achievement gets its own record … each item should have its own column for outstanding issue, lesson learned, next week focus, need manager decision — more like a table". The Reflection half keeps five text blocks per customer per week today; the Friday form and Monday's Reflection table cannot separate two achievements, and the draft stacks the whole week into one paragraph.
**Review surfaces (approved 2026-09-09):** proposal page https://claude.ai/code/artifact/2080d705-8f40-4f83-b886-9c4a6e77b7e0 · screen mockups https://claude.ai/code/artifact/61aece84-83eb-4e4e-8186-2b6b8d8ad63d.
**Builds on:** `docs/plans/weekly-sync-highlight-rows.md` (archived at ship) — same conventions: 200-character one-line titles counted in code points, 20 rows max, replace-in-order saves, blank starter card, note icon for a detail, one frontend typecheck at a time.

---

## 1. Decisions (settled — do not re-ask)

| # | Decision | Detail |
|---|---|---|
| D1 | One achievement, one row | The Reflection table lists one row per achievement. Customer, Health and Status sit on the customer's first row and span the rest. |
| D2 | Every column per row | An achievement row carries its own `outstandingIssue`, `lessonLearned`, `nextWeekFocus`, `managerDecision`. Only Health and Status stay per customer per week. |
| D3 | Detail per achievement | Each achievement has a Detail. The form and "Copy as table" show it; the screen table shows a note icon (`role="img"`, `title` tooltip) — same as highlights. |
| D4 | Child table | New `WeeklyAchievement` / `weekly_achievements`. `WeeklyUpdate` loses `achievement`, `outstandingIssue`, `lessonLearned`, `nextWeekFocus`, `managerDecision` after a data move. |
| D5 | Title and limits | Title 1–200 code points, one line; detail and the four texts ≤ 8000, trimmed, empty stored as `null`; 20 achievements per customer per week max. |
| D6 | Save contract | `PUT …/weekly-updates/:weekStart` takes `achievements[]`: present replaces the list in order in one transaction, omitted = untouched, `[]` clears. The Mid-week form never sends it. |
| D7 | Done rule | `status: "DONE"` needs effective health and at least one achievement (the list sent, else the stored rows) → else 400 `weekly_update_incomplete`. "Save draft" needs nothing. `doneAt` semantics unchanged. |
| D8 | Old text moves | Per week with any of the five texts: one row at position 0 — title = first line of `achievement` cut at 200 (line endings normalised), detail = the rest (full text when cut), the four texts onto that row, title "Untitled" when `achievement` is empty. Done weeks keep one row; pins survive. |
| D9 | Draft from this week | Order: the week's saved highlights first (title + detail copied, the four texts empty), then one card per note dated Thursday–Sunday (title = day + project name / `[ops title]` + first line, detail = rest). A week with no highlights drafts one card per Monday–Sunday note. Replaces the list after a confirm when a card holds text; cut at 20; an empty draft keeps one blank card. |
| D10 | The pin | A customer sits in "Needs a manager decision" when any of its achievement rows has a non-empty `managerDecision`. The tab label counts customers, as today. |
| D11 | Carry-over panel | The Mid-week form's "From last Friday" panel lists last week's achievements that carry an Outstanding issue, a Next week focus, or a decision: the title, then only the texts present. Hidden when last week has no such row. |
| D12 | Copy as table | Reflection: one `<tr>` per achievement with its five texts; Customer repeated on every row; the Weekly achievement cell = title, `\n`, detail; no Health/Category column (unchanged); no `rowspan`. TSV newline→space rule unchanged. |
| D13 | Removed | `draftWeeklyUpdate` and `buildDayRows` in `weeklyDraft.ts` with their tests — no consumer remains. |
| D14 | Unchanged | The Mid-week highlights list, table and copy; `WeeklySyncRow.tsx`; the Daily Review page and its "weekly updates done" tile (counts DONE); `hasTabUpdate("midweek")`; permissions; visibility; the Monday key; the hidden-customers toggle. |
| D15 | Out of scope | Per-row Health or Status · a link from an achievement to its highlight · merged cells in the copy · anything on the Mid-week tab. |

## 2. Data model

`backend/prisma/schema.prisma` — **spine** (instant review after T1).

```prisma
model WeeklyUpdate {
  // unchanged: id, customerId, weekStart, authorId, category, midweekSavedAt,
  // health, status, doneAt, createdAt, updatedAt, highlights, uniques, @@map
  achievements      WeeklyAchievement[]
  // removed: achievement, outstandingIssue, lessonLearned, nextWeekFocus, managerDecision
}

// One Reflection achievement — one row of Monday's Reflection table. Every
// Reflection text belongs to the row (D2); Health and Status stay on the week.
model WeeklyAchievement {
  id               Int          @id @default(autoincrement())
  weeklyUpdateId   Int          @map("weekly_update_id")
  weeklyUpdate     WeeklyUpdate @relation(fields: [weeklyUpdateId], references: [id], onDelete: Cascade)
  position         Int
  title            String       @db.VarChar(200)
  detail           String?      @db.Text
  outstandingIssue String?      @map("outstanding_issue") @db.Text
  lessonLearned    String?      @map("lesson_learned") @db.Text
  nextWeekFocus    String?      @map("next_week_focus") @db.Text
  managerDecision  String?      @map("manager_decision") @db.Text
  createdAt        DateTime     @default(now()) @map("created_at")
  updatedAt        DateTime     @updatedAt @map("updated_at")

  @@unique([weeklyUpdateId, position])
  @@map("weekly_achievements")
}
```

**Migration** `weekly_achievements` — same procedure as `20260909030050_weekly_highlights` (the `migrate dev -it` path fails without a TTY in this harness: use `prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url … --script` or `--create-only`, splice the data move, then `migrate deploy` + `prisma generate`; verify Prisma's generated names with `migrate diff --from-empty`; if the file must be edited after apply, use the `_prisma_migrations` checksum UPDATE recipe in every local DB that carries the row). Target shape:

```sql
-- CreateTable (generated; keep Prisma's names)
CREATE TABLE "weekly_achievements" (
  "id" SERIAL NOT NULL, "weekly_update_id" INTEGER NOT NULL, "position" INTEGER NOT NULL,
  "title" VARCHAR(200) NOT NULL, "detail" TEXT,
  "outstanding_issue" TEXT, "lesson_learned" TEXT, "next_week_focus" TEXT, "manager_decision" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "weekly_achievements_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "weekly_achievements_weekly_update_id_position_key" ON "weekly_achievements"("weekly_update_id", "position");
ALTER TABLE "weekly_achievements" ADD CONSTRAINT "weekly_achievements_weekly_update_id_fkey"
  FOREIGN KEY ("weekly_update_id") REFERENCES "weekly_updates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Data move (D8): one row at position 0 per week that has any Reflection text.
INSERT INTO "weekly_achievements" ("weekly_update_id", "position", "title", "detail", "outstanding_issue", "lesson_learned", "next_week_focus", "manager_decision", "created_at", "updated_at")
SELECT
  h."id", 0,
  COALESCE(NULLIF(LEFT(h."first_line", 200), ''), 'Untitled'),
  CASE
    WHEN h."text" IS NULL THEN NULL
    WHEN LENGTH(h."first_line") > 200 THEN h."text"
    WHEN POSITION(E'\n' IN h."text") = 0 THEN NULL
    ELSE NULLIF(BTRIM(SUBSTRING(h."text" FROM POSITION(E'\n' IN h."text") + 1), E' \t\r\n'), '')
  END,
  h."outstanding_issue", h."lesson_learned", h."next_week_focus", h."manager_decision",
  h."updated_at", h."updated_at"
FROM (
  SELECT
    wu."id", wu."outstanding_issue", wu."lesson_learned", wu."next_week_focus", wu."manager_decision", wu."updated_at",
    NULLIF(BTRIM(replace(replace(wu."achievement", E'\r\n', E'\n'), E'\r', E'\n'), E' \t\r\n'), '') AS "text",
    BTRIM(split_part(COALESCE(NULLIF(BTRIM(replace(replace(wu."achievement", E'\r\n', E'\n'), E'\r', E'\n'), E' \t\r\n'), ''), ''), E'\n', 1), E' \t\r') AS "first_line"
  FROM "weekly_updates" wu
) h
WHERE h."text" IS NOT NULL OR h."outstanding_issue" IS NOT NULL OR h."lesson_learned" IS NOT NULL OR h."next_week_focus" IS NOT NULL OR h."manager_decision" IS NOT NULL;

-- AlterTable
ALTER TABLE "weekly_updates" DROP COLUMN "achievement", DROP COLUMN "outstanding_issue", DROP COLUMN "lesson_learned", DROP COLUMN "next_week_focus", DROP COLUMN "manager_decision";
```

Storage rule unchanged: a text is `null` when empty after trim; `title` is never empty.

## 3. API

`backend/src/routes/customers.ts`, `backend/src/routes/dailyReview.ts` — not spine.

### `PUT /customers/:id/weekly-updates/:weekStart` (changed)

Body — every key optional; `highlight`-style rules:

```ts
{
  health?, status?, category?, highlights?,            // unchanged
  achievements?: Array<{                               // ≤ 20 items
    title: string,                                     // trim → 1–200 code points ([...s].length), no \r or \n
    detail?, outstandingIssue?, lessonLearned?, nextWeekFocus?, managerDecision?: string | null   // ≤ 8000 each
  }>
}
// removed keys: achievement, outstandingIssue, lessonLearned, nextWeekFocus, managerDecision
```

Rules:
1. `achievementInputSchema` mirrors `highlightInputSchema` (same trim/refine/limits); `achievements: z.array(...).max(20).optional()`.
2. Present → inside the existing `$transaction`: `weeklyAchievement.deleteMany` then `createMany` with `position = index`, texts through `normalizeText`. `[]` → delete only. Omitted → untouched.
3. Done rule (D7): `effectiveAchievementCount = body.achievements !== undefined ? body.achievements.length : (existing?._count.achievements ?? 0)`; DONE with `effectiveHealth == null || effectiveAchievementCount === 0` → 400 `weekly_update_incomplete` (same code, message updated: "Marking a weekly update done requires health and at least one achievement").
4. `midweekTouched` unchanged (Mid-week fields only).
5. Response: `weeklyUpdateInclude` gains `achievements: { orderBy: { position: "asc" }, select: { id, position, title, detail, outstandingIssue, lessonLearned, nextWeekFocus, managerDecision } }`.

### `GET /customers/:id/weekly-updates` (changed)
Same include. Ordering, `limit`, permissions unchanged.

### `GET /daily-review` (changed)
- `weeklyUpdate`: drop the five fields; add `achievements` via the relation select (one extra batched query).
- `previousWeeklyUpdate`: `{ weekStart, achievements: { title, outstandingIssue, nextWeekFocus, managerDecision }[] } | null` — `null` when last week has no row; otherwise the rows that have at least one of the three texts (filtered in code after a relation select with `orderBy position`). The old three keys go.

## 4. Frontend

### Data layer — `frontend/src/lib/queries.ts` (**spine**, instant review after T4)

```ts
export interface WeeklyAchievement { id: number; position: number; title: string; detail: string | null; outstandingIssue: string | null; lessonLearned: string | null; nextWeekFocus: string | null; managerDecision: string | null; }
export interface WeeklyAchievementInput { title: string; detail?: string | null; outstandingIssue?: string | null; lessonLearned?: string | null; nextWeekFocus?: string | null; managerDecision?: string | null; }
// WeeklyUpdate: remove the five text fields; add `achievements: WeeklyAchievement[]`.
// SaveWeeklyUpdateInput: remove the five; add `achievements?: WeeklyAchievementInput[]`.
// WeeklyUpdateCarryOver: { weekStart: string; achievements: Pick<WeeklyAchievement, "title" | "outstandingIssue" | "nextWeekFocus" | "managerDecision">[] }
```

### Draft helper — `frontend/src/lib/weeklyDraft.ts`
- Add `draftWeeklyAchievements(customer, week): WeeklyAchievementInput[]` per D9: `customer.weeklyUpdate?.highlights ?? []` → `{ title, detail }`; then notes with day `> week.days[2]` (Thursday onward) through the same `highlightFromNote` rule (reuse `splitTitle`, `cut`, `bracketFor`); no highlights → all `week.days`. Pure; deterministic.
- Remove `draftWeeklyUpdate`, `buildDayRows` and their tests (D13). Update the header comment.
- Tests: highlights first in order; Thu–Sun notes appended in day order; Mon–Wed notes skipped when highlights exist; fallback to the whole week with no highlights; empty week → `[]`; a highlight's detail copied verbatim.

### Table builders — `frontend/src/lib/weeklySyncTable.ts`
- `hasManagerDecision(customer)` → `customer.weeklyUpdate?.achievements.some(a => hasText(a.managerDecision)) ?? false` (D10).
- `hasTabUpdate("reflection")` → `u.status === "DONE" || u.achievements.length > 0`.
- `buildSyncTable("reflection")`: one row per achievement `[name, detail ? title\ndetail : title, cellText(outstandingIssue), cellText(lessonLearned), cellText(nextWeekFocus), cellText(managerDecision)]`; a customer with no achievement → one row with `—` in the five text cells. Header unchanged.
- Tests: fixture gains `achievements: []` and loses the five fields; `hasManagerDecision` from rows; the reflection `hasTabUpdate` cases; two achievements → two rows with the customer repeated; title + detail joined with `\n`; the dash row.

### Reflection form — `frontend/src/components/daily-review/ReflectionSyncModal.tsx`
To the mockup ("Reflection sync form · AFTER"). Mirror `MidweekSyncModal.tsx`'s list mechanics (state with keyed drafts, blank starter card, `Add`/`Remove`, focus on add, cap 20 with helper, drop-blank/require-title on submit, draft confirm when a card holds text, draft cut at 20 and kept at one blank card when empty).
- `widthClass="max-w-3xl"`. Health group + helper unchanged, above the list.
- Section label **Achievements** with `· one needed to mark done` in primary, action link "Draft from this week"; helper "One row in Monday's table per achievement, with its own Outstanding issue, Lesson learned, Next week focus and decision. The draft starts from this week's Mid-week highlights, then adds Thursday to Sunday's notes. Title: one line, 200 characters max."
- Card (`data-testid="reflection-achievement-{n}"`): `ACHIEVEMENT n` + "Remove" (`aria-label="Remove achievement n"`); Title `Input` (`maxLength=200`, `aria-label="Achievement n title for {customer.name}"`); "Add detail" link → Detail `Textarea` (`aria-label="Achievement n detail for {customer.name}"`); a `grid gap-3 sm:grid-cols-2` of Outstanding issue, Lesson learned, Next week focus, Need manager decision `Textarea`s (`min-h-16`, `aria-label="Achievement n outstanding issue for {customer.name}"`, `… lesson learned …`, `… next week focus …`, `… need manager decision …`); the decision helper "Leave empty if no decision is needed. A filled row pins the customer to the top of Monday's table." under its textarea.
- "Add achievement" button (accessible name exactly that).
- Draft: `draftWeeklyAchievements(customer, week)`; `ConfirmModal` body "Replace the achievements with a draft from this week?" (title "Draft from this week", label "Draft", warning tone).
- `canMarkDone = state.health !== null && kept.some(c => c.title.trim() !== "")` where `kept` excludes entirely blank cards; the same rule for "Save" on a Done week (as today). Submit sends `{ weekStart, health, status, achievements }`.
- "Save draft", "Mark done", "Reopen as draft" and the reopen confirm: unchanged. Nothing per week below the list.

### Mid-week form — `frontend/src/components/daily-review/MidweekSyncModal.tsx`
Carry-over panel (D11), to the mockup ("Mid-week form · carry-over panel · AFTER"): title `From last Friday · Week N · M items`; per item a 13px semibold title, then `grid grid-cols-1 gap-2 sm:grid-cols-[150px_1fr]` rows for the present texts (Outstanding issue / Next week focus / Manager decision); items divided by `border-t border-outline-variant`; the panel renders only when `previousWeeklyUpdate?.achievements.length > 0`. Nothing else changes.

### Weekly Sync page — `frontend/src/pages/WeeklySync.tsx`
- Subtitle: "One row per highlight and per achievement. Wednesday and Friday tables, read on Monday."
- Reflection `SyncRow` → `ReflectionBlock`, same wrapper contract as `MidweekBlock` (`role="button"`, keyboard, `data-testid="weekly-sync-row-{id}"`, direct child of the container): first row Customer (+ Category), Health, Status; each achievement row: title (+ note icon `role="img"` when detail) and the four text cells; continuation rows leave Customer/Health/Status empty with no top border, text cells with `border-t border-surface-container`. No achievements → one dash row. Groups/pinning use `hasManagerDecision` (rows); the count stays customers. `REFLECTION_GRID_COLS` unchanged.

### Customer page — `frontend/src/pages/CustomerDetail.tsx`
`WeeklyUpdateRow`: the five-field grid becomes a list `Achievements · N`: per achievement the title (`wrap-break-word`, `isDone` muting), the detail (13px, pre-wrap), then a 2-column grid of `WeeklyUpdateField` Outstanding issue / Lesson learned / Next week focus / Need manager decision (the last spans both columns, amber label). The mid-week section unchanged.

### Fixtures
`weeklySyncTable.test.ts`, `dailyReviewStats.test.ts`: replace the five fields with `achievements: []`.

## 5. Tests

### Backend — `backend/test/weeklyUpdates.test.ts`
Update every test that sends/asserts the five fields (Done rule tests use a one-item `achievements` list; the whitespace test uses a card text; the list-shape test asserts `achievements`). Add: two items → positions 0/1, six fields trimmed, empty texts → null; omit leaves; `[]` clears; DONE with `achievements: []` → 400; DONE with stored rows and an omitted list → 200; DONE with no stored rows → 400; a title of 201 code points / with `\n` / whitespace-only → 400; 21 items → 400; a Mid-week save (`highlights` only) leaves the achievements; list endpoint returns `achievements` ordered.

### Backend — `backend/test/dailyReview.test.ts`
`weeklyUpdate` carries `achievements` ordered with eight fields and no old keys; `previousWeeklyUpdate`: null with no prior row; `{ weekStart, achievements: [] }` when last week's rows carry none of the three; the filtered rows with exactly four keys each, in position order.

### Frontend unit — `weeklyDraft.test.ts`, `weeklySyncTable.test.ts`
Per §4.

### Playwright — `e2e/tests/daily-review.spec.ts`, `e2e/tests/weekly-sync.spec.ts`
- Daily Review step 6: click `Reflection sync`; "Draft from this week"; assert `Achievement 1 title for {customer}` contains the project note's first line (the Mid-week highlight is absent in this flow, so the fallback drafts the whole week) and some card carries the operations note bracket; pick Amber; Mark done; tile delta + collapsed group as today. Step 7: the customer page shows the achievement title.
- Weekly Sync test 1: fill `Achievement 1 title for {name}` and `Achievement 1 need manager decision for {name}`; click `Add achievement`; fill `Achievement 2 title`; Green; Save draft → pinned group, count +1, both titles visible in the block (two rows); reload keeps it; the Mid-week tab still says "Not filled". Test 2: `Achievement 1 title`; copy contains the name and the title. Test 3 (highlights) unchanged.

## 6. Task list

8 tasks. `solvro-implementor` each; scoped checks only; report CHANGELOG entry text; the orchestrator is the one CHANGELOG writer. Backend implementors in parallel use `solvro_t1_test` / `solvro_t2_test`. **Frontend typecheck: at most one at a time in the container** — in W4 the implementors skip the container typecheck and the orchestrator runs it once at integration (CLAUDE.md trap, 2026-09-09).

### T1 — Schema and migration
**Files:** `backend/prisma/schema.prisma`, migration `<ts>_weekly_achievements` — **spine**; plus the minimum compile edits in `routes/customers.ts`, `routes/dailyReview.ts` (drop the five fields, the carry-over select) and the two backend test files (swap the five fields for `category`/`highlights` where a test only exercises mechanics). Verify the data move with two throwaway rows (a 3-line achievement + the four texts; a decision-only week → "Untitled" with the decision carried), delete them, `migrate status` clean. After applying: `docker compose restart backend` (stale Prisma client trap). Scoped checks on `solvro_t1_test`.

### T2 — Save and list routes
**Files:** `backend/src/routes/customers.ts`, `backend/test/weeklyUpdates.test.ts`. §3 PUT/GET, the Done rule with `_count`, tests per §5.

### T3 — Daily-review payload and carry-over rows
**Files:** `backend/src/routes/dailyReview.ts`, `backend/test/dailyReview.test.ts`. §3 daily review; tests per §5. DB `solvro_t2_test`.

### T4 — Types, draft, table builders
**Files:** `frontend/src/lib/queries.ts` (**spine**), `weeklyDraft.ts` + test, `weeklySyncTable.ts` + test, `dailyReviewStats.test.ts`; interim compile edits (marked `// T4 interim`) in `ReflectionSyncModal.tsx`, `MidweekSyncModal.tsx` (carry-over reads), `WeeklySync.tsx`, `CustomerDetail.tsx` reading `achievements[0]`.

### T5 — Reflection form and the carry-over panel
**Files:** `ReflectionSyncModal.tsx`, `MidweekSyncModal.tsx` (panel only). §4. No container typecheck (orchestrator runs it).

### T6 — Weekly Sync page
**Files:** `frontend/src/pages/WeeklySync.tsx`. §4. No container typecheck.

### T7 — Customer page
**Files:** `frontend/src/pages/CustomerDetail.tsx`. §4. No container typecheck.

### T8 — Playwright
**Files:** `e2e/tests/daily-review.spec.ts`, `e2e/tests/weekly-sync.spec.ts`. §5; run both spec files against the dev stack (`BASE_URL=http://localhost:5173`).

## 7. Waves and gates

| Wave | Tasks | Notes |
|---|---|---|
| W1 | T1 | Solo. `open -a Docker` first. Gates + **instant opus review** (schema spine). |
| W2 | T2 ∥ T3 | `solvro_t1_test` / `solvro_t2_test`. Gates. |
| W3 | T4 | Solo. Gates + **instant opus review** (`queries.ts`). |
| W4 | T5 ∥ T6 ∥ T7 | Disjoint files; ONE orchestrator typecheck at integration. Gates. |
| W5 | T8 | Dev stack on W4's tree (`docker compose restart backend` if a route 500s). Gates. |
| Close | — | Phase review (opus; design lens; data lens on the migration; the reviewer must not run tsc/vitest/Playwright during the gates smoke) → docs-keeper if triggered → screenshots (Reflection tab, form, carry-over panel) → stage → commit messages per task + PR body → **stop for approval**. `TaskStop` every agent. |

Fix rounds continue the same implementor via `SendMessage`. Sonnet floor. Never poke an idle agent for a report — read the tree.

## 8. CHANGELOG headline (draft, orchestrator-owned)

Under `[Unreleased]` → `### Changed — <date> — Weekly Sync: one row per achievement, with its own outstanding issue, lesson learned, next week focus and decision`. One bullet per file group; a Removed line for the five columns and `draftWeeklyUpdate`.

## 9. Out of scope

Everything in D15 · a Highlight column on the Reflection copy · any change to the Mid-week list.
