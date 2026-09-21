# Goal prompt — Weekly Sync Tables

Copy-paste the block below into a fresh session to execute the phase.

---

Execute the phase planned in `/Users/alfirajasyah/Documents/Solvro/docs/plans/weekly-sync-tables.md` (read it first, in full).

Context: the customer weekly update (one free-text box per customer per ISO week, with a Green/Amber/Red health) becomes two structured tables — the Wednesday Mid-week Sync (Health, Category, Highlight, Risk, Action) and the Friday Reflection Sync (Weekly Achievement, Outstanding Issue, Lesson Learned, Next Week Focus, Need Manager Decision) — filled through two form modals on Daily Review, read on a new `/weekly-sync` page (one row per customer, week navigation, two tabs, pinned manager-decision rows, "Copy as table"), and listed on the customer page. Risk and Category are free text. Old weekly-update text moves into Weekly Achievement.

Setup: `git fetch origin`, cut `feat/weekly-sync-tables` from `origin/develop`. No upstream until the post-approval push (`git push -u origin feat/weekly-sync-tables`).

Execution rules (per CLAUDE.md — read it and the area CLAUDE.md files as you go):
- Waves exactly as the plan's §6: W1 T1 solo → instant opus review (schema spine) → W2 T2 ∥ T3 (separate test DBs) → W3 T4 → instant opus review (`queries.ts` spine) → W4 T5 ∥ T7 → W5 T6 → W6 T8.
- `open -a Docker` and wait for the stack before any backend dispatch.
- `.claude/scripts/gates.sh` once per wave at integration; fix rounds CONTINUE the same implementor via SendMessage, never a respawn. Sonnet floor for all subagents.
- Each implementor reports its CHANGELOG entry text; append serially under `[Unreleased]` at integration — one writer.
- The plan's §1 Decisions are settled — follow them, don't re-ask.
- Close: one `solvro-reviewer` phase review on the combined diff, docs-keeper only if a trigger fired, then stage everything and draft commit messages + a PR body targeting `develop` (assign `alfi-rajasyah`) — and STOP for my approval. No commit, no push, no PR without it. `TaskStop` every agent at the end.
