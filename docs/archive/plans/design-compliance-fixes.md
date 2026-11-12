# Spec: DESIGN.md compliance fixes (Fixes 1–7, Fix 8 Option B)

**Status:** SPEC APPROVED 2026-11-02 (open questions resolved below). Plan + tasks below — awaiting user review before implementation.
**Branch:** `fix/design-compliance`, cut from `origin/develop` @ `31e059a`.
**Source:** the DESIGN.md audit and the before/after frames on the Doop canvas "Solvro-Cust Mockup" (`wIbMMkOajZ`), page "06 · Fix suggestions — before / after" (Fix 1 `b0QWMmApFX`, Fix 2 `5D_RVJbxm-`, Fix 3 `Bpj4ht3UPi`, Fix 4 `XWMaACzKFN`, Fix 5 `zyQgN_VPld`, Fix 6 `OAIPOxaW3V`, Fix 7 `al3qHiuSjJ`, Fix 8 `J1znYHY0WN`). Audit frame: page 00, `h6n8bLXzV_`.
**User selection (2026-11-02):** Fix 1, 2, 3, 4, 5, 6, 7 and Fix 8 **Option B**.
**Archived:** shipped on `fix/design-compliance` (2026-11-02).

## Objective

Bring the rendered pages back in line with `docs/DESIGN.md` ("Technical Precision") where the code breaks a binding rule, with **minimal token/class swaps — no redesign, no layout change, no behaviour change**. Users are TAMs on a dense dark-first dashboard; success is that every touched screen looks identical to its "After" panel on the canvas, in both themes, and the audit's violations for these rules read zero on a re-grep.

Scope check: eight fixes, but one capability (visual-token compliance), one phase, one branch, one PR into `develop`; each fix is an independent commit. No capability map needed.

### Per-fix requirements

| # | Rule (DESIGN.md) | Change | Sites (re-verify on site — the tree may drift) |
|---|---|---|---|
| 1 | §2 no text under 12px | `text-[11.5px]` → `text-meta`. Keep each site's own `font-semibold`/`font-medium`/`tracking-wide`. Fix the stale comment that calls the colour-picker shadow "shadow-sm" (it already uses `shadow-overlay`). | `components/gantt-v2/SolvroGantt.tsx:1070, 1091, 1102, 1138, 1175, 1198, 1226` (+ the explanatory comment at `:147`); `components/gantt-v2/TreeCells.tsx:121` (comment only) |
| 2 | §2 no text under 12px | Inline `fontSize: 10` → `fontSize: 12`. | `pages/Login.tsx:153, 190, 204, 328` |
| 3 | §2 no text under 12px | Recharts `fontSize: 11` → `12` (X ticks, Y ticks, tooltip `labelStyle`, "Today" reference label). | `pages/views/ProjectOverview.tsx:508, 515, 530, 542` |
| 4 | §1/§5 colours from tokens, flip with theme | Risk status `MITIGATED` → `bg-chip-amber-bg text-chip-amber-text`; `CLOSED` → `bg-chip-emerald-bg text-chip-emerald-text`. Medium/Low counters → `border-chip-amber-text/40 bg-chip-amber-bg text-chip-amber-text` / emerald equivalent (mirrors the High counter's `border-error/40 bg-error-container text-on-error-container`). | `pages/views/ProjectRisks.tsx:35–36, 683–685` |
| 5 | §1 colours from tokens | Admin KPI icons: Pending → `text-chip-amber-text`, Custom roles → `text-chip-emerald-text`. Subtask done check `border-emerald-500 bg-emerald-500 text-white` → `border-primary bg-primary text-on-primary`. S-curve legend swatch `bg-emerald-500` → `bg-chip-emerald-text`. Same sweep: `ProjectOverview.tsx` emerald KPI accents and slip text → `text-chip-emerald-text`; Settings "password updated" banner → `chip-emerald` pair. | `pages/Admin.tsx:669–671`; `pages/views/ProjectList.tsx:1100`, `components/kanban-v2/cards.tsx:270`, `components/TaskPanel.tsx:868`; `pages/views/ProjectOverview.tsx:149, 152, 434, 444`; `pages/Settings.tsx:118` |
| 6 | §2 caps via `text-label-caps`, never `tracking-wider`; controls sentence case | Field labels / micro-labels → `text-label-caps uppercase text-on-surface-variant` (drop ad-hoc size, `font-bold`, `tracking-wider`; `mb-1` → `mb-1.5` where it labels an input). Section/card headings (`h2`) → sentence case `font-display text-sm font-bold text-on-surface`, matching Overview's "Projects needing attention". Controls (select, button, `summary`) → sentence case, no `uppercase`. | 26 sites: `ProjectFormModal.tsx:339, 370` · `CustomerFormModal.tsx:337` · `itop/ActionSheet.tsx:19` · `itop/NewTicketSheet.tsx:18` · `outline/OutlineConnectCard.tsx:86` · `services/ServiceMappingList.tsx:134` · `customer/AccountOverview.tsx:93, 366, 522` · `views/ProjectServices.tsx:59` · `Settings.tsx:70, 105, 113, 228, 340, 363, 410` · `views/ProjectRisks.tsx:318, 326, 461, 652, 690` · `Admin.tsx:478, 547, 1438`. Classify each site (label / heading / control) per the Fix 6 frame. |
| 7 | §4 one focus treatment app-wide | **Option B (decided).** Canonical treatment on every *bordered* interactive control = `focus-visible:outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/30` (prefix-adapted, e.g. `has-focus-visible:`). Keep it where it already exists (vendored + ~80 sites); add `focus-visible:border-primary` to the ~38 bordered controls that are ring-only today (inventory: `grep -rnE "focus(-visible)?:ring-primary/30" frontend/src --include=*.tsx \| grep -vE "focus(-visible)?:border-primary" \| grep -E "border-outline"`). docs-keeper amends DESIGN.md §4 to make this the canonical form (replacing the ring-only wording of the 2026-08-29 decision) and drops the "only SolvroGantt" note. Sites: vendored `components/ui/{input,select,textarea,button,checkbox,calendar,scroll-area}.tsx`, `components/reui/{badge,autocomplete}.tsx`, `components/reui/gantt/{gantt-bar,gantt-view}.tsx`, plus ~80 `focus(-visible):border-primary` uses in 23 non-vendored files (list in `grep -rlE "focus(-visible)?:border-primary" frontend/src`). |
| 8B | §2 page headings use `text-h1` (+ Customer detail title, decided) | Migrate page titles from `font-display text-2xl font-bold` (25/700) to `font-display text-h1 text-on-surface` (32/600/1.2 from the role — no `font-bold`, which would override the role's 600). Drop the stray `tracking-tight` on Admin. DESIGN.md already specifies `text-h1`, so no doc change. | 13 sites: `components/customer/AccountHeader.tsx:104` (`text-xl font-bold` → `text-h1`; keep `truncate`) · `Overview.tsx:30, 49` · `Projects.tsx:97` · `Customers.tsx:83` · `DailyReview.tsx:89` · `WeeklySync.tsx:203` · `Tasks.tsx:329` · `Utilization.tsx:112` · `Executive.tsx:24` · `Settings.tsx:61` · `Help.tsx:40` · `Admin.tsx:77` |

## Tech Stack

React 19 + Vite + Tailwind v4 (CSS-first `@theme inline` tokens in `frontend/src/index.css`), vendored ReUI/shadcn in `components/reui/` and `components/ui/`, Recharts for the S-curve, Vitest, Playwright (desktop + mobile, incl. `axe.spec.ts` with a dedicated `color-contrast` pass). No new dependencies.

## Commands

```bash
docker compose exec frontend npm run typecheck            # scoped check per task (one tsc at a time — CLAUDE.md trap)
docker compose exec frontend npx vitest run <touched tests>
cd e2e && npx playwright test tests/axe.spec.ts tests/accessibility.spec.ts tests/help.spec.ts tests/auth.spec.ts tests/daily-review.spec.ts tests/customer-account.spec.ts tests/gantt-parity.spec.ts tests/kanban-dnd.spec.ts
.claude/scripts/gates.sh                                   # full gates — orchestrator only, serial, once per wave + phase close
grep -rnE "text-\[(9|10|11)(\.[0-9])?px\]|fontSize: ?(9|10|11)\b" frontend/src --include=*.tsx | grep -v "components/(reui|ui)/"   # must be empty after Fixes 1–3
```

## Project Structure

- Pages: `frontend/src/pages/` (+ `views/` for project tabs). Shared components: `frontend/src/components/`. Vendored engines: `components/reui/`, `components/ui/` (spine — instant review).
- Tokens: `frontend/src/index.css`. Design contract: `docs/DESIGN.md` (docs-keeper-owned).
- This spec: `docs/plans/design-compliance-fixes.md` → moves to `docs/archive/plans/` when shipped.

## Code Style

Token classes only; reuse existing roles; keep each site's other classes untouched.

```tsx
// Before (ProjectRisks.tsx:35)
MITIGATED: "bg-amber-100 text-amber-800",
// After
MITIGATED: "bg-chip-amber-bg text-chip-amber-text",

// Before (Overview.tsx:49)
<h1 className="font-display text-2xl font-bold text-on-surface">Overview</h1>
// After — the role carries size, weight and line-height
<h1 className="font-display text-h1 text-on-surface">Overview</h1>
```

## Testing Strategy

- **Per task (implementor, scoped):** frontend typecheck + any Vitest touching the changed component.
- **E2E evidence:** `axe.spec.ts` (contrast pass must not regress — Fixes 4, 5, 7 should only improve it), heading assertions `getByRole("heading", { level: 1, name })` in `auth`, `help`, `daily-review`, `customer-account` (Fix 8 changes classes only, names unchanged), `gantt-parity` + `kanban-dnd` (Fixes 1 and 5 touch drag-engine files — classes only).
- **Text-match risk (Fix 6):** headings change from uppercase to sentence case visually only (CSS `uppercase`), DOM text is unchanged — but grep `e2e/` for any `toHaveText` / `getByText` using uppercase copy before merging.
- **Visual check:** each touched screen hard-reloaded in the dev app (not over the tunnel — CLAUDE.md HMR trap), dark and light, compared against its Doop "After" panel. Fix 4's risk-status `<select>` (`ProjectRisks.tsx:461`) carries a competing `bg-surface-container-lowest`; confirm the chip background actually wins in the browser.
- **Re-grep:** the audit greps for raw `emerald|amber` palette classes, sub-12px sizes and `uppercase tracking-wider` return only vendored/out-of-scope hits.

## Boundaries

- **Always:** one commit per fix; CHANGELOG entry per fix under `[Unreleased]` (public wording, no pipeline vocabulary); keep `data-testid`s, ARIA and DOM text unchanged; re-verify every file:line before editing; serial `tsc`.
- **Ask first:** any change to `docs/DESIGN.md` (docs-keeper proposes; Fix 7 may need one); any `index.css` token change; changing a vendored file beyond the focus classes; Fix 8 sites outside the 12 listed (see Open Question 3).
- **Never:** redesign or re-layout; new dependencies; touch Pipeline/Reporting/Network-Diagram code; commit or open a PR without explicit user approval; AI attribution in commits/PRs.

## Success Criteria

1. No text under 12px in `pages/` or non-vendored `components/` (the grep in Commands is empty).
2. Risk statuses and counters, Admin KPI icons, done checks, S-curve legend, Settings banner render with chip tokens and flip correctly between themes (screens match the "After" panels in dark and light).
3. Zero `uppercase tracking-wider` outside vendored code; labels use `text-label-caps`; headings and controls are sentence case.
4. Every bordered interactive control shows `border-primary` + `ring-primary/30` on keyboard focus (≥ 3:1 via the border, WCAG 1.4.11) in both themes; DESIGN.md §4 states this as canonical.
5. All 13 page titles (12 pages + Customer detail) render at 32/600/1.2 via `text-h1`; Admin's `tracking-tight` gone.
6. `gates.sh` green; `axe.spec.ts` contrast findings not increased; phase review clean; CHANGELOG entries present.

## Decisions (user, 2026-11-02)

1. **Fix 7 → Option B**: keep border + ring everywhere; DESIGN.md §4 amended (docs-keeper). Rationale: the ring-only `ring-primary/30` measures ~1.7:1 (dark) / ~1.5:1 (light), below WCAG 1.4.11's 3:1; the `border-primary` line is what passes (~6:1).
   - *Known limitation, out of scope:* borderless controls that rely on the ring alone (card title buttons, icon-only buttons) still sit below 3:1. Filed to `docs/ISSUES.md` at phase close for a separate decision.
2. **Fix 5 done check → brand green** (`border-primary bg-primary text-on-primary`).
3. **Fix 8B includes the Customer detail title** (`AccountHeader.tsx:104`).
4. **Branch** `fix/design-compliance` from `origin/develop`.
5. **Fix 9 added — Portfolio "Planning · On-hold" bar contrast (light).** `components/portfolio/PortfolioCalendar.tsx:46` `CALENDAR_TONE.planning = "bg-chip-amber-bg"` is #fef3c7 in light — bars and legend dot nearly vanish on the white panel. Change to `bg-chip-amber-text/60 dark:bg-chip-amber-bg` (dark unchanged; light ≈ #a75c05 at 60%). Found by the light-mode documentation pass. Owned by T2 (separate commit).

---

# Implementation Plan

**Status:** PLAN APPROVED 2026-11-02 — **user-approved autopilot (Option A)**: the orchestrator runs all four waves without further approval gates, commits each fix on `fix/design-compliance`, pushes, and opens ONE PR into `develop` assigned to the user. Escalate to the user only if a gate still fails after two fix rounds, a review finding contradicts a recorded decision, or a fix would leave the spec's scope. Phase = branch `fix/design-compliance` = one PR into `develop`. Tasks are owned **by file**, so tasks in the same wave never touch the same file; a task that covers two fixes produces **one commit per fix** (commit subject names the fix, e.g. `fix(ui): risk statuses use chip tokens (Fix 4)`). No commit or PR without explicit user approval.

## Architecture decisions

- **File ownership over fix ownership.** Several files carry more than one fix (`ProjectRisks.tsx` 4+6, `ProjectOverview.tsx` 3+5, `Admin.tsx`/`Settings.tsx` 5+6+8B). One task owns each such file, which removes merge collisions inside a wave.
- **Order by risk.** Spine and drag-engine files (Gantt, Kanban cards) go first so their instant review and `gantt-parity`/`kanban-dnd` evidence land early. Fix 7 goes last: it is the widest sweep and shares files with Wave 3.
- **Mechanical exceptions to the 5-file guideline.** T9a/T9b and T10–T12 each exceed 5 files, but every site is a one-class, identical edit; splitting further would only add integration overhead.
- **Implementors re-verify every file:line on site**; the spec's line numbers are from `31e059a`.

## Dependency graph

```
W1  T1 Gantt (Fix 1)   T2 Login (Fix 2)   T3 ProjectOverview (Fix 3, Fix 5)   T4 ProjectRisks (Fix 4, Fix 6)
          │                  │                     │                                  │
          └──────────────────┴──── gates.sh + T1 instant review ─────────────────────┘
W2  T5 Done check (Fix 5)   T6 Form/sheet labels (Fix 6)   T7 Card headings (Fix 6)
          └──────────────────────── gates.sh ─────────────────────────┘
W3  T8 Settings + Admin (Fix 5, 6, 8B)   T9a Page titles A (Fix 8B)   T9b Page titles B (Fix 8B)
          └──────────────────────── gates.sh ─────────────────────────┘
W4  T10 Focus: shared + layout   T11 Focus: daily-review   T12 Focus: admin/outline/itop/pages  (Fix 7)
          └──── gates.sh → docs-keeper (§4 + ISSUES.md) → phase review → PR ────┘
```

## Task list

### Wave 1 — parallel

**T1 — Gantt toolbar 12px (Fix 1).** Spine (`gantt-v2/`) → instant review.
- Acceptance: the 7 `text-[11.5px]` sites are `text-meta` with each site's weight/tracking kept; the comment at `:147` no longer cites 11.5px; the `TreeCells.tsx:121` comment says `shadow-overlay`; toolbar still fits one row at 1440.
- Verify: typecheck; `e2e gantt-parity`, `gantt-bar-labels`, `gantt-legend`; visual check vs Doop `b0QWMmApFX`.
- Files: `components/gantt-v2/SolvroGantt.tsx`, `components/gantt-v2/TreeCells.tsx`. Size S.

**T2 — Login 12px (Fix 2) + Portfolio planning bar (Fix 9).** Two commits.
- Acceptance: the 4 `fontSize: 10` are `12`; feature pills stay on one row at 1440 (wrap without clipping at 768–874px is accepted); page still pinned dark.
- Verify: typecheck; `e2e auth`; visual check vs `5D_RVJbxm-`.
- Acceptance (Fix 9): planning bars and legend dot clearly visible in light; dark rendering unchanged.
- Files: `pages/Login.tsx`, `components/portfolio/PortfolioCalendar.tsx`. Size XS.

**T3 — Project Overview: chart ticks + emerald accents (Fix 3, Fix 5).** Two commits.
- Acceptance: S-curve ticks, tooltip label and "Today" label are 12px; legend swatch `bg-chip-emerald-text`; KPI accents and slip text use `text-chip-emerald-text`; no raw `emerald-*` left in the file.
- Verify: typecheck; visual check dark + light vs `Bpj4ht3UPi` and `zyQgN_VPld` (pair C).
- Files: `pages/views/ProjectOverview.tsx`. Size S.

**T4 — Project Risks: chip tokens + caps labels (Fix 4, Fix 6).** Two commits.
- Acceptance: Mitigated/Closed statuses and Medium/Low counters use the chip pairs (counters mirror the High counter pattern); the 5 caps sites (`:318, 326, 461, 652, 690`) follow the Fix 6 classification, and the status `<select>` at `:461` is sentence case; in the browser the select really shows the chip background (it also carries `bg-surface-container-lowest`; resolve the conflict if it does not).
- Verify: typecheck; `e2e axe` (contrast pass not worse); visual check dark + light vs `XWMaACzKFN`.
- Files: `pages/views/ProjectRisks.tsx`. Size S.

**Checkpoint W1:** `gates.sh` green · T1 instant review clean · CHANGELOG entries for Fixes 1–4 (and Fix 3/5 partials) appended by the orchestrator.

### Wave 2 — parallel

**T5 — Subtask done check → brand green (Fix 5).**
- Acceptance: `border-emerald-500 bg-emerald-500 text-white` → `border-primary bg-primary text-on-primary` in all three components; hover state unchanged.
- Verify: typecheck; `e2e kanban-dnd`; visual check List, Kanban card, Task panel in both themes.
- Files: `pages/views/ProjectList.tsx`, `components/kanban-v2/cards.tsx`, `components/TaskPanel.tsx`. Size S.

**T6 — Form and sheet field labels (Fix 6).**
- Acceptance: field labels use `text-label-caps uppercase text-on-surface-variant` with `mb-1.5`; no `tracking-wider` left in these files.
- Verify: typecheck; grep `e2e/` for uppercase copy from these labels; visual check vs `OAIPOxaW3V` pair A.
- Files: `components/ProjectFormModal.tsx`, `components/CustomerFormModal.tsx`, `components/itop/ActionSheet.tsx`, `components/itop/NewTicketSheet.tsx`. Size M.

**T7 — Card and section headings (Fix 6).**
- Acceptance: section/card `h2`s are sentence case `font-display text-sm font-bold text-on-surface`; the week key (`AccountOverview.tsx:522`) is `text-label-caps uppercase`; no `tracking-wider` left in these files.
- Verify: typecheck; `e2e customer-account`; visual check vs `OAIPOxaW3V` pairs B–C.
- Files: `components/customer/AccountOverview.tsx`, `components/services/ServiceMappingList.tsx`, `components/outline/OutlineConnectCard.tsx`, `pages/views/ProjectServices.tsx`. Size M.

**Checkpoint W2:** `gates.sh` green · CHANGELOG for Fix 5 (done check) and Fix 6 (forms, headings).

### Wave 3 — parallel

**T8 — Settings and Admin (Fix 5, Fix 6, Fix 8B).** Three commits.
- Acceptance: Admin KPI icons `text-chip-amber-text` / `text-chip-emerald-text`; Settings password banner on the chip-emerald pair; the Settings/Admin caps sites follow the Fix 6 classification (theme option button `:363`, select `:547` and `summary` `:1438` sentence case); both page titles `font-display text-h1 text-on-surface`, Admin's `tracking-tight` removed.
- Verify: typecheck; `e2e auth` (Admin h1 by name), `axe`; visual check vs `zyQgN_VPld`, `OAIPOxaW3V`, `J1znYHY0WN`.
- Files: `pages/Settings.tsx`, `pages/Admin.tsx`. Size S.

**T9a — Page titles, part A (Fix 8B).**
- Acceptance: `<h1>` uses `font-display text-h1 text-on-surface` (no `font-bold`) on Overview (both), Projects, Customers, Daily Review, Weekly Sync.
- Verify: typecheck; `e2e daily-review`, `help` heading assertions still pass.
- Files: `pages/Overview.tsx`, `pages/Projects.tsx`, `pages/Customers.tsx`, `pages/DailyReview.tsx`, `pages/WeeklySync.tsx`. Size M (mechanical).

**T9b — Page titles, part B (Fix 8B).**
- Acceptance: same treatment on Tasks, Utilization, Executive, Help and the Customer detail title (`AccountHeader.tsx:104`, keep `truncate`); header rows still align with their controls at 1440 and on mobile.
- Verify: typecheck; `e2e help`, `customer-account`; visual check on mobile width.
- Files: `pages/Tasks.tsx`, `pages/Utilization.tsx`, `pages/Executive.tsx`, `pages/Help.tsx`, `components/customer/AccountHeader.tsx`. Size M (mechanical).

**Checkpoint W3:** `gates.sh` green (Playwright desktop + mobile) · CHANGELOG for Fix 8B and the remaining Fix 5/6 sites · re-grep: no `uppercase tracking-wider`, no raw `emerald|amber` palette classes outside vendored code.

### Wave 4 — parallel (Fix 7, Option B)

Each task adds `focus-visible:border-primary` (prefix-adapted, e.g. `has-focus-visible:border-primary`) next to the existing `focus-visible:ring-2 focus-visible:ring-primary/30` on every **bordered** interactive control in its files. Borderless controls are untouched (see Decisions — filed to `docs/ISSUES.md`). Inventory command in the spec table, Fix 7 row; re-run it at task start.

**T10 — Shared components and layout.** `components/AppErrorBoundary.tsx`, `EmbedInOutline.tsx`, `ProjectMembers.tsx`, `OutlineLinkButton.tsx`, `layout/TopBar.tsx`, `layout/RightSidebar.tsx`, `ui/switch.tsx` (vendored — keep its SOLVRO PATCH convention; update `gates.sh` patch counters if they change), `pages/ProjectDetail.tsx`, `pages/PublicShare.tsx`. Size L (mechanical).
**T11 — Daily review and cadence.** `components/daily-review/{WeeklySyncRow,WeekNotesEditor,ProjectCard,WeekStrip,SyncField,ReflectionSyncModal,MidweekSyncModal}.tsx`, `pages/DailyReview.tsx`, `pages/WeeklySync.tsx`, `pages/Utilization.tsx`. Size L (mechanical).
**T12 — Admin, Outline, iTop, customer, Help.** `components/admin/{OutlineApiCard,ItopTab,OutlineTab,CopyField}.tsx`, `components/outline/{OutlineDocsTab,NewOutlineDocDialog}.tsx`, `components/customer/AccountHeader.tsx`, `components/itop/{TicketPanel,TicketTimer}.tsx`, `components/itop/board/TicketCard.tsx`, `pages/Help.tsx`. Size L (mechanical).
- Acceptance (each): the inventory command returns no bordered control in the task's files; tabbing to each control shows the green border + ring in dark and light.
- Verify (each): typecheck; `e2e accessibility`, `axe`; keyboard walk-through of one screen per file.

**Checkpoint W4 / phase close:**
- `gates.sh` green; all six success criteria in the spec met; audit re-greps clean.
- docs-keeper (triggered: DESIGN.md change + deferred finding): amend DESIGN.md §4 to the border + ring canonical form and remove the "only SolvroGantt carries the fuller form" note; file "borderless controls rely on a sub-3:1 ring" in `docs/ISSUES.md`.
- One phase review (opus) on the combined diff, design lens.
- CHANGELOG complete; move this file to `docs/archive/plans/`; stage, draft commits and PR → **stop for user approval**; PR targets `develop` and is assigned to the user.

## Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| `text-h1` (32px) widens page headers; title rows with controls (Weekly Sync, Daily Review week pickers, Customer detail) may wrap on mobile | Med | T9a/T9b acceptance requires a mobile-width visual check; Playwright mobile project runs at W3 |
| Fix 6 headings change from caps to sentence case visually; a test may match uppercase text | Low | DOM text is unchanged (CSS `uppercase`); T6/T7 grep `e2e/` before commit |
| Risk-status `<select>` background conflict (`bg-surface-container-lowest` vs chip bg) | Med | T4 acceptance requires a browser check and resolving the conflict if the chip bg loses |
| Drag-engine files (`SolvroGantt`, `kanban-v2/cards`) | Med | Classes only; `gantt-parity` and `kanban-dnd` are mandatory evidence |
| Wave 4 touches ~30 files; easy to miss a site or hit a borderless one | Low | Inventory grep before and after each task; borderless controls explicitly out of scope |
| Vendored `ui/switch.tsx` patch counts in `gates.sh` | Low | T10 updates any counter that changes and says so |

## Open questions

None — all resolved in Decisions. Plan awaits user approval before Wave 1 starts.
