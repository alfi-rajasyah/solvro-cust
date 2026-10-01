# Implementation Plan: Claim Unassigned Deals

**Branch:** `fix/claim-unassigned-deals` — cut from `origin/develop` @ `cc6b361` (`git fetch origin` first; local `develop` was level with origin on 2026-09-08).
**Phase = branch = one PR into `develop`.** Tasks = commits. No commit or PR without explicit user approval.
**Source:** bug report 2026-09-07 — on the Pipeline page an SA sees no Delete button on an unassigned deal, nobody can assign a PIC to it, and an SA cannot claim it. Root cause: `assertCanWriteOpportunity` (`backend/src/lib/pipelineAccess.ts:29`) compares `picId === user.sub`; a null `picId` never matches, and the SA role holds only the `_own` pair. The frontend gates in `boardLogic.ts` mirror the rule, so the UI hides Edit, Delete, the stage menu, Add link and the drag grip.
**Review surfaces (approved 2026-09-08):** proposal page https://claude.ai/code/artifact/323a0cb8-1a95-45fd-bc39-32fae88fa969 · screen mockups https://claude.ai/code/artifact/48d76109-c097-4640-9b0b-75b2843962be.

---

## 1. Decisions (settled — do not re-ask)

| # | Decision | Detail |
|---|---|---|
| D1 | Assign first | An unassigned deal stays locked. No drag, edit, stage change, link or delete for `_own` holders until the deal has a PIC. `assertCanWriteOpportunity`, `canDragDeal` and `canDeleteDeal` do not change. |
| D2 | One action, one route | Assigning a PIC is a dedicated route (`POST /opportunities/:id/assign`), a dedicated gate, a dedicated button and a small dialog. It is not a partial Edit; the PATCH schema stays strict. |
| D3 | After assignment | The existing own-rules unlock the deal for its PIC. No new rule for assigned deals. |
| D4 | Who may assign, to whom | `pipeline:edit_all`: any deal, any time. `pipeline:edit_own`: only a deal with no PIC. Target: any existing user. The dialog's select starts on the caller. |
| D5 | Create default | The New opportunity form starts with PIC = the creator. "No PIC" stays selectable. Edit mode unchanged. Import unchanged (a row without a PIC still imports unassigned and gets its PIC through the new route). |
| D6 | Activity note | The assign route writes `Assigned to <username>` in the same transaction, only when the PIC actually changes. Same mechanism as the "Moved from … to …" note. |
| D7 | Unchanged | Permission strings, the seed, viewer rules (`pipeline:view` reads and adds notes), list visibility, the board card, drag-and-drop, PATCH/DELETE/move/handoff/link routes. |
| D8 | Out of scope | The seed-overwrite trap (Admin → Roles edits to built-in roles are undone at container start — separate decision). Reassigning an assigned deal for `_own` holders (they use Edit). Assign actions on board cards or list rows. Bulk assign during import. |

## 2. API

`backend/src/routes/opportunities.ts` and `backend/src/lib/pipelineAccess.ts` — not on the spine list; permission logic, so the phase review reads them with care.

### `POST /opportunities/:id/assign` (new)

```ts
// params: { id: uuid }   body (.strict()): { picId: number }  // positive int, required
```

Order of checks, same as the other id-keyed routes:
1. `findOpportunityOr404(id)` → 404 `not_found`.
2. `assertCanAssignOpportunity(req.user, current)` (new helper in `pipelineAccess.ts`, beside `assertCanWriteOpportunity`): `pipeline:edit_all` (or `*`) passes; `pipeline:edit_own` passes only when `current.picId === null`; otherwise 403 `forbidden`, message `Missing permission: pipeline:edit_all, or pipeline:edit_own on an unassigned deal`.
3. `prisma.user.findUnique({ where: { id: body.picId }, select: { id: true, username: true } })` → 400 `pic_not_found` when null (body-field reference → 400, per `backend/CLAUDE.md`; the username is needed for the note anyway).
4. One `prisma.$transaction`: `opportunity.update({ data: { pic: { connect: { id } } }, include: { pic: { select: PIC_SELECT } } })`; then, only if `current.picId !== pic.id`, `opportunityActivity.create({ opportunityId, userId: req.user.sub, note: \`Assigned to ${pic.username}\` })`.
5. Response 200, `serializeOpportunity(updated)` — same shape as PATCH.

Header comment for the route: the one writer of a PIC on an unassigned deal for `_own` holders; PATCH keeps serving `_all` holders and the deal's own PIC.

Unchanged: PATCH, DELETE, `/move`, `/handoff`, the link routes, `ensureOpportunityEditable`. They keep refusing an unassigned deal for `_own` holders (D1).

## 3. Frontend

### Gate — `frontend/src/components/pipeline/boardLogic.ts`

```ts
export function canAssignDeal(user, deal: Pick<PipelineBoardDeal, "picId">): boolean
// pipeline:edit_all → true; pipeline:edit_own && deal.picId === null → true; else false
```

Doc comment mirrors `canDragDeal`'s: proactive UI gate, server stays the authority. `canDragDeal` and `canDeleteDeal` untouched.

### Data layer — `frontend/src/lib/queries.ts` (**spine**, instant review after T2)

```ts
export function useAssignOpportunity()
// mutationFn: ({ id, picId }: { id: string; picId: number }) =>
//   apiRequest<Opportunity>(`/opportunities/${id}/assign`, { method: "POST", body: { picId } })
// onSuccess: invalidate pipelineKeys.list, pipelineKeys.detail(id), pipelineKeys.activities(id)
```

Not optimistic: it is a dialog submit, not an inline edit. Placed next to `useUpdateOpportunity`.

### Detail page — `frontend/src/pages/OpportunityDetail.tsx` + `frontend/src/components/AssignPicModal.tsx` (new)

- `const canAssign = deal.picId === null && canAssignDeal(user, deal);` — the button shows only on an unassigned deal (an `_all` holder on an assigned deal uses Edit).
- Button **Assign PIC** (icon `person_add`) in the header action row, before Edit/Delete, in the "Create project" outline-primary class (`border-primary … text-primary hover:bg-primary/10`). Opens `AssignPicModal`.
- `AssignPicModal` on `Modal` (`widthClass="max-w-md"`, title "Assign PIC"): one line `{deal.title} has no PIC yet. Pick one to unlock the deal.`; a `<select>` labelled "PIC" (required, label-caps markup and `rounded-lg` select classes copied from `OpportunityFormModal`) over `useUsers()`, initial value `user.id`; helper line `Only the PIC can edit, move, link or delete this deal. Other SAs can read it and add notes.`; footer Cancel · **Assign** (disabled while pending); inline error from `ApiError`. On success: close. Reset the select to `user.id` on every open.
- Update the header comment block (lines 7–10) that documents the Edit affordance, so it names the Assign path too.
- Edit, Delete, the stage menu and Add link stay gated as today (D1).

### New opportunity form — `frontend/src/components/OpportunityFormModal.tsx`

Create branch of the `useEffect` reset: `setPicId(user?.id ?? "")` (import `useAuth`). Edit branch unchanged. Nothing else.

### Admin › Roles hints — `frontend/src/lib/auth.tsx`

`pipeline:edit_own` hint: `Edit and change the stage of opportunities you're the PIC for, and assign a PIC to an unassigned opportunity.` Other hints unchanged.

## 4. Tests

### Backend — `backend/test/opportunities.test.ts`, new `describe("POST /opportunities/:id/assign")`

Use the file's `createSaLikeUser`, `createManagerLikeUser`, `createUserWithPermissions(["pipeline:view"])`, and an admin-created unassigned deal.
1. SA-like on an unassigned deal, `picId` = self → 200, `pic.id` = self; exactly one activity `Assigned to <username>`.
2. SA-like on an unassigned deal, `picId` = another user → 200 (D4).
3. SA-like on a deal whose PIC is another user → 403.
4. SA-like on their own deal → 403 (the route is for unassigned deals; Edit covers own deals).
5. Manager-like on an assigned deal → 200 and a note; the same `picId` again → 200 and no second note (D6).
6. `pipeline:view` only → 403.
7. Unknown `picId` → 400 `pic_not_found`. Missing / non-positive `picId` → 400. Malformed id → 400. No token → 401.
8. Regression guard for D1: SA-like PATCH and DELETE on an unassigned deal still 403.

### Frontend — `frontend/src/components/pipeline/boardLogic.test.ts`

`canAssignDeal`: no permissions → false; `edit_all` → true for null, own and foreign `picId`; `edit_own` → true only for null `picId`, false for own and foreign.

### Playwright — `e2e/tests/pipeline-form.spec.ts` (desktop)

New test, same setup pattern as the view-only test at the end of the file (admin creates a role + user through `/api/admin/roles` and `/api/admin/users`, `loginViaUi`): role with `pipeline:view`, `pipeline:create`, `pipeline:edit_own`, `pipeline:delete_own`; the admin creates an unassigned deal through the API; the SA opens `/pipeline/{id}`; asserts `Edit` and `Delete` buttons have count 0; clicks `Assign PIC`; the dialog's select shows the SA's username; clicks `Assign`; asserts the PIC value shows the username, `Edit` and `Delete` are visible, and the activity feed contains `Assigned to <username>`. Extend the `afterAll` cleanup to tear down this role, user and deal (turn the single viewer id pair into arrays, or add a second pair).

## 5. Task list

4 tasks. `solvro-implementor` each; scoped checks only; report CHANGELOG entry text, never write `CHANGELOG.md` (one writer at integration). The backend implementor uses `solvro_t1_test` — see `backend/CLAUDE.md`'s `TEST_URL` recipe and swap the DB name.

### T1 — Assign route, gate helper, backend tests
**Files:** `backend/src/routes/opportunities.ts`, `backend/src/lib/pipelineAccess.ts`, `backend/test/opportunities.test.ts`.
1. §2 exactly. Keep the route next to `/move`; keep the helper next to `assertCanWriteOpportunity` with a doc comment that states D1 and D4.
2. §4 backend tests.
3. Scoped checks: backend `npx tsc --noEmit` + `opportunities.test.ts` on `solvro_t1_test`.
4. CHANGELOG (Fixed): the route, the rule, the note, why (an SA could not assign, claim or unlock an unassigned deal).

### T2 — Frontend gate and hook
**Files:** `frontend/src/components/pipeline/boardLogic.ts`, `frontend/src/components/pipeline/boardLogic.test.ts`, `frontend/src/lib/queries.ts` (**spine**).
1. §3 gate + hook. No other change in `queries.ts`.
2. §4 frontend unit tests.
3. Scoped checks: frontend `npm run typecheck`, `boardLogic.test.ts`.
4. CHANGELOG (Added).

### T3 — Assign PIC button and dialog, form default, role hint
**Files:** `frontend/src/pages/OpportunityDetail.tsx`, `frontend/src/components/AssignPicModal.tsx` (new), `frontend/src/components/OpportunityFormModal.tsx`, `frontend/src/lib/auth.tsx`.
1. §3 detail page, form default, hint — to the mockups. Reuse `Modal`, `useUsers`, `useAuth`, `ApiError`.
2. Accessibility: the dialog title is "Assign PIC"; the select carries `aria-label="PIC"`; the button's accessible name is `Assign PIC` (the e2e flow keys on it) and the submit's is `Assign`.
3. Scoped checks: typecheck. No browser — the reviewer and T4 verify pixels.
4. CHANGELOG (Added / Changed).

### T4 — Playwright
**Files:** `e2e/tests/pipeline-form.spec.ts`.
1. §4 Playwright flow.
2. Scoped checks: `cd e2e && npm run test:desktop` against the dev stack (`BASE_URL=http://localhost:5173`).
3. CHANGELOG (Added, one line under the tests entry).

## 6. Waves and gates

| Wave | Tasks | Notes |
|---|---|---|
| W1 | T1 ∥ T2 | Disjoint areas. T2 codes against the §2 contract; no runtime dependency for typecheck or unit tests. Start Docker first (`open -a Docker`, wait for `docker compose ps` healthy) before T1. Gates once at integration + **instant opus review** (`queries.ts` spine). |
| W2 | T3 | Needs T2's gate and hook. Gates. |
| W3 | T4 | Needs T1 + T3 on the dev stack. Gates (Playwright smoke runs inside gates on frontend diffs; the full desktop e2e run is T4's own check). |
| Close | — | One `solvro-reviewer` phase review on the combined diff (design lens: `docs/DESIGN.md`; permission lens: `pipelineAccess.ts`); `solvro-docs-keeper` only if a trigger fires (none expected); stage, draft one commit message per task and the PR body → **stop for approval**. `TaskStop` every agent. |

Fix rounds continue the same implementor via `SendMessage`. Sonnet floor. Never poke an idle agent for a report — read the tree.

## 7. CHANGELOG headline (draft, orchestrator-owned)

Under `[Unreleased]` → `### Fixed — Pipeline: an unassigned deal can be given a PIC`. One entry per task, merged serially at integration. Public wording: what changed, where, why. No pipeline vocabulary.

## 8. Out of scope

Everything in D8 · any change to `assertCanWriteOpportunity` · drag-and-drop on unassigned cards · a PIC-required create form (the default is the creator; "No PIC" stays) · reporting or exports.
