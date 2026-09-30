# Implementor brief — UI/UX professional pass (shared by every task)

Read this whole file first, then ONLY your task's section(s) in `docs/plans/ui-ux-professional-pass.md`
(grep for `#### P<n>-<m>`) plus the Spec sections that task cites (Spec 1.x, Spec 2 B<n>, Spec 3-<letter>).
The plan cites file:line evidence gathered 2026-09-29; lines may have drifted — confirm before editing.

## Ground rules
- Work directly in `/home/solvro/solvro` (one shared worktree). Never commit, stash, reset, checkout,
  or run any git command that changes the tree or index. `git diff` / `git status` are fine.
- Up to two other implementors edit OTHER tasks in the same tree at the same time, sometimes in the
  same files. Always Read a file right before you Edit it; if an Edit fails because the file changed,
  re-read and retry. Touch only the lines your task needs. Never revert or "fix" code you did not write.
- Follow `CLAUDE.md`, `frontend/CLAUDE.md`, `backend/CLAUDE.md`, `e2e/CLAUDE.md` and `docs/DESIGN.md`
  (binding for visual work: tokens only, no new hex, no shadows outside the whitelist, Material Symbols icons).
- Decisions already made (do not re-ask): day-first dates (`en-GB`, e.g. `28 Sep`, `22 – 28 Aug`,
  `28 Sep – 4 Oct`, 24-hour time); `/tasks` stays OUT of the sidebar; label/epic chips = dot + tint;
  customer placeholder tabs hidden; sidebar expanded by default at >=1280px; Kanban shows due date;
  third Overview tile = Open risks; `ConfirmModal` gets `confirmTone="danger"`; `text-meta` role approved.

## Checks — scoped only, serialized with locks (the VM has 2 CPUs / 2 GB RAM)
- Frontend typecheck: `flock /tmp/solvro-fe.lock docker compose exec -T frontend npm run typecheck`
- Frontend unit tests (only files you touched): `flock /tmp/solvro-fe.lock docker compose exec -T frontend npx vitest run <paths>`
- Backend typecheck: `flock /tmp/solvro-be.lock docker compose exec -T backend npx tsc --noEmit`
- Backend tests (single file, isolated test DB):
  `TEST_URL=$(docker compose exec -T backend printenv DATABASE_URL | tr -d '\r\n' | sed 's|/solvro?|/solvro_test?|') && flock /tmp/solvro-be.lock docker compose exec -T -e DATABASE_URL="$TEST_URL" backend npx vitest run test/<file>.test.ts`
- Do NOT run Playwright and do NOT run `.claude/scripts/gates.sh` — the orchestrator runs both serially.
  DO update any e2e spec whose asserted text/selector your change breaks (the plan names them), and list them.
- Typecheck errors in files or lines you did not touch belong to a concurrent task: note them, don't fix them.
- Never run `npm install`/`npm update` (lock file is container-written only; ask the orchestrator instead).

## Report (your final message, keep it under ~250 words)
1. Task id + status (done / blocked + why).
2. Files changed (paths only).
3. Checks run + result (one line each).
4. E2E specs you edited, and specs the orchestrator should run for your change.
5. Anything deviating from the plan, and why.
6. CHANGELOG entry text — one bullet, Keep-a-Changelog style, written for a public reader: what changed,
   where (bold file paths), why. No task ids, agent names or process words.
Do not paste diffs or file contents into the report.
