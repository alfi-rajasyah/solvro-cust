# Known Issues & Pending Work

Tracking doc for Solvro, compiled from **CLAUDE.md** canonical decisions,
**CHANGELOG.md**, and working-session history (as of 2026-06-03). Scope: known
bugs, doc/reality drift, deferred decisions, and follow-ups — not the full
product backlog. Update or prune items as they're resolved.
Last whole-list code check: 2026-09-02, against `develop` @ `7aa0339` (static read of
cited files; entries marked *code check* below carry the result).

---

## Known bugs / inconsistencies

### Gantt tree pane — residual clipping after the #118 fix (2026-07-30)
- **Engine container clamp can re-clip the Dates/color columns.** The vendored
  engine (`clampContainer`, `reui/gantt/gantt-view.tsx:977-987`) renders the
  tree pane narrower than the configured `treePanel.width` when the container
  can't spare its minimum timeline width, and never reports that through
  `onWidthChange`. `SolvroGantt.tsx` derives `nameColumnWidth` from its own
  `treeWidth` state, so on ~768–850px viewports a wide persisted width (e.g.
  640) pushes the fixed columns past the rendered pane edge again — the exact
  #118 symptom. Fix options (deferred from the #118 instant review): clamp
  `nameColumnWidth` by the measured pane width (ResizeObserver on the pane),
  or patch the engine to surface the clamped width with a `// SOLVRO PATCH`
  marker. Rare in practice: the Gantt is desktop-first and the default pane
  (364) never triggers the clamp at supported widths.
- **A pane narrowed below 256px clips the fixed columns** (name column floors
  at 100px; 100 + 156 > pane). Deliberate user narrowing — accepted, not
  planned for a fix.
  *Updated 2026-09-02 (code check)*: the fixed-column total is now 256px (Dates 132 + color 24 + Status 100), so the clip threshold is 356px, not 256 (`SolvroGantt.tsx:218`). Same accepted behavior.
- **Mid-drag geometry lag (pre-existing).** The engine writes the pane width
  to the DOM during a splitter drag but fires `onWidthChange` only on
  pointerup (`gantt-view.tsx:1057-1077`), so during a narrowing drag the
  fixed columns clip and snap back on release. Same lag existed under the old
  formula; noted 2026-07-30 because the #118 fix makes pane edge and column
  geometry co-dependent.
- ~~**Updated 2026-08-03 (Gantt visual refresh phase, T2's Status/Due
  columns) — the figures in the two bullets above are stale.** The fixed
  columns total they cite (156px) grew to 316px (`TREE_FIXED_COLUMNS_WIDTH`,
  `SolvroGantt.tsx:206-210`: Dates 132 + color 24 + new Status 100 + new Due
  60), and the tree pane's own default/max grew with it
  (`TREE_PANEL_DEFAULT_WIDTH` 364→558, `TREE_PANEL_MAX_WIDTH` 640→834 —
  `SolvroGantt.tsx:158-172`) specifically to preserve the same title-text
  room a pre-T2 visitor had. Two corrections: (a) the first bullet's claim
  that "the default pane (364) never triggers the clamp at supported
  widths" no longer holds — `clampContainer`'s ceiling is `container −
  minTimelineWidth(200) − 1` (`MIN_TIMELINE_WIDTH`, `gantt-view.tsx:213`;
  `clampContainer`, `gantt-view.tsx:977-987`), so the new 558 default now
  engages the clamp under a ~759px container, reachable on ~1024px
  viewports with the sidebar expanded — the deferred ResizeObserver fix is
  worth re-weighing now that its trigger range widened; (b) the second
  bullet's "narrowed below 256px" is now 416px (`316 + 100`
  `TREE_NAME_COLUMN_MIN_WIDTH`) — same deliberate-narrowing acceptance,
  just a wider pane before it bites.~~ **Obsolete 2026-09-02**: code check — these figures (316px fixed columns, 558/834 panel) describe the removed Due-column build; the next bullet matches current code (`SolvroGantt.tsx:199,205,237-240`: 256 / 498 / 774).
- **Updated 2026-08-03 (later the same day, Due-column removal) — the
  figures in the 2026-08-03 update above shrank again.** The Due column was
  removed as redundant with the Dates range: fixed columns total is now
  256px (Dates 132 + color 24 + Status 100), pane default/max are 498/774
  (width key bumped to `solvro.gantt.treeWidth.v4`, Due-era v3 values
  migrate −60), and the deliberate-narrowing threshold is 356px
  (`256 + 100`). The clamp-at-default observation in (a) still holds
  directionally — the 498 default engages `clampContainer` under a ~699px
  container — and the deferred ResizeObserver fix remains worth re-weighing.

### Gantt Excel/PDF export downloads blocked in production (2026-07-31)
- **Cause: Chromium insecure-download blocking, keyed on the origin scheme.**
  Prod is served at `http://solvro.elitery.local`. Chromium-family browsers
  block downloads that originate from a non-trustworthy origin, showing
  "blocked this download because the site isn't using a secure connection and
  the file may have been tampered with". Observed in **Dia** (Chromium-based)
  on 2026-07-31. The user can still keep the file via the download item's
  overflow menu, so this is friction, not data loss.
- **Supersedes the earlier Safe Browsing diagnosis** recorded in
  `docs/archive/ideas/gantt-ux-and-export-fixes.md` and the appendix of
  `docs/archive/plans/gantt-ux-and-export-fixes-plan.md`. That theory is
  falsified: Chromium's download-protection ping is bounded by
  `kDownloadRequestTimeoutMs = 7000` (`chrome/browser/safe_browsing/
  download_protection/download_protection_service.cc`), after which the check
  returns `UNKNOWN` and the download proceeds — it cannot hang a download
  indefinitely. The block is also independent of network egress and of file
  type (`.pdf` is `SAMPLED_PING`, yet it is blocked too).
- **Not fixable by changing the export format.** Every spreadsheet format that
  preserves formatting is `FULL_PING` in
  `components/safe_browsing/content/resources/download_file_types.asciipb`
  (`xlsx`, `xls`, `xml` SpreadsheetML, `ods`, `slk`, `htm`, `zip`); only `csv`,
  `txt`, `json`, and `pdf` are `SAMPLED_PING`. Irrelevant to this bug anyway,
  since the block is scheme-based, not type-based.
- **Fix directions (no code change required for the first two):**
  (a) reach the app at `http://localhost:PORT` via an SSH forward or a local
  reverse proxy — Chromium treats `localhost` as a potentially trustworthy
  origin with no certificate, which also revives the clipboard APIs and lets
  the PWA service worker register; (b) HTTPS with an internal-CA cert (user
  declined 2026-07-31 — per-machine CA trust); (c) PDF only — the existing
  **View** action in `RightSidebar.tsx` opens a blob URL in a tab and skips the
  download pipeline entirely, so `Cmd+P` → "Save as PDF" writes the file. Excel
  has no in-browser viewer equivalent.
- **Unrelated hygiene spotted while investigating (not fixed):** all three
  download helpers call `URL.revokeObjectURL` synchronously right after
  `a.click()` — `frontend/src/lib/gantt/exportExcel.ts:311`,
  `frontend/src/lib/gantt/exportPdf.ts` (`pdf.save` path), and
  `frontend/src/lib/export/projectExport.ts:84`. The revoke belongs on a later
  task. Not the cause of this bug.
  **Note (2026-08-03, docs-keeper phase-end pass):** the third site,
  `frontend/src/lib/export/projectExport.ts`, is deleted in its entirety on
  the unmerged branch `chore/move-description-to-context-sidebar` (commit
  `c39b935`, "remove the Reports page and its export-packet builder") — not
  merged into `develop` as of this writing, so the file still exists on
  `develop`/this phase's base today. Do not mark this item resolved on that
  basis; if/when that branch merges, this item shrinks to the two remaining
  sites (`exportExcel.ts:311`, `exportPdf.ts`'s `pdf.save` path).
  *Updated 2026-09-02 (code check)*: `frontend/src/lib/export/` no longer exists (that branch merged); `exportPdf.ts` uses `pdf.save()` with no object URL at all. The only remaining site is `frontend/src/lib/gantt/exportExcel.ts:363`, still a synchronous revoke after `a.click()`.

### Documentation vs. reality drift
- ~~**DESIGN.md is gitignored and untracked.**~~ **Resolved 2026-07-21**:
  DESIGN.md is tracked and was regenerated from code + the paper-extraction
  references; the solvro-docs-keeper agent syncs it whenever a diff touches
  `tailwind.config.ts`, `index.css`, or `theme.tsx` (see
  `docs/plans/claude-agent-architecture-design.md`).
- ~~**DESIGN.md typo:** the light-mode `surface-container` value is written
  `#ebebе7` with a stray **Cyrillic** `е`.~~ **Resolved 2026-07-21** in the
  DESIGN.md regeneration (`#ebebe7`, verified against `index.css`).

### Dev environment
- ~~**Tailwind config changes need a frontend container restart.**~~ **Obsolete
  2026-07-25**: `tailwind.config.ts` was deleted 2026-07-24 in the Tailwind v4
  CSS-first migration — the theme now lives in `frontend/src/index.css`'s
  `@theme` blocks, which hot-reload through Vite like any other CSS. The
  config-caching failure mode (and its worse `tailwind.config.js`-shadowing
  variant, fixed 2026-06-03) no longer has a config file to apply to.
- ~~**Backend test-DB isolation is broken** (discovered 2026-07-22, plan Task 1):
  `backend/test/env.ts` only *falls back* to a disposable `localhost:5433`
  Postgres when `DATABASE_URL` is undefined — but `docker compose exec backend
  npm test` (the CLAUDE.md-documented gate command) inherits the backend
  container's dev `DATABASE_URL` from its environment, bypassing the fallback
  and pointing vitest at the **LIVE dev database**. Consequences: (a) ~330 junk
  test projects and hundreds of junk tasks accumulated in the dev DB from prior
  branch work; (b) `backend/test/taskOrdering.test.ts` test
  `"orders GET /tasks (cross-project) by position asc, then id asc"` is flaky
  (the endpoint's `take: 200` truncates amid the junk rows; pre-existing, also
  reproduces on `develop` before this task). Workaround used by this branch's QA
  gates: create an isolated `solvro_test` database inside the existing postgres
  container and run `docker compose exec -e DATABASE_URL="postgresql://solvro:test@postgres:5432/solvro_test?schema=public"
  backend npm test` (globalSetup auto-migrates it). Suggested proper fix
  (not implemented): codify an isolated test DB (compose service or documented
  recipe) and truncate between runs to prevent junk accumulation; optionally
  scope the flaky cross-project test to its own rows.~~ **Resolved 2026-08-02**
  (Issues Sweep #1): `backend/test/globalSetup.ts` now hard-guards against
  running (throws before migrating or touching data) unless `DATABASE_URL`
  names a database ending in `_test`, closing off the live-dev-DB pollution
  path structurally rather than by convention alone; `backend/test/env.ts`'s
  comment was rewritten to document the guard. Separately, the ~330+ rows of
  accumulated junk already in the dev DB (plus later "Diag"/"Gate"/"Timeline
  Check"/QA-fixture leftovers — see the entries below) were deleted with user
  approval: 1,092 projects / 419 customers / 805 users removed, 144/34/8
  legitimate rows remain. See CHANGELOG's "Backend tests start from a clean
  database" entry.
- **`pwa.spec.ts` fails against the dev server** (discovered 2026-07-22, plan
  Task 6): vite-plugin-pwa is configured with `devOptions: false`, so the
  service-worker registration and manifest link are only available in build
  mode (Vite dev server doesn't emit them). All four pwa cases (`manifest link
  is present`, `service worker registers`, both desktop and mobile) fail at
  `BASE_URL=http://localhost:5173` but pass on the built CI stack (`:8080`).
  Consider gating the spec on `BASE_URL` to skip locally or enabling
  `devOptions: true` for dev-server registration.
  *Updated 2026-09-02 (code check)*: still open. `pwa.spec.ts` now has 3 tests (manifest, service worker, theme-color); the service-worker test skips on non-local HTTP hosts (`pwa.spec.ts:26`) but `localhost:5173` counts as secure, so it still runs and fails on the Vite dev server; the manifest test has no guard; `vite.config.ts` still has no `devOptions`. `e2e/CLAUDE.md` records the dev-server failure as accepted.
- **`e2e/fixtures/test.ts` stale comment about fixture isolation** (discovered
  2026-07-22, plan Task 6): the comment claims `seededProject` is "effectively
  per test file," but it is WORKER-scoped with `workers: 1`, meaning one
  seeded project is shared across ALL spec files sequentially (not isolated per
  file). During plan Task 6, `list-dnd.spec.ts` inherited cross-spec state
  pollution from `kanban-dnd.spec.ts` mutating the same fixture project, which
  caused a test to fail because a precondition ("Beta is TODO") was false
  (Beta was already IN_PROGRESS from the prior spec). Fixed by deriving state
  from the API rather than hardcoding preconditions, but the comment and
  cross-spec mutations should be kept in mind when writing new specs.
- ~~**`backend/test/taskOrdering.test.ts` still flakes on the isolated `solvro_test`
  DB itself** (discovered 2026-07-23, Task 1 docs-reconciliation, fix/optional-sa-gantt-legend):
  the isolated-`solvro_test`-DB workaround (see the entry above) prevents
  pollution from the *live dev* DB, but `solvro_test` is never truncated
  between suite runs — rows accumulate across repeated `npm test` invocations
  against the same instance. Once the accumulated rows push `GET /tasks`
  (cross-project, unfiltered) past its `take: 200` cap
  (`backend/src/routes/tasks.ts:111`), `taskOrdering.test.ts`'s `"orders GET
  /tasks (cross-project) by position asc, then id asc"` starts failing —
  observed 39/40 after ~5 suite runs against the same `solvro_test` instance.
  Workaround applied: `DROP SCHEMA public CASCADE; CREATE SCHEMA public;` on
  `solvro_test`, then rerun (back to 40/40). Suggested fix (not implemented):
  truncate all tables in vitest `globalSetup` before each run, or scope the
  cross-project test to only its own seeded rows.~~ **Resolved 2026-08-02**
  (Issues Sweep #1): implemented exactly the suggested fix —
  `globalSetup.ts`'s `truncateAllTables` now `TRUNCATE`s every table
  (`RESTART IDENTITY CASCADE`) after migrating and before each test run, so
  `solvro_test` starts empty every invocation; no more manual schema
  drop/recreate. See CHANGELOG's "Backend tests start from a clean database"
  entry.
- **`backend/test/opportunities.test.ts` flakes under a full gates run, order-dependent on other test files sharing `solvro_test`** (discovered 2026-09-09, weekly-sync-highlight-rows phase close; pre-existing, unrelated to that phase's changes): `"repacks the SOURCE stage densely (0..n-1) after a cross-stage move"` (`opportunities.test.ts:439`) failed once in a full `gates.sh` run — expected `stageOrder` 0, got 1 for the first `DELIVER_PROPOSAL` opportunity — then passed on an immediate single-file re-run (44/44) and in every other full run that same day. The test's own comment assumes `DELIVER_PROPOSAL` is untouched by any earlier test *in that file*, but a full run shares one `solvro_test` database across all 30 test files, so an opportunity another file leaves in that stage (order/timing dependent) shifts the positions this test appends onto. Fix direction: assert relative order among this test's own three rows instead of absolute `stageOrder`, or seed into a stage no other file touches.

---

## Pending features (not yet built)

- ~~**Secure Ingestion Port** (`POST /webhook/blueprint`) — top-priority
  SA→TAM handoff. The `Blueprint` model exists, but there is **no** webhook
  route, no API-key auth, and no `blueprintId` FK on `Task` to tag
  AI-Breakdown cards. (Spec in CLAUDE.md.)~~ **Cancelled 2026-08-03**: the
  user cancelled the Secure Ingestion Port — Solvro is a TAM-only tool, with
  no Solution Architect ingestion path. The `Blueprint` model, its
  `blueprints` table, and the RightSidebar "Blueprint reference" card were
  removed (migration `20260803000000_remove_blueprints`); the spec moved to
  `docs/archive/plans/secure-ingestion-port-spec.md`. The SA user role,
  `Project.saId`, and SA visibility matching are unrelated to the webhook and
  stay.
- ~~**Reports screen revamp**~~ — **Resolved (noted stale 2026-07-25)**:
  shipped. CLAUDE.md's Facts block ("Reports & export (shipped)") documents
  `Reports.tsx` producing the full export packet (identity / health / phase
  breakdown / task signals / open risks / `CUSTOMER_FACING` notes, last 14
  days) via dynamically-imported `frontend/src/lib/export/projectExport.ts`,
  with both copy-to-clipboard and `.md` download.
- **Work Logs / Utilization** (`WorkLogs.tsx`) — placeholder only, now hidden
  from the sidebar; awaits the iTop API spec. Rename to "Utilization" when
  implemented.
- **Task attachments** — not built. The "Attachments placeholder" block this
  entry used to cite in `TaskFormModal.tsx` was removed (verified absent
  2026-09-02); the only related trace is `frontend/src/pages/CustomerDetail.tsx:248`'s
  "Document attachments will live here once uploads are implemented" notice,
  which is customer documents, not task attachments. Storage, size limits, and
  export visibility are undecided.

---

## Deferred (explicit, by decision)

- **Critical-path highlighting** — the *computed* path stays deferred.
  *Updated 2026-08-02*: the `data-cp`/`--cp-stroke` hooks this entry used to
  point to lived in the dead Network Diagram CSS block, deleted from
  `frontend/src/index.css` in the Issues Sweep #1 cleanup (see the Network
  Diagram entry below) — no CSS hooks for critical-path highlighting exist in
  the tree anymore; if/when this feature is built, its styling starts from
  scratch. *Updated 2026-09-02*: a manual **Critical Path** mark shipped this
  phase (branch `feat/critical-path-mark`) — `Task.isCriticalPath`
  (`is_critical_path`, boolean, default false, TAM-set), rendered via
  `frontend/src/components/CriticalPathMark.tsx` on the Gantt bar/milestone
  (violet ring/outline), tree, row menu and Color-by key, the Kanban and
  Timeline cards, the List row, the task panel and task form, and the PDF/
  Excel exports (see `CHANGELOG.md`, "Critical Path mark on tasks"). It
  computes nothing from `TaskDependency` — the computed path above is
  unaffected and stays deferred. A later "Suggest from dependencies" action
  could populate the flag from a computed path if one is ever built; the flag
  stays the source of truth either way.
- **Network Diagram tab** — per CLAUDE.md, "never built / do not implement"
  (reconfirmed 2026-07-21). *Updated 2026-07-25*: `@xyflow/react` has been
  removed from `frontend/package.json` (verified absent); the remaining
  primitives were the `dependencies` routes, `.diagram-*` CSS in `index.css`,
  and the unused `TaskDependency.sourceHandle`/`targetHandle` schema fields.
  *Updated 2026-08-02*: the `.diagram-*` CSS (179 lines — `.diagram-canvas`,
  `.diagram-task-node`, `.react-flow__*` overrides, milestone/edge/handle
  styling) was deleted from `frontend/src/index.css` (Issues Sweep #1,
  zero-consumer-verified — see CHANGELOG); the remaining primitives are just
  the `dependencies` routes and the unused schema fields.
- **Native AI summarisation inside Solvro** — deferred indefinitely; the export
  packet is designed for external AI tools.

---

## Tech debt / follow-ups from recent work

- **Service-mapping mutations lack the optimistic-update pattern** (2026-07-15
  code review, deferred as inherited debt): `useUpdateProjectServices` and the
  pre-existing `useUpdateCustomerServices` (`frontend/src/lib/queries.ts`) use
  plain `onSuccess` + invalidate. The `ServiceMappingList` checkbox toggles and
  tool chips disable while saving, so it's correct but not instant. Follow-up:
  add `onMutate` snapshot → optimistic `services[]` patch → `onError` rollback →
  `onSettled` invalidate, for both hooks together.
- **Inactive services can still be assigned** — the mapping picker shows
  deactivated services dimmed but toggleable (pre-existing), and the project
  tab's "Add all subscribed" carries inactive legacy subscriptions over without
  filtering. Consistent behavior, but a product call is pending on whether
  `active: false` should block *new* assignments.
- **`ensureTaskVisible` does 2 DB round-trips** per task mutation (visibility
  check, then the write). Folding the filter into the `where` isn't possible
  with Prisma `update` (unique `where` only). Watch against the sub-200ms NFR;
  revisit with an `updateMany` + returned-row approach if profiling flags it.
- **Sidebar nav text still uses cool `slate-*` greys** instead of DESIGN.md's
  warm `#888780` for inactive items. Deferred — needs a small set of *fixed*
  always-dark text tokens (the theme-flipping `secondary` token renders too dark
  on the always-dark rail). Contrast is fine; it's a tint nit.
- **Admin active-status pill lost its `hover:bg-emerald-200`** during the
  emerald → chip-token migration (no chip hover token exists). Minor; status
  pills arguably shouldn't have a hover state.
- **Caps-label variants not migrated to the token:** 4× `text-[11px] uppercase`
  (no bold) and 1× `text-[11px] font-semibold uppercase` were left as-is
  (adopting the 700-weight `text-label-caps` token would change their weight).
  Decide whether to align them.
- **`ProjectOverview` KPI value uses `font-body`**, not the reviewer-suggested
  `text-data-mono` (that token's fixed 13px would shrink the `text-3xl` stat and
  its weight 500 would fight `font-bold`). Working as intended — noted in case a
  future review re-flags it.
- **Favicon** is the flat on-light mark (no green tile); may read weakly on dark
  browser tab strips. Quantified (solvro-reviewer, 2026-07-25/26 PWA-icons
  review): the arc ink `#5b5b5d` is 2.38:1 against Chrome's dark tab background
  `#202124` — a pre-existing artwork choice, not a regression from that task's
  `frontend/public/favicon.png` trim-to-64×64 (which kept the on-light artwork
  and alpha channel unchanged, per CHANGELOG). Follow-up candidate:
  `prefers-color-scheme`-aware favicon (an SVG favicon with a media query, or a
  second `<link media="(prefers-color-scheme: dark)">` pointing at the on-dark
  mark).
- **Overview.tsx pre-existing off-token styling** (2026-07-16 UI review of the
  portfolio-timeline change; all predate that diff and were deliberately left
  untouched to keep it minimal): KPI icon tones use raw `text-emerald-600` /
  `text-amber-600` instead of chip tokens; `AVATAR_PALETTE` is 8 hardcoded hexes
  incl. `#f59e0b` (the AI-Breakdown-reserved amber) applied via inline style;
  `P-`/`T-` ids and the KPI number use raw `font-mono` instead of the
  `data-mono` token; assorted `text-[11px]`/`text-[12px]` captions bypass the
  type scale; `healthColor()` left-border hexes (`#F59E0B`/`#8DC63F`/`#6B7280`)
  could migrate to `border-l-chip-amber-text`/`border-l-primary`/
  `border-l-outline` token classes (note `#8DC63F` matches no current token).
  Fix as one dedicated token-migration pass. **Updated 2026-08-31** (Daily
  Review collapse phase, solvro-reviewer review of the Overview diff): the
  `AVATAR_PALETTE`/`avatarColor` hexes, the `T-` task ids, and the
  `text-[12px]` caption size are gone — `ActivityFeed` (with its raw-color
  avatar swatches) was deleted and replaced by `RecentNotesFeed`, whose meta
  line kept the surviving `text-[11px]` size for file consistency. The KPI
  `text-emerald-600`/`text-amber-600` tones, the `P-` id's raw `font-mono`,
  `text-[11px]` captions (now including the new Recent notes meta line), and
  the `healthColor()` hexes are all still present as described above — the
  fix-as-one-pass plan still applies to those.
- ~~**`ActivityFeed` empty-state edge case** (`frontend/src/pages/Overview.tsx`,
  pre-existing): the `projects` prop is only used in the combined empty guard —
  with recent projects but zero recent tasks it renders an empty `<ul>` instead
  of an empty state, and project activity is never rendered at all. Either
  render project events or key the empty state off `tasks.length` alone.~~
  **Moot 2026-08-31**: `ActivityFeed` and the `recentProjects`/`recentTasks`
  payload fields it read were deleted in the Daily Review collapse phase
  (`frontend/src/pages/Overview.tsx`, `backend/src/routes/overview.ts`,
  `frontend/src/lib/queries.ts`), replaced by `RecentNotesFeed` reading
  `GET /notes/recent` — verified absent from the current tree.
- **`PortfolioCalendar` carried-over nits** (2026-07-16 extraction review,
  kept verbatim on purpose): `rounded-full` on the timeline bar (tailwind config
  reserves `full` for pills/avatars) and raw `font-mono` for the year switcher
  display. Fix in the shared component once, benefits both Executive and
  Overview.
- **Section-color parity gap across non-Gantt surfaces** (2026-07-22 code review,
  gantt-bar-reskin Task 2, deferred as paint-only Gantt scope): `frontend/src/pages/views/ProjectList.tsx:537`,
  `frontend/src/pages/Executive.tsx:314`, and `frontend/src/components/TaskPanel.tsx:502`
  resolve `section.color` directly (no fallback), so uncustomized sections
  render vivid presets in the Gantt tab but legacy slate `#94a3b8` in the List
  tab (which is also documented as the Gantt's mobile fallback), the Executive
  roll-up chips, and the task-detail-panel dot. Possible fix directions: export
  a shared resolver from `lib/gantt/palette.ts` or `geometry.ts`, or centralize
  the fallback server-side in the `Section` query.
- **`#94a3b8` sentinel is duplicated and now load-bearing** (2026-07-22 code
  review, gantt-bar-reskin Task 2 risk): the hex value exists independently in
  `frontend/src/lib/gantt/geometry.ts` (`DEFAULT_SECTION_COLOR`, line 33),
  `frontend/src/lib/gantt/palette.ts:26`, `backend/prisma/schema.prisma`
  (`Section.color` @default, line 290), and the `--phase` fallback in
  `frontend/src/index.css` (lines 203, 215, 278, 288). Task 2's sentinel
  byte-equality compare (`.toLowerCase()` against `DEFAULT_SECTION_COLOR`)
  makes this duplicated value functionally load-bearing: if the schema default
  ever changes without updating all frontend consts in sync, legacy uncustomized
  sections will silently stop being recognized as "unset" and will render the
  new server default instead of vivid presets. Recommend centralizing the
  sentinel as an exported constant or migrating to a separate `isCustom` boolean
  on `Section`.
  *Updated 2026-09-02 (code check)*: the `index.css` `--phase` fallback cited above is gone (zero `94a3b8` hits there); the duplication that remains is `frontend/src/lib/gantt/geometry.ts:2`, `frontend/src/lib/gantt/palette.ts:31`, and `backend/prisma/schema.prisma:352`, with the sentinel compare at `palette.ts:223`.

- **TaskPanel section chip briefly stale on cross-section drag** (2026-07-22,
  plan Task 3 review, deferred): During a cross-section move's optimistic
  window, the moved task's nested `section` object in the projectTasks cache
  stays stale — only `sectionId` is updated by `reorderTasksLocally`/plain
  merge in `frontend/src/lib/queries.ts`. The only reachable consumer is
  `frontend/src/components/TaskPanel.tsx` (lines ~211/330/499/502 read
  `task.section?.name`/`.color` from the same cache), so a TaskPanel open on
  the exact task being dragged cross-section briefly shows the old section chip
  until `onSettled` refetch. Pre-existing behavior (old `{sectionId}`-only path
  had the same window), transient, self-healing. Possible future fix: recompute
  nested `section` from the sections cache inside `reorderTasksLocally`.
- ~~**Stale Task.position doc comment** (2026-07-22, plan Task 2 docs-close):
  `backend/prisma/schema.prisma` lines 235-240 still describe the per-sibling
  model as `(projectId, status, parentTaskId)` and state that "status does not
  partition subtasks," but Task 1 re-scoped the top-level key to `(projectId,
  parentTaskId)` (status removed from the sibling ordering dimension). Comment
  needs to reflect the new model: status is now orthogonal to ordering, siblings
  are tasks sharing `(projectId, parentTaskId)` regardless of status, and
  `position` is maintained as a dense 0..n-1 list within that group for both
  top-level tasks and subtasks. Queued for the plan's Task 6 docs-sweep on
  branch feat/unified-task-ordering.~~ **Resolved 2026-09-02**: code check — `backend/prisma/schema.prisma:296-303` now describes the unified model ("status does NOT partition it … ONE canonical order … Dense 0..n-1").
- ~~**Missing DELETE /projects/:id route** (2026-07-22, discovered during plan
  Task 2 NFR cleanup): `backend/src/routes/projects.ts` has no `router.delete`
  for top-level project deletion. The API is create/read/update only. During
  Task 2's NFR verification, a scratch project's cleanup went through a direct
  DB delete (which cascades to tasks via `onDelete: Cascade` FK). Verify this
  is intentional (projects may be scoped to be only archived, not deleted) or
  file a follow-up to add the route.~~ **Resolved 2026-08-31** (branch
  `feat/project-delete`): user decided on a hard delete behind `project:write`
  + visibility, native `confirm()` in `ProjectDetail.tsx`, linked won deal
  keeps its row with `projectId` cleared. Route, `useDeleteProject()`, button
  and `backend/test/projectDelete.test.ts` shipped — see CHANGELOG.
- ~~**GanttFrame and ProjectList use different dnd-kit collision strategies**
  (2026-07-22, plan Task 5 review, deferred): `GanttFrame.tsx` uses dnd-kit's
  default `rectIntersection` collision detection, while `ProjectList.tsx`
  (plan Task 3) uses `closestCenter`. For Gantt rows of uniform height in a
  single-column list, the difference is negligible in practice — both produce
  identical behavior at drop boundaries. However, aligning both surfaces to the
  same strategy would strengthen robustness and maintainability (ProjectList's
  `closestCenter` is dnd-kit's documented recommendation for vertical lists).
  Low impact; candidate for a small follow-up pass covering both Gantt and List
  collision detection uniformity.~~ **Obsolete 2026-09-02**: code check — `frontend/src/components/gantt/GanttFrame.tsx` no longer exists; the vendored `reui/gantt/gantt-dnd.tsx` does its own hit-testing without dnd-kit collision detection, so there is no strategy pair to reconcile. `ProjectList.tsx:6,414` still uses `closestCenter`.
- **ESLint `exhaustive-deps` disable comment is inert; repo has no lint config**
  (2026-07-23, plan Task 1 docs-reconciliation, GH #56): the `//
  eslint-disable-next-line react-hooks/exhaustive-deps` directive at
  `frontend/src/components/TaskFormModal.tsx` (~line 116) is ignored because
  the repo has no ESLint configuration or lint script anywhere. Nothing
  mechanically prevents a future edit from reintroducing the entire `props`
  object into the reset-effect dependencies (the second root cause of GH #56),
  silently undoing the fix. Recommend adding an ESLint configuration with
  `react-hooks/exhaustive-deps` rule enforcement and a `npm run lint` gate in
  CI to prevent regression.
- **Redundant double-sort in `legendEntries`'s section branch** (2026-07-23,
  plan Task 3 review, deferred): `frontend/src/lib/gantt/palette.ts:115-117` —
  `resolveSectionColors(sections)` already sorts internally (`palette.ts:81`);
  `legendEntries`'s Section branch then sorts the same array again with the
  identical comparator to build display order. Negligible cost given typical
  section counts, and this is exactly what the plan's Step 3 code specifies
  verbatim (not implementer error) — flagged for awareness only, deliberately
  not fixed on this branch.
- **No e2e coverage for `colorBy` persistence across a full page reload**
  (2026-07-23, plan Task 3 review, deferred): `e2e/tests/gantt-legend.spec.ts`
  (and the plan's own Step 1 spec, before adaptation) only exercise in-session
  `selectOption` switches between Status/Section/Priority; neither asserts
  that the `localStorage["solvro.gantt.colorBy"]` value survives a full page
  reload. Pre-existing gap, not introduced or removed by this task —
  candidate follow-up: reload the page after selecting a mode, then confirm
  the select's value and legend are restored.

---

## Verification debt

- ~~**Visual sign-off pending.**~~ **Stale, closed 2026-07-25**: the June
  brand/design changes this entry covered (Elitery palette migration, logo +
  `BrandMark`, login split, sidebar charcoal, drop-shadow removal, type-scale
  tokens) shipped through multiple subsequent releases and later review/
  walkthrough passes without a dedicated sign-off ever being logged. The known
  residual visual nits from that era are tracked individually under Tech debt
  (sidebar slate greys, favicon, caps-label variants, admin pill hover) — this
  blanket item adds nothing over those.

- **Reorder repack is N sequential UPDATEs — batch if perf ever bites** (2026-07-22, plan Task 6 close-out, orchestrator-filed): `insertAt`/`closeGap` in `backend/src/lib/taskOrdering.ts` issue one `UPDATE` per displaced sibling inside the transaction (~200 round-trips on a 200-task project). Calm-host worst case measured 0.196s (inside the 200ms NFR); under host load 6-15 the same call measured 0.20-0.47s with containers idle — host contention, not endpoint cost. If real-world use ever feels slow, batch the repack into a single SQL statement (`UPDATE ... FROM (VALUES ...)`) — one round-trip, no model change. Re-time on a quiet host: seed ~200 tasks, `curl -w "%{time_total}" -X PATCH .../tasks/<id> -d '{"position":0}'`.
- ~~**Unswept prose-overflow surfaces remain candidates for overflow hardening** (2026-07-23, plan Task 2 review, deferred): The comment-text wrap fix (GH #57, `whitespace-pre-wrap break-words` convention) was applied to three surfaces in TaskPanel, CustomerDetail, and ProjectDetail. Three other surfaces remain unswept: (a) `frontend/src/pages/views/ProjectRisks.tsx:299` and `:446` — risk.description in a `max-w-[28rem]` cell, contained by table's `overflow-x-auto` but stretches it; (b) `frontend/src/pages/views/ProjectTimeline.tsx:157` — task.description with neither wrap-hardening nor clamp. Follow-up: apply the prose standard across all surfaces.~~ **Resolved 2026-08-02** (Issues Sweep #1): both surfaces now use `whitespace-pre-wrap wrap-break-word` (Tailwind v4's renamed `break-words`) — `ProjectRisks.tsx`'s desktop grid cell and mobile card description, and `ProjectTimeline.tsx`'s task description. Verified in the current tree. See CHANGELOG's "Service Catalogue and project Risks tables on the data grid; long text wraps" entry.
- **E2E fixture pollution pattern: shared seeded state across suite** (2026-07-23, plan Task 2 review, deferred): `e2e/fixtures/test.ts` doc-comment incorrectly claims `seededProject` is "effectively per test file," but it is WORKER-scoped with `workers: 1`, meaning ONE seeded project is shared by the entire suite run (all specs sequentially). `e2e/tests/comments.spec.ts` (new) leaves a 300-char comment on task Alpha, inherited by `kanban-dnd.spec.ts` and `list-dnd.spec.ts`. Benign today (drag specs don't depend on Alpha being comment-free), but a known suspect for CI fragility if comment mutations cause later specs to flake. Future fix: clean comment state in specs that don't exercise comment persistence, or truncate seeded comment history between specs.

---

## Gantt GH #58 deferred findings (2026-07-24)

- ~~**Gantt label measurement caches pre-font-load metrics permanently** (solvro-reviewer, GH #58 Task 4): `frontend/src/components/gantt/GanttBar.tsx` — `labelTextWidth` cache may hold fallback-font widths measured before "Source Sans 3" (display=swap) loads; never re-measured once populated (cache only clears at 1000-entry capacity). Benign in practice (12px slack + inside `truncate` safety net), but airtight fix would warm/clear the cache on `document.fonts.ready`.~~ **Resolved 2026-09-02**: code check — the old `gantt/GanttBar.tsx` is gone; `frontend/src/components/gantt-v2/SolvroBar.tsx:90-113` (`useLabelFits`) re-measures via a per-bar ResizeObserver and `document.fonts.ready` (line 106), so no pre-font-load metric is cached.

- ~~**PDF export bar-label rule diverges from screen** (solvro-reviewer, GH #58 Task 4): `frontend/src/lib/gantt/exportPdf.ts` (~line 315) uses a >60px bar-width rule + char-count truncation with no outside-label fallback — narrow bars go unlabeled in PDF. Screen now uses measured text fit (GH #58). Requires a product decision: should PDF follow screen's measured-fit rule, or is current PDF behavior acceptable?~~ **Resolved 2026-09-02**: code check — `frontend/src/lib/gantt/exportPdf.ts:126-148` (`fitText`) now does measured binary-search truncation via `pdf.getTextWidth`, the PDF analogue of the screen rule.

- **Label-route permission asymmetry** (solvro-reviewer, GH #58 Task 4): `POST /projects/:id/labels` requires `project:write` (backend/src/routes/projects.ts ~:679) while `PATCH/DELETE /labels/:id` require `task:write` (backend/src/routes/labels.ts:37,52); the task form gates on `task:write`. Latent (TAM holds both; ADMIN wildcard covers all), but inconsistent for custom roles with granular permissions. Suggested fix: align label creation to `task:write` with vitest coverage.

- **Duplicate-label-name 409 surfaces raw database error message** (solvro-reviewer, GH #58 Task 4): Label picker (UI surface unspecified in review, likely `LabelPicker.tsx` or task form) renders "Unique constraint violated" (P2002) as-is instead of a user-friendly message. P2 (user-facing error messaging).

- **Comment composer is single-line input with horizontal scroll** (solvro-reviewer, GH #58 Task 4): `frontend/src/components/TaskPanel.tsx` — PanelComments composer is a single-line text input that scrolls horizontally for long comments. Suggested improvement: auto-growing textarea for better UX. P3 (UX refinement).

- ~~**Outside Gantt label can create dead horizontal scroll** (solvro-reviewer, GH #58 Task 4): `frontend/src/components/gantt/GanttBar.tsx` — outside labels positioned at `left + width + 6` with maxWidth 240px can overhang the chart's contentWidth on narrow windows, creating ≤246px dead horizontal scroll. Pre-existing, unchanged by GH #58 fix. Minor (UI polish). Note: this file was deleted in Plan B Task 9 (hand-rolled Gantt removal) — if the ReUI engine has an equivalent outside-label affordance, re-verify against the new code; otherwise this finding is moot.~~ **Obsolete 2026-09-02**: code check — the old `GanttBar.tsx` positioning is gone; `SolvroBar.tsx:456-468` places the outside label with relative `start-full`/`ms-1.5` inside the bar group, a different mechanism. Any overhang there would be a new finding.

---

## Plan B Task 9 deferred findings — ReUI Gantt swap (2026-07-25)

User-deferred findings from the Tailwind v4 / shadcn bootstrap / ReUI Gantt swap effort (Plan A + Plan B, branch `feat/tailwind-v4-shadcn`, commits 3cb3582..c4ab962).

- **Milestone connector endpoints anchor at the day-box edge, not the diamond glyph** (cosmetic, deferred): in `frontend/src/components/gantt-v2/connector-paths.ts` / `SolvroBar.tsx`, dependency-arrow endpoints for milestone tasks terminate at the cell's day-box edge rather than the visual diamond glyph center. Most noticeable at Week zoom, ~30-40px visual gap. Cosmetic only, connectors are still correctly routed logically.
- **Absolute-positioned popovers can clip near the new scroll containers' bottom edges** (deferred, same trade-off class as the Gantt overlay): now that List row dropdowns, Kanban column menu, and Risks selects sit inside internally-scrolling containers (walkthrough F5/F5b, `aaa10fa`), absolute-positioned popovers near the bottom of the visible scroll area can get clipped instead of flipping/repositioning. Same known trade-off already accepted for the Gantt `GanttOverlay` positioning approach. Revisit if user-reported.
- **Connector hover-delete e2e test has a rare flake** (deferred): the ReUI-engine hover-to-delete-connector Playwright assertion (in `gantt-parity.spec.ts` or `gantt-legend.spec.ts`, whichever exercises hover-delete) occasionally fails on first attempt but recovers on retry. Root cause not isolated; not blocking, tracked for a future flake-hunt pass.
- **Per-bar `ResizeObserver` in `SolvroBar`** (deferred, scale watch): `frontend/src/components/gantt-v2/SolvroBar.tsx` attaches one `ResizeObserver` per rendered bar. Fine at current scale (typical project task counts); revisit if a project ever renders low hundreds of bars simultaneously — batch to a single shared observer if profiling flags it.
- **Row-reorder e2e spec lacks `waitForResponse`** (deferred, consistency tightening): a row-reorder-related e2e test (List/Gantt drag reorder family) doesn't await the backend PATCH response before asserting DOM state, relying on implicit timing instead. Works today; tighten to `waitForResponse` for robustness alongside other e2e hardening below.
- **shadcn CLI strips vendor headers / `"use client"` directives on re-pulls** (expected behavior, not a bug): re-running `npx shadcn add` or the ReUI registry pull on an already-vendored file in `frontend/src/components/ui/` or `frontend/src/components/reui/gantt/` will overwrite hand-edits, including the `// SOLVRO PATCH` markers left in the 3 patched ReUI gantt files. Discipline: always re-apply `// SOLVRO PATCH` sites after any future re-pull; do not re-pull without diffing first.
  *Updated 2026-09-02 (code check)*: `// SOLVRO PATCH` markers now total 82 across 20 vendored files (4 gantt files plus kanban, autocomplete, alert, badge, icon-tile, filters, frame, and 8 data-grid files), not "3 patched gantt files". The re-pull caution stands for all of them.
- **E2E fixed-timeout convention (`waitForTimeout`) predates this effort** (deferred, pre-existing pattern carried forward): several specs still use fixed `waitForTimeout` sleeps instead of condition-based waits. Not introduced by Plan A/B; candidate for a dedicated e2e-hardening pass converting these to `waitForResponse`/`waitForSelector`-style waits across the whole suite (also see the row-reorder finding above, which is one instance of this pattern).
- ~~**Junk "Diag …" projects may exist in the dev DB** (deferred, cleanup candidate): a leaked diagnostic/scratch spec run against the dev database is suspected to have left behind projects named with a "Diag …" prefix. Not confirmed cleaned up. Follow-up: query the dev DB for `name LIKE 'Diag%'` and delete if confirmed to be diagnostic leftovers, distinct from the pre-existing junk-test-data issue tracked above under "Backend test-DB isolation is broken."~~ **Resolved 2026-08-02** (Issues Sweep #1): dev-DB junk (Diag/Gate/Timeline Check/QA-fixture leftovers, confirmed diagnostic) deleted with user approval alongside the accumulated test-isolation junk — see the "Backend test-DB isolation is broken" entry above for the row counts.

## Final whole-branch review additions (2026-07-25)

- ~~**Baseline-locked toast uses raw emerald-* utilities** (`frontend/src/components/gantt-v2/SolvroGantt.tsx` ~:1136, ported verbatim from the old GanttFrame): `border-emerald-300 bg-emerald-50 text-emerald-700` should map to DESIGN.md chip/semantic tokens. Cosmetic, deferred from final review.~~ **Moot 2026-08-31** (Gantt toolbar one-row phase): the floating toast (and the Lock/Reset baseline flow that produced it) was removed from `SolvroGantt.tsx` — the baseline lock/reset action and its confirmation now live in `RightSidebar.tsx`'s Baseline section, which uses an inline `text-primary` status line, not a raw-emerald floating pill. Verified absent from the current tree (`grep -c emerald-300` = 0).
- **Section-id parse/format logic split across files**: `adapter.ts` owns `sectionNodeId`/`parseTaskId` but SolvroGantt parses section ids ad hoc (`toGeometryCollapsedIds` + reorder handler). Consolidate a `parseSectionId` in the adapter when its signature lock lifts. Coupling hygiene, no defect.
- **`handleResourceReorder` is ~130 lines / three branches** (SolvroGantt.tsx) — mirrors the old engine's shape intentionally (diffability); split into named helpers in a future readability pass.

## Login/Sidebar always-dark-pin fix — deferred findings (2026-07-25)

From `docs/plans/2026-07-25-login-dark-pin-and-pwa-icons.md` Task 1 (branch `fix/login-dark-and-pwa-icons`): `frontend/src/index.css`'s primary `@theme` block was switched to `@theme inline` so the subtree `dark` pins on `Login.tsx:99`/`Sidebar.tsx:59` resolve at the consuming element again (see CHANGELOG entry "Login (and sidebar rail) always-dark pin broken...").

- **`DESIGN.md` frontmatter `theme_default: dark` doesn't match `frontend/src/lib/theme.tsx:30`'s actual default (`"system"`)** — pre-existing drift, surfaced (not introduced) by this task. User decision (2026-07-25, task brief): keep the `"system"` default as-is; only the dark-pin bug gets fixed, not the default-theme behavior. Per DESIGN.md's own maintenance note ("if this file and the code ever disagree, the code is right — file a docs-sync task"), filing here rather than editing the frontmatter unilaterally, since the plan explicitly routes this discrepancy to ISSUES.md rather than folding it into the pin fix. Follow-up: either correct `theme_default` to `system` in a docs-only pass, or get an explicit product decision that `dark` is the *intended* first-visit default (in which case `theme.tsx` would need to change instead, and that's a behavior change, not a docs fix).
- ~~**`frontend/src/index.css` carries ~180 lines of dead Network Diagram CSS** (reviewer finding on this task, out of scope for this diff — not touched): lines 294–471 (`.diagram-canvas`, `.diagram-task-node`, `.react-flow__*` overrides, milestone/edge/handle styling) style a Network Diagram view that was never built (CLAUDE.md: "never built, do not implement", reconfirmed 2026-07-21) and whose `@xyflow/react` dependency has already been removed from `frontend/package.json` (verified absent). No shipped component references `.diagram-canvas`/`.diagram-task-node` (grep-verified: zero matches outside `index.css` itself). Candidate for a dedicated cleanup task — delete the block, keeping only `TaskDependency.sourceHandle`/`targetHandle` in the schema per the existing "Network Diagram tab" entry above.~~ **Resolved 2026-09-02**: code check — `frontend/src/index.css` is 308 lines with zero `.diagram-*` / `react-flow` hits (removed in Issues Sweep #1, see the Network Diagram entry above).
- **No e2e spec asserts the Login/Sidebar always-dark pin** (reviewer nit on this task): none of `e2e/tests/*.spec.ts` verify that `Login.tsx`'s root wrapper or the sidebar rail render dark regardless of OS/app theme preference. Without a regression test, a future `@theme`/`@theme inline` change (or an unrelated Tailwind upgrade) could silently reintroduce the exact bug this task fixed. Follow-up: add an assertion (e.g. force `light` theme via `localStorage["solvro.theme"]`, then check the Login root and sidebar rail still compute dark background colors) to a suite that already visits `/login` and an authed page with the sidebar, or a new small spec.

## PWA icon regeneration — deferred findings (2026-07-25/26)

From `docs/plans/2026-07-25-login-dark-pin-and-pwa-icons.md` Task 2 (branch `fix/login-dark-and-pwa-icons`): all 4 `frontend/public/icons/*.png` plus `frontend/public/favicon.png` regenerated onto an opaque `#232321` charcoal plate with the full two-tone Elitery mark (see CHANGELOG entry "PWA/home-screen icons rendered as an unrecognizable dark square with a white blob"). See also the enriched Favicon tech-debt entry above for the dark-tab-strip contrast finding from this same review.

- **Typecheck gate doesn't cover `vite.config.ts`** (solvro-reviewer, PWA-icons review): `frontend/package.json`'s `typecheck` script is `tsc --noEmit`, which resolves `tsconfig.json` — `include: ["src"]` only, so `frontend/vite.config.ts` (one of this task's changed files) is never typechecked by the documented gate command; TS project references aren't built by plain `tsc`. Separately, `frontend/tsconfig.node.json:17`'s `include` array still lists `tailwind.config.ts` and `postcss.config.js`, both deleted 2026-07-24 in the Tailwind v4 migration (verified absent from the tree). Fix candidate: add `tsc -p tsconfig.node.json --noEmit` to the `typecheck` script and prune the stale `include` entries.
- **`frontend/nginx.conf` has no explicit `Cache-Control` for `/icons/` or `/favicon.png`** (solvro-reviewer, PWA-icons review): only `location /assets/` gets `expires 1y; Cache-Control: public, immutable`; icon/favicon requests fall through to the bare `location /` block (`try_files ... /index.html`, no cache header), so browser-process fetches of these assets (as opposed to service-worker-mediated ones) get no explicit caching directive. Belt-and-braces candidate: add a short explicit `Cache-Control` for `/icons/` and `= /favicon.png` in `frontend/nginx.conf`.
- **Only a 512 maskable icon is declared** (solvro-reviewer, PWA-icons review, minor): `frontend/vite.config.ts`'s manifest `icons` array has exactly one `purpose: "maskable"` entry (`icon-maskable-512.png`); low-DPI Android launchers requesting a maskable icon get a downscale from 512 rather than a purpose-sized 192. Follow-up candidate: generate `icon-maskable-192.png` and add a matching manifest entry.

## Kanban → ReUI swap — deferred findings (2026-07-27)

User-deferred findings from the Kanban → ReUI Engine Swap effort
(`docs/plans/kanban-reui-swap/plan.md`, branch `feat/kanban-reui-swap`, T3–T13b
+ review-fix batches + T11 cutover). The reviewer cleared all blockers; these
are accepted-as-deferred, not outstanding review items.

- **Vendored Kanban's keyboard-DnD is unreachable** (`frontend/src/components/reui/kanban.tsx`):
  dnd-kit's `attributes` (role/tabIndex — what makes an element focusable)
  land on `KanbanItem`'s outer wrapper (non-overlay branch, `...attributes`
  spread ~line 796) while `listeners` (the actual keyboard activator) land
  only on the inner `KanbanItemHandle` (`...listeners` spread ~line 838),
  which carries no `tabIndex`/`role` of its own. No Tab+keyboard sequence can
  reach the sensor's keyboard activator — mouse and touch drag work,
  keyboard drag does not. Candidate: upstream report to the ReUI/shadcn
  registry, or a future sanctioned `// SOLVRO PATCH` moving `listeners` onto
  the outer wrapper (would need a CHANGELOG entry + patch-count bump per the
  Guardrail, and solvro-qa's standing patch-count check would need updating
  from 0).
- **`GET /users` is unpaginated** (`backend/src/routes/users.ts:10`,
  `prisma.user.findMany` with no `take`/`skip`): `TaskFormModal`'s Assignee
  `<select>` renders every user in the DB as an `<option>`. Already
  load-bearing this cycle — the `kanban-dnd.spec.ts` stabilization had to
  stop using `getByRole("option", ...)` because the accessibility tree can no
  longer resolve against a `<select>` this large (see CHANGELOG's "modal
  trio" root-cause note) — and pathological on a real large production DB
  too. Follow-up: paginate, or at minimum cap/search-filter, the endpoint.
- **`GET /tasks` has a ~200-row window** (`backend/src/routes/tasks.ts:111`,
  `take: 200`, cross-project/unfiltered): on a large DB the `/tasks` page
  (`Tasks.tsx`) can silently truncate results below a project's own rows, as
  this cycle's e2e stabilization discovered firsthand (Acme Corp's 380+
  accumulated projects pushed a fresh fixture's rows out of the window — see
  CHANGELOG). The e2e fix scopes queries by `customerId`; the product itself
  still has no scoping affordance on `/tasks`. Related to, but distinct from,
  the test-DB-pollution entries above (those are about the isolated *test*
  DB; this is the live product route, on any sufficiently large real DB).
  Follow-up: add filters (project/customer/date-range) to `/tasks` sufficient
  to keep realistic result sets under the cap, or add real pagination.
- **No board-adjacent subtask promote/re-parent path**: `TaskPanel.tsx` has
  no parent field, so promoting a subtask to top-level or re-parenting it
  still requires `TaskFormModal`'s Parent field — no in-board (Kanban) or
  in-panel affordance exists. This is the "Promote to task" row-menu
  shortcut deferred at plan CP0/Decision 8 (R6: the dogfood window would
  decide if it's needed); the window closed at cutover without one being
  built, so it stays open. Revisit if usage patterns show the modal
  round-trip is friction.
- **`kanban-v2/cards.tsx` and `MobileMoveSheet.tsx` carry copied non-token
  styles**: ported verbatim from the old `ProjectKanban.tsx` per Architecture
  Decision 2 ("copy, don't extract"). `border-emerald-500 bg-emerald-500
  text-white` (`cards.tsx:199`, subtask-done checkbox),
  `border-primary bg-primary text-white` (`MobileMoveSheet.tsx:54`), and a
  fixed `text-[15px]` (`cards.tsx:83`) bypass DESIGN.md's chip/semantic
  tokens and type scale. Deviated at copy time (T6); now live on the shipped
  board post-cutover — cleanup candidate now that `kanban-v2` is the only
  Kanban.
- **`TaskFormModal`'s subtask DONE checkbox lacks the `canEdit` gate**
  (`TaskFormModal.tsx:444-454`): unlike the new up/down reorder arrows (both
  `disabled={!canEdit || ...}`, added T13/M3), the checkbox has no `disabled`
  attribute at all — a non-writer can still toggle a subtask's DONE status
  from the modal. Pre-existing gap (predates this task; the Phase 2 review's
  M3 fix gated only the arrows, deliberately leaving the checkbox as
  pre-existing/out-of-scope per the CHANGELOG).
- **Vendored engine quirk: a mouse drop on the post-preview-displaced card
  can cancel a one-slot move**: `frontend/src/components/reui/kanban.tsx`'s
  same-container branch calls `arrayMove` during both `handleDragOver` (live
  preview splice, ~line 403) and `handleDragEnd` (commit, ~line 527) —
  `handleDragEnd` recomputes `activeIndex`/`overIndex` against the
  already-shuffled preview state, so a drop landing exactly on the card the
  preview already swapped into the source slot can have the second
  `arrayMove` reverse the first, netting a no-op instead of the intended
  one-slot reorder. Low real-user impact (requires precise pointer
  geometry); not reproduced under a fixed e2e assertion — dogfood watch
  item only.

## Global search & ⌘K command palette — deferred findings (2026-07-27)

User-deferred findings from the global search / command palette effort
(`docs/superpowers/plans/2026-07-27-global-search-command-palette.md`, branch
`feat/global-search`, commits `5f78b0c..8305eb7`). The final whole-branch
review (`solvro-reviewer`) cleared all blockers (verdict
MERGEABLE-AFTER-FIXES; the two required code fixes — raw status-enum hint,
Enter-key e2e coverage — shipped in the same branch's fix wave, commit
`8305eb7`); these are its 21 raw FILE-TO-ISSUES findings, consolidated into 8
entries per the review's own triage recommendation. Two of the 21 raw items
— the `AutocompleteEmpty` duplicated-`hasQuery`-predicate nit and the
`Sidebar.tsx` stale `tailwind.config.ts` comment — were **also** fixed in
that same fix wave (as N-a/N-c) and are omitted below as already resolved.

1. **`/search` contract-test gaps** (`backend/test/search.test.ts`): no
   assertion that `q` over 100 chars 400s (the cap is enforced at
   `backend/src/routes/search.ts:13` but untested); no assertion that
   results are ordered ascending; the 8-item group cap is proven only for
   `customers` (`search.test.ts:95-110`), not for `projects`/`tasks`.
   Separately, the test named "escapes LIKE metacharacters so % and _ are
   not treated as wildcards" (`search.test.ts:147`) seeds and asserts only
   the `%` case (:154-178) — no literal `_` seed/assertion exists despite
   the name promising one, which overclaims coverage in a suite other code
   now depends on (the `GET /search` contract feeds the palette directly).
   Fix: add the three missing assertions plus a `_`-literal case (or rename
   the test to drop the `_` claim). Cheap; nothing wrong with the escaping
   itself today.
2. **`pg_trgm` GIN index follow-up for `/search`** (`backend/src/routes/search.ts`):
   the projects/tasks `ILIKE` queries run as sequential scans today —
   measured baseline (final review, 2026-07-27): 901 projects / 4,181 tasks
   / 221 customers, `EXPLAIN ANALYZE` 0.58ms (projects) / 2.61ms (tasks),
   5.4-30.0ms end-to-end `/search` latency. Comfortably inside the 200ms NFR
   now, but scan cost grows linearly with row count and nothing guards it.
   Schema change is ask-first per the branch's spec — don't add
   speculatively. **Trigger: revisit when task rows approach ~50k, or when
   `/search` p95 latency exceeds 100ms**, whichever comes first.
3. **Vendored `reui/autocomplete.tsx` fidelity gaps** (third vendored ReUI
   engine after gantt/kanban, `frontend/src/components/CommandPalette.tsx`
   is its only consumer):
   - Vendor header (`autocomplete.tsx:1-8`) says "a handful of marked
     hand-edits" of three kinds, but the file carries **5**
     `// SOLVRO PATCH` markers (lines 11, 20, 125, 303, 322 — confirmed via
     `grep -c "SOLVRO PATCH"`), undercutting the header's usefulness as a
     `grep -c` re-pull gate until it names an exact, current count.
   - Malformed upstream class fragments inherited verbatim at
     `autocomplete.tsx:193` (`([class*='size-'])]:size-4` × 6, most missing
     the `[&_svg:not` prefix) — correctly left as-is per the byte-for-byte
     vendoring discipline, but undocumented; note only, so a future reader
     doesn't "clean it up" and break registry-diff parity.
   - No registry source hash/ETag recorded for **any** of the three
     vendored ReUI engines (`reui/gantt/`, `reui/kanban.tsx`,
     `reui/autocomplete.tsx`) — one repo-wide follow-up, not three: pin
     each file's registry JSON hash somewhere (vendor header or a small
     manifest) so a future re-pull has a known-good baseline to diff
     against.
   - `CommandPalette.tsx:177`'s `AutocompleteInput` beats the vendored
     `inputVariants` `cva` base (`autocomplete.tsx:26-27`) via six
     className overrides (`dark:bg-transparent rounded-none h-auto px-0
     focus-visible:ring-0 focus-visible:border-transparent`) with no test
     gating them. Works today, but a future ReUI re-pull that changes the
     base could silently restore the 3px focus-ring/boxed-input look this
     branch's own fix round removed — the same silent-regression shape as
     the 2026-07-24 non-inline `@theme` incident. Follow-up: an e2e
     assertion on the input's computed style, or a Vitest snapshot of the
     merged class string.
  *Updated 2026-09-02 (code check)*: `autocomplete.tsx` now carries 6 `// SOLVRO PATCH` markers (not 5); the header still says "a handful". Everything else in this entry is unchanged.
4. ~~**Palette result-state machine: error state indistinguishable from
   empty, sub-debounce stale-reopen residual** (`frontend/src/components/CommandPalette.tsx`):
   - `useSearch`'s `error` is never destructured (`:50`, only `data`/
     `isFetching` are) — a `/search` 500 or offline state renders the same
     `No results for "x"` copy (`:193-195`) as a genuine zero-hit query, so
     the UI asserts absence when the request actually failed. Fix:
     destructure `error` and render a distinct failure message.
   - B1 residual: `hasQuery` reads the **debounced** query (`:56`), which
     lags the immediate `setQuery("")` reset on close by up to the 200ms
     debounce window — a reopen inside that window can still flash the
     prior session's rows, even though the main B1 bug (stale rows across a
     settled close/reopen) is fixed. Fix: gate on the live `query` clearing
     too, or reset both synchronously on close.~~ **Resolved 2026-08-02**
   (Issues Sweep #1): both sub-items fixed together — `error` is now
   destructured from `useSearch` and renders "Could not load results. Try
   again." instead of the zero-hits copy on failure; `hasQuery` now gates on
   both the live `query` and the debounced value, closing the sub-debounce
   stale-reopen window. Covered by a new e2e case ("Ledger item 4") in
   `e2e/tests/search.spec.ts`. See CHANGELOG's "⌘K palette: toggle-close,
   failed-search message, and a scroll-lock collision" entry.
5. **Palette visual polish** (cosmetic, no defect) — `frontend/src/components/CommandPalette.tsx`
   unless noted:
   - Highlighted-row color/radius: the call site sets
     `data-highlighted:bg-surface-container` (`:209`), but the vendored
     base paints a `::before` at `bg-accent`/`rounded-md`
     (`autocomplete.tsx:190,193`) that overlays the element's own
     background — net color lands on `surface-container-high`, which is
     the *correct* DESIGN.md hover token, but by accident; the call-site
     class is dead, and the row's `rounded-sm` disagrees with the
     `::before`'s `rounded-md` by 2px at the corners. Fix: delete the dead
     class, align to `rounded-md`.
   - Dead `flex-1` on the input (`:177`) — the real flex child is the
     vendored wrapper `div.relative.w-full` (`autocomplete.tsx:63`); the
     class on the input itself is inert.
   - `frontend/src/components/layout/TopBar.tsx`'s search trigger button
     (`:82-95`) has no `hover:`/`focus:` affordance, unlike every sibling
     button in the same file (mobile search icon `:99-106`, notification
     and user-menu buttons). Reads as inert chrome.
   - `TopBar.tsx:95` hardcodes the `⌘K` glyph even though `Shell.tsx`'s
     listener accepts both Cmd and Ctrl. Low urgency (solo-TAM/macOS-first
     tool) but the wrong affordance for a Windows/Linux user.
6. ~~**Shared body-scroll-lock helper needed**: `Modal.tsx:24-32` and
   `CommandPalette.tsx:64-73` both write `document.body.style.overflow`
   directly with no ref-count. Reachable collision: open ⌘K while a
   `Modal` is already open (e.g. focus lands outside a form field) — closing
   the palette unlocks the page behind the still-open Modal. Two
   independent owners of one global now justifies a small ref-counted
   `useBodyScrollLock()` hook shared by both call sites.~~ **Resolved
   2026-08-02** (Issues Sweep #1): new `frontend/src/hooks/useBodyScrollLock.ts`
   is a module-level ref-counted lock, now the sole owner for both
   `Modal.tsx` and `CommandPalette.tsx` — closing one no longer unlocks
   scroll behind the other. Covered by a new e2e case ("Ledger item 6") in
   `e2e/tests/search.spec.ts`. See CHANGELOG's "⌘K palette: toggle-close,
   failed-search message, and a scroll-lock collision" entry.
7. ~~**⌘K toggle-close is effectively unreachable**: `Shell.tsx`'s keydown
   handler skips `INPUT`/`TEXTAREA`/`contentEditable` targets before
   toggling `paletteOpen` (`~:14-21`), but the palette autofocuses its own
   input the instant it opens (`CommandPalette.tsx:174`, `autoFocus` on
   `AutocompleteInput`) — so a second ⌘K press while the palette is open
   almost always has focus sitting inside that same input, and the handler
   no-ops instead of closing. Reads as a toggle, delivers open-only-via-⌘K
   (Esc and backdrop-click still close it). Fix: either drop the toggle
   intent from the code/comment, or check for the palette's own open state
   directly rather than inferring it from `document.activeElement`'s tag.~~
   **Resolved 2026-08-02** (Issues Sweep #1): `Shell.tsx`'s keydown handler
   now checks a `paletteOpenRef` mirror directly for the close direction —
   the editable-target guard applies only to the open direction — so a
   second ⌘K press closes the palette regardless of where focus sits.
   Covered by a new e2e case ("Ledger item 7") in `e2e/tests/search.spec.ts`.
   See CHANGELOG's "⌘K palette: toggle-close, failed-search message, and a
   scroll-lock collision" entry.
8. **`search.spec.ts` polish + listener-ready guard** (`e2e/tests/search.spec.ts`):
   - `:93-96`'s project-name fetch doesn't check `res.ok` before `.json()`,
     unlike the file's own `createUniqueTask` (`:18`) — a seed failure
     would surface as a confusing `undefined` name instead of a clear
     throw.
   - `:85-87`'s task deep-link URL regex (`` `task=${target.id}` ``) is
     unanchored — could substring-match `task=${id}X`. False-pass risk
     only, never false-fail.
   - `:31`'s comment cites `backend/src/routes/tasks.ts:22` for the
     200-char title cap; the create schema this test actually exercises is
     `backend/src/routes/projects.ts:84` (both cap at 200, so the claim is
     true, the pointer is wrong — can't fix via the append-only CHANGELOG
     entry that repeats the same pointer, but the spec comment itself can
     be corrected).
   - No listener-ready guard on any `page.keyboard.press("ControlOrMeta+k")`
     call (`:75,101,135,...`) — a real flake was observed once under
     concurrent CI load (SDD ledger, 2026-07-27) because the press can fire
     before `Shell.tsx`'s `useEffect` attaches the keydown listener.
     Highest-value fix in this batch: assert the TopBar trigger is visible
     first (proves `Shell` mounted) before pressing ⌘K, or wrap the press
     in a retry.

## ReUI DateField swap — deferred findings (2026-07-28)

User-deferred findings from `solvro-reviewer`'s pass on Task 1 of the ReUI
date-field swap (`docs/plans/reui-date-field-swap-plan.md`, branch
`feat/reui-date-field`). The reviewer cleared all blockers on this task;
these are accepted-as-deferred, not outstanding review items.

- **`dropdown-menu.tsx`/`tooltip.tsx` share the popover's pre-fix
  z-index-on-Popup gap**: Task 1's fix round put `positionerClassName` on
  `frontend/src/components/ui/popover.tsx`'s `PopoverContent` because
  Base-UI's `Positioner` carries an inline `transform` that creates its own
  stacking context, trapping a z-index set on the nested `Popup`. The same
  shape exists unfixed in `frontend/src/components/ui/dropdown-menu.tsx:262`
  (`DropdownMenuSubContent`'s `Popup` hardcodes `z-50`, no
  `positionerClassName` escape hatch) and in
  `frontend/src/components/ui/tooltip.tsx` (`TooltipContent`'s `Popup`,
  same pattern). Harmless today — neither is currently mounted inside a
  z-100+ Modal/Drawer host — but latent: the first submenu or tooltip that
  needs to render above a Modal/Drawer will hit the identical
  can't-outrank-the-host bug the popover had. Deferred as out of scope for
  Task 1 (which only touched `popover.tsx`); follow-up: port the same
  `positionerClassName` passthrough to both files if/when a real host
  collision surfaces.
- **`reui/gantt/gantt-nav.tsx:394`'s `GanttDatePicker` uses `shadow-md`,
  not the sanctioned `shadow-overlay`, and may be dead code**: the
  `PopoverContent` there (`className="w-auto p-0!"`) doesn't override
  `ui/popover.tsx`'s hardcoded `shadow-md` default, so it never picked up
  the `shadow-overlay` token DESIGN.md §4 sanctions for popovers (unlike
  the new `DateField.tsx`, which explicitly adds `shadow-overlay` to its
  `PopoverContent`). Separately, grepping `frontend/src` for
  `GanttDatePicker` turns up only its own definition/export in
  `gantt-nav.tsx` (lines 358, 476) — no import or JSX mount site anywhere
  else in `src/`, suggesting it may be compile-surface-only dead code left
  over from an earlier iteration of the Gantt nav bar. Deferred (not
  Task 1's scope — `DateField.tsx` is a new, separate component, not an
  edit to `gantt-nav.tsx`); follow-up: either confirm dead and remove, or
  if a mount site is planned, align its shadow to `shadow-overlay` at that
  time.
- ~~**Display-representation mismatch between the collapsed DATES row and the
  opened editor** (Task 2/5, deferred as pre-existing and deliberately
  preserved — not introduced by the swap): `TaskPanel.tsx:56`'s `fmtShort`
  renders an ISO's LOCAL calendar day (`new Date(iso).toLocaleDateString(...)`),
  while `DateField`/`dayFromIso` renders the UTC slice (`iso.slice(0, 10)`).
  East of UTC, a stored `2026-07-27T17:00:00.000Z` shows "Jul 28" in the
  collapsed DATES row but "27/07/2026" once `InlineDateRangeEditor` is opened
  on the same task. Root cause is the app's mixed legacy write conventions
  (some dates written at local midnight, the Gantt's at UTC midnight) predating
  this swap — out of scope for Task 2, which intentionally preserved
  `dayFromIso`'s UTC-slice behavior for byte-parity with the pre-swap inline
  editors (see `frontend/src/lib/dateField.ts`'s module doc). Follow-up:
  decide a single canonical write convention and align `fmtShort` to whichever
  representation `dayFromIso` uses, or vice versa.
  **Root cause, spelled out explicitly (Task 3/5, 2026-07-28):** the codebase
  has exactly TWO write conventions for `Task.startDate`/`dueDate`, split by
  site, not by whim: (1) `TaskFormModal.tsx`'s submit path
  (`new Date(startDate).toISOString()`, `TaskFormModal.tsx:189/195`) and the
  Gantt drag-to-reschedule adapter (`eventPatch` in
  `frontend/src/components/gantt-v2/adapter.ts:172-173`, which emits a bare
  `"yyyy-MM-dd"` that the backend's `z.coerce.date()` — `backend/src/routes/tasks.ts:26-27`
  — then parses as UTC midnight per the ECMAScript date-string grammar) both
  write **UTC-midnight ISO**; (2) `InlineDateRangeEditor` (mounted in
  `TaskPanel.tsx` and the Gantt tree cells, `gantt-v2/TreeCells.tsx`) writes
  **local-midnight ISO** via `isoFromDay`/`commitDraft`
  (`frontend/src/lib/dateField.ts:66-70`, `` new Date(`${day}T00:00:00`).toISOString() ``).
  Task 3 deliberately preserved each site's convention byte-for-byte rather
  than unifying them — `passthroughDate` (`TaskFormModal.tsx:73-76`) and
  `commitDraft`'s own untouched-draft passthrough both exist specifically to
  stop an unrelated field's edit-and-save from silently rewriting an
  already-stored date into the OTHER site's convention. This is intentional
  scope-limiting, not an oversight, but it means the two conventions are now
  load-bearing in three call sites, not one — any future unification work
  must pick a single canonical convention AND write a data migration for
  already-stored rows (a UTC-midnight-written date and a local-midnight
  -written date can represent different calendar days east of UTC, so this
  isn't a no-op rename). Recorded here so that decision doesn't get made
  blind as a "just pick one" call later — there are exactly two existing
  conventions to reconcile, not an arbitrary third one to invent.~~ **Resolved
  2026-07-29**: the date-contract phase (branch `fix/date-contract-utc-midnight`)
  picked the single canonical convention this entry called for — UTC-midnight
  ISO — and unified both write sites on it: `dateField.ts`'s `isoFromDay` now
  emits `${day}T00:00:00.000Z` (was local midnight), and `TaskFormModal.tsx`'s
  separate `passthroughDate` path was deleted in favor of reusing `commitDraft`.
  `fmtShort` was aligned to `dayFromIso`'s UTC-slice representation
  (`dayToDate(dayFromIso(iso))`), closing the display mismatch this entry
  named. The called-for data migration for already-stored rows also shipped:
  `backend/scripts/normalize-day-dates.ts`, applied to the dev DB (37 rows
  repaired). See CHANGELOG's "Date pickers no longer walk task dates back one
  day east of UTC" and "One-off data-normalization script" entries.
- **e2e flake: `list-dnd.spec.ts:171` "gantt row drag: reorder sticks, dates
  untouched"** (observed during Task 2/5 QA, 2026-07-28): reproducibly fails
  on the first attempt (`Expected: 15, Received: 0`) and passes on Playwright's
  automatic retry — observed twice in a row during this task's QA pass.
  Absorbed by the suite's retry budget today, so not currently blocking, but
  re-check during Task 5's full-gates run; if it's still flaking at that
  point, investigate drag-timing in that spec specifically (this looks like a
  distinct root cause from the CLAUDE.md-documented `taskOrdering.test.ts`
  test-DB flake — different suite, different symptom).
  **Task 5 full-suite gate run, fuller inventory (2026-07-28):** the re-check
  above ran the complete Playwright suite (desktop + mobile) as part of
  Task 5's acceptance sweep. This exact `list-dnd.spec.ts:171` case did not
  reproduce this time, but four OTHER first-attempt flakes did, every one
  self-healed on Playwright's `retries: 1` and every one in a spec this
  branch's date-field swap never touches: `gantt-parity.spec.ts:330`
  connector create/delete (delete-dependency button not visible on the first
  attempt), `kanban-dnd.spec.ts:939` cross-view parity (order mismatch),
  `list-dnd.spec.ts:66` cross-status reorder (index off), and
  `kanban-dnd.spec.ts:982` mobile touch reorder (position off). None of these
  block Task 5's acceptance — all four passed on retry, same as the original
  case above — but they read as the same drag/reorder-timing flake class this
  bullet already flagged rather than four unrelated bugs, so they're recorded
  together here instead of as separate bullets. Worth a dedicated flake-hunt
  pass across `gantt-parity`/`kanban-dnd`/`list-dnd` someday; not scheduled.
  **Still live, same four cases, 10 days on (2026-08-07):** CI run
  `31143153025` (PR #144) reported `4 flaky, 91 passed` and named exactly the
  set above, only shifted by intervening edits — `gantt-parity.spec.ts:330`
  connector create/delete, `kanban-dnd.spec.ts:987` R3 cross-view parity,
  `list-dnd.spec.ts:66` cross-status reorder, and `kanban-dnd.spec.ts:1030`
  mobile touch reorder. The preceding run on `develop` (`31127624026`) hit
  three of the four, dropping only the cross-view parity case. All self-healed
  on `retries: 1` in both runs. Two things this pins down that the 2026-07-28
  note left open: the membership is stable rather than drifting (so it is one
  timing class, not a rolling set of unrelated bugs), and it is independent of
  any one branch's changes — PR #144 touched only test selectors and
  expectations. The flake-hunt pass is still unscheduled; the retry budget
  still absorbs it. Escalate if a fifth case joins or if any of the four ever
  fails through its retry, since `retries: 1` gives exactly one spare attempt
  and nothing here has margin beyond it.
- ~~**Baseline "as-of" default derives "today" in UTC, not local time**
  (pre-existing, unchanged by Task 3/5 — noted while swapping the field to
  `DateField`): `SolvroGantt.tsx:322-326`'s effect seeds `baselineAsOf` via
  `new Date().toISOString().slice(0, 10)` whenever the Lock/Overwrite
  Baseline dialog opens. `toISOString()` is always UTC, so a user east of
  UTC (e.g. UTC+7) opening the dialog after 17:00 local time gets
  YESTERDAY's date pre-filled instead of today's — silently, since nothing
  in the dialog flags the mismatch. The field is directly editable (not
  `clearable`, but not read-only either) so a user who notices can correct
  it by hand before confirming; the risk is a user who doesn't notice and
  locks a baseline dated one day early. Out of scope for Task 3 (which only
  swapped the input's markup to `DateField`, not its date-computation
  logic — see the CHANGELOG's Task 3 entry). Follow-up: derive the default
  from local calendar time (e.g. `dateToDay(new Date())` /
  `format(new Date(), "yyyy-MM-dd")`, both already available via
  `frontend/src/lib/dateField.ts`/`date-fns`) instead of a UTC ISO slice.~~
  **Resolved 2026-07-29**: the date-contract phase's "Local 'today' and
  export-overdue boundaries derive from calendar days" fix switched
  `SolvroGantt.tsx`'s `baselineAsOf` seed to `dateToDay(new Date())`, exactly
  the follow-up this entry asked for; verified in the current tree at
  `SolvroGantt.tsx:324`.

## DateRangeField — deferred findings (2026-07-28, Task 3.5)

User-deferred findings surfaced while closing out Task 3.5 of the ReUI
date-field swap (`docs/plans/reui-date-field-swap-plan.md`, branch
`feat/reui-date-field`) — the `DateRangeField` between-style range picker.
QA green 119/119 under both `TZ=UTC` and `TZ=Asia/Jakarta`; reviewer
verification complete, no blockers. These are accepted-as-deferred
polish/pre-existing items, not outstanding review items.

- **Gantt tree Dates cell shows the range text twice while editing**
  (`frontend/src/components/gantt-v2/TreeCells.tsx:26-58`, `TaskDatesCell`):
  the cell's own trigger `<button>` (rendering `fmtDateRangeDDMM(...)`) stays
  mounted once `editing` flips true, and the `defaultOpen`
  `InlineDateRangeEditor`/`DateRangeField` mounts its own trigger button
  (rendering `formatRangeDisplay(start, end)`) floated below it via the
  wrapping `<span className="absolute right-0 top-full z-50 mt-1">` — both
  show the same start/due range simultaneously. Pre-existing pattern (the old
  two-`DateField` form had the same double-trigger shape), but visually worse
  now that one combined range replaces two separate single-date triggers,
  making the duplication an exact text match instead of two partial ones.
  Polish candidate: hide/collapse the cell button while `editing` is true, or
  render only `DateRangeField`'s own trigger once editing starts.
- ~~**Pre-existing React console warning: "Function components cannot be given
  refs… CalendarDayButton"** (`frontend/src/components/ui/calendar.tsx` +
  `ui/button.tsx` composition): `Calendar`'s `components.DayButton` override,
  `CalendarDayButton` (`calendar.tsx:180`), renders the vendored `Button`
  (`ui/button.tsx:44`), a plain function component with no
  `React.forwardRef`. `react-day-picker` passes a ref to each day button for
  its own keyboard-focus management, so every calendar render (both
  `DateField` and the new `DateRangeField`) fires this warning in dev.
  Predates this branch — introduced when `Button`/`Calendar` were vendored in
  the 2026-07-25 shadcn bootstrap — surfaced here because `DateRangeField` is
  a second, higher-traffic mount point for the same composition. Fix
  candidate: wrap `Button` in `React.forwardRef`, or have `CalendarDayButton`
  render a plain `<button>` with the same class list instead of the `Button`
  component.~~ **Resolved 2026-07-31**: the ReUI Filters phase wrapped
  `ui/button.tsx`'s `Button` in `React.forwardRef` (React 18 needs it as a
  prop-plumbed ref, unlike the React-19-targeting registry) — exactly the
  first fix candidate above — closing the warning at its root; verified via
  the CHANGELOG's "Vendored controls forward refs on React 18" entry, which
  names this exact warning as gone.
- ~~**East-of-UTC display quirk: a freshly picked day in the
  local-midnight-convention editors re-displays one day earlier after
  save+reopen** (`DateRangeField`/`InlineDateRangeEditor`, observed during
  Task 3.5 verification, Asia/Jakarta UTC+7): picking a day writes
  `isoFromDay`'s local-midnight ISO (`frontend/src/lib/dateField.ts:67-72`,
  `` new Date(`${day}T00:00:00`).toISOString() ``), which east of UTC
  serializes to the PREVIOUS UTC calendar day; reopening the editor reads
  that ISO back through `dayFromIso`'s UTC slice (`dateField.ts:53-59`,
  `iso.slice(0, 10)`), so the picker shows the day before the one actually
  clicked. This is the same lossy local-midnight-write / UTC-slice-read
  mechanism already root-caused in the "ReUI DateField swap — deferred
  findings" section above (its Task 3/5 "Root cause, spelled out explicitly"
  paragraph) — cross-referenced here rather than re-explained; no new root
  cause, just a newly observed symptom of it inside the range picker
  specifically. Preserved deliberately for byte-parity with the pre-swap
  inline editors (see `dateField.ts`'s module doc); follow-up is the same one
  already filed above (pick one canonical write convention, plus a data
  migration for already-stored rows).~~ **Resolved 2026-07-29**: `isoFromDay`
  now writes UTC-midnight ISO (`${day}T00:00:00.000Z`), the same canonical
  rule `dayFromIso` reads by, so this write/read mismatch no longer exists —
  same fix and same CHANGELOG entries as the cross-referenced "Display-
  representation mismatch" entry above, which carries the full resolution
  note.

## Date contract UTC-midnight unification — deferred findings (2026-07-29)

User-deferred findings surfaced during the phase that unified all task-date
reads on "a task date's calendar day is the UTC date-part of its stored
instant" (writer fix in `dateField.ts`'s `isoFromDay`, read-path unification
across views, branch `fix/date-contract-utc-midnight`). Out-of-scope-by-plan
backend items, deliberately not fixed in this phase.

- ~~**`/tasks?overdue=true` filters by instant-vs-server-now, not calendar-day**
  (`backend/src/routes/tasks.ts:92`): `where.dueDate = { lt: new Date() }`
  compares the stored instant against the server's exact current instant,
  while this phase moved all client-side overdue logic to calendar-day-string
  comparison (`dayFromIso(dueDate) < dateToDay(today)`). Consequence: once any
  time has elapsed past UTC midnight on the due day, a task due *today* already
  satisfies `dueDate < new Date()` and the API reports it as overdue, while the
  frontend (correctly, post-fix) renders it as not-overdue — a route/UI
  disagreement for any caller that trusts the `overdue=true` filter directly
  rather than re-deriving the flag client-side. Fix direction: compare against
  UTC midnight of the server's current calendar day, or a lexicographic
  day-string compare, consistent with the frontend's new rule.~~ **Resolved
  2026-08-02** (Issues Sweep #1): the frontend now sends its local calendar
  day (`today=yyyy-MM-dd`, validated server-side) with overdue-filtered task
  queries, and `routes/tasks.ts` compares against that day's UTC midnight via
  the new `backend/src/lib/dateBoundary.ts` (falling back to the server's UTC
  day for direct API callers without `today`). Combining `status` with
  `overdue=true` also no longer silently discards the status filter — see the
  next entry's CHANGELOG reference. Covered by three new backend test suites
  (`backend/test/tasksOverdue.test.ts` and siblings). See CHANGELOG's
  "Overdue follows the viewer's calendar day; the status filter is no longer
  discarded" entry.
- ~~**Portfolio rollup `isOverdue`/`daysOverdue` compare against the server's
  LOCAL midnight, not UTC** (`backend/src/lib/portfolio.ts:74-80`):
  `startOfToday` (lines 46-47) is built via `new Date(); setHours(0,0,0,0)` —
  the server process's local midnight, not UTC midnight. On a server host
  configured west of UTC, a project due exactly today can mis-flag as
  overdue (or the reverse, east of UTC) — the same defect class this phase's
  frontend-side fix addressed via calendar-day comparisons in
  `ProjectOverview.tsx`, `Tasks.tsx`, `ProjectTimeline.tsx`, and
  `DailyReview.tsx`. Fix direction: derive the boundary from UTC midnight (or
  a day-string compare) so the rollup's overdue flag is timezone-independent,
  matching the read-path unification this phase applied everywhere else.~~
  **Resolved 2026-08-02** (Issues Sweep #1): `computePortfolioRows` now
  accepts the caller's `today` day string (threaded from `routes/overview.ts`
  and `routes/reports.ts`'s executive report) and derives `startOfToday` via
  the same `lib/dateBoundary.ts` UTC-midnight boundary as the tasks route,
  replacing the server-local-midnight `setHours(0,0,0,0)` computation. Also
  fixed in the same change: a non-midnight due instant now counts a full day
  overdue instead of rounding to zero (`daysOverdue` floors `endMs` to its
  own UTC calendar day first). Covered by `backend/test/portfolioOverdue.test.ts`
  and `portfolioRouteToday.test.ts`. See CHANGELOG's "Overdue follows the
  viewer's calendar day..." entry.
- **`backend/tsconfig.json`'s `include` never reaches `scripts/` or `test/`**
  (`backend/tsconfig.json:17`, `"include": ["src/**/*.ts"]`): the
  CLAUDE.md-documented backend typecheck gate (`npx tsc --noEmit`) only ever
  resolves `src/**/*.ts`, so this phase's new `backend/scripts/normalize-day-dates.ts`
  — and every pre-existing script under `backend/scripts/` — is type-exercised
  only incidentally, by `tsx` at runtime or by `vitest` importing it in tests,
  never by the dedicated typecheck gate. Fix direction: broaden `include` to
  cover `scripts/**/*.ts` and `test/**/*.ts`, or add a second `tsconfig`
  scoped to those directories and run it alongside the main gate.

## Sortable reorder (sections + subtasks) — deferred findings (2026-07-30)

User-deferred findings from the phase review of `feat/reui-sortable`
(vendored ReUI `Sortable` into `frontend/src/components/reui/sortable.tsx`;
backend dense re-pack on `PATCH /sections/:id`; the "Reorder sections" modal;
drag-only subtask reorder in `TaskPanel.tsx`). The reviewer cleared all
blockers; these are accepted-as-deferred, not outstanding review items.

- **TaskPanel subtask drag has a possible snap-back flicker before the
  reorder commits** (`frontend/src/components/TaskPanel.tsx:493`): the
  Sortable's `onValueChange` is a deliberate no-op — `subtasks` is derived
  from the tasks query, not local state, so the DOM keeps the pre-drop order
  until `useUpdateTask`'s `onMutate` optimistic re-pack lands, and that
  handler first `await`s `qc.cancelQueries`. A visible snap-back flicker is
  possible in the window between drop and that await resolving.
  `SectionReorderModal` avoids this by holding local order state
  (`order`/`setOrder`) instead. Deliberate asymmetry between the two
  surfaces, documented in code at the no-op site; fix direction if it proves
  visible in practice would be giving TaskPanel's subtask list the same local
  mirror pattern.
- **`SectionReorderModal` has no permission check of its own**
  (`frontend/src/components/SectionReorderModal.tsx`, whole file — no
  `canEdit`/permission reference anywhere in it): it relies wholly on
  `ProjectList.tsx`'s `canEdit` gate on the "Reorder sections" entry button
  that opens it, unlike `TaskPanel.tsx`'s subtask handle, which defensively
  re-checks `canEdit` itself (only renders `SortableItemHandle` when
  `canEdit`, per the phase's CHANGELOG entry). Inconsistent defense-in-depth
  between the two new reorder surfaces; low risk today since the only mount
  site is already gated, but a future second entry point would silently
  inherit no protection.
- **`useUpdateSection`'s mutation-scope serialization can diverge from the
  server on a failing PATCH** (`frontend/src/lib/queries.ts:865-906`): the
  `scope: { id: sections-${projectId} }` on `useUpdateSection` serializes
  concurrent section PATCHes for the same project (so two fast drops can't
  land out of order), but if a queued drop's predecessor errors, that
  predecessor's `onError` rollback (`:902`) discards the optimistic write of
  every mutation still queued behind it in the scope, and the queued
  mutation then proceeds against a server that never applied the failed one.
  `SectionReorderModal` shows a diverged order until the modal is reopened
  (its local `order` state is only re-seeded on the open transition, per its
  own comment at `SectionReorderModal.tsx:39-56`). Only reachable when a
  `PATCH /sections/:id` actually fails mid-session.
- **Vendored `sortable.tsx` puts every `SortableItem` in the tab order,
  even for read-only viewers** (`frontend/src/components/reui/sortable.tsx:359`,
  the `...attributes` spread from dnd-kit's `useSortable` onto the item's
  root element): dnd-kit's default `attributes` include `role="button"`
  and `tabIndex={0}`, applied unconditionally to every `SortableItem`
  regardless of whether a handle is rendered for it. In `TaskPanel.tsx`, the
  drag handle (`SortableItemHandle`) is only rendered when `canEdit` is
  true, but the row itself is still focusable — a read-only user tabs
  through inert, focusable subtask rows that do nothing on Enter/Space.
  Vendor-level (upstream dnd-kit + ReUI behavior, not Solvro-authored code);
  fixing it means patching the vendored file, which requires a `//
  SOLVRO PATCH` marker plus bumping `gates.sh`'s
  `EXPECTED_SORTABLE_PATCHES` counter and a matching CHANGELOG entry, per
  the guardrail-sortable-vendor drift guard.
- **`SectionReorderModal`'s drag-guard can strand the modal if a drag never
  cleanly ends** (`frontend/src/components/SectionReorderModal.tsx:69-72`,
  `handleModalClose`): `isDraggingRef.current` blocks every close route
  (Escape, backdrop click, header X) while a drag is in progress, and is
  only reset on the Sortable's own `onDragEnd`/`onDragCancel` callbacks or
  on the next open/close effect run (`:39-44`). A drag start that never
  pairs with an end/cancel callback — e.g. a pointerup lost outside the
  viewport, a known dnd-kit sensor gap that also affects the Kanban board —
  leaves `isDraggingRef.current` stuck `true`, and the reset effect can't
  fire because its dependency array is `[open]` (self-sealing: the modal
  never re-runs the effect while it's already open and can't close to
  re-run it). Escape hatch candidate: exempt the header X specifically from
  the guard, so there's always one way out regardless of drag state.
- **No dedicated Playwright drag-interaction spec for either new reorder
  surface** (phase plan decision, not a review finding): neither the
  "Reorder sections" modal nor `TaskPanel`'s subtask drag has an e2e spec
  exercising the actual drag gesture; `.claude/scripts/gates.sh`'s
  `playwright-smoke` gate covers load/render regressions only. Deferred by
  plan, not forgotten — candidate for a future e2e pass alongside the
  existing Gantt/Kanban drag specs (`gantt-parity.spec.ts`, `kanban-dnd.spec.ts`,
  `list-dnd.spec.ts`).

## ReUI Presentation Set — deferred findings (2026-07-31)

User-deferred findings from the ReUI Presentation Set phase (vendored
`Timeline`/`Alert`/`Frame`/`IconTile`/`IconStack` into
`frontend/src/components/reui/`; consumer surfaces: `EmptyState.tsx`,
`ProjectTimeline.tsx`, and the form-error callouts in `Login.tsx`,
`TaskFormModal.tsx`, `ProjectFormModal.tsx`, `CustomerFormModal.tsx`,
`RiskFormModal.tsx`). The phase review cleared all blockers; these are
accepted-as-deferred, not outstanding review items.

- ~~**Form-error `Alert` migration covers 5 of 26 `bg-error-container` callout
  sites** (the five modal/drawer/login edit-error boxes listed above) — the
  remaining 21 are a deferred sweep for a later phase. One confirmed
  example: `frontend/src/pages/views/ProjectTimeline.tsx:82` still renders a
  raw `bg-error-container` div for its page-level task-fetch error banner —
  a different error path from the edit-dialog error this phase migrated.
  Follow-up: migrate the remaining callout sites onto the vendored `Alert`
  in a dedicated pass.~~ **Resolved 2026-08-02** (Issues Sweep #1): the
  remaining ad-hoc `bg-error-container` callout boxes (24 sites across
  `pages/`, `pages/views/`, `components/`, incl. the cited
  `ProjectTimeline.tsx` banner and the Gantt/Kanban engines' error banners)
  now render on the vendored `Alert`. Verified in the current tree: every
  remaining `bg-error-container` occurrence is a chip/badge/hover-state use
  (risk-score bands in `RiskFormModal.tsx`/`ProjectRisks.tsx`, status pills,
  action-button hover backgrounds) — deliberate carve-outs, not missed
  callouts. See CHANGELOG's "Error callouts on the vendored Alert
  everywhere" entry.
- **Stat-card `Frame` evaluation deferred**: whether `Overview.tsx`'s and
  `Executive.tsx`'s KPI stat cards should adopt the vendored `Frame` is
  deferred to the Phase 4 "leftovers" sweep of the ReUI migration roadmap
  (`docs/plans/reui-component-migration.md`).
- **`IconTile`'s `outline` variant is invisible-by-default in dark theme
  on a `surface-container-lowest` background** (`frontend/src/components/reui/icon-tile.tsx`):
  the variant's base `bg-background` (`#1a1a18` in dark) is the same value
  as `surface-container-lowest` (also `#1a1a18`), so on a surface at that
  container level (e.g. `EmptyState`'s `Frame`) the tile's own fill is
  invisible — the visible fill comes only from its `dark:bg-input/32` rule
  layered on top. Worth knowing before this variant is reused on a
  differently-toned surface; verify contrast there rather than assuming the
  `outline` variant reads consistently everywhere.
- ~~**Dev-DB residue from visual verification**: a scratch "Timeline Check"
  customer + project (5 tasks) was seeded while manually verifying the
  `ProjectTimeline` change across themes/widths. No `DELETE /projects/:id`
  route exists (see the "Missing DELETE /projects/:id route" tech-debt entry
  above) — remove via the UI if unwanted, or fold into the same cleanup pass
  as the other dev-DB junk-data entries in this file.~~ **Resolved 2026-08-02**
  (Issues Sweep #1): the "Timeline Check" scratch data was deleted along with
  the other dev-DB junk — see the "Backend test-DB isolation is broken"
  entry above for the row counts.

## ReUI Filters phase — deferred findings (2026-07-31)

User-deferred findings from the ReUI Filters phase (vendored
`frontend/src/components/reui/filters.tsx` and six `ui/` form primitives;
chip-toolbar migrations on `Tasks.tsx` and `Projects.tsx`; app-wide
form-control focus unification; React 18 `forwardRef` fixes). The phase
review cleared all blockers; these are accepted-as-deferred, not outstanding
review items.

- ~~**Duplicate-chip mouse race** (upstream Base UI × vendored ReUI interaction,
  not a Solvro defect): per the phase reviewer, Base UI's
  `useMenuItemCommonProps` fires a programmatic `itemRef.current.click()` on
  mouseup once `allowMouseUpTriggerRef` is armed (a trigger press held
  ≥200ms; submenus share the parent trigger's ref), and `MenuCheckboxItem`
  fires `onCheckedChange` on every click — programmatic or natural. The
  keyboard path never enters this at all. The amplifier, and the definitive
  fix site, is `frontend/src/components/reui/filters.tsx`'s `addFilter`
  (~:2109-2116): it appends a new chip unconditionally — fresh id, no
  idempotence guard, ignores `allowMultiple` — so a raced double-activation
  can append the same field+value twice. The guard belongs there: skip the
  append if a chip with the same field+value already exists. Current
  shielding is incidental and per-consumer, not a fix: Tasks shields via
  `allowMultiple={false}`, which unmounts the just-committed field's row
  before the raced second activation lands (observed 0/6 on repro, was 2/2
  before that shielding existed); Projects shields because its chip state is
  derived from the URL, which collapses duplicate values. Re-exposure
  condition: any future filter-toolbar consumer that leaves `allowMultiple`
  at its default `true`, or that holds chip state locally instead of from a
  single source of truth. Note: Projects' customer submenu renders 400+
  options in dev, which widens the race window by lengthening render time
  between mousedown and mouseup. No e2e spec covers either filter toolbar
  today, so there is no automated regression cover for this.~~ **Resolved
  2026-08-02** (Issues Sweep #1): the definitive fix landed exactly where
  this entry called for it — `filters.tsx`'s module-level `findFilterMatch`
  (unit-tested in the new `filters.test.ts`) is now consulted by every
  unconditional chip-append call site (`addFilter`, the single-remaining-
  field direct list, and both branches of the field-then-value submenu
  flow), skipping the append (or adopting the existing chip's id into the
  session) when a chip with the same field+values already exists. **Residual
  (not fully closed):** the upstream Base UI mouseup-double-fire itself
  remains unreproducible on demand — the new
  `e2e/tests/filters-duplicate-chip.spec.ts` is an invariant net (asserts
  "never more than one chip per field" under a manufactured long-press
  approximation), not a spec that discriminates the exact upstream race;
  the deterministic proof of the guard's own logic is `filters.test.ts`. See
  CHANGELOG's "Focus/shadow stragglers unified; duplicate filter chips
  guarded" entry.
- **Pointer-dependent initial submenu highlight** (cosmetic, upstream
  hover-follows-highlight behavior): when a submenu opens, whichever row the
  repositioned popup happens to land under the cursor wins the highlight
  over the component's own `setHighlightedIndex(0)` call. The only visible
  edge is a blind Enter-key press picking a different row than expected. Not
  worth a vendored patch.
- ~~**Old focus/shadow style survivors after the focus-style unification**
  (unification-tail entry — this phase's "one focus style" pass across
  `ui/button.tsx`, `checkbox.tsx`, `calendar.tsx`, `input.tsx`, `textarea.tsx`,
  and `input-group.tsx` did not reach every file that still carries the old
  treatment): `ui/scroll-area.tsx:21` still has `ring-[3px] ring-ring/50`
  (renders inside every filters options list), as do
  `reui/autocomplete.tsx:27`, `reui/gantt/gantt-bar.tsx:293`, and
  `reui/gantt/gantt-view.tsx:2279`. The old `shadow-xs` is also still open at
  `reui/gantt/gantt-view.tsx:3695` and, non-vendored, at
  `gantt-v2/SolvroBar.tsx:154,165` (Solvro-owned code, so no re-pull excuse
  for that last pair). Follow-up: one dedicated pass finishing the
  unification across these files.~~ **Resolved 2026-08-02** (Issues Sweep
  #1): all five sites now use the sanctioned
  `focus-visible:border-primary focus-visible:ring-2
  focus-visible:ring-primary/30` treatment and the `shadow-xs` drops, with
  `// SOLVRO PATCH` markers on the two vendored files. Verified in the
  current tree. See CHANGELOG's "Focus/shadow stragglers unified; duplicate
  filter chips guarded" entry.
- **Toolbar text-size drift** (deliberate-answer-pending density note, not a
  defect): the migrated filter rows mix a 15px chip label with 13px
  checkbox-row text and a 12px Reset control — the pre-migration dropdown
  rows were a uniform 12-13px. Recorded for an explicit future call on
  whether the chip row should match the old uniform density or keep its
  current mixed scale.

## ReUI Data Grid phase — deferred findings (2026-08-01)

User-deferred findings from the ReUI Data Grid phase (vendored
`frontend/src/components/reui/data-grid/` family, `reui/badge.tsx`,
`ui/select.tsx`, `ui/skeleton.tsx`, `ui/spinner.tsx`; migrated the Admin
Users table, the CustomerDetail Overview projects table, and the Tasks
cross-project list onto the grid; `Customers.tsx` card shells onto `Frame`;
the `lib/utils.ts` tailwind-merge classifier fix). The phase review cleared
all blockers; these are accepted-as-deferred, not outstanding review items.

- **Badge solid-tone variants are NOT FOR USE until the Phase 4 chip rebase**
  (`frontend/src/components/reui/badge.tsx:31-52`): the `info`/`success`/
  `warning` variants render white text on a solid full-opacity tint fill in
  dark mode at ≈1.2-1.3:1 contrast (near-invisible) — those three tokens are
  calibrated as text-on-tint colors (the `Alert` component's existing usage),
  not vivid solid-fill colors. `destructive` is milder (white on dark-mode
  `--error` ≈2.8:1, below AA but not near-invisible) and isn't the same
  combination `ui/button.tsx`'s destructive variant ships (Button also mixes
  in `dark:bg-destructive/60`, which this Badge variant lacks). All four
  variants have zero consumers today — only `secondary`/`outline` are
  consumed, by `data-grid-column-filter.tsx`'s selected-count chips. The
  correct rendering for a status chip today is DESIGN.md §1's chip
  background/text pair, not one of these solid tones; the constraint comment
  lives in-code at the cited site. Flagged for whoever wires one of the tone
  variants up before Phase 4 decides on a real solid-fill tone family.
- **Nested anchors in `Customers.tsx`** (`frontend/src/pages/Customers.tsx:126,184`):
  the customer card's outer `<Link to={.../customers/:id}>` wraps an inner
  `<Link to={.../projects?customerId=...}>` ("View projects →") — invalid
  HTML (nested `<a>`), pre-existing before this phase's `Frame` refactor
  (the refactor swapped the hand-rolled bordered `div` for `Frame` inside the
  same outer `Link`; the nesting itself is untouched). Survives only because
  React's synthetic event system and browsers' lenient parsers don't enforce
  the HTML spec here — the inner link's `stopPropagation` masks the practical
  symptom (a real nested-anchor click in a spec-compliant parser closes the
  outer tag early). Real fix requires restructuring the card away from a
  wrapping anchor (e.g. make the card a non-interactive container with an
  absolutely-positioned "stretched link" for the primary click target, and a
  sibling link for the secondary action).
- **`data-grid-column-header.tsx`'s `hasControls` branch ignores the
  right-align convention** (`frontend/src/components/reui/data-grid/data-grid-column-header.tsx:434-439`):
  the branch rendering a column's move/pin/visibility dropdown doesn't honor
  `meta.headerClassName: "text-right"` the way the plain sortable-label path
  does (see `alignEnd`, same file). Unreachable under the current feature
  floor — no shipped grid enables column filters/move/visibility/pin — so
  nothing renders misaligned today. A `SOLVRO PATCH note — KNOWN GAP` marker
  is already at the site; the first column that pairs `hasControls` with a
  right-aligned header needs this branch taught the same trick.
- ~~**Four hand-rolled tables remain un-migrated**: `frontend/src/pages/Admin.tsx`'s
  Roles tab (`:839`) and Project Overrides tab (`:1438`) — highest-value
  follow-up, since they're one tab-click away from the just-migrated Users
  tab in the same file and page; `frontend/src/components/services/ServiceCatalogueManager.tsx:152`;
  `frontend/src/pages/views/ProjectRisks.tsx:193`. Candidates for the next
  data-grid migration pass.~~ **Resolved 2026-08-02** (Issues Sweep #1): all
  four now render on the vendored `DataGrid`. See CHANGELOG's "Admin's Roles
  and Project Override tabs join the data grid" and "Service Catalogue and
  project Risks tables on the data grid" entries.
- ~~**Admin Users tab's grid container sits on `surface-container-lowest`,
  lighter than its sibling tabs' `bg-surface` tables** (in light theme;
  reversed in dark theme — see below): `Admin.tsx:585`'s
  `<DataGridContainer className="... bg-surface-container-lowest">` vs. the
  Roles tab's `<div className="... bg-surface">` (`Admin.tsx:838`) and the
  Project Overrides tab's equivalent wrapper. Per DESIGN.md §1,
  `surface-container-lowest` is `#ffffff` / `surface` is `#f9f9f7` in light
  theme (lowest reads lighter), but `#1a1a18` / `#232321` in dark theme
  (lowest reads darker) — so the three tabs' panels are tonally inconsistent
  in both themes, just in opposite directions. Cosmetic; not blocking.~~
  **Resolved 2026-08-02** (Issues Sweep #1): the Roles and Project Override
  tabs' new `DataGrid`s use the same `bg-surface-container-lowest` as the
  Users tab (`Admin.tsx`, verified in the current tree), unifying all three
  panels' tone.
- ~~**Admin KPI strip renders zeros during the load window** beside a
  skeletoned grid, instead of the previous blocking loading message
  (`Admin.tsx:90-97`, `UsersTab`'s `rows = users ?? EMPTY_USERS` fallback,
  deliberate per its own in-code comment — "Loading-safe fallback (fix round
  S2)"): every KPI count (`Admin.tsx:439-444`) reads through `rows`, so
  before the first response lands they render `0`/`0 active · 0 admins`
  etc. next to the grid's own skeleton rows, rather than the old
  whole-component loading gate. Options: skeleton or em-dash the KPI strip
  during `isLoading`, or accept the flash as-is.~~ **Resolved 2026-08-02**
  (Issues Sweep #1): the KPI strip now renders `"—"` per stat while
  `isLoading`, instead of asserting `0`. See CHANGELOG's "Admin's Roles and
  Project Override tabs join the data grid; KPI strip stops flashing zeros"
  entry.
- **`text-[10px]` "Needs role" chip has no scale token** (`Admin.tsx:243`,
  the amber "Needs role" badge on PENDING users): the smallest named
  typography role is `text-label-caps` at 12px (DESIGN.md §2); 10px has no
  token. Three other `text-[10px]` sites exist in the same file
  (`Admin.tsx:877,1119,1313`, unrelated chips/links) — not part of this
  finding, just noted as siblings. Note for if a micro-label token is ever
  wanted; not worth inventing one for a single badge today.
- ~~**`frontend/src/lib/tableSort.ts`'s `personNameSortingFn` is typed
  `SortingFn<any>`** (`tableSort.ts:20`, with an
  `eslint-disable-next-line @typescript-eslint/no-explicit-any` — moot today
  since the repo has no lint config/gate, see the existing "ESLint
  `exhaustive-deps` disable comment is inert" tech-debt entry above): a
  generic `SortingFn<TData>` signature would restore compile-time guarding
  against accidentally wiring this sort function onto a non-string column.
  Works correctly today (both consumers pass string-valued columns);
  follow-up is a type-safety tightening, not a behavior fix.~~ **Resolved
  2026-08-02** (Issues Sweep #1): `personNameSortingFn` is now generic over
  `TData extends RowData` instead of `SortingFn<any>` — no `any` escape
  hatch, no per-consumer cast. See CHANGELOG's "Admin's Roles and Project
  Override tabs join the data grid" entry.
- ~~**Backend `/tasks?overdue=true` still compares a server instant, not a
  calendar day** (`backend/src/routes/tasks.ts:91-94`,
  `where.dueDate = { lt: new Date() }`) — re-surfaced during this phase's
  review while cross-checking the migrated `Tasks.tsx` grid's per-row
  OVERDUE badge, which (correctly, per the date-contract phase) compares
  calendar-day strings (`Tasks.tsx:218-219`,
  `dayFromIso(task.dueDate)! < todayDay!`). Verified in the current tree:
  **both paths already exclude `DONE` tasks** (backend:
  `where.status = { not: "DONE" }`; frontend: `task.status !== "DONE"`), so
  this is not a DONE-exclusion gap. The real, pre-existing gap is the
  instant-vs-calendar-day date boundary itself — already tracked above under
  "Date contract UTC-midnight unification — deferred findings (2026-07-29)"
  → "`/tasks?overdue=true` filters by instant-vs-server-now, not
  calendar-day". Not re-filed as a separate entry; cross-referenced here
  since this phase's review surfaced it again at a new call site
  (`Tasks.tsx`'s migrated grid).~~ **Resolved 2026-08-02** (Issues Sweep
  #1): fixed at the entry this cross-referenced — see "`/tasks?overdue=true`
  filters by instant-vs-server-now, not calendar-day" below.

## Issues Sweep #1 — residuals (2026-08-02)

New findings surfaced while closing out Issues Sweep #1 (all four ledger
batches — Data Grid Admin/Risks/ServiceCatalogue migrations, the ⌘K palette
fixes, the focus/shadow + duplicate-chip guard, the overdue date-contract
fix, and the dev-DB cleanup). Not blockers — the phase review cleared all
findings; these are accepted-as-deferred.

- **`data-grid-column-header.tsx`'s sortable path supports left/right
  alignment only, not center** (`frontend/src/components/reui/data-grid/data-grid-column-header.tsx`,
  see its `alignEnd`): `ProjectRisks.tsx`'s Probability/Impact columns had to
  be left `enableSorting: false` specifically so their headers could stay
  centered (matching the pre-DataGrid table's `text-center` treatment) —
  documented in-file at both column definitions. A vendored change (new
  `alignCenter` handling alongside `alignEnd`) is needed before a sortable
  column can be centered; distinct from the pre-existing "`hasControls`
  branch ignores the right-align convention" finding above (that one is
  about the move/pin/visibility-dropdown path, this is about the plain
  sortable-label path).
- **`e2e/tests/filters-duplicate-chip.spec.ts` is an invariant net, not a
  discriminating regression test** for the duplicate-chip guard: it proves
  "never more than one chip per field survives repeated add attempts" via a
  manufactured ≥200ms long-press on a value option (documented in the spec's
  own header comment as "the closest reproducible approximation," not the
  exact upstream Base UI mouseup-double-fire). The upstream race remains
  unreproducible on demand. The deterministic proof of the guard's own
  comparison logic is `frontend/src/components/reui/filters.test.ts`, not
  this e2e spec.
- **The duplicate-chip guard's `===` comparison bypasses object-valued
  filter options** (`frontend/src/components/reui/filters.tsx`'s
  `findFilterMatch`, documented in its own module comment): correct for
  every current filter field (all string-valued), but a future consumer
  with object-valued filter values would silently fail to dedupe — no
  current consumer is affected.
- **`frontend/src/components/reui/filters.test.ts` colocates a
  Solvro-authored test inside the vendored `reui/` tree**, importing
  `findFilterMatch` — a `// SOLVRO PATCH` export that a future shadcn/ReUI
  CLI re-pull of `filters.tsx` would delete, silently breaking this test's
  import. The `EXPECTED_FILTERS_PATCHES` counter in `.claude/scripts/gates.sh`
  (currently 18, matching the file) is the only guard that would catch a
  re-pull stripping the patch; there's no separate guard protecting the test
  file's import specifically.
- **Admin Project Overrides tab's reassign `<select>` × row count is a
  pre-existing scale hazard, now masked by the dev-DB cleanup**
  (`frontend/src/pages/Admin.tsx`'s `tamCandidates.map(...)` inside the
  `reassign` column's cell, one `<select>` per row, one `<option>` per
  candidate; the grid itself has pagination "OFF" by phase-wide convention):
  harmless at the post-cleanup dev-DB scale (144 projects, 8 users), but a
  production-scale DB would still render every candidate as an unfiltered
  `<option>` in every visible row's dropdown — the same shape as the
  existing "`GET /users` is unpaginated" finding (Kanban → ReUI swap
  section above), applied to this specific grid.

## Gantt visual refresh — deferred findings (2026-08-03)

User-deferred findings from the Gantt visual refresh phase (T1–T6: toolbar
navigation, tree status/due columns, hatched bar treatment + squared section
rollups, floating zoom, per-row action menu, toolbar pill restyle — branch
`feat/gantt-visual-refresh`). The phase review cleared all blockers; these
are accepted-as-deferred, not outstanding review items.

- **Screen and PDF export diverge on two bar treatments this phase
  introduced, both deliberate and out of the phase's scope by plan**
  (`frontend/src/components/gantt-v2/SolvroBar.tsx` vs.
  `frontend/src/lib/gantt/exportPdf.ts`): (a) the live Gantt now hatches a
  task bar's INCOMPLETE portion (`SolvroBar.tsx`'s
  `progressHatchBackground`), while `exportPdf.ts` still draws the old flat
  black overlay over the COMPLETED portion (`exportPdf.ts:634-656`,
  `PROGRESS_OVERLAY_ALPHA`); (b) the live section rollup is now a thin bar
  with squared end caps (`SolvroBar.tsx`'s `data-rollup`), while the PDF
  still draws a rounded pill (`exportPdf.ts:561`,
  `fillRoundedRect(..., 1.5)` corner radius). `exportPdf.ts`'s own in-file
  comment (~:542-548) documents both as an accepted, unsynced screen/export
  divergence — not a bug, not scheduled.
- **`TaskFormModal.tsx`'s create-mode parent picker offers subtasks, which
  the server then rejects** (`TaskFormModal.tsx:129-131`,
  `possibleParents`): in edit mode the filter excludes subtasks
  (`t.parentTaskId === null`), but in create mode (`!editingTask`
  short-circuits the filter to always-true) every project task is listed,
  subtasks included — picking one as a parent 400s server-side via
  `assertValidParent`'s max-depth-1 guard
  (`backend/src/lib/taskOrdering.ts:134-140`, called from
  `routes/projects.ts:362`). Pre-existing (predates this phase),
  independently confirmed by two reviewers during this phase's review.
  Fix direction: apply the same `t.parentTaskId === null` filter regardless
  of edit/create mode.
- **Two shadow-doctrine holdouts remain after this phase's context-menu and
  export-dropdown fix** (DESIGN.md §4 elevation whitelist): `SolvroGantt.tsx:1671`'s
  baseline-locked toast still uses raw `shadow-md` (a second property on
  the same site already flagged for raw `emerald-*` utilities in the
  2026-07-25 "Final whole-branch review additions" entry above);
  `frontend/src/components/reui/gantt/gantt-dnd.tsx:310`'s drag-clone
  element (`barEl.className = "shrink-0 rounded-sm shadow-lg"`) is vendored
  and carries no `// SOLVRO PATCH` marker. Both are follow-up candidates,
  not fixed this phase — this phase's shadow work was scoped to the row
  context menu and export dropdown only. **Narrowed 2026-08-31** (Gantt
  toolbar one-row phase): the first holdout is moot — the baseline-locked
  toast (and its raw `shadow-md`) was removed from `SolvroGantt.tsx`
  entirely, replaced by an inline status line in `RightSidebar.tsx`'s new
  Baseline section (see the "Final whole-branch review additions" entry
  above). Only the `gantt-dnd.tsx:310` vendored drag-clone `shadow-lg`
  still stands.
  *Updated 2026-09-02 (code check)*: the first holdout is moot (the Baseline section uses an inline `baselineNotice` string, no toast); only `reui/gantt/gantt-dnd.tsx:310` (`shadow-lg` on the drag clone) remains, still without a `// SOLVRO PATCH` marker.
- **A sortable row's accessible name concatenates every control inside it,
  and each row carries an extra tab stop.** `reui/sortable.tsx:359` spreads
  dnd-kit's `attributes` onto the row element, which carry `role="button"` +
  `tabIndex=0`; the row's computed name is therefore the join of its
  children's labels. In `TaskPanel.tsx`'s subtask list that now reads
  "Mark done <title> Rename <title> Reorder subtask", and a real `<button>`
  sits nested inside a `role="button"`. Surfaced while adding the subtask
  rename control (2026-08-07); not fixed there because the defect is in the
  vendored row, and `reui/` is on the spine list — a presentation-only fix
  would pull an instant opus review onto an otherwise unrelated diff.
  Fix direction: give the row an explicit `aria-label` (or move the
  drag attributes onto the handle, which already owns the listeners).
- **`createTask` is duplicated across e2e specs.** A shared
  `createTask` now lives in `e2e/fixtures/seed.ts` alongside `getTasks`, but
  `date-picker.spec.ts:157` and `gantt-parity.spec.ts:57` still carry their
  own private copies that predate it. Folding them in is mechanical but
  re-runs two slow specs, so it was left out of the 2026-08-07 subtask-edit
  phase rather than widening that diff.

## Pipeline native port — accepted risks & deferred items (2026-08-15)

Collected across the six-milestone native port (branch `velora-integration`); every
blocking finding was fixed pre-PR — these are the consciously accepted leftovers.

- **`xlsx@0.18.5` ships known npm-audit advisories (prototype pollution, ReDoS) —
  accepted for v1.** The parse is 100% client-side, in the authenticated user's own
  tab, on a file that user personally chose; the server never parses a workbook, so
  there is no remote-attacker path. Upgrade path if a dependency-audit policy ever
  lands: SheetJS's own 0.20.x registry (not npm). No `npm audit` gate exists in CI
  today, so this cannot break the merge gate.
- **PRD §2.7's per-PIC Overview summary cards are deliberately omitted** — the
  Overview panel ships KPI tiles + a stage distribution; the per-PIC drill-down is
  fully realized on the Executive dashboard instead. Spec deviation on record, not
  an unimplemented gap.
- **App-wide light-theme hover contrast (pre-existing, NOT pipeline)**:
  `hover:bg-primary-container` paired with `text-on-primary` renders ≈1.3:1 in
  light theme (white label on pale green) across 15+ sites (Admin, Settings,
  Pipeline, gantt, DateRangeField…). The pipeline buttons just follow the house
  pattern; fixing it is one global ticket, not per-feature.
- **DealCard on a project's Overview tab reads the full deal list client-side**
  (`useOpportunities().find(projectId)`) — fine at the PRD's "hundreds of deals"
  scale and cache-shared, but PRD §3.3's ~2k-deal revisit trigger applies to this
  call site too.
- **Backend `tsx watch` inotify staleness** observed once on the dev stack (file
  edits silently not picked up until `docker compose restart backend`). If the API
  ignores fresh code, restart the container before debugging deeper.
- **`backend/tsconfig.json` excludes `scripts/` from the typecheck gate**
  (pre-existing — `create-admin.ts` too). `import-velora.ts` was hand-typechecked
  clean with the same compiler options; a follow-up could add a scripts tsconfig.
- **Import parse polish candidate**: an unparseable Win Probability cell silently
  defaults to 50 (`importParse.ts` `winProbRaw`) — same shape as the fixed
  deal-value bug, much lower stakes.
- **Cutover checklist — SIMPLIFIED (user decision 2026-08-15: START FRESH, NO
  DATA MIGRATION).** The Pipeline begins empty in production; the SA team enters
  or Excel-imports deals fresh. `backend/scripts/import-velora.ts` ships unused —
  it remains available if historical data is ever wanted BEFORE users start
  editing (it is a full-overwrite sync; never run it after go-live). Remaining
  cutover acts, at the user's own pace: retire the standalone `/opt/velora` stack
  and its GitLab CI deploy; after a soak period, drop the dev `velora-*` compose
  services and the `../VeloraApp` clone. **Partly resolved 2026-09-21**: the dev
  `velora-app`/`velora-cron` services, the `velora` logical database and the
  `../VeloraApp` clone are gone from the dev stack and its documentation (user
  confirmed nothing remains to use from Velora). Retiring the standalone
  `/opt/velora` stack and its GitLab CI deploy is infrastructure outside this
  repository and is not tracked here. Dev-DB fixtures:
  `qa@solvro.test` (id 707) is ALSO the e2e fixture admin — keep it, password
  `QaTest1234!` (gates.sh asserts it pre-smoke); the QA project 1408 ("Delta
  Migration Delivery") + its linked deal are throwaway.

## Velora integration, Phase 1 ("One address") — deferred findings (2026-08-14)

> **PIVOT 2026-08-14 (same day, later): the native-port decision supersedes most of this section** (see CLAUDE.md standing decisions; PR #146 reverted by #148). Item statuses: the `iss`/`aud` shared-verifier requirement is **moot** (no shared verifier exists in the native port); the cron-timezone decision (keep 23:00 UTC = 06:00 WIB) **carries over** into the native re-implementation of the auto-hold job; the GitLab-CI item **reframes** as: retire the standalone `/opt/velora` deploy once the native port ships and its data is migrated; the compose-profile note still describes the dev stack accurately (the Velora services remain as reference/data source).

User-deferred findings from Phase 1 of the Velora (Pipeline) integration
(`docs/plans/velora-integration-plan.md`, `docs/plans/velora-integration-prd.md`,
branch `velora-integration-phase-1`): `docker-compose.yml` gained `velora-app`
+ `velora-cron` services and a second logical Postgres database (`velora`);
`frontend/nginx.conf` + `frontend/vite.config.ts` gained the same-origin
`/pipeline-api` proxy; `setup.sh` gained the matching production provisioning.
The phase review cleared all blockers; these are accepted-as-deferred or
routed to a later phase, not outstanding review items.

- ~~**Phase-2 requirement: Velora's `middleware.ts` accepts ANY JWT signed with
  the shared `JWT_SECRET`, not just Solvro-issued ones.** In the Velora repo
  (sibling checkout `../VeloraApp`, not this repository), `middleware.ts`
  only calls `jwtVerify` and checks for a `session_start` claim — it has no
  issuer/audience check, so any HS256 token signed with the now-shared
  `JWT_SECRET` verifies successfully regardless of which app minted it. Not a
  live gap yet (nothing but Solvro's backend holds the secret, and Phase 1
  ships no route that issues Velora-shaped tokens), but it becomes load-
  bearing the moment Phase 2's shared sign-in lands. Per
  `docs/plans/velora-integration-plan.md`'s Phase 2 (`lib/solvro-token.ts`,
  Velora repo), that verification step must add and check an `iss`/`aud`
  claim (or equivalent) so a Velora-internal token (if any ever exists) can't
  be replayed against Solvro, and vice versa. File as a Phase 2 acceptance
  criterion, not a Phase 1 fix.~~ **Obsolete 2026-09-02**: code check — moot since the 2026-08-14 native-port pivot: no shared-JWT verifier exists in `backend/src`; `../VeloraApp/middleware.ts` is undeployed reference code.
- ~~**`velora-cron`'s auto-hold job runs on a UTC crontab, inherited unchanged
  from upstream Velora.** `docker-compose.yml`'s `velora-cron` service (and
  `setup.sh`'s generated prod equivalent) installs `0 23 * * *` with no `TZ`
  set, so the container's cron daemon (alpine, UTC by default) fires at
  23:00 UTC = 06:00 WIB (Asia/Jakarta, UTC+7) the following day. This is the
  exact schedule the old standalone Velora stack ran, carried over verbatim
  rather than re-decided. **RESOLVED 2026-08-14**: user confirmed keeping the
  UTC crontab as-is (auto-hold lands 06:00 WIB); no `TZ` var to be added.~~ **Resolved 2026-09-02**: code check — `docker-compose.yml:154` keeps the `0 23 * * *` crontab per the inline 2026-08-14 decision; the native port additionally enforces the auto-hold invariant on every `/move` (`backend/src/routes/opportunities.ts:646-649`).
- ~~**Velora's own GitLab CI still deploys a separate standalone stack to
  `/opt/velora/` on the production VPS.** This integration only changes how
  *this* repo's `setup.sh` provisions Velora (as `velora-app`/`velora-cron`
  inside the shared `solvro` stack) — it does not touch or disable
  Velora's existing GitLab CI pipeline, which is presumed to keep deploying
  its own independent stack to `/opt/velora/` on pushes to its repo. Running
  both stacks concurrently means two separate Velora instances (different
  databases, different ports) with no conflict *today* only because
  `setup.sh`'s `velora-app` binds loopback-only on `VELORA_PORT` (default
  3001) while the standalone stack presumably uses its own ports. That
  GitLab CI pipeline must be stopped or repointed at cutover, or the two
  stacks will drift and confuse which one is authoritative. User decision
  due by Phase 2 (tracked in `docs/plans/velora-integration-plan.md`).
  Related decision already made (2026-08-14): Velora-side *source* work
  happens on the GitHub repo (`FS3P/VeloraApp`, cloned at `../VeloraApp`),
  not GitLab. Open consequence: `setup.sh`'s `VELORA_IMAGE` default still
  points at the GitLab registry image that GitLab CI builds — where prod
  images build from once development moves to GitHub is part of the same
  cutover decision.~~ **Obsolete 2026-09-02**: code check — `setup.sh` has zero `velora` references; the separate-service prod provisioning this entry was keyed on was removed with the native-port pivot. The external GitLab pipeline is outside this repo.
- **Declined reviewer nit, recorded for context: no compose profile gates
  the Velora services in the dev stack.** The phase reviewer suggested
  gating `velora-app`/`velora-cron` behind a Docker Compose profile so
  `docker compose up -d` could still start a Velora-less Solvro without an
  env var. Declined: the sibling checkout `../VeloraApp` is a hard
  prerequisite for `docker compose up -d` in dev as of this phase (the
  `velora-app` service's build context) — integration is default-on, not
  opt-in, matching production's default-on `setup.sh` behavior (`SKIP_VELORA=1`
  is the opt-out there). Documented in `docker-compose.yml`'s header comment
  rather than implemented as a profile.

## Daily Review v2 — deferred findings (2026-08-29)

User-deferred findings from the Daily Review v2 phase (`docs/plans/daily-review-v2-spec.md`,
branch `feat/daily-review-v2`). The phase review cleared all blockers; these are
accepted-as-deferred, not outstanding review items.

- **`frontend/src/components/ConfirmModal.tsx:29`** — `confirmTone="warning"`
  renders raw `bg-amber-500 text-white`, and both footer buttons use
  `rounded-lg`, instead of the `chip-amber` token pair and DESIGN.md's
  `rounded-sm` radius convention. Pre-existing (predates this phase), but now
  has three new consumers: `components/daily-review/ProjectCard.tsx:165`,
  `WeekNotesEditor.tsx:310`, and `WeeklyUpdateBlock.tsx:288` (all
  delete-confirmation dialogs). Fix direction: swap the warning branch's
  classes to the `chip-amber` background/text tokens and `rounded-sm`, and
  align the two Cancel/border buttons' radius while in the file.
- **`frontend/src/pages/views/ProjectRisks.tsx`** (probability/impact inline
  cells, ~lines 381 and 411) — the risk-scale editors are plain `<select>`
  elements with hand-rolled classes, while the new Daily Review attention
  lists (`components/daily-review/ProjectCard.tsx`,
  `OperationsCard.tsx`) use the vendored `ui/select`. Deferred as a
  consistency nit outside this phase's scope; align `ProjectRisks.tsx` on
  `ui/select` the next time that file is touched.
- **`e2e/tests/daily-review.spec.ts`** (see its header comment, lines 29-35) —
  the spec flips its seeded project ACTIVE and its customer's `tamId` to the
  admin to bring them into the Daily Review page's scope, and neither
  `Project` nor `Customer` has a DELETE route, so each run leaves one more
  ACTIVE project and one more customer in the shared dev database permanently.
  The spec's stats-tile assertions are baseline-delta (read the tile before
  the spec's data enters scope, assert the exact delta produced), so
  correctness doesn't degrade as this accumulates — but the dev DB's junk-row
  count grows with every run. Fix direction: a cleanup route (test-only,
  gated out of production) or a dedicated e2e database/reset step would
  remove the accumulation; tracked here rather than fixed in-phase since it
  mirrors the pre-existing, already-accepted test-isolation debt above
  ("Backend test-DB isolation is broken").
  *Updated 2026-09-02 (code check)*: the premise is outdated — `DELETE /projects/:id` (`backend/src/routes/projects.ts:330`) and `DELETE /customers/:id` (`backend/src/routes/customers.ts:308`) shipped in PR #157. The spec still has no `afterAll`/`afterEach` cleanup calling either, so the junk still accumulates; the spec's header comment (lines 29-33) still claims the routes are missing.
- **Vendored `ui/*` and `reui/*` still carry the fuller focus form** (`focus-visible:border-primary` + ring): `ui/button.tsx`, `checkbox.tsx`, `input.tsx`, `select.tsx`, `textarea.tsx`, `scroll-area.tsx`, `reui/badge.tsx`, `reui/autocomplete.tsx`, `reui/gantt/gantt-bar.tsx`, `reui/gantt/gantt-view.tsx`, plus `gantt-v2/SolvroGantt.tsx`. `docs/DESIGN.md` §4 now states the reduced form (user decision 2026-08-29). Align opportunistically when a file is next touched; mark each edit `// SOLVRO PATCH` in vendored files.

## Daily Review collapse & Recent notes — deferred findings (2026-08-31)

User-deferred finding from the phase adding collapsible Daily Review project
cards/attention lists and the Overview "Recent notes" panel (branch
`feat/daily-review-collapse`). The phase review (`solvro-reviewer`, instant
spine review of `frontend/src/lib/queries.ts`) reported 0 blockers; this is
its one deferred finding, not an outstanding review item.

- **`GET /notes/recent` (`backend/src/routes/notes.ts:62-93`) range-scans
  `project_notes`/`customer_notes` by `noteDate` alone — no index leads with
  it.** `ProjectNote` carries `@@index([projectId, createdAt])`,
  `@@index([authorId])`, `@@index([projectId, noteDate])`
  (`backend/prisma/schema.prisma:420-422`); `CustomerNote` carries
  `@@index([customerId, noteDate])`, `@@index([authorId])`
  (`schema.prisma:442-443`) — neither leads with `noteDate` alone, so the
  route's `where: { noteDate: { gte, lte }, project/customer: <visibility
  filter> }` queries plan a Seq Scan + Sort + Limit on the dev DB. Deferred
  rather than adding a migration to this branch: at dev volume (27/24 rows)
  and realistic growth (~10k notes/yr) this stays single-digit ms, so the
  sub-200ms NFR (`backend/CLAUDE.md`) holds for years. Fix when needed:
  `@@index([noteDate])` on both models, then `docker compose exec -it backend
  npx prisma migrate dev --name recent_notes_note_date_index`.

## Critical Path mark — deferred findings (2026-09-02)

User-deferred findings from the phase review of the manual Critical Path mark
(branch `feat/critical-path-mark`, `Task.isCriticalPath` — see `CHANGELOG.md`,
"Critical Path mark on tasks", and the "Critical-path highlighting" entry
above). Gates were 17/17 green; these are deferred findings, not outstanding
review blockers.

- **Material Symbols size utilities are inert app-wide.** Google Fonts'
  stylesheet (linked `frontend/index.html:20`,
  `Material+Symbols+Outlined:opsz,wght,FILL,GRAD@24,400,0,0`) sets
  `.material-symbols-outlined { font-size: 24px }` unlayered, which beats
  Tailwind v4's layered `text-[Npx]` utilities — every
  `material-symbols-outlined` glyph in the app renders 24px regardless of a
  `text-[Npx]` class. This phase worked around it locally with `!important`
  overrides (`frontend/src/components/CriticalPathMark.tsx:34,63` —
  `text-[14px]!` / `text-[13px]!`). Fix (one `index.css` change, visible app-
  wide, awaiting a user decision): import the Google Fonts stylesheet's rule
  into a Tailwind `@layer` (or otherwise re-declare `.material-symbols-
  outlined` font-size inside a layer) so `text-[Npx]` applies without
  `!important` everywhere it's already used.
- **Three pre-existing flaky e2e tests retried clean during this phase's
  gate runs** (not caused by this phase's diff — noting for awareness):
  `e2e/tests/gantt-parity.spec.ts:330-381` (connector-hover "delete
  dependency" button, case (c) — hover-to-reveal timing); `e2e/tests/kanban-
  dnd.spec.ts:987` (R3 cross-view row order parity); `e2e/tests/kanban-
  dnd.spec.ts:1030-1069` (mobile touch-reorder position count, the secondary
  assertion at :1068 — depends on the shared seeded project's task count
  staying contiguous, noted as fragile in the test's own comment). Fix
  direction: none of these are regressions to chase now; if any starts
  failing consistently, tighten its wait condition (case (c)) or fixture
  isolation (the other two) at that time.
- **`CriticalPathMark.tsx`'s compact chip padding is coupled to `Chip`'s DOM
  shape.** `frontend/src/components/CriticalPathMark.tsx:56` targets
  `[&>span]:px-1.5` to reach into `Chip`'s root span
  (`frontend/src/components/StatusChip.tsx:70-78`, a single `<span>`); this
  breaks silently (no error, just wrong padding) if `Chip` ever gains a
  wrapper element. Fix direction: if `Chip`'s markup changes, grep
  `[&>span]:px-1.5` and move the override onto whatever `Chip` renders as its
  root.
- **Three narrow task `select`s omit `isCriticalPath`**, so the mark can't be
  shown on those surfaces without widening them first:
  `backend/src/routes/dailyReview.ts:237-244`, `backend/src/routes/
  search.ts:53-59`, `backend/src/lib/portfolio.ts:34-46`. Not needed today —
  none of those surfaces (Daily Review, global search, the portfolio roll-
  up) render task-level flags — only relevant if the mark is ever surfaced
  there.
- **Two task surfaces outside the plan's per-surface table show no Critical
  Path mark, unlike every other surface it covers**:
  `frontend/src/pages/Tasks.tsx:199` renders `PriorityBadge` (compact) in the
  hidden `/tasks` grid with no accompanying mark; `frontend/src/components/
  kanban-v2/cards.tsx`'s `SubtaskRow` (from line 177) renders neither
  `PriorityBadge` nor `CriticalPathMark` for its row — it has no flag icon of
  any kind today. Fix direction: add `CriticalPathMark variant="glyph"` (or
  `"chip"` for Tasks.tsx, matching its `PriorityBadge` companion) beside the
  existing priority indicator if/when either surface's flags are revisited.
- **`frontend/src/index.css:153`'s comment is stale**: it still calls
  `chip-violet` "the only chip hue with no status meaning assigned
  elsewhere," which stopped being true when Alert's `info` tone adopted it
  and now again with Critical Path. Code comment only, no behavior effect —
  fix in the next `index.css` touch rather than a docs-only edit.
- **Dark-theme Gantt bar ring contrast, pending a user decision.** The ring/
  outline/glyph color is `chip-violet-text`, which resolves to `#ddd6fe`
  (near-white) in dark mode per the mark's own spec — close in value to the
  bar's selection outline, so a marked + selected bar in dark mode reads as
  two similar rings rather than two distinct signals. Undecided between (a)
  keeping the spec's `chip-violet-text` (consistent with every other chip-
  paired surface) or (b) introducing a fixed `CRITICAL_PATH_HEX`-style violet
  used in both themes for the Gantt ring specifically (mirroring what
  `frontend/src/lib/gantt/palette.ts`'s `CRITICAL_PATH_HEX` already does for
  the exports, which are light-only). Awaiting the user's call before either
  is touched.

## Duplicate tasks, subtasks, and sections — deferred findings (2026-09-02)

User-deferred findings from the phase review of task/section duplication
(branch `feat/duplicate-tasks-sections` — see `CHANGELOG.md`'s "Duplicate a
section from the List view" / "Duplicate a section (API)" / "Duplicate a task
from the Task panel, subtask rows, and the Gantt row menu" / "Duplicate a task
or subtask (API)" entries; spec in
`docs/plans/duplicate-tasks-sections.md`). The phase review cleared
with no blockers; these are its deferred findings, not outstanding review
items.

- **TaskPanel's header-menu failure alert renders below the subtasks block,
  easy to miss on a long task** (solvro-reviewer, phase: task/section
  duplication, 2026-09-02; pre-existing). `frontend/src/components/
  TaskPanel.tsx:777-780` — a failed "Delete task" / "Duplicate task" (the
  header options menu) writes its error to an `Alert` placed after the
  subtasks list inside the scrollable panel body; on a task with many
  subtasks the failure lands off-screen with no visible feedback. Fix idea:
  render the error `Alert` at the top of the scroll container, or scroll to
  top when a header-menu action sets the error. P3.
- **`useCreateTask` omits the Daily Review invalidation its sibling
  mutations carry** (solvro-reviewer, phase: task/section duplication,
  2026-09-02; pre-existing). `frontend/src/lib/queries.ts:1030-1044` —
  unlike `useUpdateTask`/`useDeleteTask` (e.g. `:1004-1010`),
  `useCreateTask`'s `onSuccess` doesn't invalidate `queryKeys.dailyReviewRoot`,
  so creating an overdue TODO task leaves the Daily Review page's attention
  lists stale until `staleTime` elapses. Fix idea: add the same
  `dailyReviewRoot` invalidation. P3.
- **`DELETE /tasks/:id` never re-packs its sibling list, so positions go
  sparse after a delete** (solvro-reviewer, phase: task/section duplication,
  2026-09-02; pre-existing, surfaced by this phase's placement work).
  `backend/src/routes/tasks.ts:284-292` — a bare `prisma.task.delete` with
  no `closeGap`/re-pack call; every consumer that treats `position` as an
  index (an insertAt-based move using a requested position derived from a
  stored position) is exposed to a sparse list. This phase's duplicate routes
  route around it deliberately, placing the copy by identity via
  `insertManyAfter` rather than by stored position (see the doc comment on
  that function, `backend/src/lib/taskOrdering.ts`). Fix idea: re-pack the
  sibling list inside the delete transaction (`closeGap`). P2.
- **`POST /tasks/:id/duplicate` (`task:write`) is a create path, one
  permission short of the existing create route for the same resource**
  (solvro-reviewer, phase: task/section duplication, 2026-09-02;
  spec-settled — record only). `POST /projects/:id/tasks` requires
  `project:write` (`backend/src/routes/projects.ts:377-379`); seeded roles
  never grant `task:write` without `project:write`, but an admin-defined
  custom role could hold one without the other and duplicate tasks it
  couldn't otherwise create via the form. Settled as Decision 11 in
  `docs/plans/duplicate-tasks-sections.md` §3 (matches
  `PATCH`/`DELETE /tasks/:id`, both `task:write`) — not a bug, recorded for
  awareness only.
- **`ProjectList.tsx` section-header actions gate on `task:write`, one
  permission short of what the section routes actually require**
  (solvro-reviewer, phase: task/section duplication, 2026-09-02;
  pre-existing pattern, widened by this phase's new Duplicate button).
  `frontend/src/pages/views/ProjectList.tsx:114` — `canEdit =
  hasPermission(user, "task:write")` controls Rename, the new Duplicate,
  Delete (section header) and "Add section", but every section route
  (`PATCH`/`DELETE`/`POST /:id/duplicate` in `backend/src/routes/
  sections.ts:119,167,232`) requires `project:write`. Seeded roles never
  split the two, but a custom role with `task:write` only would see the
  buttons and get a 403, surfaced in the `actionError` alert. Fix idea:
  `const canEditSections = hasPermission(user, "project:write")`, applied to
  the whole header action group in one pass. P3.
- **`gates.sh` exercises only one e2e spec, so new suites (including this
  phase's `duplicate.spec.ts`) never run in the mechanical gate**
  (solvro-reviewer, phase: task/section duplication, 2026-09-02; process
  gap). `.claude/scripts/gates.sh:93` runs `tests/smoke.spec.ts` only; every
  other spec lands unexercised by any gate unless run by hand. Fix idea: a
  gate step that also runs the specs touched by the diff (`git diff
  --name-only -- e2e/tests`). P2 (process).
- **`useDuplicateTask`/`useDuplicateSection`'s `isPending` window includes
  inactive-query refetches** (solvro-reviewer, phase: task/section
  duplication, 2026-09-02; considered, not taken).
  `frontend/src/lib/queries.ts:1046-1056` /
  `:1207-1218` — both `onSuccess` handlers `Promise.all` every invalidation
  (deliberately, per the inline comment at `:1051-1055`, so `TaskPanel`'s
  post-duplicate navigation finds the copy already in cache), which also
  makes `isPending` wait on the inactive `["tasks"]`, overview, and Daily
  Review queries. Near-zero cost in practice, since an inactive query isn't
  refetched until it's next observed. Tightening idea, not applied: await
  only `projectTasks`, fire the rest un-awaited. P3.

## Claim Unassigned Deals — deferred findings (2026-09-08)

User-deferred finding from the phase review of the unassigned-deal PIC-assign
fix (branch `fix/claim-unassigned-deals` — see `CHANGELOG.md`'s "Pipeline: an
unassigned deal can be given a PIC" entry). The phase review cleared with no
blockers; this is its one deferred finding, not an outstanding review item.

- **Material Symbols glyphs fold into accessible names.** App-wide, an icon
  rendered as `<span className="material-symbols-outlined">person_add</span>`
  inside a labelled `<button>`/`<Link>` contributes its ligature text to the
  computed accessible name (e.g. `person_add Assign PIC`, `edit Edit`,
  `delete Delete`). Seen on the opportunity detail header row
  (`frontend/src/pages/OpportunityDetail.tsx` — View project, Create project,
  Assign PIC, Edit, Delete) and elsewhere: grep-verified rough size is 188
  `material-symbols-outlined` spans across 47 files under `frontend/src`,
  with roughly 136 of them sitting inside a `<button>` or `<Link>` element.
  Screen readers announce the glyph name; Playwright locators in `e2e/`
  compensate by not using `exact: true`. Fix in one sweep: `aria-hidden="true"`
  on every icon span inside a labelled control (or a shared icon component),
  then one e2e pass to restore `exact` matching where wanted. Deferred
  2026-09-08 (phase review, Claim Unassigned Deals) — not fixed piecemeal to
  avoid one header row with two conventions.

## Weekly Sync achievement rows — deferred findings (2026-09-10)

User-deferred finding from the phase review of the Reflection achievement-rows
phase (branch `feat/weekly-sync-achievement-rows` — see `CHANGELOG.md`'s
"Weekly Sync: one row per achievement..." entry). The phase review cleared
with no blockers; this is its one deferred finding, not an outstanding review
item.

- **The missing-title banner doesn't name the offending card.** Both
  `MidweekSyncModal.tsx:171` (`setError("Every highlight needs a title.")`)
  and `ReflectionSyncModal.tsx:202` (`setError("Every achievement needs a
  title.")`) render the message as one banner at the top of the form
  (`ReflectionSyncModal.tsx:318-320`, an `AlertDescription`), with no
  indication of which card is missing its title. The Reflection card is six
  fields tall, so with several cards on screen the banner sits far from the
  actual problem — a user has to scan every card to find the blank title.
  Settled consequence of the achievement form mirroring the Mid-week form's
  existing pattern (`MidweekSyncModal.tsx`); not blocking either form. Fix
  direction: mark the offending card itself (e.g. a border in the error
  tone) or scroll/focus it when the save is blocked.
