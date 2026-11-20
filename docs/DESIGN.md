---
name: Technical Precision
theme_default: dark
dial: ENERGY 1 / RHYTHM 1 / MOTION 1
maintained_by: solvro-docs-keeper — regenerated whenever a diff touches index.css or theme.tsx (tailwind.config.ts was deleted 2026-07-24, Tailwind v4 CSS-first migration — see CHANGELOG)
source_of_truth: frontend/src/index.css (CSS-first `@theme`/`@theme inline` token definitions + `:root`/`.dark` CSS custom properties for both themes) + frontend/src/lib/theme.tsx (theme switching)

colors:
  dark:
    surface: '#232321'
    surface-dim: '#1a1a18'
    surface-bright: '#2a2a28'
    surface-container-lowest: '#1a1a18'
    surface-container-low: '#232321'
    surface-container: '#2a2a28'
    surface-container-high: '#323230'
    surface-container-highest: '#3a3a37'
    on-surface: '#f0ede8'
    on-surface-variant: '#b0ada8'
    inverse-surface: '#f0ede8'
    inverse-on-surface: '#232321'
    outline: '#4a4a47'
    outline-variant: '#3a3a37'
    primary: '#3aae51'
    on-primary: '#0f2b16'
    primary-container: '#2d9042'
    on-primary-container: '#e8f7eb'
    primary-tint-text: '#6dd183'
    inverse-primary: '#1f7533'
    secondary: '#888780'
    on-secondary: '#1a1a18'
    secondary-container: '#323230'
    on-secondary-container: '#b0ada8'
    tertiary: '#707570'
    on-tertiary: '#f0ede8'
    error: '#f87171'
    on-error: '#2a0a0a'
    error-container: '#3d1212'
    on-error-container: '#fca5a5'
    background: '#1a1a18'
    on-background: '#f0ede8'
  light:
    surface: '#f9f9f7'
    surface-dim: '#e8e8e4'
    surface-bright: '#ffffff'
    surface-container-lowest: '#ffffff'
    surface-container-low: '#f2f2ee'
    surface-container: '#ebebe7'
    surface-container-high: '#e4e4e0'
    surface-container-highest: '#dededa'
    on-surface: '#1a1a18'
    on-surface-variant: '#4a4a47'
    inverse-surface: '#232321'
    inverse-on-surface: '#f0ede8'
    outline: '#9a9a97'
    outline-variant: '#d0d0cc'
    primary: '#1f7533'
    on-primary: '#ffffff'
    primary-container: '#c8e6cf'
    on-primary-container: '#0f2b16'
    primary-tint-text: '#175f26'
    inverse-primary: '#3aae51'
    secondary: '#5f5e57'
    on-secondary: '#ffffff'
    secondary-container: '#e0dfd8'
    on-secondary-container: '#323230'
    tertiary: '#5a5f5a'
    on-tertiary: '#ffffff'
    error: '#ba1a1a'
    on-error: '#ffffff'
    error-container: '#ffdad6'
    on-error-container: '#93000a'
    background: '#f9f9f7'
    on-background: '#1a1a18'
chips:
  dark:
    emerald-bg: '#064e3b'
    emerald-text: '#a7f3d0'
    amber-bg: '#78350f'
    amber-text: '#fde68a'
    rose-bg: '#7f1d1d'
    rose-text: '#fecaca'
    violet-bg: '#4c1d95'
    violet-text: '#ddd6fe'
  light:
    emerald-bg: '#dcfce7'
    emerald-text: '#11813b'
    amber-bg: '#fef3c7'
    amber-text: '#a75c05'
    rose-bg: '#fee2e2'
    rose-text: '#ca2121'
    violet-bg: '#ede9fe'
    violet-text: '#6d28d9'
fixed:
  ink: '#191919'
  ink-hover: '#2e2e2e'
  sidebar: '#232321'
  rail-text: '#a8a69f'
  rail-text-hover: '#f0ede8'
  rail-text-muted: '#9c9a93'
typography:
  family: Source Sans 3
  aliases: [font-display, font-body]
  weights_loaded: 300..700 (variable font range)
  mono_family: Tailwind default monospace stack (font-mono is not remapped)
  scale:
    xs: { size: 13px, lineHeight: '1.35' }
    sm: { size: 15px, lineHeight: '1.45' }
    base: { size: 17px, lineHeight: '1.55' }
    lg: { size: 19px, lineHeight: '1.55' }
    xl: { size: 21px, lineHeight: '1.5' }
    2xl: { size: 25px, lineHeight: '1.4' }
    3xl: { size: 31px, lineHeight: '1.3' }
    4xl: { size: 37px, lineHeight: '1.2' }
  roles:
    h1: { fontSize: 32px, fontWeight: '600', lineHeight: '1.2' }
    h2: { fontSize: 24px, fontWeight: '600', lineHeight: '1.2' }
    body-lg: { fontSize: 16px, fontWeight: '450', lineHeight: '1.5' }
    body-sm: { fontSize: 15px, fontWeight: '450', lineHeight: '1.5' }
    data-mono: { fontSize: 13px, fontWeight: '500', lineHeight: '1.4', letterSpacing: -0.01em }
    label-caps: { fontSize: 12px, fontWeight: '700', lineHeight: '1', letterSpacing: 0.05em, transform: uppercase }
    meta: { fontSize: 12px, fontWeight: '500', lineHeight: '1.35' }
radii:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
shadows:
  overlay: 0 4px 24px rgba(0,0,0,0.18)
spacing:
  sidebar: 260px
  sidebar-collapsed: 4rem
  context-panel: 320px
---

## 0. What this file is

**Technical Precision** — Solvro's design system. Bare-metal, data-dense, built for TAMs running high-density dashboards, not consumer software.

**DARK is the default and canonical theme.** The system is designed dark-first: reference mockups, the login screen, and the sidebar all render dark unconditionally. Light is a fully supported variant of the same structural language, not an afterthought — but every new component should be designed against the dark palette first.

**Maintenance: code is the source of truth.** This file describes `frontend/src/index.css` (CSS-first `@theme` token wiring — colors, radii, font scale, shadow token — plus `:root`/`.dark` CSS custom properties) and `frontend/src/lib/theme.tsx` (theme switching). It is regenerated by the `solvro-docs-keeper` agent whenever a diff touches either file. `tailwind.config.ts` was deleted 2026-07-24 (Tailwind v4 CSS-first migration, Plan A Task 2) — token wiring that used to live there now lives directly in `index.css`'s `@theme` block. If this file and the code ever disagree, **the code is right** — file a docs-sync task rather than trusting the table.

**Dial: ENERGY 1 / RHYTHM 1 / MOTION 1** (owner decision 2026-11-12, read by the antislop filter in `docs/reference/antislop.md`). Calm: a dense operations tool that never competes with its own data. Uniform: predictable grids, tables and boards, with sameness between screens as the point. Motion: hover states and short state transitions only, no scroll or entrance choreography. Unlike the tokens, this line is not derived from code: keep it as written whenever this file is regenerated.

The frontmatter above is the canonical machine-readable token map. The tables below are the human-readable rendering of the same values — kept in lockstep by hand today, value-checked against `index.css` on every edit.

---

## 1. Colors — Semantic Tokens

Every token is a CSS custom property in `index.css` (`--token-name`, space-separated RGB triple), routed to a Tailwind-consumable color in the primary `@theme inline` block via `rgb(var(--token))` (e.g. `--color-primary: rgb(var(--primary));`). The block must stay `inline`: with `inline`, each utility compiles the RGB triplet directly into its own rule (e.g. `.bg-primary { color: rgb(var(--primary)) }`), so `var(--token)` resolves at the *consuming* element rather than freezing at `:root` (the declaring element) — this is what keeps subtree `dark` pins (`Login.tsx`, `Sidebar.tsx`, see §5) working, and opacity utilities like `bg-primary/10` keep working via Tailwind v4's `color-mix` wrapping that inlined value. `:root` holds the light values; `.dark` overrides them — `@custom-variant dark (&:where(.dark, .dark *));` (also in `index.css`) means the whole flip is one class toggle on `<html>`, not a media query. (Pre-2026-07-24 this was Tailwind v3's `darkMode: "class"` config key — same behavior, now expressed in CSS. A non-inline `@theme` regressed the Login/Sidebar subtree pins between the 2026-07-24 v4 migration and its 2026-07-25 fix — see CHANGELOG.)

| Token | Dark (default) | Light | Notes |
|---|---|---|---|
| `surface` | `#232321` | `#f9f9f7` | |
| `surface-dim` | `#1a1a18` | `#e8e8e4` | |
| `surface-bright` | `#2a2a28` | `#ffffff` | |
| `surface-container-lowest` | `#1a1a18` | `#ffffff` | inputs, deepest inset |
| `surface-container-low` | `#232321` | `#f2f2ee` | context panel background |
| `surface-container` | `#2a2a28` | `#ebebe7` | cards, modals |
| `surface-container-high` | `#323230` | `#e4e4e0` | hover states |
| `surface-container-highest` | `#3a3a37` | `#dededa` | dividers, strongest tint |
| `on-surface` | `#f0ede8` | `#1a1a18` | primary text |
| `on-surface-variant` | `#b0ada8` | `#4a4a47` | secondary/muted text |
| `inverse-surface` | `#f0ede8` | `#232321` | |
| `inverse-on-surface` | `#232321` | `#f0ede8` | |
| `outline` | `#4a4a47` | `#9a9a97` | emphasis borders |
| `outline-variant` | `#3a3a37` | `#d0d0cc` | default 1px borders — the elevation primitive |
| `primary` | `#3aae51` | `#1f7533` | Elitery Green — the only accent color; light value darkened 2026-11-12 (was `#267937`, before 2026-10-23 `#2d9042`) so green text holds 4.5:1 on every surface down to `surface-container-high`, where `#267937` measured 4.25:1; pinned by `frontend/src/lib/tokenContrast.test.ts` |
| `on-primary` | `#0f2b16` | `#ffffff` | |
| `primary-container` | `#2d9042` | `#c8e6cf` | |
| `on-primary-container` | `#e8f7eb` | `#0f2b16` | |
| `primary-tint-text` | `#6dd183` | `#175f26` | text of chips on `primary/10`, `primary/15` and `primary/20` tints (StatusChip "blue" tone, PrimaryChip, mention and count chips); holds at least 4.5:1 up to `surface-container-highest` in both themes. Lighter than `primary` in dark (user decision 2026-11-13); in light, darker than `primary` (`#1f7533` was 3.52:1 on the tint over `surface-container-highest`, `#175f26` is 4.76:1); the dark value is pinned by `tokenContrast.test.ts` |
| `inverse-primary` | `#1f7533` | `#3aae51` | dark value equals the light `primary` (aligned 2026-11-12, user decision D-06); it is the green used on an inverted (light) surface |
| `secondary` | `#888780` | `#5f5e57` | secondary text and icons; not used on the sidebar rail (`#888780` is 4.37:1 on `#232321`) — the rail uses the fixed `rail-text*` tokens |
| `on-secondary` | `#1a1a18` | `#ffffff` | |
| `secondary-container` | `#323230` | `#e0dfd8` | |
| `on-secondary-container` | `#b0ada8` | `#323230` | |
| `tertiary` | `#707570` | `#5a5f5a` | |
| `on-tertiary` | `#f0ede8` | `#ffffff` | |
| `error` | `#f87171` | `#ba1a1a` | |
| `on-error` | `#2a0a0a` | `#ffffff` | |
| `error-container` | `#3d1212` | `#ffdad6` | |
| `on-error-container` | `#fca5a5` | `#93000a` | |
| `background` | `#1a1a18` | `#f9f9f7` | page-level, below `surface` |
| `on-background` | `#f0ede8` | `#1a1a18` | |

> `tertiary-container` / `on-tertiary-container` are **not defined** as CSS variables in either theme and are **not wired** in the `@theme` block of `index.css` — do not use `bg-tertiary-container` etc.; the class will not resolve to a theme-aware color. (The pre-2026-07-21 DESIGN.md listed them; that was stale.)

### Chip / status tint pairs

Background + text pair per tone, both flip with theme:

| Tone | Dark bg / text | Light bg / text |
|---|---|---|
| `chip-emerald` | `#064e3b` / `#a7f3d0` | `#dcfce7` / `#11813b` |
| `chip-amber` | `#78350f` / `#fde68a` | `#fef3c7` / `#a75c05` |
| `chip-rose` | `#7f1d1d` / `#fecaca` | `#fee2e2` / `#ca2121` |
| `chip-violet` | `#4c1d95` / `#ddd6fe` | `#ede9fe` / `#6d28d9` |

Amber and violet also serve as workspace task-status tones (see the status chip tone table in §5), alongside their other roles.

The light text shades (emerald, amber, rose; changed 2026-10-23) are the lightest of each hue that reach 4.5:1 on their own chip background and on white; the `Alert` success and warning tones below inherit them.

> The vendored `Alert` component (`frontend/src/components/reui/alert.tsx`)
> consumes the chip text tones and the inverse-surface pair through the
> shadcn semantic bridge (the second `@theme inline` block in `index.css`,
> see §6): `--color-success` → `chip-emerald-text`, `--color-warning` →
> `chip-amber-text`, `--color-info` → `chip-violet-text`, `--color-invert` →
> `inverse-surface`, `--color-invert-foreground` → `inverse-on-surface`. No
> new custom properties — each name aliases a value already in the tables
> above. `chip-violet` previously had no assigned status meaning; the Alert
> bridge is the first thing to route it there (as "info"). It now carries a
> second meaning: the manual **Critical Path** task mark
> (`frontend/src/components/CriticalPathMark.tsx`) uses the same pair as a
> chip (`bg-chip-violet-bg text-chip-violet-text`) and `chip-violet-text`
> alone for the Gantt bar's inset ring / milestone outline and its glyph. No
> token change — both consumers reuse the values above.

### Fixed tokens (do not flip with theme)

| Token | Value | Where |
|---|---|---|
| `ink` | `#191919` | always-dark brand chrome: login hero panel, primary sign-in button |
| `ink-hover` | `#2e2e2e` | hover state for `ink` surfaces |
| `sidebar` | `#232321` | the left nav rail — **fixed in both themes**, see §5 |
| `rail-text` | `#a8a69f` | inactive nav item text and icons on the rail (6.46:1 on `sidebar`, 5.59:1 on the `white/5` hover) |
| `rail-text-hover` | `#f0ede8` | rail text base colour and hover state (13.48:1 on `sidebar`) |
| `rail-text-muted` | `#9c9a93` | tertiary rail glyphs, e.g. the external-link icon on the Outline item (5.59:1 on `sidebar`) |

---

## 2. Typography

Single typeface app-wide: **Source Sans 3**, loaded 300–700 variable range, aliased to both `font-display` and `font-body` via `--font-display`/`--font-body` in the `@theme` block of `index.css` — there is no separate display face. `font-mono` is **not remapped**; it keeps Tailwind's default monospace stack. It's used ad hoc for IDs, counts, and version/build tags (the TopBar build tag, ticket refs, project ID badges) and inside the date-picker trigger inputs (`DateField`/`DateRangeField`); the Gantt tree's date columns (`TreeCells.tsx`) use the body font, not mono — it is not a formally named design role like `data-mono` below.

### Base scale (overrides Tailwind defaults, +1px across the board)

| Class | Size | Line-height |
|---|---|---|
| `text-xs` | 13px | 1.35 |
| `text-sm` | 15px | 1.45 |
| `text-base` | 17px | 1.55 |
| `text-lg` | 19px | 1.55 |
| `text-xl` | 21px | 1.5 |
| `text-2xl` | 25px | 1.4 |
| `text-3xl` | 31px | 1.3 |
| `text-4xl` | 37px | 1.2 |

### Named roles

| Class | Size | Weight | Line-height | Letter-spacing | Use |
|---|---|---|---|---|---|
| `text-h1` | 32px | 600 | 1.2 | — | page-level headings |
| `text-h2` | 24px | 600 | 1.2 | — | section headings |
| `text-body-lg` | 16px | 450 | 1.5 | — | prominent body copy |
| `text-body-sm` | 15px | 450 | 1.5 | — | default body text — applied app-wide via `body { @apply ... font-body text-body-sm }` in `index.css` |
| `text-data-mono` | 13px | 500 | 1.4 | -0.01em | tabular numerics in IDs and data columns |
| `text-label-caps` | 12px | 700 | 1 | 0.05em | uppercase micro-headers, column labels — pair with `uppercase` utility, transform is not baked into the class itself |
| `text-meta` | 12px | 500 | 1.35 | — | chips, badges, secondary meta — sentence case, no uppercase transform |

Body weight is **450**, not the CSS-default 400 — this only renders correctly because the variable font's 300–700 range is loaded; a static 400-weight fallback would round down.

These seven named roles are also registered as `font-size` keys in the `tailwind-merge` config (`extendTailwindMerge`'s `theme.text` list in `frontend/src/lib/utils.ts`'s `cn()` helper) — without that registration, `twMerge`'s default classifier doesn't recognize `text-h1`/`text-label-caps`/etc. as size utilities, so an unmatched name falls through to the color-utility validator and can silently evict (or be evicted by) a real `text-{color}` class combined with it in the same `cn()` call. Any future named role must be added to that list too, or it inherits the same latent bug.

**Binding rules adopted with the UI sync (2026-10-09; `docs/archive/plans/internal-sync.md`):**

- **Words come from `frontend/src/lib/labels.ts`.** Exception: a task's status name is user-defined (workspace `TaskStatusDef`) and shown as stored; status-picker group headers use `TASK_CATEGORY_GROUP_LABEL` (Not started · Active · Done). Every other status, priority, risk level, project status and weekly-health value shown to a user uses its label map (To do · In progress · Done; Low · Medium · High · Urgent; Planning · Active · On hold · …). Never render a raw enum value or a hand-written label map in a component.
- **Dates come from `frontend/src/lib/formatDate.ts`.** Day-first, 24-hour (`28 Sep`, `22 – 28 Aug`, `28 Sep, 14:22`, `5 min ago`); calendar days format in UTC, timestamps in local time; a range outside the current year shows its year. No `toLocaleDateString`, month lists or relative-time helpers in components; dates render in the body font, not `font-mono`.
- **No text under 12px.** `text-meta` is the smallest role (chips, links, counts, captions); `text-label-caps` for uppercase micro-labels; `text-xs` for helper and error text. Arbitrary `text-[Npx]` below 12px is a violation.
- **Buttons, link-buttons and tabs are sentence case** (`font-semibold`, no `uppercase tracking-wider`). `tracking-wider` is never added next to `text-label-caps` — the role already carries its tracking.
- **Destructive confirmations use `ConfirmModal` with the `danger` tone**, never the browser's `confirm()`. Dialogs move focus inside on open and restore it on close (`hooks/useDialogFocus.ts`).
- **Non-modal side panels take and return focus, without trapping Tab** (task, epic and iTop ticket panels; `hooks/usePanelFocus.ts(ref, item, shell)`). Focus moves into the panel when it opens or shows a new `item`; after a `shell` swap (loading, error, ready) it comes back only if the swap dropped it to `<body>`, so focus the user moved elsewhere is left alone; on close it returns to the opener. The page behind stays usable, so there is no Tab trap. The panel element is `div role="dialog" aria-label=… tabIndex={-1}` — never `aside role="dialog"` (`aside` does not allow that role) — in its loading and not-found states too.
- **Cards open from the keyboard through their title button.** On the Kanban, the iTop ticket board and the List, the task/ticket title is a `<button>` (Enter or Space opens the panel). The card wrapper carries no role and no tab stop. The grip is a focusable `<button>` carrying the drag library's attributes and listeners: Space lifts, arrow keys move, Space drops, Escape cancels. Mouse and touch drag are unchanged. Sortable rows (task panel subtasks, section reorder, task statuses) put the attributes on the handle the same way, and read-only rows are not tab stops.
- **Loading states are skeletons from `frontend/src/components/skeletons/`**, shown after a 150 ms delay so fast loads do not flash; no bare grey blocks and no spinners for page content.
- **Top-bar titles and breadcrumbs come from `frontend/src/lib/routeMeta.ts`**; no page falls back to "Solvro". A new route registers its title there (`routeMeta.test.ts` pins them).

---

## 3. Radii

| Token | Value | Px |
|---|---|---|
| `sm` | `0.125rem` | 2px |
| `DEFAULT` | `0.25rem` | 4px |
| `md` | `0.375rem` | 6px |
| `lg` | `0.5rem` | 8px |
| `xl` | `0.75rem` | 12px |
| `full` | `9999px` | pill |

**Large radii are forbidden.** There is no `2xl`/`3xl` radius token — don't invent one. `full` is reserved for pill-shaped status chips and avatar circles only; never use it on cards, panels, or buttons.

> **Tailwind v4 class-name shift (2026-07-24, Plan A Task 1 codemod):** v4's default radius scale renamed the classes under these same values — what emits `0.125rem` is now `rounded-xs` (was `rounded-sm` in v3), and `rounded-sm`/`rounded` now emit `0.25rem`. The token *values* in the table above are unchanged; `index.css`'s `@theme` block explicitly zeroes out `--radius-2xl`/`--radius-3xl`/`--radius-4xl` since v4's defaults already line up with this table post-rename. If you're reading v3-era component code or docs, mentally shift `rounded-sm` → `rounded-xs`.

---

## 4. Elevation Doctrine

Hierarchy comes from **1px `outline-variant` borders and tonal surface shifts** — not drop shadows. This is the single most load-bearing rule in the system; violating it is the fastest way to break the bare-metal aesthetic.

- **Level 0** — canvas: `background` token.
- **Level 1** — cards, panels, table rows: `surface-container` family + 1px `border-outline-variant`. No shadow.
- **Level 2** — the one sanctioned exception:

```
shadow-overlay: 0 4px 24px rgba(0,0,0,0.18)
```

This value is **fixed** — it does not flip between themes (unlike every color token above). It is wired as `--shadow-overlay` in the primary `@theme inline` block of `frontend/src/index.css` (~line 116), a Tailwind v4 CSS custom property, not a `tailwind.config.ts` `boxShadow.overlay` entry — that config file was deleted 2026-07-24 in the Tailwind v4 CSS-first migration (see CHANGELOG).

**Whitelist — only these may use `shadow-overlay`:**

| Surface | Component(s) |
|---|---|
| Modals | `Modal.tsx` |
| Command palette | `CommandPalette.tsx` (⌘K global search overlay, Modal-convention shell) |
| Drawer | `Drawer.tsx` |
| Task detail panel | `TaskPanel.tsx` |
| Ticket detail panel | `TicketPanel.tsx` (right-side iTop ticket panel on the customer Tickets tab, `fixed right-0 top-14 bottom-0` same as the task panel) |
| Epic detail panel | `EpicPanel.tsx` (right-side panel on the Epics tab, deep-linked via `?epic=<id>`, `fixed right-0 top-14 bottom-0` same shell as the task and ticket panels; added in the Epics phase, 2026-09-24) |
| Dropdown menus | `TopBar.tsx` user menu, `layout/NotificationBell.tsx` notifications popover (TopBar bell; base-ui Popover via `ui/popover.tsx` on `bg-popover`, `shadow-overlay!` because the vendored popup ships `shadow-md`, Phase 4 "Activity and notifications", 2026-09-30), `components/TaskFilterPopover.tsx` (the shared Filter popover of List, Kanban, Gantt and Timeline; a Base-UI popover via `ui/popover.tsx`, clamped 16px inside the viewport below `md`), `pages/views/ProjectRisks.tsx`'s Prob/Impact `ScaleSelect` and Status select (`ui/select.tsx` popups, `shadow-overlay!` so the stock `shadow-md` does not win), `itop/RowTicketCell.tsx`'s ticket menu (`ui/dropdown-menu.tsx` popup, `shadow-overlay!`), `SolvroGantt.tsx`'s Export (Excel/PDF) dropdown (hand-rolled `absolute top-full` popover, restyled from `shadow-lg` in the Gantt visual refresh phase, 2026-08-03) and its `DropdownMenuContent` actions menu (`shadow-overlay!`), `SolvroKanban.tsx`'s row menu (~`:126`), `TaskPanel.tsx`'s ⋯ options menu, `components/StatusSelect.tsx`'s grouped status popup (`ui/select.tsx` popup, `shadow-overlay!` so the stock `shadow-md` does not win), `components/admin/TaskStatusesTab.tsx`'s two `DropdownMenuContent` menus (`shadow-overlay!`), and the ⋯ action menus on `pages/ProjectDetail.tsx` (project actions), `pages/Projects.tsx` (project card row menu), `pages/Customers.tsx` (row menu) and `components/customer/AccountHeader.tsx` — those four are `ui/dropdown-menu.tsx` popups using `shadow-overlay!` (`!` for the same reason as `DateRangeField.tsx`: the vendored popup's stock `shadow-md` must not win) |
| Context menu | `ui/context-menu.tsx` (`ContextMenuContent` and `ContextMenuSubContent`, both — z-index moved onto the Positioner per the Popover z-index convention below) — Gantt tree row action menu (Edit/Add subtask/Delete), first consumed by `SolvroGantt.tsx`'s `renderResourceMenu` (right-click or hover "…" button); restyled from `shadow-lg`/`shadow-md` in the Gantt visual refresh phase, 2026-08-03 |
| Popovers | `TreeCells.tsx`'s `SectionColorCell` color picker (corrected 2026-08-03 — the old `GanttListRow.tsx` this row used to cite no longer exists), `reui/gantt/gantt-nav.tsx`'s `GanttDatePicker` calendar popover (`shadow-overlay!`; the vendored popup ships `shadow-md`), `DateField.tsx` calendar popover, `DateRangeField.tsx` calendar popover (paired START/DUE between-style range picker, user add-on 2026-07-28, plan Task 3.5; mounted via the now-shell-less `InlineDateRangeEditor.tsx` wrapper in `TaskPanel.tsx`'s DATES editor and the Gantt tree's `TreeCells.tsx`, and directly in `TaskFormModal.tsx`'s merged "Dates" row) — uses `shadow-overlay!` (`!important`, added in a fix round so the sanctioned shadow doesn't silently lose to the vendored Popover's default `shadow-md` depending on stylesheet load order); `DateField.tsx`'s own popup was deliberately left as plain `shadow-overlay` (out of scope for that fix round) — a known parity gap between the two sibling components; `CommentMentions.tsx`'s @mention picker listbox (task-panel comment composer; hand-rolled `absolute bottom-full` div on `bg-surface-container-lowest` with `border-outline-variant`, `rounded-sm`, plain `shadow-overlay`, Phase 4, 2026-09-30); `ProjectEpics.tsx`'s `ColorDot` color picker (its `shadow-overlay` div — a clone of `TreeCells.tsx`'s `SectionColorCell` popover pattern, added in the Epics phase, 2026-09-24) |
| Drag overlay | dragging card state: `ProjectKanban.tsx` (via `kanban-v2/cards.tsx`); the Gantt bar drag clone (`reui/gantt/gantt-dnd.tsx`, patched from `shadow-lg`); the iTop ticket board's `TicketCard.tsx` (`components/itop/board/`, on the vendored `reui/kanban` engine — columns are iTop's own lifecycle, not Solvro's To do / In progress / Done, and escalation renders as a chip on the card, never its own column; no optimistic move — a card only moves once the mapped iTop action succeeds) |
| Right context panel | `RightSidebar.tsx` |

> Implementation note: `RightSidebar.tsx` is in the whitelist by design intent (it's a floating overlay layer, same as Drawer), but as of this writing it does **not** apply the `shadow-overlay` class — it relies on `border-l border-outline-variant` over an opaque `bg-surface-container-low` only (no backdrop blur). Don't flag this as a violation; flag it as a gap if you're implementing elevation work in that file.

Nothing else gets a shadow. No card shadows, no hover-lift shadows, no focus-ring glows beyond the focus treatment described next. The app-wide keyboard focus treatment (user decision 2026-11-02, replacing the 2026-08-29 ring-only reduced form) depends on whether the control has a border. **Every bordered interactive control** (buttons, inputs, selects, switch) uses `focus-visible:outline-hidden focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/30` (`outline-hidden`, not `outline-none`, so forced-colours mode keeps a visible outline where it overrides the border colour and drops the ring), adapted to `has-focus-visible:`/`group-data-*` prefixes where the trigger is a wrapper rather than the focusable element itself (e.g. `calendar.tsx`'s dropdown root and day button). The ring alone (`ring-primary/30`) measures about 1.7:1 on dark and 1.5:1 on light, below the 3:1 WCAG 1.4.11 asks of a focus indicator; the primary border carries the contrast (about 6:1). **Borderless controls** (card title buttons, icon-only buttons, text-link buttons) use `outline-hidden focus-visible:ring-2 focus-visible:ring-primary` with a solid ring (user decision 2026-11-12; about 5.5:1 on dark and 5.1:1 on light, above the 3:1 of WCAG 1.4.11) — `outline-hidden` (unlike `outline-none`) keeps an outline in forced-colours mode. A borderless control with a solid `bg-primary` or `bg-error` fill adds `focus-visible:ring-offset-2 focus-visible:ring-offset-background`, so the ring does not merge into the fill. A bordered toggle that already shows `border-primary` while on (the Filter trigger, the project context toggle) gains nothing from the focus border, so when on it uses the borderless form with an offset instead: `focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background` (`toggleFocus` in `lib/utils.ts`). Tab links in a horizontally scrolling bar (`components/Tabs.tsx`, the project tabs) use the borderless form with `focus-visible:ring-inset`, because the bar clips anything drawn outside a tab. The title buttons in `kanban-v2/cards.tsx`, `itop/board/TicketCard.tsx` and `pages/views/ProjectList.tsx` use the borderless form. This is the one focus treatment for every form control app-wide; there is no separate "Buttons/Inputs conventions" section to consult.

**AI Breakdown** styling (`.ai-glow`, amber inner-border + glow) was reserved for blueprint-generated task cards; the Secure Ingestion Port that would have produced them is cancelled (see CLAUDE.md's Standing decisions), so this reservation is retired — see §5.

---

## 5. Behavioral Rules (MUST / NEVER)

| Rule | Detail |
|---|---|
| **Sidebar is fixed-dark** | `bg-sidebar` (`#232321`) in **both** themes — a literal hex (`--color-sidebar: #232321;`) in the `@theme` block of `index.css`, not a CSS-var-routed token. The rail never flips to light, even in light mode. |
| **Login always renders dark** | `Login.tsx`'s root is a `main` landmark that hard-pins the `dark` class regardless of the user's theme preference. Left hero panel uses `bg-background` (`#1a1a18`), right form panel uses `bg-surface` (`#232321`) — both resolved through the forced `.dark` scope, so they land on the dark values above. The brand panel keeps its look (eyebrow, two-line headline, three outlined pills reading Project tracking, Daily notes and Weekly sync, three decorative rings) by owner decision 2026-11-12, a sanctioned override of the antislop filter's findings on it. |
| **Primary is Elitery Green — never blue** | `#3aae51` dark / `#1f7533` light. This is the only accent color in the app: CTAs, active nav state, focus rings, links. Blue never appears as a primary/CTA color. |
| **`IN_PROGRESS` chip tone is misleadingly named "blue"** | `TaskStatusChip`'s `blue` tone renders `bg-primary/10 text-primary-tint-text dark:bg-primary/20` — it is **green-tinted**, not literal blue. Same for `ProjectStatusChip`'s `PLANNING`/`COMPLETED` tones, which also use the `blue` tone class. Don't "fix" this by pointing it at an actual blue token — it's intentional, per `StatusChip.tsx`. |
| **`.ai-glow` is retired, not reserved** | Amber (`#f59e0b`) inner-border + outer glow was reserved exclusively for blueprint-generated (AI Breakdown) task cards; that concept is cancelled along with the Secure Ingestion Port. `.ai-glow` does not exist anywhere in `frontend/src/` — do not introduce it for other status highlights without a new design decision. |
| **Icons are Material Symbols Outlined** | Loaded via Google Fonts in `index.html` (`opsz,wght,FILL,GRAD@24,400,0,0`), rendered with the `.material-symbols-outlined` class (variation settings pinned in `index.css`). Design/mockup tooling that can't render icon-font ligatures (e.g. Paper canvases) must substitute inline SVGs — this does not change the in-app convention. **Accessibility:** a decorative glyph span carries `aria-hidden="true"` (otherwise a screen reader reads the ligature word aloud, e.g. "drag_indicator"); an icon-only control carries an `aria-label`; a toggle's state goes in `aria-pressed` / `aria-expanded` / `aria-current`, never in the glyph alone. |
| **Compact data-grid mode** | Implemented via the vendored data grid's `tableLayout={{ dense: true }}` (`frontend/src/components/reui/data-grid/`), used on the Admin Users, Tasks, and CustomerDetail Overview grids: reduced cell padding/row height, and dense body/footer cells step down to `text-xs` (13px); the sanctioned 12px sentence-case token is `text-meta` (`text-label-caps` is reserved for uppercase labels). Column headers always render at `text-label-caps` (12px/700/uppercase) regardless of dense/default. Any hand-rolled table still needs this pattern applied by hand — check the specific component before assuming it's wired. |
| **Drag-drop insert-before indicator** | Corrected 2026-08-03 — the old `GanttListRow.tsx` this row used to cite no longer exists. The indicator is now the vendored engine's own `data-slot="gantt-reorder-indicator"` (`reui/gantt/gantt-view.tsx:2234-2257`): a caret head + 1px hairline pinned to the drop boundary, `border-s-primary`/`bg-primary` when the proposed drop is valid, `border-s-destructive`/`bg-destructive` when not. No `// SOLVRO PATCH` marker on this block — stock upstream engine behavior, not Solvro-authored. `SolvroGantt.tsx` passes `canReorderResource` to refuse section-row drops without `project:write` (section reorder needs both `task:write` and `project:write`). |
| **No backdrop blur on overlays** | Scrims are a tint only (`bg-black/40`-style) and panels are opaque: Modal, CommandPalette, the Sidebar scrim, RightSidebar and the Kanban sheets never use `backdrop-blur-*`. |
| **Cursors come from the base layer** | `index.css` sets `cursor: pointer` on buttons, summaries, selects, labels for checkboxes/radios, and `[role=option]`-style controls, and `not-allowed` on disabled ones; a utility such as `cursor-text` still wins. A clickable non-button (a card `div`) needs its own `cursor-pointer`. |
| **`tap-target` on small touch controls** | The `tap-target` utility (`index.css`) gives a control under 44px a centred 44px hit area on touch input only (`pointer: coarse`); desktop density is unchanged. Never put it on an `absolute`/`fixed` element or one that uses `after:` (it claims `position` and `::after`). Two `tap-target` siblings need a gap of at least 44px minus their size, otherwise their hit areas overlap and the row uses coarse-pointer padding instead. |
| **Reduced motion is global** | A `prefers-reduced-motion: reduce` rule in `index.css` zeroes animations, transitions and smooth scrolling for everything, vendored code included (unlayered, `!important`). Do not re-implement it per component. |
| **Missing values render `EMPTY_VALUE`** | `lib/emptyValue.ts` exports an en dash (`–`); every screen shows it for an empty cell or fact, never an em dash or a typed hyphen. |
| **One toolbar style** | `TOOLBAR_*` in `lib/utils.ts` (`TOOLBAR_BOX`, `TOOLBAR_BUTTON_PRIMARY`, `TOOLBAR_BUTTON_OUTLINE`, `TOOLBAR_STAT`) are the page-toolbar controls: 32px (`h-8`), exactly one solid primary action per toolbar, outline buttons beside it, and read-only counts coloured on the number only. |
| **One risk score chip** | `RiskScoreChip.tsx` is the only way a risk score renders (Risks tab, project Overview, Daily Review). |
| **One stat strip** | `components/StatStrip.tsx` is the only summary-number row on a page (Overview, Project Overview, Daily Review, Utilization, Admin Users). One bordered row; the 1px hairlines are a `gap-px` over an `outline-variant` ground. Number, then a lower-case label that reads after it ("14 overdue tasks"). No icon, no uppercase label, no boxed tile. Colour goes on the number only (`bad` = `text-error`, `warn` = `chip-amber-text`), and only when the value is above zero and asks for action. A linked stat keeps its destination and is named by its visible text. `of` stays short ("of 12"); the detail shows from `lg:` up (always for a stat with no number) and truncates before a label wraps; a label wraps inside its cell and never spills into the next. Below `md:` the cells stack number over label in a grid chosen by count (three across; two by two; three plus two on a six-track grid), 64px tall. Toolbar counts (`TOOLBAR_STAT`, the Risks tab) are a separate pattern. |
| **Project header is one line of facts** | `components/ProjectHeaderFacts.tsx`: from `md:` up the facts sit on one 32px line with visually hidden labels (no uppercase labels): customer, dates, TAM, progress, then problems only (past end date, overdue tasks, open risks, days behind baseline). Nothing is shown for "No baseline" or a zero count; the baseline lives in the context panel. "Edit project" and "Copy link" are the first items of the "More project actions" menu at every width (`pages/ProjectDetail.tsx`), not header buttons. The Gantt tree's first column header reads "Task", set through the vendored Gantt's `i18n` prop in `gantt-v2/SolvroGantt.tsx`. |
| **Text on solid `bg-primary` is `text-on-primary`** | Never `text-white` (white on the dark-theme green measures 2.86:1). `gates.sh` guards this. |

### Status chip tone table

`CHIP_BASE` = `inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 font-display text-meta font-semibold leading-[18px]` (`StatusChip.tsx`).

| Chip | Status | Tone | Renders as |
|---|---|---|---|
| `ProjectStatusChip` | PLANNING | blue | `bg-primary/10 text-primary-tint-text` |
| | ACTIVE | emerald | `bg-chip-emerald-bg text-chip-emerald-text` |
| | ON_HOLD | amber | `bg-chip-amber-bg text-chip-amber-text` |
| | COMPLETED | blue | `bg-primary/10 text-primary-tint-text` |
| | CANCELLED | rose | `bg-chip-rose-bg text-chip-rose-text` |
| `TaskStatusChip` | TODO | gray | `bg-surface-container-high text-on-surface-variant` |
| | IN_PROGRESS | blue | `bg-primary/10 text-primary-tint-text` |
| | DONE | emerald | `bg-chip-emerald-bg text-chip-emerald-text` |

A workspace task status carries a tone key (`TaskStatusDef.color`); `TaskStatusChip` given a `def` renders the status's own name in that tone (`statusToneClass`), and without one falls back to the category rows above. Pickers and the Gantt tree use a matching dot (`STATUS_TONE_DOT_CLASS`).

| Tone key | Chip classes | Dot |
|---|---|---|
| `gray` | `bg-surface-container-high text-on-surface-variant` | `bg-on-surface-variant` (a container tone vanishes on the dark popover/column) |
| `primary` | `bg-primary/10 text-primary-tint-text dark:bg-primary/20` | `bg-primary` |
| `emerald` | `bg-chip-emerald-bg text-chip-emerald-text` | `bg-chip-emerald-text` |
| `amber` | `bg-chip-amber-bg text-chip-amber-text` | `bg-chip-amber-text` |
| `violet` | `bg-chip-violet-bg text-chip-violet-text` | `bg-chip-violet-text` |

`customer/PrimaryChip.tsx` (the "Primary" marker on a project's primary customer, shown when a project has several) is a bespoke chip on the `primary` tone pair: `rounded-sm bg-primary/10 px-1.5 py-0.5 text-meta text-primary-tint-text dark:bg-primary/20`.

`LabelChip.tsx` and `EpicChip.tsx` are not tone chips: the user-chosen colour is a 8px dot plus a `color-mix(… 14%, transparent)` background tint, and the text is always `text-on-surface` (so any stored colour stays readable in both themes). Both use the same `text-meta font-semibold leading-[18px]` rhythm as `CHIP_BASE`; `EpicChip` also truncates at `max-w-[160px]`.

The generic `Chip` export takes any of `emerald` / `amber` / `rose` / `violet` / `blue` / `gray` directly for one-off use (risk scores, priority badges, etc.).

---

## 6. Theme Mechanics

`frontend/src/lib/theme.tsx` owns theme state:

- **Choice**: `"light" | "dark" | "system"`, persisted to `localStorage["solvro.theme"]`. Defaults to `"system"` when nothing is stored.
- **Resolution**: `"system"` resolves live against `window.matchMedia("(prefers-color-scheme: dark)")`, including a listener that updates `resolved` if the OS preference changes mid-session. Explicit `"light"`/`"dark"` choices short-circuit resolution.
- **Application**: the resolved theme is applied by toggling the **`dark` class** on `document.documentElement` (`classList.add("dark")` / `remove("dark")`). `index.css`'s `@custom-variant dark (&:where(.dark, .dark *));` is what makes every `dark:`-prefixed utility and every CSS-var token respond to that single class (Tailwind v4's CSS-first replacement for v3's `darkMode: "class"` config key — same behavior).
- **Not** a `data-theme` attribute — the previous DESIGN.md described `data-theme`, which does not match the implementation. Correct mental model: **one class, `.dark`, on `<html>`; `:root` holds light values, `.dark` overrides them.**
- `useTheme()` exposes `{ choice, resolved, setChoice, toggle }` via `ThemeContext` — components should consume this, never poke `document.documentElement.classList` directly.
- Tokens are consumed directly in the primary `@theme inline` block of `index.css` via var-in-var routing (e.g. `--color-primary: rgb(var(--primary));`) — no config-file helper function exists anymore (pre-2026-07-24 this was a `const c = (name) => \`rgb(var(${name}) / <alpha-value>)\`` helper in `tailwind.config.ts`). The block must stay `inline`, not just `@theme`: `inline` compiles each utility's RGB triplet directly into its own rule, which is both what lets Tailwind opacity utilities (`bg-primary/10`, `border-outline-variant/40`) work against CSS-variable-backed colors (via v4's `color-mix`) and what makes `var(--token)` resolve at the consuming element — required for the `Login.tsx`/`Sidebar.tsx` subtree `dark` pins above to work (a non-inline `@theme` freezes resolution at `:root` and breaks them; regressed 2026-07-24, fixed 2026-07-25, see CHANGELOG). A second `@theme inline` block bridges vendored shadcn/ReUI components' semantic class names (`bg-background`, `text-muted-foreground`, `border-border`, etc.) onto the same Technical Precision tokens, including the `Alert` component's `success`/`warning`/`info`/`invert`/`invert-foreground` tones (see §1's chip note) — see `frontend/src/index.css` lines ~130–164.
