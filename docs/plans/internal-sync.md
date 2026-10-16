# Plan: sync Solvro Internal's own changes into the customer edition (2026-10)

- **Date:** 2026-10-09 · **Status:** approved by the user 2026-10-09 (groups 1–5 + demo seed).
- **Branch:** `feat/internal-sync` off `origin/develop` @ `127f316` → one PR into `develop`.
- **Code comments cite:** `docs/archive/plans/internal-sync.md`.

## 1. Background

The customer edition was imported on 2026-09-21 from Solvro Internal commit `9f5fc20`
(2026-09-10); the two repositories share no git history. Internal has since ported every
customer-edition PR up to #25 (its PR #188) and made changes of its own. This phase brings
those own changes here.

**Reference clone** (read-only, never pushed): a local clone of `alfi-rajasyah/solvro` with this
repo's `develop` fetched into it as `refs/cust/develop`, so
`git -C <clone> diff refs/cust/develop origin/develop -- <path>` shows Internal's version of any file.

**Never port** (Internal-only by product decision — CLAUDE.md Guardrails): the Pipeline module
and anything `pipeline:*` / opportunity / deal / `SALES` / "Sales" nav group; the SA role and
`Project.saId` visibility arms; Velora import; `lib/holidays.ts`, `lib/workingDays.ts` (Pipeline idle
alerts); Internal's renamed migration folders; the Pipeline check in `gates.sh`; the 3 MiB Workbox
precache ceiling (only needed past 2 MiB — check the build output, record in `docs/ISSUES.md` if close).

## 2. Scope

| Group | Source in Internal | Summary |
|---|---|---|
| G1 Pen-test fixes | `db574a5` / PR #190; plan `docs/plans/pentest-remediation-2026-09.md` (D1–D12) | H1 STAKEHOLDER loses `project:view-all`; H2 `/notes/recent` + `/daily-review` need `project:read`; M1 customer owner-change rule + `customer.owner_changed` log line; M2 `GET /users`, `GET /customers`, `GET /customers/:id` need `project:read`, `/users` drops `permissions`; M3 per-request account check + `User.tokenVersion` + global sign-out on 401; L1 username rule |
| G2 iTop gates | port commits `31fdc1d`, `0e6351b`, `ea7d8f6`, `2842ea7` (decisions I-1, I-3, I-4, I-7 in `docs/archive/plans/solvro-cust-port-plan.md` §10) | `project:read` on every iTop read route, `task:write` on writes; private ticket log entries withheld from callers without `task:write`; timer pill hidden without `task:write`; Utilization nav gated; composer keeps typed text until iTop accepts |
| G3 Request log | `9c599a4` | Also mask `X-Solvro-Webhook-Secret`, `Cookie`, `Set-Cookie` |
| G4 Activity log | `67aa3c9` (decisions E-2, A-8, A-9) | Project creation event; TAM change logged + notified; epic create/edit/delete events (`lib/epicActivity.ts`, privacy invariant: description never as text) |
| G5 UI rules | `186892a` + `docs/DESIGN.md` "Binding rules adopted with the professional UI pass" | Frontend sweep to the binding rules (labels from `labels.ts`, dates from `formatDate.ts`, no text < 12px, sentence-case buttons/tabs, no `tracking-*` next to `text-label-caps`, `ConfirmModal` for destructive confirms, skeletons, `routeMeta.ts` titles). DESIGN.md block added by the docs-keeper at phase end, minus the Pipeline exception |
| G6 Demo seed | `bfccf11` | Demo activity and notifications match what the app writes |

**Decision (user, 2026-10-09) — claiming an unowned customer:** stricter than Internal's D4. A `tamId` change on a customer with no owner is allowed only for `project:view-all` holders, or when every project under the customer has the caller as its TAM (a customer with no projects qualifies). Otherwise 403 `owner_only`. Reason: owning a customer grants every project under it, so a member of one project could otherwise take the others.

Adaptations for this edition: M2 uses `requirePermission("project:read")` (no `requireAnyPermission`, no
`pipeline:view`, no `pipelineAccess` field); every SA arm in Internal's version is dropped.

## 3. Tasks

| # | Task | Group | Implementor | Wave | Spine |
|---|---|---|---|---|---|
| T1 | Pen-test part 1: H1, H2, M1, M2, L1 + tests (`directory`, `username`, owner-change, PENDING 403s) | G1 | A | 1 | `routes/admin.ts`, `lib/queries.ts` |
| T2 | iTop + Utilization permission gates, private-log withholding, timer gating, composer keep-text + tests | G2 | B | 1 | — |
| T3 | Request-log secret headers + test | G3 | B | 2 | — |
| T4 | Pen-test part 2: M3 session revocation (`tokenVersion` migration, DB-backed `requireAuth`, bumps on password change/reset, `solvro:unauthenticated` sign-out) + `sessionRevocation` test + test-helper updates | G1 | A | 2 | `http/auth.ts`, `schema.prisma`, `routes/admin.ts` |
| T5 | Activity-log additions + frontend sentences + tests | G4 | A | 3 | `routes/projects.ts` |
| T6 | UI-rules sweep (files T5 owns excluded — T5 brings Internal's version) | G5 | B | 3 | — |
| T7 | Demo seed realism | G6 | A | 4 | — |

Ordering reasons: T4 rewrites `requireAuth`, which every backend test passes through, so it runs
after T1/T2 settle; T6 touches many frontend files, so it runs last on the frontend; T7 follows
T5's event shapes.

**Shared-tree rules for parallel implementors** (one working tree, one Docker stack):
- Each implementor edits only the files of its task; a needed file outside that set → report, don't edit.
- Backend tests on a per-implementor database: A → `solvro_a_test`, B → `solvro_b_test`
  (globalSetup migrates and truncates it; the name must end in `_test`).
- Frontend typecheck serialized: `flock /tmp/solvro-frontend-tsc.lock docker compose exec -T frontend npm run typecheck`.

## 4. Verification

- Scoped checks per task; full `gates.sh` once per wave integration and at phase close.
- Instant opus review: T1, T4, T5 (spine). One phase review on the combined diff.
- Docs-keeper (triggers: DESIGN.md block, `docs/CONFIGURATION.md` role table + one-time re-sign-in note,
  `docs/ISSUES.md` follow-ups: `DELETE /customers/:id` weakness class, unchecked epic `ownerId`,
  iTop Medium/Low findings that Internal deferred).
- Screenshots of changed UI (iTop log tabs, Help role text) into the tracker before the approval request.

## 5. Acceptance

- A PENDING user gets 403 on `/users`, `/customers`, `/customers/:id`, `/notes/recent`, `/daily-review`,
  every `/itop/*` read; a STAKEHOLDER sees only projects it is attached to.
- A TAM with one project under another TAM's customer cannot take the customer (403 `owner_only`).
- A token stops working after password change, admin reset, deactivation, deletion; a role change
  takes effect on the next request; every user signs in once after deploy.
- A Cyrillic look-alike username → 400; "Admin" vs "admin" → 409.
- A user without `task:write` sees no private iTop log and no timer pill; iTop writes → 403.
- The request log never contains the webhook secret or cookies.
- Creating a project and changing its TAM appear in the activity log; epic edits appear without description text.
- No Pipeline/SA/Velora code enters this repo (`gates.sh` guardrail greps green).
