Your goal: execute `docs/plans/reui-date-field-swap-plan.md` — replace all 8 native `<input type="date">` inputs (5 sites) with one shared `DateField`: a calendar-popover picker composed from the existing `ui/calendar.tsx` + Base-UI `ui/popover.tsx`. Zero new dependencies, backend untouched. Exit criterion: `grep -rn 'type="date"' frontend/src` → zero hits, all gates green.

**Read the plan file first, in full** — it has the site audit with file:line anchors, the DateField contract, the date-semantics helpers to preserve (local-midnight → ISO; off-by-one hazard), acceptance criteria, and drafted commit messages. Don't relitigate its Not Doing section.

How to work:

1. You are the orchestrator — run the CLAUDE.md pipeline per task (implementor → qa → reviewer → docs-keeper), tasks strictly in order 1 → 5.
2. Branch `feat/reui-date-field` is already cut from `origin/develop` (`62c1f08`) — verify you're on it.
3. Before dispatching Task 1's full spec, validate the plan's first assumption: `Calendar` inside `PopoverContent` renders acceptably in dark mode. Any `ui/calendar.tsx` edit needs `// SOLVRO PATCH` markers.
4. Tick the plan's Progress checklist as you go (plan is gitignored — never in the diff).
5. One commit per task after its gates pass — this prompt is my explicit approval for those five commits, using the plan's drafted messages. No Claude attribution.
6. Gates: frontend typecheck + frontend vitest per task; backend tsc once as sanity; Playwright smoke per QA's standing rules, plus `gantt-parity` + `list-dnd` regression after Tasks 2 and 4, and the new `date-picker.spec.ts` in Task 5. No `npm install` anywhere — a needed package is a stop, not an install.

Hard stops — wait for me:

- Red baseline on the fresh branch.
- Calendar-in-popover needs more than SOLVRO-PATCH-marked classname tweaks — stop, show a screenshot.
- Any date round-trip payload that differs from pre-swap behavior for the same action — stop, show before/after; never fix by changing commit semantics.
- After Task 5: acceptance sweep, push branch, draft a PR description targeting `develop` — but do **not** open the PR.
