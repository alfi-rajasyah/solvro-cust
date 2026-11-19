# Panels, forms and board accessibility

Status: shipped 2026-11-19
Archive path: `docs/archive/plans/panels-forms-board-a11y.md`
Lane: P (wave 4 of the 2026-11-19 issue sweep; run in parallel with another stream on disjoint files)

## Changes

| Issue | Change |
|---|---|
| ISS-174 | Epic owner select grouped: people on the project first, others under "Not on this project"; flat until access data loads |
| ISS-179 | Parent select disabled with a hint when the edited task has subtasks |
| ISS-130 | Ticket "Last update" guarded like "Started" |
| ISS-188 | `isDragActive()` (dnd-kit draggable/sortable only) skips Escape-to-close in Modal, Drawer, TaskPanel, TicketPanel, EpicPanel; listeners in the capture phase |
| ISS-049, ISS-113 | SectionReorderModal checks project:write itself; Modal `onHeaderClose` so the header X always closes |
| ISS-186 | dnd-kit announcements from card titles / ticket refs and column labels (`lib/dragAnnouncements.ts`), naming the card underneath; iTop board: forbidden, no-op and awaiting-confirmation drops |
| ISS-187 | Grip labels "Move <title>" / "Move <ref>"; e2e `gripFor` matches exactly |
| ISS-189 | Gantt section colour and duplicate errors surfaced via `mutateAsync().catch` |

e2e G10 now forces the server refusal with `page.route`, since the UI can no longer reach it.

## Close

- `gates.sh --performed-review=opus` on the combined wave: all gates passed.
- Phase review (two reviewers) plus instant spine review (`gantt-v2/`): no blockers; 2 should-fix (a misleading owner-group label; moves within a column were silent) and the nits fixed, including capture-phase Escape listeners and the Drawer guard. Deferred: ISS-191, ISS-192.
- Delivery Gate: PASS. The Parent field disabled with its hint in the edit form, light 1440 px and dark 375 px; the owner grouping and announcements are covered by unit tests; drag specs pass locally (desktop).
