# Goal prompt — Date Contract UTC-Midnight Fix

Copy-paste the block below into a fresh session to execute the phase.

---

Execute the phase planned in `/Users/alfirajasyah/Documents/Solvro/docs/plans/date-contract-utc-midnight.md` (read it first, in full).

Context: task dates picked via `DateField`/`DateRangeField` walk back one day east of UTC — `isoFromDay` writes local-midnight ISO while the Gantt and all canonical readers take the UTC date-part. The plan unifies on one rule: a task date's calendar day is the UTC date-part of its stored instant; writers emit `T00:00:00.000Z`, readers go through `dayFromIso`.

Setup already done — do not redo it:
- Branch `fix/date-contract-utc-midnight` is already checked out in `/Users/alfirajasyah/Documents/Solvro`, cut from `origin/develop` @ `32e1150`. No upstream is set — the eventual push (post-approval only) is `git push -u origin fix/date-contract-utc-midnight`.

Execution rules (per CLAUDE.md — read it and the area CLAUDE.md files as you go):
- Wave 1: Task 1 solo (`solvro-implementor`), then instant opus review (spine: date contract) at Checkpoint A before anything else starts.
- Wave 2: Tasks 2, 3, 4 in parallel implementors; Tasks 2 and 3 touch spine areas (`gantt-v2/`, `lib/export/`) → instant review each. Guardrail on Task 3: INTERNAL notes must never reach exports — verify the diff can't change note filtering.
- Wave 3: Task 5 (e2e) after Checkpoint B.
- `.claude/scripts/gates.sh` after every task; fix rounds CONTINUE the same implementor via SendMessage, never a respawn. Sonnet floor for all subagents.
- Each implementor reports its CHANGELOG entry text; append serially under `[Unreleased]` at integration — one writer.
- Task 4: dry-run first and paste its output in the report. Dev-DB `--apply` is pre-authorized ONLY if every flagged row has the expected shape (non-midnight UTC time-part, e.g. 17:00:00Z) — anything unexpected, stop and surface. Never touch prod.
- Vitest must be run under both `TZ=UTC` and `TZ=Asia/Jakarta` wherever the plan says so.
- Close: one `solvro-reviewer` phase review on the combined diff, docs-keeper only if a trigger fired, then stage everything and draft commit messages + a PR body targeting `develop` (assign `alfi-rajasyah`) — and STOP for my approval. No commit, no push, no PR without it.

The plan's "Decisions" section records my settled answers (Task-1 scope includes the TaskFormModal consolidation; conditional dev-DB apply) — follow them, don't re-ask.
