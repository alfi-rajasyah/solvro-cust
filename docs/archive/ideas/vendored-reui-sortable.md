# Vendored ReUI Sortable

## Problem Statement
How might we give subtask and section lists first-class drag reorder, with one shared primitive that matches the vendored Kanban/Gantt pattern?

## Recommended Direction
Vendor ReUI Sortable into `frontend/src/components/reui/sortable.tsx`. Zero new dependencies — its deps (`@base-ui/react`, `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities`) are all already in `frontend/package.json`. Zero Radix patching — the component is Base-UI native (`useRender` + `mergeProps`), unlike the kanban vendoring which needed the Slot swap.

Wire two consumers:

1. **TaskPanel subtask drag** — replaces the up/down buttons at `TaskPanel.tsx:184` (`moveSubtask`). Flat sibling list ordered by `Task.position`; same mutate contract ProjectList already uses (`updateTask.mutate({ id, patch: { position } })`).
2. **Section reorder in the List view** — no UI exists today. Backend is ready: the section update schema (`backend/src/routes/sections.ts:25`) already accepts `position`.

Persistence seam: `onValueCommit(value, meta)` — `meta.previousValue` + indices give the index-based `position` PATCH and one-line rollback.

## Key Assumptions to Validate
- [ ] Sortable's drop animation and overlay meet `docs/DESIGN.md` — check against the vendored kanban's look.
- [ ] `Section.position` PATCH triggers correct re-render of the grouped List view — verify invalidation in `lib/queries.ts`.
- [ ] TaskPanel subtask reorder uses the same sibling `position` contract as ProjectList — mirror its mutate call.

## MVP Scope
In: vendored `reui/sortable.tsx`, TaskPanel subtask drag, section reorder in List view.
Out: everything else.

## Not Doing (and Why)
- **ProjectList task-drag refactor** — Sortable is single-list only (`value: T[]` → `onValueChange`); it cannot express the cross-section moves with global-position semantics in `ProjectList.tsx:288-340`. That code works and is spine-reviewed. Wrapping rows in Sortable would nest drag contexts inside the existing `DndContext`.
- **npm install of the registry package** — guardrail: vendored ReUI source only, no npm board/dnd wrapper libraries.
- **Kanban/Gantt changes** — they have their own vendored engines.

## Decisions
- **Keyboard reorder in TaskPanel: drag only** (user, 2026-07-30). Delete the up/down buttons and `moveSubtask`. The dnd-kit keyboard sensor covers keyboard reorder (focus handle → Space → arrows). Matches ProjectList, which has no buttons.

## Notes
- `reui/` is on the spine list — the vendored file gets an instant opus review when it lands.
- Registry reference: https://reui.io/docs/components/base/sortable (API), install id `@reui/sortable`.
- Sortable API: `Sortable` (root, `value`/`onValueChange`/`getItemValue` required; `onValueCommit`, `onMove`, `strategy`, dnd-kit passthroughs), `SortableItem` (`value`, `disabled`), `SortableItemHandle`.
