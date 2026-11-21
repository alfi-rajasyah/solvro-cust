# Accessibility focus follow-ups (ISS-206, ISS-207, ISS-208)

Status: shipped 2026-11-20
Archive path: `docs/archive/plans/a11y-focus-followups.md`

Follow-ups filed during the fix waves (`docs/archive/plans/issues-fix-waves.md`, wave G3). None needs a user decision.

| Task | Issue | Main files |
|---|---|---|
| 1 | ISS-206: the project context panel needs a distinct landmark name; the axe step for the open panel becomes a full scan | `pages/ProjectDetail.tsx`, `e2e/tests/axe.spec.ts` |
| 2 | ISS-207: the context toggle gets the DESIGN.md focus treatment; active bordered toggles get a focus cue that differs from their active border | `pages/ProjectDetail.tsx`, `gantt-v2/SolvroGantt.tsx` (spine), other active bordered toggles |
| 3 | ISS-208: borderless controls use `outline-hidden` instead of `outline-none`, and a gate flags the old form | about 42 sites in `frontend/src`, `.claude/scripts/gates.sh` |

One implementor; the tasks are commits in order.

## Result

Review: no blockers; the CHANGELOG and ISSUES closures were added, and 4 nits were fixed in one round (offset colour on the Gantt toolbar, `cn()` merge, helper placement, the gate also flags a bare `outline-none` next to a ring). Delivery Gate PASS 2026-11-20: keyboard focus on the Filter trigger (off and on) on List and Gantt, and on the context toggle, light and dark at 1440 and 375 px; the panel carries its name; no console errors, no horizontal scroll. Filed ISS-209 (project tab links).
