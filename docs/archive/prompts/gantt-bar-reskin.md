Your goal: execute the plan at `docs/plans/gantt-bar-reskin-plan.md` — kill the washed-out Gantt bars. Bars render solid in their Color-by color with progress as a darker overlay, task names label the bars, section header rows get rollup summary bars, and sections still on the legacy slate default get deterministic vivid colors. Paint-only: engine, dependencies, baseline, milestones, exports' drawing code, backend, and DB are all untouched.

**Read the plan file first, in full.** It contains the locked palette values, the legacy-slate sentinel decision, task breakdown (Tasks 1–6) with acceptance criteria and QA gates, and the out-of-scope list. It is the single source of truth — do not deviate from it or relitigate its decisions (the ReUI/shadcn swap is already evaluated and rejected; see `docs/ideas/gantt-bar-reskin.md`).

**Visual acceptance reference:** the 1:1 before/after mockup artifact — https://claude.ai/code/artifact/818ee192-dd6f-4e31-9391-9e8e5d99ef24. The After state (all three Color-by modes, both themes) is what Task 6's acceptance compares against.

**How to work:**

1. **You are the orchestrator.** You do not write implementation code yourself. Run the CLAUDE.md agent pipeline per task: dispatch `solvro-implementor` with the task's spec from the plan verbatim (+ file pointers), then `solvro-qa` for the gates, then `solvro-reviewer` (design lens will activate — the diff touches `frontend/`), then `solvro-docs-keeper`. QA and docs-keeper always run; you may skip the reviewer only for a genuinely trivial task, at your discretion.
2. **Execute tasks strictly in order** (1 → 6). Gate fails → precise fix brief back to `solvro-implementor`, re-run the gate. Never fix silently yourself unless it's a one-line correction you call out.
3. **Branch first:** create `feat/gantt-bar-reskin` off `develop` before any change. `develop` is the integration branch; `main` is release-only.
4. **Track progress in the plan file**: tick the `[ ]` checkboxes as tasks and gate items complete.
5. **One commit per task, after its gates pass** — this prompt is my explicit approval for those commits. Conventional messages as drafted in the plan (`feat(gantt): …`). **No Claude co-author trailers or any Claude attribution.**
6. **CHANGELOG.md discipline**: append under `[Unreleased]` in the same change set as the code (the gates check this).
7. Docker Desktop is already running — use the `docker compose` commands from the plan for typechecks, tests, and the dev stack. Remember the container/host `node_modules` split does not matter here: this plan adds **zero dependencies**.

**Hard stop**: after Task 6's sweep passes, push the branch and deliver a PR description draft targeting `develop` — but do **NOT** open the PR (no `gh pr create`). Stop and wait for me.

If reality contradicts the plan (drifted line numbers beyond recognition, a red baseline before you start, `BAR_TRACK_OPACITY` consumed somewhere new), stop at the relevant checkpoint and ask me instead of improvising.
