# Draft: guardrails proposed for the customer repository (2026-09-21)

Written when this repository was to hold the installer only. The user then decided to include the source, so the root `CLAUDE.md` is the Solvro contract. Merge what still applies into its Guardrails block. The "No source code here" guardrail below is void.

---

# CLAUDE.md

Shared contract for the interactive session and every subagent in `.claude/agents/`. Structure: **Guardrails** (invariants, user-owned) → **Map** → **Traps** → **Ops** → **Agent Roster**.

**This file carries rules, decisions, and traps — never current-state facts.** Derive facts from the files at task time. Status lives elsewhere: `CHANGELOG.md` = shipped, `docs/plans/` = planned, `docs/ISSUES.md` = broken/deferred.

## Product

This repository is the **customer distribution** of Solvro: the installer, the version to install, operator docs, support and license terms, and release notes. A customer's operator clones it and runs `setup.sh` on their own server. The application itself ships as two private container images on GHCR (`ghcr.io/alfi-rajasyah/solvro-backend`, `ghcr.io/alfi-rajasyah/solvro-frontend`), built from the private source repository `alfi-rajasyah/solvro`. The source code never lands here.

## Guardrails

MUST/NEVER invariants. User-owned — agents read this block; only the user edits it.

- **No secrets in the repository, ever.** `setup.sh` never prompts for, stores, prints, or receives a registry token. The customer runs `docker login ghcr.io` themselves. No `.env`, token, or password is committed; `~/solvro/.env` stays on the customer's server.
- **No source code here.** Nothing from `alfi-rajasyah/solvro` other than `setup.sh` is copied into this repository. A customer never gets a source URL, a Dockerfile, or a build instruction from here.
- **Customers install a `vX.Y.Z` tag.** `VERSION` holds exactly one tag, one line, nothing else. `latest` is never written to `VERSION` and never offered to a customer.
- **A fresh install never destroys data silently.** `setup.sh` must refuse to delete an existing `solvro_pgdata` volume unless `FORCE_FRESH=1` is set (until that lands, the trap below applies).
- **Customer-facing text is customer-facing.** `INSTALL.md`, `OPERATIONS.md`, `SUPPORT.md`, and every release note name screens and behaviour only: no internal vocabulary (branches, PR numbers, agents, plan names), no customer names, no source paths.
- **Changelog Discipline (mandatory).** Every change to `setup.sh`, `VERSION`, the docs, `.claude/`, or `.gitignore` gets a `CHANGELOG.md` entry in the same turn — Keep-a-Changelog style under `[Unreleased]`, append-only, never rewrite existing entries. Release notes for a Solvro version are a separate document (`notes/`, published as a GitHub Release), written from the source repository's changelog.
- **Docs Discipline (mandatory).** This file changes only when a guardrail, convention, or architecture changes — never for status.
- **Branch & PR flow.** Work branches off up-to-date `origin/main` (`git fetch origin` first); every PR targets `main`. Every opened PR is immediately assigned to the user: `gh pr edit <n> --add-assignee alfi-rajasyah`.
- **No agent or session ever commits, opens a PR, cuts a release, or changes repository or package access on its own.** The orchestrator stages work and drafts the commit message; every commit, PR, `VERSION` bump, GitHub Release, and customer invitation waits for explicit user approval.
- **Issues stay off.** Every invited customer sees the same repository, so an issue from one customer would be visible to another. Support is by email (`SUPPORT.md`).

**Standing decisions** (settled — don't re-litigate): the images stay private on GHCR and are the paywall; a customer gets read access with their own GitHub account (repository + both packages) and a classic PAT with `repo` + `read:packages`; the source repository stays private; no license-key or seat enforcement in the app is part of this repository's scope.

## Map

| Where | What |
|---|---|
| `setup.sh` | The installer and updater. Writes `~/solvro/docker-compose.yml` and `~/solvro/.env` on the customer's server. |
| `VERSION` | The one tag this repository installs. |
| `INSTALL.md` | Customer-facing install and upgrade guide. |
| `OPERATIONS.md` | Customer-facing operator reference: containers, ports, files, env, backup/restore, logs. |
| `SUPPORT.md` | Support contact and what a report must include. |
| `LICENSE.md` | Proprietary license terms. |
| `notes/` | Release-notes drafts; `TEMPLATE.md` is the shape. Published as GitHub Releases. |
| `docs/plans/` | Planned work. `docs/ISSUES.md` for known/deferred issues. |
| `CHANGELOG.md` | This repository's own change history. |
| `.claude/` | Agent workflow: agents, `scripts/gates.sh`, reply-style hook and rules, `settings.local.json`. Tracked in this repository by user decision (2026-09-21). |

## Traps

- **`setup.sh` wipes `solvro_pgdata` on any run without `~/solvro/.env`.** Never run it on a server with data unless `.env` is present. Until the wipe guard lands, this is the single most dangerous line in the repository.
- **`setup.sh` still pulls `:latest`** and does not read `VERSION`. The version pin is planned (`docs/plans/setup-sh-hardening.md`).
- **The images are private.** An anonymous or un-granted pull returns HTTP 403. GitHub requires a classic PAT with `read:packages` for the Container registry; fine-grained tokens do not work there.
- **`git clone` of this private repository needs the same PAT** with the `repo` scope, as the password.
- **`.claude/agents/*` and `.claude/scripts/gates.sh` were copied from the Solvro source repository** and still describe that stack (backend/frontend/e2e, Docker Compose, Prisma). They do not apply here until rewritten; the gates for this repository are the Ops line below.
- **`~/solvro/docker-compose.yml` is regenerated on every `setup.sh` run.** Operator changes go in `~/solvro/.env`, never in the compose file.

## Ops

```bash
bash -n setup.sh && shellcheck setup.sh          # the gates for this repository
ADMIN_EMAIL=qa@example.com ADMIN_PASSWORD='QaTest1234!' bash setup.sh   # fresh VM only — see the wipe trap
gh release create vX.Y.Z --notes-file notes/vX.Y.Z.md                    # user-approved only
```

## Agent Roster

The orchestrator is the interactive session itself: plans with the user (`docs/plans/`), routes work, integrates, stages changes, drafts commit messages — and never commits without explicit user approval.

| Agent | Model | Role |
|---|---|---|
| `solvro-implementor` | sonnet-5 | Executes one task; verifies with scoped checks (`bash -n`, `shellcheck`, a fresh-VM run when the user provides one); reports to the orchestrator incl. CHANGELOG entry text. Never commits. |
| `solvro-reviewer` | opus-5 | One review per change set before the PR. `setup.sh` is always on the spine: every diff to it gets a review. Customer-facing docs get a plain-language lens. |
| `solvro-docs-keeper` | sonnet-5 | Only if triggered: CHANGELOG doubt, a deferred finding, a moved path. |

Sonnet is the floor for every subagent — never haiku.
