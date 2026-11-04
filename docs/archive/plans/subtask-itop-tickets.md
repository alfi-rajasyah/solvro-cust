# Implementation Plan: iTop tickets on subtask rows

**Branch:** `feat/subtask-itop-tickets`, cut from `origin/develop` (run `git fetch origin` first).
**Phase = branch = one PR into `develop`.** Tasks = commits. No commit or PR without explicit user approval.
**Source:** user request triage, 2026-11-03, request #1 ("Add iTop integration per subtask"). The user chose
"create a ticket from a subtask".
**Approved design:** Doop canvas `wIbMMkOajZ`, page "07 · Request triage — Nov 2026", frames "Triage 01"
(`5thIFomzxo`, rows + menu) and "Triage 02" (`ZZAGMGWvPr`, create dialog).
**Size:** S–M. Mostly frontend, plus one read-only batch endpoint. Not on the spine list.

---

## 1. What already works (correction to the triage)

The triage said no ticket-create path existed. **That was wrong.** Creating a ticket from a task, subtasks
included, shipped with the ticket timer (commit `4657f14`):

| Piece | Where |
|---|---|
| `POST /itop/tickets` | `backend/src/routes/itop.ts`. Takes `customerId`, `class`, `title`, `description`, `callerId`, and optionally `serviceId`. It runs **only** under the acting user's personal token (`loadWritableCustomerContext`), checks the caller belongs to the customer's iTop org with the read-only app client, and re-reads the new ticket into the snapshot (201, or 202 `staleAfterWrite`). |
| `NewTicketSheet` | `frontend/src/components/itop/NewTicketSheet.tsx`. The form: class, title, description, caller (from `GET /itop/customers/:id/contacts`), and service. |
| `TaskTicketField` | `frontend/src/components/itop/TaskTicketField.tsx`. The panel's "iTop ticket" row: pin a ref, unpin, and "Create in iTop" (opens `NewTicketSheet`, pins the new ref through `onSave`). Gated on iTop configured + `actionsEnabled` + a personal token + a mapped customer. |
| Subtask panel | `TaskPanel.tsx` renders `TaskTicketField` for every task with **no subtask gate**. Opening a subtask lets you pin a ref today. Creating one works only when every gate below passes. |

So the iTop guardrail (personal token only, never the app token, for writes) is already met by the code
this plan reuses. **No new write path is added.**

**But the button is easy to miss entirely** (user report, 2026-11-03: "There's no Create in iTop button or
even in tasks"). `TaskTicketField` renders "Create in iTop" only when **all** of these hold, and otherwise
shows the bare `R-000000` input with no explanation:
- `task:write` + `canEdit`;
- no ref pinned yet;
- the project has a customer;
- `ItopConfig.actionsEnabled`;
- the **acting user's own** personal token saved;
- the customer mapped to an iTop org.

On a fresh install, `actionsEnabled` is off and nobody has a token, so nobody ever sees the button. (Verified on
the local dev database: `actions_enabled = f`, no user with `itop_token_enc`, no customer with `itop_org_id`.)

## 2. The gap

- **Silent gating** (fixed first, Task 0): when creation isn't available, nothing says why.
- **No visibility on rows:** List rows (tasks and subtasks) and the panel's subtask list never show a pinned ticket. You only see it by opening the task.
- **Hard to find:** creating a ticket for a subtask means opening the subtask, then finding the iTop row. Nothing on the subtask row offers it.
- **Thin prefill:** a subtask's ticket gets the subtask's own title and description, with no hint of which parent task or project it belongs to.

## 3. Tasks

### Task 0: Say why "Create in iTop" isn't available
- When iTop is configured and the row has no ref, but creation is blocked, show a muted one-line reason in place of the button, linking to where it's fixed. Check in this order, showing the first that fails:
  1. no customer → "Add a customer to this project to create tickets";
  2. no `customer:write` → "You need the 'Manage customers' permission to create iTop tickets";
  3. `actionsEnabled` off → "iTop actions are turned off (Admin → iTop)"; non-admins get "…Ask an admin to turn them on";
  4. no personal token → "Add your iTop token in Settings" (links to `/settings`);
  5. no `customer:read` → "You need the 'View customers' permission to create iTop tickets";
  6. only now fetch the customer mapping: request failed → "Couldn't check the customer's iTop mapping"; not mapped → "Map {customer} to an iTop organisation (Admin → iTop)" (admins get the `/admin?tab=itop` link); non-admins get "Ask an admin to…".
  The mapping request is made only when 1-5 pass.
- Read-only users (no `task:write` or `!canEdit`) see no hint. Nothing there is theirs to fix.
- Pull the conditions into the shared `useCanCreateItopTicket(customerId)` hook (Task 3). It returns `{ canCreate, reason }`, so the panel, row menu and hint all read one source.

**Acceptance:** with each condition failing in turn, the panel shows the matching reason. With all of them passing, it shows the button, as today. Unit-test the hook's ordering.

**Also: prove token ownership with `:current_contact_id`** (fixes the user's "could not confirm this token
is yours" refusal, 2026-11-03). Verified on `itop.bapi.my.id` with the user's own token:
- `core/get Person` with `SELECT Person WHERE id = :current_contact_id` returns exactly the token owner's Person (`code 0`, 1 row).
- The same token gets `code 1 … not enough permissions` for the `User` and `PersonalToken` classes.

Change `PUT /itop/me/token` (`backend/src/routes/itopUser.ts`) as follows:
- **First,** resolve `:current_contact_id` with the pasted token, and accept only when that Person's email equals the Solvro user's email. This is direct proof of whose token it is, and it satisfies the iTop guardrail ("resolves to the iTop Person with that user's Solvro email").
- **Then,** use the existing `User` + `PersonalToken` reads only for best-effort expiry and `itopUserId`. A permission refusal there is no longer fatal.
- **If `:current_contact_id` itself is refused,** fall back to today's rule, including `ITOP_ALLOW_UNVERIFIED_PERSONAL_TOKENS`.

Also:
- Teach `test/itop/fakeItop.ts` the `:current_contact_id` binding.
- Add tests: own token accepted without `User`/`PersonalToken` read rights; someone else's token (`:current_contact_id` resolves to a different email) is refused `itop_token_not_yours`.
- Update `docs/CONFIGURATION.md`'s token-ownership rule, which is docs-keeper-owned.

**Also: name the failing class when a personal token is refused.** `itop_token_unverified` in
`backend/src/routes/itopUser.ts` currently says only "cannot read your iTop user account or its personal
tokens". Verified 2026-11-03 on `itop.bapi.my.id`: the user's profile gets `code 1 … not enough permissions
for reading data of class User` and the same for `PersonalToken`. Make the message say which class was
refused, e.g. "Your iTop profile can't read the User class. Ask your iTop admin to grant read access to User
and PersonalToken." Put the class name in `details` too. Update the matching test in `test/itop*`. No
change to the acceptance rule itself.

### Task 1: Batch ticket lookup (backend, read-only)
- New `GET /itop/tickets/by-refs?refs=R-1,R-2,…` (max 200 refs) returns `{ [ref]: TicketRow | null }` from the local snapshot only. It never calls iTop.
- Same visibility rule as `GET /tickets/by-ref/:ref`, applied per ticket: a ticket whose customer the caller can't see answers `null`, the same as an unknown ref.
- Without it, a 70-task List would fire 70 `by-ref` queries.

**Acceptance:**
- One request per List render returns all pinned tickets.
- A hidden-customer ticket is indistinguishable from an unknown ref.
- Test in `test/itop*.test.ts`, covering visible, hidden, unknown and the over-limit 400.

### Task 2: Ticket column on the List (tasks and subtasks)
- Add a **Ticket** column to the List grid. It shows a mono ref chip with an iTop status dot (`ticketPresentation.ts` `statusTone`), and closed tickets are dimmed.
- An empty row shows "—". For editors it shows a dashed "+ Ticket" that opens the row menu (Task 3).
- Visible only when `useItopStatus().configured`. Otherwise the column is omitted and the grid stays as today.

**Acceptance:**
- Matches "Triage 01".
- No layout shift when iTop isn't configured.
- 375px: the ref moves under the title in the stacked layout.

### Task 3: Row menu entries
- Subtask rows (List and panel) and task rows gain "Pin existing iTop ticket…" and "Create iTop ticket…".
- "Create" opens the existing `NewTicketSheet` with `customerId` = the project's customer. Same gating as `TaskTicketField`: pull its gating logic into a small shared hook, `useCanCreateItopTicket(customerId)`, so the two can't drift.
- On success, pin the ref with `PATCH /tasks/:id { itopTicketRef }`, exactly as `TaskTicketField` does. On 202 `staleAfterWrite` there is no ref yet: show "Created in iTop, pin it after the next sync" and leave the row unpinned.

**Acceptance:**
- Creating from a subtask row pins the new ref to **that subtask**, not to its parent.
- The menu entry is hidden when the user has no personal token, and the empty-cell hint says "Add your iTop token in Settings".

### Task 4: Subtask context in the prefill
- For a subtask, `initialDescription` = the subtask description (if any), then a context line: `Solvro: P-014 Core Banking DR Migration › Configure VPN tunnel to DC2`.
- The title stays the subtask title. The user edits both before sending.

## 4. Differences from the approved mock
The mock ("Triage 02") showed **Type / Urgency** fields and no **Caller**. The real `NewTicketSheet` (and the
API) needs a **Caller**, a contact in the customer's iTop org; iTop records the ticket against that person.
It has no Urgency field. This plan reuses the real sheet as it is. The mock's "Created as Alfi Rajasyah with
your personal iTop token" banner is worth adding to the sheet header, because it makes the token rule
visible.

## 5. Verification
- Scoped checks: backend typecheck plus the new test; frontend typecheck.
- e2e: iTop is mocked in the suite. Pin a ref on a subtask row and see the chip; the create flow with a stubbed 201 pins the ref.
- Guardrail check: the diff adds no call to `getItopAppClient` for a write, and no new `client.create`.

## 6. CHANGELOG (draft)
Under `[Unreleased]` → Added: the project List shows each task's and subtask's pinned iTop ticket and its
status, and the row menu can pin or create a ticket for that row (created under your personal iTop
token). New read-only `GET /itop/tickets/by-refs` batch lookup.

## 7. Follow-up (user request, 2026-11-03): start iTop work from the task modal and panel

User: "make iTop assignments startable from project page/modal". They chose these three (not "create from the project page header"):

### Task 5: Ticket field in the task modal
`TaskFormModal` (New and Edit task) gets an "iTop ticket" field, shown when iTop is configured. You can pin an existing ref or "Create in iTop" (the same `NewTicketSheet` + `useCanCreateItopTicket` gate and reason line), so you never have to open the side panel afterwards.
- **On a new task:** the ref, or a ticket created from the modal, is saved with the task's create request (`itopTicketRef` in `POST`).
- **Create from a not-yet-saved task:** the sheet prefills from the modal's current title and description, plus the same context line.

### Task 6: Assign the pinned ticket in iTop from the task panel and modal
When a task (or subtask) has a pinned ticket, the panel's iTop row and the modal field offer:
- "Assign to me";
- the ticket's next status actions.

These reuse the existing `POST /itop/tickets/:id/actions` (personal token, `loadWritableTicket`), plus the existing action logic and sheet in `components/itop/ticketActions.ts` / `ActionSheet.tsx`. There is no new write path. Shown only when `useCanCreateItopTicket`-style gating passes for writes (actions on, token set, `task:write`) and the ticket is in the snapshot.

### Task 7: Start the ticket timer from the task panel
The panel's iTop row shows the existing ticket timer (`TicketTimer` / `useTicketTimer`, logging via `POST /itop/tickets/:id/time`) for the pinned ticket: start, stop, and the elapsed time. This is the same component and the same rules as the ticket panel.

### Acceptance
- Each of Tasks 5–7 works on a task and on a subtask.
- The guardrail grep stays clean: no app-token write, no new `client.create`.
- e2e covers:
  - pinning from the New task modal;
  - "Assign to me" from the panel, with a mocked iTop stimulus;
  - timer start and stop from the panel.
