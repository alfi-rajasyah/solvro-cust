# Known Issues

Open issues, sorted by area and then by severity. Each issue has an ID (`ISS-NNN`) that never changes and is never reused. Code comments and plans cite an issue by its ID.

Last full triage: 2026-11-18 @ `6dd7592`. The file before the restructure is kept verbatim at `docs/archive/ISSUES-2026-11-18-phase-log.md`; the mapping from every old entry to its ID, or to the reason it closed, is the ledger in `docs/archive/plans/issues-restructure.md`.

## How to use this file

- **Severity.** P1: wrong data, a security or privacy exposure, or a break with no workaround; deferring one needs the user's explicit note. P2: a defect with a workaround, a correctness gap, a missing test on a risky path, or a gap in a gate or process. P3: polish, cosmetic issues, stale comments, hygiene.
- **Type.** `bug` · `debt` · `test-gap` · `watch` (no action until the stated trigger) · `decision` (waits on a user decision; the entry states the question).
- **Areas**, in this order: Security & auth · Data & performance · Backend/API · Frontend UI · Accessibility & tokens · Gantt · Boards & drag · iTop · Exports & sharing · Tests & CI · Dev env & ops · Docs & process.
- **New issue:** the next ID is the highest existing ID plus one. Search for an entry with the same root cause first, and update it instead of adding a second one. Keep the body to six lines or fewer.
- **Closing:** when shipped work fixes or moots an issue (checked against the code, never assumed), delete its body and add one line under `## Closed`: ID, date, commit or CHANGELOG reference, title.
- **Where** names a symbol and a file; the line number is a hint only. **Verified** shows when the location was last checked.

## Open — Security & auth

### ISS-001 · P2 · Token-ownership check still passes admin-profile tokens that can read other users' tokens

- **Type:** watch · **Found:** 2026-09-23 · **Verified:** 2026-11-18 @ `6dd7592`
- **Where:** token ownership check in backend/src/routes/itopUser.ts (line ~222)
- **Problem:** iTop has no whoami, so a token whose profile reads PersonalToken beyond its own user still passes the check. This is impersonation by a foreign credential, not privilege escalation.
- **Why deferred / fix direction:** Grant PersonalToken read narrowly or add an iTop-side whoami extension; verify on the real install. User decision 2026-11-18: stays open as `watch`, not accepted.
- **Source:** snapshot line 2138, section "iTop integration Phase 5 — deferred findings (2026-09-23)"

### ISS-002 · P2 · DELETE /customers/:id lets the TAM of one project delete an unowned customer

- **Type:** decision · **Found:** 2026-10-09 · **Verified:** 2026-11-18 @ `6dd7592`
- **Where:** DELETE /customers/:id in backend/src/routes/customers.ts (line ~626); ensureCustomerOwnerAccess in backend/src/lib/visibility.ts (line ~229)
- **Problem:** On an unowned customer, being TAM of one project passes the delete gate, though deleting affects every project under it. PATCH already uses a stricter rule.
- **Why deferred / fix direction:** Decide whether delete should use the same rule as the owner change (owner, view-all, or TAM of every project).
- **Source:** snapshot line 2358, section "Internal sync — deferred findings (2026-10-09)"

### ISS-004 · P2 · zod 3 has a memory-exhaustion advisory fixed only in zod 4

- **Type:** debt · **Found:** 2026-10-25 · **Verified:** 2026-11-18 @ `6dd7592`
- **Where:** zod dependency in backend/package.json (line ~37)
- **Problem:** Oversized constrained collections can exhaust memory (GHSA-mrhx-c7xc-m3w5). Request bodies are capped at 1 MB, and the audit step fails on this finding.
- **Why deferred / fix direction:** The zod 4 migration touches about 35 files and is its own change.
- **Source:** snapshot line 2421, section "Dependency advisories — remaining (2026-10-25)"

### ISS-006 · P3 · Per-email sign-in lockout can be triggered against a colleague

- **Type:** watch · **Found:** 2026-10-22 · **Verified:** 2026-11-18 @ `6dd7592`
- **Where:** createFailureThrottle in backend/src/http/loginThrottle.ts (line ~25)
- **Problem:** Ten wrong passwords for an email block that email's password sign-in for 15 minutes, from any address. The counter table holds 10,000 keys and evicts the oldest.
- **Why deferred / fix direction:** Accepted by user decision 2026-10-22. Revisit if the app is exposed beyond the LAN or the lockout is abused.
- **Source:** snapshot line 16, section "Known bugs / inconsistencies"

### ISS-008 · P3 · Task duplicate needs task:write while task create needs project:write

- **Type:** watch · **Found:** 2026-09-02 · **Verified:** 2026-11-18 @ `6dd7592`
- **Where:** POST /tasks/:id/duplicate in backend/src/routes/tasks.ts; POST /projects/:id/tasks in backend/src/routes/projects.ts
- **Problem:** A custom role holding task:write only can duplicate tasks it could not create through the form. This was a deliberate plan decision.
- **Why deferred / fix direction:** Revisit if custom roles start splitting the two permissions.
- **Source:** snapshot line 1863, section "Duplicate tasks, subtasks, and sections — deferred findings (2026-09-02)"

### ISS-010 · P3 · Guest link pages contact Google for fonts

- **Type:** debt · **Found:** 2026-09-30 · **Verified:** 2026-11-18 @ `6dd7592`
- **Where:** font links in frontend/index.html (lines ~13-20)
- **Problem:** The SPA shell served at /share/<token> loads fonts from Google, so a guest's browser contacts a third party. Referrer-Policy no-referrer keeps the token out of those requests.
- **Why deferred / fix direction:** Self-host the fonts; deferred because it changes the whole app shell.
- **Source:** snapshot line 2350, section "Collaboration & sharing, Phase 6 ("Guest links") — deferred findings (2026-09-30)"

### ISS-011 · P3 · Remaining port-review hardening: GCM tag length, iTop webhook limit, key rotation

- **Type:** debt · **Found:** 2026-10-09 · **Verified:** 2026-11-18 @ `6dd7592`
- **Where:** open() in backend/src/lib/secretBox.ts (line ~53); allCallsAt in backend/src/routes/webhook.ts (line ~46)
- **Problem:** Three bullets remain: decipher.setAuthTag is used without authTagLength, so a truncated tag is accepted; the iTop webhook rate limit is one global window, so a flood can starve genuine calls; SECRETS_KEY rotation invalidates all stored tokens.
- **Why deferred / fix direction:** Pass authTagLength and check tag length; key the iTop limiter per IP as the Outline one is; add a key id to the sealed format if rotation is needed.
- **Source:** snapshot line 2361, section "Internal sync — deferred findings (2026-10-09)"

### ISS-012 · P3 · Any project:write user can set the Outline link of an unowned customer

- **Type:** decision · **Found:** 2026-10-09 · **Verified:** 2026-11-18 @ `6dd7592`
- **Where:** PATCH /customers/:id in backend/src/routes/customers.ts (line ~582)
- **Problem:** outlineUrl is set under the same gate as name and description (project:write plus visibility), so for a customer with no TAM any such user can point its link at any http/https URL.
- **Why deferred / fix direction:** Decision needed (2026-11-19): gating name, description and Outline link on ownership conflicts with the M1 pentest contract (backend/test/pentestRemediation.test.ts: a TAM with a project under the customer may edit its other fields). Choose: gate only outlineUrl on ownership, gate all three and change M1, or accept.
- **Source:** snapshot line 2377, section "Outline links, Phase A — deferred findings (2026-10-09)"

### ISS-013 · P3 · Outline email is not re-checked on token refresh

- **Type:** watch · **Found:** 2026-10-09 · **Verified:** 2026-11-18 @ `6dd7592`
- **Where:** refresh path in backend/src/lib/outline/tokens.ts; callback in backend/src/routes/outline.ts
- **Problem:** A user whose Outline email changes later keeps a working grant under the old match until they reconnect. Re-checking on every refresh would spend the shared per-IP rate budget.
- **Why deferred / fix direction:** Accepted risk; trigger: Outline reports email changes, then re-check at low frequency.
- **Source:** snapshot line 2382, section "Outline B+C — deferred findings (2026-10-09)"

### ISS-014 · P3 · React Router 6 has two advisories fixed only in v7

- **Type:** debt · **Found:** 2026-10-25 · **Verified:** 2026-11-18 @ `6dd7592`
- **Where:** react-router-dom in frontend/package.json (line ~34)
- **Problem:** Two advisories remain in audit output. The redirect one is blocked by safeRedirect.ts and the SSR one needs a data router the app does not use.
- **Why deferred / fix direction:** The v7 upgrade is its own change.
- **Source:** snapshot line 2422, section "Dependency advisories — remaining (2026-10-25)"

### ISS-015 · P3 · uuid advisory inside exceljs is not reachable

- **Type:** watch · **Found:** 2026-10-25 · **Verified:** 2026-11-18 @ `6dd7592`
- **Where:** uuid inside exceljs, loaded by the Gantt Excel export
- **Problem:** The advisory needs v3/v5/v6 with a caller-supplied buffer; exceljs calls only v4(). npm's suggested downgrade is wrong.
- **Why deferred / fix direction:** Trigger: an exceljs release that bumps uuid. Do not apply npm's suggested downgrade.
- **Source:** snapshot line 2423, section "Dependency advisories — remaining (2026-10-25)"

### ISS-016 · P3 · Webhook replay set and Refresh throttle are per process

- **Type:** watch · **Found:** 2026-10-26 · **Verified:** 2026-11-18 @ `6dd7592`
- **Where:** seen in backend/src/lib/outline/webhookSignature.ts (line ~15); REFRESH_* in backend/src/routes/itop.ts (line ~442)
- **Problem:** Each backend instance keeps its own state, so a captured webhook can be replayed once per instance and the throttle allows one pull per instance.
- **Why deferred / fix direction:** Trigger: running more than one backend instance. Then move both to shared storage.
- **Source:** snapshot line 2429, section "iTop and Outline hardening — deferred findings (2026-10-26)"

### ISS-017 · P3 · Creating a customer with a hidden customer's name answers 409

- **Type:** bug · **Found:** 2026-10-26 · **Verified:** 2026-11-18 @ `6dd7592`
- **Where:** POST / in backend/src/routes/customers.ts (line ~484)
- **Problem:** A TAM can learn that a customer name exists by getting 409 instead of 201, even for customers they cannot see.
- **Why deferred / fix direction:** Deferred. Accept as a product trade-off or scope uniqueness by visibility.
- **Source:** snapshot line 2434, section "iTop and Outline hardening — deferred findings (2026-10-26)"

## Open — Data & performance

### ISS-018 · P2 · GET /users returns every user with no pagination

- **Type:** debt · **Found:** 2026-07-27 · **Verified:** 2026-11-18 @ `6dd7592`
- **Where:** usersRouter.get('/') in backend/src/routes/users.ts (line ~14)
- **Problem:** The endpoint lists all users. Pickers render each as an option, which already broke an e2e role query and will not scale.
- **Why deferred / fix direction:** Paginate or add a search filter; the pickers then need a search-as-you-type mode.
- **Source:** snapshot line 594, section "Kanban → ReUI swap — deferred findings (2026-07-27)"

### ISS-019 · P3 · ensureTaskVisible adds a second DB round-trip to task mutations

- **Type:** watch · **Found:** 2026-07-15 · **Verified:** 2026-11-18 @ `6dd7592`
- **Where:** ensureTaskVisible in backend/src/lib/visibility.ts (line ~125)
- **Problem:** Each task mutation first runs a visibility lookup, then the write. The visibility filter cannot be folded into a Prisma update's unique where.
- **Why deferred / fix direction:** Trigger: profiling shows the sub-200ms NFR missed. Then try updateMany with a returned-row check.
- **Source:** snapshot line 347, section "Tech debt / follow-ups from recent work"

### ISS-020 · P3 · Section default color hex is duplicated between schema and frontend

- **Type:** debt · **Found:** 2026-07-22 · **Verified:** 2026-11-18 @ `6dd7592`
- **Where:** DEFAULT_SECTION_COLOR in frontend/src/lib/gantt/palette.ts (line 32); Section.color in backend/prisma/schema.prisma (line ~622)
- **Problem:** The slate default exists in the schema and in the frontend constant, and resolveSectionColors compares against it. Changing one without the other stops uncustomized sections being recognised.
- **Why deferred / fix direction:** Export one shared constant, or add an isCustom boolean on Section.
- **Source:** snapshot line 419, section "Tech debt / follow-ups from recent work"

### ISS-021 · P3 · Task reorder repack issues one UPDATE per displaced sibling

- **Type:** watch · **Found:** 2026-07-22 · **Verified:** 2026-11-18 @ `6dd7592`
- **Where:** insertAt and closeGap in backend/src/lib/taskOrdering.ts (line ~49, ~83)
- **Problem:** A reorder updates each displaced sibling in turn, about 200 round-trips on a 200-task project. A calm host measured 0.196s, inside the 200ms NFR; a loaded host measured 0.20-0.47s.
- **Why deferred / fix direction:** Trigger: reorder feels slow in real use. Then batch the repack into one UPDATE ... FROM (VALUES ...).
- **Source:** snapshot line 516, section "Verification debt"

### ISS-022 · P3 · Admin Project Overrides renders every user as an option in every row

- **Type:** watch · **Found:** 2026-08-02 · **Verified:** 2026-11-18 @ `6dd7592`
- **Where:** tamCandidates.map in the reassign cell of frontend/src/pages/Admin.tsx (line ~1672)
- **Problem:** Each project row renders a select with one option per active user, and the grid is not paginated. This is fine at small scale and grows with users times projects.
- **Why deferred / fix direction:** Filter or virtualise the candidate list if the user count grows large.
- **Source:** snapshot line 1459, section "Issues Sweep #1 — residuals (2026-08-02)"

### ISS-023 · P3 · GET /notes/recent has no noteDate-leading index

- **Type:** watch · **Found:** 2026-08-31 · **Verified:** 2026-11-18 @ `6dd7592`
- **Where:** GET /notes/recent in backend/src/routes/notes.ts; indexes at backend/prisma/schema.prisma (lines 728, 748)
- **Problem:** The route filters both note tables by noteDate alone, so Postgres plans a seq scan plus sort. At current volume this stays in single-digit milliseconds.
- **Why deferred / fix direction:** Add @@index([noteDate]) to both models via a migration when volume warrants it.
- **Source:** snapshot line 1736, section "Daily Review collapse & Recent notes — deferred findings (2026-08-31)"

### ISS-024 · P3 · A project tab chunk starts loading only after the project data arrives

- **Type:** debt · **Found:** 2026-10-24 · **Verified:** 2026-11-18 @ `6dd7592`
- **Where:** ProjectDetail early return in frontend/src/pages/ProjectDetail.tsx (line ~143)
- **Problem:** The tab's lazy import() is not requested until useProject resolves. A cold load without the service worker runs three loads in sequence, with up to three skeletons.
- **Why deferred / fix direction:** Start the active tab's import() early, from ProjectIndexRedirect or the tab links' hover.
- **Source:** snapshot line 2405, section "Code splitting — deferred findings (2026-10-24)"

### ISS-025 · P3 · Project-deletion activity records are never shown or cleaned up

- **Type:** debt · **Found:** 2026-10-26 · **Verified:** 2026-11-18 @ `6dd7592`
- **Where:** tx.customerActivityEvent.createMany in backend/src/routes/projects.ts (line ~565)
- **Problem:** customer_activity_events rows appear nowhere in the UI and the 180-day cleanup skips them. Customer owner changes are only a log line.
- **Why deferred / fix direction:** Show them on the customer, add them to the cleanup, and record owner changes.
- **Source:** snapshot line 2438, section "Data integrity, session and query performance — deferred findings (2026-10-26)"

### ISS-026 · P3 · Tasks page offset paging can repeat or skip a row

- **Type:** watch · **Found:** 2026-10-26 · **Verified:** 2026-11-18 @ `6dd7592`
- **Where:** GET /tasks offset in backend/src/routes/tasks.ts (line ~331)
- **Problem:** A concurrent insert or delete can repeat or skip a row across Load more pages. The order itself is stable.
- **Why deferred / fix direction:** Normal offset trade-off. Trigger: user reports. Then use cursor paging.
- **Source:** snapshot line 2440, section "Data integrity, session and query performance — deferred findings (2026-10-26)"

### ISS-175 · P3 · Task delete re-packs siblings with one UPDATE per row

- **Type:** watch · **Found:** 2026-11-19 · **Verified:** 2026-11-19 @ wave 1 review
- **Where:** closeGap in backend/src/lib/taskOrdering.ts (line ~42), called from DELETE /tasks/:id
- **Problem:** Delete now rewrites every remaining sibling, including rows before the gap; the top-level list is every top-level task in the project.
- **Why deferred / fix direction:** Trigger: a delete above the 200 ms target. Fix: one set-based UPDATE, or shift only rows after the deleted one.
- **Source:** phase review of `docs/archive/plans/task-integrity.md`

## Open — Backend/API

### ISS-029 · P3 · Inactive users can still be set as TAM, assignee or epic owner

- **Type:** decision · **Found:** 2026-10-23 · **Verified:** 2026-11-18 @ `6dd7592`
- **Where:** assertUserExists in backend/src/lib/userRefs.ts (line ~12)
- **Problem:** The create and update paths check that the user exists but not that the user is active. An inactive user can become a TAM, assignee or epic owner.
- **Why deferred / fix direction:** Question: reject inactive users (with which error code) or keep accepting them?.
- **Source:** snapshot line 53, section "Known bugs / inconsistencies"

### ISS-030 · P3 · NUL-byte (22021) errors return 400 without a log line

- **Type:** bug · **Found:** 2026-11-18 · **Verified:** 2026-11-18 @ `6dd7592`
- **Where:** errorHandler 22021 branch in backend/src/http/errors.ts (line ~111)
- **Problem:** A Postgres 22021 that skips validate() answers 400 and logs nothing, where the old 500 logged at error. The message also blames the caller when the NUL came from elsewhere.
- **Why deferred / fix direction:** Log logger.warn({ pgCode }, ...) without err (it carries row data) and use a neutral message.
- **Source:** snapshot line 60, section "Known bugs / inconsistencies"

### ISS-031 · P3 · Task attachments are not built; storage and visibility are undecided

- **Type:** decision · **Found:** 2026-07-01 · **Verified:** 2026-11-18 @ `6dd7592`
- **Where:** Task model in backend/prisma/schema.prisma (no attachment model)
- **Problem:** Solvro has no attachments on tasks or customers. Storage, size limits and export visibility have not been decided.
- **Why deferred / fix direction:** Question: build attachments, and if so where do files live, what size limit applies, and are they exported?.
- **Source:** snapshot line 289, section "Pending features (not yet built)"

### ISS-032 · P3 · Daily Review, search and portfolio task selects omit isCriticalPath

- **Type:** watch · **Found:** 2026-09-02 · **Verified:** 2026-11-18 @ `6dd7592`
- **Where:** task selects in backend/src/routes/search.ts, backend/src/lib/portfolio.ts and backend/src/routes/dailyReview.ts
- **Problem:** These queries do not select isCriticalPath, so the mark cannot appear there. None of those surfaces render task flags today.
- **Why deferred / fix direction:** Widen the selects if the mark is ever surfaced there.
- **Source:** snapshot line 1791, section "Critical Path mark — deferred findings (2026-09-02)"

### ISS-033 · P3 · CORS does not expose X-Total-Count

- **Type:** debt · **Found:** 2026-09-29 · **Verified:** 2026-11-18 @ `6dd7592`
- **Where:** cors({...}) in backend/src/app.ts (line ~57)
- **Problem:** Cross-origin callers cannot read the X-Total-Count header that GET /tasks sets. The app is unaffected through the same-origin /api proxy.
- **Why deferred / fix direction:** Add exposedHeaders: ['X-Total-Count'] if the API is ever called cross-origin.
- **Source:** snapshot line 2323, section "Professional UI pass — deferred findings (2026-09-29)"

### ISS-034 · P3 · Rate limiter counters are per backend instance

- **Type:** watch · **Found:** 2026-09-30 · **Verified:** 2026-11-18 @ `6dd7592`
- **Where:** createRateLimiter in backend/src/http/rateLimit.ts
- **Problem:** Counters live in memory per instance and reset on restart, so the effective limit multiplies with more than one backend instance.
- **Why deferred / fix direction:** Trigger: scaling the backend beyond one instance; then add a shared store.
- **Source:** snapshot line 2352, section "Collaboration & sharing, Phase 6 ("Guest links") — deferred findings (2026-09-30)"; merged duplicates at snapshot lines 2439

### ISS-035 · P3 · Changing an Outline link leaves no activity event

- **Type:** decision · **Found:** 2026-10-09 · **Verified:** 2026-11-18 @ `6dd7592`
- **Where:** PATCH /projects/:id in backend/src/routes/projects.ts (line ~478)
- **Problem:** outlineUrl edits on a project or customer are not recorded, consistent with description edits.
- **Why deferred / fix direction:** Decide whether an audit trail for links is wanted; if yes, add it to the project diff.
- **Source:** snapshot line 2376, section "Outline links, Phase A — deferred findings (2026-10-09)"; merged duplicates at snapshot lines 2383

### ISS-176 · P3 · Epic delete and admin status save can still deadlock with task writes

- **Type:** bug · **Found:** 2026-11-19 · **Verified:** 2026-11-19 @ wave 1 review
- **Where:** epicsRouter.delete in backend/src/routes/epics.ts; status save in backend/src/lib/taskStatuses.ts
- **Problem:** Epic delete vs a PATCH that sets epicId can deadlock through the epic and task rows; the admin status save takes no task-order lock, so it can deadlock with a re-pack.
- **Why deferred / fix direction:** Both predate the task-order lock change and are rare. Fix: take the task-order lock in both paths.
- **Source:** phase review of `docs/archive/plans/task-integrity.md`

### ISS-177 · P3 · Epic owner check is copied into two routes

- **Type:** debt · **Found:** 2026-11-19 · **Verified:** 2026-11-19 @ wave 1 review
- **Where:** owner check in backend/src/routes/epics.ts (line ~143) and backend/src/routes/projects.ts (line ~822)
- **Problem:** The same 11-line check sits in both routes, and it calls filterActiveUsersWhoCanSeeProject with activeOnly false, which reads as a contradiction.
- **Why deferred / fix direction:** Fix: one shared assertEpicOwnerCanSeeProject helper, and a clearer name for the filter.
- **Source:** phase review of `docs/archive/plans/task-integrity.md`

### ISS-180 · P3 · Label names are not trimmed on the server

- **Type:** bug · **Found:** 2026-11-19 · **Verified:** 2026-11-19 @ wave 2 review
- **Where:** label create and rename in backend/src/routes/projects.ts and backend/src/routes/labels.ts
- **Problem:** Only LabelPicker trims, so "bug" and "bug " can both exist when created through the API.
- **Why deferred / fix direction:** The UI path trims. Fix: trim in the Zod schemas for create and rename.
- **Source:** phase review of `docs/archive/plans/label-permissions.md`

### ISS-181 · P3 · Renaming a customer onto an existing name shows "Unique constraint violated"

- **Type:** bug · **Found:** 2026-11-19 · **Verified:** 2026-11-19 @ wave 2 review
- **Where:** PATCH /customers/:id in backend/src/routes/customers.ts
- **Problem:** The unique name clash returns the generic 409 with a database term.
- **Why deferred / fix direction:** Fix: catch the name conflict and return a plain message, as for labels (lib/labelConflict.ts).
- **Source:** phase review of `docs/archive/plans/label-permissions.md`

## Open — Frontend UI

### ISS-038 · P3 · Service-mapping mutations are not optimistic

- **Type:** debt · **Found:** 2026-07-15 · **Verified:** 2026-11-18 @ `6dd7592`
- **Where:** useUpdateProjectServices and useUpdateCustomerServices in frontend/src/lib/queries.ts (line ~1730, ~1745)
- **Problem:** Both hooks only invalidate on success. The checkboxes and chips disable while saving, so it is correct but not instant.
- **Why deferred / fix direction:** Add onMutate snapshot, optimistic services[] patch, onError rollback and onSettled invalidate to both hooks together.
- **Source:** snapshot line 335, section "Tech debt / follow-ups from recent work"

### ISS-039 · P3 · Inactive services can still be assigned to customers and projects

- **Type:** decision · **Found:** 2026-07-15 · **Verified:** 2026-11-18 @ `6dd7592`
- **Where:** ServiceMappingList in frontend/src/components/services/ServiceMappingList.tsx (line ~168-195)
- **Problem:** The mapping picker shows deactivated services dimmed but still toggleable. The project tab's 'Add all subscribed' also carries inactive legacy subscriptions over.
- **Why deferred / fix direction:** Question: should active: false block new assignments?.
- **Source:** snapshot line 342, section "Tech debt / follow-ups from recent work"

### ISS-040 · P3 · Uncustomized sections show slate outside the Gantt

- **Type:** bug · **Found:** 2026-07-22 · **Verified:** 2026-11-18 @ `6dd7592`
- **Where:** section.color use in frontend/src/pages/views/ProjectList.tsx (line ~767), pages/Executive.tsx (~318), components/TaskPanel.tsx (~734)
- **Problem:** Sections with the default color render vivid presets in the Gantt but legacy slate in the List tab, Executive chips and the task panel dot.
- **Why deferred / fix direction:** Reuse resolveSectionColors from lib/gantt/palette.ts in those three places, or apply the fallback server-side.
- **Source:** snapshot line 410, section "Tech debt / follow-ups from recent work"

### ISS-042 · P3 · Comment composer is a single-line input

- **Type:** debt · **Found:** 2026-07-24 · **Verified:** 2026-11-18 @ `6dd7592`
- **Where:** CommentComposer in frontend/src/components/CommentMentions.tsx (line ~143)
- **Problem:** The task panel comment box is a one-line input that scrolls sideways for long comments.
- **Why deferred / fix direction:** Replace with an auto-growing textarea.
- **Source:** snapshot line 533, section "Gantt GH #58 deferred findings (2026-07-24)"

### ISS-043 · P3 · Popovers near scroll-area bottoms can clip

- **Type:** watch · **Found:** 2026-07-25 · **Verified:** 2026-11-18 @ `6dd7592`
- **Where:** List row dropdowns, Kanban column menu, Risks selects (frontend/src/pages/views/ProjectList.tsx, ProjectKanban.tsx, ProjectRisks.tsx)
- **Problem:** Absolute-positioned popovers inside the internally scrolling containers can clip at the bottom edge instead of flipping.
- **Why deferred / fix direction:** Trigger: a user reports clipping. Then move the popovers to a portal with flip logic.
- **Source:** snapshot line 544, section "Plan B Task 9 deferred findings — ReUI Gantt swap (2026-07-25)"

### ISS-044 · P3 · PWA manifest declares only a 512px maskable icon

- **Type:** debt · **Found:** 2026-07-26 · **Verified:** 2026-11-18 @ `6dd7592`
- **Where:** icons array in frontend/vite.config.ts (line ~47)
- **Problem:** Low-DPI Android launchers downscale the 512 maskable icon instead of getting a 192 one.
- **Why deferred / fix direction:** Generate icon-maskable-192.png and add a manifest entry.
- **Source:** snapshot line 573, section "PWA icon regeneration — deferred findings (2026-07-25/26)"

### ISS-045 · P3 · Subtask promote and re-parent only exist in the task modal

- **Type:** watch · **Found:** 2026-07-27 · **Verified:** 2026-11-18 @ `6dd7592`
- **Where:** TaskPanel.tsx (no parent control); Parent field in TaskFormModal.tsx
- **Problem:** Promoting or re-parenting a subtask needs the modal. No Promote shortcut was built after the dogfood window.
- **Why deferred / fix direction:** Trigger: users report the modal round-trip as friction.
- **Source:** snapshot line 613, section "Kanban → ReUI swap — deferred findings (2026-07-27)"

### ISS-047 · P3 · Command palette has dead classes and a hardcoded Mac shortcut glyph

- **Type:** debt · **Found:** 2026-07-27 · **Verified:** 2026-11-18 @ `6dd7592`
- **Where:** row className in frontend/src/components/CommandPalette.tsx (line ~345); ⌘K in frontend/src/components/layout/TopBar.tsx (line ~189)
- **Problem:** A highlight class is overpainted by the vendored ::before, the row radius disagrees by 2px, and TopBar always shows the ⌘K glyph for Windows and Linux users too.
- **Why deferred / fix direction:** Delete the dead class, align the radius, show Ctrl K off macOS. The trigger hover item is already fixed.
- **Source:** snapshot line 735, section "Global search & ⌘K command palette — deferred findings (2026-07-27)"

### ISS-048 · P3 · Dropdown submenu cannot outrank a modal host

- **Type:** debt · **Found:** 2026-07-28 · **Verified:** 2026-11-18 @ `6dd7592`
- **Where:** DropdownMenuSubContent in frontend/src/components/ui/dropdown-menu.tsx (line ~262)
- **Problem:** The submenu Popup carries z-50 on a Positioner with its own stacking context, so it cannot rise above a Modal or Drawer. Tooltip and the main menu content were fixed.
- **Why deferred / fix direction:** Pass positionerClassName through when a submenu is needed inside a modal.
- **Source:** snapshot line 815, section "ReUI DateField swap — deferred findings (2026-07-28)"

### ISS-049 · P3 · SectionReorderModal relies on its caller for the permission gate

- **Type:** debt · **Found:** 2026-07-30 · **Verified:** 2026-11-18 @ `6dd7592`
- **Where:** frontend/src/components/SectionReorderModal.tsx (whole file); mount in frontend/src/pages/views/ProjectList.tsx (line ~668)
- **Problem:** The modal checks nothing itself and relies on the entry button's gate. A second entry point would inherit no protection.
- **Why deferred / fix direction:** Add a canEdit check inside the modal.
- **Source:** snapshot line 1109, section "Sortable reorder (sections + subtasks) — deferred findings (2026-07-30)"

### ISS-050 · P3 · Filter submenu highlight follows the pointer

- **Type:** watch · **Found:** 2026-07-31 · **Verified:** 2026-11-18 @ `6dd7592`
- **Where:** filters submenu in frontend/src/components/reui/filters.tsx
- **Problem:** The row under the cursor wins the initial highlight, so a blind Enter can pick an unexpected row.
- **Why deferred / fix direction:** Accepted upstream behaviour; revisit only if keyboard users report it.
- **Source:** snapshot line 1264, section "ReUI Filters phase — deferred findings (2026-07-31)"

### ISS-051 · P3 · Filter toolbar mixes three text sizes

- **Type:** decision · **Found:** 2026-07-31 · **Verified:** 2026-11-18 @ `6dd7592`
- **Where:** migrated filter rows in frontend/src/components/reui/filters.tsx and the filter toolbars
- **Problem:** Chip labels, checkbox rows and the Reset control use 15, 13 and 12px.
- **Why deferred / fix direction:** Question: keep the mixed scale or match the old uniform 12-13px density?.
- **Source:** snapshot line 1288, section "ReUI Filters phase — deferred findings (2026-07-31)"

### ISS-052 · P3 · Data-grid column controls ignore right-aligned headers

- **Type:** watch · **Found:** 2026-08-01 · **Verified:** 2026-11-18 @ `6dd7592`
- **Where:** hasControls branch in frontend/src/components/reui/data-grid/data-grid-column-header.tsx (lines ~436-440)
- **Problem:** The move/pin/visibility branch skips the right-align treatment. No shipped grid reaches it.
- **Why deferred / fix direction:** Trigger: a column pairs hasControls with a right-aligned header. Then apply the alignEnd treatment.
- **Source:** snapshot line 1333, section "ReUI Data Grid phase — deferred findings (2026-08-01)"

### ISS-053 · P3 · Sortable data-grid headers cannot be centered

- **Type:** debt · **Found:** 2026-08-02 · **Verified:** 2026-11-18 @ `6dd7592`
- **Where:** alignEnd in frontend/src/components/reui/data-grid/data-grid-column-header.tsx (line ~107); Risks columns in frontend/src/pages/views/ProjectRisks.tsx
- **Problem:** The Probability and Impact columns stay unsortable so their headers can stay centered.
- **Why deferred / fix direction:** Add alignCenter handling in the vendored header, then enable sorting.
- **Source:** snapshot line 1425, section "Issues Sweep #1 — residuals (2026-08-02)"

### ISS-054 · P3 · Filter dedupe guard compares values with === (object values would not dedupe)

- **Type:** watch · **Found:** 2026-08-02 · **Verified:** 2026-11-18 @ `6dd7592`
- **Where:** findFilterMatch in frontend/src/components/reui/filters.tsx (line ~2330)
- **Problem:** The duplicate-chip guard uses === to compare filter values. Every current filter field is string-valued, so nothing is affected today.
- **Why deferred / fix direction:** Compare by value if a consumer adds object-valued filter options.
- **Source:** snapshot line 1445, section "Issues Sweep #1 — residuals (2026-08-02)"

### ISS-055 · P3 · ProjectRisks probability and impact cells use hand-rolled selects

- **Type:** debt · **Found:** 2026-08-29 · **Verified:** 2026-11-18 @ `6dd7592`
- **Where:** probability/impact <select> in frontend/src/pages/views/ProjectRisks.tsx (lines ~378, ~409)
- **Problem:** The inline risk-scale editors use plain selects while newer surfaces use the vendored ui/select.
- **Why deferred / fix direction:** Move them to ui/select the next time the file is touched.
- **Source:** snapshot line 1705, section "Daily Review v2 — deferred findings (2026-08-29)"

### ISS-056 · P3 · Material Symbols glyphs ignore text-[Npx] utilities app-wide

- **Type:** decision · **Found:** 2026-09-02 · **Verified:** 2026-11-18 @ `6dd7592`
- **Where:** material-symbols-outlined rule in frontend/src/index.css (line ~347); overrides in frontend/src/components/CriticalPathMark.tsx (lines 34, 63)
- **Problem:** Google's unlayered font-size: 24px beats Tailwind's layered utilities, so every icon renders 24px. Critical Path works around it with !important.
- **Why deferred / fix direction:** Re-declare the font-size inside a Tailwind layer; it changes every icon, so it needs a user decision.
- **Source:** snapshot line 1759, section "Critical Path mark — deferred findings (2026-09-02)"

### ISS-057 · P3 · CriticalPathMark padding override breaks silently if Chip gains a wrapper

- **Type:** watch · **Found:** 2026-09-02 · **Verified:** 2026-11-18 @ `6dd7592`
- **Where:** [&>span]:px-1.5 in frontend/src/components/CriticalPathMark.tsx (line 56)
- **Problem:** The compact chip reaches into Chip's root span with a child selector. A wrapper element would silently drop the padding.
- **Why deferred / fix direction:** When Chip's markup changes, grep the selector and retarget the new root.
- **Source:** snapshot line 1783, section "Critical Path mark — deferred findings (2026-09-02)"

### ISS-058 · P3 · Tasks grid and kanban subtask rows show no Critical Path mark

- **Type:** debt · **Found:** 2026-09-02 · **Verified:** 2026-11-18 @ `6dd7592`
- **Where:** PriorityBadge cell in frontend/src/pages/Tasks.tsx (line 316); SubtaskRow in frontend/src/components/kanban-v2/cards.tsx (line 243)
- **Problem:** Two task surfaces omit the mark that every other covered surface shows.
- **Why deferred / fix direction:** Add CriticalPathMark beside the priority indicator if either surface is revisited.
- **Source:** snapshot line 1798, section "Critical Path mark — deferred findings (2026-09-02)"

### ISS-060 · P3 · Creating a task leaves Daily Review attention lists stale

- **Type:** bug · **Found:** 2026-09-02 · **Verified:** 2026-11-18 @ `6dd7592`
- **Where:** useCreateTask in frontend/src/lib/queries.ts (line ~2162)
- **Problem:** Creating an overdue TODO task does not invalidate the Daily Review query, so its attention lists stay stale until staleTime elapses.
- **Why deferred / fix direction:** Add the dailyReviewRoot invalidation like the sibling mutations.
- **Source:** snapshot line 1844, section "Duplicate tasks, subtasks, and sections — deferred findings (2026-09-02)"

### ISS-062 · P3 · Duplicate mutations wait on inactive-query invalidations

- **Type:** watch · **Found:** 2026-09-02 · **Verified:** 2026-11-18 @ `6dd7592`
- **Where:** useDuplicateTask and useDuplicateSection onSuccess in frontend/src/lib/queries.ts (lines ~2195, ~2368)
- **Problem:** isPending also waits on inactive queries. The cost is near zero because inactive queries refetch lazily.
- **Why deferred / fix direction:** Await only projectTasks and fire the rest if latency ever shows.
- **Source:** snapshot line 1894, section "Duplicate tasks, subtasks, and sections — deferred findings (2026-09-02)"

### ISS-063 · P3 · Sync modals' missing-title error does not point to the card

- **Type:** debt · **Found:** 2026-09-10 · **Verified:** 2026-11-18 @ `6dd7592`
- **Where:** setError in frontend/src/components/daily-review/MidweekSyncModal.tsx (line 171) and ReflectionSyncModal.tsx (line 202)
- **Problem:** The banner at the top of the form says a title is missing but not which card. The Reflection card is tall, so users must scan every card.
- **Why deferred / fix direction:** Mark or focus the offending card when save is blocked.
- **Source:** snapshot line 1939, section "Weekly Sync achievement rows — deferred findings (2026-09-10)"


### ISS-067 · P3 · A hung task PATCH blocks every later save of that task

- **Type:** bug · **Found:** 2026-09-30 · **Verified:** 2026-11-18 @ `6dd7592`
- **Where:** serialiseTaskWrite in frontend/src/lib/queries.ts (line ~1907); apiRequestWithHeaders in frontend/src/lib/api.ts (line ~68)
- **Problem:** Task saves are chained per task and apiRequest has no timeout, so one hung request keeps later edits from being sent while optimistic values still show. The fetch eventually errors and the chain resumes.
- **Why deferred / fix direction:** Add a request timeout (AbortSignal.timeout) to apiRequest; rare, so deferred.
- **Source:** snapshot line 2334, section "Collaboration & sharing, Phase 3 ("Conflict warning") — deferred findings (2026-09-30)"

### ISS-068 · P3 · /tasks Filters popover briefly pulls focus back after Escape

- **Type:** watch · **Found:** 2026-09-30 · **Verified:** 2026-11-18 @ `6dd7592`
- **Where:** Filters popover on /tasks (vendored filters component)
- **Problem:** After choosing a filter and pressing Escape, the popover's focus manager briefly returns focus to its search input, so a fast user can type into it instead of the task form. Only CI on the production build hit it.
- **Why deferred / fix direction:** Trigger: a user report or a new CI failure; then investigate the vendored component.
- **Source:** snapshot line 2339, section "Collaboration & sharing, Phase 3 ("Conflict warning") — deferred findings (2026-09-30)"

### ISS-069 · P3 · Mention chips fall back to plain text for removed members

- **Type:** watch · **Found:** 2026-09-30 · **Verified:** 2026-11-18 @ `6dd7592`
- **Where:** frontend/src/components/CommentMentions.tsx
- **Problem:** Comments store user ids only, so a mentioned person later removed from the project, or a view-all user, renders as plain @name text instead of a chip.
- **Why deferred / fix direction:** Accepted limitation; revisit only if the server begins returning resolved mention names.
- **Source:** snapshot line 2343, section "Collaboration & sharing, Phase 4 ("Activity and notifications") — deferred findings (2026-09-30)"

### ISS-070 · P3 · Arbitrary text-[12px]/[13px] sizes remain in six files

- **Type:** debt · **Found:** 2026-10-09 · **Verified:** 2026-11-18 @ `6dd7592`
- **Where:** text-[12px]/text-[13px] in frontend/src/pages/Admin.tsx, TaskPanel.tsx, EpicPanel.tsx, ServiceMappingList.tsx, kanban-v2/cards.tsx, CriticalPathMark.tsx
- **Problem:** Arbitrary pixel text sizes still bypass the type scale in six files; the Gantt toolbar, uppercase headings and Settings banner items from the original entry are already clean.
- **Why deferred / fix direction:** Replace with scale classes during the next pass over those files.
- **Source:** snapshot line 2369, section "Internal sync — deferred findings (2026-10-09)"

### ISS-071 · P3 · Role changes reach the UI up to 30 seconds late

- **Type:** watch · **Found:** 2026-10-09 · **Verified:** 2026-11-18 @ `6dd7592`
- **Where:** REFRESH_THROTTLE_MS in frontend/src/lib/auth.tsx (line ~133)
- **Problem:** The client refreshes /auth/me on focus and after a 403, throttled to once per 30 seconds, so a demoted user may see stale controls; the server already enforces the new role.
- **Why deferred / fix direction:** Accepted: UI-only lag. Revisit only if the throttle becomes a complaint.
- **Source:** snapshot line 2372, section "Internal sync — deferred findings (2026-10-09)"

### ISS-072 · P3 · Active project tab can be off-screen on narrow phones

- **Type:** bug · **Found:** 2026-10-10 · **Verified:** 2026-11-18 @ `6dd7592`
- **Where:** tab nav in frontend/src/pages/ProjectDetail.tsx (line ~322)
- **Problem:** Opening a tab such as /docs directly on a 390px screen leaves the active tab hidden to the right because the strip never scrolls it into view.
- **Why deferred / fix direction:** Call scrollIntoView({ inline: 'nearest' }) on the active tab after navigation.
- **Source:** snapshot line 2384, section "Outline B+C — deferred findings (2026-10-09)"

### ISS-073 · P3 · Portfolio timeline hides the Today line on phones

- **Type:** debt · **Found:** 2026-10-26 · **Verified:** 2026-11-18 @ `6dd7592`
- **Where:** showTodayLine overlay in frontend/src/components/portfolio/PortfolioCalendar.tsx (line ~177)
- **Problem:** The dashed Today line is hidden below 768 px because it would cross the stacked project labels. Phone users get no Today marker.
- **Why deferred / fix direction:** Draw the line over the year track only on phones.
- **Source:** snapshot line 2399, section "Frontend usability — deferred findings (2026-10-26)"

### ISS-074 · P3 · AuthLoading shows plain text instead of a delayed skeleton

- **Type:** debt · **Found:** 2026-10-24 · **Verified:** 2026-11-18 @ `6dd7592`
- **Where:** AuthLoading in frontend/src/components/AuthGuard.tsx (line ~28)
- **Problem:** AuthLoading renders centered 'Loading…' text, against the DESIGN.md rule for delayed skeleton loading states.
- **Why deferred / fix direction:** Use PageLoading or another delayed skeleton.
- **Source:** snapshot line 2406, section "Code splitting — deferred findings (2026-10-24)"

### ISS-076 · P3 · Admin role select shows raw uppercase role values

- **Type:** debt · **Found:** 2026-11-02 · **Verified:** 2026-11-18 @ `6dd7592`
- **Where:** role select in frontend/src/pages/Admin.tsx (line ~252)
- **Problem:** The role control uses uppercase caps text and raw enum values, against DESIGN.md. A nearby comment says font-bold stays but none is present.
- **Why deferred / fix direction:** Use labels.ts words in sentence case and fix the comment.
- **Source:** snapshot line 2449, section "Design compliance fixes — deferred findings (2026-11-02)"

### ISS-077 · P3 · Overview and Project Overview loaders are bare pulse blocks

- **Type:** debt · **Found:** 2026-11-12 · **Verified:** 2026-11-18 @ `6dd7592`
- **Where:** SkeletonGrid in frontend/src/pages/Overview.tsx (line ~457); loading strip in frontend/src/pages/views/ProjectOverview.tsx (line ~80)
- **Problem:** The placeholders are plain animate-pulse blocks, where DESIGN.md asks for skeletons from components/skeletons shown after 150 ms.
- **Why deferred / fix direction:** Move them onto the shared skeleton region.
- **Source:** snapshot line 2454, section "Antislop port — deferred findings (2026-11-12)"

### ISS-174 · P3 · Epic owner picker lists users the server now refuses

- **Type:** bug · **Found:** 2026-11-19 · **Verified:** 2026-11-19 @ wave 1 review
- **Where:** EpicPanel owner select in frontend/src/components/EpicPanel.tsx (line ~271)
- **Problem:** The picker lists every user, but the server refuses an owner who cannot see the project (`owner_no_project_access`), so picking one shows a 400.
- **Why deferred / fix direction:** The server enforces the rule and the error shows inline. Fix: limit options to users who can see the project, or mark the others disabled with a reason.
- **Source:** phase review of `docs/archive/plans/task-integrity.md`

### ISS-179 · P3 · Edit-mode parent picker lets a task with subtasks pick a parent

- **Type:** bug · **Found:** 2026-11-19 · **Verified:** 2026-11-19 @ wave 1 review
- **Where:** possibleParents in frontend/src/components/TaskFormModal.tsx (line ~196)
- **Problem:** A task that has subtasks can pick a parent, which would make a three-level tree that the server depth guard rejects.
- **Why deferred / fix direction:** The server refuses it with a 400. Fix: hide the parent picker, or exclude parents, when the edited task has subtasks.
- **Source:** phase review of `docs/archive/plans/task-ui-fixes.md`

## Open — Accessibility & tokens

### ISS-078 · P2 · Keyboard drag does not work on the Kanban board

- **Type:** bug · **Found:** 2026-07-27 · **Verified:** 2026-11-18 @ `6dd7592`
- **Where:** KanbanItem and KanbanItemHandle in frontend/src/components/reui/kanban.tsx (lines ~796, ~838)
- **Problem:** dnd-kit attributes land on the item wrapper but listeners only on the inner handle, which is not focusable. Mouse and touch drag work; keyboard drag does not.
- **Why deferred / fix direction:** Needs a sanctioned SOLVRO PATCH (spine file) or an upstream report.
- **Source:** snapshot line 582, section "Kanban → ReUI swap — deferred findings (2026-07-27)"

### ISS-079 · P2 · Sortable rows are tab stops with role=button and a joined accessible name

- **Type:** bug · **Found:** 2026-07-30 · **Verified:** 2026-11-18 @ `6dd7592`
- **Where:** SortableItem in frontend/src/components/reui/sortable.tsx (line ~359)
- **Problem:** dnd-kit attributes give every row role=button and tabIndex 0, even for read-only users with no handle. The row name joins its children's labels and a real button nests inside it.
- **Why deferred / fix direction:** Move the drag attributes to the handle or add an explicit aria-label. reui/ is spine: needs a SOLVRO PATCH, a gates.sh counter bump and an instant review.
- **Source:** snapshot line 1131, section "Sortable reorder (sections + subtasks) — deferred findings (2026-07-30)"; merged duplicates at snapshot lines 1520

### ISS-080 · P2 · Light primary/10 chip tints still fall under 4.5:1

- **Type:** bug · **Found:** 2026-10-23 · **Verified:** 2026-11-18 @ `6dd7592`
- **Where:** primary/10 and primary/15 chips (CONTRAST_GAP in e2e/tests/axe.spec.ts line ~22)
- **Problem:** The darker primary fixed text and hover pairs, but chip tints measure about 4.0-4.5:1 on surface containers, so axe leaves them out of the contrast pass.
- **Why deferred / fix direction:** Pick a chip tint or text colour that clears 4.5:1, then remove CONTRAST_GAP from the spec in the same change.
- **Source:** snapshot line 2391, section "Accessibility pass — deferred findings (2026-10-23)"

### ISS-081 · P2 · Landmark, heading-order and nested-interactive axe gaps remain

- **Type:** debt · **Found:** 2026-10-23 · **Verified:** 2026-11-18 @ `6dd7592`
- **Where:** KNOWN_GAP_RULES in e2e/tests/axe.spec.ts (line ~21); SortableItem rows in frontend/src/components/TaskPanel.tsx
- **Problem:** region, landmark-unique and heading-order are disabled in the axe scan. The TaskPanel subtask rows (handle and controls inside the row) are never scanned for nested-interactive.
- **Why deferred / fix direction:** Fix the landmark and heading structure, drop those rules from KNOWN_GAP_RULES, and add a task-panel scan.
- **Source:** snapshot line 2393, section "Accessibility pass — deferred findings (2026-10-23)"

### ISS-083 · P3 · Sidebar nav text uses slate greys instead of the warm design grey

- **Type:** debt · **Found:** 2026-07-20 · **Verified:** 2026-11-18 @ `6dd7592`
- **Where:** nav item classes in frontend/src/components/layout/Sidebar.tsx (line ~42, ~123)
- **Problem:** Inactive nav items use cool slate-* text instead of DESIGN.md's warm #888780. Contrast is fine; it is a tint mismatch.
- **Why deferred / fix direction:** Add a small set of fixed always-dark text tokens, since the theme-flipping secondary token renders too dark on the rail.
- **Source:** snapshot line 351, section "Tech debt / follow-ups from recent work"

### ISS-084 · P3 · Favicon reads weakly on dark browser tab strips

- **Type:** debt · **Found:** 2026-07-25 · **Verified:** 2026-11-18 @ `6dd7592`
- **Where:** favicon link in frontend/index.html (line 6); frontend/public/favicon.png
- **Problem:** The favicon is the on-light mark; its arc ink is 2.38:1 against Chrome's dark tab background.
- **Why deferred / fix direction:** Add an SVG favicon with a media query, or a second link with media prefers-color-scheme: dark pointing at the on-dark mark.
- **Source:** snapshot line 366, section "Tech debt / follow-ups from recent work"

### ISS-085 · P3 · Overview project id uses raw font-mono instead of a type token

- **Type:** debt · **Found:** 2026-07-16 · **Verified:** 2026-11-18 @ `6dd7592`
- **Where:** project id span in frontend/src/pages/Overview.tsx (line ~297)
- **Problem:** The P- id uses raw font-mono. The other cited off-token styles (KPI tones, avatar palette, health hexes) are gone.
- **Why deferred / fix direction:** Switch to the data-mono token (text-data-mono, index.css:107) in the next token pass.
- **Source:** snapshot line 375, section "Tech debt / follow-ups from recent work"

### ISS-086 · P3 · PortfolioCalendar uses rounded-full bars and raw font-mono

- **Type:** debt · **Found:** 2026-07-16 · **Verified:** 2026-11-18 @ `6dd7592`
- **Where:** PortfolioCalendar in frontend/src/components/portfolio/PortfolioCalendar.tsx (line ~118, ~272)
- **Problem:** The timeline bar uses rounded-full, which the design reserves for pills and avatars. The year switcher uses raw font-mono.
- **Why deferred / fix direction:** Fix once in the shared component; it serves both Executive and Overview.
- **Source:** snapshot line 405, section "Tech debt / follow-ups from recent work"

### ISS-087 · P3 · IconTile outline variant has no visible fill on the lowest dark surface

- **Type:** watch · **Found:** 2026-07-31 · **Verified:** 2026-11-18 @ `6dd7592`
- **Where:** outline variant in frontend/src/components/reui/icon-tile.tsx (line ~37)
- **Problem:** On a surface equal to the background colour, only the dark:bg-input rule gives the tile a fill.
- **Why deferred / fix direction:** Trigger: reusing the variant on a different surface. Check contrast there first.
- **Source:** snapshot line 1198, section "ReUI Presentation Set — deferred findings (2026-07-31)"

### ISS-088 · P3 · Badge solid tone variants have unusable contrast

- **Type:** watch · **Found:** 2026-08-01 · **Verified:** 2026-11-18 @ `6dd7592`
- **Where:** info, success, warning, destructive variants in frontend/src/components/reui/badge.tsx (lines ~31-52)
- **Problem:** White text on solid tint fills gives about 1.2:1 contrast in dark mode. No component uses these variants and status chips stay on their own pair.
- **Why deferred / fix direction:** Trigger: anyone wires a solid tone variant. Then pick a solid-fill token family first.
- **Source:** snapshot line 1305, section "ReUI Data Grid phase — deferred findings (2026-08-01)"

### ISS-089 · P3 · Gantt drag clone uses raw shadow-lg outside the elevation whitelist

- **Type:** debt · **Found:** 2026-08-03 · **Verified:** 2026-11-18 @ `6dd7592`
- **Where:** barEl.className in frontend/src/components/reui/gantt/gantt-dnd.tsx (line 310)
- **Problem:** The vendored drag-clone element carries a raw shadow-lg that DESIGN.md's elevation rules do not allow, and it has no SOLVRO PATCH marker.
- **Why deferred / fix direction:** Patch it with a marker; reui/ is spine, so it needs an instant review.
- **Source:** snapshot line 1503, section "Gantt visual refresh — deferred findings (2026-08-03)"

### ISS-091 · P3 · Older focus:border-primary pattern persists at about 70 sites

- **Type:** debt · **Found:** 2026-09-23 · **Verified:** 2026-11-18 @ `6dd7592`
- **Where:** focus:border-primary across frontend/src (e.g. components/admin/ItopTab.tsx, components/itop/TaskTicketField.tsx)
- **Problem:** DESIGN.md names one focus treatment and excludes border-primary, yet the older form still appears at about 70 sites and keeps spreading.
- **Why deferred / fix direction:** Do one design-system sweep to align every site.
- **Source:** snapshot line 2081, section "iTop integration Phase 4 — deferred findings (2026-09-23)"

## Open — Gantt

### ISS-095 · P2 · Gantt save errors can be swallowed when a later update follows

- **Type:** bug · **Found:** 2026-09-30 · **Verified:** 2026-11-18 @ `6dd7592`
- **Where:** updateTask.mutate(..., { onError }) in frontend/src/components/gantt-v2/SolvroGantt.tsx (lines ~565, ~621, ~649)
- **Problem:** TanStack Query v5 fires per-call callbacks only for the latest mutate on a hook, so a failed date, reorder or subtask update is silently dropped if another update on the same hook starts first.
- **Why deferred / fix direction:** Switch to mutateAsync(...).catch(...) as the task panel already does.
- **Source:** snapshot line 2338, section "Collaboration & sharing, Phase 3 ("Conflict warning") — deferred findings (2026-09-30)"

### ISS-096 · P3 · Narrow viewports can clip the Gantt Dates and color columns

- **Type:** bug · **Found:** 2026-07-30 · **Verified:** 2026-11-18 @ `6dd7592`
- **Where:** clampContainer in frontend/src/components/reui/gantt/gantt-view.tsx (line ~976); nameColumnWidth in gantt-v2/SolvroGantt.tsx (line ~456)
- **Problem:** The engine renders the tree pane narrower than treeWidth below a ~699px container and never reports that width. nameColumnWidth then ignores the clamp and the fixed columns overflow the pane edge.
- **Why deferred / fix direction:** Clamp nameColumnWidth by the measured pane width (ResizeObserver), or patch the engine to report the clamped width. Rare: Gantt is desktop-first and the default pane (498) only clamps below ~699px.
- **Source:** snapshot line 73, section "Known bugs / inconsistencies"

### ISS-097 · P3 · Narrowing the Gantt pane below 356px clips the fixed columns

- **Type:** watch · **Found:** 2026-07-30 · **Verified:** 2026-11-18 @ `6dd7592`
- **Where:** TREE_FIXED_COLUMNS_WIDTH / name column floor in frontend/src/components/gantt-v2/SolvroGantt.tsx (line ~218)
- **Problem:** Below a 356px pane the name column floors and the fixed columns clip. This only happens when the user drags the splitter that narrow.
- **Why deferred / fix direction:** Accepted, not planned. Revisit only if users report it.
- **Source:** snapshot line 86, section "Known bugs / inconsistencies"

### ISS-098 · P3 · Gantt splitter drag fires width change only on release

- **Type:** bug · **Found:** 2026-07-30 · **Verified:** 2026-11-18 @ `6dd7592`
- **Where:** splitter onMove/finish in frontend/src/components/reui/gantt/gantt-view.tsx (line ~1062-1082)
- **Problem:** During a splitter drag the engine updates the pane width in the DOM but calls onWidthChange on pointerup only. Fixed columns clip while narrowing and snap back on release.
- **Why deferred / fix direction:** Share the fix with the clamp entry: report live width or measure the pane. Pre-existing and cosmetic.
- **Source:** snapshot line 90, section "Known bugs / inconsistencies"

### ISS-099 · P3 · Computed critical path is deferred; only the manual mark exists

- **Type:** decision · **Found:** 2026-08-02 · **Verified:** 2026-11-18 @ `6dd7592`
- **Where:** Task.isCriticalPath in backend/prisma/schema.prisma (line ~532); frontend/src/components/CriticalPathMark.tsx
- **Problem:** The manual Critical Path flag shipped. A path computed from TaskDependency does not exist and is deferred by decision.
- **Why deferred / fix direction:** Question: build a computed path (optionally a 'Suggest from dependencies' action) or leave the manual flag as the only mechanism?.
- **Source:** snapshot line 301, section "Deferred (explicit, by decision)"

### ISS-100 · P3 · legendEntries sorts sections twice

- **Type:** debt · **Found:** 2026-07-23 · **Verified:** 2026-11-18 @ `6dd7592`
- **Where:** legendEntries section branch in frontend/src/lib/gantt/palette.ts (line ~254)
- **Problem:** resolveSectionColors already sorts by position and id, and legendEntries sorts again with the same comparator. The cost is negligible.
- **Why deferred / fix direction:** Optional cleanup; flagged for awareness.
- **Source:** snapshot line 486, section "Tech debt / follow-ups from recent work"

### ISS-101 · P3 · Milestone dependency arrows end at the day-box edge, not the diamond

- **Type:** bug · **Found:** 2026-07-25 · **Verified:** 2026-11-18 @ `6dd7592`
- **Where:** buildConnectorRoute in frontend/src/components/gantt-v2/connector-paths.ts (line ~106); frontend/src/components/gantt-v2/SolvroBar.tsx
- **Problem:** Connector endpoints for milestone tasks stop at the cell edge rather than the diamond center. The gap is about 30-40px at Week zoom; routing is still correct.
- **Why deferred / fix direction:** Offset the endpoint to the diamond center for milestones. Cosmetic.
- **Source:** snapshot line 543, section "Plan B Task 9 deferred findings — ReUI Gantt swap (2026-07-25)"

### ISS-102 · P3 · Gantt bars each attach their own ResizeObserver

- **Type:** watch · **Found:** 2026-07-25 · **Verified:** 2026-11-18 @ `6dd7592`
- **Where:** ResizeObserver in SolvroBar (frontend/src/components/gantt-v2/SolvroBar.tsx line ~103)
- **Problem:** Each rendered Gantt bar attaches its own ResizeObserver. Fine at current task counts.
- **Why deferred / fix direction:** Trigger: a project rendering low hundreds of bars or a profiler flag. Then share one observer.
- **Source:** snapshot line 546, section "Plan B Task 9 deferred findings — ReUI Gantt swap (2026-07-25)"

### ISS-103 · P3 · Gantt section-id parsing lives outside the adapter

- **Type:** debt · **Found:** 2026-07-25 · **Verified:** 2026-11-18 @ `6dd7592`
- **Where:** sectionNodeId in gantt-v2/adapter.ts (line 13) vs section-id parsing in SolvroGantt.tsx (lines ~663, ~842)
- **Problem:** The adapter formats section ids but SolvroGantt parses them with inline slice and startsWith checks. No defect.
- **Why deferred / fix direction:** Add parseSectionId to the adapter when the signature lock lifts.
- **Source:** snapshot line 556, section "Final whole-branch review additions (2026-07-25)"

### ISS-104 · P3 · handleResourceReorder is one long three-branch callback

- **Type:** debt · **Found:** 2026-07-25 · **Verified:** 2026-11-18 @ `6dd7592`
- **Where:** handleResourceReorder in frontend/src/components/gantt-v2/SolvroGantt.tsx (line ~581)
- **Problem:** The reorder handler spans about 130 lines and three branches, kept to mirror the old engine for diffing.
- **Why deferred / fix direction:** Split into named helpers in a readability pass.
- **Source:** snapshot line 557, section "Final whole-branch review additions (2026-07-25)"

### ISS-105 · P3 · GanttDatePicker is unmounted and uses shadow-md

- **Type:** debt · **Found:** 2026-07-28 · **Verified:** 2026-11-18 @ `6dd7592`
- **Where:** GanttDatePicker in frontend/src/components/reui/gantt/gantt-nav.tsx (line ~358)
- **Problem:** The component has no consumer in src and its popover uses shadow-md instead of shadow-overlay.
- **Why deferred / fix direction:** Confirm dead and remove, or align the shadow at first use.
- **Source:** snapshot line 831, section "ReUI DateField swap — deferred findings (2026-07-28)"

### ISS-106 · P3 · Gantt Dates cell shows the date range twice while editing

- **Type:** bug · **Found:** 2026-07-28 · **Verified:** 2026-11-18 @ `6dd7592`
- **Where:** TaskDatesCell in frontend/src/components/gantt-v2/TreeCells.tsx (lines ~46-80)
- **Problem:** The cell button stays visible while the editor opens below it, so the same range appears twice.
- **Why deferred / fix direction:** Hide the cell button while editing is true.
- **Source:** snapshot line 972, section "DateRangeField — deferred findings (2026-07-28, Task 3.5)"

### ISS-107 · P3 · Dark-mode Critical Path ring on Gantt bars resembles the selection ring

- **Type:** decision · **Found:** 2026-09-02 · **Verified:** 2026-11-18 @ `6dd7592`
- **Where:** outline-chip-violet-text in frontend/src/components/gantt-v2/SolvroBar.tsx (line ~320)
- **Problem:** In dark mode a marked and selected bar shows two near-identical light rings, so the signals blur together.
- **Why deferred / fix direction:** Choose between the spec token and a fixed violet for the Gantt ring.
- **Source:** snapshot line 1812, section "Critical Path mark — deferred findings (2026-09-02)"

### ISS-108 · P3 · Gantt bar labels may be hard to read over the unfilled hatch

- **Type:** watch · **Found:** 2026-11-02 · **Verified:** 2026-11-18 @ `6dd7592`
- **Where:** labelBackgroundHex in frontend/src/components/gantt-v2/SolvroBar.tsx (line ~278)
- **Problem:** On a partly filled bar the part of the label over the pale hatch may be hard to read. Seen in light mode, not verified in a browser.
- **Why deferred / fix direction:** Trigger: confirm in a browser on a partly filled bar. Then pick the label colour per segment.
- **Source:** snapshot line 2445, section "Design compliance fixes — deferred findings (2026-11-02)"

### ISS-178 · P3 · Gantt section actions show for task:write but the routes need project:write

- **Type:** bug · **Found:** 2026-11-19 · **Verified:** 2026-11-19 @ wave 1 review
- **Where:** canEdit in frontend/src/components/gantt-v2/SolvroGantt.tsx (line ~354): Add section (~1086), section reorder (~583), section color (~760)
- **Problem:** The same mismatch ISS-061 fixed in the list view: a custom role with task:write only sees the actions and gets a 403.
- **Why deferred / fix direction:** Seeded roles never split the two permissions. Fix: gate the three actions on project:write (spine file, instant review).
- **Source:** phase review of `docs/archive/plans/task-ui-fixes.md`

## Open — Boards & drag

### ISS-109 · P3 · Task panel shows the old section chip during a cross-section drag

- **Type:** bug · **Found:** 2026-07-22 · **Verified:** 2026-11-18 @ `6dd7592`
- **Where:** reorderTasksLocally in frontend/src/lib/queries.ts (line ~1830); task.section use in components/TaskPanel.tsx (~734)
- **Problem:** During the optimistic window the moved task keeps its old nested section object. An open panel on that task shows the old chip until the refetch.
- **Why deferred / fix direction:** Recompute the nested section from the sections cache inside reorderTasksLocally. Transient and self-healing.
- **Source:** snapshot line 434, section "Tech debt / follow-ups from recent work"

### ISS-110 · P3 · Kanban drop on the preview-swapped card can cancel a one-slot move

- **Type:** watch · **Found:** 2026-07-27 · **Verified:** 2026-11-18 @ `6dd7592`
- **Where:** same-container branch in frontend/src/components/reui/kanban.tsx (lines ~403, ~527)
- **Problem:** handleDragEnd applies arrayMove to already-shuffled preview state, so a drop on the swapped card can undo the move. It needs precise pointer geometry and was never reproduced.
- **Why deferred / fix direction:** Trigger: a user or e2e run reproduces a lost one-slot reorder.
- **Source:** snapshot line 637, section "Kanban → ReUI swap — deferred findings (2026-07-27)"

### ISS-111 · P3 · Subtask drag may flicker back before the reorder commits

- **Type:** watch · **Found:** 2026-07-30 · **Verified:** 2026-11-18 @ `6dd7592`
- **Where:** Sortable onValueChange in frontend/src/components/TaskPanel.tsx (line ~844)
- **Problem:** The list keeps the old order until the optimistic update lands after an await, so a snap-back flash is possible.
- **Why deferred / fix direction:** Trigger: flicker seen in use. Then mirror the local-order pattern from SectionReorderModal.
- **Source:** snapshot line 1097, section "Sortable reorder (sections + subtasks) — deferred findings (2026-07-30)"

### ISS-112 · P3 · Failed section PATCH can leave the reorder modal out of sync

- **Type:** watch · **Found:** 2026-07-30 · **Verified:** 2026-11-18 @ `6dd7592`
- **Where:** useUpdateSection in frontend/src/lib/queries.ts (lines ~2292-2345)
- **Problem:** A rollback after a failed PATCH discards optimistic state of queued mutations, and the modal's local order is only re-seeded on open.
- **Why deferred / fix direction:** Trigger: PATCH /sections/:id fails mid-session in practice. Then re-seed the modal on settle.
- **Source:** snapshot line 1119, section "Sortable reorder (sections + subtasks) — deferred findings (2026-07-30)"

### ISS-113 · P3 · Section reorder modal can get stuck if a drag never ends

- **Type:** bug · **Found:** 2026-07-30 · **Verified:** 2026-11-18 @ `6dd7592`
- **Where:** handleModalClose and the reset effect in frontend/src/components/SectionReorderModal.tsx (lines ~39-72)
- **Problem:** If a drag-end callback never fires, the guard stays true and blocks every close route; the reset effect only runs when open changes.
- **Why deferred / fix direction:** Exempt the header X from the guard.
- **Source:** snapshot line 1145, section "Sortable reorder (sections + subtasks) — deferred findings (2026-07-30)"

## Open — iTop

### ISS-114 · P2 · iTop TimeSpent duration unit is assumed to be seconds

- **Type:** watch · **Found:** 2026-09-22 · **Verified:** 2026-11-18 @ `6dd7592`
- **Where:** ITOP_TIME_SPENT_DURATION_IN_SECONDS in backend/src/lib/itop/types.ts (line 177)
- **Problem:** Time sync divides TimeSpent.duration by 60 on the assumption that iTop stores seconds. If the install uses minutes, synced durations would be wrong.
- **Why deferred / fix direction:** Check the probe's TimeSpent dump on the real install and flip the constant if needed.
- **Source:** snapshot line 2027, section "iTop integration Phase 3 — deferred findings (2026-09-22)"

### ISS-116 · P2 · TimeSpent ticket_ref attribute is unverified on a real iTop install

- **Type:** watch · **Found:** 2026-09-23 · **Verified:** 2026-11-18 @ `6dd7592`
- **Where:** ITOP_TIME_SPENT_TICKET_REF_FIELD in backend/src/lib/itop/types.ts (line ~163)
- **Problem:** Only the fake iTop enforces ticket_ref; if the real Time Tracking extension ignores it, logged entries land in Utilization without a ticket link and the ticket panel's weekly figure stays at 0.
- **Why deferred / fix direction:** Needs a probe on the real install once the Time Tracking extension is present; the iTop admin must confirm the attribute name and REST writability before go-live.
- **Source:** snapshot line 2285, section "iTop integration Phase 7 — deferred findings (2026-09-23)"

### ISS-117 · P2 · Application token cannot read iTop User, so itopUserId is never set

- **Type:** watch · **Found:** 2026-09-24 · **Verified:** 2026-11-18 @ `6dd7592`
- **Where:** POST /itop/tickets/:id/time guard in backend/src/routes/itop.ts (line ~1364)
- **Problem:** On the tested install neither the application token nor a TAM's token can read the iTop User class, so user matching never sets User.itopUserId and time logging answers 'Your iTop user account is not linked yet'.
- **Why deferred / fix direction:** Once Time Tracking is installed, test whether TimeSpent.user_id can be omitted, or grant the application token a profile that can read User.
- **Source:** snapshot line 2311, section "iTop integration — real-install findings (2026-09-24)"

### ISS-118 · P2 · Re-test Settings > iTop save on the real install before go-live

- **Type:** watch · **Found:** 2026-09-24 · **Verified:** 2026-11-18 @ `6dd7592`
- **Where:** ITOP_ALLOW_UNVERIFIED_PERSONAL_TOKENS in backend/src/env.ts (line ~96)
- **Problem:** Personal tokens work only for profiles in the authent-token setting personal_tokens_allowed_profiles; the save may be refused on the real install until the opt-out env var is set.
- **Why deferred / fix direction:** Trigger: go-live on the real install; re-test the save and set the env var if refused.
- **Source:** snapshot line 2314, section "iTop integration — real-install findings (2026-09-24)"

### ISS-121 · P3 · iTop board drag transitions assume the default lifecycle

- **Type:** watch · **Found:** 2026-09-23 · **Verified:** 2026-11-18 @ `6dd7592`
- **Where:** TRANSITIONS in frontend/src/components/itop/board/dropMapper.ts (line 40)
- **Problem:** Custom states or stimuli make the board reject wanted drags or pass drags that iTop then refuses with its own text.
- **Why deferred / fix direction:** Verify against the real install; add per-install config only if it differs.
- **Source:** snapshot line 2182, section "iTop integration Phase 6 — deferred findings (2026-09-23)"

### ISS-122 · P3 · iTop ticket board on phones is untested stacked columns with touch drag

- **Type:** watch · **Found:** 2026-09-23 · **Verified:** 2026-11-18 @ `6dd7592`
- **Where:** KanbanBoard grid in frontend/src/components/itop/board/TicketBoard.tsx (line 181)
- **Problem:** Below 768px the five columns stack vertically with drag still wired. Long scrolls and touch precision have not been checked on real devices.
- **Why deferred / fix direction:** Test on a phone before calling it a phone-usable form.
- **Source:** snapshot line 2193, section "iTop integration Phase 6 — deferred findings (2026-09-23)"

### ISS-123 · P3 · Time Tracking extension must be installed before TimeSpent checks

- **Type:** watch · **Found:** 2026-09-24 · **Verified:** 2026-11-18 @ `6dd7592`
- **Where:** TimeSpent sync in backend/src/lib/itop/sync.ts
- **Problem:** iTop Community does not bundle the Time Tracking extension, so the duration unit and ticket_ref checks cannot run until it is installed from iTop Hub.
- **Why deferred / fix direction:** Trigger: extension installed on the real install; then run the duration and ticket_ref probes.
- **Source:** snapshot line 2315, section "iTop integration — real-install findings (2026-09-24)"

### ISS-125 · P3 · An iTop full sync that always exceeds the run budget never completes

- **Type:** watch · **Found:** 2026-10-25 · **Verified:** 2026-11-18 @ `6dd7592`
- **Where:** RUN_BUDGET_MS in backend/src/lib/itop/sync.ts (line ~87)
- **Problem:** A run that hits the budget records the reason, prunes nothing and leaves lastFullSyncAt unchanged. A very large iTop would re-pull everything every tick.
- **Why deferred / fix direction:** Trigger: logged 'iTop sync completed' ms nearing 25 minutes on a real install. Then add a resumable cursor.
- **Source:** snapshot line 2413, section "Backend concurrency and roles — deferred findings (2026-10-25)"

### ISS-126 · P3 · Older personal iTop tokens are not re-validated

- **Type:** watch · **Found:** 2026-10-25 · **Verified:** 2026-11-18 @ `6dd7592`
- **Where:** validation at save time in backend/src/routes/itopUser.ts
- **Problem:** Tokens saved under the old rule keep working until their owner re-saves them. The user accepted this and it is documented.
- **Why deferred / fix direction:** Trigger: real install shows which profiles can read the classes. Then run a one-off re-validation.
- **Source:** snapshot line 2414, section "Backend concurrency and roles — deferred findings (2026-10-25)"

### ISS-127 · P3 · A budget-cut time-entry pass still counts as a complete full run

- **Type:** watch · **Found:** 2026-10-25 · **Verified:** 2026-11-18 @ `6dd7592`
- **Where:** writeConfigResult call in backend/src/lib/itop/sync.ts (line ~999)
- **Problem:** The time-entry prune is skipped and waits for the next full run, up to 24 h. Time entries deleted in iTop stay in Solvro until then.
- **Why deferred / fix direction:** Accepted trade-off. Revisit with the resumable-cursor idea.
- **Source:** snapshot line 2415, section "Backend concurrency and roles — deferred findings (2026-10-25)"

### ISS-130 · P3 · iTop ticket panel shows '– ago' when lastUpdate is null

- **Type:** bug · **Found:** 2026-11-12 · **Verified:** 2026-11-18 @ `6dd7592`
- **Where:** Last update Fact in frontend/src/components/itop/TicketPanel.tsx (line ~290)
- **Problem:** A ticket with no last update shows a dash followed by 'ago'.
- **Why deferred / fix direction:** Guard on lastUpdate like the Started fact does.
- **Source:** snapshot line 2457, section "Antislop port — deferred findings (2026-11-12)"

### ISS-173 · P3 · A repeated Refresh resets the iTop full-sync retry cap

- **Type:** debt · **Found:** 2026-11-18 · **Verified:** 2026-11-18 @ `fix/itop-findings-redo`
- **Where:** requestSync / runRequested in backend/src/lib/itop/scheduler.ts (line ~58)
- **Problem:** Each new Refresh starts the retry loop at attempt 0, so a Refresh about once a minute keeps the 30-minute retry window alive while the lock is held.
- **Why deferred / fix direction:** The lock holder is time-boxed by RUN_BUDGET_MS and Refresh by its 60 s window. Fix: keep one deadline in module state instead of a per-call attempt counter.
- **Source:** phase review of `docs/archive/plans/itop-findings-redo.md`

## Open — Exports & sharing

### ISS-131 · P2 · Gantt Excel/PDF downloads blocked on the plain-HTTP production host

- **Type:** watch · **Found:** 2026-07-31 · **Verified:** 2026-11-18 @ `6dd7592`
- **Where:** Gantt download helpers in frontend/src/lib/gantt/exportExcel.ts and exportPdf.ts (line ~370, ~958)
- **Problem:** Chromium-family browsers block downloads from an http origin that is not localhost, showing a secure-connection warning. The user can still keep the file from the download item menu.
- **Why deferred / fix direction:** Reach the app at http://localhost:PORT, or serve HTTPS (internal-CA cert declined 2026-07-31). Not fixable in the export format.
- **Source:** snapshot line 125, section "Known bugs / inconsistencies"; merged duplicates at snapshot lines 132, 141, 147

### ISS-132 · P2 · Guest links are built from the owner's browser address

- **Type:** bug · **Found:** 2026-09-30 · **Verified:** 2026-11-18 @ `6dd7592`
- **Where:** NewLinkPanel in frontend/src/components/ProjectShare.tsx (line ~244)
- **Problem:** The copied link uses window.location.origin, so an owner signed in over an SSH tunnel or localhost gets a link a guest cannot open.
- **Why deferred / fix direction:** Add a PUBLIC_BASE_URL setting and build the link from it.
- **Source:** snapshot line 2353, section "Collaboration & sharing, Phase 6 ("Guest links") — deferred findings (2026-09-30)"

### ISS-133 · P3 · Excel export revokes its blob URL right after the click

- **Type:** debt · **Found:** 2026-07-31 · **Verified:** 2026-11-18 @ `6dd7592`
- **Where:** exportGanttExcel download tail in frontend/src/lib/gantt/exportExcel.ts (line ~382)
- **Problem:** The download helper revokes the object URL synchronously after a.click(). The revoke belongs on a later task so the browser can start the download first.
- **Why deferred / fix direction:** Move URL.revokeObjectURL into a setTimeout. Not the cause of the blocked-download issue.
- **Source:** snapshot line 156, section "Known bugs / inconsistencies"

### ISS-134 · P3 · Gantt screen and PDF export differ in progress and rollup bar styling

- **Type:** watch · **Found:** 2026-08-03 · **Verified:** 2026-11-18 @ `6dd7592`
- **Where:** progress overlay and rollup pill in frontend/src/lib/gantt/exportPdf.ts (lines ~726-840)
- **Problem:** The live Gantt hatches the incomplete portion and draws a thin squared rollup, while the PDF still draws a flat overlay and a rounded pill. The in-file comment records this as accepted.
- **Why deferred / fix direction:** Sync the PDF drawing only if customers notice the mismatch.
- **Source:** snapshot line 1478, section "Gantt visual refresh — deferred findings (2026-08-03)"

## Open — Tests & CI

### ISS-138 · P2 · Drag e2e specs flake on first attempt and pass on retry

- **Type:** watch · **Found:** 2026-07-28 · **Verified:** 2026-11-18 @ `6dd7592`
- **Where:** gantt-parity.spec.ts connector test, kanban-dnd.spec.ts cross-view and mobile touch, list-dnd.spec.ts cross-status reorder
- **Problem:** The same four to five drag cases fail their first attempt and pass on retry. The retry budget has one spare attempt.
- **Why deferred / fix direction:** Trigger: a fifth case flakes or any case fails through its retry. Then run a flake-hunt pass.
- **Source:** snapshot line 896, section "ReUI DateField swap — deferred findings (2026-07-28)"; merged duplicates at snapshot lines 2320

### ISS-140 · P2 · gates.sh runs only the smoke e2e spec

- **Type:** debt · **Found:** 2026-09-02 · **Verified:** 2026-11-18 @ `6dd7592`
- **Where:** smoke_gate in .claude/scripts/gates.sh (line 98)
- **Problem:** New e2e specs never run in the mechanical gate and depend on someone running them by hand.
- **Why deferred / fix direction:** Add a step that runs the specs changed in the diff.
- **Source:** snapshot line 1887, section "Duplicate tasks, subtasks, and sections — deferred findings (2026-09-02)"

### ISS-141 · P3 · pwa.spec.ts fails against the Vite dev server

- **Type:** watch · **Found:** 2026-07-22 · **Verified:** 2026-11-18 @ `6dd7592`
- **Where:** pwa specs in e2e/tests/pwa.spec.ts (line ~16-26); vite-plugin-pwa in frontend/vite.config.ts
- **Problem:** vite-plugin-pwa emits the manifest and service worker only in build mode, so the specs fail at BASE_URL=http://localhost:5173. They pass on the built CI stack (:8080).
- **Why deferred / fix direction:** Accepted in e2e/CLAUDE.md. Trigger: running e2e against the dev server. Optional: skip the specs when BASE_URL is :5173.
- **Source:** snapshot line 216, section "Known bugs / inconsistencies"

### ISS-143 · P3 · No ESLint setup, so the exhaustive-deps guard on TaskFormModal is inert

- **Type:** debt · **Found:** 2026-07-23 · **Verified:** 2026-11-18 @ `6dd7592`
- **Where:** eslint-disable comment in frontend/src/components/TaskFormModal.tsx (line ~177)
- **Problem:** The repo has no ESLint config or lint script, so the directive does nothing. Nothing stops a future edit from re-adding the whole props object to the reset effect deps.
- **Why deferred / fix direction:** Add ESLint with react-hooks/exhaustive-deps and an npm run lint step in CI.
- **Source:** snapshot line 476, section "Tech debt / follow-ups from recent work"; merged duplicates at snapshot lines 2330

### ISS-144 · P3 · No e2e test that the Gantt colorBy choice survives a reload

- **Type:** test-gap · **Found:** 2026-07-23 · **Verified:** 2026-11-18 @ `6dd7592`
- **Where:** e2e/tests/gantt-legend.spec.ts; COLOR_BY_STORAGE_KEY in frontend/src/components/gantt-v2/SolvroGantt.tsx (line 160)
- **Problem:** The legend spec only switches Status, Section and Priority within a session. It never checks the stored choice after a reload.
- **Why deferred / fix direction:** Add a case that selects a mode, reloads, and asserts the select and legend are restored.
- **Source:** snapshot line 494, section "Tech debt / follow-ups from recent work"

### ISS-145 · P3 · Connector hover-delete e2e test flakes rarely

- **Type:** watch · **Found:** 2026-07-25 · **Verified:** 2026-11-18 @ `6dd7592`
- **Where:** connector create/delete test in e2e/tests/gantt-parity.spec.ts (line ~329)
- **Problem:** The hover-to-delete-connector assertion occasionally fails on the first attempt and passes on retry. The cause is not isolated.
- **Why deferred / fix direction:** Trigger: it fails in CI more than occasionally. Then run a flake-hunt pass.
- **Source:** snapshot line 545, section "Plan B Task 9 deferred findings — ReUI Gantt swap (2026-07-25)"

### ISS-146 · P3 · E2E suite uses fixed waitForTimeout sleeps

- **Type:** debt · **Found:** 2026-07-25 · **Verified:** 2026-11-18 @ `6dd7592`
- **Where:** waitForTimeout calls across e2e/tests/*.spec.ts
- **Problem:** Many specs sleep for a fixed time instead of waiting on a condition or response, which adds slowness and flake risk.
- **Why deferred / fix direction:** Convert to waitForResponse or selector waits in one hardening pass.
- **Source:** snapshot line 550, section "Plan B Task 9 deferred findings — ReUI Gantt swap (2026-07-25)"; merged duplicates at snapshot lines 547

### ISS-147 · P3 · No test guards the Login and sidebar always-dark pin

- **Type:** test-gap · **Found:** 2026-07-25 · **Verified:** 2026-11-18 @ `6dd7592`
- **Where:** Login.tsx root wrapper and sidebar rail (frontend/src/pages/Login.tsx, layout sidebar); no spec in e2e/tests
- **Problem:** Nothing checks that Login and the sidebar stay dark when the theme is light. A Tailwind theme change could reintroduce the bug.
- **Why deferred / fix direction:** Add an assertion with the theme forced to light via localStorage.
- **Source:** snapshot line 565, section "Login/Sidebar always-dark-pin fix — deferred findings (2026-07-25)"

### ISS-149 · P3 · No e2e drag test for section reorder or subtask drag

- **Type:** test-gap · **Found:** 2026-07-30 · **Verified:** 2026-11-18 @ `6dd7592`
- **Where:** SectionReorderModal and TaskPanel subtask Sortable; e2e/tests has no covering spec
- **Problem:** Neither reorder surface has a spec exercising the drag gesture; the smoke gate only checks rendering.
- **Why deferred / fix direction:** Add drag specs next to the existing Gantt and Kanban drag specs.
- **Source:** snapshot line 1158, section "Sortable reorder (sections + subtasks) — deferred findings (2026-07-30)"

### ISS-150 · P3 · Duplicate-chip e2e spec cannot reproduce the upstream race

- **Type:** watch · **Found:** 2026-08-02 · **Verified:** 2026-11-18 @ `6dd7592`
- **Where:** e2e/tests/filters-duplicate-chip.spec.ts; frontend/src/components/reui/filters.test.ts
- **Problem:** The spec proves at most one chip per field but not the upstream double-fire. The unit test covers the guard logic.
- **Why deferred / fix direction:** Trigger: the upstream Base UI double-fire becomes reproducible. Then add a discriminating spec.
- **Source:** snapshot line 1436, section "Issues Sweep #1 — residuals (2026-08-02)"

### ISS-151 · P3 · filters.test.ts depends on a patch export a vendor re-pull would delete

- **Type:** watch · **Found:** 2026-08-02 · **Verified:** 2026-11-18 @ `6dd7592`
- **Where:** findFilterMatch import in frontend/src/components/reui/filters.test.ts
- **Problem:** The test imports findFilterMatch, a SOLVRO PATCH export. A re-pull of filters.tsx would drop it and break the import; only the patch-count gate catches that, with no check for the test file itself.
- **Why deferred / fix direction:** Keep the patch-count gate; revisit if the vendor is re-pulled.
- **Source:** snapshot line 1451, section "Issues Sweep #1 — residuals (2026-08-02)"

### ISS-153 · P3 · daily-review e2e spec leaves junk rows in the shared dev DB each run

- **Type:** test-gap · **Found:** 2026-08-29 · **Verified:** 2026-11-18 @ `6dd7592`
- **Where:** header comment and missing cleanup in e2e/tests/daily-review.spec.ts (lines 29-36)
- **Problem:** Each run flips a project ACTIVE and a customer's TAM permanently. DELETE routes now exist but the spec never calls them, and its header comment still claims they are missing.
- **Why deferred / fix direction:** Delete the seeded project and customer in a teardown and correct the comment.
- **Source:** snapshot line 1712, section "Daily Review v2 — deferred findings (2026-08-29)"

### ISS-154 · P3 · Three e2e specs flaked once and passed on retry

- **Type:** watch · **Found:** 2026-09-02 · **Verified:** 2026-11-18 @ `6dd7592`
- **Where:** gantt-parity.spec.ts connector-hover test and two tests in e2e/tests/kanban-dnd.spec.ts
- **Problem:** A hover-to-reveal timing test and two shared-seed order tests failed once and retried clean. None are regressions.
- **Why deferred / fix direction:** Tighten the wait condition or fixture isolation if one fails repeatedly.
- **Source:** snapshot line 1772, section "Critical Path mark — deferred findings (2026-09-02)"

### ISS-155 · P3 · auth.spec 'admin page right after sign-in' flakes on mobile project

- **Type:** watch · **Found:** 2026-09-29 · **Verified:** 2026-11-18 @ `6dd7592`
- **Where:** 'an admin page opened right after sign-in stays on the admin page' in e2e/tests/auth.spec.ts (line ~70)
- **Problem:** The test failed about 1 run in 2 on the mobile project: after sign-in, goto('/admin') landed on the sign-in page. A later sign-in race fix (frontend/src/lib/auth.tsx) matches the symptom but is not confirmed as the cause.
- **Why deferred / fix direction:** Trigger: strike it if the flake stays gone across several CI runs; otherwise investigate.
- **Source:** snapshot line 2328, section "Collaboration & sharing, Phase 1 ("Quick wins") — deferred findings (2026-09-29)"

### ISS-156 · P3 · taskOrdering cross-project test flakes in the parallel run

- **Type:** test-gap · **Found:** 2026-09-30 · **Verified:** 2026-11-18 @ `6dd7592`
- **Where:** 'orders GET /tasks (cross-project)…' in backend/test/taskOrdering.test.ts (line ~103)
- **Problem:** The test reads the take: 200 window of GET /tasks, which other test files fill when run in parallel, so the two tasks can fall outside it.
- **Why deferred / fix direction:** Filter the request to the test's own project or fetch by id instead of the global list.
- **Also seen 2026-11-19:** `epics.test.ts` "returns epicId on GET /projects/:id/tasks and GET /tasks" failed once in the full run and passed in the next two; same cross-project GET /tasks pattern.
- **Source:** snapshot line 2336, section "Collaboration & sharing, Phase 3 ("Conflict warning") — deferred findings (2026-09-30)"

### ISS-157 · P3 · Concurrency tests for activity and notification recipients are unproven

- **Type:** test-gap · **Found:** 2026-09-30 · **Verified:** 2026-11-18 @ `6dd7592`
- **Where:** backend/test/activity.test.ts (line ~229); backend/test/notifications.test.ts (line ~129)
- **Problem:** The simultaneous-assign tests cannot fail spuriously, but nobody has confirmed they fail when the row lock is removed, so they may not guard it.
- **Why deferred / fix direction:** Temporarily remove the lock and confirm both tests fail; if not, strengthen them.
- **Source:** snapshot line 2344, section "Collaboration & sharing, Phase 4 ("Activity and notifications") — deferred findings (2026-09-30)"

### ISS-158 · P3 · Weekly Sync e2e test times out on a database with hundreds of customers

- **Type:** watch · **Found:** 2026-10-26 · **Verified:** 2026-11-18 @ `6dd7592`
- **Where:** groupContainingRow in e2e/tests/weekly-sync.spec.ts (line ~72)
- **Problem:** The helper walks every customer block with two awaits each. With about 500 customers it exceeds the 5 s poll on the mobile project.
- **Why deferred / fix direction:** Trigger: a long-lived dev database. Fix with a locator that does not walk the blocks.
- **Source:** snapshot line 2400, section "Frontend usability — deferred findings (2026-10-26)"

### ISS-159 · P3 · Mobile smoke overflow check reported Kanban 453px too wide once

- **Type:** watch · **Found:** 2026-10-24 · **Verified:** 2026-11-18 @ `6dd7592`
- **Where:** no horizontal overflow test in e2e/tests/smoke.spec.ts (line ~25)
- **Problem:** The check failed once in a full local run against vite preview and passed 34/34 on reruns. Cause unknown.
- **Why deferred / fix direction:** Trigger: recurrence. Capture the overflowing element before retrying.
- **Source:** snapshot line 2407, section "Code splitting — deferred findings (2026-10-24)"

### ISS-160 · P3 · CI npm audit step is report-only, not a gate

- **Type:** watch · **Found:** 2026-10-25 · **Verified:** 2026-11-18 @ `6dd7592`
- **Where:** npm audit step in .github/workflows/ci.yml (line ~142)
- **Problem:** The audit runs with a warning and never fails CI, by decision. A failing gate would fail today on the zod advisory.
- **Why deferred / fix direction:** Trigger: the zod 4 upgrade. Then make the step fail.
- **Source:** snapshot line 2424, section "Dependency advisories — remaining (2026-10-25)"

### ISS-161 · P3 · Trigram index test forces the plan instead of proving it is chosen

- **Type:** test-gap · **Found:** 2026-10-26 · **Verified:** 2026-11-18 @ `6dd7592`
- **Where:** indexUsage test in backend/test/indexUsage.test.ts (line ~28)
- **Problem:** The test turns off sequential scans, so it shows the indexes can serve the queries but not that the planner picks them at current sizes.
- **Why deferred / fix direction:** Re-test with realistic row counts when tables grow.
- **Source:** snapshot line 2441, section "Data integrity, session and query performance — deferred findings (2026-10-26)"

### ISS-162 · P3 · e2e fails on a dev stack with Google sign-in configured

- **Type:** watch · **Found:** 2026-11-02 · **Verified:** 2026-11-18 @ `6dd7592`
- **Where:** Google-not-configured cases in e2e/tests/auth.spec.ts (line ~10); console-error check in e2e/tests/smoke.spec.ts (line ~45)
- **Problem:** The tests assume the seeded QA stack with no Google sign-in. They fail on a stack with a client ID or an origin Google rejects.
- **Why deferred / fix direction:** Trigger: running e2e outside the seeded QA stack. Run against the QA stack.
- **Source:** snapshot line 2447, section "Design compliance fixes — deferred findings (2026-11-02)"

### ISS-182 · P3 · prisma/seed.ts is outside the backend typecheck

- **Type:** debt · **Found:** 2026-11-19 · **Verified:** 2026-11-19 @ wave 2 review
- **Where:** include in backend/tsconfig.check.json; import in backend/prisma/seed.ts (line 2)
- **Problem:** The seed entry is not typechecked, and its extensionless import of ./builtInRoles would fail under NodeNext.
- **Why deferred / fix direction:** The seed is small and fails loudly at db:seed. Fix: add prisma/**/*.ts to the include and use ./builtInRoles.js.
- **Source:** phase review of `docs/archive/plans/typecheck-and-test-hygiene.md`

### ISS-183 · P3 · frontend/vitest.config.ts is not typechecked

- **Type:** debt · **Found:** 2026-11-19 · **Verified:** 2026-11-19 @ wave 2 review
- **Where:** include in frontend/tsconfig.node.json
- **Problem:** Only vite.config.ts is in the node tsconfig, so vitest.config.ts is covered by neither config.
- **Why deferred / fix direction:** Vitest fails at load on a broken config anyway. Fix: add vitest.config.ts to the include.
- **Source:** phase review of `docs/archive/plans/typecheck-and-test-hygiene.md`

## Open — Dev env & ops

### ISS-166 · P3 · Dev backend tsx watch sometimes misses file edits

- **Type:** watch · **Found:** 2026-08-15 · **Verified:** 2026-11-18 @ `6dd7592`
- **Where:** dev script in backend/package.json (line 8)
- **Problem:** The tsx watch process occasionally keeps serving stale code after an edit on the dev stack.
- **Why deferred / fix direction:** Run `docker compose restart backend`; investigate only if it recurs often.
- **Source:** snapshot line 1591, section "Pipeline native port — accepted risks & deferred items (2026-08-15)"; merged duplicates at snapshot lines 2337

### ISS-167 · P3 · npm audit fix crashes on the host with an arborist error

- **Type:** watch · **Found:** 2026-10-25 · **Verified:** 2026-11-18 @ `6dd7592`
- **Where:** host npm 10.9.4 arborist #loadPeerSet
- **Problem:** npm audit fix fails with 'Cannot read properties of null (reading edgesOut)'. Targeted npm update with --package-lock-only works.
- **Why deferred / fix direction:** Trigger: npm upgrade. Use targeted npm update inside the container meanwhile.
- **Source:** snapshot line 2425, section "Dependency advisories — remaining (2026-10-25)"

### ISS-168 · P3 · version.test.ts fails in the dev container because VERSION is not mounted

- **Type:** watch · **Found:** 2026-11-02 · **Verified:** 2026-11-18 @ `6dd7592`
- **Where:** readFileSync of VERSION in frontend/src/lib/version.test.ts (line ~11)
- **Problem:** The dev compose mounts only frontend/, so the repo VERSION file is missing and the test fails with ENOENT. It passes in CI.
- **Why deferred / fix direction:** Trigger: dev container mounts change. Or skip the check when the file is absent.
- **Source:** snapshot line 2446, section "Design compliance fixes — deferred findings (2026-11-02)"

### ISS-184 · P3 · solvro config cannot set the new iTop variables

- **Type:** debt · **Found:** 2026-11-19 · **Verified:** 2026-11-19 @ wave 2 review
- **Where:** CONFIG_KEYS / config_effective in setup.sh (line ~513)
- **Problem:** ITOP_ALLOW_PRIVATE_HOSTS and ITOP_SYNC_DISABLED can be set only by editing ~/solvro/.env by hand.
- **Why deferred / fix direction:** Hand-editing .env works and is documented. Fix: add both to CONFIG_KEYS with a true/false validator.
- **Source:** phase review of `docs/archive/plans/setup-and-nginx.md`

## Open — Docs & process

### ISS-169 · P3 · Re-pulling vendored ReUI files overwrites SOLVRO PATCH edits

- **Type:** watch · **Found:** 2026-07-25 · **Verified:** 2026-11-18 @ `6dd7592`
- **Where:** SOLVRO PATCH markers across frontend/src/components/reui and ui
- **Problem:** Running shadcn add or a registry pull on a vendored file overwrites hand edits and their markers.
- **Why deferred / fix direction:** Rule: diff before any re-pull and re-apply every marker. Revisit only if a re-pull is planned.
- **Source:** snapshot line 548, section "Plan B Task 9 deferred findings — ReUI Gantt swap (2026-07-25)"

### ISS-170 · P3 · DESIGN.md says theme_default dark but the code defaults to system

- **Type:** bug · **Found:** 2026-07-25 · **Verified:** 2026-11-18 @ `6dd7592`
- **Where:** theme_default in docs/DESIGN.md (line 3) vs default in frontend/src/lib/theme.tsx (line ~27)
- **Problem:** The design doc frontmatter names dark as the default theme; the app uses the system preference. The user chose to keep system.
- **Why deferred / fix direction:** Correct the frontmatter to system in a docs-only change.
- **Source:** snapshot line 563, section "Login/Sidebar always-dark-pin fix — deferred findings (2026-07-25)"

### ISS-171 · P3 · Vendored autocomplete header, hash and override gaps

- **Type:** debt · **Found:** 2026-07-27 · **Verified:** 2026-11-18 @ `6dd7592`
- **Where:** frontend/src/components/reui/autocomplete.tsx (header lines 1-8); AutocompleteInput className in frontend/src/components/CommandPalette.tsx (line ~299)
- **Problem:** The header does not state a marker count, no registry hash is stored for any vendored engine, and the palette input overrides base styling with nothing guarding it.
- **Why deferred / fix direction:** Record exact counts and hashes in vendor headers; add a computed-style or class snapshot test.
- **Source:** snapshot line 685, section "Global search & ⌘K command palette — deferred findings (2026-07-27)"

### ISS-172 · P3 · index.css comment about chip-violet is out of date

- **Type:** debt · **Found:** 2026-09-02 · **Verified:** 2026-11-18 @ `6dd7592`
- **Where:** comment above the Alert tone tokens in frontend/src/index.css (line ~157)
- **Problem:** The comment says chip-violet has no meaning assigned elsewhere, but Alert info and Critical Path both use it.
- **Why deferred / fix direction:** Reword the comment in the next index.css edit.
- **Source:** snapshot line 1807, section "Critical Path mark — deferred findings (2026-09-02)"

## Closed

Entries closed during the 2026-11-18 restructure are in the ledger in `docs/archive/plans/issues-restructure.md`, not here.

- ISS-003 · 2026-11-19 · CHANGELOG "Task ordering, date and epic-owner checks" · Epic owner can be a user with no access to the project
- ISS-005 · 2026-11-18 · CHANGELOG "iTop hardening: log redaction, address token check, Refresh, services scope" · Saving an iTop address does not require the application token
- ISS-007 · 2026-11-19 · CHANGELOG "Label permissions and duplicate label names" · Label creation needs project:write while label edit needs task:write
- ISS-009 · 2026-11-18 · CHANGELOG "iTop hardening: log redaction, address token check, Refresh, services scope" · Shared pino logger has no redact paths for iTop tokens
- ISS-027 · 2026-11-19 · CHANGELOG "Task ordering, date and epic-owner checks" · Deleting a task leaves sparse positions in its sibling list
- ISS-028 · 2026-11-19 · CHANGELOG "Task ordering, date and epic-owner checks" · PATCH /tasks/:id accepts a due date before the start date
- ISS-036 · 2026-11-19 · CHANGELOG "Task ordering, date and epic-owner checks" · Section and epic delete can deadlock with a concurrent task reorder
- ISS-037 · 2026-11-19 · CHANGELOG "Task form, task panel and section permissions" · Create-task parent picker lists subtasks the server rejects
- ISS-041 · 2026-11-19 · CHANGELOG "Label permissions and duplicate label names" · Duplicate label name shows 'Unique constraint violated'
- ISS-046 · 2026-11-19 · CHANGELOG "Task form, task panel and section permissions" · Subtask DONE checkbox in the task modal ignores canEdit
- ISS-059 · 2026-11-19 · CHANGELOG "Task form, task panel and section permissions" · TaskPanel header-menu errors appear below the subtasks list
- ISS-061 · 2026-11-19 · CHANGELOG "Task form, task panel and section permissions" · Section header actions show for task:write but the routes need project:write
- ISS-064 · 2026-11-18 · CHANGELOG "iTop hardening: log redaction, address token check, Refresh, services scope" · CustomerDetail ignores itopOrgId/itopOrgName the API already returns
- ISS-065 · 2026-11-18 · accepted by the user: the offset stays out of the query key on purpose (comment in `queries.ts`) · useItopTicket weekly hours can be stale after a timezone change
- ISS-066 · 2026-11-19 · CHANGELOG "Task form, task panel and section permissions" · TaskPanel spins forever when the project-tasks fetch fails
- ISS-075 · 2026-11-18 · CHANGELOG "iTop hardening: log redaction, address token check, Refresh, services scope" · Utilization Refresh failure shows no error
- ISS-082 · 2026-11-19 · CHANGELOG "Keyboard focus and contrast fixes" · InstallBanner nests a role=button span inside a button
- ISS-090 · 2026-11-19 · CHANGELOG "Keyboard focus and contrast fixes" · ConfirmModal warning tone uses raw bg-amber-500 instead of the chip-amber pair
- ISS-092 · 2026-11-19 · CHANGELOG "Keyboard focus and contrast fixes" · Dialog focus trap lets Tab escape from a tabIndex=-1 element
- ISS-093 · 2026-11-19 · CHANGELOG "Keyboard focus and contrast fixes" · usePanelFocus returns focus to the previous task's opener
- ISS-094 · 2026-11-19 · CHANGELOG "Keyboard focus and contrast fixes" · Task statuses primary button has a weak keyboard focus cue
- ISS-115 · 2026-11-18 · CHANGELOG "iTop hardening: log redaction, address token check, Refresh, services scope" · GET /itop/services lists every iTop organisation's services to any signed-in user
- ISS-119 · 2026-11-18 · accepted by the user: iTop limits what Solvro can read; no code change · iTop personal-token expiry is only read when iTop allows it
- ISS-120 · 2026-11-18 · accepted by the user: iTop cannot report token rights up front · iTop token write rights are not checked when the token is saved
- ISS-124 · 2026-11-18 · accepted by the user: the user sees iTop's own refusal text · pending_reason assumed free text; a list-valued install refuses it
- ISS-128 · 2026-11-18 · CHANGELOG "iTop hardening: log redaction, address token check, Refresh, services scope" · An iTop application token saved before an address is not probed
- ISS-129 · 2026-11-18 · CHANGELOG "iTop hardening: log redaction, address token check, Refresh, services scope" · A Refresh full sync can be dropped silently while a scheduled sync holds the lock
- ISS-135 · 2026-11-18 · decided by the user: customer exports do not show iTop ticket refs · Gantt Excel export omits the pinned iTop ticket
- ISS-136 · 2026-11-19 · CHANGELOG "Wider typechecks and test hygiene" · Typecheck skips vite.config.ts and node tsconfig lists deleted files
- ISS-137 · 2026-11-19 · CHANGELOG "Wider typechecks and test hygiene" · search.spec.ts presses Cmd+K without waiting for the listener
- ISS-139 · 2026-11-19 · CHANGELOG "Wider typechecks and test hygiene" · Backend typecheck gate skips scripts and tests
- ISS-142 · 2026-11-19 · CHANGELOG "Wider typechecks and test hygiene" · Stale comment says the seeded project is per test file
- ISS-148 · 2026-11-19 · CHANGELOG "Wider typechecks and test hygiene" · Search contract tests miss the length cap, ordering and the underscore case
- ISS-152 · 2026-11-19 · CHANGELOG "Wider typechecks and test hygiene" · Two e2e specs keep private copies of createTask
- ISS-163 · 2026-11-19 · CHANGELOG "setup.sh and nginx" · setup.sh does not pass ITOP_ALLOW_PRIVATE_HOSTS or ITOP_SYNC_DISABLED
- ISS-164 · 2026-11-19 · CHANGELOG "setup.sh and nginx" · setup.sh: no registry-login preflight on a fresh install; CORS falls back to `*`
- ISS-165 · 2026-11-19 · CHANGELOG "setup.sh and nginx" · Icons and favicon have no explicit Cache-Control
