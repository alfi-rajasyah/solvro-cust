# Implementation Plan: Date Contract — UTC-Midnight Unification

**Branch:** `fix/date-contract-utc-midnight` — checked out in the main working copy (`/Users/alfirajasyah/Documents/Solvro`), cut from `origin/develop` @ `32e1150`; merges into `develop` via PR
**Phase = branch = one PR into `develop`.** Tasks = commits. No commit/PR without explicit user approval.
**Verified 2026-07-28:** all files below are byte-identical between the diagnosis checkout and `origin/develop` — the analysis holds on the phase base.

## Overview

Task dates picked in `DateField`/`DateRangeField` call sites walk back one calendar day east of UTC (picking 5–6 July stores/renders 4–5 July in the Gantt). Root cause: `isoFromDay` (`frontend/src/lib/dateField.ts:67-72`) serializes the picked day from **local** midnight, while the canonical readers take the **UTC** date-part (`slice(0,10)` in `gantt-v2/adapter.ts:95-96,148-149`, `GanttOverlay.tsx:113`, and `dayFromIso` itself). In UTC+7, "2026-07-05" → `2026-07-04T17:00:00.000Z` → reads back as July 4. A second defect: read paths disagree — `TreeCells.tsx:17` and `ProjectList.tsx:1108` parse the instant in local time, so the same stored value renders as different days in different panes.

This phase establishes **one canonical rule**: *a task date's calendar day is the UTC date-part of its stored ISO instant.* Writers emit `${day}T00:00:00.000Z`; readers derive the day via `dayFromIso` (UTC slice). This matches what `TaskFormModal` and the Gantt drag path already do — only the `commitDraft` writers and the local-parse readers move.

## Architecture Decisions

- **UTC midnight is the canonical instant for a picked day.** Chosen over "local midnight + local reads" because two of three existing writers (TaskFormModal `passthroughDate`, gantt `eventPatch` → backend `z.coerce.date()`) already emit UTC midnight, the Gantt engine's day grid is slice-based, and UTC-midnight instants are timezone-portable (a future second user in another zone sees the same day).
- **`dayFromIso`, `commitDraft`, `normalizePair`, and all picker-session logic are unchanged.** The untouched-draft passthrough stays — it's what prevents re-save drift regardless of convention.
- **The "legacy byte-parity" test invariant is retired.** It pinned a defective legacy helper. The replacement invariant: `dayFromIso(isoFromDay(day)) === day` for every day, under both `TZ=UTC` and `TZ=Asia/Jakarta`.
- **Existing corrupted rows are repaired by a one-off script, not a Prisma migration.** Corruption is detectable (non-midnight UTC time-part on a day-semantic column) and mechanically reversible (round to nearest UTC midnight). Day-semantic columns are exactly: `Task.startDate`, `Task.dueDate`, `Task.baselineStartDate`, `Task.baselineDueDate` (schema lines 222-229). `baselineLockedAt`, `createdAt` etc. are true instants — never touched.
- **Out of scope:** `SolvroGantt.tsx:1157` (baseline `asOfDate` → `baselineLockedAt` is a locally-written, locally-displayed instant — self-consistent); backend API shape; any Kanban/board change unless the Task-2 sweep finds a local-parse read there.

## Task List

### Wave 1 — foundation (solo; spine → instant opus review)

#### Task 1: `isoFromDay` → UTC midnight + test-invariant rewrite

**Description:** Change `isoFromDay` to return `${day}T00:00:00.000Z` (construct via `new Date(\`${day}T00:00:00Z\`)` to keep the validity probe, then `.toISOString()`). Rewrite `dateField.ts`'s module doc: delete the "byte-identical to legacy" claims, document the canonical rule, and fix the now-false "click day N, see day N in every zone" claim (true across save/refetch only after this task). In `dateField.test.ts`, replace the "legacy equivalence" describe block with inverse-property tests (`dayFromIso(isoFromDay(day)) === day` over the existing sample/DST day sets; `isoFromDay` output is always `T00:00:00.000Z`-suffixed). All `commitDraft`/`normalizePair`/RDP-mapping tests stay untouched and must remain green. Also in scope (user decision 2026-07-28): collapse `TaskFormModal.tsx`'s `passthroughDate` (`:73-76`) into `commitDraft` — post-change they are semantically identical, and its long "out of scope" comment (`:56-72`) becomes obsolete.

**Acceptance criteria:**
- [ ] `isoFromDay("2026-07-05")` === `"2026-07-05T00:00:00.000Z"` regardless of host TZ
- [ ] Inverse-property tests green under both `TZ=UTC` and `TZ=Asia/Jakarta` (run vitest twice, see Verification)
- [ ] No remaining test or doc line asserts byte-parity with `legacyFromInputValue`

**Verification:**
- [ ] `docker compose exec frontend npm test` and `docker compose exec -e TZ=Asia/Jakarta frontend npm test`
- [ ] `.claude/scripts/gates.sh` green
- [ ] Instant opus review (spine: date contract) before Wave 2 starts

**Dependencies:** None
**Files:** `frontend/src/lib/dateField.ts`, `frontend/src/lib/dateField.test.ts`, `frontend/src/components/TaskFormModal.tsx`
**Size:** S

### Checkpoint A (gate for Wave 2)
- [ ] Both-TZ vitest runs green, gates green, instant review clear
- [ ] Manual spot-check in dev app (host TZ is UTC+7): pick a due date in ProjectList → PATCH payload carries `T00:00:00.000Z`

### Wave 2 — parallel (independent files; each touches a spine area → instant review each)

#### Task 2: Unify read paths on the UTC date-part

**Description:** Make every task-date *display* derive its day via `dayFromIso`. Known offenders: `gantt-v2/TreeCells.tsx:17` (`isoToDate` = local `new Date(iso)` → replace with `dayToDate(dayFromIso(iso))`, keeping `fmtDateRangeDDMM`'s signature) and `ProjectList.tsx:1108` (`fmt` = local `toLocaleDateString` → same-day derivation via `dayToDate(dayFromIso(iso))`, keeping the identical `{month:'short', day:'numeric'}` output format). Then sweep: `grep -rn "startDate\|dueDate" frontend/src` filtered for `new Date(`/`parseISO(`/`toLocaleDateString` — fix any further local-parse read of the four day-semantic fields (check TaskPanel, Timeline, Tasks.tsx, kanban-v2 cards, exports); leave true-instant fields (`createdAt`, `baselineLockedAt`) alone.

**Acceptance criteria:**
- [ ] For a stored `2026-07-04T17:00:00.000Z` (pre-fix corrupt shape), list label, tree cell, picker seed, and Gantt bar all show the SAME day (July 4 — corrupt data renders consistently; the script in Task 4 repairs it)
- [ ] Sweep documented in the task report: every remaining `new Date(` on a task-date field is either fixed or justified
- [ ] No visual format change (dd/MM patterns, short-month labels unchanged)

**Verification:**
- [ ] `docker compose exec frontend npm run typecheck`; gates green (includes Playwright smoke)
- [ ] Manual: dev app with a hand-corrupted row (see Task 4 fixture) shows one consistent day everywhere

**Dependencies:** Task 1 (semantics; no code dependency)
**Files:** `frontend/src/components/gantt-v2/TreeCells.tsx`, `frontend/src/pages/views/ProjectList.tsx`, + sweep results
**Size:** S–M

#### Task 3: "Today" derivations + export overdue boundary

> **Caveat (2026-08-03):** `lib/export/projectExport.ts` is deleted on the unmerged branch `chore/move-description-to-context-sidebar` (Reports-page removal, commit `c39b935`). If that branch merges first, this task shrinks to the `SolvroGantt.tsx:324` fix only.

**Description:** `SolvroGantt.tsx:324` derives the default baseline as-of day from the UTC clock (`new Date().toISOString().slice(0,10)`) — before 07:00 in UTC+7 that's yesterday; replace with `dateToDay(new Date())` (local calendar today). `lib/export/projectExport.ts:146` computes overdue via `new Date(t.dueDate) < today` (instant vs local now); replace with day-string comparison: `dayFromIso(t.dueDate)! < dateToDay(today)!` (lexicographic compare is calendar-correct for `yyyy-MM-dd`). **Guardrail check (export file): re-verify INTERNAL-note filtering is untouched by the diff.**

**Acceptance criteria:**
- [ ] Baseline dialog default day equals the local calendar date at any wall-clock hour
- [ ] A task due *today* is not overdue; due *yesterday* is — in UTC+7 and UTC test runs
- [ ] No change to which notes reach the export (INTERNAL never exported)

**Verification:**
- [ ] Frontend typecheck + gates; existing export unit tests green
- [ ] Instant opus review (spine: `lib/export/`)

**Dependencies:** Task 1 (uses `dateToDay` semantics; no code dependency)
**Files:** `frontend/src/components/gantt-v2/SolvroGantt.tsx`, `frontend/src/lib/export/projectExport.ts`
**Size:** XS–S

#### Task 4: One-off data normalization script (backend)

**Description:** `backend/scripts/normalize-day-dates.ts` (pattern: `scripts/create-admin.ts`, run via `docker compose exec backend npx tsx …`). Export a pure `roundToUtcMidnight(d: Date): Date` — UTC time-part ≥ 12:00 rounds **up** to next UTC midnight (repairs east-of-UTC writes: `17:00Z` +7h → the picked day), < 12:00 rounds **down** (repairs hypothetical west-of-UTC writes). Script scans the four day-semantic columns for non-midnight UTC time-parts; **dry-run by default** (prints per-project counts + before→after samples), `--apply` mutates inside one transaction. Add a vitest for the rounding helper (isolated test DB conventions per `backend/CLAUDE.md`; the helper test itself is pure).

**Acceptance criteria:**
- [ ] Dry-run against dev DB lists exactly the rows with non-midnight time-parts; zero mutations without `--apply`
- [ ] `--apply` on a seeded fixture (`2026-07-04T17:00:00.000Z` → `2026-07-05T00:00:00.000Z`; a `04:00Z` fixture → same-day midnight) verified by re-query
- [ ] Baseline columns normalized with the same rule; audit timestamps untouched

**Verification:**
- [ ] `docker compose exec backend npm test` (helper suite) + backend typecheck; gates green
- [ ] Dry-run output pasted into the task report. Dev-DB `--apply` is PRE-AUTHORIZED (user decision 2026-07-28) if and only if every flagged row has the expected east-write shape (non-midnight UTC time-part, e.g. `17:00:00Z`); include before→after in the report. Any unexpected shape → stop and surface instead. Prod is never touched by this phase (deploys via `setup.sh`).

**Dependencies:** None (convention settled by this plan)
**Files:** `backend/scripts/normalize-day-dates.ts`, helper test file
**Size:** M

### Checkpoint B (gate for Wave 3)
- [ ] Waves 1–2 integrated on the phase branch; gates green on the combined tree
- [ ] Manual E2E of the original repro: pick 5–6 July in ProjectList (UTC+7 host) → Gantt bar, tree cell, and list label all say 5–6 July

### Wave 3 — regression proof

#### Task 5: Playwright timezone regression spec

**Description:** Extend the existing date-picker e2e spec (see `e2e/CLAUDE.md` conventions; spec landed in commit `05f07bd`) with a `timezoneId: 'Asia/Jakarta'` browser context: create a task, pick 5–6 July via the ProjectList/inline editors, then (a) intercept the PATCH and assert the payload dates are `2026-07-05T00:00:00.000Z`/`2026-07-06T00:00:00.000Z`, (b) after reload assert the list label, Gantt tree cell, and reopened picker all show 5/6 July. Keep the desktop+mobile matrix the suite already runs where applicable (Gantt assertions are desktop-only per frontend conventions).

**Acceptance criteria:**
- [ ] Spec fails on pre-Task-1 code (verified once by stash/checkout spot-run or by asserting the payload shape that old code cannot produce), passes on the phase branch
- [ ] No flake across 3 consecutive runs

**Verification:**
- [ ] `cd e2e && npm test`; gates green

**Dependencies:** Tasks 1, 2
**Files:** `e2e/` date spec
**Size:** S

### Checkpoint C — phase close
- [ ] Full gates + e2e green; both-TZ vitest green
- [ ] **One phase review** (`solvro-reviewer`) on the combined diff
- [ ] CHANGELOG: every task's reported entry appended serially under `[Unreleased]` by the orchestrator at integration
- [ ] Docs-keeper only if a trigger fires (none expected; deferred findings would be one)
- [ ] Draft commit messages + PR body (targets `develop`; assign `alfi-rajasyah`) — then WAIT for user approval

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Rewriting pinned "byte-parity" tests masks an unintended behavior change | High | Only the legacy-equivalence block is replaced; every other test must pass unmodified. Instant opus review on Task 1 before anything builds on it. |
| Stored corrupt rows keep rendering one-day-early until the script runs | Med | Task 2 makes rendering *consistent* immediately; script repairs data; note in PR body that `--apply` is a deploy step. |
| `commitDraft` passthrough preserves corrupt instants on untouched saves | Med | By design (passthrough never rewrites untouched fields); the script is the repair path, not the picker. |
| Hidden local-parse read sites beyond the known two | Med | Task 2's mandated sweep with per-hit justification in the report. |
| Playwright `timezoneId` flake | Low | Payload-interception assert is TZ-deterministic even if rendering asserts flake; 3-run check. |
| West-of-UTC historical data mis-rounded | Low | Solo TAM operates in UTC+7; nearest-midnight rule still handles west writes correctly. |

## Decisions (settled by user, 2026-07-28 — don't re-ask)

1. **Dev-DB `--apply`: pre-authorized**, conditional on the dry-run flagging only expected-shape rows (see Task 4 verification). Prod stays untouched.
2. **TaskFormModal `passthroughDate` consolidation: in scope** — part of Task 1, not optional.
