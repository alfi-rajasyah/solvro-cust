# Go prompt — Phase 1: ReUI Presentation Set

Paste the block below to start implementation. Edit the `Goal:` line first.

---

Start Phase 1 implementation — ReUI Presentation Set.

Goal: <EDIT ME — e.g. "ship the presentation components with visual parity and zero behavior change, so Phase 2 can start next week">

Execute `docs/plans/reui-presentation-set.md` on branch `feat/reui-presentation-set`:

1. Wave 1: Task 1 (vendor 5 components + `index.css` tokens) → instant opus review → gates.
2. Wave 2: Tasks 2, 3, 4 in parallel via `solvro-implementor` → gates at integration.
3. Phase close: one `solvro-reviewer` review, CHANGELOG entries, docs-keeper (`index.css` trigger fired).
4. Stop after staging + draft commit messages + PR body targeting `develop`. No commit, no PR — wait for my approval.

Hard constraints: `frontend/package.json` byte-identical; `grep -ri radix` empty on `reui/`; EmptyState consumers zero-diff; 375px checked on every touched surface.
