# Solvro Frontend — Page Mapping Reference (8 pages)

> Raw mapping report (pages-mapper agent, 2026-07-21). Source of truth for rebuilding these pages as Paper artboards. All measurements are as coded (Tailwind classes + inline `style`).

## Design Token Cheat-Sheet (resolved hex)

CSS vars are `rgb(var(--x))`. **Light / Dark:**

| Token (Tailwind) | Light | Dark |
|---|---|---|
| `bg-background` | `#F9F9F7` | `#1A1A18` |
| `bg-surface` | `#F9F9F7` | `#232321` |
| `surface-container-lowest` | `#FFFFFF` | `#1A1A18` |
| `surface-container-low` | `#F2F2EE` | `#232321` |
| `surface-container` | `#EBEBE7` | `#2A2A28` |
| `surface-container-high` | `#E4E4E0` | `#323230` |
| `surface-container-highest` | `#DEDEDA` | `#3A3A37` |
| `text-on-surface` | `#1A1A18` | `#F0EDE8` |
| `text-on-surface-variant` | `#4A4A47` | `#B0ADA8` |
| `outline` | `#9A9A97` | `#4A4A47` |
| `outline-variant` (all borders) | `#D0D0CC` | `#3A3A37` |
| `primary` (brand green) | `#2D9042` | `#3AAE51` |
| `on-primary` | `#FFFFFF` | `#0F2B16` |
| `primary-container` (hover) | `#C8E6CF` | `#2D9042` |
| `tertiary` | `#5A5F5A` | `#707570` |
| `error` | `#BA1A1A` | `#F87171` |
| `error-container` | `#FFDAD6` | `#3D1212` |
| `on-error-container` | `#93000A` | `#FCA5A5` |
| `ink` / `ink-hover` (theme-fixed) | `#191919` / `#2E2E2E` | same |
| chip-emerald bg/text | `#DCFCE7`/`#16A34A` | `#064E3B`/`#A7F3D0` |
| chip-amber bg/text | `#FEF3C7`/`#D97706` | `#78350F`/`#FDE68A` |
| chip-rose bg/text | `#FEE2E2`/`#DC2626` | `#7F1D1D`/`#FECACA` |
| chip-violet bg/text | `#EDE9FE`/`#6D28D9` | `#4C1D95`/`#DDD6FE` |

**Typography:** `font-display` + `font-body` = Source Sans 3. `font-mono` = default mono stack (used for IDs, numerics, emails, dates). `text-label-caps` = tiny uppercase label. Default radius `rounded` = 0.25rem; pills use `rounded-full`. Elevation = 1px `outline-variant` borders + tone shifts, **no shadows** (except Modal/right panel).

**Shared chips** (`StatusChip.tsx`, base `inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-display text-[11px] font-semibold leading-[18px]`):
- ProjectStatus → tone: PLANNING=blue(`primary/10`), ACTIVE=emerald, ON_HOLD=amber, COMPLETED=blue, CANCELLED=rose. Labels: "Planning/Active/On hold/Completed/Cancelled".
- TaskStatus → TODO=gray, IN_PROGRESS=blue, DONE=emerald. Labels: "To do/In progress/Done".
- `PriorityBadge`: LOW/MEDIUM=gray, HIGH=amber, URGENT=rose. Labels "Low/Med/High/Urgent".
- `LabelChip`: bg = label's own hex, fg auto-contrast (#191b23 or #fff).
- `AssigneeAvatar`: circle, `bg-primary text-white` initials (2 chars); null = dashed circle with "?". Sizes xs=`h-5 w-5`, sm=`h-6 w-6`, md=`h-8 w-8`.
- `Tabs.tsx`: bottom-border nav, active = `border-primary text-primary` + `border-b-2`, inactive = `border-transparent text-on-surface-variant`, text `text-[13px] font-bold uppercase tracking-wider px-4 py-2`.
- `EmptyState.tsx`: dashed border card `border-dashed border-outline-variant bg-surface-container-lowest p-12 text-center`, 4xl icon, optional bold title + message + action.

---

# 1. Login.tsx — STANDALONE (no app shell)

Root: `<div class="dark grid h-screen grid-cols-1 overflow-hidden bg-background md:grid-cols-[44%_1fr]">`. **Always dark-mode** (`.dark` hard-pinned regardless of user theme). Two panels; left hidden below `md:` (mobile = form panel only + inline wordmark).

### Left brand panel (44% width, `hidden md:flex`, `bg-background` = #1A1A18, `p-10`, flex-col)
- **3 decorative rings** (absolute, `border-primary/[0.12]` and `/[0.06]`): 280×280 top:-80 right:-80; 200×200 bottom:-60 left:-60; 120×120 bottom:80 right:20. All `rounded-full` outlines only.
- **Wordmark** (top, z-10): `<BrandMark className="h-8 w-8">` + "Solvro" text-white, 15px/500/-0.2px.
- **Hero copy** (`my-auto`, vertically centered):
  - Eyebrow: "Project Operations" — 10px, uppercase, `letterSpacing 0.1em`, `text-primary` font-semibold, mb-3.
  - H1 (40px/600/-1px/lh1.1, text-white): "Manage projects." <br> "**Ship**" (`text-primary`) " on time."
  - Paragraph (12px, `text-on-surface-variant/45`, maxWidth 240, lh1.6): "One place to track projects, log updates, and report to customers."
  - **3 pill tags** (mt-5, `rounded-full border border-primary/30 text-primary/80`, 10px, `padding 3px 10px`): "Project tracking", "Daily notes", "Customer reports".
- **Footer** (bottom, z-10, 10px, `text-on-surface-variant/20`): "v1.4.0 · build 2305".

### Right form panel (`bg-surface` = #232321, `flex flex-col items-center justify-center px-8`)
Inner column `maxWidth 280`.
- Mobile-only wordmark (`md:hidden`, mb-8): BrandMark + "Solvro" text-on-surface.
- H2 "Sign in" — 20px/500/-0.3px, text-on-surface.
- Subcopy (12px, text-on-surface-variant, mb-8 mt-1): "Use your work Google account." OR "Sign in with your Solvro credentials." (depends on whether Google is configured).
- **Google button**: `<GoogleLogin theme="filled_blue" text="signin_with" shape="rectangular" width="320">`. When config still loading: `h-10 animate-pulse rounded bg-surface-container` skeleton.
- **Error banner** (role=alert, mt-4): `rounded border border-error/30 bg-error-container px-3 py-2 text-xs text-on-error-container`. Messages mapped from API codes (domain_not_allowed, invalid_credentials, account_disabled, etc.).
- **Divider** (only when Google available, my-6): thin `bg-outline-variant` 0.5px lines flanking centered "or" (11px uppercase tracking-wider).
- **Admin password fallback**: collapsible `<details>` (`rounded border border-outline-variant bg-surface-container-lowest open:bg-surface-container`). Summary row: `key` icon + "Admin sign-in (password)" (text-sm font-semibold) + `expand_more` chevron (rotates 180° on open). When Google NOT configured, the password form renders directly (no collapse).
- **Footer** (mt-6, centered, 10px, `text-on-surface-variant/60`): "Internal use only · Elitery © 2026".

### PasswordForm (sub-component, `space-y-3`)
- **Email field**: label "Email" (text-label-caps uppercase tracking-wider). Input wrapper `mt-1 flex items-center gap-2 rounded border border-outline-variant bg-surface-container-lowest px-3 py-2` with focus ring `focus-within:border-primary focus-within:shadow-[0_0_0_3px_rgba(58,174,81,0.15)]`. Leading `mail` icon (text-base, text-on-surface-variant). `type=email`, placeholder "you@example.com".
- **Password field**: same wrapper. Leading `lock` icon. `type=password|text`, placeholder "••••••••". Trailing show/hide button toggling `visibility` / `visibility_off` icons.
- **Submit button**: `mt-1 w-full rounded bg-ink py-2 font-display text-sm font-bold uppercase tracking-wider text-white hover:bg-ink-hover disabled:opacity-60`. Text "Sign in" / "Signing in…".

**Icons:** key, expand_more, mail, lock, visibility, visibility_off.

---

# 2. Customers.tsx — app shell (card grid)

- **Header** (`mb-4 flex items-start justify-between gap-4`): H1 "Customers" (`font-display text-2xl font-bold text-on-surface`) + subtitle (text-sm text-on-surface-variant): "Customer database. Every project is mapped to a customer for cross-account visibility and reporting." Right: **"New customer" button** (`inline-flex items-center gap-1.5 rounded bg-primary px-3 py-1.5 font-display text-label-caps uppercase tracking-wider text-on-primary hover:bg-primary-container`) with leading `add` icon — only if `project:write`.
- **Delete-error banner** (conditional): `rounded border border-error/30 bg-error-container px-4 py-3 text-sm text-on-error-container`.
- **Loading**: `SkeletonGrid` — 3× `h-40 animate-pulse rounded border border-outline-variant bg-surface-container-low` in the same grid.
- **Empty**: EmptyState icon `business`, "No customers yet." + primary "Add your first customer" button (add icon).
- **Grid**: `grid gap-4 sm:grid-cols-2 xl:grid-cols-3`.

### CustomerCard (Link, `group flex flex-col rounded border border-outline-variant bg-surface-container-lowest p-4 hover:border-primary`)
- Top row (mb-3): **avatar** `h-10 w-10 rounded font-display text-base font-bold text-white`, bg from `avatarColor(name)` hash palette [`#0d9488,#7c3aed,#dc2626,#0ea5e9,#9333ea,#a78bfa,#f59e0b,#10b981,#0058be`], showing 2-letter initials. Name (truncate, text-sm font-bold, `group-hover:text-primary`) + optional "AM: {accountManager}" (11px text-on-surface-variant).
- Description (line-clamp-2, 12px) if present.
- **Metric grid** (`mt-auto grid grid-cols-2 gap-y-1 text-[12px]`): "Projects" → `{_count.projects}` (right, font-mono tabular-nums); optional "SA lead" → `{solutionArchitect}` (right, font-mono 11px truncate).
- **Actions footer** (`mt-3 border-t border-outline-variant pt-2 flex justify-between`): left "View projects →" link (11px) to `/projects?customerId=`. Right (if `project:write`): "Edit" (hover primary) + "Delete" (`hover:bg-error-container hover:text-on-error-container`) — both text-label-caps buttons.
- Triggers `CustomerFormModal` (create + edit). Delete uses `confirm()`.

**Sample row shape** (`CustomerSummary`): `{ id, name, accountManager: string|null, solutionArchitect: string|null, description, _count: { projects } }`.

**Icons:** add, business.

---

# 3. CustomerDetail.tsx — app shell (identity + KPI + tabs)

Back-link "‹ Customers" (`chevron_left` icon, text-[12px] font-bold uppercase). Then `grid gap-4 md:grid-cols-3`:

### Identity card (col-span-1, `rounded border border-outline-variant bg-surface-container-lowest p-4`)
- Avatar `h-12 w-12` (same palette hash) + name (text-base font-bold truncate) + "{n} project(s)" (11px uppercase).
- Meta rows (12px, text-on-surface-variant): `person` icon "AM: {name}"; `engineering` icon "SA: {name}".
- Action row (if canMutate, `border-t pt-2`): **Edit** button (`edit` icon, bordered, hover primary) + **Delete** button (`delete` icon, bordered, hover error).

### 2 KPI tiles (`CustomerKpi`, each `rounded border border-outline-variant bg-surface-container-lowest p-4`)
- Header row: label (text-label-caps) + tone-colored icon (text-base).
- Value `font-mono text-3xl font-bold tabular-nums` + hint (11px).
- Tile 1: "Active projects", `folder_open` icon, tone primary, hint "Linked to this customer".
- Tile 2: "Services subscribed", `category` icon, tone emerald (text-emerald-600), hint "None mapped yet" or "Across N tools".
- Optional whitespace-pre-line description below (max-w-3xl text-sm).

### Tabs (`Tabs.tsx`): Overview · Services · Topology · Organization Structure · Documents. `?tab=` synced to URL.

**Overview tab:**
- **ProfileCompletionCard**: when all done → emerald banner (`border-emerald-300 bg-emerald-50 text-emerald-800`, `check_circle` icon) "Profile complete — all sections filled in." Otherwise card with: header "Customer profile completion" + "{done}/{total} · {pct}%" (font-mono), a **progress bar** (`h-1.5 rounded-full bg-surface-container` track, `bg-primary` fill), then a checklist (5 items: Description, Account Manager, Solution Architect, Services, Projects). Each row: `check_circle`(emerald) or `radio_button_unchecked`(variant) icon + label (done → line-through variant) + hint + optional "Edit" button.
- **ResourceSection "Services"** (`category` icon heading): list of services divided by `divide-outline-variant/60`; each row = service name (text-sm font-medium) + description + right-aligned **tool chips** (`rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 font-mono text-[12px] text-primary`), or "No tools listed" italic.
- **ResourceSection "Topology"** & **"Organization Structure"**: both carry a "Soon" badge (`rounded bg-surface-container px-1.5 py-0.5 text-[10px] font-bold uppercase`) + placeholder copy. Icons `hub` / `account_tree`.
- **Projects table** (heading "Projects" text-label-caps): if empty → EmptyState icon `assignment`. Else `overflow-x-auto rounded border bg-surface` table, header `bg-surface-container-low`. Columns: **Project** (link, hover primary) · **Status** (`rounded bg-surface-container-low px-1.5 py-0.5 text-label-caps uppercase` — raw enum text) · **TAM** (username) · **SA** (username) · **Tasks** (right, font-mono). Rows hover `bg-surface-container-low/50`.

**Services tab:** `ServiceMappingList` component (assignment editor, title "Service Catalogue Mapping"). **Topology / Documents / Organization Structure tabs:** each an EmptyState (icons `hub`, `description`, `account_tree`).

**Sample shape** (`CustomerDetail`): extends CustomerSummary + `services: [{ id, service:{name,description}, tools: string[] }]`, `projects: [{ id, name, status, tam:{username}, sa:{username}, _count:{tasks} }]`, `description: string`.

**Icons:** chevron_left, person, engineering, edit, delete, folder_open, category, hub, account_tree, description, assignment, check_circle, radio_button_unchecked.

---

# 4. Settings.tsx — app shell (centered `max-w-2xl space-y-6`)

- **Header**: H1 "Settings" (text-2xl font-bold) + "Manage your account profile and password."
- **ThemeCard** ("Appearance"): heading (text-[13px] font-bold uppercase) + "Currently rendering in **{light|dark}** mode." Then `grid sm:grid-cols-3` of 3 selectable tiles (Light/Dark/System). Each tile = bordered button, active = `border-primary bg-primary/5`. Row: bold label + icon (`check_circle` primary if active, else the option icon `light_mode`/`dark_mode`/`computer`). **Preview swatch** `h-12 rounded border`: light = white; dark = `#0F1623`; system = 2-col split white/`#0F1623`. Hint text (11px): "Always light/Always dark/Follow OS preference".
- **Profile section** (`rounded border border-outline-variant bg-surface-container-lowest p-5`): heading "Profile". A `<dl>` grid `md:grid-cols-[140px_1fr]`: Username (font-mono), Email (font-mono), Role → pill (`rounded-full bg-surface-container-low px-2 py-0.5 text-label-caps uppercase`). Footnote: "Username, email, and role can only be changed by an Admin."
- **Service Catalogue section** (only if `project:write`): heading "Service Catalogue" + `ServiceCatalogueManager` component.
- **Change password section**: heading "Change password". Success banner (`rounded-lg border border-emerald-300 bg-emerald-50 text-emerald-800`) "Password updated." / error banner (error-container). Form `space-y-3` with 3 `Field`s (each label bold-uppercase-12px + red `*`): **Current password**, **New password** (+hint "At least 8 characters. Must differ…"), **Confirm new password**. All `type=password`, input `w-full rounded border border-outline-variant bg-surface-container-lowest px-3 py-2 text-sm focus:border-primary focus:ring-2 focus:ring-primary/20`. Submit right-aligned primary button "Update password" / "Saving…".

**Icons:** light_mode, dark_mode, computer, check_circle.

---

# 5. Admin.tsx — app shell (4 tabs, 1298 lines)

Root `flex h-full flex-col`. **Header** (`border-b border-outline-variant px-4 py-4 md:px-6`): H1 "Admin" (text-2xl font-bold tracking-tight) + "Manage users and force-reassign project ownership." + `Tabs` (scrollable). Body `flex-1 overflow-auto p-4 md:p-6`.
Tabs: **Users · Roles · Sign-in · Project Override**.

### 5a. Users tab
- **KPI strip** (`grid sm:grid-cols-2 lg:grid-cols-4`, `AdminKpi` tiles = same anatomy as CustomerKpi):
  - "Users" (`group` icon, primary) hint "{active} active · {admins} admins"
  - "Pending" (`hourglass_top`, amber) hint "Needs role assignment"
  - "Custom roles" (`shield_person`, emerald) hint "{n} total roles"
  - "Inactive" (`block`, neutral) hint "Cannot sign in"
- **Error banner** (`border-error/40 bg-error/10 text-error`) + **temp-password result banner** (`border-tertiary/40 bg-tertiary/10`): "Temporary password generated" (tertiary uppercase) + user + `<code>` chip + "Share this… will not be shown again." + Dismiss button.
- **Create-user form** (`flex flex-wrap items-end gap-2 rounded border bg-surface-container-lowest p-3`): fields Email (type=email, ph "user@example.com"), Username (maxLength 50, ph "alice"), "Password (min 8)" (type=password), Role `<select>` (assignable roles, excludes PENDING). Submit "Add user"/"Adding…" primary, disabled until valid.
- **Users table** (`overflow-x-auto rounded border bg-surface`), header `bg-surface-container-low`. Columns: **User** (username, font-medium) · **Email** (font-mono 13px) · **Provider** (`ProviderChip`) · **Role** (inline `<select>`, disabled for self, + "Needs role" amber chip if PENDING) · **Projects (TAM/SA)** (right, font-mono "{n} / {n}") · **Status** (Active chip `bg-chip-emerald-bg text-chip-emerald-text` / "Disabled" gray) · **Actions** (right: Deactivate/Reactivate, Reset password, Delete — all text-label-caps; disabled for self). Inactive rows `opacity-60`.
- **ProviderChip**: google = `bg-primary/10 text-primary` + `mail` icon + "Google"; password = `bg-surface-container-high` + `key` icon + "Password". Both `rounded-full px-2 py-0.5 text-[11px] font-semibold`.
- **Sample** (`AdminUser`): `{ id, username, email, active, role, provider:'google'|'password', avatarUrl, projectsAsTAM, projectsAsSA }`.

### 5b. Roles tab
- Intro paragraph explaining `*` = admin, `project:view-all` = see all projects, PENDING reserved, last admin can't be removed.
- **Create-role form** (`space-y-3 rounded border bg-surface-container-lowest p-3`): "Role name" input (font-mono uppercase, maxLength 50, ph "e.g. MANAGER", must match `[A-Z0-9_]+`) + **PermissionPicker** + "Add role" primary button.
- **PermissionPicker**: `<ul>` of checkbox rows (`divide-outline-variant/60 rounded border bg-surface`). Each: `accent-primary` checkbox + `font-mono` perm value + "— {label}". `*` (Full access) supersedes: when on, others show implied+disabled (`opacity-50`). **PERMISSION_CATALOG** (8 entries): `*` Full access (admin); `project:view-all` See all projects; `project:read` View projects; `project:write` Manage projects; `task:read` View tasks; `task:write` Manage tasks; `report:read` View reports; `report:executive` Executive dashboard.
- **Roles table**: columns **Role** (font-mono medium; + "Reserved" gray pill if builtIn) · **Permissions** (wrap of `rounded px-1.5 py-0.5 font-mono text-[11px]` chips; `*` chip = `bg-primary/15 text-primary` shown as "* full access", others `bg-surface-container-high`; empty = "—") · **Users** (right, font-mono) · **Actions** (Edit → inline edit mode with name input + PermissionPicker + Save/Cancel; Delete disabled if builtIn or userCount>0).
- **Sample** (`AdminRole`): `{ id, roleName, permissions: string[], userCount, builtIn }`.

### 5c. Sign-in tab (Google OAuth policy)
- Intro paragraph (PENDING auto-create explanation).
- **Connection card** (`rounded border bg-surface-container-lowest p-4`): status icon circle `h-10 w-10 rounded-full` (`verified_user` emerald if connected / `lock_open` gray), title "Google identity provider" + **status chip**: "Connected" (emerald) / "Half configured" (amber) / "Not connected" (gray). Subtext = domain count or setup hint. Right: **Manage/Connect** primary button.
- When connected: 2-col grid — **ClientIdField** (masked "123…xyz.apps.googleusercontent.com", Reveal/Hide toggle + `content_copy` copy icon, value in `rounded bg-surface px-2 py-1.5 font-mono text-[12px]`) + **Allowed domains** (wrap of `rounded-full bg-primary/10 px-2.5 py-0.5 font-mono text-[12px] text-primary` chips).
- Footer meta (11px): "Last updated by {username} on {date}" or "Not yet edited…".
- **SignInModal** (`Modal`, `max-w-xl`, title "Configure Google sign-in"): collapsible "How to get a Client ID" `<details>` (3-step ordered list) · error banner · **Client ID input** (type=password/text with Show/Hide, font-mono, ph "123456789-abc.apps.googleusercontent.com") + explanation · **Allowed email domains** editor (removable chips with `close` icon; add-form input ph "example.com" + gray "Add" button). Footer buttons: **Disconnect** (error, mr-auto, if configured) · **Cancel** · **Save** (primary, disabled unless dirty).

### 5d. Project Override tab
- Intro: "Force-reassign the TAM owner of any project. This bypasses the standard visibility check."
- **Table**: columns **Project** (font-medium) · **Customer** (name or "—") · **SA** (username) · **Status** (`rounded bg-surface-container-low px-1.5 py-0.5 text-label-caps uppercase` raw enum) · **Tasks** (right font-mono) · **Current TAM → Reassign** (`<select>` of active users "{username} ({role})"; current TAM appended if not in candidates).
- **Sample** (`AdminProject`): `{ id, name, status, sa:{username}, tam:{username}, customer:{name}|null, _count:{tasks}, tamId }`.

**Icons:** group, hourglass_top, shield_person, block, mail, key, verified_user, lock_open, content_copy, close.

---

# 6. Tasks.tsx — app shell (route intact, removed from sidebar; dense data grid)

- **Header**: H1 "Tasks" (text-2xl font-bold) + "Cross-project task list. Apply filters, sort, click any row to open the editor."
- **Filter bar** (`flex flex-wrap items-end gap-3 rounded border bg-surface-container-lowest p-3`): 4 `FilterSelect`s (label above `<select rounded-lg border px-2 py-1 text-xs>`, first option "Any"): **Status** (TODO/IN PROGRESS/DONE) · **Priority** (LOW/MEDIUM/HIGH/URGENT) · **Assignee** (users) · **Customer** (customers). Then 2 checkboxes (`accent-primary`): "Overdue only", "Top-level only". Right: **Reset** button (bordered, hover primary).
- **Loading**: `h-64 animate-pulse rounded-xl bg-surface-container-low`. **Error**: error-container banner. **Empty**: dashed card "No tasks match the current filters."
- **Table** (`overflow-x-auto rounded border bg-surface-container-lowest`, `text-xs`), header `bg-surface-container-low`. Columns (some sortable, active shows " ↑" + text-primary): **ID** · **Title** · **Project**(sort) · **Labels** · **Priority**(sort) · **Assignee** · **Due**(sort) · **Status**(sort).
- **Row** (`cursor-pointer border-t hover:bg-surface-container-low`, opens `TaskFormModal` edit): ID = `font-mono text-[11px] uppercase tracking-widest` "T-{id padded to 3}" · Title (font-medium) · Project link (stopPropagation, hover primary) · Labels (first 2 `LabelChip compact` + "+N") · `PriorityBadge compact` · `AssigneeAvatar xs` · Due = `font-mono text-[12px]`, overdue → `font-bold text-error` + " · OVERDUE" (overdue = dueDate < today && status≠DONE) · `TaskStatusChip`.

**Sample** (`TaskWithProject`): `{ id, title, status, priority, dueDate:string|null, labels:[{id,name,color}], assignedTo:{id,username}|null, project:{id,name}, projectId }`.

**Icons:** none (pure text/chips).

---

# 7. Executive.tsx — app shell (portfolio roll-up). **No recharts** — hand-built bars + calendar.

- **Header**: H1 "Executive" (text-2xl font-bold) + "Org-wide portfolio roll-up across every TAM's projects."
- Loading `h-32 animate-pulse` / error banner / empty EmptyState (`query_stats`, "No projects yet").
- **Summary line** (`rounded border bg-surface-container-low px-4 py-3 text-sm`): "{n} projects · **{n} overdue**(text-error if >0) · Updated {datetime}".

### Block A — Overdue Projects
- Header: "Overdue Projects" (text-base font-bold) + count pill (`rounded-full bg-error-container px-2 py-0.5 font-mono text-[11px] text-on-error-container`).
- Empty → EmptyState (`task_alt`, "No overdue projects — everything is on schedule.").
- Else desktop **grid table** `grid-cols-[minmax(200px,1.6fr)_140px_160px_140px_120px]`, header `bg-surface-container-low` uppercase: **Project · TAM · Customer · Committed end · Overdue by**(right). Row: project link (font-semibold text-primary) + `ProjectStatusChip`, TAM, customer(or "—"), end date (font-mono), overdue days (right, font-semibold text-error "N days"). Mobile = stacked card variant (`md:hidden`).

### Block B — Portfolio Timelines
- Header: "Portfolio Timelines" + "{n} projects" + **view toggle** (segmented `inline-flex overflow-hidden rounded border`): "Calendar" / "List", active = `bg-primary text-on-primary`, inactive = `bg-surface-container-lowest text-on-surface-variant`.
- **Calendar view** (`PortfolioCalendar`): year stepper (`chevron_left`/`chevron_right` + font-mono year) + **legend** (dots: Overdue=error, Active=primary, Planning·On-hold=amber-bg, Completed=muted). Horizontal 12-month roadmap `min-w-[720px]`: left `w-48` label col (project link + status chip) + 12-col month grid with bars. **Bar** = `h-2.5 rounded-full` positioned by start/end fraction; color via `barTone` (overdue=error, ACTIVE=primary, PLANNING/ON_HOLD=amber-bg, COMPLETED/CANCELLED=muted `on-surface-variant/40`). Dashed **"Today" line** (`border-primary`) + amber "Today" tag when viewing current year. Clip arrows ‹ › for bars extending beyond year. Empty year → EmptyState. Unscheduled-count note below.
- **List view** (`PortfolioList`): note "Phase dots below are a legend, not date-positioned." Then `TimelineRow` cards (`rounded border bg-surface-container-lowest px-4 py-3`): project link + status chip + "{TAM} · {customer}". **Progress bar** `h-2 rounded-full bg-surface-container-high` track, fill `bg-error` (overdue) or `bg-primary`, + "{pct}%" font-mono. Date range "{start} → {end}" font-mono 11px, or "No scheduled tasks" italic. **Section dots** row: colored `h-1.5 w-1.5 rounded-full` (section.color) + name.

**Sample** (`PortfolioProjectRow`): `{ id, name, status, tamName, customerName:string|null, start:string|null, end:string|null, totalTasks, doneTasks, progressPct, isOverdue, daysOverdue, updatedAt, sections:[{id,name,color}] }`.

**Icons:** query_stats, task_alt, chevron_left, chevron_right.

---

# 8. WorkLogs.tsx — app shell (placeholder only, 20 lines)

Centered `flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center`:
- Icon tile `h-16 w-16 rounded-2xl bg-surface-container` containing `schedule` icon (text-3xl text-on-surface-variant).
- H1 "Work Logs" (`font-display text-h2 text-on-surface`) + paragraph (max-w-sm text-sm text-on-surface-variant): "Time tracking and work log history will be available here. Backend wiring is in progress."
- Badge pill (`rounded-full bg-surface-container px-3 py-1 text-label-caps uppercase text-on-surface-variant`): "Preview only".

**Icons:** schedule.

---

**Cross-cutting notes for artboards:**
- Every page except Login renders inside the app Shell (260px dark sidebar + topbar + optional 320px right panel). Login is full-viewport standalone dark.
- Standard content patterns repeat: page H1 = `font-display text-2xl font-bold text-on-surface` + subtitle `text-sm text-on-surface-variant`; primary action button = `rounded bg-primary px-3 py-1.5 text-label-caps uppercase text-on-primary hover:bg-primary-container`; error banner = `rounded border border-error/30 bg-error-container px-4 py-3 text-sm text-on-error-container`; tables = `overflow-x-auto rounded border border-outline-variant bg-surface` with `bg-surface-container-low` uppercase headers; KPI tile pattern shared verbatim across Admin + CustomerDetail.
- Numeric/ID/email/date fields are consistently `font-mono` (often `tabular-nums`).
