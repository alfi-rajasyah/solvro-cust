# Solvro → Paper: Full Component & Page Extraction — Master Plan

Goal: every Solvro screen, sub-view, and shared component rebuilt as artboards in the Paper Desktop file **"Solvro Design"**
(https://app.paper.design/file/01KY16VSJT885V5J924FSB7TZW/01K4GP58P8JRM8PGBP0586VKYV).

## Current state (2026-07-21)

- **Built** (dark theme, 1440×900): Overview, Projects, Daily Review, Reports. 42 design tokens registered. Source Sans 3 + Menlo in use.
- **Blocked**: Paper MCP **weekly write limit** hit; resets ~2026-07-25 (or immediately with Paper Pro; restart Paper after upgrading). Reads still work.
- **7 icon fixes pending** (Material-Symbols ligature text still unconverted — see below).
- Full design references captured in this folder: `pages.md` (8 remaining pages), `views.md` (ProjectDetail shell + 7 sub-views + Gantt in full detail + RightSidebar), `components.md` (19 shared components + cross-cutting patterns).
- `icons/` holds **all ~79 Material Symbols SVGs** the app uses (`business.svg` = the `domain` glyph; the symbols repo has no `business`). No network needed at build time.

## Non-negotiable build rules

1. **Icons are inline SVGs**, never the Material Symbols font — ligatures don't render on the user's live canvas (they DO render in `get_screenshot`, which is misleading). Use `<svg width="16" height="16" viewBox="0 -960 960 960"><path d="…" fill="var(--color-primary)"/></svg>` with paths from `icons/*.svg`. `fill` accepts token vars; `update_styles` can change `fill` on the Path node.
2. **Dark theme** is canonical (DESIGN.md dark-first; existing artboards are dark). `views.md` §0 quotes light hexes — use the dark columns in `pages.md`/`components.md` token tables instead.
3. **No `.ai-glow` / AI Breakdown styling anywhere** — confirmed unimplemented in the frontend; do not invent it.
4. Elevation = 1px `--color-outline-variant` borders; `shadow-overlay` (`0 4px 24px rgba(0,0,0,0.18)`) ONLY on Modal / Drawer / TaskPanel / dropdowns / context panel.
5. Clone, don't rebuild: masters live on the Overview artboard — **Sidebar `8M-1`**, TopBar `9M-1`, TopBar-Right cluster `TV-1`. `duplicate_nodes` into a new artboard, `move_nodes` the sidebar to index 0, then swap the active nav row (bg `rgba(58,174,81,0.2)`, label `#ffffff`, icon path fill `var(--color-primary)`; deactivated row → transparent bg, `#94a3b8` label + fill).
6. Existing artboard IDs: Overview `8L-1`, Projects `FE-1`, Daily Review `KW-1`, Reports `PO-1`.

## Step 0 — finish the 7 pending icon fixes (node IDs are stable in the Paper file)

| Node | Icon | Size | Fill |
|---|---|---|---|
| `N4-1` | warning (Daily Review stat) | 16 | `var(--color-chip-amber-text)` |
| `O1-1` | campaign (card-1 toggle) | 14 | `var(--color-primary)` |
| `O5-1` | check_circle ("Saved" line) | 14 | `var(--color-chip-emerald-text)` |
| `OP-1` | campaign (card-2 active toggle) | 14 | `var(--color-on-primary)` |
| `PH-1` | campaign (card-2 export note) | 14 | `var(--color-primary)` |
| `SJ-1` | content_copy (Reports Copy btn) | 16 | `var(--color-on-surface)` |
| `SM-1` | download (Reports Download btn) | 16 | `var(--color-on-primary)` |

Replace each via `write_html` mode=replace with the inline SVG. Then `finish_working_on_nodes`.

## Build order (each artboard 1440×900 dark unless noted)

**Phase 1 — Component sheets** (build first; everything else clones from them):
1. **Components / Primitives** (`height: fit-content`): all 6 chip tones × Project/Task status + PriorityBadge + LabelChip samples + AssigneeAvatar (xs/sm/md + unassigned) + buttons (modal-primary, inline-primary, secondary, warning) + field label variants + standard input/select/textarea + error banner + skeleton + dropdown menu + Tabs + EmptyState + score badges (Low/Med/High bands) + ProviderChip + tool chips. Spec: `components.md` §10–§15 + cross-cutting patterns.
2. **Components / Overlays**: Modal chrome + ConfirmModal (warning tone) + Drawer + TaskFormModal (in drawer) + ProjectFormModal + RiskFormModal (score 16 High) + CustomerFormModal + InlineDateRangeEditor + InstallBanner (both variants). Spec: `components.md` §1–§8, §13–§14.
3. **Components / TaskPanel**: the 380px aside, full anatomy w/ comments. Spec: `components.md` §4.

**Phase 2 — ProjectDetail sub-views** (all share: sidebar w/ Projects active + topbar w/ breadcrumb "Projects / Apex Cloud Migration" + Active chip + meta row + tab bar; build that shell once on the first one, clone for the rest, move active tab underline):
4. **Project · Overview** — KPI strip + S-curve (hand-draw the two lines + today reference as SVG polylines) — `views.md` §3. Include RightSidebar OPEN on this artboard (320px panel, `views.md` §2) to document it.
5. **Project · List** — sections w/ color dots, task rows grid `[28px|1fr|60px|70px|50px|100px]`, subtask rows — `views.md` §4.
6. **Project · Kanban** — 3 columns (To Do / In Progress / Done), WIP-over amber pill on In Progress, full TaskCard anatomy incl. subtask checklist — `views.md` §5.
7. **Project · Gantt** — the flagship: toolbar (zoom pills Week active, baseline toggle ON, color=status legend), 384px list pane, 44px two-band date axis (W29–W3x labels), 30px rows, 14px bars w/ 0.28-opacity tracks + progress overlays, milestone diamond, baseline ghost bars, one HARD + one SOFT dependency connector w/ arrowhead, weekend shading, today line + pill — `views.md` §10 (use exact geometry constants).
8. **Project · Timeline** — vertical spine + node dots + cards — `views.md` §7.
9. **Project · Risks** — 4 stat badges, filter bar, table w/ score badges (16 red / 12 amber / 6 green) — `views.md` §8.
10. **Project · Services** — bulk-actions row + ServiceMappingList w/ Subscribed badges + tools chips — `views.md` §9 + `components.md` §18.

**Phase 3 — Remaining pages** (`pages.md` per-section):
11. **Login** — standalone dark two-panel (44%/56%), decorative rings, Google button mock, collapsed admin details — §1.
12. **Customers** — card grid — §2.
13. **Customer Detail** — identity + 2 KPIs + 5 tabs (Overview active: profile-completion card, services rows, projects table) — §3.
14. **Settings** — theme tiles (Dark active), profile dl, change-password form — §4.
15. **Admin · Users** — KPI strip + create form + users table (provider chips, needs-role) — §5a. Optionally Roles/Sign-in/Override as 3 more artboards (§5b–d) — build if budget allows.
16. **Tasks** — filter bar + dense table w/ overdue row — §6.
17. **Executive** — summary line + overdue grid-table + PortfolioCalendar w/ legend + today line — §7 + `components.md` §17.
18. **Work Logs** — tiny placeholder — §8.

## Sample data continuity

Reuse the fictional dataset already on canvas: projects P-001 Apex Cloud Migration (PT Astra Digital), P-004 Nimbus ERP Rollout (PT Nusantara Manufaktur, 2d behind), P-007 Titan SOC Onboarding (Bank Sentosa), P-011 Helios M365, P-003 Quasar K8s (On hold), P-009 Vault Backup (Planning); users alfi.rajasyah (TAM), sa.alice (SA), tam.charlie; task T-042 "Migrate customer DNS to Route 53". Keep names consistent across new artboards.
