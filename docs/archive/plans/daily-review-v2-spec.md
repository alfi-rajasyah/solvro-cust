# Daily Review v2 — Spec & Plan

**Status:** approved for planning 2026-08-29 (all product decisions settled — see §3). Not yet implemented.
**Branch:** `feat/daily-review-v2`, cut from up-to-date `origin/develop`. Phase = branch = one PR into `develop`. Tasks = commits. No commit/PR without explicit user approval.
**Mockup:** https://claude.ai/code/artifact/73008889-a96d-4545-ba4a-74eb48036557 (version `v2-per-customer`). The mock is the visual contract; `docs/DESIGN.md` is binding for tokens and components.

## 1. Problem

The Daily Review page (`frontend/src/pages/DailyReview.tsx`, route `/daily-review`) is a write-only note form. Facts from the code on 2026-08-29:

- `useProjectNotes` has one consumer: `DailyReview.tsx`. No page reads a note back. The only reader (the Reports export) was removed 2026-08-03.
- The page is "today only": no history, no backfill, no edit, no delete (`ProjectNote` has no `updatedAt`; `routes/projects.ts` has no PATCH/DELETE for notes).
- Overdue tasks and open risks are counts, not items. Nothing on the card is actionable.
- "Reviewed" = wrote a note today (`DailyReview.tsx:337`). A project with nothing to report cannot be reviewed.
- Operational issues (incidents, requests, escalations that belong to no project) have no home. `WorkLogs.tsx` is an unbuilt placeholder for the future iTop integration and stays untouched.
- There is no weekly cadence. TAMs write weekly updates elsewhere, re-typing the week.
- Each card fires 3 requests (tasks, risks, notes `limit: 50`). 10 projects = 30 requests.
- 0 e2e tests cover the page.

## 2. Goals / Non-goals

**Goals**

1. Daily notes are the raw material for a weekly update per customer, drafted from them on the same page.
2. Operations notes (no project) live under the customer.
3. Notes are readable, editable by their author, and surface on the customer and project pages.
4. Reviewing a project is an explicit, timestamped action.
5. Overdue tasks and open risks are lists with inline status change.
6. One request per page load; sub-200ms p95 with 20 active projects (backend NFR).

**Non-goals (this phase)**

- iTop integration / `WorkLogs.tsx` (standing decision: wait for that spec). The ticket-reference field from the first cut was removed on 2026-08-29 (Decision 4).
- Any export of notes or weekly updates (Guardrail: INTERNAL notes never appear in exports; no export surface exists).
- Reminders, notifications, email of the weekly update. Solvro sends nothing.
- Executive-page aggregation of weekly health (later phase).
- Editing another user's notes (wildcard users may delete only).

## 3. Decisions (settled 2026-08-29 — do not re-litigate)

| # | Decision | Choice |
|---|---|---|
| 1 | Internal / Customer-facing toggle | **Removed from the UI.** `ProjectNote.visibility` column stays, default `INTERNAL`. No data migration. The Guardrail stays true unchanged. |
| 2 | Weekly update unit | **Per customer**, not per project. |
| 3 | Project with no `customerId` | **Blocked** from weekly updates; banner with "Assign customer". Daily notes and Mark reviewed still work. |
| 4 | Operations note fields | **Title + body.** Title is typed manually (required, 1–120 chars) — user decision 2026-08-29, replacing the service select. The ticket ref (first cut) and the service link (second cut) are both removed. |
| 5 | Page location | **Own page**, same route `/daily-review` and same `NAV_COMMANDS` entry. |
| 6 | Weekly health | **Enum** `GREEN / AMBER / RED`, required when status is `DONE`. |
| 7 | Week length | **7 days**, Monday start, ISO week keys (`2026-W35`). |
| 8 | Who sets `Customer.tamId` | **`project:write`** — the same gate the customer form uses today (`routes/customers.ts:73-157`). `customer:write` does not exist; no new permission. |
| 9 | Edit / delete notes | Author only. Wildcard (`*`) users may delete any note. |
| 10 | "Re-draft from notes" | Replaces the weekly text after a confirm dialog. |
| 11 | Final weekly state | Named **Done** (not "Sent"). |
| 12 | Components | Vendored `frontend/src/components/ui/*` (Base-UI) + `reui/alert`, `reui/badge`. No new packages. `ProjectStatusChip` stays bespoke. |
| 13 | Project scope on the page | `ACTIVE` projects where `tamId = me`; wildcard or `project:view-all` sees all `ACTIVE`. Mirrors today's page. |
| 15 | Customer groups | Every customer group is manually collapsible/expandable (header toggle). A group whose projects are all reviewed today and whose weekly update is Done starts collapsed; a day-strip click expands the group holding the first project. (user, 2026-08-29) |
| 16 | Week rows on a card | The Mon–Sun note rows are collapsible per card. Collapsed = today's row (its notes + input) plus a "Show week · N notes" toggle; expanded = all 7 days. Default collapsed. A day-strip click expands the first card. (user, 2026-08-29) |
| 17 | Focus treatment | New components use `focus-visible:ring-2 focus-visible:ring-primary/30` without `border-primary`; `docs/DESIGN.md` §4 is updated to this reduced form (user, 2026-08-29). |
| 18 | `ConfirmModal` raw palette | Pre-existing `bg-amber-500` / `rounded-lg` in `ConfirmModal.tsx` deferred to `docs/ISSUES.md` (user, 2026-08-29). |
| 19 | Commits | One commit per task, wave order; CHANGELOG lines travel with their task (user, 2026-08-29). |
| 20 | Day-strip coverage and "Reviewed today" tile | **Per customer** (user, 2026-08-29): coverage = customers with ≥1 project or operations note that day / customers on the page; Reviewed today = customers whose every active project is reviewed today / customers with ≥1 project. The "No customer" group is excluded from both; a group header keeps its own `x / y reviewed` project count. |
| 14 | Customer scope on the page | Customers of the in-scope projects ∪ customers where `Customer.tamId = me` (view-all users: ∪ every customer with `tamId` set). |

## 4. Data model (`backend/prisma/schema.prisma`)

All date-picked columns are calendar days stored as `@db.Date`; Prisma serialises them as `T00:00:00.000Z` instants, which the frontend reads via `dayFromIso` — consistent with the date contract (`docs/plans/date-contract-utc-midnight.md`). Backend validators accept `"yyyy-MM-dd"` (`isValidDayString`) and convert via `utcMidnightOfDayString` (`backend/src/lib/dateBoundary.ts`).

```prisma
model Customer {
  // existing fields …
  tamId          Int?            @map("tam_id")
  tam            User?           @relation("CustomerTam", fields: [tamId], references: [id], onDelete: SetNull)
  notes          CustomerNote[]
  weeklyUpdates  WeeklyUpdate[]
  @@index([tamId])
}

model ProjectNote {
  // existing fields …
  noteDate   DateTime  @map("note_date") @db.Date   // backfilled: created_at::date  -- plain cast: created_at is a naive UTC timestamp; AT TIME ZONE would make it session-TZ dependent
  updatedAt  DateTime  @updatedAt @map("updated_at")
  @@index([projectId, noteDate])
}

model CustomerNote {
  id          Int       @id @default(autoincrement())
  customerId  Int       @map("customer_id")
  customer    Customer  @relation(fields: [customerId], references: [id], onDelete: Cascade)
  authorId    Int       @map("author_id")
  author      User      @relation(fields: [authorId], references: [id])
  noteDate    DateTime  @map("note_date") @db.Date
  body        String    @db.Text
  title       String    @db.VarChar(120)   // typed manually (Decision 4)
  createdAt   DateTime  @default(now()) @map("created_at")
  updatedAt   DateTime  @updatedAt @map("updated_at")
  @@index([customerId, noteDate])
  @@index([authorId])
  @@map("customer_notes")
}

enum WeeklyHealth { GREEN AMBER RED }
enum WeeklyStatus { NOT_STARTED DRAFT DONE }

model WeeklyUpdate {
  id          Int           @id @default(autoincrement())
  customerId  Int           @map("customer_id")
  customer    Customer      @relation(fields: [customerId], references: [id], onDelete: Cascade)
  weekStart   DateTime      @map("week_start") @db.Date      // ISO Monday
  authorId    Int           @map("author_id")
  author      User          @relation(fields: [authorId], references: [id])
  body        String        @db.Text
  health      WeeklyHealth?
  status      WeeklyStatus  @default(DRAFT)
  doneAt      DateTime?     @map("done_at")
  createdAt   DateTime      @default(now()) @map("created_at")
  updatedAt   DateTime      @updatedAt @map("updated_at")
  @@unique([customerId, weekStart])
  @@map("weekly_updates")
}

model ProjectReview {
  id          Int       @id @default(autoincrement())
  projectId   Int       @map("project_id")
  project     Project   @relation(fields: [projectId], references: [id], onDelete: Cascade)
  userId      Int       @map("user_id")
  user        User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  reviewDate  DateTime  @map("review_date") @db.Date
  createdAt   DateTime  @default(now()) @map("created_at")
  @@unique([projectId, userId, reviewDate])
  @@index([userId, reviewDate])
  @@map("project_reviews")
}
```

- `NoteVisibility` enum and `ProjectNote.visibility` stay. Comment on the enum is reworded: toggle removed from the UI; INTERNAL is the only value the UI writes.
- Migration: one, `daily_review_v2`, via `docker compose exec -it backend npx prisma migrate dev --name daily_review_v2`. The migration SQL must add `project_notes.note_date` as nullable, backfill it from `created_at` (UTC date), then set `NOT NULL`. Never edit committed SQL afterwards.
- `WeeklyUpdate` rows are created on first save; `NOT_STARTED` is the client-side state for "no row". The enum value exists so a saved update can be reset without deletion.

## 5. API

Routers mount bare (no `/api` prefix). `requireAuth` on every router; writes gated by `requirePermission("project:write")`. Validation via `validate(...)` with Zod schemas at the top of each file; errors via `HttpError`.

### 5.1 `GET /daily-review` — new file `backend/src/routes/dailyReview.ts`, mounted in `app.ts`

Query: `week` (`^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$`, must be a valid ISO week for that year — `2026-W53` is valid, `2025-W53` is not), `today` (day string, `isValidDayString`). Both required.

Scope per Decisions 13–14. Uses `projectVisibilityFilter(user)` from `lib/visibility.ts` ANDed with `tamId = user.sub` for non-view-all users — never re-derived ad hoc.

Response (TypeScript shape, also the frontend type `DailyReviewResponse` in `queries.ts`):

```ts
{
  week: { key: "2026-W35"; start: "2026-08-24"; days: string[] /* 7 day strings */ };
  today: "2026-08-28";
  coverage: Record<string /* day */, { withNote: number; total: number }>;  // customers with ≥1 note (project or operations) that day / customers on the page (Decision 20)
  customers: DailyReviewCustomer[];   // sorted by name
  unassignedProjects: DailyReviewProject[];  // customerId null
}
DailyReviewCustomer = {
  id; name; tam: { id; username } | null;
  projects: DailyReviewProject[];                 // ACTIVE + in scope, sorted by name
  operationsNotes: CustomerNoteDto[];             // this week, noteDate asc
  weeklyUpdate: WeeklyUpdateDto | null;           // for week.start
}
DailyReviewProject = {
  id; name; status; customerId; baselineLockedAt;
  phase: string;                                  // port of DailyReview.tsx currentPhase()
  progress: { done: number; total: number };
  slipDays: number | null;                        // port of scheduleSignal(); null = no baseline dates
  overdueTasks: { id; title; dueDate; status }[]; // status != DONE, dueDate < overdueBoundary(today)
  openRisks: { id; description; probability; impact; status }[];  // status OPEN; severity = probability × impact, computed client-side
  notes: ProjectNoteDto[];                        // this week, noteDate asc, all authors
  reviews: { reviewDate: string; createdAt: string }[];  // requesting user's reviews in the week
}
ProjectNoteDto  = { id; noteDate; body; author: { id; username }; updatedAt }
CustomerNoteDto = ProjectNoteDto & { title: string }  // same shape as GET/POST/PATCH /customers/:id/notes
WeeklyUpdateDto = { id; weekStart; body; health; status; doneAt; author; updatedAt }
```

Overdue uses `overdueBoundary(today)` from `lib/dateBoundary.ts` (same rule as the tasks route). Where `lib/portfolio.ts` already computes a value (`isOverdue`), reuse it rather than duplicating.

### 5.2 Notes — `backend/src/routes/projects.ts` (spine → instant review)

- `GET /projects/:id/notes` gains `from`, `to` (day strings, inclusive, optional). `visibility` and `limit` stay for API compatibility.
- `POST /projects/:id/notes` body gains `noteDate` (day string, optional; default = UTC date of now). `visibility` stays optional, default `INTERNAL`; the UI never sends it.
- `PATCH /projects/:id/notes/:noteId` body `{ body?: string(1..4000) }` — author only, else 403 `not_note_author`.
- `DELETE /projects/:id/notes/:noteId` — author or wildcard, else 403.
- `POST /projects/:id/reviews` body `{ reviewDate }` — upsert on the unique; returns the row (201 on create, 200 on existing).
- `DELETE /projects/:id/reviews/:reviewDate` — own review only; 204.
All keep `ensureProjectVisible` (404 for hidden projects).

### 5.3 Customers — `backend/src/routes/customers.ts`

- `createCustomerSchema` / `updateCustomerSchema` gain `tamId: z.number().int().positive().nullable().optional()`. Customer GETs include `tam: { select: { id, username } }`.
- `GET /customers/:id/notes?from&to` · `POST /customers/:id/notes` body `{ title, body, noteDate? }` — `title` required, trimmed, 1–120 chars (400 otherwise).
- `PATCH /customers/:id/notes/:noteId` `{ title?, body? }` — author only. `DELETE` — author or wildcard.
- `GET /customers/:id/weekly-updates` — all weeks, `weekStart` desc, `limit` ≤ 52 default 12.
- `PUT /customers/:id/weekly-updates/:weekStart` body `{ body: string(0..8000); health?: WeeklyHealth | null; status: "DRAFT" | "DONE" | "NOT_STARTED" }` — upsert on `(customerId, weekStart)`. `DONE` requires non-empty `body` and non-null `health` (400 `weekly_update_incomplete`) and sets `doneAt = now()`; leaving `DONE` clears `doneAt`. `weekStart` param must be a Monday (400 `week_start_not_monday`). `authorId` = last writer.

Customer routes have no visibility filter today (all authed users read all customers); that stays.

### 5.4 ISO week helpers

- `backend/src/lib/isoWeek.ts` — pure UTC arithmetic, no new dependency: `parseWeekKey(key) → { start: day; days: day[7] } | null`, `weekKeyOf(day) → key`.
- `frontend/src/lib/isoWeek.ts` — same API, may use `date-fns` (already installed, v4): `startOfISOWeek`, `getISOWeek`, `getISOWeekYear`, `addWeeks`; plus `shiftWeek(key, ±1)`.
- Both tested with the same fixtures: `2026-W01` → `2025-12-29`; `2026-W53` → `2026-12-28` (2026 is a 53-week ISO year); `2027-W01` → `2027-01-04`; `weekKeyOf("2026-01-01") === "2026-W01"`; `weekKeyOf("2027-01-01") === "2026-W53"`.

## 6. Frontend

### 6.1 Server state — `frontend/src/lib/queries.ts` (spine → instant review)

`queryKeys` additions:

```ts
dailyReview: (week: string, today: string) => ["daily-review", week, today] as const,
customerWeeklyUpdates: (id: number) => ["customers", id, "weekly-updates"] as const,
```

`projectNotes` key gains the optional `from`/`to` window. Hooks:

- `useDailyReview(week)` — `today = dateToDay(new Date())` is part of the key (same rationale as `useOverview`).
- `useAddProjectNote(projectId)` — body becomes `{ body, noteDate }`; callers no longer pass `visibility`.
- `useUpdateProjectNote(projectId)`, `useDeleteProjectNote(projectId)`
- `useAddCustomerNote(customerId)`, `useUpdateCustomerNote`, `useDeleteCustomerNote`
- `useMarkProjectReviewed(projectId)`, `useUnmarkProjectReviewed(projectId)`
- `useSaveWeeklyUpdate(customerId)` (PUT upsert), `useCustomerWeeklyUpdates(customerId)`
- Inline status changes on the attention lists reuse the existing task-status and risk-status mutation hooks (implementor verifies their names); those hooks additionally invalidate `["daily-review"]` by prefix in `onSettled`.

Every mutation above invalidates `["daily-review"]` (prefix) in `onSettled`. Note add/edit/delete and Mark reviewed use the optimistic pattern (`onMutate` cancel + snapshot + write, `onError` rollback, `onSettled` invalidate) — they are the inline edits of this page. Weekly update save is a plain mutation with a pending state.

### 6.2 Pure modules

- `frontend/src/lib/weeklyDraft.ts` — `draftWeeklyUpdate(customer: DailyReviewCustomer, week): string`. Output: one paragraph per project (`"<Project name> — Mon 24: <body> · Tue 25: <body>"`), then one `"Operations — Mon 24 [<title>]: <body>"` paragraph if any operations notes exist; notes in `noteDate` order; days without a note are skipped; a trailing `"Next week — "` line is always appended. A day with 2+ notes moves the bracket onto each body: `Mon 24: [Oslo outage] body / [Backup job] body` (the bracket is the note's title, always present; project notes simply read `Mon 24: body / body`). All API date fields are ISO instants — group by `dayFromIso(noteDate)`. Vitest-covered, with ISO-instant fixtures.
- `frontend/src/lib/isoWeek.ts` — §5.4.

### 6.3 Page — `frontend/src/pages/DailyReview.tsx` (rewrite in place; named export `DailyReview` and route unchanged)

URL state: `/daily-review?week=2026-W35`; no param = current week. Prev / next buttons and the day strip are per the mock (pin 1). Structure, top to bottom:

1. Header: title, today's date + username, week navigation.
2. Day strip: 7 buttons, `coverage[day].withNote / total`; today outlined; Sat/Sun muted. Clicking a day scrolls to the first card and focuses that day's row (no filtering).
3. Stats bar (5 tiles, derived client-side from the payload): Reviewed today `n / projects`; Notes this week (project + operations); Weekly updates `done / customers` (unassigned group excluded); Overdue tasks; Open risks.
4. Customer groups (sorted by name), each with: group header (name, active-project count, TAM username), project cards, one Operations card, one Weekly update block. A group whose projects are all reviewed today and whose weekly update is `DONE` collapses to one row with an Expand link (pin 3).
5. "No customer" group: warning banner + project cards without a weekly block (pin 8). Banner link opens the project's edit modal (customer field).
6. Loading skeleton (`ui/skeleton`), error `reui/alert`, empty state (no in-scope projects and no owned customers).

Project card (pin 4, 5): header (kind tag "Project", name link to `/projects/:id/overview`, `ProjectStatusChip`, schedule chip from `slipDays`, Reviewed badge or "Mark reviewed" button); metrics row (Phase, Progress); attention row (overdue tasks with a `ui/select` status control; open risks with a status control; or "Nothing overdue · no open risks"); week rows Mon–Sun (each: day label, note body or "No note", Edit/Add), today's row is the input (`ui/textarea`, ⌘↵ saves, Save button). Editing a past day turns that row into the same input with Save / Cancel; Delete lives in the edit state. Clicking the Reviewed badge asks "Remove today's review mark?" → unmark.

Operations card (pin 6): kind tag "Operations", "<Customer> · issues outside a project", note count; week rows show the note's title in semibold before the body; today's input has a required `ui/input` "Title" (max 120) + textarea; Save is disabled until both are filled.

Weekly update block (pin 7): title, `Week NN · <Customer>`, status chip (`reui/badge`: Not started neutral / Draft amber / Done emerald), health `ui/button-group` (Green / Amber / Red, radiogroup), source line ("Drafted from N notes (p project, o operations)" or "N notes this week"), textarea (hidden in Not started state; "Draft from this week's notes" button instead), actions: Save draft (ghost), Mark done (primary; disabled until body + health present), and in Done state: Reopen (ghost). "Re-draft from notes" confirms before replacing text.

Removed: `VisibilityToggle`, the customer-facing callout, the per-card 3-query fan-out, `reportMetrics` lifting.

Design: tokens and radii per `docs/DESIGN.md`; chips use the chip tint pairs; no arbitrary hex; mobile down to 375px (day strip wraps 4 + 3, attention columns and operations fields stack, cards edge-to-edge).

### 6.4 Other surfaces

- `frontend/src/components/CustomerFormModal.tsx` — "TAM" select (`useUsers()`), nullable; sends `tamId`.
- `frontend/src/pages/CustomerDetail.tsx` — new "Weekly updates" section: list by week desc, week label, health chip, status chip, body, author + `doneAt`. Reads `useCustomerWeeklyUpdates`. Shows the TAM in the header meta.
- `frontend/src/pages/views/ProjectOverview.tsx` — "Notes" block: last 14 days (`from`/`to`), day label + body + author. Read-only here.
- `frontend/src/lib/navCommands.ts` — unchanged.

## 7. Guardrail check

- INTERNAL notes never appear in exports: no export surface exists; this phase adds none. Notes routes change (PATCH/DELETE/`noteDate`) — reviewer verifies no route ever filters to CUSTOMER_FACING for an external surface. `visibility` default stays `INTERNAL`.
- No new drag or UI packages. `ProjectStatusChip` untouched.
- `Tasks.tsx`, `/tasks`, Timeline tab untouched.
- `WorkLogs.tsx` untouched.

## 8. Acceptance criteria (phase)

- [ ] `/daily-review` loads with exactly 1 API request (`GET /daily-review`) after auth; p95 < 200ms on a seed of 20 active projects across 6 customers (measure with the backend logger timings).
- [ ] A TAM sees only `ACTIVE` projects with `tamId = me`, grouped under their customers, plus customers with `tamId = me`; a wildcard user sees all `ACTIVE` projects and all customers with `tamId` set.
- [ ] A project with `customerId = null` appears under "No customer" with the banner and no weekly block.
- [ ] Saving today's note (button or ⌘↵) shows it in the day list without a full reload; editing and deleting own notes work; another user's note shows no Edit.
- [ ] Operations note saves with a title + body; a missing, blank, or over-120-char title is rejected (400).
- [ ] Mark reviewed → "Reviewed HH:MM" and the stats tile increments; unmark reverses it. Marking with no note is allowed.
- [ ] Overdue task status change from the card updates the task (visible on the project's Kanban) and removes it from the list when set to DONE.
- [ ] "Draft from this week's notes" fills the weekly textarea per §6.2; "Re-draft" asks for confirmation.
- [ ] Mark done requires body + health; Done shows on `/customers/:id`; Reopen returns to Draft and clears `doneAt`.
- [ ] Week navigation: previous week shows that week's notes and weekly update; notes can be added to past days.
- [ ] No Internal / Customer-facing control anywhere on the page; every note written by the UI has `visibility = INTERNAL`.
- [ ] Mobile (375px): no horizontal scroll; all controls reachable.
- [ ] `CHANGELOG.md` has one entry per task under `[Unreleased]`, written for a public reader.

## 9. Tests

**Backend (vitest, isolated `solvro_test` DB — see `backend/CLAUDE.md`)**
- `test/isoWeek.test.ts` — fixtures in §5.4.
- `test/dailyReview.test.ts` — scope rules (TAM vs. wildcard vs. `project:view-all`), `week` validation (400 on `2025-W53`, `2026-W00`), unassigned group, coverage counts, overdue boundary uses `today`.
- `test/projectNotes.test.ts` — `noteDate` default + explicit, `from`/`to` window, PATCH author-only (403), DELETE by wildcard (204), hidden project → 404.
- `test/projectReviews.test.ts` — POST idempotent, DELETE own only.
- `test/customerNotes.test.ts` — title required/trimmed/max 120, author-only edits.
- `test/weeklyUpdates.test.ts` — upsert, unique, Monday check, DONE validation, `doneAt` set/cleared, `project:write` required (STAKEHOLDER → 403).

**Frontend (vitest)** — `lib/isoWeek.test.ts`, `lib/weeklyDraft.test.ts`.

**E2E (`e2e/tests/daily-review.spec.ts`, desktop + mobile)** — using `fixtures/seed.ts` (`seedFixture`, `login`, `createTask`): create a customer with the admin, assign the seeded project, set `tamId`; open `/daily-review`; write a project note with ⌘↵ and assert the day row; write an operations note; Mark reviewed → tile reads `1 / 1`; Draft from notes → textarea contains both note bodies; pick Amber; Mark done → Done chip; open `/customers/:id` → the weekly update is listed. Mobile project asserts the same flow at 375px.

## 10. Task list

Spine touches (instant opus review, enforced by `gates.sh`): T1 (`schema.prisma` + migration), T3 (`routes/projects.ts`), T5 (`lib/queries.ts`). `lib/visibility.ts` is reused, not modified.

### Wave 1 — foundation (solo)

**T1 — Schema, migration, backfill, backend ISO-week helper.** §4 models + enums; migration `daily_review_v2` with the `note_date` backfill; `backend/src/lib/isoWeek.ts` + `test/isoWeek.test.ts`; reworded `NoteVisibility` comment. Scoped checks: backend `tsc --noEmit`, the new test. Files: `backend/prisma/schema.prisma`, `backend/prisma/migrations/*_daily_review_v2/migration.sql`, `backend/src/lib/isoWeek.ts`, `backend/test/isoWeek.test.ts`. Depends on: none.

### Wave 2 — backend (3 in parallel, after T1 review)

**T2 — `GET /daily-review`.** `backend/src/routes/dailyReview.ts`, mount in `src/app.ts`; scope, computed fields, coverage; `test/dailyReview.test.ts`. Depends on T1.

**T3 — Project notes + reviews.** §5.2 in `routes/projects.ts`; `test/projectNotes.test.ts`, `test/projectReviews.test.ts`. Depends on T1.

**T4 — Customer TAM, customer notes, weekly updates.** §5.3 in `routes/customers.ts`; `test/customerNotes.test.ts`, `test/weeklyUpdates.test.ts`. Depends on T1.

Gates run once at Wave 2 integration.

### Wave 3 — frontend data layer (solo)

**T5 — Hooks, types, pure modules.** §6.1 + §6.2: `lib/queries.ts`, `lib/isoWeek.ts` (+ test), `lib/weeklyDraft.ts` (+ test). Scoped checks: frontend typecheck + the two tests. Depends on T2–T4 (response shapes).

### Wave 4 — UI (2 in parallel; worktree isolation — both touch `queries.ts` consumers but not `queries.ts` itself)

**T6 — `DailyReview.tsx` rewrite.** §6.3 exactly per the mock. Depends on T5.

**T7 — Customer form TAM select, Customer detail weekly updates, Project overview notes.** §6.4. Depends on T5.

Gates run once at Wave 4 integration.

### Wave 5 — close

**T8 — E2E + changelog consolidation.** `e2e/tests/daily-review.spec.ts`; the orchestrator appends the reported CHANGELOG entries serially. Then: full gates, one phase review (`solvro-reviewer`, design lens on `frontend/` diffs), docs-keeper if triggered (schema comment change; `docs/ISSUES.md` if anything is deferred), user-approved PR into `develop`, `gh pr edit <n> --add-assignee alfi-rajasyah`.

## 11. Risks & mitigations

- **Payload growth**: only the week's notes and open/overdue items ship; no task lists. If p95 exceeds 200ms at 20 projects, add a `select` projection before adding caching.
- **Date drift**: all day columns are `@db.Date`; the client compares day strings (`dayFromIso`, `dateToDay`) — never `new Date(x) < today`. The backend uses `overdueBoundary(today)`.
- **Prisma migrate in Docker**: `-it` required; non-interactive fallback in `backend/CLAUDE.md`.
- **`package-lock.json`**: no dependency changes planned; if one appears, it is container-written only.
- **Concurrent weekly edits** (two users, one customer): last write wins via PUT; `updatedAt` + `author` are shown so the overwrite is visible. Locking is out of scope.
