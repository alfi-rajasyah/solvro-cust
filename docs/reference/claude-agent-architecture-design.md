# Claude Agent Architecture — Design

Designed 2026-07-21 with the user. Replaces the ad-hoc two-reviewer setup with a
pipeline-stage roster. Supersedes the agent conventions implied by
`tasks/plan.md` (June services project); the orchestrator/implementor model
proven there is kept and formalized.

## Decisions (locked)

- Specialists divide **by pipeline stage**, not by discipline.
- Verification is **two-layer**: a QA agent runs mechanical gates, the
  orchestrator does final acceptance. Implementors never self-certify.
- Code review and UI/design review **merge into one reviewer** with a
  conditional design-system lens.
- A dedicated **docs-keeper agent** owns the docs layer (CHANGELOG.md,
  CLAUDE.md factual sync, ISSUES.md) — this was the root cause of the
  2026-07 drift audit findings.
- **No agent or orchestrator ever commits.** The orchestrator stages work and
  drafts the commit message; every commit and PR waits for explicit user
  approval. (Extends the existing "hard stop before PR" rule down to commits.)
- Agent definitions live in `.claude/agents/` and stay **local-only** —
  `.claude/` remains fully gitignored (user decision: agent files must never
  be pushed to GitHub). Trade-off accepted: the roster does not travel across
  machines; copy `.claude/agents/` manually when setting up another machine.
- **CONFIGURATION.md is restored to its original role**: the tracked operator
  reference (deployment shapes, env vars, ports, volumes, prod flow),
  docs-keeper-owned. CLAUDE.md's Ops block shrinks to day-to-day commands plus
  a pointer to it — no duplicated tables.
- **`solvro-qa` runs the Playwright smoke spec** on frontend-touching tasks,
  in addition to the standing gates.
- Repo hygiene: drop the unused `@xyflow/react` dependency (Network Diagram
  stays not-built); archive `tasks/` to `docs/archive/`; gitignore
  `.understand-anything/`; replace the orphaned check-github memory with a
  SessionStart hook that compares local vs. remote heads.
- Solvro is in production: **code is the source of truth for design tokens**
  (`tailwind.config.ts` + `index.css` + `theme.tsx`). **DESIGN.md is
  regenerated** from the 2026-07-21 paper-extraction references
  (`docs/plans/paper-extraction/` — `components.md` §0 token map, `views.md`
  §0 global rules, MASTER-PLAN build rules) plus the code, tracked in git, and
  owned by the docs-keeper. **PRD.md is archived** (`docs/archive/`, marked
  superseded by CLAUDE.md + CHANGELOG).

## Roster

### Orchestrator — main session (no agent file)

The interactive session (Fable). Plans with the user (`docs/ideas` →
`docs/plans` → `docs/prompts` pipeline unchanged), dispatches plan tasks to the
implementor, sequences the gates below, performs final acceptance against each
task's acceptance criteria, stages changes, drafts commit messages, and stops
for user approval before any commit or PR.

### 1. `solvro-implementor` — model: sonnet, tools: all

Executes exactly one plan task per dispatch: code + tests + CHANGELOG entry in
the same change set. Follows CLAUDE.md conventions (route mounting without
`/api`, shared prisma client, hooks in `queries.ts`, theme tokens over inline
hex, dynamic imports for heavy libs). Returns a summary of files changed and
how the acceptance criteria are met. Must not: mark its own work done, commit,
touch tasks outside its brief, or edit CLAUDE.md.

### 2. `solvro-qa` — model: sonnet, tools: Bash, Read, Grep, Glob

Mechanical gate runner. Per dispatch it runs the gates named by the
orchestrator, typically:

- `docker compose exec backend npx tsc --noEmit`
- `docker compose exec frontend npm run typecheck`
- `docker compose exec backend npm test` (vitest)
- CHANGELOG check: an `[Unreleased]` entry exists covering the changed files
- Playwright smoke (`e2e/tests/smoke.spec.ts`) when the task touched
  `frontend/`
- optional: dev-stack smoke via curl when the task touched routes

Output: pass/fail per gate **with raw command output as evidence**. No
opinions, no fixes, no code edits. A failed gate goes back to the implementor
via the orchestrator.

### 3. `solvro-reviewer` — model: opus, tools: Read, Grep, Glob, Bash

The merged reviewer, replacing `solvro-code-reviewer.md` and
`solvro-ui-reviewer.md`. Reviews the diff for correctness, conventions, and
architecture on every dispatch; the design-system lens activates automatically
when the diff touches `frontend/`.

Two rules that fix the old agents' failure modes:

- **Sources at runtime, not hardcoded**: reads the regenerated DESIGN.md and
  CLAUDE.md during the review instead of carrying an inline copy of the rules
  (the inline copies are what rotted), and spot-verifies tokens against
  `tailwind.config.ts` / `index.css` when a finding hinges on a value.
- **Verify before reporting**: has Grep/Glob/Bash precisely so it can hunt
  stale references and reproduce claims instead of reviewing only what it was
  handed. No Write/Edit — reviewers report, they don't fix.

Output: severity-ranked findings (blocker / should-fix / nit), each with file:line
and a concrete fix. Findings the user defers go to ISSUES.md via the docs-keeper.

### 4. `solvro-docs-keeper` — model: haiku, tools: Read, Grep, Glob, Edit, Write, Bash

Runs at task end, after review. Duties:

- Verify the CHANGELOG entry exists and records what/where/why; append-only,
  never rewrite existing entries.
- **CLAUDE.md factual sync**: if the task shipped a feature, added a route,
  changed the schema, or reversed a "not yet built" status, update the
  corresponding CLAUDE.md line. Canonical *decisions* (the top section) change
  only when the orchestrator passes an explicit user-approved note.
- **DESIGN.md token sync**: if the diff touches `tailwind.config.ts`,
  `index.css`, or `theme.tsx`, sync DESIGN.md's token tables to match the
  code. Deterministic trigger — same discipline model as CHANGELOG.
- **CONFIGURATION.md sync**: if the diff touches `env.ts`,
  `docker-compose.yml`, `setup.sh`, `nginx.conf`, or `vite.config.ts`, sync
  the corresponding CONFIGURATION.md section.
- File deferred review findings into ISSUES.md.

Must not: touch source code, delete or rewrite history in any doc, invent
decisions.

## Flow per task

```
orchestrator dispatches task
  → solvro-implementor (code + tests + changelog)
  → solvro-qa (gates; fail → back to implementor)
  → solvro-reviewer (meaningful changes only; blockers → back to implementor)
  → solvro-docs-keeper (changelog verify, CLAUDE.md sync, ISSUES.md)
  → orchestrator acceptance vs. plan criteria
  → stage + draft commit message → USER APPROVES → commit
```

Trivial tasks (typo-level) may skip the reviewer at the orchestrator's
discretion; QA and docs-keeper always run.

## Rules layer the agents rely on

- **CLAUDE.md** — shared contract read by every agent. Prerequisite: the stale
  facts found in the 2026-07-21 audit must be corrected (tests exist, no
  seeded users, Google OAuth, Executive page, reports/dependencies routes,
  Reports revamp shipped, design-system pivot, `New UI/` folder) and a Docs
  Discipline rule added; the docs-keeper then keeps it current.
- **DESIGN.md (regenerated)** — the single home for design rules: both-theme
  token tables (mirroring code) + behavioral rules (dark-first, sidebar fixed
  `#232321`, elevation by 1px outline, `shadow-overlay` whitelist, radii
  scale, AI-glow reserved for blueprint tasks — currently unimplemented).
  Tracked in git, docs-keeper-owned. The old gitignored DESIGN.md is replaced;
  content seeds from `docs/plans/paper-extraction/` + the theme code.
- **CONFIGURATION.md** — the operator's environment & deployment reference,
  corrected (§2.8 seed users, §2.9 missing Google OAuth, §2.12 primary color,
  §2.15 test runner) and tracked. CLAUDE.md Ops points here.
- **PRD.md** — archived to `docs/archive/` with a superseded header.
- **docs/ideas → docs/plans → docs/prompts** — unchanged planning pipeline.

## Guardrails & context delivery

Principle: **each guardrail lives in exactly one place; delivery to agents is
redundant** (auto-load + dispatch flag + mechanical gate). Duplication is what
rotted the old setup — never copy a product guardrail into an agent file.

- **Layer 1 — CLAUDE.md, restructured into three blocks.** Subagents receive
  project CLAUDE.md automatically, so product rules live only there:
  - **Guardrails** — MUST/NEVER invariants, user-owned; the docs-keeper may
    not touch this block. E.g.: INTERNAL notes never appear in exports;
    `Tasks.tsx` + route never deleted; no `gantt-task-react`; the future
    webhook must reject user JWTs; Timeline tab stays. Design guardrails are
    NOT duplicated here — one line points at DESIGN.md as binding.
  - **Facts** — current-state inventory (routes, shipped features, schema,
    sidebar), synced by the docs-keeper.
  - **Ops** — commands, Docker, migration gotchas. Context, not rules.
- **Layer 2 — agent files carry role guardrails only** (never self-certify,
  no fixes from QA, no edits from reviewer, append-only docs-keeper). These
  cannot drift because they describe the role, not the product.
- **Layer 3 — per-dispatch brief.** The orchestrator passes each agent the
  plan task verbatim, relevant paths, acceptance criteria, and explicitly
  flags the guardrails that are *hot* for the task ("touches export → the
  INTERNAL-notes invariant applies"). Flagged rules beat buried rules.
- **Layer 4 — mechanical enforcement.** Guardrails that must never depend on
  model attention become standing `solvro-qa` gates, run every task:
  - export code paths filter `INTERNAL` notes (grep)
  - `gantt-task-react` absent from both package.json files
  - `Tasks.tsx` and its route still exist
  - CHANGELOG `[Unreleased]` entry present for the change

## Migration steps (implementation plan input)

1. Restructure CLAUDE.md into the Guardrails / Facts / Ops blocks, correcting
   the stale facts in the process, adding the Docs Discipline rule and a short
   roster section pointing at `.claude/agents/`.
2. Regenerate DESIGN.md (dark-first, both themes) from
   `docs/plans/paper-extraction/` §0 sections + `tailwind.config.ts` /
   `index.css`; remove it from `.gitignore` and track it.
3. Fix CONFIGURATION.md's stale sections, add the missing Google OAuth
   config, track it; shrink CLAUDE.md Ops to commands + pointer.
4. Archive PRD.md to `docs/archive/` with a superseded header; move `tasks/`
   to `docs/archive/` as well; add `.understand-anything/` to `.gitignore`.
5. Drop `@xyflow/react` from `frontend/package.json` (host + container
   uninstall per the node-modules sync rule).
6. Write the four agent files in `.claude/agents/` (local-only, not
   committed).
7. Delete `solvro-code-reviewer.md` and `solvro-ui-reviewer.md`.
8. Add the SessionStart hook (local settings): compare local vs.
   `origin/develop` + `origin/main` heads, surface "behind remote" in the
   session; then delete the orphaned `feedback_check_github_updates.md`
   memory it replaces.
9. CHANGELOG entries for the tracked changes (CLAUDE.md, DESIGN.md,
   CONFIGURATION.md, archives, dependency removal).
10. First live run on the next real task; tune agent prompts from what the
    run surfaces.

## Execution log (2026-07-21)

Migration executed same day by four subagents + orchestrator. All steps
complete. **User policy set at execution time: the entire migration is
local-only — never committed to or pushed to the public GitHub repo.**
Consequences:

- `CONFIGURATION.md`, `docs/plans/`, `docs/prompts/`, `docs/ideas/` added to
  `.gitignore` (the "tracked" decision for CONFIGURATION.md was reversed by
  the user — it stays local like CLAUDE.md).
- Local working-tree modifications to already-public tracked files
  (`DESIGN.md`, `ISSUES.md`, `CHANGELOG.md`, `.gitignore`,
  `frontend/package.json` + lockfile) and the `tasks/` → `docs/archive/tasks/`
  move remain **uncommitted** by design. They will surface in `git status`
  until the user decides their fate; pulls/rebases may need care around them.
- The public CHANGELOG carries only the public-eligible entries (dependency
  removal, .gitignore); this section is the local record of the docs
  migration itself (CLAUDE.md restructure, DESIGN.md regeneration — 78 hex
  values verified, CONFIGURATION.md 10-section fix, archives, agent roster,
  SessionStart hook, AI DevKit removal).
- Local `develop` was found 29 commits behind `origin/develop` (main: 58) by
  the new SessionStart hook. Doc facts were verified against the local tree;
  re-verify hot facts after the next pull.
- **Public-repo cleanup (PR #22, user-approved)**: removed `tasks/`,
  `docs/{ideas,intent,mockups}/`, `ISSUES.md`, `DESIGN.md` from the GitHub
  repo and extended the public `.gitignore` (now synced to the local copy).
  After the PR merges, local reconciliation is needed: back up the local
  DESIGN.md/ISSUES.md (regenerated versions), pull develop (incoming merge
  deletes those tracked files → modify/delete care), restore the local
  copies — they become ignored local files and `git status` goes clean.

## Tune-up (2026-07-25)

The step-10 "first live run, then tune" retrospective, executed after the
Plan A + Plan B Tailwind v4 / ReUI Gantt branch (`feat/tailwind-v4-shadcn`,
3cb3582..e0a2267 — the roster's first heavy workload). All changes local-only
and user-approved:

- **Model pins (user decision)**: `solvro-implementor`, `solvro-qa`, and
  `solvro-docs-keeper` → `claude-sonnet-5`; `solvro-reviewer` →
  `claude-opus-5`. The docs-keeper had been `haiku`, conflicting with the
  standing "Sonnet is the floor for every subagent" rule. The orchestrator is
  whatever model the main session is started with — flexible by design.
- **Layer-2 premise corrected.** "Agent files carry role guardrails only …
  these cannot drift because they describe the role, not the product" proved
  false: embedded file paths, gate commands, and trigger lists ARE product
  facts, and all three drifted within one migration. Fixed: the reviewer's
  token spot-verify target (`tailwind.config.ts` → `index.css` `@theme` /
  `@theme inline` + `theme.tsx`), the docs-keeper's DESIGN.md trigger list
  (same), and the qa agent's vitest gate (plain `docker compose exec backend
  npm test` — which pollutes the live dev DB — replaced with the isolated
  `solvro_test` recipe from CLAUDE.md's Testing caveats).
- **Ownership hole closed.** The docs-keeper gains duty 6: sync stale product
  facts (paths / commands / trigger lists) embedded in `.claude/agents/*.md`.
  Facts only — role guardrails, duties, models, and tool lists still change
  only via explicit user-approved notes from the orchestrator. Its write-scope
  guardrail widened to match.
- **ISSUES.md gets a pruning cadence.** The docs-keeper's filing duty now
  includes striking entries the shipped work verifiably resolved or mooted
  (dated strikethrough, the file's existing convention). First prune executed
  same day: Reports-revamp "pending" item (shipped), the tailwind-restart
  gotcha (no config file left to cache), the stale `@xyflow/react` mention
  (dep removed), and the June visual-sign-off blanket item (superseded by the
  individually tracked tech-debt nits).
- **Retrospective observation, no change made**: the walkthrough rounds
  (F1–F5b) confirmed the user walkthrough is the only gate that catches
  perceptual/UX defects — 43 green e2e tests missed all five. A candidate
  future addition is an agent-driven screenshot pass over touched surfaces
  before the user walkthrough; deliberately not added yet.

## Out of scope

- Skill-pack consolidation — global config, handled outside this repo.
  Direction discussed: superpowers = process, agent-skills = domain
  reference (superpowers wins on overlap), AI DevKit removal pending user
  confirmation.
- Hook fan-out trimming — cosmetic, revisit only if sessions feel slow.

---

## v2 addendum (2026-07-28) — phase-based pipeline

The flat per-task pipeline above (implementor → qa → reviewer → docs-keeper, every
task) was replaced after the user measured its cost: a 5-task phase nominally costs
~25 subagents and in practice more, because fix rounds respawned fresh agents
(re-reading contracts, re-deriving context) and independent tasks ran sequentially.
Full converged design + rationale: `docs/archive/plans/pipeline-v2-design.md`.

What changed:

- **Phases, not per-task ceremony.** One opus review per phase on the combined
  diff (phase = branch = PR, tasks = commits), plus instant single-task review
  when a task touches the spine list in CLAUDE.md's roster — enforced
  mechanically by the gate script, not model judgment.
- **`solvro-qa` retired.** Its charter is now `.claude/scripts/gates.sh`
  (typechecks, isolated-DB vitest, Playwright smoke, CHANGELOG presence,
  guardrail greps, spine check), run after every task. Two-layer verification
  survives — the layers are now script + orchestrator acceptance.
  v1 file archived at `docs/archive/solvro-qa-agent-v1.md`.
- **Independent tasks run in parallel waves** (2–3 concurrent sonnet
  implementors; worktree isolation when files overlap). CHANGELOG entries are
  reported by wave members and appended serially by the orchestrator.
- **Fix rounds continue the same agent** (SendMessage) instead of respawning.
- **docs-keeper is trigger-conditional** at phase end, no longer always-on.

Everything else above stands: pipeline-stage division, merged reviewer with the
design lens, no-commit rule, local-only roster, model pins (sonnet implementor /
opus reviewer — cheap generation, expensive judgment).
