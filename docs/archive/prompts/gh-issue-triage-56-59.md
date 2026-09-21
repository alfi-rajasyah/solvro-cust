Your goal: execute the plan at `docs/plans/gh-issue-triage-56-59-plan.md` — fix all four open GitHub issues on one branch, in severity order. (1) #56: label creation inside the task drawer must stop submitting/wiping the task form (nested-`<form>` de-nesting in `LabelPicker` + stable reset-effect deps in `TaskFormModal`). (2) #57: comment text wraps via the new `whitespace-pre-wrap break-words` prose standard; dead `CommentThread.tsx` is deleted; same latent fix in `CustomerDetail`. (3) #59: Start Date before Due Date in the task form, icons travelling with their fields. (4) #58: Gantt bar labels placed by measured text fit (cached canvas `measureText`) instead of the 90px width guess, outside labels restyled with a fill-colored dot + `data-label-for` hook.

**Read the plan file first, in full.** It contains the exact replacement code, three new Playwright specs, expected red/green outcomes, CHANGELOG entries, docs-sync edits, and drafted commit messages. It is the single source of truth — do not deviate or relitigate its decisions (always-inside labels, a labels-placement toggle, PDF export parity, the label-route permission asymmetry, duplicate-name 409 UX, and composer auto-grow are already evaluated and deferred/rejected; see `docs/ideas/gh-issue-triage-56-59.md`).

**How to work:**

1. **You are the orchestrator.** You do not write implementation code yourself. Run the CLAUDE.md agent pipeline per task: dispatch `solvro-implementor` with the task's spec from the plan verbatim (+ file pointers), then `solvro-qa` for the gates, then `solvro-reviewer` (design lens applies to every task — all touch `frontend/`; Task 4 is the design-heavy one), then `solvro-docs-keeper`. QA and docs-keeper always run; Task 3 (two-block JSX swap) may skip the reviewer at your discretion per CLAUDE.md.
2. **Execute tasks strictly in order 1 → 4** (#56 → #57 → #59 → #58): severity order, and Tasks 1/3 both edit `TaskFormModal.tsx` so sequencing avoids conflicting diffs. Gate fails → precise fix brief back to `solvro-implementor`, re-run the gate.
3. **Branch setup first:** `git fetch origin && git checkout -b fix/gh-issue-triage-56-59 origin/develop` — never branch off stale local state. `develop` is the integration branch; `main` is release-only.
4. **Track progress in the plan file**: tick the `[ ]` checkboxes as steps complete.
5. **One commit per task, after its gates pass** — this prompt is my explicit approval for those four commits, using the messages drafted in the plan. **No Claude co-author trailers or any Claude attribution.**
6. **CHANGELOG.md discipline**: append under `[Unreleased]` in the same change set as the code — entry text is drafted inside each task.
7. **All frontend-only** — no schema, migration, or backend route changes anywhere in this plan. If an implementor pass reports needing a backend change, that's a hard stop, not a judgment call.
8. **Playwright runs against the dev stack**: `BASE_URL=http://localhost:5173`, `--project=desktop`, per the plan's commands. Docker Desktop should already be running (`docker compose up -d`). Never run `pwa.spec.ts` against the dev server. TDD ordering matters: Tasks 1 and 2 must show their spec RED before the fix and GREEN after.
9. **Docs-keeper duties beyond the CHANGELOG check**: sync CLAUDE.md's Facts → Testing line (the e2e suite gains `task-form-labels`, `comments`, `gantt-bar-labels` specs; `CommentThread.tsx` removal is a Facts-neutral deletion), and file the deferred findings listed in the plan's Final Acceptance Sweep into ISSUES.md.

**Hard stops — wait for me instead of improvising:**

- Red baseline before you start (frontend typecheck or `smoke.spec.ts` failing on the fresh branch) — stop and report.
- Task 1 Step 3: if the new spec unexpectedly **passes** on unfixed code, our root-cause theory is wrong — stop and report before touching `LabelPicker`.
- Task 4: if the measured-fit rule produces visibly bad results in the manual verify (labels flickering between placements, dot unreadable in either theme), stop and show screenshots before restyling further.
- Never touch `Tasks.tsx`/`/tasks`, never add dependencies, never edit committed migrations.
- Do not push anything to the GitHub issues (no comments, no labels, no closing) — I'll handle issue hygiene after merge.
- After Task 4's gates pass: run the Final Acceptance Sweep from the plan, push the branch, and deliver a PR description draft targeting `develop` (with `Fixes #56` / `Fixes #57` / `Fixes #58` / `Fixes #59` lines and test evidence) — but do **NOT** open the PR (no `gh pr create`). Stop and wait for me.
