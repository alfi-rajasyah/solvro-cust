# ReUI Date Field Swap — Detailed Plan

**Status:** Approved direction (interview 2026-07-28), awaiting implementation
**Branch:** `feat/reui-date-field` off up-to-date `origin/develop` (never stacked on another task branch)
**PR target:** `develop`

---

## Problem Statement

How might we replace the last off-brand OS-native controls in the app — the five
`<input type="date">` sites — with one themed, calendar-based date picker so date
editing looks and behaves identically everywhere, on every viewport?

Native date inputs render the browser/OS picker: visually foreign to Technical
Precision, inconsistent across OS/browser, and the only remaining pre-migration
control language after the ReUI/shadcn swap (2026-07-25).

## Recommended Direction (confirmed in interview)

One shared **`DateField`** component: a themed trigger that opens the existing
vendored `ui/calendar.tsx` (react-day-picker v10) inside the existing Base-UI
`ui/popover.tsx`. This is ReUI's calendar-popover date-picker pattern
(reference examples: `c-calendar-24` single, `c-calendar-25` range —
https://reui.io/components/calendar).

Explicitly **not** ReUI's literal `date-selector` component: its `onChange` emits
a structured `DateSelectorValue` (period/operator, e.g. "between", "last 7 days")
built for filter bars, which fights form-style START/DUE entry.

Confirmed decisions:
- **All five call sites migrate** — no site keeps a native input.
- **Calendar on every viewport** — no native fallback below `md:`. The calendar
  renders to fit 375px (a react-day-picker month is ~280px wide; it fits inside
  the edge-to-edge phone modal).
- **Zero new dependencies** — `react-day-picker@^10`, `date-fns@^4`,
  `ui/calendar.tsx`, and `ui/popover.tsx` all already exist. Nothing is
  installed; the shadcn CLI is not run (its fallbacks can pull `radix-ui`,
  which is banned).
- **Per-field pickers** (START and DUE each open their own calendar), not a
  single range-drag control — preserves the current two-field interaction.

## Current State (audit 2026-07-28)

| # | Site | File / lines | Shape today |
|---|------|--------------|-------------|
| 1 | Inline range editor (shared) | `frontend/src/components/InlineDateRangeEditor.tsx` (whole file) | Form with two native inputs, Save/Cancel, hand-rolled outside-click + Escape dismissal, end<start clamp on submit |
| 2 | Gantt tree "Dates" cell | `frontend/src/components/gantt-v2/TreeCells.tsx:45-56` | Mounts `InlineDateRangeEditor` absolutely under the cell |
| 3 | Task panel DATES editor | `frontend/src/components/TaskPanel.tsx:388-426` | Near-duplicate of InlineDateRangeEditor's form, inline in the panel (this is the screenshot from the interview) |
| 4 | Task form modal | `frontend/src/components/TaskFormModal.tsx:345-365` | Two `FieldRow`s with borderless native inputs |
| 5 | Project list due-date editor | `frontend/src/pages/views/ProjectList.tsx:~965-1033` (`DueDateEditor`-style inline component) | Hand-rolled popover (fixed backdrop + absolute panel) with one native input, Save/Cancel |
| 6 | Gantt baseline dialog | `frontend/src/components/gantt-v2/SolvroGantt.tsx:1191-1205` | Single full-width native input ("Baseline as-of date") inside ConfirmDialog |

(Sites 1–3 collapse into one migration because 2 and 3 can consume the rebuilt
shared editor.)

E2E exposure: `gantt-parity`, `gantt-bar-labels`, and `list-dnd` assert dates via
the API and drag interactions only — **no spec fills `input[type="date"]`**, so
existing specs are not expected to break.

Date semantics to preserve exactly (off-by-one hazard):
- Display/draft value is `iso.slice(0, 10)` (local calendar date).
- Commit is `new Date(`${value}T00:00:00`).toISOString()` (local midnight → ISO).
- `InlineDateRangeEditor.tsx:53-56`: if end < start on submit, end is clamped to
  start (draft corrected, no save) — keep this behavior.

## Component Design

New files:

- **`frontend/src/lib/dateField.ts`** — pure helpers, no React:
  `isoToLocalDate(iso: string | null): Date | null`,
  `localDateToIso(d: Date | null): string | null`,
  `formatDisplay(d: Date | null): string` (dd/MM/yyyy via date-fns, matching the
  current native rendering). These reproduce the exact semantics above and get a
  Vitest suite (frontend vitest is node-env pure-module — this fits the existing
  pattern, like the kanban-v2 adapter suite).

- **`frontend/src/components/DateField.tsx`** — controlled component:

  ```
  interface DateFieldProps {
    value: string | null;              // ISO string, same currency as the API
    onChange: (iso: string | null) => void;
    disabled?: boolean;
    variant?: "boxed" | "bare";        // boxed = bordered font-mono input look
                                       // (inline editors); bare = borderless text
                                       // (TaskFormModal FieldRow)
    clearable?: boolean;               // renders a "Clear" action in the popover
    calendarProps?: ...                // pass-through for disabled-day matchers
  }
  ```

  Trigger is a `<button>` showing `formatDisplay(value)` (or an em-dash
  placeholder), opening `PopoverContent` containing `Calendar` in single-select
  mode. Selecting a day calls `onChange` and closes. Base-UI popover provides
  focus trap, Escape, outside-click, and viewport collision handling for free —
  the hand-rolled document listeners in InlineDateRangeEditor and the fixed
  backdrop in ProjectList are deleted, not ported.

  Range affordance without a range picker: when the parent passes the other
  endpoint via `calendarProps` (e.g. `disabled: { before: startDate }` on the
  DUE field, `defaultMonth`), the calendar communicates the range constraint.
  The existing submit-time clamp remains the enforcement.

Theming: `ui/calendar.tsx` already themes through the shadcn bridge tokens
(second `@theme inline` block in `frontend/src/index.css`) — it is used today by
`reui/gantt/gantt-nav.tsx`, so it renders correctly in dark mode already. Expect
**no edits to `ui/calendar.tsx`**; if a tweak proves unavoidable, mark it with
`// SOLVRO PATCH` per vendored-file convention. New colors, if any, go into the
`@theme inline` block, never inline hex.

Accessibility/keyboard: react-day-picker supplies arrow-key day navigation.
Free-typing a date is lost relative to native inputs — accepted trade-off,
see Not Doing.

## Task Breakdown (implementor pipeline granularity)

Per-task flow as always: solvro-implementor → solvro-qa → solvro-reviewer →
solvro-docs-keeper → orchestrator acceptance. Each task appends its own
CHANGELOG entry in the same change set.

### Task 1 — Pure date helpers + `DateField` component
Create `frontend/src/lib/dateField.ts` with Vitest coverage (round-trip
ISO↔local-date, null handling, DST-adjacent dates, display format) and
`frontend/src/components/DateField.tsx` (both variants, clearable, popover
composition). No call sites change yet.
**Accept:** frontend typecheck green; `npm test` (frontend vitest) green with
new suite; component unused-but-compiled; CHANGELOG entry.
**Commit:** `feat(dates): add DateField calendar-popover component + date helpers`

### Task 2 — Rebuild `InlineDateRangeEditor` on `DateField`; consolidate TaskPanel
Replace the two native inputs inside `InlineDateRangeEditor` with boxed
`DateField`s; keep the external props API (`startISO`/`endISO`/`onSave`/
`onCancel`/`className`) unchanged so `TreeCells.tsx` needs no edits; delete the
hand-rolled outside-click/Escape listeners only if the editor shell no longer
needs them (the shell form itself still dismisses via its own listeners — keep
whichever the popovers don't cover). Then replace TaskPanel's duplicated inline
dates form (`TaskPanel.tsx:388-426`) with `InlineDateRangeEditor`, preserving
`editingDates`/`canEdit` gating and mutation wiring.
**Accept:** Gantt tree dates cell and TaskPanel DATES both open the themed
calendar; end<start clamp still holds; typecheck green; CHANGELOG entry.
**Commit:** `refactor(dates): rebuild InlineDateRangeEditor on DateField, reuse in TaskPanel`

### Task 3 — `TaskFormModal` + Gantt baseline dialog
Swap the two `FieldRow` inputs (`TaskFormModal.tsx:345-365`) for bare-variant
`DateField`s (visual parity with the current borderless text styling,
`disabled={!canEdit}` preserved). Swap the baseline as-of input
(`SolvroGantt.tsx:1191-1205`) for a boxed full-width `DateField` (its draft is a
`yyyy-MM-dd` string — adapt at the call site or accept ISO, whichever keeps the
mutation payload byte-identical).
**Accept:** create/edit task via modal round-trips dates unchanged through the
API; baseline lock flow unchanged; typecheck green; CHANGELOG entry.
**Commit:** `feat(dates): swap TaskFormModal and Gantt baseline dialog to DateField`

### Task 3.5 — "Between"-style range picker for paired dates (user add-on, 2026-07-28)

User request mid-implementation (screenshot: ReUI date-selector's *between* mode):
one range interaction instead of picking start and due separately. Scope
decision: the two-month **range calendar** with Apply/Cancel — the filter
operator chips (`is/before/after`) and Quarter/Half-year granularity pills in
ReUI's `date-selector` are filter grammar, not applicable to editing a task's
start+due pair, and stay out.

- New `frontend/src/components/DateRangeField.tsx`: day-string contract like
  DateField (`{ start, end }` in/out), trigger showing `dd/MM/yyyy – dd/MM/yyyy`,
  popover with `Calendar mode="range"` `numberOfMonths={2}` (1 below `md:`),
  Apply commits the draft range, Cancel/outside/Escape discards, Clear resets.
  Reuses the z-101 positioner + shadow-overlay conventions.
- `InlineDateRangeEditor`: two DateFields → one DateRangeField; external ISO
  contract and per-endpoint `commitDraft` passthrough unchanged; submit clamp
  kept defensively (range mode enforces start ≤ end structurally).
- `TaskFormModal`: Start/Due FieldRows merge into one "Dates" FieldRow on a
  bare-variant DateRangeField; per-endpoint passthrough + UTC-midnight picked-day
  convention preserved byte-identically.
- Baseline dialog and ProjectList stay single-date DateField.

**Accept:** range pick start→end in one popover commits both dates; untouched
saves byte-identical; typecheck + both-TZ vitest green; fits 375px (single
month below `md:`).
**Commit:** `feat(dates): add DateRangeField between-style range picker for paired dates`

### Task 4 — `ProjectList` due-date editor
Replace the hand-rolled popover + native input (`ProjectList.tsx:~965-1033`)
with a boxed `DateField` (its popover replaces the fixed-backdrop pattern);
keep Save/Cancel commit semantics and the `onSave(startISO, iso)` signature.
**Accept:** inline due-date edit in the project list persists via the existing
optimistic mutation; typecheck green; CHANGELOG entry;
`grep -rn 'type="date"' frontend/src` returns **zero** hits (this is the
project-wide exit criterion).
**Commit:** `feat(dates): swap ProjectList due-date editor to DateField, drop last native date inputs`

### Task 5 — E2E coverage + full gates
New spec `e2e/tests/date-picker.spec.ts`: (a) desktop — open TaskPanel DATES,
pick a day in the calendar, Save, assert the new date via the API (same
pattern as gantt-parity's `dateOf` helper); (b) mobile project (iPhone 13) —
open TaskFormModal at 375px, open the start-date calendar, assert the calendar
box fits fully inside the viewport (reuse the palette mobile-fit measuring
approach from `search.spec.ts`). Then full QA gates: frontend typecheck,
frontend vitest, backend tsc (expected untouched), Playwright desktop+mobile
including gantt-parity/list-dnd regression, CHANGELOG check.
**Accept:** all gates green; CHANGELOG entry for the spec addition.
**Commit:** `test(dates): add date-picker e2e spec (desktop pick-persist + mobile calendar fit)`

### Progress checklist

- [x] Task 1 — helpers + DateField (implementor → qa → reviewer → docs-keeper → commit)
- [x] Task 2 — InlineDateRangeEditor rebuild + TaskPanel consolidation
- [x] Task 3 — TaskFormModal + Gantt baseline dialog
- [x] Task 3.5 — DateRangeField between-style range picker (user add-on; one-sided-creation trade-off ratified 2026-07-28)
- [x] Task 4 — ProjectList due-date editor (zero `type="date"` exit criterion met)
- [x] Task 5 — e2e spec + full gates (date-picker.spec.ts: 7 cases; full suite green, 4 pre-existing flakes filed)
- [x] Acceptance sweep, push branch, PR description drafted (PR not opened — waits for user)

## Key Assumptions to Validate

- [ ] `ui/calendar.tsx` renders correctly inside `ui/popover.tsx` at our density
      without edits — validate first thing in Task 1 by mounting them together;
      if patching is needed, `// SOLVRO PATCH` markers are mandatory.
- [ ] Base-UI popover portal (z-50) stacks correctly above the Gantt tree pane
      and inside `Modal.tsx`/ConfirmDialog — validate in Tasks 2–3; the Gantt
      cell currently relies on `z-50` absolute positioning, and portals escape
      overflow clipping, which should *improve* the Gantt case.
- [ ] A single month calendar (~280px) fits the 375px edge-to-edge modal —
      validated by the Task 5 mobile assertion.
- [ ] Losing free-typed date entry is acceptable to the daily loop — if it
      stings in practice, a typed-input affordance inside the popover is a
      contained follow-up (file to ISSUES.md, don't scope-creep this task).

## Not Doing (and why)

- **ReUI's literal `date-selector` component** — filter-grammar value object;
  wrong tool for form fields (confirmed in interview).
- ~~**Single range-drag picker**~~ — SUPERSEDED 2026-07-28: user requested the
  between-style range picker mid-implementation (see Task 3.5). The filter
  operator chips (`is/before/after`) from ReUI's `date-selector` remain out.
- **Native-input fallback on mobile** — two code paths to test for one control;
  consistency was the point (confirmed in interview).
- **Time-of-day, period presets ("last 7 days"), holiday/weekend awareness in
  the picker** — out of scope; holidays stay a Gantt-rendering concern.
- **Any persistence change** — ISO strings through existing mutations,
  byte-identical payloads; backend untouched.
- **Free-typed date entry in v1** — calendar + keyboard-nav only; flagged as an
  assumption to watch, not built preemptively.

## Open Questions (non-blocking, decide during implementation)

- Whether `InlineDateRangeEditor`'s own outside-click dismissal conflicts with
  the nested popover's dismissal (click inside calendar = outside the form shell
  once portaled). Likely resolution: ignore pointerdown events inside any open
  popover portal, or drop the shell listeners entirely and rely on explicit
  Cancel. Decide in Task 2 with real behavior in hand.
- Boxed-variant trigger width in the 220px inline editor — keep `w-[220px]`
  shell or let it hug content. Visual call at review time against DESIGN.md.
