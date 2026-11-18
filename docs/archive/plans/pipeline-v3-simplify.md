# Agent pipeline v3: lanes, less ceremony

Status: shipped 2026-11-18. Archive path: `docs/archive/plans/pipeline-v3-simplify.md`.

Ported from the source repository (`alfi-rajasyah/solvro`, PR #240, plan of the same name), with the user's approval on 2026-11-18. Product rules (Pipeline module, SA role, notes visibility) stay as they are in this repository; only the workflow was ported.

## Friction that drove it (this repository)

- The iTop findings phase (`fix/svc-8-itop-findings`) left 7 `agent/*` worktree branches on `origin`, and the phase branch carries 6 integration merge commits.
- Every change, docs-only included, ran the full phase ceremony: plan, instant spine review, phase review, Delivery Gate, docs-keeper.
- A shipped plan stayed in `docs/plans/` until a manual housekeeping pass (PR #80), and 28 code comments still cited live `docs/plans/` paths.
- `docs/ISSUES.md` grew to 2,456 lines of per-phase logs with struck entries in place.

## Decisions

1. Three lanes, D / S / P, with the criteria and step table in the root `CLAUDE.md` roster.
2. Lane P runs tasks in order on the phase branch by default; parallel waves only when ≥2 tasks are independent.
3. The Delivery Gate runs only for a change a user can see.
4. Changes confined to `docs/`, `.claude/`, the `CLAUDE.md` files and `README.md` need no CHANGELOG entry (matches the existing `changelog-presence` gate).
5. Agents commit, push and open PRs into `develop`; no agent merges; the user's merge is the approval. `gh pr merge` and API merge calls are denied in `.claude/settings.local.json`.
6. Squash into `develop`, merge commit into `main`; head branches are deleted on merge; branches pushed without a PR are deleted after their work lands, with the user's approval.
7. No AI attribution, hidden metadata included, enforced by `.claude/settings.json` and `.github/workflows/pr-hygiene.yml`.
8. `gates.sh` gains `docs-plan-citations` and `docs-plans-status`, and skips smoke on a test-only frontend diff.
9. `docs/ISSUES.md` becomes a triaged ledger with stable `ISS-NNN` IDs (`docs/archive/plans/issues-restructure.md`).

## GitHub settings (applied 2026-11-18, matching the upstream repo)

- Ruleset `protect-develop`: blocks deletion and force-push, requires a PR, allows squash and merge commit (merge commit for a hotfix merge-back), requires the `attribution` check.
- Ruleset `Protect Main`: blocks deletion and force-push, requires a PR, allows merge commit only, requires `typecheck`, `backend-tests` and `attribution`. The e2e checks stay off the list: `ci.yml` skips e2e on PRs into `main`, so those checks never report there.
- Direct pushes to `develop` and `main` are blocked by the rulesets, not by permission deny entries, the same as upstream. The deny list covers merges only.
