Your goal: execute the plan at `docs/plans/overview-portfolio-timeline-plan.md` — replace the fake "Portfolio progress" chart on the TAM Overview with a real per-TAM Portfolio Timeline calendar (the Executive dashboard's calendar, scoped), and fix the "Projects needing attention" health signal.

**Read the plan file first, in full.** It contains the locked decisions, phase/task breakdown (T0.1–T4.5), QA gates, reference facts with file/line pointers, and out-of-scope list. It is the single source of truth — do not deviate from it or relitigate its decisions.

**How to work:**

1. **You are the orchestrator (Fable 5).** You do not write implementation code yourself. Delegate each phase's implementation tasks to a **Sonnet 5 subagent** (Agent tool, `subagent_type: "general-purpose"`, `model: "sonnet"`), passing the relevant task specs (T-numbers) from the plan verbatim plus any file context it needs.
2. **Execute phases strictly in order** (Phase 0 → 4). After each implementor returns, you personally review the diff against the task's acceptance criteria, then run that phase's **QA gate** yourself. Gate fails → send a precise fix brief back to the implementor and re-run the gate. Never fix silently yourself unless it's a one-line correction you call out.
3. **Track progress in the plan file**: tick the `[ ]` checkboxes for tasks and QA-gate items as they complete.
4. **One commit per phase**, after its gate passes. Conventional commit messages. **No Claude co-author trailers or any Claude attribution.**
5. **CHANGELOG.md discipline**: append entries under `[Unreleased]` in the same phase as the code change (the gates check this).
6. Docker Desktop is already running — use the `docker compose` commands in the plan for typechecks, tests, and the dev stack.

**Hard stop**: after Phase 4, push the branch and deliver the PR description draft — but do **NOT** open a PR into `develop` or any branch (no `gh pr create`). Stop and wait for me.

If reality contradicts the plan (missing base feature, drifted line numbers beyond recognition, red baseline), stop at the relevant checkpoint and ask me instead of improvising.
