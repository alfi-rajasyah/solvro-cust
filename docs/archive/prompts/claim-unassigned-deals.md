# Goal prompt — Claim Unassigned Deals

Copy-paste the block below into a fresh session to execute the phase.

---

Execute the phase planned in `/Users/alfirajasyah/Documents/Solvro/docs/plans/claim-unassigned-deals.md` (read it first, in full).

Context: on the Pipeline page an unassigned deal (`picId` null) is locked for every SA — the own-permission compares `picId` to the caller and null never matches — so nobody below `pipeline:edit_all` can give it a PIC. The fix adds one action: `POST /opportunities/:id/assign` behind a new gate (`edit_all` always; `edit_own` only on a deal with no PIC), an **Assign PIC** button + small dialog on the opportunity detail page, an "Assigned to <name>" activity note, and a New-opportunity default of PIC = creator. An unassigned deal stays locked for everything else — that is a settled decision, not a gap.

Setup: `git fetch origin`, cut `fix/claim-unassigned-deals` from `origin/develop`. No upstream until the post-approval push (`git push -u origin fix/claim-unassigned-deals`).

Execution rules (per CLAUDE.md — read it and the area CLAUDE.md files as you go):
- Waves exactly as the plan's §6: W1 T1 ∥ T2 (backend on `solvro_t1_test`) → gates + instant opus review (`queries.ts` spine) → W2 T3 → gates → W3 T4 → gates.
- `open -a Docker` and wait for the stack before any backend dispatch.
- `.claude/scripts/gates.sh` once per wave at integration, from the repo root; fix rounds CONTINUE the same implementor via SendMessage, never a respawn. Sonnet floor for all subagents.
- Each implementor reports its CHANGELOG entry text; append serially under `[Unreleased]` at integration — one writer.
- The plan's §1 Decisions are settled — follow them, don't re-ask.
- Close: one `solvro-reviewer` phase review on the combined diff, docs-keeper only if a trigger fired, then stage everything and draft one commit message per task + a PR body targeting `develop` (assign `alfi-rajasyah`) — and STOP for my approval. No commit, no push, no PR without it. `TaskStop` every agent at the end.
