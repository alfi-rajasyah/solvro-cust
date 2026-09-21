Your goal: execute the plan at `docs/plans/unified-task-ordering-plan.md` — make drags stick. One canonical manual task order per project shared by List, Kanban, and Gantt: re-scope top-level `Task.position` from per-(project, status) sibling lists to one dense per-project list, migrate existing data, fix List/Kanban drop math to global indices, make status changes keep the row's slot, and give the Gantt list pane full drag parity with the List view (between-row reorder, re-section, subtask reorder — row drags never touch dates).

**Read the plan file first, in full.** It contains the exact backend key change, the migration SQL, complete drop-math code for all three views, the e2e assertion rewrites, and the out-of-scope list. It is the single source of truth — do not deviate from it or relitigate its decisions (per-view orders, section-scoped positions, LexoRank, and Done-auto-sink are already evaluated and rejected; see `docs/ideas/unified-manual-task-ordering.md`).

**How to work:**

1. **You are the orchestrator.** You do not write implementation code yourself. Run the CLAUDE.md agent pipeline per task: dispatch `solvro-implementor` with the task's spec from the plan verbatim (+ file pointers), then `solvro-qa` for the gates, then `solvro-reviewer` (design lens activates on Tasks 3–5 — they touch `frontend/`), then `solvro-docs-keeper`. QA and docs-keeper always run; you may skip the reviewer only for a genuinely trivial task, at your discretion.
2. **Execute tasks strictly in order** (1 → 6). Tasks 1–2 change what `position` *means*; the UI is intentionally half-migrated until Task 5 — expected mid-branch reds are called out in the plan, don't "fix" them early. Gate fails → precise fix brief back to `solvro-implementor`, re-run the gate.
3. **Branch setup first:** `git checkout develop && git pull` (local develop is behind origin; `schema.prisma` and `queries.ts` — both hot in this plan — moved). Then branch `feat/unified-task-ordering` off the updated develop. `develop` is the integration branch; `main` is release-only.
4. **Track progress in the plan file**: tick the `[ ]` checkboxes as steps complete.
5. **One commit per task, after its gates pass** — this prompt is my explicit approval for those commits. Conventional messages as drafted in the plan. **No Claude co-author trailers or any Claude attribution.**
6. **CHANGELOG.md discipline**: append under `[Unreleased]` in the same change set as the code (the gates check this).
7. **Migration (Task 2)**: use the plan's non-interactive `prisma migrate diff` flow — `prisma migrate dev` hangs in non-TTY shells. Verify snake_case column names against the diff output before applying the repack SQL. After `migrate deploy` + `prisma generate`, restart the backend container.
8. Docker Desktop is already running — use the `docker compose` commands from the plan for typechecks, vitest, Playwright, and the dev stack. This plan adds **zero dependencies**, so the container/host `node_modules` split doesn't bite.

**Hard stops — wait for me instead of improvising:**

- Task 2's NFR check: if a reorder PATCH on the ~200-task project exceeds 200ms, stop and report the numbers. The fallback strategy is my decision.
- If reality contradicts the plan (drifted line numbers beyond recognition, a red baseline before you start, `projectWipLimits.test.ts` asserting something the plan didn't anticipate), stop at that checkpoint and ask.
- After Task 6's sweep passes: push the branch and deliver a PR description draft targeting `develop` — but do **NOT** open the PR (no `gh pr create`). Stop and wait for me.
