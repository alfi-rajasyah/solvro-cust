Your goal: execute the plan at `docs/plans/optional-sa-and-gantt-color-legend-plan.md` — two UX fixes on one branch. (1) The Solution Architect becomes optional end-to-end: nullable `Project.saId` + migration, create/PATCH schema changes with a `null → disconnect` path, "No SA" as a valid choice in the project form, null-safe rendering everywhere, and the customer-facing export omitting the SA line when unset. (2) The Gantt's unlabeled COLOR segmented control becomes a labeled "Color by" dropdown whose legend is sustained in all three modes — Section mode gets a dynamic legend (section names + resolved colors, capped at 6 with "+N more") and the legend is no longer hidden below 1024px.

**Read the plan file first, in full.** It contains the failing-test code, the exact schema/route/component edits, the expected migration SQL, the new e2e spec, and drafted commit messages. It is the single source of truth — do not deviate from it or relitigate its decisions (auto-defaulting SA to the creator, removing the SA field from the modal, click-to-filter legend chips, and any component-stack adoption for the dropdown are already evaluated and rejected; see `docs/ideas/optional-sa-and-gantt-color-legend.md`).

**How to work:**

1. **You are the orchestrator.** You do not write implementation code yourself. Run the CLAUDE.md agent pipeline per task: dispatch `solvro-implementor` with the task's spec from the plan verbatim (+ file pointers), then `solvro-qa` for the gates, then `solvro-reviewer` (design lens activates on Tasks 2–3 — they touch `frontend/`), then `solvro-docs-keeper` (Task 1 changes the data model — CLAUDE.md's Facts need the `Project` SA-optional + FK `SET NULL` sync). QA and docs-keeper always run.
2. **Execute tasks strictly in order** (1 → 3): Task 2's type flip consumes Task 1's API shape; Task 3 is independent of both but goes last so the e2e stack already carries the SA changes.  Gate fails → precise fix brief back to `solvro-implementor`, re-run the gate.
3. **Branch setup first:** `git fetch origin && git checkout -b fix/optional-sa-gantt-legend origin/develop` — local `develop` is behind origin and `schema.prisma` is hot there; never branch off the stale local. `develop` is the integration branch; `main` is release-only.
4. **Track progress in the plan file**: tick the `[ ]` checkboxes as steps complete.
5. **One commit per task, after its gates pass** — this prompt is my explicit approval for those three commits, using the messages drafted in the plan. **No Claude co-author trailers or any Claude attribution.**
6. **CHANGELOG.md discipline**: append under `[Unreleased]` in the same change set as the code — the entry text is drafted inside each task.
7. **Migration (Task 1)**: `prisma migrate dev` hangs in non-TTY shells — if `-it` doesn't get you a real TTY, use the non-interactive `prisma migrate diff` flow from CLAUDE.md § Migration gotcha. Verify the generated SQL matches the plan's expected snippet (including the FK flip to `ON DELETE SET NULL` — that change is intended). After `migrate deploy` + `prisma generate`, restart the backend container.
8. **Vitest always against the isolated test DB** (`-e DATABASE_URL="postgresql://solvro:test@postgres:5432/solvro_test?schema=public"`) — never the dev DB.
9. Docker Desktop is already running — use the plan's `docker compose` commands for typechecks and vitest, and keep the dev stack up for Playwright. Zero new dependencies, so the container/host `node_modules` split doesn't bite. Don't run `pwa.spec.ts` against the dev server — known dev-mode failure, out of scope.

**Hard stops — wait for me instead of improvising:**

- Red baseline before you start (typecheck, vitest, or the smoke spec failing on the fresh branch) — stop and report.
- Migration SQL materially different from the plan's expected snippet (anything beyond formatting/constraint-name noise) — stop and show the diff.
- Task 2 Step 2's typecheck should surface the seven files listed in the plan; a handful of extras get the same null-safe treatment (plus a CHANGELOG mention), but if the error list is large or reaches into shared/backend types, stop and show me.
- After Task 3's gates pass: run the acceptance-criteria sweep from the plan's final section, push the branch, and deliver a PR description draft targeting `develop` — but do **NOT** open the PR (no `gh pr create`). Stop and wait for me.
