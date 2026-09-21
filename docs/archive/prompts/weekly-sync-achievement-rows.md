# Goal prompt — Weekly Sync Achievement Rows

Copy-paste the block below into a fresh session to execute the phase — ONLY after the Mid-week phase (`feat/weekly-sync-highlight-rows`) has merged into `develop`.

---

Execute the phase planned in `/Users/alfirajasyah/Documents/Solvro/docs/plans/weekly-sync-achievement-rows.md` (read it first, in full).

Context: the Weekly Sync Reflection half keeps five text blocks per customer per week (Weekly achievement, Outstanding issue, Lesson learned, Next week focus, Need manager decision). The change makes one achievement one row, and every Reflection text belongs to the row: a new `WeeklyAchievement` child table (title ≤ 200, detail, and the four texts) replaces the five columns on `WeeklyUpdate` after a data move; `PUT …/weekly-updates/:weekStart` takes `achievements[]` (replace in order when present, untouched when omitted); the Done rule becomes health + at least one achievement; the Reflection form becomes a list of cards with six fields; the Reflection tab renders one grid row per achievement with the five text cells per row; the pin follows any row with a decision; the Mid-week carry-over panel lists last week's rows with an open item; "Copy as table" writes one `<tr>` per achievement; the customer page lists the achievements. The Mid-week highlights list does not change — settled, not a gap.

Setup: `git fetch origin`, cut `feat/weekly-sync-achievement-rows` from `origin/develop` (record the sha in the plan header). No upstream until the post-approval push.

Execution rules (per CLAUDE.md — read it and the area CLAUDE.md files as you go):
- Waves exactly as the plan's §7: W1 T1 (schema spine) → gates + instant opus review → W2 T2 ∥ T3 (`solvro_t1_test` / `solvro_t2_test`) → gates → W3 T4 (`queries.ts` spine) → gates + instant opus review → W4 T5 ∥ T6 ∥ T7 → ONE orchestrator frontend typecheck, then gates → W5 T8 → gates.
- `open -a Docker` and wait for the stack before any backend dispatch. The migration: `migrate diff --script` (or `--create-only`) + splice the data move + `migrate deploy` + `prisma generate`; `docker compose restart backend` afterwards (stale Prisma client trap). If the migration file is edited after apply, update the `_prisma_migrations` checksum in every local DB that carries the row.
- Never let more than one frontend `tsc --noEmit` run at a time in the container (CLAUDE.md trap). Tell W4 implementors to skip the container typecheck; run it once at integration and hand them the result.
- Never run a reviewer's typecheck/vitest concurrently with the gates smoke — sequence review → gates (or gates → review with the reviewer read-only).
- `.claude/scripts/gates.sh` once per wave at integration, from the repo root; fix rounds CONTINUE the same implementor via SendMessage, never a respawn. Sonnet floor for all subagents.
- Each implementor reports its CHANGELOG entry text; append serially under `[Unreleased]` at integration — one writer.
- The plan's §1 Decisions are settled — follow them, don't re-ask.
- Close: one `solvro-reviewer` phase review on the combined diff (read-only during gates), docs-keeper only if a trigger fired, screenshots of the Reflection tab / form / carry-over panel on the dev stack for the user, then stage everything and draft one commit message per task + a PR body targeting `develop` (assign `alfi-rajasyah`, no Claude attribution) — and STOP for my approval. No commit, no push, no PR without it. `TaskStop` every agent at the end.
