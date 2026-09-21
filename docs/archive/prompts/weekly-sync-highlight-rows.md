# Goal prompt — Weekly Sync Highlight Rows

Copy-paste the block below into a fresh session to execute the phase.

---

Execute the phase planned in `/Users/alfirajasyah/Documents/Solvro/docs/plans/weekly-sync-highlight-rows.md` (read it first, in full).

Context: the Weekly Sync Mid-week table has one row per customer, and its Highlight cell holds the whole Wednesday update (one customer: 12 lines), so Monday's read cannot scan it. The change makes one highlight one row: a new `WeeklyHighlight` child table (title ≤ 200, detail, risk, action, position) replaces the three text columns on `WeeklyUpdate` after a data move; `PUT …/weekly-updates/:weekStart` takes `highlights[]` (replace in order when present, untouched when omitted); the Mid-week form becomes a list of highlight blocks; the Weekly Sync page renders one grid row per highlight with the customer spanning its rows; "Copy as table" writes one `<tr>` per highlight with the customer repeated; the customer page lists the highlights. The Reflection half does not change — settled, not a gap.

Setup: `git fetch origin`, cut `feat/weekly-sync-highlight-rows` from `origin/develop`. No upstream until the post-approval push (`git push -u origin feat/weekly-sync-highlight-rows`).

Execution rules (per CLAUDE.md — read it and the area CLAUDE.md files as you go):
- Waves exactly as the plan's §7: W1 T1 (schema spine) → gates + instant opus review → W2 T2 ∥ T3 (backend on `solvro_t1_test` / `solvro_t2_test`) → gates → W3 T4 (`queries.ts` spine) → gates + instant opus review → W4 T5 ∥ T6 ∥ T7 → gates → W5 T8 → gates.
- `open -a Docker` and wait for the stack before any backend dispatch. The migration runs with `-it` (`docker compose exec -it backend npx prisma migrate dev --name weekly_highlights`) and the data move is hand-inserted between the CREATE and the DROP before anything is committed.
- `.claude/scripts/gates.sh` once per wave at integration, from the repo root; fix rounds CONTINUE the same implementor via SendMessage, never a respawn. Sonnet floor for all subagents.
- Each implementor reports its CHANGELOG entry text; append serially under `[Unreleased]` at integration — one writer.
- The plan's §1 Decisions are settled — follow them, don't re-ask.
- Close: one `solvro-reviewer` phase review on the combined diff, docs-keeper only if a trigger fired, then stage everything and draft one commit message per task + a PR body targeting `develop` (assign `alfi-rajasyah`) — and STOP for my approval. No commit, no push, no PR without it. `TaskStop` every agent at the end.
