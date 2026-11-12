# antislop port (2026-11-12)

Status: implemented on `feat/antislop-port`, reviewed, awaiting owner approval to commit.

Source: a live review of this app on 2026-11-12 (every top-level page and project tab, dark and light, 1440px and iPhone 13) compared with the sibling repository `alfi-rajasyah/solvro` at `f945750`, which ran antislop audit 001 on 2026-11-10 and fixed it. The two frontends differ in 286 files, so this is a port by pattern, never a file copy.

## Owner decisions (2026-11-12)

- Light `primary` is `#1f7533` (`31 117 51`). `#267937` measured 4.25:1 on `surface-container-high`.
- A missing value renders an en dash through `EMPTY_VALUE` (`frontend/src/lib/emptyValue.ts`).
- The 44px touch target applies to touch input only. Desktop density stays.
- antislop is a Guardrail, mode "during" (root `CLAUDE.md`, `frontend/CLAUDE.md`, both agent definitions, the dial in `docs/DESIGN.md`).
- Login keeps its look (two panels, eyebrow, headline, pills, rings), as decided for the sibling repository on 2026-11-10. Only false content changes. This product has no Pipeline: the body line is "Workspace for project delivery" (owner wording) and the third pill is "Weekly sync" (replacing "Customer reports", a feature removed 2026-08-03).
- Lesson carried over from the sibling repository: fix the defect, keep the look.
- New design work (stat tile, project header, Gantt tree header label) is prototyped for owner review before any code, for this repository only. It is not part of this branch.

## Already in place (shared, do not edit)

- `frontend/src/index.css`: light `--primary` is `31 117 51`; a base rule gives every button-like control `cursor: pointer` and disabled ones `not-allowed`; a `tap-target` utility gives a control a 44px hit area on touch input without changing its look; a global reduced-motion rule.
- `frontend/src/lib/emptyValue.ts`: `EMPTY_VALUE`.
- `frontend/src/lib/themePreview.ts`: `LIGHT_PREVIEW_VARS` for the Settings theme preview.
- `frontend/src/lib/tokenContrast.test.ts`: pins the token pairs and `primary` as text on each surface.
- `frontend/src/lib/utils.ts`: `TOOLBAR_BOX`, `TOOLBAR_BUTTON_PRIMARY`, `TOOLBAR_BUTTON_OUTLINE`, `TOOLBAR_STAT`.
- `frontend/src/components/RiskScoreChip.tsx`; `StatusChip.tsx` exports `Tone` and `CHIP_BASE` is single-line.
- `frontend/src/lib/gantt/exportPdf.ts`: follows the new green.

## Sweeps: every task applies these inside its own files

- **S1, em dash.** No `—` in any string a user can read: JSX text, labels, titles, `aria-label`s, placeholders, toasts, errors, help text. Rewrite the sentence with a comma, colon, full stop or parentheses so it still reads naturally; do not just swap the character. A lone `—` standing for "no value" becomes `EMPTY_VALUE`. Leave code comments alone. When a changed string is asserted in a unit test or in `e2e/tests/`, update that assertion to match.
- **S2, icons.** Every `material-symbols-outlined` element that is decoration gets `aria-hidden="true"`. If the icon is the only content of a control, the control carries an `aria-label`. If the element with the icon class is itself the button, it gets an `aria-label`, not `aria-hidden`.
- **S3, text on green.** `text-white` on a solid `bg-primary` becomes `text-on-primary`.
- **S4, radius.** `rounded-lg` becomes `rounded-sm`. `rounded-xl` stays only on board column wells (project Kanban, iTop ticket board); elsewhere it becomes `rounded-sm`.
- **S5, type sizes.** On text, not on icon elements: `text-[12px]` to `text-meta`, `text-[13px]` to `text-xs`, `text-[15px]` to `text-sm`, `text-[17px]` to `text-base`, `text-[19px]` to `text-lg`. Keep any explicit weight or leading class that was there. Sizes with no matching role, and sizes on icon elements, stay; list them in the report.
- **S6, arrows.** Remove `→` and `↗` from link and button labels. Keep an arrow only where it states a change from one named thing to another.
- **S7, blur.** Remove `backdrop-blur-*`; scrims keep their tint, and a panel that relied on blur gets an opaque background.
- **S8, focus.** An input that hides its outline must show the app focus treatment from `docs/DESIGN.md` section 4 on itself or, with `focus-within:`, on its wrapper.
- **S9, touch targets.** Add `tap-target` to controls under 44px that a phone user taps: top-bar buttons, the navigation toggle, tab links, week arrows, icon-only row and menu buttons, close buttons, sort headers, collapse toggles. Not on an element that is `absolute` or `fixed`, or that uses an `after:` utility.

## Tasks (disjoint files, run in parallel)

- **Task A, top-level pages:** `frontend/src/pages/*.tsx` (not `pages/views/`, not `pages/embed/`).
  - Login: the body line and third pill as decided; root element becomes `main`; `locale="en"` on the Google provider; inline pixel sizes move to type roles where a role matches (the 40px headline stays).
  - Admin: no `opacity-60` on inactive user rows, an "Inactive" gray chip instead.
  - Overview: drop the coloured left stripe on attention rows; let the row wrap to two lines below `md:` so the project name gets the full width.
  - Settings: tabs (Account, Appearance, Integrations, Service catalogue) with the tab in `?tab=`, rows instead of boxed cards, the theme preview drawn from real tokens (`LIGHT_PREVIEW_VARS`, a nested `.dark` scope for the dark tile). Reference: the sibling repository's `pages/Settings.tsx`.
  - Projects, Customers: the main action uses `TOOLBAR_BUTTON_PRIMARY`.
- **Task B, feature areas:** `frontend/src/pages/views/**`, `frontend/src/pages/embed/**` and `frontend/src/components/{itop,admin,daily-review,customer,services,portfolio,outline,embed,utilization}/**`.
  - Risks: score and read-only status use `RiskScoreChip` / the shared `Chip`; the four counters become `TOOLBAR_STAT` cards with the colour on the number; "Add risk" uses `TOOLBAR_BUTTON_PRIMARY`.
  - List, Epics, Services, iTop Tickets tab: toolbar buttons use the `TOOLBAR_*` constants.
  - Daily Review: visible labels on the note boxes.
- **Task C, shared components and lib:** every other file under `frontend/src` (`components/*.tsx`, `components/{layout,kanban-v2,gantt-v2,skeletons}/**`, `lib/**`, `hooks/**`).
  - `TopBar`, `AssigneeAvatar`: S3.
  - `Modal`, `CommandPalette`, `RightSidebar`, `Sidebar`, Kanban sheets: S7.
  - Shell (`TopBar`, `Sidebar`, `Tabs`): S9.
  - Kanban and Gantt toolbars: `TOOLBAR_*` constants. `gantt-v2/` and `kanban-v2/adapter.ts` / `commitMapper.ts` are on the spine list: keep changes there to the mechanical sweeps.

Out of bounds for every task: `components/ui/`, `components/reui/`, `index.css`, `lib/emptyValue.ts`, `lib/themePreview.ts`, `lib/tokenContrast.test.ts`, `lib/utils.ts`, `components/RiskScoreChip.tsx`, `components/StatusChip.tsx`, every `CLAUDE.md`, `docs/`, `CHANGELOG.md` (report the entry text instead), `.claude/`.

Typecheck is one at a time in the frontend container. Use the lock:
`docker compose exec -T frontend sh -c 'while ! mkdir /tmp/tsc.lock 2>/dev/null; do sleep 5; done; npm run typecheck; rc=$?; rmdir /tmp/tsc.lock; exit $rc'`

## After the tasks

- `gates.sh` design guards: no em dash in user-facing text, no `text-white` on `bg-primary`, no icon element without `aria-hidden` (or `aria-label` when it is the control).
- One phase review, the antislop Delivery Gate (recorded below), docs sync for `docs/DESIGN.md`.

## Delivery Gate

Run 2026-11-12 on the dev stack (`localhost:5174`), signed in as the admin, 23 routes, desktop 1440x900 and iPhone 13 emulation, dark and light. Scope: what this phase changed. Rules that only apply to marketing pages (statistics, testimonials, FAQ, pricing, hero media) have nothing to check in this app and are not listed.

### Hard Gate

- R-02 PASS: `gates.sh` `design-no-em-dash` passes on `frontend/src`; the PWA manifest description was fixed by hand. Em dashes still seen on screen come from stored data (a project named "Klinik Sehat — Microsoft 365 Migration").
- R-03 PASS: no horizontal overflow on any route. On iPhone 13 emulation every measured control on the 23 routes reaches 44px on touch (real size where controls sit close together, a hit-area overlay where there is room), and no control's centre is covered by a neighbour's hit area. Recorded exceptions, by decision: links inside running sentences, the Kanban pager dots (duplicated by the arrows), the List and Gantt-tree drag handles, the label colour swatches, and the name links inside Overview recent-note headers (`docs/ISSUES.md`). Desktop sizes are unchanged: the sizes are behind `pointer: coarse`. Not measured: dialogs, side panels and menus in their open state (the review read their classes; the e2e suite exercises them).
- R-24, R-26 PASS: Settings tabs switch and write `?tab=`; iTop token links open `?tab=integrations`; no control was added without a behaviour.
- R-25 PASS for what changed: light `primary` 4.51:1 on `surface-container-high`, pinned by `tokenContrast.test.ts` (32 tests pass); avatar initials `on-primary` 5.34:1; no solid green button turns pale under white text on hover any more (`hover:bg-primary/90` everywhere it was paired with `text-on-primary`).
- R-27 PASS: no data view lost its empty, loading or error state (review found none removed).
- R-32 PASS: inputs that hid their outline show the focus ring; Escape closes the risk modal, task panel and palette.
- R-33 PASS: no patch scripts.
- R-34 PASS: light and dark screenshots of all 23 routes; picking Light and Dark in Settings flips the theme.
- R-35 PASS: click-through recorded: Settings "Appearance" tab -> `/settings?tab=appearance`; Light radio -> light theme; Dark radio -> dark theme; "Add risk" -> dialog opens, Escape closes it; Kanban card title -> task panel with `?task=`; Ctrl+K -> command palette. No console errors apart from Google Sign-In rejecting the dev origin. Not exercised: drag and drop, form submits, the iTop and Outline flows by hand (their e2e specs passed: 68 passed, 1 skipped across ten specs, desktop).
- R-36, R-38 PASS: the Login body line and third pill now describe the product; the version line comes from the build.
- R-37 PASS: direction is `docs/DESIGN.md`; dial ENERGY 1 / RHYTHM 1 / MOTION 1.
- R-39 PASS for what changed: pointer cursor on every button, checkbox and radio (the search trigger keeps its text cursor on purpose); icon guard passes; reduced motion honoured globally; Login is a `main` with one `h1`; "Open in iTop" links announce the new tab. Known and deferred: a `role="button"` span inside a `button` in `InstallBanner`.
- R-40: not applicable (no media added); no performance number was measured or reported.

### Purpose-Gate

- R-08 PASS: arrows removed from link and button labels; kept only where they state a mapping or sequence.
- R-09, R-07 recorded override: the Login eyebrow, pills and rings stay by owner decision.
- R-10 PASS: no backdrop blur in app code.
- R-06 recorded override: uppercase `text-label-caps` is `docs/DESIGN.md` direction.
- R-12, R-13, R-01 PASS: no shadow, glow or gradient added.
- R-14: not addressed here. The repeated stat tile row is separate design work, prototyped before any code.

### Liveliness

Dials declared and held (calm, uniform, hover-only motion). Accent is the single green. Focal point per screen is not improved by this phase; it is the subject of the stat tile and project header prototypes.

### Craftsmanship and Quality Locks

- C-1 to C-5 PASS for what changed.
- R-11 PASS: small radius everywhere except board column wells.
- R-29, R-30 PASS: no colour added; nothing cloned.
- R-31 PASS: reasons recorded per decision in this plan and the changelog.

Result: no FAIL. Two owner decisions after the first gate run (2026-11-12): fix the remaining touch targets, including a marked patch to the vendored data-grid sort header; move the Outline connection to the Settings Integrations tab.
