# GitHub Issues #56–#59 Fix Sprint — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **Repo pipeline:** each task is dispatched to `solvro-implementor`, then `solvro-qa` → `solvro-reviewer` → `solvro-docs-keeper` per CLAUDE.md's Agent Roster. Every task touches `frontend/`, so the reviewer's design lens applies throughout (Task 4 most of all).

**Goal:** Fix all four open GitHub issues — #56 label-creation data loss, #57 comment text overflow, #59 date-field order, #58 Gantt bar-label placement — in severity order on one branch.

**Architecture:** All frontend-only; no schema, migration, or backend route changes. Task 1 de-nests the label-creation form out of the task form's submit path and stabilizes the form-reset effect's dependencies. Task 2 establishes `whitespace-pre-wrap break-words` as the app's user-prose convention and deletes the dead `CommentThread` duplicate. Task 3 swaps two JSX blocks. Task 4 replaces the mockup's 90px bar-width guess with cached canvas text measurement so "inside" always means "the full name fits", and restyles the outside label to visually tie back to its bar.

**Tech Stack:** React 18 + TanStack Query, Tailwind theme tokens, Playwright e2e. No new dependencies.

**Spec:** `docs/ideas/gh-issue-triage-56-59.md`

## Global Constraints

- Branch from **up-to-date `origin/develop`**: `git fetch origin && git checkout -b fix/gh-issue-triage-56-59 origin/develop`. PRs target `develop`, never `main`.
- **Never commit or open a PR autonomously** (CLAUDE.md guardrail). The commit steps below execute only under the explicit approval granted in the goal prompt; the PR is drafted but never opened.
- **No Claude co-author trailers or attribution** in commits (standing user preference).
- **CHANGELOG.md entry in the same change set as every code change** — append-only, under `[Unreleased]`, Keep-a-Changelog headings.
- Frontend has **no unit test runner** — `docker compose exec frontend npm run typecheck` is the mechanical gate; behavior is proven by Playwright specs in `e2e/`.
- Playwright runs against the dev stack: `cd e2e && BASE_URL=http://localhost:5173 npx playwright test <spec> --project=desktop`. Never run `pwa.spec.ts` against the dev server (known dev-mode failure).
- **DESIGN.md is binding** for Task 4's outside-label restyle. No new colors — reuse theme tokens and the bar's already-resolved fill.
- The Gantt stays hand-rolled — no `gantt-task-react`, no component-stack adoption.
- `Tasks.tsx` and its `/tasks` route are untouched by every task here.
- Backend untouched ⇒ no vitest requirement beyond QA's standing guardrail checks; do not run backend tests against the dev DB.

---

### Task 1: #56 — Label creation must not submit/wipe the task form (P0, data loss)

**Files:**
- Modify: `frontend/src/components/LabelPicker.tsx:1`, `:39-52`, `:84-141`
- Modify: `frontend/src/components/TaskFormModal.tsx:84-114`
- Create: `e2e/tests/task-form-labels.spec.ts`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: `useCreateLabel(projectId)` mutation and `useProjectLabels(projectId)` from `@/lib/queries` (unchanged); e2e fixtures `test, expect, loginViaUi, apiBase` from `../fixtures/test` and `getTasks` from `../fixtures/seed`.
- Produces: `LabelPicker` public props are **unchanged** (`{ projectId, selectedIds, onChange }`) — no call-site edits needed (`TaskFormModal.tsx:385`, `TaskPanel.tsx:516`). `TaskFormModal` behavior change: form state now survives parent re-renders while open.

- [x] **Step 1: Create the branch**

```bash
git fetch origin
git checkout -b fix/gh-issue-triage-56-59 origin/develop
docker compose up -d
```

- [x] **Step 2: Write the failing e2e spec**

Create `e2e/tests/task-form-labels.spec.ts`:

```ts
import { test, expect, loginViaUi, apiBase } from "../fixtures/test";
import { getTasks } from "../fixtures/seed";

// Regression for GH #56: LabelPicker used to render a <form> nested inside
// TaskFormModal's #task-form. React replays the bubbling submit up the fiber
// tree, so clicking "Add" (or pressing Enter) also submitted the task form —
// prematurely creating the task and unmounting the drawer, destroying every
// in-progress field. The label-create action must be form-free.

test.describe("task drawer label creation — desktop", () => {
  test.beforeEach(async () => {
    test.skip(
      test.info().project.name !== "desktop",
      "List-view add-task flow is exercised on desktop",
    );
  });

  test("adding a label keeps the drawer open, the draft intact, and creates no task", async ({
    page,
    seededProject,
  }) => {
    const { token, projectId } = seededProject;
    const base = apiBase(test.info());
    // Stamped names so a Playwright retry against the worker-cached fixture
    // doesn't collide with the project-scoped unique label name.
    const stamp = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const labelName = `Regress ${stamp}`;
    const draftTitle = `Draft task ${stamp}`;

    const tasksBefore = await getTasks(base, token, projectId);

    await loginViaUi(page);
    await page.goto(`/projects/${projectId}/list`, { waitUntil: "networkidle" });
    // getByText, not getByRole: the button's material-symbol ligature makes its
    // accessible name "add Add task". exact:true also excludes the per-section
    // "Add task…" row buttons.
    await page.getByText("Add task", { exact: true }).click();

    const title = page.getByPlaceholder("Task title");
    await expect(title).toBeVisible();
    await title.fill(draftTitle);

    await page.getByRole("button", { name: "+ Label" }).click();
    await page.getByPlaceholder("Label name").fill(labelName);
    await page.getByRole("button", { name: "Add", exact: true }).click();

    // New label chip appears in the picker…
    await expect(page.getByText(labelName)).toBeVisible();
    // …the drawer is still open with the draft intact…
    await expect(title).toHaveValue(draftTitle);
    // …and the label submit did NOT silently create the task.
    const tasksAfter = await getTasks(base, token, projectId);
    expect(tasksAfter.length).toBe(tasksBefore.length);

    // Enter in the label-name input must not submit the task form either.
    await page.getByRole("button", { name: "+ Label" }).click();
    await page.getByPlaceholder("Label name").fill(`${labelName} B`);
    await page.getByPlaceholder("Label name").press("Enter");
    await expect(page.getByText(`${labelName} B`)).toBeVisible();
    await expect(title).toHaveValue(draftTitle);
    expect((await getTasks(base, token, projectId)).length).toBe(tasksBefore.length);
  });
});
```

- [x] **Step 3: Run the spec — expect FAIL on unfixed code**

```bash
cd e2e && BASE_URL=http://localhost:5173 npx playwright test tests/task-form-labels.spec.ts --project=desktop
```

Expected: FAIL — the drawer closes after "Add" (title assertion or task-count assertion trips). This failure is the proof of root cause; if it unexpectedly PASSES, stop and report (per goal prompt hard stops).

- [x] **Step 4: Fix `LabelPicker.tsx` — eliminate the nested form**

Line 1, drop the now-unused `FormEvent` type import:

```tsx
import { useState } from "react";
```

Replace `handleCreate` (lines 39–52) — no event parameter, no `preventDefault`:

```tsx
async function handleCreate() {
  const trimmed = newName.trim();
  if (!trimmed) return;
  try {
    const created = await createLabel.mutateAsync({ name: trimmed, color: newColor });
    onChange([...selectedIds, created.id]);
    setNewName("");
    setNewColor(PALETTE[0]);
    setCreating(false);
  } catch {
    // surfaced via mutation error state below
  }
}
```

Replace the `<form>` wrapper (lines 84–88) with a `<div>` — same classes, no `onSubmit`:

```tsx
{creating && (
  <div className="rounded border border-outline-variant bg-surface-container-low p-2">
```

…and the closing `</form>` (line 140) with `</div>`.

Give the name input an Enter handler (insert after the `placeholder` prop, lines 90–98 region):

```tsx
<input
  autoFocus
  type="text"
  value={newName}
  onChange={(e) => setNewName(e.target.value)}
  onKeyDown={(e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void handleCreate();
    }
  }}
  placeholder="Label name"
  maxLength={50}
  className="flex-1 rounded border border-outline-variant bg-surface-container-lowest px-2 py-1 text-xs focus:border-primary focus:outline-none"
/>
```

Convert the Add button (lines 99–105) from submit to plain button:

```tsx
<button
  type="button"
  onClick={() => void handleCreate()}
  disabled={createLabel.isPending || !newName.trim()}
  className="rounded bg-primary px-2 py-1 font-display text-label-caps uppercase text-on-primary hover:bg-primary-container disabled:opacity-50"
>
  {createLabel.isPending ? "…" : "Add"}
</button>
```

Cancel button, color palette row, and error paragraph (lines 106–139) are unchanged.

- [x] **Step 5: Fix `TaskFormModal.tsx` — stable reset-effect deps**

Replace lines 84–114 (the `useEffect` **plus** the old `const editingTask` declaration at line 114 — the declaration moves above the effect; do not leave a duplicate):

```tsx
const editingTask = isEdit ? (props as EditProps).task : null;
const createProps = isEdit ? null : (props as CreateProps);

useEffect(() => {
  if (!open) return;
  setError(null);
  if (editingTask) {
    setTitle(editingTask.title);
    setDescription(editingTask.description ?? "");
    setStatus(editingTask.status);
    setPriority(editingTask.priority);
    setStartDate(editingTask.startDate ? editingTask.startDate.slice(0, 10) : "");
    setDueDate(editingTask.dueDate ? editingTask.dueDate.slice(0, 10) : "");
    setAssignedToId(editingTask.assignedToId ?? "");
    setParentTaskId(editingTask.parentTaskId ?? "");
    setSectionId(editingTask.sectionId ?? "");
    setLabelIds(editingTask.labels.map((l) => l.id));
  } else {
    setTitle("");
    setDescription("");
    setStatus(createProps?.initialStatus ?? "TODO");
    setPriority("MEDIUM");
    setStartDate("");
    setDueDate("");
    setAssignedToId("");
    setParentTaskId(createProps?.initialParentTaskId ?? "");
    setSectionId(createProps?.initialSectionId ?? "");
    setLabelIds([]);
  }
  // Primitives only — the props OBJECT gets fresh identity on every parent
  // render (query refetches, sibling mutations invalidating), and re-running
  // this reset wipes in-progress user input (GH #56, second root cause).
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [
  open,
  isEdit,
  editingTask?.id,
  createProps?.initialStatus,
  createProps?.initialParentTaskId,
  createProps?.initialSectionId,
]);
```

(The pre-existing `const editingTask` consumers at lines 115–120 keep working — the declaration simply moved up.)

- [x] **Step 6: Run the spec — expect PASS — and typecheck**

```bash
cd e2e && BASE_URL=http://localhost:5173 npx playwright test tests/task-form-labels.spec.ts --project=desktop
docker compose exec frontend npm run typecheck
```

Expected: spec PASS, typecheck clean.

- [x] **Step 7: CHANGELOG entry**

Append under `[Unreleased]` → `### Fixed`:

```markdown
- Creating a label from inside the task drawer no longer submits the surrounding task form — `LabelPicker`'s creation UI was a `<form>` nested inside `#task-form`, and React's bubbling submit prematurely created the task, closed the drawer, and destroyed every in-progress field (`frontend/src/components/LabelPicker.tsx`; GH #56). The Add action is now a plain button + Enter handler.
- Task drawer no longer wipes in-progress input when its parent re-renders — the form-reset effect depended on the whole `props` object (fresh identity every render); it now depends on stable primitives only (`frontend/src/components/TaskFormModal.tsx`; GH #56).
- New regression spec `e2e/tests/task-form-labels.spec.ts` covering both paths (Add click + Enter).
```

- [x] **Step 8: Commit (approval granted by the goal prompt)** — `4a8fe32` (includes reviewer round-2 hardening: isPending guard, error reset, IME guard, end-to-end spec assertion)

```bash
git add frontend/src/components/LabelPicker.tsx frontend/src/components/TaskFormModal.tsx e2e/tests/task-form-labels.spec.ts CHANGELOG.md
git commit -m "fix(tasks): label creation inside the task drawer no longer submits/wipes the task form (GH #56)"
```

---

### Task 2: #57 — Comment text wraps inside its bubble (P1)

**Files:**
- Modify: `frontend/src/components/TaskPanel.tsx:618-624` (doc-comment), `:668-672`
- Modify: `frontend/src/pages/CustomerDetail.tsx:182`
- Delete: `frontend/src/components/CommentThread.tsx` (dead — exported, imported nowhere)
- Create: `e2e/tests/comments.spec.ts`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: task panel deep-link `/projects/:id/list?task=<taskId>` (ProjectDetail.tsx:42-45); composer placeholder `"Write a comment…"`, send button `aria-label="Send comment"` (TaskPanel.tsx:688/:694); seeded task `alpha` from the fixture.
- Produces: the app-wide convention for user-generated prose: **`whitespace-pre-wrap break-words`** (`break-all` stays reserved for opaque tokens, e.g. `Admin.tsx:937`).

- [x] **Step 1: Write the failing e2e spec**

Create `e2e/tests/comments.spec.ts`:

```ts
import { test, expect, loginViaUi } from "../fixtures/test";

// Regression for GH #57: comment bodies rendered with whitespace-pre-wrap but
// no break-words, so a long unbroken string (URL, token, keyboard mash)
// overflowed the bubble, the 380px panel, and the viewport.

test.describe("task panel comments — desktop", () => {
  test.beforeEach(async () => {
    test.skip(test.info().project.name !== "desktop", "Panel layout asserted at desktop width");
  });

  test("long unbroken comment text wraps inside its bubble", async ({ page, seededProject }) => {
    const { projectId, alpha } = seededProject;
    const long = "W".repeat(300); // no whitespace anywhere — worst case

    await loginViaUi(page);
    await page.goto(`/projects/${projectId}/list?task=${alpha.id}`, {
      waitUntil: "networkidle",
    });

    const composer = page.getByPlaceholder("Write a comment…");
    await expect(composer).toBeVisible();
    await composer.fill(long);
    await page.getByRole("button", { name: "Send comment" }).click();

    const body = page.getByText(long).first();
    await expect(body).toBeVisible();
    // The paragraph must not overflow its own box…
    expect(await body.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
    // …and the page must not gain a horizontal scrollbar.
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(1);
  });
});
```

- [x] **Step 2: Run it — expect FAIL**

```bash
cd e2e && BASE_URL=http://localhost:5173 npx playwright test tests/comments.spec.ts --project=desktop
```

Expected: FAIL on the `scrollWidth` assertion (text escapes the bubble).

- [x] **Step 3: Apply the wrap fixes**

`frontend/src/components/TaskPanel.tsx:672` — the one-word core fix:

```tsx
<p className="whitespace-pre-wrap break-words text-xs text-on-surface">{c.body}</p>
```

`TaskPanel.tsx:668-671` — harden the header row (long usernames must truncate, timestamp must not be crushed):

```tsx
<div className="mb-0.5 flex items-center justify-between gap-2 text-[12px]">
  <span className="min-w-0 truncate font-medium text-on-surface">{c.author.username}</span>
  <span className="shrink-0 text-on-surface-variant">{relativeTime(c.createdAt)}</span>
</div>
```

`frontend/src/pages/CustomerDetail.tsx:182` — same-class latent bug:

```tsx
<p className="mt-3 max-w-3xl whitespace-pre-line break-words text-sm text-on-surface-variant">
```

- [x] **Step 4: Delete the dead duplicate and fix the stale doc-comment**

```bash
git rm frontend/src/components/CommentThread.tsx
```

`TaskPanel.tsx:618-624` — the doc-comment above `PanelComments` references the deleted file; replace it with:

```tsx
/**
 * Comment thread + single-line composer per the mockup ("Write a comment…"
 * placeholder + green send icon), backed by useComments / useAddComment.
 * This is the app's only comment UI (the former standalone CommentThread
 * component was never mounted and has been removed).
 */
```

- [x] **Step 5: Run the spec — expect PASS — and typecheck**

```bash
cd e2e && BASE_URL=http://localhost:5173 npx playwright test tests/comments.spec.ts --project=desktop
docker compose exec frontend npm run typecheck
```

Expected: both green. Typecheck also proves nothing imported `CommentThread`.

- [x] **Step 6: CHANGELOG entry**

Append under `[Unreleased]`:

```markdown
### Fixed
- Comment text now wraps inside its bubble instead of overflowing the panel and viewport — user-generated prose standard is `whitespace-pre-wrap break-words`; long usernames truncate instead of pushing the timestamp out (`frontend/src/components/TaskPanel.tsx`; GH #57). Same latent fix applied to the customer description (`frontend/src/pages/CustomerDetail.tsx`). New spec `e2e/tests/comments.spec.ts`.

### Removed
- Dead `frontend/src/components/CommentThread.tsx` — exported but never imported; it duplicated the comment UI (with the same overflow bug) and risked being wired up unfixed.
```

- [x] **Step 7: Commit (approval granted by the goal prompt)** — `ea6ec54` (includes reviewer round-2: real bubble-containment assertion in the spec, `ProjectDetail.tsx:95` break-words sweep, CHANGELOG wording accuracy)

```bash
git add frontend/src/components/TaskPanel.tsx frontend/src/pages/CustomerDetail.tsx frontend/src/pages/ProjectDetail.tsx e2e/tests/comments.spec.ts CHANGELOG.md
git commit -m "fix(comments): wrap long unbroken comment text; remove dead CommentThread component (GH #57)"
```

(`git rm` already staged the deletion.)

---

### Task 3: #59 — Start Date before Due Date in the task form (P2, trivial)

**Files:**
- Modify: `frontend/src/components/TaskFormModal.tsx:323-343`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: nothing new. State, hydrate, validation (`:129-130`), and submit payloads are order-independent — only the two JSX blocks move.
- Produces: the modal joins the app-wide Start→Due convention (all 7 other paired surfaces already comply — see spec).

- [x] **Step 1: Swap the two `FieldRow` blocks**

Replace lines 323–343 with (note: each icon travels **with** its field — `calendar_month` belongs to Start, `calendar_today` to Due):

```tsx
{/* Start Date */}
<FieldRow icon="calendar_month" label="Start Date">
  <input
    type="date"
    value={startDate}
    onChange={(e) => setStartDate(e.target.value)}
    disabled={!canEdit}
    className="cursor-pointer border-none bg-transparent text-xs font-semibold text-on-surface focus:outline-none disabled:cursor-default"
  />
</FieldRow>

{/* Due Date */}
<FieldRow icon="calendar_today" label="Due Date">
  <input
    type="date"
    value={dueDate}
    onChange={(e) => setDueDate(e.target.value)}
    disabled={!canEdit}
    className="cursor-pointer border-none bg-transparent text-xs font-semibold text-on-surface focus:outline-none disabled:cursor-default"
  />
</FieldRow>
```

- [x] **Step 2: Typecheck + visual verify**

```bash
docker compose exec frontend npm run typecheck
```

Expected: clean. Manual: open any "Add task" drawer — field order now Section → Status → Priority → Assignee → **Start Date → Due Date** → Parent → Labels → Milestone. (No e2e touches field order — verified during triage.)

- [x] **Step 3: CHANGELOG entry**

Append under `[Unreleased]` → `### Changed`:

```markdown
- Task form now asks for Start Date before Due Date, matching every other date-pair surface in the app (TaskPanel, inline Gantt editor, Timeline, exports) (`frontend/src/components/TaskFormModal.tsx`; GH #59).
```

- [x] **Step 4: Commit (approval granted by the goal prompt)** — `6ad80b0` (reviewer skipped at orchestrator discretion: trivial two-block JSX swap; QA + docs-keeper ran)

```bash
git add frontend/src/components/TaskFormModal.tsx CHANGELOG.md
git commit -m "fix(tasks): start date before due date in the task form (GH #59)"
```

---

### Task 4: #58 — Gantt bar labels placed by measured fit (P1, design-sensitive)

**Files:**
- Modify: `frontend/src/components/gantt/GanttBar.tsx:25-30`, `:120-121`, `:384-396`, `:418-433`
- Create: `e2e/tests/gantt-bar-labels.spec.ts`
- Modify: `docs/ideas/gantt-bar-reskin.md:65-66` (tick the dogfooding assumption)
- Modify: `docs/plans/gantt-bar-reskin-plan.md:124` (supersede note)
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: `row.name`, computed `width`, resolved `color` (`barFillHex`) — all already in `GanttBar`. Theme body font stack from `frontend/tailwind.config.ts:76-77` (`"Source Sans 3", system-ui, sans-serif`).
- Produces: outside labels carry `data-label-for={row.taskId}` (test hook; inside labels remain children of `[data-task-id]`). Exports (`exportExcel.ts` / `exportPdf.ts`) intentionally untouched.

- [x] **Step 1: Replace the width-threshold constants with text measurement**

`GanttBar.tsx` lines 25–30 — replace `INSIDE_LABEL_MIN_WIDTH`/`OUTSIDE_LABEL_MAX_WIDTH` block with:

```ts
// GH #58: a label renders INSIDE its bar only when the full name actually
// fits — measured, not guessed by bar width (the old mockup-derived 90px
// threshold straddled typical 3–6 day tasks at Week zoom, so charts split
// arbitrarily between inside and outside labels).
// Slack covers the px-1 padding both sides plus sub-pixel/font-fallback
// drift while "Source Sans 3" loads.
const INSIDE_LABEL_PADDING_PX = 12;
// Cap for the floated outside label so a very long name on a narrow chart
// doesn't run away — it truncates with an ellipsis past this width.
const OUTSIDE_LABEL_MAX_WIDTH = 240;
// Must match the rendered label span: text-[10px] + the theme body stack
// (tailwind.config.ts fontFamily.body).
const LABEL_FONT = '10px "Source Sans 3", system-ui, sans-serif';

let measureCtx: CanvasRenderingContext2D | null = null;
const labelWidthCache = new Map<string, number>();

function labelTextWidth(text: string): number {
  const cached = labelWidthCache.get(text);
  if (cached !== undefined) return cached;
  if (!measureCtx) {
    measureCtx = document.createElement("canvas").getContext("2d");
    if (measureCtx) measureCtx.font = LABEL_FONT;
  }
  // ~6px/char fallback if canvas is unavailable (test envs).
  const width = measureCtx ? measureCtx.measureText(text).width : text.length * 6;
  if (labelWidthCache.size > 1000) labelWidthCache.clear();
  labelWidthCache.set(text, width);
  return width;
}
```

- [x] **Step 2: Swap the placement decision**

`GanttBar.tsx:120` — replace

```ts
const showLabelInside = !isMilestone && width >= INSIDE_LABEL_MIN_WIDTH;
```

with

```ts
const showLabelInside =
  !isMilestone && labelTextWidth(row.name) + INSIDE_LABEL_PADDING_PX <= width;
```

(`showLabelOutside` at `:121` is derived and needs no change. Milestones keep no label + tooltip, unchanged.)

- [x] **Step 3: Restyle the outside label to tie back to its bar**

Replace the outside-label block (`GanttBar.tsx:418-433`) with — leading dot in the bar's resolved fill, upgraded from muted `text-on-surface-variant` to `text-on-surface`, flex-centered instead of the line-height trick, plus the `data-label-for` test hook:

```tsx
{showLabelOutside && (
  <div
    data-label-for={row.taskId}
    className="pointer-events-none absolute flex items-center gap-1 text-[10px] text-on-surface"
    style={{
      left: left + width + 6,
      top,
      height: barHeight,
      maxWidth: OUTSIDE_LABEL_MAX_WIDTH,
      zIndex: 2,
    }}
    aria-hidden="true"
  >
    <span
      className="h-[3px] w-[3px] shrink-0 rounded-full"
      style={{ backgroundColor: color }}
    />
    <span className="min-w-0 truncate">{row.name}</span>
  </div>
)}
```

The inside-label block (`:384-396`) is unchanged — `truncate` stays as a safety net against measurement drift.

- [x] **Step 4: Write the e2e spec**

Create `e2e/tests/gantt-bar-labels.spec.ts`:

```ts
import { test, expect, loginViaUi, apiBase } from "../fixtures/test";

// Regression for GH #58: label placement is decided by measured text fit —
// inside iff the full name fits the bar — instead of the old 90px bar-width
// threshold that split typical week-zoom charts arbitrarily.

test.describe("gantt bar labels — desktop", () => {
  test.beforeEach(async () => {
    test.skip(
      test.info().project.name !== "desktop",
      "Gantt is desktop-only (hidden md:block)",
    );
  });

  test("short name inside a wide bar; long name floats outside a narrow bar", async ({
    page,
    seededProject,
  }) => {
    const { token, projectId, alpha } = seededProject;
    const base = apiBase(test.info());
    const stamp = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

    // 1-day bar (~20px at default Week zoom) with a name that can never fit.
    const longName = `Unfittably long task name for the label rule ${stamp}`;
    const res = await fetch(`${base}/api/projects/${projectId}/tasks`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        title: longName,
        status: "TODO",
        startDate: "2026-07-06",
        dueDate: "2026-07-06",
      }),
    });
    expect(res.ok).toBe(true);
    const narrow = (await res.json()) as { id: number };

    await loginViaUi(page);
    await page.goto(`/projects/${projectId}/gantt`, { waitUntil: "networkidle" });
    await page.waitForTimeout(800);

    // Alpha: 5-day bar (~100px) vs "Alpha" (~27px @10px font) → INSIDE:
    // the name renders as a child of the bar element, and no floated
    // outside label exists for it.
    await expect(
      page.locator(`[data-task-id="${alpha.id}"]`).getByText("Alpha", { exact: true }),
    ).toBeVisible();
    await expect(page.locator(`[data-label-for="${alpha.id}"]`)).toHaveCount(0);

    // The 1-day task → OUTSIDE: floated label present, nothing inside the bar.
    await expect(page.locator(`[data-label-for="${narrow.id}"]`)).toBeVisible();
    await expect(
      page.locator(`[data-task-id="${narrow.id}"]`).getByText(longName),
    ).toHaveCount(0);
  });
});
```

- [x] **Step 5: Run the spec and typecheck**

```bash
cd e2e && BASE_URL=http://localhost:5173 npx playwright test tests/gantt-bar-labels.spec.ts --project=desktop
docker compose exec frontend npm run typecheck
```

Expected: both green. Also re-run the untouched legend spec to prove no regression:

```bash
cd e2e && BASE_URL=http://localhost:5173 npx playwright test tests/gantt-legend.spec.ts --project=desktop
```

- [x] **Step 6: Manual design verify (reviewer will re-check against DESIGN.md)**

Open a seeded project's Gantt: (a) Week zoom — every fully-visible name sits inside its bar; names that don't fit float outside with the fill-colored dot; (b) Day zoom — most labels move inside; (c) Month zoom — most float outside, dot still ties each to its bar; (d) both themes — `text-on-surface` legible, dot visible against canvas.

- [x] **Step 7: Docs sync**

`docs/ideas/gantt-bar-reskin.md:65-66` — tick the open assumption and note the outcome:

```markdown
- [x] Bar labels don't clutter dense charts — inside/outside threshold + truncation; revisit after dogfooding a real 50+ task project → **revisited 2026-07-23 via GH #58: the 90px width threshold read as arbitrary; replaced with measured text fit (label inside iff the full name fits) + outside labels tied to their bar by a fill-colored dot. See docs/plans/gh-issue-triage-56-59-plan.md Task 4.**
```

`docs/plans/gantt-bar-reskin-plan.md:124` — append to that step's text (do not delete the original rule, mark it superseded):

```markdown
> **Superseded 2026-07-23 (GH #58):** the 90px bar-width rule is replaced by measured text fit — see `docs/plans/gh-issue-triage-56-59-plan.md` Task 4.
```

- [x] **Step 8: CHANGELOG entry**

Append under `[Unreleased]` → `### Changed`:

```markdown
- Gantt bar labels are now placed by measured text fit — a name renders inside its bar only when it fully fits (cached canvas measurement against the theme font), otherwise it floats outside with a fill-colored dot tying it to its bar and stronger `on-surface` text (was: arbitrary-looking 90px bar-width threshold, muted gray float) (`frontend/src/components/gantt/GanttBar.tsx`; GH #58). New spec `e2e/tests/gantt-bar-labels.spec.ts`. Excel/PDF export label rules intentionally untouched.
```

- [x] **Step 9: Commit (approval granted by the goal prompt)** — `31bfd53` (includes reviewer round-2: LABEL_FONT weight 450)

```bash
git add frontend/src/components/gantt/GanttBar.tsx e2e/tests/gantt-bar-labels.spec.ts docs/ideas/gantt-bar-reskin.md docs/plans/gantt-bar-reskin-plan.md CHANGELOG.md
git commit -m "fix(gantt): bar labels placed by measured text fit; outside labels tied to their bar (GH #58)"
```

---

## Final Acceptance Sweep (orchestrator, after Task 4's gates)

- [ ] All four specs green in one run: `cd e2e && BASE_URL=http://localhost:5173 npx playwright test tests/task-form-labels.spec.ts tests/comments.spec.ts tests/gantt-bar-labels.spec.ts tests/gantt-legend.spec.ts tests/smoke.spec.ts --project=desktop`
- [ ] `docker compose exec frontend npm run typecheck` clean
- [ ] QA standing guardrails: `Tasks.tsx` present, no `gantt-task-react`, INTERNAL-note filtering untouched (no export-layer files in the diff)
- [ ] CHANGELOG has one entry set per task, append-only
- [ ] `git log origin/develop..HEAD` shows exactly 4 commits, no Claude attribution
- [ ] Deferred findings filed into ISSUES.md by docs-keeper: PDF bar-label divergence (`exportPdf.ts:315`), label-route permission asymmetry (`projects.ts:679` `project:write` vs `labels.ts:37,52` `task:write`), duplicate-label-name 409 message UX, comment composer auto-grow, always-inside/toggle alternatives for #58 (rejected, with rationale from the idea file)
- [ ] Push branch + draft PR description targeting `develop` (title, summary per issue, `Fixes #56 / Fixes #57 / Fixes #58 / Fixes #59` lines, test evidence) — **PR is drafted, not opened**
