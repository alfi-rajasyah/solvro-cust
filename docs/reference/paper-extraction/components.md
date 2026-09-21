# Solvro Shared Component Library — Extraction Reference

> Raw mapping report (components-mapper agent, 2026-07-21). Self-contained spec for rebuilding shared components as a Paper component-library sheet.

**IMPORTANT — AI Breakdown `.ai-glow`:** grepped all of `src/`. There is **zero** usage of `.ai-glow`, `ai-breakdown`, `blueprintId`, or amber-glow styling anywhere in the frontend. The Secure Ingestion Port was cancelled 2026-08-03 — the concept is **retired, not reserved**. Do not author it into any of these sheets.

---

## 0. TOKEN RESOLUTION MAP (semantic name → real color)

| Token (Tailwind) | Light hex | Dark hex |
|---|---|---|
| `surface` | #F9F9F7 | #232321 |
| `surface-dim` | #E8E8E4 | #1A1A18 |
| `surface-bright` | #FFFFFF | #2A2A28 |
| `surface-container-lowest` | #FFFFFF | #1A1A18 |
| `surface-container-low` | #F2F2EE | #232321 |
| `surface-container` | #EBEBE7 | #2A2A28 |
| `surface-container-high` | #E4E4E0 | #323230 |
| `surface-container-highest` | #DEDEDA | #3A3A37 |
| `on-surface` | #1A1A18 | #F0EDE8 |
| `on-surface-variant` | #4A4A47 | #B0ADA8 |
| `inverse-surface` | #232321 | #F0EDE8 |
| `outline` | #9A9A97 | #4A4A47 |
| `outline-variant` | #D0D0CC | #3A3A37 |
| `primary` | #2D9042 | #3AAE51 |
| `on-primary` | #FFFFFF | #0F2B16 |
| `primary-container` | #C8E6CF | #2D9042 |
| `on-primary-container` | #0F2B16 | #E8F7EB |
| `error` | #BA1A1A | #F87171 |
| `on-error` | #FFFFFF | #2A0A0A |
| `error-container` | #FFDAD6 | #3D1212 |
| `on-error-container` | #93000A | #FCA5A5 |
| `chip-emerald-bg / -text` | #DCFCE7 / #16A34A | #064E3B / #A7F3D0 |
| `chip-amber-bg / -text` | #FEF3C7 / #D97706 | #78350F / #FDE68A |
| `chip-rose-bg / -text` | #FEE2E2 / #DC2626 | #7F1D1D / #FECACA |
| `chip-violet-bg / -text` | #EDE9FE / #6D28D9 | #4C1D95 / #DDD6FE |
| `ink` (fixed) | #191919 | #191919 |
| `sidebar` (fixed) | #232321 | #232321 |

**Primary brand color is GREEN (#2D9042 light / #3AAE51 dark), not blue** — Elitery brand. (CLAUDE.md's "#0058be" is stale; the running config is green.)

**Type:** single family **Source Sans 3**. App scale +1px vs Tailwind: `text-xs`=13px, `text-sm`=15px, `text-base`=17px, `text-lg`=19px, `text-xl`=21px. `text-label-caps` = 12px/700/0.05em/uppercase; `text-data-mono` = 13px/500/-0.01em/tnum. Many components use bracket sizes (`text-[11px]`, `text-[10px]`).
**Radii:** `sm`=2px, DEFAULT=4px, `md`=6px, `lg`=8px, `xl`=12px, `full`=pill.
**Elevation:** only `shadow-overlay` = `0 4px 24px rgba(0,0,0,0.18)` — modals/drawers/menus/context panel. Everything else = 1px `outline-variant` borders.
**Icons:** Material Symbols Outlined. In Paper use inline SVG equivalents (icon-font ligature gotcha).

---

## 1. Modal.tsx — base overlay dialog

Portal. Backdrop: `fixed inset-0 z-[100] flex items-stretch justify-center bg-inverse-surface/40 p-0 backdrop-blur-sm` → desktop `md:items-center md:p-4`.
Panel: `flex max-h-screen w-full {widthClass} flex-col rounded-none border-outline-variant bg-surface-container-lowest shadow-overlay` → desktop `md:h-auto md:max-h-[calc(100vh-2rem)] md:rounded md:border`. **Mobile = edge-to-edge full-screen; desktop = centered rounded card.** Default `max-w-lg` (512px); callers override (`max-w-2xl` = 672px).
**Header**: `flex items-center justify-between border-b border-outline-variant px-5 py-3.5`. Title `font-display text-[14px] font-semibold`. Close btn `h-7 w-7` rounded, hover `bg-surface-container`, icon `close` text-base.
**Body:** `flex-1 overflow-y-auto px-5 py-4`. **Footer** (optional): `flex justify-end gap-2 border-t px-5 py-3`.

## 2. ConfirmModal.tsx

Modal + title + body text (`text-sm`) + 2-button footer.
- Cancel: `rounded-lg border border-outline-variant px-4 py-1.5 text-xs font-semibold text-on-surface-variant hover:bg-surface-container disabled:opacity-50`
- Confirm `primary`: `rounded-lg bg-primary px-4 py-1.5 text-xs font-bold text-on-primary hover:bg-primary/90 disabled:opacity-60`
- Confirm `warning`: `rounded-lg bg-amber-500 ... text-white hover:bg-amber-600` (raw #F59E0B, NOT a token)
`busy` → confirm label "Working…", both disabled.
**Sample:** "Delete task" / "Delete task "Migrate DNS records"? This cannot be undone." / Delete (warning).

## 3. Drawer.tsx — right slide-in panel

Portal. **NO dim backdrop** — click-outside closes. Container `fixed inset-x-0 bottom-0 top-14 z-[100] flex justify-end` (56px TopBar offset). Panel: `flex h-full w-full flex-col border-l border-outline-variant bg-surface-container-lowest shadow-overlay transition-transform duration-200` + `{widthClass}` (default `max-w-lg`). Slides `translate-x-full → 0`. Header/body/footer identical to Modal. Used by TaskFormModal.

## 4. TaskPanel.tsx — task detail panel (THE RICH ONE)

Fixed `<aside>`, deep-linked `?task=<id>`. Container: `fixed right-0 top-14 bottom-0 z-40 flex w-full flex-col border-l border-outline-variant bg-surface-container shadow-overlay md:w-[380px]`. Note bg is `surface-container` (darker than modals).

**HEADER** — `flex items-center gap-2 border-b px-4 py-3`:
- **Status pill dropdown trigger:** `inline-flex items-center gap-1 rounded-full px-2.5 py-1 font-display text-[11px] font-semibold` + tone (TODO=`bg-surface-container-high text-on-surface-variant`; IN_PROGRESS & DONE=`bg-chip-emerald-bg text-chip-emerald-text`) + trailing `expand_more` 13px.
  - Dropdown: `absolute left-0 z-20 mt-1 w-36 rounded-lg border bg-surface-container-lowest py-1 shadow-overlay`; rows `px-3 py-1.5 text-xs hover:bg-surface-container`; selected `font-bold text-primary`.
- Spacer. **Overflow menu** (`more_horiz`): menu `w-40`, item "Delete task" `text-error hover:bg-error-container` + `delete` icon. **Close** (`close`).

**BODY** — `flex-1 overflow-y-auto px-4 py-4`:
- **Title:** editable; display `text-lg font-bold hover:bg-surface-container-high`; subtitle "in {sectionName}" `text-[11px]` muted.
- **Meta grid** `mt-4 grid grid-cols-[auto_1fr] gap-x-3 gap-y-2.5 text-sm`. Label style: `text-[10px] font-bold uppercase tracking-wider text-on-surface-variant`. Rows:
  1. **Assignee** — `AssigneeAvatar xs` + username / "Unassigned"; edit = inline select.
  2. **Dates** — "{Jul 18} – {Jul 25}"; edit = bordered card w/ Start+Due date inputs + Cancel/Save (primary).
  3. **Priority** — click-to-cycle; `flag` 15px: LOW=muted, MEDIUM=`chip-amber-text`, HIGH/URGENT=`text-error`.
  4. **Type** — milestone=`diamond` primary / task=`check_box_outline_blank` muted; "Milestone"/"Task".
  5. **Section** — 2×2 color dot + name; edit = select.
- **Labels** block: heading + `LabelPicker`.
- **Subtasks** block: heading "Subtasks {done}/{total}"; rows: round checkbox `h-4 w-4 rounded-full border` (done = `border-emerald-500 bg-emerald-500 text-white` + `check` 11px) + title (done = strikethrough muted). Add form: `add` 13px primary + borderless input "Add subtask".
- **Error banner:** standard error-container.
- **Comments (PanelComments):** `mt-5 border-t pt-4`. Heading "Comments · {n}" (10px caps). List: `AssigneeAvatar xs` + bubble `rounded border bg-surface-container-lowest px-3 py-2`; bubble header = author `font-medium` + relative time ("5m ago"); body `text-xs whitespace-pre-wrap`. Composer: `flex items-center gap-2 rounded-lg border bg-surface-container-lowest px-3 py-2`, borderless input "Write a comment…", **send** icon 17px primary.

**Icons:** expand_more, more_horiz, close, delete, flag, diamond, check_box_outline_blank, check, add, send.
**Sample:** T-042 "Migrate customer DNS to Route 53", In progress, tam.charlie, Jul 18 – Jul 25, High, Task, section "Cutover", labels [Blocked, Backend], 2/3 subtasks, 1 comment.

## 5. TaskFormModal.tsx — create/edit task (in Drawer)

Renders in **`<Drawer>`** (`max-w-lg`).
**customHeader:** `border-b bg-surface-container-low px-5 py-3` — "T-###" or "New task" (text-xs muted) + close.
**Body** `space-y-3.5`:
- **Title:** borderless `text-lg font-bold placeholder:/40` "Task title".
- **Field card:** `space-y-2 rounded-xl border bg-surface-container-low p-3`. `FieldRow` = icon (`w-5 text-sm` muted) + label (`w-20 text-xs` muted) + borderless control (`text-xs font-semibold`). Rows: `flag` Priority (option colors: MEDIUM=amber-600, HIGH=orange-600, URGENT=error) · `radio_button_checked` Status · `group` Assignee ("{username} · {role}") · `calendar_today` Due Date · `calendar_month` Start Date · `account_tree` Parent ("— Top level —" / "T-### · title") · `folder` Section · `label` Labels (embeds LabelPicker).
- **Description:** label-caps + textarea `rounded-lg border ... focus:ring-2 focus:ring-primary/30` rows=3 "Add a description…".
- **Subtasks (edit only):** `divide-y rounded-xl border` rows: `accent-primary` checkbox + title.
**Footer:** Delete (edit; `border-error/40 text-error hover:bg-error/10`, mr-auto) · Cancel · Submit primary "Create task"/"Save".
**Icons:** close, flag, radio_button_checked, group, calendar_today, calendar_month, account_tree, folder, label.

## 6. ProjectFormModal.tsx

`<Modal>` max-w-lg. `Field` label: `mb-1 text-[12px] font-bold uppercase tracking-wider text-on-surface-variant` + red `*`.
Standard control: `w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-2 text-sm focus:border-primary focus:ring-2 focus:ring-primary/30`.
Fields: **Name***; **Description** (rows3); **Customer*** (select); 2-col: **Solution Architect*** + **Status** (PLANNING…CANCELLED); **Technical Account Manager** (wildcard users only, "Defaults to current user"); **WIP limit** 3-col number inputs (min 1, "—" placeholder, `text-[11px]` labels); **Administrative project** checkbox (`h-4 w-4 accent-primary` + caps title + `text-[11px]` help "Exclude from portfolio roll-ups…"); error banner.
**Footer:** Cancel + "Create project"/"Save changes".
**Sample:** "Aurora Bank — SIEM Rollout", Aurora Bank, sa.alice, ACTIVE, WIP 5/3/—.

## 7. RiskFormModal.tsx

`<Modal max-w-2xl>` (672px). Labels: `text-label-caps uppercase tracking-widest`. Controls: `rounded` (4px, no ring).
Fields: **Risk description** (rows2, "What could go wrong?"); 2-col: **Category** (External/Internal/Technical/Organizational/Financial) + **Status** (Open/Mitigated/Closed); 3-col: **Probability (1–5)** + **Impact (1–5)** ("{n} {Very Low…Very High}") + **Score** read-only box `h-[38px] rounded border font-mono text-sm font-bold` + level word. **Score bands:** ≤8 Low `border-emerald-300 bg-emerald-50 text-emerald-700` · ≤15 Medium `border-amber-300 bg-amber-50 text-amber-800` · >15 High `border-error/40 bg-error-container text-on-error-container`. Then **Mitigation plan** (rows3) + **Contingency plan** (rows3).
**Sample:** "Customer AD team may miss the delegated-auth deadline", External, Open, 4×4 → **16 High** (red band).

## 8. CustomerFormModal.tsx

`<Modal>` max-w-lg. Same `Field` helper; controls `rounded` + ring. Fields: **Name***; 2-col: **Account Manager** (free text "Free text — anyone, internal or external") + **Solution Architect** (select "— None —" / "{username} ({role})"); **Description*** (rows5); error banner. Footer Cancel + "Create customer".
**Sample:** "Aurora Bank", "Jordan Lee", "sa.alice (SA)", "Tier-1 financial services customer; 24×7 SOC engagement."

## 9. CommentThread.tsx — standalone thread

Like PanelComments but: heading `text-[12px] tracking-widest`, avatars `sm`, **textarea composer** in card `rounded border bg-surface-container-lowest p-2` (rows2, "Add a comment…") + right **Post** button `rounded bg-primary px-3 py-1 text-[12px] font-bold hover:bg-primary-container`.

## 10. LabelChip.tsx

`inline-flex items-center rounded-full font-display text-[11px] font-semibold leading-[18px]`; `px-2 py-0.5` (compact `px-1.5`). **Bg = label.color; fg auto-contrast** (luminance>150 → `#191B23`, else white).
**Samples:** "Backend" #0058be · "Blocked" #BA1A1A · "Docs" #F59E0B · "Frontend" #10B981.

## 11. LabelPicker.tsx

Chip row `flex flex-wrap gap-1.5`: label buttons wrapping LabelChip; **selected** = `ring-2 ring-primary ring-offset-1`; unselected `opacity-60`. Trailing **"+ Label"** dashed-border button (label-caps, hover primary).
Create form: card `rounded border bg-surface-container-low p-2` → name input + **Add** primary + Cancel; color row: 8 swatches `h-4 w-4 rounded-full border`, selected `ring-2 ring-primary ring-offset-1`. **PALETTE:** `#0058be #10b981 #f59e0b #ba1a1a #7c3aed #0ea5e9 #ec4899 #64748b`.

## 12. AssigneeAvatar.tsx

`inline-flex items-center justify-center rounded-full`. xs=20px/text-[10px] · sm=24px/text-[11px] (default) · md=32px/text-xs. Assigned: `bg-primary font-bold text-white`, ≤2 initials from username split on `. _ -`. Unassigned: dashed border circle "?" muted.

## 13. InlineDateRangeEditor.tsx

Card `w-[220px] rounded border bg-surface-container-lowest p-2 shadow-lg` (absolutely positioned). Two rows: `w-10` label-caps "Start"/"Due" + date input `font-mono text-[12px]`. Footer: Cancel (label-caps muted) + Save (`bg-primary` label-caps). Auto-corrects end<start.

## 14. InstallBanner.tsx — mobile PWA strip

`md:hidden` strip `bg-primary text-on-primary text-[11px] font-semibold px-3 py-1.5`. Android: `download` icon + "Install Solvro — add to home screen" + `close`. iOS: `ios_share` + "Add to Home Screen from the share menu" + `close`.

## 15. StatusChip.tsx — 3 exports

`CHIP_BASE` = `inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-display text-[11px] font-semibold leading-[18px]`. Tones: emerald / amber / rose / violet (chip tokens), blue=`bg-primary/10 text-primary dark:bg-primary/20`, gray=`bg-surface-container-high text-on-surface-variant`.
- **ProjectStatusChip:** PLANNING blue "Planning" · ACTIVE emerald "Active" · ON_HOLD amber "On hold" · COMPLETED blue "Completed" · CANCELLED rose "Cancelled".
- **TaskStatusChip:** TODO gray "To do" · IN_PROGRESS blue "In progress" · DONE emerald "Done".
Rebuild all 6 tone swatches × both themes.

## 16. BrandMark.tsx

Theme-adaptive Elitery "e" mark. `elitery-mark-on-dark.png` on dark surfaces / `elitery-mark-on-light.png` on light. Default `h-8 w-8 object-contain`.

## 17. portfolio/PortfolioCalendar.tsx — year roadmap

Wrapper `space-y-3`. **Toolbar:** year stepper (`chevron_left`/`chevron_right` 17px in `h-6 w-6` buttons + `font-mono text-[13px] font-semibold` year); right **legend** (`h-2 w-2 rounded-full` swatches + `text-[11px]` labels): Overdue / Active / Planning · On-hold / Completed.
**Grid frame:** `overflow-x-auto rounded border bg-surface-container-lowest` → `min-w-[720px]`.
- **Month header row:** `border-b bg-surface-container-low px-3`; left spacer `w-48` (192px); `grid grid-cols-12` — cells `px-1.5 py-1.5 text-center label-caps uppercase tracking-widest`, months 2–12 `border-l`. Jan…Dec.
- **Today line** (current year): overlay `border-l border-dashed border-primary` at `left:{todayFrac}%` + pill `bg-primary text-[9px] font-bold uppercase text-on-primary` "Today".
- **Project rows:** `border-t px-3 py-2`; label cell `w-48`: name Link `truncate font-semibold text-primary hover:underline` + ProjectStatusChip; track `relative h-5 flex-1` with 12-col `border-l /50` gridlines; **bar** `absolute top-1/2 h-2.5 -translate-y-1/2 rounded-full {barTone}` at `left:{frac}%` width `{pct}%` (min 1%), tooltip "{start} → {end} · {progress}%". Clipped edges: `‹`/`›` chars at `-left-3`/`-right-3`.
**Bar tones:** overdue→`bg-error` · ACTIVE→`bg-primary` · PLANNING/ON_HOLD→`bg-chip-amber-bg` · COMPLETED/CANCELLED→`bg-on-surface-variant/40`.
**Math:** year = [Jan 1, Jan 1+1y); frac = (date−yearStart)/span, clamped 0–1. Rows filtered to overlap.
**Empty:** EmptyState "No projects scheduled in {year}.". **Unscheduled note:** `text-[11px]` "{n} project(s) have no scheduled dates — see List view."
**Samples:** "Aurora Bank — SIEM Rollout" (Active, green Mar→Aug) · "Nimbus Retail — DR Setup" (Overdue red) · "Pallas Health — Onboarding" (Planning amber) · "Legacy Migration" (Completed muted).

## 18. services/ServiceMappingList.tsx

Header: h2 `text-[13px] font-bold uppercase tracking-wider` + description `text-[12px]` muted. States: loading pulse; empty EmptyState (`category`).
**Service rows** (`space-y-1.5`): `rounded border px-3 py-2`; **assigned** = `border-primary bg-primary/5`; inactive service `opacity-60`. Toggle row: checkbox icon 19px (`check_box` primary / `check_box_outline_blank` muted) + name `font-medium` + badges: "inactive" (10px caps muted), **Subscribed** (`rounded-full border border-primary/30 bg-primary/10 label-caps text-primary`); optional description `text-[12px]` truncate.
**ToolsEditor** (per assigned row, `mt-2 border-t /60 pt-2`): caption "Tools used" label-caps. Tool chips `rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 font-mono text-[12px] text-primary` + `close` 13px. Draft input `min-w-[140px] rounded border bg-surface px-2 py-0.5 text-[12px]` ph "e.g. Acronis, Crowdstrike". Read-only empty → italic "No tools listed."
**Add-service form:** `flex flex-wrap items-end gap-2 rounded border bg-surface-container-lowest p-3` — Name + Description + Add primary.
**Samples:** "Managed Detection & Response" (assigned, Subscribed, Crowdstrike/Sentinel) · "Backup & DR" (assigned, Acronis) · "Penetration Testing" (unassigned) · "Legacy Firewall Mgmt" (inactive).

## 19. services/ServiceCatalogueManager.tsx

Intro `text-sm` muted. Add form (as §18). **Table:** `rounded border bg-surface`; thead `bg-surface-container-low text-[12px] bold uppercase` — Name / Description / Status / Actions(right). Rows `border-b /60`, inactive `opacity-60`. Status = toggle pill: Active `bg-chip-emerald-bg text-chip-emerald-text` / Inactive `bg-surface-container-high` muted. Actions: Edit / Delete (label-caps; delete hover error-container) or Save (primary) / Cancel. Empty: colSpan=4 "No services yet — add the first one above."

---

## CROSS-CUTTING PATTERNS (build as Paper reusable components)

1. **Field label:** `text-[12px] font-bold uppercase tracking-wider text-on-surface-variant` (+ red `*`). Variants: `text-[10px]` (TaskPanel), `label-caps tracking-widest` (Risk/services).
2. **Primary button:** modal `rounded-lg bg-primary px-4 py-1.5 text-xs font-bold hover:bg-primary/90` vs inline compact `rounded bg-primary px-2/3 py-0.5/1 label-caps hover:bg-primary-container`.
3. **Secondary/Cancel:** `rounded-lg border border-outline-variant px-4 py-1.5 text-xs font-semibold text-on-surface-variant hover:bg-surface-container`.
4. **Standard field control:** `w-full rounded[-lg] border border-outline-variant bg-surface-container-lowest px-3 py-2 text-sm focus:border-primary [focus:ring-2 focus:ring-primary/30]`.
5. **Error banner:** `rounded[-lg] border border-error/30 bg-error-container px-3 py-2 text-xs text-on-error-container`.
6. **Loading skeleton:** `animate-pulse rounded border bg-surface-container-low`.
7. **Dropdown menu:** `absolute z-20 mt-1 rounded-lg border bg-surface-container-lowest py-1 shadow-overlay`.
8. **Pill chip base:** `inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-display text-[11px] font-semibold leading-[18px]`.
9. **Overlay layers** (only `shadow-overlay` users): Modal, Drawer, TaskPanel, dropdown menus.

**Full icon inventory:** close, expand_more, more_horiz, delete, flag, diamond, check_box_outline_blank, check_box, check, add, send, radio_button_checked, group, calendar_today, calendar_month, account_tree, folder, label, download, ios_share, chevron_left, chevron_right, category.
