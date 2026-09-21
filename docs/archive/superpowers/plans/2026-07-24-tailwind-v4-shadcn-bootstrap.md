# Tailwind v4 Migration + shadcn Bootstrap Implementation Plan (Plan A)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the Solvro frontend from Tailwind CSS 3.4 to 4.x and bootstrap the shadcn component infrastructure (components.json, `cn()`, 8 ui components) that the ReUI Gantt swap (Plan B) requires — with zero visual regressions.

**Architecture:** Solvro's theme already routes every semantic color through CSS custom properties (`rgb(var(--token))` triplets in `src/index.css` `:root`/`.dark`), so the v4 port replaces `tailwind.config.ts` with a CSS-first `@theme` block referencing the same vars — the light/dark flip mechanism (`theme.tsx` toggling `.dark`) is untouched. A second `@theme inline` block bridges shadcn's semantic names (`background`, `muted`, `border`, …) onto Technical Precision values so vendored components inherit the design system automatically.

**Tech Stack:** Tailwind CSS 4.x, `@tailwindcss/vite`, shadcn CLI, `clsx` + `tailwind-merge`, `tw-animate-css`.

**Spec:** `docs/superpowers/specs/2026-07-24-reui-gantt-swap-design.md` (Phase 0 section). This plan is that spec's Phase 0 and its exit gate blocks Plan B entirely.

## Global Constraints

- **Never commit directly.** Every "Commit" step means: `git add` the listed paths, draft the message, and hand it to the orchestrator — the actual commit happens only with explicit user approval (repo guardrail). No Claude co-author trailers.
- **CHANGELOG.md entry in the same change set as every code/config/dep change** (repo guardrail; append-only under `[Unreleased]`).
- npm installs run **twice**: `docker compose exec frontend npm i …` (container) **and** `cd frontend && npm i …` (host, for IDE typecheck). Restart with `docker compose restart frontend` after config-level changes.
- Frontend verification commands: `docker compose exec frontend npm run typecheck` and `docker compose exec frontend npm run build`. E2E: `cd e2e && npm test` (dev server on :5173 must be up; `pwa.spec.ts` is expected to fail against the dev server — known caveat, ignore it there).
- DESIGN.md is binding: dark is the default theme; elevation = 1px outlines, `shadow-overlay` is the only sanctioned shadow; radius 2xl+ forbidden; `rounded-full` reserved for pill chips/avatars.
- Work happens on a new branch off up-to-date `develop` (local develop is behind origin — `git fetch origin && git checkout -b feat/tailwind-v4-shadcn origin/develop` first). PRs target `develop`, not `main`.
- Do not touch `backend/`, `Tasks.tsx`, or any route.

---

### Task 1: Dependency swap + upgrade codemod

**Files:**
- Modify: `frontend/package.json` (deps)
- Modify: `frontend/vite.config.ts`
- Delete: `frontend/postcss.config.js`
- Modify (codemod-driven): `frontend/src/**/*.tsx` class renames

**Interfaces:**
- Produces: a building app on tailwindcss@4 with `@tailwindcss/vite`; template classes renamed to v4 equivalents. Theme is still incomplete until Task 2 — visual output is NOT trusted yet.

- [ ] **Step 1: Confirm the work branch**

`feat/tailwind-v4-shadcn` already exists off `origin/develop` (created 2026-07-24 with the decision-reversal docs commit `6fe6786`). Verify you're on it: `git branch --show-current`. First push later needs `git push -u origin feat/tailwind-v4-shadcn` (the branch currently tracks `origin/develop`).

- [ ] **Step 2: Swap dependencies (container + host)**

```bash
docker compose exec frontend npm uninstall tailwindcss autoprefixer postcss
docker compose exec frontend npm i -D tailwindcss@^4 @tailwindcss/vite@^4
cd frontend && npm uninstall tailwindcss autoprefixer postcss && npm i -D tailwindcss@^4 @tailwindcss/vite@^4 && cd ..
```

- [ ] **Step 3: Wire the vite plugin and delete postcss config**

In `frontend/vite.config.ts` add the import and plugin (first in the array):

```ts
import tailwindcss from "@tailwindcss/vite";
// …
plugins: [
  tailwindcss(),
  react(),
  VitePWA({ /* unchanged */ }),
],
```

```bash
rm frontend/postcss.config.js
```

- [ ] **Step 4: Convert directives + compat shim, then run the official upgrade codemod on the host**

First, in `frontend/src/index.css`, replace the three `@tailwind base/components/utilities;` directives with:

```css
@import "tailwindcss";
/* TEMPORARY Task 1 shim — lets @apply resolve config-defined utilities
   (bg-background, font-display) until Task 2's @theme port. Task 2 deletes
   this line together with tailwind.config.ts. */
@config "../tailwind.config.ts";
```

(Amended 2026-07-24: without the shim, both the codemod and the build hard-fail on `Cannot apply unknown utility class 'bg-background'` — config-only utilities inside `@apply` are a compile error in v4, not a graceful degrade.)

Then:

```bash
cd frontend && npx @tailwindcss/upgrade --force && cd ..
```

Review its diff. Expected mechanical renames in `src/**/*.tsx`: `rounded` → `rounded-sm`, `rounded-sm` → `rounded-xs`, `shadow-sm` → `shadow-xs`, `shadow` → `shadow-sm`, `outline-none` → `outline-hidden`, `ring` → `ring-3`, `flex-shrink-*` → `shrink-*`. The v4 defaults for the renamed radius keys equal the old config's values (0.25rem, 0.125rem, …), so these renames are visually neutral. If the codemod rewrites `src/index.css` or deletes `tailwind.config.ts` on its own, keep the css and let Task 2 finish the port — the config file is deleted there deliberately.

- [ ] **Step 5: Verify the build compiles (visuals not yet trusted)**

```bash
docker compose restart frontend
docker compose exec frontend npm run build
```

Expected: build succeeds. Utilities from the old config (`bg-surface`, `w-sidebar`, `text-h1`…) may be missing/unstyled until Task 2 — that is expected here; only compilation is being verified.

- [ ] **Step 6: Stage + draft commit**

```bash
git add frontend/package.json frontend/package-lock.json frontend/vite.config.ts frontend/postcss.config.js frontend/src CHANGELOG.md
```

CHANGELOG entry (append under `[Unreleased]`):

```markdown
### Changed — <date> — Tailwind v4 toolchain swap (Plan A Task 1)

- Frontend build moved to Tailwind CSS 4 via `@tailwindcss/vite` (`frontend/vite.config.ts`); `postcss.config.js`, `postcss`, `autoprefixer` removed (v4 handles both). Official upgrade codemod applied v4 class renames across `frontend/src/` (`rounded`→`rounded-sm`, `shadow`→`shadow-sm`, `ring`→`ring-3`, `outline-none`→`outline-hidden`, …).
```

Draft message: `build(frontend): swap to Tailwind v4 toolchain + upgrade codemod (Plan A Task 1)`

---

### Task 2: CSS-first theme port (`@theme`) — delete `tailwind.config.ts`

**Files:**
- Modify: `frontend/src/index.css` (head of file; the `:root`/`.dark` triplet blocks stay byte-identical)
- Delete: `frontend/tailwind.config.ts`

**Interfaces:**
- Consumes: the `:root` / `.dark` RGB-triplet custom properties already in `index.css` (unchanged).
- Produces: every utility the app already uses (`bg-surface`, `text-on-surface-variant`, `bg-primary/10`, `w-sidebar`, `ml-sidebar-collapsed`, `w-context-panel`, `text-h1`, `text-label-caps`, `shadow-overlay`, `font-display`, `bg-chip-amber-bg`, `bg-sidebar`, `text-ink`…) compiled by v4 with identical output. Dark mode via `.dark` class works exactly as before.

- [ ] **Step 1: Replace the head of `frontend/src/index.css`**

Task 1 already converted the directives to `@import "tailwindcss";` plus a **temporary `@config "../tailwind.config.ts";` shim — delete the `@config` line (and its comment) now**; this task replaces it with the real port. The head becomes:

```css
@import "tailwindcss";

/* Class-driven dark mode — theme.tsx toggles `.dark` on <html>; this variant
   replaces the v3 `darkMode: "class"` config. */
@custom-variant dark (&:where(.dark, .dark *));

/* CSS-first port of tailwind.config.ts (deleted). Colors keep routing
   through the :root/.dark RGB triplets below — var-in-var resolves at the
   consuming element, so the .dark flip keeps working and /opacity modifiers
   keep working (v4 color-mix). */
@theme {
  /* — Semantic colors (Technical Precision) — */
  --color-surface: rgb(var(--surface));
  --color-surface-dim: rgb(var(--surface-dim));
  --color-surface-bright: rgb(var(--surface-bright));
  --color-surface-container-lowest: rgb(var(--surface-container-lowest));
  --color-surface-container-low: rgb(var(--surface-container-low));
  --color-surface-container: rgb(var(--surface-container));
  --color-surface-container-high: rgb(var(--surface-container-high));
  --color-surface-container-highest: rgb(var(--surface-container-highest));
  --color-on-surface: rgb(var(--on-surface));
  --color-on-surface-variant: rgb(var(--on-surface-variant));
  --color-inverse-surface: rgb(var(--inverse-surface));
  --color-inverse-on-surface: rgb(var(--inverse-on-surface));
  --color-outline: rgb(var(--outline));
  --color-outline-variant: rgb(var(--outline-variant));
  --color-primary: rgb(var(--primary));
  --color-on-primary: rgb(var(--on-primary));
  --color-primary-container: rgb(var(--primary-container));
  --color-on-primary-container: rgb(var(--on-primary-container));
  --color-inverse-primary: rgb(var(--inverse-primary));
  --color-secondary: rgb(var(--secondary));
  --color-on-secondary: rgb(var(--on-secondary));
  --color-secondary-container: rgb(var(--secondary-container));
  --color-on-secondary-container: rgb(var(--on-secondary-container));
  --color-tertiary: rgb(var(--tertiary));
  --color-on-tertiary: rgb(var(--on-tertiary));
  --color-error: rgb(var(--error));
  --color-on-error: rgb(var(--on-error));
  --color-error-container: rgb(var(--error-container));
  --color-on-error-container: rgb(var(--on-error-container));
  --color-background: rgb(var(--background));
  --color-on-background: rgb(var(--on-background));
  /* — Chip / status tones — */
  --color-chip-emerald-bg: rgb(var(--emerald-bg));
  --color-chip-emerald-text: rgb(var(--emerald-text));
  --color-chip-amber-bg: rgb(var(--amber-bg));
  --color-chip-amber-text: rgb(var(--amber-text));
  --color-chip-rose-bg: rgb(var(--rose-bg));
  --color-chip-rose-text: rgb(var(--rose-text));
  --color-chip-violet-bg: rgb(var(--violet-bg));
  --color-chip-violet-text: rgb(var(--violet-text));
  /* — Fixed brand ink + sidebar charcoal (never theme-flip) — */
  --color-ink: #191919;
  --color-ink-hover: #2e2e2e;
  --color-sidebar: #232321;

  /* — Radius: v4 defaults already match DESIGN.md after the Task 1 renames
       (rounded-xs .125 / rounded-sm .25 / md .375 / lg .5 / xl .75).
       DESIGN.md forbids larger radii — remove them from the theme. — */
  --radius-2xl: initial;
  --radius-3xl: initial;
  --radius-4xl: initial;

  /* — Typography — */
  --font-display: "Source Sans 3", system-ui, sans-serif;
  --font-body: "Source Sans 3", system-ui, sans-serif;
  /* +1px default scale (was fontSize override in tailwind.config.ts) */
  --text-xs: 13px;
  --text-xs--line-height: 1.35;
  --text-sm: 15px;
  --text-sm--line-height: 1.45;
  --text-base: 17px;
  --text-base--line-height: 1.55;
  --text-lg: 19px;
  --text-lg--line-height: 1.55;
  --text-xl: 21px;
  --text-xl--line-height: 1.5;
  --text-2xl: 25px;
  --text-2xl--line-height: 1.4;
  --text-3xl: 31px;
  --text-3xl--line-height: 1.3;
  --text-4xl: 37px;
  --text-4xl--line-height: 1.2;
  /* Named roles — canonical per DESIGN.md typography frontmatter */
  --text-h1: 32px;
  --text-h1--line-height: 1.2;
  --text-h1--font-weight: 600;
  --text-h2: 24px;
  --text-h2--line-height: 1.2;
  --text-h2--font-weight: 600;
  --text-body-lg: 16px;
  --text-body-lg--line-height: 1.5;
  --text-body-lg--font-weight: 450;
  --text-body-sm: 15px;
  --text-body-sm--line-height: 1.5;
  --text-body-sm--font-weight: 450;
  --text-data-mono: 13px;
  --text-data-mono--line-height: 1.4;
  --text-data-mono--letter-spacing: -0.01em;
  --text-data-mono--font-weight: 500;
  --text-label-caps: 12px;
  --text-label-caps--line-height: 1;
  --text-label-caps--letter-spacing: 0.05em;
  --text-label-caps--font-weight: 700;

  /* — Elevation: outlines only; the single sanctioned shadow — */
  --shadow-overlay: 0 4px 24px rgba(0, 0, 0, 0.18);

  /* — Layout tokens (w-sidebar / ml-sidebar-collapsed / w-context-panel) — */
  --spacing-sidebar: 260px;
  --spacing-sidebar-collapsed: 4rem;
  --spacing-context-panel: 320px;
}
```

Everything below (the `@layer base` block with `:root` and `.dark` triplets) stays byte-identical.

- [ ] **Step 2: Apply the deferred bare-class renames** (added 2026-07-24)

With Task 1's `@config` shim active, the codemod deliberately skipped three rename families because the legacy config kept their v3 semantics. Removing the shim makes them mandatory — on native v4 these bare classes change meaning or value. Apply mechanically across `frontend/src/**/*.tsx`:

- `rounded` (bare, ~282 occurrences / 34 files) → `rounded-sm`
- `shadow` (bare, e.g. `GanttBar.tsx:327/342`) → `shadow-sm`
- `outline-none` (20 files) → `outline-hidden`

**Variant prefixes count** (reviewer-confirmed in the Task 1 diff): `md:rounded` (`Modal.tsx:47`), `focus:outline-none`, `hover:shadow`, … — the bare token may be preceded by start-of-string, whitespace, quote, or `:` (variant separator), and must NOT be followed by `-` (which would make it `rounded-sm`, `shadow-overlay`, etc.). Suggested transform (per family, `rounded` shown):

```bash
cd frontend && perl -pi -e 's/(?<![-\w])rounded(?![-\w])/rounded-sm/g' $(grep -rlE '(?<![-\w])rounded(?![-\w])' src --include='*.tsx' -P) && cd ..
```

(Apply the same pattern for `shadow`→`shadow-sm` and `outline-none`→`outline-hidden`; for `outline-none` a plain global replace is safe since no `outline-none-*` utilities exist.)

Then verify no bare occurrences remain and the built CSS still emits the expected values:

```bash
grep -rnP '(?<![-\w])(rounded|shadow)(?![-\w])' frontend/src --include='*.tsx' ; # expect empty
grep -rn 'outline-none' frontend/src --include='*.tsx' ; # expect empty
docker compose exec frontend npm run build
grep -o 'rounded-sm' frontend/dist/assets/*.css | head -1   # expect a hit; also spot-check .rounded-sm resolves to border-radius:.25rem in the built CSS
```

- [ ] **Step 3: Delete the v3 config**

```bash
git rm frontend/tailwind.config.ts
```

(Also closes the old "generated tailwind.config.js shadowing" gotcha for good — the `.gitignore` line for it is harmless and stays.)

- [ ] **Step 3: Verify theme parity**

```bash
docker compose restart frontend
docker compose exec frontend npm run build
docker compose exec frontend npm run typecheck
```

Expected: both pass. Then spot-check the built CSS actually contains the ported tokens:

```bash
grep -o 'var(--surface)' frontend/dist/assets/*.css | head -1        # expect a hit
grep -o -- '--spacing-sidebar' frontend/dist/assets/*.css | head -1  # expect a hit
```

- [ ] **Step 4: Manual smoke in the browser**

Open `http://localhost:5173` — dark theme by default: charcoal `#232321` surfaces, Elitery Green primary, sidebar rail 260px, collapse to 4rem works, theme toggle flips to light. Compare against a screenshot taken before Task 1 if in doubt.

- [ ] **Step 5: Stage + draft commit**

```bash
git add frontend/src/index.css frontend/tailwind.config.ts CHANGELOG.md
```

CHANGELOG entry:

```markdown
### Changed — <date> — Theme ported to CSS-first `@theme` (Plan A Task 2)

- `frontend/tailwind.config.ts` deleted; all Technical Precision tokens (colors, +1px text scale, named type roles, `shadow-overlay`, sidebar/context-panel spacing, radius prohibitions) now live in a `@theme` block at the head of `frontend/src/index.css`, still routed through the existing `:root`/`.dark` RGB triplets. Dark mode is the `@custom-variant dark` class variant — `theme.tsx` unchanged.
```

Draft message: `feat(frontend): CSS-first Tailwind v4 theme port, delete tailwind.config.ts (Plan A Task 2)`

---

### Task 3: shadcn bootstrap (components.json, `cn()`, semantic bridge)

**Files:**
- Create: `frontend/components.json`
- Create: `frontend/src/lib/utils.ts`
- Modify: `frontend/src/index.css` (append one `@theme inline` block after the `@theme` block)
- Modify: `frontend/package.json` (deps)

**Interfaces:**
- Produces: `cn(...inputs: ClassValue[]): string` at `@/lib/utils` (exact import path shadcn/ReUI files expect); shadcn semantic utilities (`bg-background`, `text-foreground`, `text-muted-foreground`, `border-border`, `bg-muted/40`, `bg-accent`, `ring-ring`, `bg-popover`, `bg-card`, `bg-destructive`) all resolving to Technical Precision values in both themes — this is what makes Task 4's vendored components and Plan B's Gantt theme-correct with zero per-component restyling.

- [ ] **Step 1: Install runtime deps (container + host)**

```bash
docker compose exec frontend npm i clsx tailwind-merge tw-animate-css
cd frontend && npm i clsx tailwind-merge tw-animate-css && cd ..
```

- [ ] **Step 2: Create `frontend/src/lib/utils.ts`**

```ts
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** shadcn-convention class combiner — vendored ui components import this. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

- [ ] **Step 3: Create `frontend/components.json`**

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "new-york",
  "rsc": false,
  "tsx": true,
  "tailwind": {
    "config": "",
    "css": "src/index.css",
    "baseColor": "neutral",
    "cssVariables": true
  },
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils",
    "ui": "@/components/ui",
    "lib": "@/lib",
    "hooks": "@/hooks"
  }
}
```

- [ ] **Step 4: Append the shadcn semantic bridge to `frontend/src/index.css`** (directly after the `@theme` block from Task 2)

```css
@import "tw-animate-css";

/* shadcn semantic names → Technical Precision. Vendored shadcn/ReUI
   components use bg-background / text-muted-foreground / border-border etc.;
   this bridge is the single enforcement point that keeps them on DESIGN.md
   values in both themes. NOTE: shadcn's --color-background / --color-primary
   definitions coincide with the Solvro tokens already defined above — the
   entries here only add the names Solvro doesn't have yet. */
@theme inline {
  --color-foreground: rgb(var(--on-surface));
  --color-card: rgb(var(--surface-container-low));
  --color-card-foreground: rgb(var(--on-surface));
  --color-popover: rgb(var(--surface-container));
  --color-popover-foreground: rgb(var(--on-surface));
  --color-primary-foreground: rgb(var(--on-primary));
  --color-secondary-foreground: rgb(var(--on-secondary));
  --color-muted: rgb(var(--surface-container));
  --color-muted-foreground: rgb(var(--on-surface-variant));
  --color-accent: rgb(var(--surface-container-high));
  --color-accent-foreground: rgb(var(--on-surface));
  --color-destructive: rgb(var(--error));
  --color-destructive-foreground: rgb(var(--on-error));
  --color-border: rgb(var(--outline-variant));
  --color-input: rgb(var(--outline-variant));
  --color-ring: rgb(var(--primary));
}
```

- [ ] **Step 5: Verify**

```bash
docker compose restart frontend
docker compose exec frontend npm run typecheck && docker compose exec frontend npm run build
```

Expected: both pass (nothing consumes the bridge yet — Task 4 does).

- [ ] **Step 6: Stage + draft commit**

```bash
git add frontend/components.json frontend/src/lib/utils.ts frontend/src/index.css frontend/package.json frontend/package-lock.json CHANGELOG.md
```

CHANGELOG entry:

```markdown
### Added — <date> — shadcn bootstrap (Plan A Task 3)

- `frontend/components.json`, `cn()` at `frontend/src/lib/utils.ts` (`clsx` + `tailwind-merge`), `tw-animate-css`, and a `@theme inline` bridge in `frontend/src/index.css` mapping shadcn semantic color names onto Technical Precision tokens (both themes). Reverses the 2026-07-22 "no shadcn stack" stance per the 2026-07-24 spec.
```

Draft message: `feat(frontend): shadcn bootstrap — components.json, cn(), semantic theme bridge (Plan A Task 3)`

---

### Task 4: Install the 8 shadcn ui components the ReUI Gantt needs

**Files:**
- Create: `frontend/src/components/ui/{button,calendar,checkbox,context-menu,dropdown-menu,popover,scroll-area,tooltip}.tsx` (CLI-generated)
- Modify: `frontend/package.json` (whatever peer deps the CLI adds, e.g. `@base-ui/react` or Radix packages per component)

**Interfaces:**
- Produces: `@/components/ui/*` imports exactly as the ReUI gantt source expects (`Button`, `Calendar`, `Checkbox`, `ContextMenu*`, `DropdownMenu*`, `Popover*`, `ScrollArea`/`ScrollBar`, `Tooltip*`).

- [ ] **Step 1: Run the CLI on the host, then sync the container**

```bash
cd frontend && npx shadcn@latest add button calendar checkbox context-menu dropdown-menu popover scroll-area tooltip && cd ..
docker compose exec frontend npm i
docker compose restart frontend
```

If the CLI asks about a base color or CSS variables, accept the `components.json` values from Task 3. Note which npm deps it added (`package.json` diff) for the CHANGELOG.

- [ ] **Step 2: Typecheck; fix any strictness fallout inside `src/components/ui/` only**

```bash
docker compose exec frontend npm run typecheck
```

Expected: PASS. Generated files may need minor tsconfig-strictness touch-ups; do not restyle them — theming flows from the Task 3 bridge.

- [ ] **Step 3: Visual sanity of one primitive**

Temporarily render `<Button>Test</Button>` on any screen (or check via Storybook-less quick mount in `Overview.tsx`), verify: green primary bg, correct radius, both themes. Remove the test render before staging.

- [ ] **Step 4: Stage + draft commit**

```bash
git add frontend/src/components/ui frontend/package.json frontend/package-lock.json CHANGELOG.md
```

CHANGELOG entry:

```markdown
### Added — <date> — shadcn ui primitives for the Gantt swap (Plan A Task 4)

- Vendored via shadcn CLI into `frontend/src/components/ui/`: button, calendar, checkbox, context-menu, dropdown-menu, popover, scroll-area, tooltip (+ their npm peer deps: <list from package.json diff>). Required imports of the ReUI Gantt (Plan B). Themed via the Task 3 semantic bridge, not per-file edits.
```

Draft message: `feat(frontend): vendor 8 shadcn ui primitives for ReUI Gantt (Plan A Task 4)`

---

### Task 5: Exit gate — full regression sweep (blocks Plan B)

**Files:**
- Modify: none expected; fixes found here are folded in and noted in the CHANGELOG entry.

**Interfaces:**
- Produces: the spec's Phase 0 exit gate verdict. Plan B must not start until every check passes.

- [ ] **Step 1: Automated gates**

```bash
docker compose exec frontend npm run typecheck
docker compose exec frontend npm run build
docker compose exec backend npx tsc --noEmit
cd e2e && npm test; cd ..
```

Expected: all pass (except `pwa.spec.ts` against the dev server — known caveat; run it against the CI stack `ci/docker-compose.ci.yml` on :8080 if PWA confidence is wanted).

- [ ] **Step 2: Manual visual sweep — every screen, both themes, two widths**

Checklist (desktop 1440px and 375px, dark then light): Login, Overview, Projects → ProjectDetail tabs (overview, list, kanban, **gantt — old engine, must still render**, timeline, risks, services), Customers → CustomerDetail, Daily Review, Reports, Executive, Settings, Admin. Specifically hunt the v4 behavior changes: default border color (v3 gray-200 → v4 currentColor) on any `border` without an explicit color; `ring` widths; focus outlines after `outline-none`→`outline-hidden`; chip colors; `shadow-overlay` on modals/menus; sidebar fixed charcoal in light mode.

- [ ] **Step 3: Record the gate result + stage**

Append findings-fixed notes to the Task 5 CHANGELOG entry:

```markdown
### Changed — <date> — Tailwind v4 exit gate passed (Plan A Task 5)

- Typecheck, build, backend tsc, Playwright suite green on Tailwind v4; full-screen visual sweep (all sidebar screens, dark+light, 1440px/375px) completed. Fix-ups found during the sweep: <list or "none">.
```

Draft message: `chore(frontend): Tailwind v4 exit gate — sweep fixes + CHANGELOG (Plan A Task 5)`

---

## Self-Review (run after writing code, before the gate)

1. **Spec coverage:** Task 1–2 = spec Phase 0 step 1; Task 3 = steps 2 (bridge) and 3 (deps); Task 4 = step 3 (8 components); Task 5 = step 4 (exit gate). ✔
2. **Placeholder scan:** the only intentionally deferred content is `<list from package.json diff>` / `<date>` / sweep findings — fill them at execution time with real values.
3. **Type consistency:** `cn` signature matches shadcn convention (`ClassValue[]` → `string`); alias paths in `components.json` match the existing `@/` vite alias.
