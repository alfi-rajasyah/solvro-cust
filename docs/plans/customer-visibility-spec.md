# Customer Visibility — Spec & Plan

Status: **confirmed 2026-08-31 (user)** — §3 is settled.
Branch (not yet created): `feat/customer-visibility` off `origin/develop`.
Supersedes Daily Review v2 Decisions 13 and 14 (`docs/archive/plans/daily-review-v2-spec.md` §3).

## 1. Problem

- `Customer.tamId` exists (`backend/prisma/schema.prisma:218`) and the customer form sets it, but nothing reads it as an access rule.
- `GET /customers` returns every customer to every authed user (`backend/src/routes/customers.ts:40` — "Customer routes have no visibility filter").
- Projects have a rule (`projectVisibilityFilter`, `backend/src/lib/visibility.ts:15`); customers do not. The Daily Review route re-derives a customer scope ad hoc (`backend/src/routes/dailyReview.ts:207-220`).
- A TAM cannot answer "which customers are mine?" anywhere except the Daily Review page.

## 2. Goals / Non-goals

Goals
- One rule, `customerVisibilityFilter(user)`, next to `projectVisibilityFilter`. Every customer read and write goes through it.
- The Customers page, the customer page, operations notes, weekly updates, services, search hits, the project form's customer select, and the Daily Review page all follow that rule.
- The Daily Review page becomes customer-first: a TAM reviews the customers assigned to them and every active project under those customers.

Non-goals
- No new permission string. No schema change. No migration.
- No ownership gate on weekly updates or operations notes (today's `project:write` gate stays).
- No "Mine / All" toggle for `project:view-all` users (follow-up).

## 3. Decisions (settled 2026-08-31 — do not re-litigate)

| # | Decision | Choice |
|---|---|---|
| 1 | Visibility rule | `project:view-all` or `*` → everything. Otherwise: `Customer.tamId = me` **OR** `tamId = null` **OR** the customer has ≥1 project visible to me (`projects: { some: projectVisibilityFilter(user) } }`). The second arm keeps the project page's customer link working for SAs and for project TAMs on another TAM's customer. Owning a customer also grants project visibility — see Decision 14. |
| 2 | Unowned customers (`tamId = null`) | Visible to everyone, as today (user, 2026-08-31). Hidden = a customer owned by another TAM that has no project of yours. |
| 3 | Permission | Reuse `project:view-all`. Mirrors v2 Decision 8 (no `customer:write` either). |
| 4 | Create default | `POST /customers` with `tamId` omitted → `tamId = creator`. Explicit `tamId: null` → allowed only with `project:view-all`; otherwise 400 `tam_required`. A TAM can never create a customer they cannot see. |
| 5 | Reassign | `PATCH /customers/:id { tamId }` to another user is allowed (handover). The form shows a confirm when the caller will lose the customer. |
| 6 | Id-keyed routes | `ensureCustomerVisible(user, id)` replaces `assertCustomerExists`. 404 `customer_not_found`, not 403 — same reasoning as `ensureProjectVisible`. |
| 7 | Project ↔ customer link | `POST /projects`, `PATCH /projects/:id`, `POST /opportunities/:id/handoff`: a `customerId` the caller cannot see → 400 `customer_not_found` (body-field convention, like `tam_not_found`). Today there is no check at all. |
| 8 | Daily Review — customers on the page | Visible customers where `tamId = me` **OR** with ≥1 ACTIVE project visible to me. An unowned customer appears only through such a project. View-all: customers with `tamId` set OR ≥1 ACTIVE project. |
| 9 | Daily Review — projects under a customer | **Owned** customer (`tamId = me`): every ACTIVE project of that customer, whoever the project TAM is. **Attached** customer (visible only via a project): ACTIVE projects where `Project.tamId = me` (old Decision 13 rule). View-all: all ACTIVE projects. |
| 10 | Daily Review — "No customer" group | Unchanged: ACTIVE projects with `customerId = null` and `Project.tamId = me`. |
| 11 | Search | Customer hits filtered by the rule (`backend/src/routes/search.ts:63`). |
| 12 | Customer card | Adds a `TAM: <username>` line under the AM line. |
| 13 | Copy | Customers subtitle (non-view-all): "Customers assigned to you, plus customers of the projects you work on." Daily Review subtitle: "Your customers, their active projects, and each customer's weekly update." Empty state (non-view-all): "No customers are assigned to you." |
| 14 | Owned customer → project access | `projectVisibilityFilter` gains a third arm: projects of customers where `Customer.tamId = me`. App-wide (Projects, Kanban, Gantt, tasks, notes, reviews). Full access, equal to the project TAM's — including `PATCH /projects/:id` (status, TAM, customer), baseline, tasks, sections, risks (orchestrator reading of the user decision, 2026-08-31; reversible by gating those fields on project TAM/SA membership). Without it the Daily Review's owned-customer groups were read-only with silent rollbacks (phase review, blocker). (user, 2026-08-31) |
| 15 | Handoff picker | No code. Roles that hand off won deals get `project:view-all` in Admin > Roles, so the handoff customer select lists every customer. Recorded in `docs/CONFIGURATION.md`. (user, 2026-08-31) |

Alternative rejected for Decision 9: flat rule (every ACTIVE project of every visible customer). A project TAM on one project of a large customer would then review all that customer's projects. Two-tier keeps the review list equal to "my customers + my projects".

## 4. Data model

None. `Customer.tamId` and its index already exist.

## 5. API

### 5.1 `backend/src/lib/visibility.ts` (spine → instant review)

```ts
export function customerVisibilityFilter(user: JwtPayload): Prisma.CustomerWhereInput {
  if (hasPermission(user, "project:view-all")) return {};
  return { OR: [{ tamId: user.sub }, { tamId: null }, { projects: { some: projectVisibilityFilter(user) } }] };
}

export async function ensureCustomerVisible(user: JwtPayload, customerId: number): Promise<void>;
// findFirst({ where: { id, ...customerVisibilityFilter(user) } }) → HttpError(404, "customer_not_found")
```

### 5.2 `backend/src/routes/customers.ts`

- `GET /` — `where: customerVisibilityFilter(user)`.
- `GET /:id` — `findFirst` with the filter; 404 `customer_not_found`.
- `POST /` — Decision 4. Response unchanged.
- `PATCH /:id`, `DELETE /:id`, `PUT /:id/services`, notes (`GET/POST/PATCH/DELETE`), weekly updates (`GET/PUT`) — `ensureCustomerVisible` first. Delete `assertCustomerExists`.

### 5.3 `backend/src/routes/dailyReview.ts`

Replace the Decision 13/14 block (`:132-146`, `:207-220`) with, in order:
1. `customers = customer.findMany({ where: AND[ customerVisibilityFilter(user), OR[ {tamId: me} | view-all: {tamId: not null}, { projects: some { status: ACTIVE, ...projectVisibilityFilter } } ] ] })`.
2. `ownedIds` = customers where `tamId = me` (view-all: every id).
3. `projects = project.findMany({ where: AND[ {status: ACTIVE}, OR[ {customerId: in ownedIds}, {tamId: me, customerId: in attachedIds}, {tamId: me, customerId: null} ] ] })` — view-all: `{status: ACTIVE}` only.
Payload shape unchanged. Query count unchanged (still O(1)).

### 5.4 `backend/src/routes/search.ts`

Customer query: `where: AND[ customerVisibilityFilter(user), { name: contains } ]`.

### 5.5 `backend/src/routes/projects.ts` (spine → instant review) and `opportunities.ts`

`POST /projects`, `PATCH /projects/:id` (when `customerId` present), `POST /opportunities/:id/handoff`: `ensureCustomerVisible` → rethrow as 400 `customer_not_found`.

## 6. Frontend

No `queries.ts` change: `CustomerSummary.tam` and the Daily Review payload shape already exist.

- `frontend/src/pages/Customers.tsx` — subtitle by `hasPermission(user, "project:view-all")` (Decision 13); card `TAM:` line (Decision 12); empty-state copy.
- `frontend/src/components/CustomerFormModal.tsx` — on create, TAM select pre-selects the current user; the "— none —" option renders only for view-all users (Decision 4). On edit, when a non-view-all user picks another TAM and is not a project TAM/SA on any of the customer's projects, a `ConfirmModal` says "You will lose access to <name>." (Decision 5).
- `frontend/src/pages/CustomerDetail.tsx` — no change; the existing error state (`:92`) covers the 404.
- `frontend/src/pages/DailyReview.tsx` — subtitle copy (Decision 13). Groups and cards unchanged.
- `ProjectFormModal.tsx`, `Projects.tsx`, `Tasks.tsx`, `DealCard.tsx` — no code change; `useCustomers()` now returns the visible set. Invariant: a project the caller can edit always has a visible customer (Decision 1, second arm), so the edit form's current value is always in the list.

## 7. Guardrail check

- INTERNAL notes: untouched.
- No new packages. No drag libraries.
- `docs/DESIGN.md`: copy-only frontend changes plus one text line on the customer card; no new tokens or components.
- Spine touches: `lib/visibility.ts`, `routes/projects.ts` → instant review each. `schema.prisma`: untouched.
- CHANGELOG: one entry per task, written for a public reader.

## 8. Acceptance criteria

1. A TAM with, in the DB, one owned customer, one attached customer (project TAM on another TAM's customer), one unowned customer (`tamId = null`), and one unrelated customer (owned by another TAM, no project of the caller) sees exactly three on `/customers` and in `GET /customers`; the unrelated one is absent.
2. `GET /customers/:id` on the unrelated customer → 404 `customer_not_found`; same for its notes, weekly updates, and services routes.
3. STAKEHOLDER (`project:view-all`) and ADMIN (`*`) see every customer.
4. `POST /customers` by a TAM without `tamId` → `tam.id = caller`. With `tamId: null` → 400 `tam_required`. By ADMIN with `tamId: null` → 201, `tam = null`.
5. `POST /projects` by a TAM with an unrelated `customerId` → 400 `customer_not_found`.
6. Daily Review, TAM: the owned customer's group lists every ACTIVE project, including one whose project TAM is another user; the attached customer's group lists only the caller's ACTIVE projects; the unrelated customer is absent; coverage `total` counts the two groups.
7. Daily Review, STAKEHOLDER: unchanged from today.
8. Search by the unrelated customer's name returns no customer hit for the TAM.
9. e2e (desktop + mobile): admin creates two TAM users and one customer per TAM via the API; TAM A logs in and sees customer A but not customer B on `/customers` and on `/daily-review`.

## 9. Tests

- New `backend/test/customerVisibility.test.ts` — criteria 1–5, 8. Fixtures via `prisma` + `testAuth.ts` (`createUserWithRole`, `createAdminAndToken`).
- `backend/test/dailyReview.test.ts` — rewrite `describe("GET /daily-review — scope")` for Decisions 8–10; the rest stays.
- `backend/test/search.test.ts` — one case for Decision 11.
- New `e2e/tests/customer-visibility.spec.ts` — criterion 9, using `POST /admin/users` and `login(base, email, password)` from `e2e/fixtures/seed.ts`.

## 10. Task list

### Wave 1 — foundation (solo, spine)
- **T1** `lib/visibility.ts`: `customerVisibilityFilter`, `ensureCustomerVisible`. Instant review.

### Wave 2 — backend (3 in parallel)
- **T2** `routes/customers.ts` (§5.2) + `customerVisibility.test.ts` (criteria 1–4).
- **T3** `routes/dailyReview.ts` (§5.3) + scope tests rewrite (criteria 6–7).
- **T4** `routes/search.ts`, `routes/projects.ts`, `routes/opportunities.ts` (§5.4–5.5) + tests (criteria 5, 8). Instant review (`projects.ts`).

### Wave 3 — frontend (2 in parallel)
- **T5** `Customers.tsx`, `CustomerFormModal.tsx` (§6).
- **T6** `DailyReview.tsx` copy + `e2e/tests/customer-visibility.spec.ts` (criterion 9).

### Wave 4 — close
- Full `gates.sh`, phase review, CHANGELOG check, docs-keeper (trigger: `backend/CLAUDE.md:10` visibility convention gains the customer helpers). Move `docs/plans/daily-review-v2-spec.md` to `docs/archive/plans/` (shipped).

## 11. Risks & mitigations

- A TAM with no customer and no project sees an empty Daily Review. Mitigation: `project:write` lets them create a customer and become its TAM (Decision 4).
- Handover (Decision 5) hides the customer from the caller at once. Mitigation: the confirm dialog; the customer stays reachable through any project they are TAM/SA on.
- `PATCH /customers/:id` today uses `prisma.customer.update` — a hidden id would 500 on P2025 without the preamble. Mitigation: `ensureCustomerVisible` on every id-keyed route (Decision 6), covered by criterion 2.
