# Known Issues

Open issues, sorted by area and then by severity. Each issue has an ID (`ISS-NNN`) that never changes and is never reused. Code comments and plans cite an issue by its ID.

Last full triage: 2026-11-26 @ `f25aac3` (81 open entries checked against the code; none fixed or moot). Previous: 2026-11-24 @ `670f206`. Delta triage 2026-11-27 @ `77280d7`: the 6 entries whose files changed since `f25aac3` were re-checked. The file before the restructure is kept verbatim at `docs/archive/ISSUES-2026-11-18-phase-log.md`; the mapping from every old entry to its ID, or to the reason it closed, is the ledger in `docs/archive/plans/issues-restructure.md`.

## How to use this file

- **Severity.** P1: wrong data, a security or privacy exposure, or a break with no workaround; deferring one needs the user's explicit note. P2: a defect with a workaround, a correctness gap, a missing test on a risky path, or a gap in a gate or process. P3: polish, cosmetic issues, stale comments, hygiene.
- **Type.** `bug` · `debt` · `test-gap` · `watch` (no action until the stated trigger) · `decision` (waits on a user decision; the entry states the question).
- **Areas**, in this order: Security & auth · Data & performance · Backend/API · Frontend UI · Accessibility & tokens · Gantt · Boards & drag · iTop · Exports & sharing · Tests & CI · Dev env & ops · Docs & process.
- **New issue:** the next ID is the highest existing ID plus one. Search for an entry with the same root cause first, and update it instead of adding a second one. Keep the body to six lines or fewer.
- **Closing:** when shipped work fixes or moots an issue (checked against the code, never assumed), delete its body and add one line under `## Closed`: ID, date, commit or CHANGELOG reference, title.
- **Where** names a symbol and a file; the line number is a hint only. **Verified** shows when the location was last checked.

## Open — Security & auth

### ISS-001 · P2 · Token-ownership check still passes admin-profile tokens that can read other users' tokens

- **Type:** watch · **Found:** 2026-09-23 · **Verified:** 2026-11-26 @ `f25aac3`
- **Where:** fallback ownership check (provenByContact / PersonalToken read) in backend/src/routes/itopUser.ts (line ~217-275)
- **Problem:** iTop has no whoami, so a token whose profile reads PersonalToken beyond its own user still passes the check. This is impersonation by a foreign credential, not privilege escalation.
- **Why deferred / fix direction:** Grant PersonalToken read narrowly or add an iTop-side whoami extension; verify on the real install. User decision 2026-11-18: stays open as `watch`, not accepted.
- **Source:** snapshot line 2138, section "iTop integration Phase 5 — deferred findings (2026-09-23)"

### ISS-006 · P3 · Per-email sign-in lockout can be triggered against a colleague

- **Type:** watch · **Found:** 2026-10-22 · **Verified:** 2026-11-26 @ `f25aac3`
- **Where:** createFailureThrottle in backend/src/http/loginThrottle.ts (line ~24)
- **Problem:** Ten wrong passwords for an email block that email's password sign-in for 15 minutes, from any address. The counter table holds 10,000 keys and evicts the oldest.
- **Why deferred / fix direction:** Accepted by user decision 2026-10-22. Revisit if the app is exposed beyond the LAN or the lockout is abused.
- **Source:** snapshot line 16, section "Known bugs / inconsistencies"

### ISS-008 · P3 · Task duplicate needs task:write while task create needs project:write

- **Type:** watch · **Found:** 2026-09-02 · **Verified:** 2026-11-26 @ `f25aac3`
- **Where:** POST /tasks/:id/duplicate in backend/src/routes/tasks.ts (line ~773); POST /projects/:id/tasks in backend/src/routes/projects.ts (line ~675)
- **Problem:** A custom role holding task:write only can duplicate tasks it could not create through the form. This was a deliberate plan decision.
- **Why deferred / fix direction:** Revisit if custom roles start splitting the two permissions.
- **Source:** snapshot line 1863, section "Duplicate tasks, subtasks, and sections — deferred findings (2026-09-02)"

### ISS-224 · P3 · Nothing re-seals stored secrets after a SECRETS_KEY rotation

- **Type:** debt · **Found:** 2026-11-26 · **Verified:** 2026-11-27 @ `77280d7`
- **Where:** open() in backend/src/lib/secretBox.ts (line ~123); rotation steps in docs/CONFIGURATION.md (line ~64)
- **Problem:** A value moves to the new key only when it is written again. Nothing re-seals or counts the values still under `SECRETS_KEY_PREVIOUS` (an idle user's iTop token, an unchanged webhook secret), so the operator cannot know when the previous key can be removed.
- **Why deferred / fix direction:** Rotation is rare, and keeping the previous key set is safe. Add a `backend/scripts/reseal-secrets.ts` that re-seals every `*Enc` column under the current key (or log a count at boot), then document "run it, then remove SECRETS_KEY_PREVIOUS".
- **Source:** instant review of the ISS-011 fix, 2026-11-26

### ISS-012 · P3 · Any customer:write user can set the Outline link of an unowned customer

- **Type:** decision · **Found:** 2026-10-09 · **Verified:** 2026-11-26 @ `f25aac3`
- **Where:** PATCH /customers/:id in backend/src/routes/customers.ts (line ~537, outlineUrl at ~588)
- **Problem:** outlineUrl is set under the same gate as name and description (customer:write plus visibility), so for a customer with no TAM any such user can point its link at any http/https URL.
- **Why deferred / fix direction:** Decision needed (2026-11-19): gating name, description and Outline link on ownership conflicts with the M1 pentest contract (backend/test/pentestRemediation.test.ts: a TAM with a project under the customer may edit its other fields). Choose: gate only outlineUrl on ownership, gate all three and change M1, or accept.
- **Source:** snapshot line 2377, section "Outline links, Phase A — deferred findings (2026-10-09)"

### ISS-013 · P3 · Outline email is not re-checked on token refresh

- **Type:** watch · **Found:** 2026-10-09 · **Verified:** 2026-11-26 @ `f25aac3`
- **Where:** refresh path in backend/src/lib/outline/tokens.ts; callback in backend/src/routes/outline.ts
- **Problem:** A user whose Outline email changes later keeps a working grant under the old match until they reconnect. Re-checking on every refresh would spend the shared per-IP rate budget.
- **Why deferred / fix direction:** Accepted risk; trigger: Outline reports email changes, then re-check at low frequency.
- **Source:** snapshot line 2382, section "Outline B+C — deferred findings (2026-10-09)"

### ISS-015 · P3 · uuid advisory inside exceljs is not reachable

- **Type:** watch · **Found:** 2026-10-25 · **Verified:** 2026-11-26 @ `f25aac3`
- **Where:** uuid inside exceljs, loaded by the Gantt Excel export
- **Problem:** The advisory needs v3/v5/v6 with a caller-supplied buffer; exceljs calls only v4(). npm's suggested downgrade is wrong.
- **Why deferred / fix direction:** Trigger: an exceljs release that bumps uuid. Do not apply npm's suggested downgrade.
- **Source:** snapshot line 2423, section "Dependency advisories — remaining (2026-10-25)"

### ISS-016 · P3 · Webhook replay set and Refresh throttle are per process

- **Type:** watch · **Found:** 2026-10-26 · **Verified:** 2026-11-26 @ `f25aac3`
- **Where:** seen in backend/src/lib/outline/webhookSignature.ts (line ~15); REFRESH_* in backend/src/routes/itop.ts (line ~446)
- **Problem:** Each backend instance keeps its own state, so a captured webhook can be replayed once per instance and the throttle allows one pull per instance.
- **Why deferred / fix direction:** Trigger: running more than one backend instance. Then move both to shared storage.
- **Source:** snapshot line 2429, section "iTop and Outline hardening — deferred findings (2026-10-26)"

### ISS-017 · P3 · Creating a customer with a hidden customer's name answers 409

- **Type:** bug · **Found:** 2026-10-26 · **Verified:** 2026-11-26 @ `f25aac3`
- **Where:** POST / in backend/src/routes/customers.ts (line ~485, conflict at ~531)
- **Problem:** A TAM can learn that a customer name exists by getting 409 instead of 201, even for customers they cannot see.
- **Why deferred / fix direction:** Deferred. Accept as a product trade-off or scope uniqueness by visibility.
- **Source:** snapshot line 2434, section "iTop and Outline hardening — deferred findings (2026-10-26)"

## Open — Data & performance

### ISS-018 · P2 · GET /users returns every user with no pagination

- **Type:** debt · **Found:** 2026-07-27 · **Verified:** 2026-11-26 @ `f25aac3`
- **Where:** usersRouter.get('/') in backend/src/routes/users.ts (line ~14)
- **Problem:** The endpoint lists all users. Pickers render each as an option, which already broke an e2e role query and will not scale.
- **Why deferred / fix direction:** Paginate or add a search filter; the pickers then need a search-as-you-type mode.
- **Source:** snapshot line 594, section "Kanban → ReUI swap — deferred findings (2026-07-27)"

### ISS-019 · P3 · ensureTaskVisible adds a second DB round-trip to task mutations

- **Type:** watch · **Found:** 2026-07-15 · **Verified:** 2026-11-26 @ `f25aac3`
- **Where:** ensureTaskVisible in backend/src/lib/visibility.ts (line ~125)
- **Problem:** Each task mutation first runs a visibility lookup, then the write. The visibility filter cannot be folded into a Prisma update's unique where.
- **Why deferred / fix direction:** Trigger: profiling shows the sub-200ms NFR missed. Then try updateMany with a returned-row check.
- **Source:** snapshot line 347, section "Tech debt / follow-ups from recent work"

### ISS-021 · P3 · Task reorder repack issues one UPDATE per displaced sibling

- **Type:** watch · **Found:** 2026-07-22 · **Verified:** 2026-11-26 @ `f25aac3`
- **Where:** insertAt and closeGap in backend/src/lib/taskOrdering.ts (line ~62, ~42)
- **Problem:** A reorder updates each displaced sibling in turn, about 200 round-trips on a 200-task project. A calm host measured 0.196s, inside the 200ms NFR; a loaded host measured 0.20-0.47s.
- **Why deferred / fix direction:** Trigger: reorder feels slow in real use. Then batch the repack into one UPDATE ... FROM (VALUES ...).
- **Source:** snapshot line 516, section "Verification debt"

### ISS-022 · P3 · Admin Project Overrides renders every user as an option in every row

- **Type:** watch · **Found:** 2026-08-02 · **Verified:** 2026-11-26 @ `f25aac3`
- **Where:** tamCandidates.map in frontend/src/pages/Admin.tsx (line ~1666)
- **Problem:** Each project row renders a select with one option per active user, and the grid is not paginated. This is fine at small scale and grows with users times projects.
- **Why deferred / fix direction:** Filter or virtualise the candidate list if the user count grows large.
- **Source:** snapshot line 1459, section "Issues Sweep #1 — residuals (2026-08-02)"

### ISS-023 · P3 · GET /notes/recent has no noteDate-leading index

- **Type:** watch · **Found:** 2026-08-31 · **Verified:** 2026-11-26 @ `f25aac3`
- **Where:** GET /notes/recent in backend/src/routes/notes.ts (line ~53); indexes at backend/prisma/schema.prisma (lines 908, 928)
- **Problem:** The route filters both note tables by noteDate alone, so Postgres plans a seq scan plus sort. At current volume this stays in single-digit milliseconds.
- **Why deferred / fix direction:** Add @@index([noteDate]) to both models via a migration when volume warrants it.
- **Source:** snapshot line 1736, section "Daily Review collapse & Recent notes — deferred findings (2026-08-31)"

### ISS-025 · P3 · Project-deletion activity records are never shown or cleaned up

- **Type:** debt · **Found:** 2026-10-26 · **Verified:** 2026-11-26 @ `f25aac3`
- **Where:** tx.customerActivityEvent.createMany in backend/src/routes/projects.ts (line ~609); also tx.customerActivityEvent.create in backend/src/routes/customerTeam.ts (lines ~122, ~162)
- **Problem:** customer_activity_events rows appear nowhere in the UI and the 180-day cleanup skips them. Customer owner changes are only a log line.
- **Update 2026-11-24 (triage):** the customer team routes (backend/src/routes/customerTeam.ts, lines ~122 and ~162) now also write these rows, so the unshown, uncleaned set grows faster.
- **Why deferred / fix direction:** Show them on the customer, add them to the cleanup, and record owner changes.
- **Source:** snapshot line 2438, section "Data integrity, session and query performance — deferred findings (2026-10-26)"

### ISS-026 · P3 · Tasks page offset paging can repeat or skip a row

- **Type:** watch · **Found:** 2026-10-26 · **Verified:** 2026-11-26 @ `f25aac3`
- **Where:** GET /tasks offset in backend/src/routes/tasks.ts (line ~360)
- **Problem:** A concurrent insert or delete can repeat or skip a row across Load more pages. The order itself is stable.
- **Why deferred / fix direction:** Normal offset trade-off. Trigger: user reports. Then use cursor paging.
- **Source:** snapshot line 2440, section "Data integrity, session and query performance — deferred findings (2026-10-26)"

### ISS-175 · P3 · Task delete re-packs siblings with one UPDATE per row

- **Type:** watch · **Found:** 2026-11-19 · **Verified:** 2026-11-26 @ `f25aac3`
- **Where:** closeGap in backend/src/lib/taskOrdering.ts (line ~42), called from DELETE /tasks/:id
- **Problem:** Delete now rewrites every remaining sibling, including rows before the gap; the top-level list is every top-level task in the project.
- **Why deferred / fix direction:** Trigger: a delete above the 200 ms target. Fix: one set-based UPDATE, or shift only rows after the deleted one.
- **Source:** phase review of `docs/archive/plans/task-integrity.md`

## Open — Backend/API

### ISS-029 · P3 · Inactive users can still be set as TAM, assignee or epic owner

- **Type:** decision · **Found:** 2026-10-23 · **Verified:** 2026-11-26 @ `f25aac3`
- **Where:** assertUserExists in backend/src/lib/userRefs.ts (line ~16)
- **Problem:** The create and update paths check that the user exists but not that the user is active. An inactive user can become a TAM, assignee or epic owner.
- **Why deferred / fix direction:** Question: reject inactive users (with which error code) or keep accepting them?.
- **Source:** snapshot line 53, section "Known bugs / inconsistencies"

### ISS-032 · P3 · Daily Review, search and portfolio task selects omit isCriticalPath

- **Type:** watch · **Found:** 2026-09-02 · **Verified:** 2026-11-26 @ `f25aac3`
- **Where:** task selects in backend/src/routes/search.ts, backend/src/lib/portfolio.ts and backend/src/routes/dailyReview.ts
- **Problem:** These queries do not select isCriticalPath, so the mark cannot appear there. None of those surfaces render task flags today.
- **Why deferred / fix direction:** Widen the selects if the mark is ever surfaced there.
- **Source:** snapshot line 1791, section "Critical Path mark — deferred findings (2026-09-02)"

### ISS-034 · P3 · Rate limiter counters are per backend instance

- **Type:** watch · **Found:** 2026-09-30 · **Verified:** 2026-11-27 @ `77280d7`
- **Where:** createRateLimiter in backend/src/http/rateLimit.ts
- **Problem:** Counters live in memory per instance and reset on restart, so the effective limit multiplies with more than one backend instance.
- **Why deferred / fix direction:** Trigger: scaling the backend beyond one instance; then add a shared store.
- **Source:** snapshot line 2352, section "Collaboration & sharing, Phase 6 ("Guest links") — deferred findings (2026-09-30)"; merged duplicates at snapshot lines 2439

### ISS-035 · P3 · Changing an Outline link leaves no activity event

- **Type:** decision · **Found:** 2026-10-09 · **Verified:** 2026-11-26 @ `f25aac3`
- **Where:** PATCH /projects/:id in backend/src/routes/projects.ts (line ~485); customers.ts line ~588
- **Problem:** outlineUrl edits on a project or customer are not recorded, consistent with description edits.
- **Why deferred / fix direction:** Decide whether an audit trail for links is wanted; if yes, add it to the project diff.
- **Source:** snapshot line 2376, section "Outline links, Phase A — deferred findings (2026-10-09)"; merged duplicates at snapshot lines 2383

## Open — Frontend UI

### ISS-039 · P3 · Inactive services can still be assigned to customers and projects

- **Type:** decision · **Found:** 2026-07-15 · **Verified:** 2026-11-26 @ `f25aac3`
- **Where:** ServiceMappingList in frontend/src/components/services/ServiceMappingList.tsx (line ~168-195)
- **Problem:** The mapping picker shows deactivated services dimmed but still toggleable. The project tab's 'Add all subscribed' also carries inactive legacy subscriptions over.
- **Why deferred / fix direction:** Question: should active: false block new assignments?.
- **Source:** snapshot line 342, section "Tech debt / follow-ups from recent work"

### ISS-043 · P3 · Popovers near scroll-area bottoms can clip

- **Type:** watch · **Found:** 2026-07-25 · **Verified:** 2026-11-26 @ `f25aac3`
- **Where:** AssigneeOptions in frontend/src/pages/views/ProjectList.tsx (~1471); column menu in frontend/src/components/kanban-v2/SolvroKanban.tsx (~165); Risks no longer affected
- **Problem:** Absolute-positioned popovers inside the internally scrolling containers can clip at the bottom edge instead of flipping.
- **Why deferred / fix direction:** Trigger: a user reports clipping. Then move the popovers to a portal with flip logic.
- **Source:** snapshot line 544, section "Plan B Task 9 deferred findings — ReUI Gantt swap (2026-07-25)"

### ISS-045 · P3 · Subtask promote and re-parent only exist in the task modal

- **Type:** watch · **Found:** 2026-07-27 · **Verified:** 2026-11-26 @ `f25aac3`
- **Where:** TaskDetail.tsx (panel body, no parent control); Parent field in frontend/src/components/TaskFormModal.tsx (~541)
- **Problem:** Promoting or re-parenting a subtask needs the modal. No Promote shortcut was built after the dogfood window.
- **Why deferred / fix direction:** Trigger: users report the modal round-trip as friction.
- **Source:** snapshot line 613, section "Kanban → ReUI swap — deferred findings (2026-07-27)"

### ISS-050 · P3 · Filter submenu highlight follows the pointer

- **Type:** watch · **Found:** 2026-07-31 · **Verified:** 2026-11-26 @ `f25aac3`
- **Where:** filters submenu onMouseEnter in frontend/src/components/reui/filters.tsx (~1013, ~1498)
- **Problem:** The row under the cursor wins the initial highlight, so a blind Enter can pick an unexpected row.
- **Why deferred / fix direction:** Accepted upstream behaviour; revisit only if keyboard users report it.
- **Source:** snapshot line 1264, section "ReUI Filters phase — deferred findings (2026-07-31)"

### ISS-051 · P3 · Filter toolbar mixes three text sizes

- **Type:** decision · **Found:** 2026-07-31 · **Verified:** 2026-11-26 @ `f25aac3`
- **Where:** migrated filter rows in frontend/src/components/reui/filters.tsx and the filter toolbars
- **Problem:** Chip labels, checkbox rows and the Reset control use 15, 13 and 12px.
- **Why deferred / fix direction:** Question: keep the mixed scale or match the old uniform 12-13px density?.
- **Source:** snapshot line 1288, section "ReUI Filters phase — deferred findings (2026-07-31)"

### ISS-052 · P3 · Data-grid column controls ignore right-aligned headers

- **Type:** watch · **Found:** 2026-08-01 · **Verified:** 2026-11-26 @ `f25aac3`
- **Where:** hasControls branch in frontend/src/components/reui/data-grid/data-grid-column-header.tsx (lines ~440-446)
- **Problem:** The move/pin/visibility branch skips the right-align and centre-align treatments (`alignEnd`, `alignCenter`). No shipped grid reaches it.
- **Why deferred / fix direction:** Trigger: a column pairs hasControls with a `text-right` or `text-center` header. Then apply the same justify treatment.
- **Source:** snapshot line 1333, section "ReUI Data Grid phase — deferred findings (2026-08-01)"

### ISS-054 · P3 · Filter dedupe guard compares values with === (object values would not dedupe)

- **Type:** watch · **Found:** 2026-08-02 · **Verified:** 2026-11-26 @ `f25aac3`
- **Where:** findFilterMatch in frontend/src/components/reui/filters.tsx (line ~2332)
- **Problem:** The duplicate-chip guard uses === to compare filter values. Every current filter field is string-valued, so nothing is affected today.
- **Why deferred / fix direction:** Compare by value if a consumer adds object-valued filter options.
- **Source:** snapshot line 1445, section "Issues Sweep #1 — residuals (2026-08-02)"

### ISS-056 · P3 · Material Symbols glyphs ignore text-[Npx] utilities app-wide

- **Type:** decision · **Found:** 2026-09-02 · **Verified:** 2026-11-26 @ `f25aac3`
- **Where:** `.material-symbols-outlined` rule in frontend/src/index.css (line ~43, deliberately unlayered per its comment; variation settings ~407); overrides in frontend/src/components/CriticalPathMark.tsx (lines 34, 63)
- **Problem:** Google's unlayered font-size: 24px beats Tailwind's layered utilities, so every icon renders 24px. Critical Path works around it with !important.
- **Why deferred / fix direction:** Re-declare the font-size inside a Tailwind layer; it changes every icon, so it needs a user decision.
- **Source:** snapshot line 1759, section "Critical Path mark — deferred findings (2026-09-02)"

### ISS-057 · P3 · CriticalPathMark padding override breaks silently if Chip gains a wrapper

- **Type:** watch · **Found:** 2026-09-02 · **Verified:** 2026-11-26 @ `f25aac3`
- **Where:** [&>span]:px-1.5 in frontend/src/components/CriticalPathMark.tsx (line 56)
- **Problem:** The compact chip reaches into Chip's root span with a child selector. A wrapper element would silently drop the padding.
- **Why deferred / fix direction:** When Chip's markup changes, grep the selector and retarget the new root.
- **Source:** snapshot line 1783, section "Critical Path mark — deferred findings (2026-09-02)"

### ISS-062 · P3 · Duplicate mutations wait on inactive-query invalidations

- **Type:** watch · **Found:** 2026-09-02 · **Verified:** 2026-11-26 @ `f25aac3`
- **Where:** useDuplicateTask (~2605) and useDuplicateSection (~2849) onSuccess in frontend/src/lib/queries.ts
- **Problem:** isPending also waits on inactive queries. The cost is near zero because inactive queries refetch lazily.
- **Why deferred / fix direction:** Await only projectTasks and fire the rest if latency ever shows.
- **Source:** snapshot line 1894, section "Duplicate tasks, subtasks, and sections — deferred findings (2026-09-02)"

### ISS-068 · P3 · /tasks Filters popover briefly pulls focus back after Escape

- **Type:** watch · **Found:** 2026-09-30 · **Verified:** 2026-11-26 @ `f25aac3`
- **Where:** Filters popover on /tasks (vendored filters component)
- **Problem:** After choosing a filter and pressing Escape, the popover's focus manager briefly returns focus to its search input, so a fast user can type into it instead of the task form. Only CI on the production build hit it.
- **Why deferred / fix direction:** Trigger: a user report or a new CI failure; then investigate the vendored component.
- **Source:** snapshot line 2339, section "Collaboration & sharing, Phase 3 ("Conflict warning") — deferred findings (2026-09-30)"

### ISS-069 · P3 · Mention chips fall back to plain text for removed members

- **Type:** watch · **Found:** 2026-09-30 · **Verified:** 2026-11-26 @ `f25aac3`
- **Where:** frontend/src/components/CommentMentions.tsx
- **Problem:** Comments store user ids only, so a mentioned person later removed from the project, or a view-all user, renders as plain @name text instead of a chip.
- **Why deferred / fix direction:** Accepted limitation; revisit only if the server begins returning resolved mention names.
- **Source:** snapshot line 2343, section "Collaboration & sharing, Phase 4 ("Activity and notifications") — deferred findings (2026-09-30)"

### ISS-071 · P3 · Role changes reach the UI up to 30 seconds late

- **Type:** watch · **Found:** 2026-10-09 · **Verified:** 2026-11-26 @ `f25aac3`
- **Where:** REFRESH_THROTTLE_MS in frontend/src/lib/auth.tsx (line ~136)
- **Problem:** The client refreshes /auth/me on focus and after a 403, throttled to once per 30 seconds, so a demoted user may see stale controls; the server already enforces the new role.
- **Why deferred / fix direction:** Accepted: UI-only lag. Revisit only if the throttle becomes a complaint.
- **Source:** snapshot line 2372, section "Internal sync — deferred findings (2026-10-09)"

### ISS-197 · P3 · Admin still has fixed 14px icons

- **Type:** debt · **Found:** 2026-11-19 · **Verified:** 2026-11-26 @ `f25aac3`
- **Where:** text-[14px] icons (~1279, ~1509) in frontend/src/pages/Admin.tsx
- **Problem:** Two icons keep arbitrary sizes. (The uppercase "Needs role" chip was fixed 2026-11-20, CHANGELOG "Polish fixes: Portfolio Today marker, loaders, comment box, maskable icon".)
- **Why deferred / fix direction:** Bound by ISS-056 (how Material Symbols sizes are set app-wide). Fix with the scale classes once ISS-056 is decided.
- **Source:** phase review of `docs/archive/plans/design-cleanup.md`

### ISS-202 · P3 · Kanban cards list every subtask while a label filter is active

- **Type:** decision · **Found:** 2026-11-20 · **Verified:** 2026-11-26 @ `f25aac3`
- **Where:** frontend/src/components/kanban-v2/cards.tsx (subtask checklist)
- **Problem:** A card stays visible when one of its subtasks matches the label filter (the agreed rule), but its subtask checklist still shows the subtasks that do not match.
- **Why deferred / fix direction:** Product question. Fix if wanted: pass the filtered subtasks to the card.
- **Source:** GitHub #89 (`docs/archive/plans/feature-wave-b.md`)

### ISS-211 · P3 · Task page breadcrumb placeholder row has no customer

- **Type:** watch · **Found:** 2026-11-23 · **Verified:** 2026-11-26 @ `f25aac3`
- **Where:** cachedTaskRow in frontend/src/lib/queries.ts (~1277), used as useTask placeholderData (~1314); consumed by frontend/src/pages/TaskPage.tsx (~27)
- **Problem:** While the full task loads, the placeholder row carries `project.customer` as null (unknown), not the real customer. The breadcrumb is the only reader and does not use it.
- **Why deferred / fix direction:** Trigger: a new consumer reads `project.customer` from the row before the fetch lands. Then wait for the fetch or fill it from the project query.

## Open — Accessibility & tokens

### ISS-087 · P3 · IconTile outline variant has no visible fill on the lowest dark surface

- **Type:** watch · **Found:** 2026-07-31 · **Verified:** 2026-11-26 @ `f25aac3`
- **Where:** outline variant in frontend/src/components/reui/icon-tile.tsx (line ~37)
- **Problem:** On a surface equal to the background colour, only the dark:bg-input rule gives the tile a fill.
- **Why deferred / fix direction:** Trigger: reusing the variant on a different surface. Check contrast there first.
- **Source:** snapshot line 1198, section "ReUI Presentation Set — deferred findings (2026-07-31)"

### ISS-088 · P3 · Badge solid tone variants have unusable contrast

- **Type:** watch · **Found:** 2026-08-01 · **Verified:** 2026-11-26 @ `f25aac3`
- **Where:** info, success, warning, destructive variants in frontend/src/components/reui/badge.tsx (lines ~31-52)
- **Problem:** White text on solid tint fills gives about 1.2:1 contrast in dark mode. No component uses these variants and status chips stay on their own pair.
- **Why deferred / fix direction:** Trigger: anyone wires a solid tone variant. Then pick a solid-fill token family first.
- **Source:** snapshot line 1305, section "ReUI Data Grid phase — deferred findings (2026-08-01)"

## Open — Gantt

### ISS-097 · P3 · Narrowing the Gantt pane below 356px clips the fixed columns

- **Type:** watch · **Found:** 2026-07-30 · **Verified:** 2026-11-26 @ `f25aac3`
- **Where:** TREE_FIXED_COLUMNS_WIDTH / name column floor in frontend/src/components/gantt-v2/SolvroGantt.tsx (line ~258)
- **Problem:** Below a 356px pane the name column floors and the fixed columns clip. This only happens when the user drags the splitter that narrow.
- **Why deferred / fix direction:** Accepted, not planned. Revisit only if users report it.
- **Source:** snapshot line 86, section "Known bugs / inconsistencies"

### ISS-099 · P3 · Computed critical path is deferred; only the manual mark exists

- **Type:** decision · **Found:** 2026-08-02 · **Verified:** 2026-11-26 @ `f25aac3`
- **Where:** Task.isCriticalPath in backend/prisma/schema.prisma (line ~627); frontend/src/components/CriticalPathMark.tsx
- **Problem:** The manual Critical Path flag shipped. A path computed from TaskDependency does not exist and is deferred by decision.
- **Why deferred / fix direction:** Question: build a computed path (optionally a 'Suggest from dependencies' action) or leave the manual flag as the only mechanism?.
- **Source:** snapshot line 301, section "Deferred (explicit, by decision)"

### ISS-102 · P3 · Gantt bars each attach their own ResizeObserver

- **Type:** watch · **Found:** 2026-07-25 · **Verified:** 2026-11-26 @ `f25aac3`
- **Where:** ResizeObserver in SolvroBar (frontend/src/components/gantt-v2/SolvroBar.tsx line ~103)
- **Problem:** Each rendered Gantt bar attaches its own ResizeObserver. Fine at current task counts.
- **Why deferred / fix direction:** Trigger: a project rendering low hundreds of bars or a profiler flag. Then share one observer.
- **Source:** snapshot line 546, section "Plan B Task 9 deferred findings — ReUI Gantt swap (2026-07-25)"

### ISS-107 · P3 · Dark-mode Critical Path ring on Gantt bars resembles the selection ring

- **Type:** decision · **Found:** 2026-09-02 · **Verified:** 2026-11-26 @ `f25aac3`
- **Where:** outline-chip-violet-text in frontend/src/components/gantt-v2/SolvroBar.tsx (line ~321)
- **Problem:** In dark mode a marked and selected bar shows two near-identical light rings, so the signals blur together.
- **Why deferred / fix direction:** Choose between the spec token and a fixed violet for the Gantt ring.
- **Source:** snapshot line 1812, section "Critical Path mark — deferred findings (2026-09-02)"

### ISS-108 · P3 · Gantt bar labels may be hard to read over the unfilled hatch

- **Type:** watch · **Found:** 2026-11-02 · **Verified:** 2026-11-26 @ `f25aac3`
- **Where:** labelBackgroundHex in frontend/src/components/gantt-v2/SolvroBar.tsx (line ~278)
- **Problem:** On a partly filled bar the part of the label over the pale hatch may be hard to read. Seen in light mode, not verified in a browser.
- **Why deferred / fix direction:** Trigger: confirm in a browser on a partly filled bar. Then pick the label colour per segment.
- **Source:** snapshot line 2445, section "Design compliance fixes — deferred findings (2026-11-02)"

## Open — Boards & drag

### ISS-110 · P3 · Kanban drop on the preview-swapped card can cancel a one-slot move

- **Type:** watch · **Found:** 2026-07-27 · **Verified:** 2026-11-26 @ `f25aac3`
- **Where:** same-container branch in frontend/src/components/reui/kanban.tsx (lines ~405, ~529)
- **Problem:** handleDragEnd applies arrayMove to already-shuffled preview state, so a drop on the swapped card can undo the move. It needs precise pointer geometry and was never reproduced.
- **Why deferred / fix direction:** Trigger: a user or e2e run reproduces a lost one-slot reorder.
- **Source:** snapshot line 637, section "Kanban → ReUI swap — deferred findings (2026-07-27)"

### ISS-111 · P3 · Subtask drag may flicker back before the reorder commits

- **Type:** watch · **Found:** 2026-07-30 · **Verified:** 2026-11-26 @ `f25aac3`
- **Where:** Sortable onValueChange in frontend/src/components/TaskDetail.tsx (line ~922)
- **Problem:** The list keeps the old order until the optimistic update lands after an await, so a snap-back flash is possible.
- **Why deferred / fix direction:** Trigger: flicker seen in use. Then mirror the local-order pattern from SectionReorderModal.
- **Source:** snapshot line 1097, section "Sortable reorder (sections + subtasks) — deferred findings (2026-07-30)"

### ISS-112 · P3 · Failed section PATCH can leave the reorder modal out of sync

- **Type:** watch · **Found:** 2026-07-30 · **Verified:** 2026-11-26 @ `f25aac3`
- **Where:** useUpdateSection in frontend/src/lib/queries.ts (lines ~2771-2825)
- **Problem:** A rollback after a failed PATCH discards optimistic state of queued mutations, and the modal's local order is only re-seeded on open.
- **Why deferred / fix direction:** Trigger: PATCH /sections/:id fails mid-session in practice. Then re-seed the modal on settle.
- **Source:** snapshot line 1119, section "Sortable reorder (sections + subtasks) — deferred findings (2026-07-30)"

## Open — iTop

### ISS-114 · P2 · iTop TimeSpent duration unit is assumed to be seconds

- **Type:** watch · **Found:** 2026-09-22 · **Verified:** 2026-11-26 @ `f25aac3`
- **Where:** ITOP_TIME_SPENT_DURATION_IN_SECONDS in backend/src/lib/itop/types.ts (line 196)
- **Problem:** Time sync divides TimeSpent.duration by 60 on the assumption that iTop stores seconds. If the install uses minutes, synced durations would be wrong.
- **Why deferred / fix direction:** Check the probe's TimeSpent dump on the real install and flip the constant if needed.
- **Source:** snapshot line 2027, section "iTop integration Phase 3 — deferred findings (2026-09-22)"

### ISS-116 · P2 · TimeSpent ticket_ref attribute is unverified on a real iTop install

- **Type:** watch · **Found:** 2026-09-23 · **Verified:** 2026-11-26 @ `f25aac3`
- **Where:** ITOP_TIME_SPENT_TICKET_REF_FIELD in backend/src/lib/itop/types.ts (line ~182)
- **Problem:** Only the fake iTop enforces ticket_ref; if the real Time Tracking extension ignores it, logged entries land in Utilization without a ticket link and the ticket panel's weekly figure stays at 0.
- **Why deferred / fix direction:** Needs a probe on the real install once the Time Tracking extension is present; the iTop admin must confirm the attribute name and REST writability before go-live.
- **Source:** snapshot line 2285, section "iTop integration Phase 7 — deferred findings (2026-09-23)"

### ISS-117 · P2 · Application token cannot read iTop User, so itopUserId is never set

- **Type:** watch · **Found:** 2026-09-24 · **Verified:** 2026-11-26 @ `f25aac3`
- **Where:** POST /itop/tickets/:id/time guard in backend/src/routes/itop.ts (line ~1469)
- **Problem:** On the tested install neither the application token nor a TAM's token can read the iTop User class, so user matching never sets User.itopUserId and time logging answers 'Your iTop user account is not linked yet'.
- **Why deferred / fix direction:** Once Time Tracking is installed, test whether TimeSpent.user_id can be omitted, or grant the application token a profile that can read User.
- **Source:** snapshot line 2311, section "iTop integration — real-install findings (2026-09-24)"

### ISS-118 · P2 · Re-test Settings > iTop save on the real install before go-live

- **Type:** watch · **Found:** 2026-09-24 · **Verified:** 2026-11-27 @ `77280d7`
- **Where:** ITOP_ALLOW_UNVERIFIED_PERSONAL_TOKENS in backend/src/env.ts (line ~129)
- **Problem:** Personal tokens work only for profiles in the authent-token setting personal_tokens_allowed_profiles; the save may be refused on the real install until the opt-out env var is set.
- **Why deferred / fix direction:** Trigger: go-live on the real install; re-test the save and set the env var if refused.
- **Source:** snapshot line 2314, section "iTop integration — real-install findings (2026-09-24)"

### ISS-121 · P3 · iTop board drag transitions assume the default lifecycle

- **Type:** watch · **Found:** 2026-09-23 · **Verified:** 2026-11-26 @ `f25aac3`
- **Where:** TRANSITIONS in frontend/src/components/itop/board/dropMapper.ts (line 40)
- **Problem:** Custom states or stimuli make the board reject wanted drags or pass drags that iTop then refuses with its own text.
- **Why deferred / fix direction:** Verify against the real install; add per-install config only if it differs.
- **Source:** snapshot line 2182, section "iTop integration Phase 6 — deferred findings (2026-09-23)"

### ISS-122 · P3 · iTop ticket board on phones is untested stacked columns with touch drag

- **Type:** watch · **Found:** 2026-09-23 · **Verified:** 2026-11-26 @ `f25aac3`
- **Where:** KanbanBoard grid in frontend/src/components/itop/board/TicketBoard.tsx (line ~219, ~286)
- **Problem:** Below 768px the five columns stack vertically with drag still wired. Long scrolls and touch precision have not been checked on real devices.
- **Why deferred / fix direction:** Test on a phone before calling it a phone-usable form.
- **Source:** snapshot line 2193, section "iTop integration Phase 6 — deferred findings (2026-09-23)"

### ISS-123 · P3 · Time Tracking extension must be installed before TimeSpent checks

- **Type:** watch · **Found:** 2026-09-24 · **Verified:** 2026-11-26 @ `f25aac3`
- **Where:** syncTimeEntries (TimeSpent sync) in backend/src/lib/itop/sync.ts (line ~616)
- **Problem:** iTop Community does not bundle the Time Tracking extension, so the duration unit and ticket_ref checks cannot run until it is installed from iTop Hub.
- **Why deferred / fix direction:** Trigger: extension installed on the real install; then run the duration and ticket_ref probes.
- **Source:** snapshot line 2315, section "iTop integration — real-install findings (2026-09-24)"

### ISS-125 · P3 · An iTop full sync that always exceeds the run budget never completes

- **Type:** watch · **Found:** 2026-10-25 · **Verified:** 2026-11-26 @ `f25aac3`
- **Where:** RUN_BUDGET_MS in backend/src/lib/itop/sync.ts (line ~89)
- **Problem:** A run that hits the budget records the reason, prunes nothing and leaves lastFullSyncAt unchanged. A very large iTop would re-pull everything every tick.
- **Why deferred / fix direction:** Trigger: logged 'iTop sync completed' ms nearing 25 minutes on a real install. Then add a resumable cursor.
- **Source:** snapshot line 2413, section "Backend concurrency and roles — deferred findings (2026-10-25)"

### ISS-126 · P3 · Older personal iTop tokens are not re-validated

- **Type:** watch · **Found:** 2026-10-25 · **Verified:** 2026-11-26 @ `f25aac3`
- **Where:** validation at save time in backend/src/routes/itopUser.ts
- **Problem:** Tokens saved under the old rule keep working until their owner re-saves them. The user accepted this and it is documented.
- **Why deferred / fix direction:** Trigger: real install shows which profiles can read the classes. Then run a one-off re-validation.
- **Source:** snapshot line 2414, section "Backend concurrency and roles — deferred findings (2026-10-25)"

### ISS-127 · P3 · A budget-cut time-entry pass still counts as a complete full run

- **Type:** watch · **Found:** 2026-10-25 · **Verified:** 2026-11-26 @ `f25aac3`
- **Where:** writeConfigResult call in backend/src/lib/itop/sync.ts (line ~1003)
- **Problem:** The time-entry prune is skipped and waits for the next full run, up to 24 h. Time entries deleted in iTop stay in Solvro until then.
- **Why deferred / fix direction:** Accepted trade-off. Revisit with the resumable-cursor idea.
- **Source:** snapshot line 2415, section "Backend concurrency and roles — deferred findings (2026-10-25)"

## Open — Exports & sharing

### ISS-131 · P2 · Gantt Excel/PDF downloads blocked on the plain-HTTP production host

- **Type:** watch · **Found:** 2026-07-31 · **Verified:** 2026-11-26 @ `f25aac3`
- **Where:** frontend/src/lib/gantt/exportExcel.ts (line ~370-380) and exportPdf.ts (line ~941-958)
- **Problem:** Chromium-family browsers block downloads from an http origin that is not localhost, showing a secure-connection warning. The user can still keep the file from the download item menu.
- **Why deferred / fix direction:** Reach the app at http://localhost:PORT, or serve HTTPS (internal-CA cert declined 2026-07-31). Not fixable in the export format.
- **Source:** snapshot line 125, section "Known bugs / inconsistencies"; merged duplicates at snapshot lines 132, 141, 147

### ISS-134 · P3 · Gantt screen and PDF export differ in progress and rollup bar styling

- **Type:** watch · **Found:** 2026-08-03 · **Verified:** 2026-11-26 @ `f25aac3`
- **Where:** progress overlay and rollup pill in frontend/src/lib/gantt/exportPdf.ts (lines ~707-760)
- **Problem:** The live Gantt hatches the incomplete portion and draws a thin squared rollup, while the PDF still draws a flat overlay and a rounded pill. The in-file comment records this as accepted.
- **Why deferred / fix direction:** Sync the PDF drawing only if customers notice the mismatch.
- **Source:** snapshot line 1478, section "Gantt visual refresh — deferred findings (2026-08-03)"

## Open — Tests & CI

### ISS-204 · P2 · Mobile e2e first runs after a release is merged into main

- **Type:** decision · **Found:** 2026-11-20 · **Verified:** 2026-11-26 @ `f25aac3`
- **Where:** .github/workflows/ci.yml (e2e job `if:` line 239, matrix ~line 245)
- **Problem:** PRs into develop run desktop e2e only, and PRs into main skip e2e (by design, to save Actions minutes, `f469b5a`). Mobile e2e therefore first runs on the push to main after the release merge. A mobile regression then blocks the image publish, but the code is already on main. The 2026-11-20 release (#114) shipped 24 PRs whose mobile e2e had never run.
- **Why deferred / fix direction:** Decision for the user. Options: (a) before merging a release PR, run the full suite on develop by hand (`gh workflow run ci.yml --ref develop`, about 20 minutes) and merge only if green; (b) run desktop and mobile e2e on PRs into main (more minutes per release, none per feature PR); (c) accept the current order.
- **Source:** release PR #114 review, 2026-11-20

### ISS-138 · P2 · Drag e2e specs flake on first attempt and pass on retry

- **Type:** watch · **Found:** 2026-07-28 · **Verified:** 2026-11-27 @ `77280d7`
- **Where:** gantt-parity.spec.ts "(a) drag-move commits new dates and survives reload" (line 233), kanban-dnd.spec.ts "a refused drag shows an error" (line 140), list-dnd.spec.ts "cross-status reorder in one section sticks" (line 94), gantt-row-menu-focus.spec.ts "Add subtask: the new task's title input holds focus" (line 38); mobile: task-filters.spec.ts "label filter" (line 80)
- **Problem:** The 2026-11-27 spec fixes (CHANGELOG "e2e specs that failed on their first attempt") did not stop it: CI run 45921940198 at the merged commit `c90acfa` still reports the four desktop cases flaky, with the same first-attempt errors (Gantt PATCH wait times out, Kanban PATCH never sent, List order unchanged, row grip not focused). In each case the first drag or focus in CI does nothing and the retry works. None fail on the local dev server (:5173), so the cause is likely in the built CI stack (:8080), not in the specs.
- **Why deferred / fix direction:** Capture the first attempt before another fix: set `trace: "retain-on-first-failure"` in e2e/playwright.config.ts and upload e2e/test-results/ from .github/workflows/ci.yml when a run has flaky tests, not only on failure. Then read the trace. One thing to rule out: the PWA service worker, which registers only on the built stack (`registerSW({ immediate: true })` in frontend/src/main.tsx).
- **Source:** snapshot line 896, section "ReUI DateField swap — deferred findings (2026-07-28)"; merged duplicates at snapshot lines 2320

### ISS-145 · P3 · Connector hover-delete e2e test flakes rarely

- **Type:** watch · **Found:** 2026-07-25 · **Verified:** 2026-11-27 @ `77280d7`
- **Where:** test "(c) connector create via dot-drag + delete via hover" in e2e/tests/gantt-parity.spec.ts (line ~318)
- **Problem:** The hover-to-delete-connector assertion occasionally fails on the first attempt and passes on retry. The cause is not isolated.
- **Why deferred / fix direction:** Trigger: it fails in CI more than occasionally. Then run a flake-hunt pass.
- **Source:** snapshot line 545, section "Plan B Task 9 deferred findings — ReUI Gantt swap (2026-07-25)"

### ISS-150 · P3 · Duplicate-chip e2e spec cannot reproduce the upstream race

- **Type:** watch · **Found:** 2026-08-02 · **Verified:** 2026-11-26 @ `f25aac3`
- **Where:** e2e/tests/filters-duplicate-chip.spec.ts; frontend/src/components/reui/filters.test.ts
- **Problem:** The spec proves at most one chip per field but not the upstream double-fire. The unit test covers the guard logic.
- **Why deferred / fix direction:** Trigger: the upstream Base UI double-fire becomes reproducible. Then add a discriminating spec.
- **Source:** snapshot line 1436, section "Issues Sweep #1 — residuals (2026-08-02)"

### ISS-151 · P3 · filters.test.ts depends on a patch export a vendor re-pull would delete

- **Type:** watch · **Found:** 2026-08-02 · **Verified:** 2026-11-26 @ `f25aac3`
- **Where:** findFilterMatch import in frontend/src/components/reui/filters.test.ts
- **Problem:** The test imports findFilterMatch, a SOLVRO PATCH export. A re-pull of filters.tsx would drop it and break the import; only the patch-count gate catches that, with no check for the test file itself.
- **Why deferred / fix direction:** Keep the patch-count gate; revisit if the vendor is re-pulled.
- **Source:** snapshot line 1451, section "Issues Sweep #1 — residuals (2026-08-02)"

### ISS-154 · P3 · Three e2e specs flaked once and passed on retry

- **Type:** watch · **Found:** 2026-09-02 · **Verified:** 2026-11-27 @ `77280d7`
- **Where:** gantt-parity.spec.ts connector-hover test (now "(c)", line ~318) and two tests in e2e/tests/kanban-dnd.spec.ts
- **Problem:** A hover-to-reveal timing test and two shared-seed order tests failed once and retried clean. None are regressions.
- **Why deferred / fix direction:** Tighten the wait condition or fixture isolation if one fails repeatedly.
- **Source:** snapshot line 1772, section "Critical Path mark — deferred findings (2026-09-02)"

### ISS-155 · P3 · auth.spec 'admin page right after sign-in' flakes on mobile project

- **Type:** watch · **Found:** 2026-09-29 · **Verified:** 2026-11-26 @ `f25aac3`
- **Where:** e2e/tests/auth.spec.ts (line ~81)
- **Problem:** The test failed about 1 run in 2 on the mobile project: after sign-in, goto('/admin') landed on the sign-in page. A later sign-in race fix (frontend/src/lib/auth.tsx) matches the symptom but is not confirmed as the cause.
- **Why deferred / fix direction:** Trigger: strike it if the flake stays gone across several CI runs; otherwise investigate.
- **Source:** snapshot line 2328, section "Collaboration & sharing, Phase 1 ("Quick wins") — deferred findings (2026-09-29)"

### ISS-158 · P3 · Weekly Sync e2e test times out on a database with hundreds of customers

- **Type:** watch · **Found:** 2026-10-26 · **Verified:** 2026-11-26 @ `f25aac3`
- **Where:** groupContainingRow in e2e/tests/weekly-sync.spec.ts (line ~72)
- **Problem:** The helper walks every customer block with two awaits each. With about 500 customers it exceeds the 5 s poll on the mobile project.
- **Why deferred / fix direction:** Trigger: a long-lived dev database. Fix with a locator that does not walk the blocks.
- **Source:** snapshot line 2400, section "Frontend usability — deferred findings (2026-10-26)"

### ISS-159 · P3 · Mobile smoke overflow check reported Kanban 453px too wide once

- **Type:** watch · **Found:** 2026-10-24 · **Verified:** 2026-11-26 @ `f25aac3`
- **Where:** no horizontal overflow test in e2e/tests/smoke.spec.ts (line ~25)
- **Problem:** The check failed once in a full local run against vite preview and passed 34/34 on reruns. Cause unknown.
- **Why deferred / fix direction:** Trigger: recurrence. Capture the overflowing element before retrying.
- **Source:** snapshot line 2407, section "Code splitting — deferred findings (2026-10-24)"

### ISS-160 · P3 · CI npm audit step is report-only, not a gate

- **Type:** watch · **Found:** 2026-10-25 · **Verified:** 2026-11-26 @ `f25aac3`
- **Where:** npm audit step in .github/workflows/ci.yml (line ~147)
- **Problem:** The audit still runs with `continue-on-error` and never fails CI. The zod 4 upgrade (#162) cleared its blocker: `npm audit --omit=dev --audit-level=high` now reports 0 vulnerabilities for backend and no high ones for frontend (2 moderate: uuid via exceljs). The comment above the step still says "after the zod 4 upgrade".
- **Why deferred / fix direction:** Trigger fired. Drop `continue-on-error` (and update the comment) once the user agrees; the moderate exceljs advisory stays below the gate.
- **Source:** snapshot line 2424, section "Dependency advisories — remaining (2026-10-25)"

### ISS-161 · P3 · Trigram index test forces the plan instead of proving it is chosen

- **Type:** test-gap · **Found:** 2026-10-26 · **Verified:** 2026-11-26 @ `f25aac3`
- **Where:** indexUsage test in backend/test/indexUsage.test.ts (line ~28)
- **Problem:** The test turns off sequential scans, so it shows the indexes can serve the queries but not that the planner picks them at current sizes.
- **Why deferred / fix direction:** Re-test with realistic row counts when tables grow.
- **Source:** snapshot line 2441, section "Data integrity, session and query performance — deferred findings (2026-10-26)"

### ISS-216 · P3 · Task statuses concurrent_update test got 401 once in a full-suite run

- **Type:** watch · **Found:** 2026-11-23 · **Verified:** 2026-11-26 @ `f25aac3`
- **Where:** backend/test/taskStatuses.test.ts (line ~520)
- **Problem:** It answered 401 instead of 200 once in a full backend suite run (2026-11-23) and passed 2 of 2 alone.
- **Why deferred / fix direction:** Investigate token and session timing under suite load; trigger: recurrence.
- **Source:** task-attachments phase review (GitHub #137)

### ISS-219 · P3 · Mobile smoke overflow check fails on its first attempt in a full local run

- **Type:** watch · **Found:** 2026-11-24 · **Verified:** 2026-11-26 @ `f25aac3`
- **Where:** "no horizontal overflow on key pages" in e2e/tests/smoke.spec.ts (mobile project), on the project Kanban page
- **Problem:** In 2 full local runs of both projects, the check found the Kanban page 453px wider than the viewport. The overflow stayed for the whole 5s poll, then the retry passed. Alone, or after list-bulk-edit, it passed 6 runs out of 6. The cause is unknown; another spec file's leftover workspace state (statuses or labels) is the first suspect.
- **Why deferred / fix direction:** Trigger: it fails in the mobile CI shards after a release merge, or through its retry. Then log the widest element when the check fails, and find which earlier spec leaves the state.
- **Source:** gates.sh runs on chore/e2e-condition-waits, 2026-11-24

### ISS-222 · P3 · taskOrdering backend test can answer 409 under CI load

- **Type:** flake · **Found:** 2026-11-25 · **Verified:** 2026-11-26 @ `f25aac3`
- **Where:** backend/test/taskOrdering.test.ts, CI job `backend-tests`
- **Problem:** One CI run on the webhooks Phase 1 PR failed with a 409 after about 9 seconds in a task-ordering test; the rerun passed. The webhook tests added database load in the same run, which may lengthen lock waits past a transaction timeout.
- **Why deferred / fix direction:** One occurrence, not reproduced locally. Watch further runs; if it recurs, log the conflicting lock and raise that test's transaction timeout or serialize the webhook suites.
- **Source:** webhooks Phase 1 CI, 2026-11-25

## Open — Dev env & ops

### ISS-166 · P3 · Dev backend tsx watch sometimes misses file edits

- **Type:** watch · **Found:** 2026-08-15 · **Verified:** 2026-11-27 @ `b32458b`
- **Where:** dev script in backend/package.json (line 8)
- **Problem:** The tsx watch process occasionally keeps serving stale code after an edit on the dev stack. Recurred 2026-11-27: after a checkout switched branches and back, the new `PATCH`/`DELETE /tasks/:id/comments/:commentId` routes answered 404 until a restart.
- **Why deferred / fix direction:** Run `docker compose restart backend` (e2e/CLAUDE.md says so before specs that use a new route); investigate if it keeps recurring.
- **Source:** snapshot line 1591, section "Pipeline native port — accepted risks & deferred items (2026-08-15)"; merged duplicates at snapshot lines 2337

### ISS-167 · P3 · npm audit fix crashes on the host with an arborist error

- **Type:** watch · **Found:** 2026-10-25 · **Verified:** 2026-11-26 @ `f25aac3`
- **Where:** host npm 10.9.4 arborist #loadPeerSet
- **Problem:** npm audit fix fails with 'Cannot read properties of null (reading edgesOut)'. Targeted npm update with --package-lock-only works.
- **Why deferred / fix direction:** Trigger: npm upgrade. Use targeted npm update inside the container meanwhile.
- **Source:** snapshot line 2425, section "Dependency advisories — remaining (2026-10-25)"

### ISS-225 · P3 · Local smoke fails on the Vite dev server: Kanban after Overview runs out of request slots

- **Type:** bug · **Found:** 2026-11-27 · **Verified:** 2026-11-27 @ `b32458b`
- **Where:** e2e/tests/smoke.spec.ts "no console/page errors while navigating the app" (line 48), against BASE_URL=http://localhost:5173
- **Problem:** Going from /overview to a project's Kanban fails in Chromium with `net::ERR_INSUFFICIENT_RESOURCES` on several module requests, then "Failed to fetch dynamically imported module ProjectDetail.tsx", so the route shows "This page could not be shown". It fails the same way on develop, with tracing on or off and after clearing `node_modules/.vite`. A direct load of the Kanban works. The built stack (CI) is not affected.
- **Why deferred / fix direction:** Dev-server only; `gates.sh` smoke then fails locally. Find which module graph the Overview leaves in flight (about 480 requests), and try `server.warmup` or fewer dynamic imports on that route.
- **Source:** #169 phase gates, 2026-11-27

## Open — Docs & process

### ISS-169 · P3 · Re-pulling vendored ReUI files overwrites SOLVRO PATCH edits

- **Type:** watch · **Found:** 2026-07-25 · **Verified:** 2026-11-26 @ `f25aac3`
- **Where:** SOLVRO PATCH markers across frontend/src/components/reui and ui
- **Problem:** Running shadcn add or a registry pull on a vendored file overwrites hand edits and their markers.
- **Why deferred / fix direction:** Rule: diff before any re-pull and re-apply every marker. Revisit only if a re-pull is planned.
- **Source:** snapshot line 548, section "Plan B Task 9 deferred findings — ReUI Gantt swap (2026-07-25)"

## Closed

Entries closed during the 2026-11-18 restructure are in the ledger in `docs/archive/plans/issues-restructure.md`, not here.

- ISS-003 · 2026-11-19 · CHANGELOG "Task ordering, date and epic-owner checks" · Epic owner can be a user with no access to the project
- ISS-005 · 2026-11-18 · CHANGELOG "iTop hardening: log redaction, address token check, Refresh, services scope" · Saving an iTop address does not require the application token
- ISS-007 · 2026-11-19 · CHANGELOG "Label permissions and duplicate label names" · Label creation needs project:write while label edit needs task:write
- ISS-009 · 2026-11-18 · CHANGELOG "iTop hardening: log redaction, address token check, Refresh, services scope" · Shared pino logger has no redact paths for iTop tokens
- ISS-024 · 2026-11-20 · CHANGELOG "Inactive users in pickers, service-save refetches, project tab preload" · A project tab chunk starts loading only after the project data arrives
- ISS-027 · 2026-11-19 · CHANGELOG "Task ordering, date and epic-owner checks" · Deleting a task leaves sparse positions in its sibling list
- ISS-028 · 2026-11-19 · CHANGELOG "Task ordering, date and epic-owner checks" · PATCH /tasks/:id accepts a due date before the start date
- ISS-030 · 2026-11-19 · CHANGELOG "Guest link address, deadlocks and plain conflict messages" · NUL-byte (22021) errors return 400 without a log line
- ISS-033 · 2026-11-20 · CHANGELOG "Backend hardening: CORS header, secret tags, iTop webhook and sync retries, `solvro config`" · CORS does not expose X-Total-Count
- ISS-036 · 2026-11-19 · CHANGELOG "Task ordering, date and epic-owner checks" · Section and epic delete can deadlock with a concurrent task reorder
- ISS-037 · 2026-11-19 · CHANGELOG "Task form, task panel and section permissions" · Create-task parent picker lists subtasks the server rejects
- ISS-038 · 2026-11-19 · CHANGELOG "Service lists, Daily Review refresh, request timeouts, section chip" · Service-mapping mutations are not optimistic
- ISS-040 · 2026-11-19 · CHANGELOG "Chip contrast…", "Overview, Portfolio…" or "Type scale…" (design cleanup) · Uncustomized sections show slate outside the Gantt
- ISS-041 · 2026-11-19 · CHANGELOG "Label permissions and duplicate label names" · Duplicate label name shows 'Unique constraint violated'
- ISS-042 · 2026-11-20 · CHANGELOG "Polish fixes: Portfolio Today marker, loaders, comment box, maskable icon" · Comment composer is a single-line input
- ISS-044 · 2026-11-20 · CHANGELOG "Polish fixes: Portfolio Today marker, loaders, comment box, maskable icon" · PWA manifest declares only a 512px maskable icon
- ISS-046 · 2026-11-19 · CHANGELOG "Task form, task panel and section permissions" · Subtask DONE checkbox in the task modal ignores canEdit
- ISS-047 · 2026-11-19 · CHANGELOG "Chip contrast…", "Overview, Portfolio…" or "Type scale…" (design cleanup) · Command palette has dead classes and a hardcoded Mac shortcut glyph
- ISS-049 · 2026-11-19 · CHANGELOG "Panels, forms and board accessibility" · SectionReorderModal relies on its caller for the permission gate
- ISS-055 · 2026-11-19 · CHANGELOG "Chip contrast…", "Overview, Portfolio…" or "Type scale…" (design cleanup) · ProjectRisks probability and impact cells use hand-rolled selects
- ISS-058 · 2026-11-19 · CHANGELOG "Chip contrast…", "Overview, Portfolio…" or "Type scale…" (design cleanup) · Tasks grid and kanban subtask rows show no Critical Path mark
- ISS-059 · 2026-11-19 · CHANGELOG "Task form, task panel and section permissions" · TaskPanel header-menu errors appear below the subtasks list
- ISS-060 · 2026-11-19 · CHANGELOG "Service lists, Daily Review refresh, request timeouts, section chip" · Creating a task leaves Daily Review attention lists stale
- ISS-061 · 2026-11-19 · CHANGELOG "Task form, task panel and section permissions" · Section header actions show for task:write but the routes need project:write
- ISS-063 · 2026-11-19 · CHANGELOG "Chip contrast…", "Overview, Portfolio…" or "Type scale…" (design cleanup) · Sync modals' missing-title error does not point to the card
- ISS-064 · 2026-11-18 · CHANGELOG "iTop hardening: log redaction, address token check, Refresh, services scope" · CustomerDetail ignores itopOrgId/itopOrgName the API already returns
- ISS-065 · 2026-11-18 · accepted by the user: the offset stays out of the query key on purpose (comment in `queries.ts`) · useItopTicket weekly hours can be stale after a timezone change
- ISS-066 · 2026-11-19 · CHANGELOG "Task form, task panel and section permissions" · TaskPanel spins forever when the project-tasks fetch fails
- ISS-067 · 2026-11-19 · CHANGELOG "Service lists, Daily Review refresh, request timeouts, section chip" · A hung task PATCH blocks every later save of that task
- ISS-070 · 2026-11-19 · CHANGELOG "Chip contrast…", "Overview, Portfolio…" or "Type scale…" (design cleanup) (icon spans stay bound by ISS-056) · Arbitrary text-[12px]/[13px] sizes remain in six files
- ISS-072 · 2026-11-19 · CHANGELOG "Chip contrast…", "Overview, Portfolio…" or "Type scale…" (design cleanup) · Active project tab can be off-screen on narrow phones
- ISS-073 · 2026-11-19 · CHANGELOG "Chip contrast…", "Overview, Portfolio…" or "Type scale…" (design cleanup) · Portfolio timeline hides the Today line on phones
- ISS-074 · 2026-11-19 · CHANGELOG "Chip contrast…", "Overview, Portfolio…" or "Type scale…" (design cleanup) · AuthLoading shows plain text instead of a delayed skeleton
- ISS-075 · 2026-11-18 · CHANGELOG "iTop hardening: log redaction, address token check, Refresh, services scope" · Utilization Refresh failure shows no error
- ISS-076 · 2026-11-19 · CHANGELOG "Chip contrast…", "Overview, Portfolio…" or "Type scale…" (design cleanup) · Admin role select shows raw uppercase role values
- ISS-077 · 2026-11-19 · CHANGELOG "Chip contrast…", "Overview, Portfolio…" or "Type scale…" (design cleanup) · Overview and Project Overview loaders are bare pulse blocks
- ISS-078 · 2026-11-19 · CHANGELOG "Keyboard drag on boards and reorder lists" · Keyboard drag does not work on the Kanban board
- ISS-079 · 2026-11-19 · CHANGELOG "Keyboard drag on boards and reorder lists" · Sortable rows are tab stops with role=button and a joined accessible name
- ISS-080 · 2026-11-19 · CHANGELOG "Chip contrast…", "Overview, Portfolio…" or "Type scale…" (design cleanup) (remaining pairs outside the touched chips: ISS-194) · Light primary/10 chip tints still fall under 4.5:1
- ISS-081 · 2026-11-20 · CHANGELOG "Page landmarks and heading order pass the accessibility scan" · Landmark, heading-order and nested-interactive axe gaps remain
- ISS-082 · 2026-11-19 · CHANGELOG "Keyboard focus and contrast fixes" · InstallBanner nests a role=button span inside a button
- ISS-083 · 2026-11-19 · CHANGELOG "Chip contrast…", "Overview, Portfolio…" or "Type scale…" (design cleanup) · Sidebar nav text uses slate greys instead of the warm design grey
- ISS-085 · 2026-11-19 · CHANGELOG "Chip contrast…", "Overview, Portfolio…" or "Type scale…" (design cleanup) · Overview project id uses raw font-mono instead of a type token
- ISS-086 · 2026-11-19 · CHANGELOG "Chip contrast…", "Overview, Portfolio…" or "Type scale…" (design cleanup) · PortfolioCalendar uses rounded-full bars and raw font-mono
- ISS-089 · 2026-11-19 · CHANGELOG "Chip contrast…", "Overview, Portfolio…" or "Type scale…" (design cleanup) · Gantt drag clone uses raw shadow-lg outside the elevation whitelist
- ISS-090 · 2026-11-19 · CHANGELOG "Keyboard focus and contrast fixes" · ConfirmModal warning tone uses raw bg-amber-500 instead of the chip-amber pair
- ISS-091 · 2026-11-20 · CHANGELOG "Keyboard focus treatment and primary-tint contrast" · Older focus:border-primary pattern persists at about 70 sites
- ISS-092 · 2026-11-19 · CHANGELOG "Keyboard focus and contrast fixes" · Dialog focus trap lets Tab escape from a tabIndex=-1 element
- ISS-093 · 2026-11-19 · CHANGELOG "Keyboard focus and contrast fixes" · usePanelFocus returns focus to the previous task's opener
- ISS-094 · 2026-11-19 · CHANGELOG "Keyboard focus and contrast fixes" · Task statuses primary button has a weak keyboard focus cue
- ISS-095 · 2026-11-19 · CHANGELOG "Gantt errors, Dates cell and section permissions" · Gantt save errors can be swallowed when a later update follows
- ISS-096 · 2026-11-20 · CHANGELOG "Gantt connect-drag Escape, narrow tree pane, milestone arrows" · Narrow viewports can clip the Gantt Dates and color columns
- ISS-098 · 2026-11-20 · CHANGELOG "Gantt connect-drag Escape, narrow tree pane, milestone arrows" · Gantt splitter drag fires width change only on release
- ISS-100 · 2026-11-20 · CHANGELOG "Gantt connect-drag Escape, narrow tree pane, milestone arrows" · legendEntries sorts sections twice
- ISS-101 · 2026-11-20 · CHANGELOG "Gantt connect-drag Escape, narrow tree pane, milestone arrows" · Milestone dependency arrows end at the day-box edge, not the diamond
- ISS-105 · 2026-11-19 · CHANGELOG "Chip contrast…", "Overview, Portfolio…" or "Type scale…" (design cleanup) (shadow aligned; component still unused) · GanttDatePicker is unmounted and uses shadow-md
- ISS-106 · 2026-11-19 · CHANGELOG "Gantt errors, Dates cell and section permissions" · Gantt Dates cell shows the date range twice while editing
- ISS-109 · 2026-11-19 · CHANGELOG "Service lists, Daily Review refresh, request timeouts, section chip" · Task panel shows the old section chip during a cross-section drag
- ISS-113 · 2026-11-19 · CHANGELOG "Panels, forms and board accessibility" · Section reorder modal can get stuck if a drag never ends
- ISS-115 · 2026-11-18 · CHANGELOG "iTop hardening: log redaction, address token check, Refresh, services scope" · GET /itop/services lists every iTop organisation's services to any signed-in user
- ISS-119 · 2026-11-18 · accepted by the user: iTop limits what Solvro can read; no code change · iTop personal-token expiry is only read when iTop allows it
- ISS-120 · 2026-11-18 · accepted by the user: iTop cannot report token rights up front · iTop token write rights are not checked when the token is saved
- ISS-124 · 2026-11-18 · accepted by the user: the user sees iTop's own refusal text · pending_reason assumed free text; a list-valued install refuses it
- ISS-128 · 2026-11-18 · CHANGELOG "iTop hardening: log redaction, address token check, Refresh, services scope" · An iTop application token saved before an address is not probed
- ISS-129 · 2026-11-18 · CHANGELOG "iTop hardening: log redaction, address token check, Refresh, services scope" · A Refresh full sync can be dropped silently while a scheduled sync holds the lock
- ISS-130 · 2026-11-19 · CHANGELOG "Panels, forms and board accessibility" · iTop ticket panel shows '– ago' when lastUpdate is null
- ISS-132 · 2026-11-19 · CHANGELOG "Guest link address, deadlocks and plain conflict messages" · Guest links are built from the owner's browser address
- ISS-133 · 2026-11-20 · CHANGELOG "Gantt connect-drag Escape, narrow tree pane, milestone arrows" · Excel export revokes its blob URL right after the click
- ISS-135 · 2026-11-18 · decided by the user: customer exports do not show iTop ticket refs · Gantt Excel export omits the pinned iTop ticket
- ISS-136 · 2026-11-19 · CHANGELOG "Wider typechecks and test hygiene" · Typecheck skips vite.config.ts and node tsconfig lists deleted files
- ISS-137 · 2026-11-19 · CHANGELOG "Wider typechecks and test hygiene" · search.spec.ts presses Cmd+K without waiting for the listener
- ISS-139 · 2026-11-19 · CHANGELOG "Wider typechecks and test hygiene" · Backend typecheck gate skips scripts and tests
- ISS-140 · 2026-11-20 · CHANGELOG "Test and tooling fixes" · gates.sh runs only the smoke e2e spec
- ISS-142 · 2026-11-19 · CHANGELOG "Wider typechecks and test hygiene" · Stale comment says the seeded project is per test file
- ISS-144 · 2026-11-20 · CHANGELOG "Test and tooling fixes" · No e2e test that the Gantt colorBy choice survives a reload
- ISS-147 · 2026-11-20 · CHANGELOG "Test and tooling fixes" · No test guards the Login and sidebar always-dark pin
- ISS-148 · 2026-11-19 · CHANGELOG "Wider typechecks and test hygiene" · Search contract tests miss the length cap, ordering and the underscore case
- ISS-149 · 2026-11-20 · CHANGELOG "Test and tooling fixes" · No e2e drag test for section reorder or subtask drag
- ISS-152 · 2026-11-19 · CHANGELOG "Wider typechecks and test hygiene" · Two e2e specs keep private copies of createTask
- ISS-153 · 2026-11-20 · CHANGELOG "Test and tooling fixes" · daily-review e2e spec leaves junk rows in the shared dev DB each run
- ISS-156 · 2026-11-20 · CHANGELOG "Test and tooling fixes" · taskOrdering cross-project test flakes in the parallel run
- ISS-157 · 2026-11-20 · CHANGELOG "Test and tooling fixes" · Concurrency tests for activity and notification recipients are unproven
- ISS-162 · 2026-11-20 · CHANGELOG "Test and tooling fixes" · e2e fails on a dev stack with Google sign-in configured
- ISS-163 · 2026-11-19 · CHANGELOG "setup.sh and nginx" · setup.sh does not pass ITOP_ALLOW_PRIVATE_HOSTS or ITOP_SYNC_DISABLED
- ISS-164 · 2026-11-19 · CHANGELOG "setup.sh and nginx" · setup.sh: no registry-login preflight on a fresh install; CORS falls back to `*`
- ISS-165 · 2026-11-19 · CHANGELOG "setup.sh and nginx" · Icons and favicon have no explicit Cache-Control
- ISS-168 · 2026-11-20 · CHANGELOG "Test and tooling fixes" · version.test.ts fails in the dev container because VERSION is not mounted
- ISS-171 · 2026-11-20 · CHANGELOG "Test and tooling fixes" · Vendored autocomplete header, hash and override gaps
- ISS-172 · 2026-11-20 · CHANGELOG "Test and tooling fixes" · index.css comment about chip-violet is out of date
- ISS-173 · 2026-11-20 · CHANGELOG "Backend hardening: CORS header, secret tags, iTop webhook and sync retries, `solvro config`" · A repeated Refresh resets the iTop full-sync retry cap
- ISS-174 · 2026-11-19 · CHANGELOG "Panels, forms and board accessibility" · Epic owner picker lists users the server now refuses
- ISS-176 · 2026-11-19 · CHANGELOG "Guest link address, deadlocks and plain conflict messages" · Epic delete and admin status save can still deadlock with task writes
- ISS-177 · 2026-11-19 · CHANGELOG "Guest link address, deadlocks and plain conflict messages" · Epic owner check is copied into two routes
- ISS-178 · 2026-11-19 · CHANGELOG "Gantt errors, Dates cell and section permissions" · Gantt section actions show for task:write but the routes need project:write
- ISS-179 · 2026-11-19 · CHANGELOG "Panels, forms and board accessibility" · Edit-mode parent picker lets a task with subtasks pick a parent
- ISS-180 · 2026-11-19 · CHANGELOG "Guest link address, deadlocks and plain conflict messages" · Label names are not trimmed on the server
- ISS-181 · 2026-11-19 · CHANGELOG "Guest link address, deadlocks and plain conflict messages" · Renaming a customer onto an existing name shows "Unique constraint violated"
- ISS-182 · 2026-11-20 · CHANGELOG "Test and tooling fixes" · prisma/seed.ts is outside the backend typecheck
- ISS-183 · 2026-11-20 · CHANGELOG "Test and tooling fixes" · frontend/vitest.config.ts is not typechecked
- ISS-184 · 2026-11-20 · CHANGELOG "Backend hardening: CORS header, secret tags, iTop webhook and sync retries, `solvro config`" · solvro config cannot set the new iTop variables
- ISS-185 · 2026-11-20 · CHANGELOG "Inactive users in pickers, service-save refetches, project tab preload" · Service-list saves still invalidate every project and customer query
- ISS-186 · 2026-11-19 · CHANGELOG "Panels, forms and board accessibility" · Keyboard drag on the boards announces raw ids
- ISS-187 · 2026-11-19 · CHANGELOG "Panels, forms and board accessibility" · Every card grip has the same accessible name
- ISS-188 · 2026-11-19 · CHANGELOG "Panels, forms and board accessibility" · Escape during a keyboard drag also closes an open panel
- ISS-189 · 2026-11-19 · CHANGELOG "Panels, forms and board accessibility" · Gantt section colour and duplicate still swallow errors
- ISS-190 · 2026-11-20 · CHANGELOG "A slow admin status save no longer fails task saves with a 500" · A slow admin status save can make status-setting task saves fail with a 500
- ISS-191 · 2026-11-20 · CHANGELOG "Gantt connect-drag Escape, narrow tree pane, milestone arrows" · Escape during a Gantt dependency-connect drag also closes the task panel
- ISS-192 · 2026-11-20 · CHANGELOG "Inactive users in pickers, service-save refetches, project tab preload" · The epic owner picker lists inactive users
- ISS-194 · 2026-11-20 · CHANGELOG "Keyboard focus treatment and primary-tint contrast" · Primary text on primary tints still fails 4.5:1 in a few active states
- ISS-195 · 2026-11-20 · CHANGELOG "Polish fixes: Portfolio Today marker, loaders, comment box, maskable icon" · The Portfolio Today line disappears over an active bar
- ISS-196 · 2026-11-20 · CHANGELOG "Polish fixes: Portfolio Today marker, loaders, comment box, maskable icon" · Two bare pulse blocks remain in Project Overview, and the Risks Status cell is still native
- ISS-198 · 2026-11-20 · CHANGELOG "Task panel title editor and filter popover" · The task panel title editor loses focus and can drop its draft on Escape
- ISS-199 · 2026-11-20 · CHANGELOG "Test and tooling fixes" · e2e login() fails under parallel load on a shared dev server
- ISS-200 · 2026-11-20 · CHANGELOG "Task panel title editor and filter popover" · A deleted epic or label left in the filter URL keeps the views empty
- ISS-201 · 2026-11-20 · CHANGELOG "Task panel title editor and filter popover" · The task filter popover has no focus trap or focus return
- ISS-203 · 2026-11-20 · CHANGELOG "Tasks of a replaced project TAM are unassigned" · Changing a project's TAM may leave tasks assigned to the old TAM
- ISS-205 · 2026-11-20 · CHANGELOG "Test and tooling fixes" · No e2e check that Gantt connector paths stay finite
- ISS-206 · 2026-11-20 · CHANGELOG "Focus rings on toggles and forced-colours focus for borderless controls" · Project context panel repeats a complementary landmark name
- ISS-207 · 2026-11-20 · CHANGELOG "Focus rings on toggles and forced-colours focus for borderless controls" (also the Kanban, List and Timeline Filter triggers, through the shared component) · Project context toggle and active bordered toggles have a weak keyboard focus cue
- ISS-208 · 2026-11-20 · CHANGELOG "Focus rings on toggles and forced-colours focus for borderless controls" · About 35 borderless controls drop their focus indicator in forced-colours mode
- ISS-209 · 2026-11-20 · CHANGELOG "Keyboard focus ring on tab links" · Project tab links have no explicit keyboard focus treatment
- ISS-031 · 2026-11-23 · CHANGELOG "Task attachments" · Task attachments are not built; storage and visibility are undecided
- ISS-215 · 2026-11-24 · CHANGELOG "E2E cleanup also deletes stored attachment files" · E2E cleanup leaves stored attachment objects until the daily sweep
- ISS-193 · 2026-11-24 · CHANGELOG "Escape during a drag no longer closes the open panel after a re-render" · The Escape drag guard depends on listener order
- ISS-020 · 2026-11-24 · gates.sh `section-default-color-parity` (the packages share no module, so a gate keeps the two values equal) · Section default color hex is duplicated between schema and frontend
- ISS-048 · 2026-11-24 · CHANGELOG "Dropdown submenus can rise above a modal" · Dropdown submenu cannot outrank a modal host
- ISS-212 · 2026-11-24 · CHANGELOG "Attachment e2e tests for read-only members and the server type check" · Attachment e2e has no read-only case and never reaches the server's 415
- ISS-213 · 2026-11-24 · CHANGELOG "solvro backup and solvro update also back up attachments" · solvro backup and solvro update do not back up the attachments volume
- ISS-214 · 2026-11-24 · CHANGELOG "The nginx upload limit follows ATTACHMENT_MAX_FILE_MB" · ATTACHMENT_MAX_FILE_MB above 25 also needs the nginx body limit raised
- ISS-210 · 2026-11-24 · CHANGELOG "Gantt row menu dialogs wait for their own menu only" · Gantt row-menu dialogs find their menu through a document-wide selector
- ISS-103 · 2026-11-24 · CHANGELOG "Gantt section and reorder code tidied, no behaviour change" · Gantt section-id parsing lives outside the adapter
- ISS-104 · 2026-11-24 · CHANGELOG "Gantt section and reorder code tidied, no behaviour change" · handleResourceReorder is one long three-branch callback
- ISS-053 · 2026-11-24 · CHANGELOG "Sort risks by probability and impact" · Sortable data-grid headers cannot be centered
- ISS-217 · 2026-11-24 · CHANGELOG "Attachment temp-file test no longer fails at random" · Attachment temp-file test counts the whole OS temp folder
- ISS-170 · 2026-11-24 · docs/DESIGN.md frontmatter and §0 now name system as the default · DESIGN.md says theme_default dark but the code defaults to system
- ISS-084 · 2026-11-24 · CHANGELOG "The favicon stays readable on dark browser tabs" · Favicon reads weakly on dark browser tab strips
- ISS-004 · 2026-11-24 · CHANGELOG "Backend request validation upgraded to zod 4" · zod 3 has a memory-exhaustion advisory fixed only in zod 4
- ISS-014 · 2026-11-24 · CHANGELOG "Frontend router upgraded to React Router 7" · React Router 6 has two advisories fixed only in v7
- ISS-010 · 2026-11-24 · CHANGELOG "The app serves its own fonts" · Guest link pages contact Google for fonts
- ISS-146 · 2026-11-24 · CHANGELOG "End-to-end tests wait for conditions, not fixed sleeps" · E2E suite uses fixed waitForTimeout sleeps
- ISS-002 · 2026-11-25 · CHANGELOG "Deleting a customer follows the owner rule" · DELETE /customers/:id lets the TAM of one project delete an unowned customer
- ISS-143 · 2026-11-25 · CHANGELOG "Frontend lint for React hooks rules" · No ESLint setup, so the exhaustive-deps guard on TaskFormModal is inert
- ISS-220 · 2026-11-26 · CHANGELOG "Webhook address checks and a limit on Send test" · Webhook address check misses NAT64 and 6to4 forms
- ISS-221 · 2026-11-26 · CHANGELOG "Webhook address checks and a limit on Send test" · Webhook Send test has no rate limit
- ISS-223 · 2026-11-26 · CHANGELOG "Webhook address checks and a limit on Send test" · Outgoing loop check misses an APP_URL with a path prefix
- ISS-218 · 2026-11-26 · CHANGELOG "Escape closes a dialog in its first frame" · Task conflict dialog can be open with no rows, and Escape then leaves it open
- ISS-011 · 2026-11-26 · CHANGELOG "A key id in stored secrets, and SECRETS_KEY rotation" · SECRETS_KEY rotation invalidates every stored token
- ISS-141 · 2026-11-27 · CHANGELOG "e2e specs that failed on their first attempt" · pwa.spec.ts fails against the Vite dev server
