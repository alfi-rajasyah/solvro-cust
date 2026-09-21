# Global Search & Command Palette (⌘K) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> Spec: `docs/superpowers/specs/2026-07-27-global-search-spec.md` (approved 2026-07-27).

**Goal:** Make the decorative top-bar search box real — a ⌘K command palette searching projects, tasks, and customers via a new `GET /search` endpoint, plus permission-gated page-navigation commands.

**Architecture:** One new authed backend route (`/search`, three parallel Prisma queries scoped by `projectVisibilityFilter`); frontend palette = hand-rolled centered overlay (per `Modal.tsx` conventions) composing the vendored ReUI/Base-UI autocomplete for input + listbox semantics; a single global ⌘K listener in `Shell`; TanStack Query hook with debounce; task results reuse the existing `?task=` deep-link read by `ProjectDetail.tsx:43`.

**Tech Stack:** Express + Zod + Prisma (backend); React + TanStack Query + react-router + Tailwind v4 tokens + `@base-ui/react ^1.6.0` (frontend); Vitest both sides; Playwright e2e.

## Global Constraints

- **Zero new npm dependencies** — final `git diff` of any `package.json` must be empty. All deps of the vendored autocomplete are already installed (`@base-ui/react ^1.6.0`, `class-variance-authority ^0.7.1`, `scroll-area` primitive).
- **Never install `cmdk`** or anything radix-backed (radix-ui removed 2026-07-24, never reintroduce). Never install `gantt-task-react`.
- Backend routes mount **without `/api` prefix** (`app.use("/search", …)`); the frontend `apiRequest` prepends `/api` via the reverse proxy.
- **`ProjectNote` content must never be searched or returned** — notes are out of scope entirely (INTERNAL-notes guardrail).
- Reuse `projectVisibilityFilter` from `backend/src/lib/visibility.ts` — never re-derive role scoping.
- Sub-200ms API responses (NFR). `GROUP_LIMIT = 8` per entity; no new indexes in this plan (`pg_trgm` deferred, ask-first).
- **CHANGELOG.md entry in the same change set as every code task** — append-only, under `[Unreleased]`, Keep-a-Changelog headings.
- **No commits or PRs without explicit user approval** (CLAUDE.md guardrail). Every task's final step *stages* files and *drafts* the commit message; the orchestrator collects approval (per task or batched). **No Claude co-author trailers or attribution in commits/PRs.**
- Branch: `feat/global-search` cut from up-to-date `origin/develop`. PR targets `develop`; immediately after opening run `gh pr edit <n> --add-assignee alfi-rajasyah`.
- Styling: semantic tokens only (`bg-surface-container-lowest`, `text-on-surface-variant`, …) — no raw hex. Icons via `material-symbols-outlined` spans (matches TopBar/Sidebar).
- Vendored files: if hand-edited, mark edited lines `// SOLVRO PATCH` (CLI re-pulls strip vendor headers).

---

### Task 1: Backend `GET /search` route (TDD)

**Files:**
- Create: `backend/src/routes/search.ts`
- Modify: `backend/src/app.ts` (add import + `app.use("/search", searchRouter)` after the `/reports` mount, line ~56)
- Test: `backend/test/search.test.ts`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: `projectVisibilityFilter(user: JwtPayload): Prisma.ProjectWhereInput` (`backend/src/lib/visibility.ts:15` — returns `{}` when the user has `project:view-all` or `*`); `requireAuth` sets `req.user`; `validate("query", schema)` re-assigns parsed values onto `req.query`.
- Produces (Task 4 consumes this contract verbatim):
  `GET /search?q=<2–100 chars>` → `200 {`
  `projects: { id: number; name: string; status: string; customerName: string | null }[],`
  `tasks: { id: number; title: string; status: string; projectId: number; projectName: string }[],`
  `customers: { id: number; name: string }[] }` — each array ≤ 8, ordered by name/title asc. `401` unauthenticated, `400` bad `q`.

- [ ] **Step 0: Create the branch**

```bash
git fetch origin && git checkout -b feat/global-search origin/develop
```

- [ ] **Step 1: Write the failing tests**

Create `backend/test/search.test.ts` (conventions copied from `projectSaOptional.test.ts`):

```ts
import "./env.js";
import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/prisma.js";
import { seedRoles, createAdminAndToken, createUserWithRole } from "./testAuth.js";

const app = createApp();

beforeAll(async () => {
  await seedRoles();
});

// Unique needle per run so accumulated rows in the shared solvro_test DB
// can never satisfy or break these assertions.
function needle(): string {
  return `srch${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

describe("GET /search", () => {
  it("rejects unauthenticated requests with 401", async () => {
    const res = await request(app).get("/search").query({ q: "anything" });
    expect(res.status).toBe(401);
  });

  it("rejects q shorter than 2 chars and missing q with 400", async () => {
    const { token } = await createAdminAndToken();
    const short = await request(app)
      .get("/search")
      .query({ q: "a" })
      .set("Authorization", `Bearer ${token}`);
    expect(short.status).toBe(400);

    const missing = await request(app)
      .get("/search")
      .set("Authorization", `Bearer ${token}`);
    expect(missing.status).toBe(400);
  });

  it("returns matching projects, tasks, and customers with the documented shape", async () => {
    const { token, userId } = await createAdminAndToken();
    const n = needle();

    const customer = await prisma.customer.create({
      data: { name: `${n} Corp`, description: "d" },
    });
    const project = await prisma.project.create({
      data: { name: `${n} Project`, tamId: userId, customerId: customer.id },
    });
    const task = await prisma.task.create({
      data: { title: `${n} Task`, projectId: project.id, position: 0 },
    });

    const res = await request(app)
      .get("/search")
      .query({ q: n })
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);

    expect(res.body.projects).toEqual([
      {
        id: project.id,
        name: `${n} Project`,
        status: "PLANNING",
        customerName: `${n} Corp`,
      },
    ]);
    expect(res.body.tasks).toEqual([
      {
        id: task.id,
        title: `${n} Task`,
        status: "TODO",
        projectId: project.id,
        projectName: `${n} Project`,
      },
    ]);
    expect(res.body.customers).toEqual([{ id: customer.id, name: `${n} Corp` }]);
  });

  it("matches case-insensitively", async () => {
    const { token, userId } = await createAdminAndToken();
    const n = needle();
    await prisma.project.create({
      data: { name: `${n.toUpperCase()} MixedCase`, tamId: userId },
    });

    const res = await request(app)
      .get("/search")
      .query({ q: n }) // lowercase needle against uppercase name
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.projects).toHaveLength(1);
  });

  it("caps each group at 8 results", async () => {
    const { token } = await createAdminAndToken();
    const n = needle();
    for (let i = 0; i < 10; i++) {
      await prisma.customer.create({
        data: { name: `${n} cap ${i}`, description: "d" },
      });
    }

    const res = await request(app)
      .get("/search")
      .query({ q: n })
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.customers).toHaveLength(8);
  });

  it("scopes projects and tasks by projectVisibilityFilter (TAM sees own only; admin sees all)", async () => {
    const tam = await createUserWithRole("TAM");
    const otherTam = await createUserWithRole("TAM");
    const admin = await createAdminAndToken();
    const n = needle();

    const mine = await prisma.project.create({
      data: { name: `${n} mine`, tamId: tam.userId },
    });
    const other = await prisma.project.create({
      data: { name: `${n} other`, tamId: otherTam.userId },
    });
    await prisma.task.create({
      data: { title: `${n} mine-task`, projectId: mine.id, position: 0 },
    });
    await prisma.task.create({
      data: { title: `${n} other-task`, projectId: other.id, position: 0 },
    });

    const tamRes = await request(app)
      .get("/search")
      .query({ q: n })
      .set("Authorization", `Bearer ${tam.token}`);
    expect(tamRes.status).toBe(200);
    expect(tamRes.body.projects.map((p: { name: string }) => p.name)).toEqual([`${n} mine`]);
    expect(tamRes.body.tasks.map((t: { title: string }) => t.title)).toEqual([`${n} mine-task`]);

    const adminRes = await request(app)
      .get("/search")
      .query({ q: n })
      .set("Authorization", `Bearer ${admin.token}`);
    expect(adminRes.body.projects).toHaveLength(2);
    expect(adminRes.body.tasks).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
TEST_URL=$(docker compose exec backend printenv DATABASE_URL | tr -d '\r\n' | sed 's|/solvro?|/solvro_test?|') \
  && docker compose exec -e DATABASE_URL="$TEST_URL" backend npx vitest run test/search.test.ts
```

Expected: all tests FAIL — `/search` returns 404 (route not mounted). If the run flakes on unrelated `taskOrdering` accumulation, see CLAUDE.md Testing caveat (iii): drop/recreate `solvro_test`.

- [ ] **Step 3: Implement the route**

Create `backend/src/routes/search.ts`:

```ts
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { requireAuth } from "../http/auth.js";
import { validate } from "../http/validate.js";
import { projectVisibilityFilter } from "../lib/visibility.js";

const searchQuerySchema = z.object({
  q: z.string().trim().min(2).max(100),
});

// 8 hits per group keeps the palette scannable and the three queries cheap
// (sub-200ms NFR). ProjectNote is deliberately NOT searched — INTERNAL-notes
// guardrail; notes must never leak through a search surface.
const GROUP_LIMIT = 8;

export const searchRouter = Router();

searchRouter.use(requireAuth);

searchRouter.get("/", validate("query", searchQuerySchema), async (req, res) => {
  const { q } = req.query as unknown as z.infer<typeof searchQuerySchema>;
  const visible = projectVisibilityFilter(req.user!);

  const [projects, tasks, customers] = await Promise.all([
    prisma.project.findMany({
      where: { AND: [visible, { name: { contains: q, mode: "insensitive" } }] },
      select: {
        id: true,
        name: true,
        status: true,
        customer: { select: { name: true } },
      },
      orderBy: { name: "asc" },
      take: GROUP_LIMIT,
    }),
    prisma.task.findMany({
      where: { title: { contains: q, mode: "insensitive" }, project: visible },
      select: {
        id: true,
        title: true,
        status: true,
        projectId: true,
        project: { select: { name: true } },
      },
      orderBy: { title: "asc" },
      take: GROUP_LIMIT,
    }),
    prisma.customer.findMany({
      where: { name: { contains: q, mode: "insensitive" } },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
      take: GROUP_LIMIT,
    }),
  ]);

  res.json({
    projects: projects.map((p) => ({
      id: p.id,
      name: p.name,
      status: p.status,
      customerName: p.customer?.name ?? null,
    })),
    tasks: tasks.map((t) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      projectId: t.projectId,
      projectName: t.project.name,
    })),
    customers,
  });
});
```

Mount in `backend/src/app.ts` — add with the other imports (`import { searchRouter } from "./routes/search.js";`) and after line 56 (`app.use("/reports", reportsRouter);`):

```ts
app.use("/search", searchRouter);
```

- [ ] **Step 4: Run tests to verify they pass**

Same command as Step 2. Expected: 6 passed. Then typecheck:

```bash
docker compose exec backend npx tsc --noEmit
```

- [ ] **Step 5: CHANGELOG + stage + draft commit (do NOT commit — user approval required)**

Append under `[Unreleased]` → `### Added` in `CHANGELOG.md`:

```markdown
- Global search API: `GET /search?q=` returns visibility-scoped project/task/customer matches (case-insensitive contains, max 8 per group) via `projectVisibilityFilter` — `backend/src/routes/search.ts`, mounted in `app.ts`. Backend half of the ⌘K palette; notes deliberately excluded (INTERNAL-notes guardrail).
```

```bash
git add backend/src/routes/search.ts backend/src/app.ts backend/test/search.test.ts CHANGELOG.md
```

Drafted message: `feat(search): add visibility-scoped GET /search endpoint for the command palette`

---

### Task 2: `navCommands` pure module (TDD)

**Files:**
- Create: `frontend/src/lib/navCommands.ts`
- Test: `frontend/src/lib/navCommands.test.ts` (frontend Vitest is node-env pure-module only — matches `src/**/*.test.ts`, like the kanban-v2 suite)
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: nothing (pure module — permission checks are injected, so it never imports React or `auth.tsx`).
- Produces (Task 4 consumes):
  `interface NavCommand { to: string; label: string; icon: string; requires?: string }`
  `const NAV_COMMANDS: NavCommand[]`
  `function filterNavCommands(has: (permission: string) => boolean, query: string): NavCommand[]`

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/lib/navCommands.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { NAV_COMMANDS, filterNavCommands } from "./navCommands";

const none = () => false;
const wildcard = () => true; // admin: hasPermission(user, anything) === true
const execOnly = (p: string) => p === "report:executive";

describe("filterNavCommands", () => {
  it("returns all ungated pages for a user with no permissions", () => {
    const labels = filterNavCommands(none, "").map((c) => c.label);
    expect(labels).toEqual([
      "Overview",
      "Projects",
      "Customers",
      "Daily Review",
      "Reports",
      "Settings",
    ]);
  });

  it("includes Executive and Admin for a wildcard (admin) user", () => {
    const labels = filterNavCommands(wildcard, "").map((c) => c.label);
    expect(labels).toContain("Executive");
    expect(labels).toContain("Admin");
    expect(labels).toHaveLength(NAV_COMMANDS.length);
  });

  it("includes Executive but not Admin for report:executive without wildcard", () => {
    const labels = filterNavCommands(execOnly, "").map((c) => c.label);
    expect(labels).toContain("Executive");
    expect(labels).not.toContain("Admin");
  });

  it("filters by label, case-insensitively", () => {
    expect(filterNavCommands(none, "rep").map((c) => c.label)).toEqual(["Reports"]);
    expect(filterNavCommands(none, "REPORTS").map((c) => c.label)).toEqual(["Reports"]);
    expect(filterNavCommands(none, "zzz")).toEqual([]);
  });

  it("keeps every route in sync with the app's route table", () => {
    expect(NAV_COMMANDS.map((c) => c.to)).toEqual([
      "/overview",
      "/projects",
      "/customers",
      "/daily-review",
      "/reports",
      "/executive",
      "/settings",
      "/admin",
    ]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
docker compose exec frontend npx vitest run src/lib/navCommands.test.ts
```

Expected: FAIL — cannot resolve `./navCommands`.

- [ ] **Step 3: Implement the module**

Create `frontend/src/lib/navCommands.ts`:

```ts
// Static catalogue of page destinations for the ⌘K palette. Mirrors the
// sidebar's NAV_ITEMS (Sidebar.tsx) including its permission gating, but as
// a pure module: the permission check is injected so this file never imports
// React and stays unit-testable in the node-env Vitest config.
export interface NavCommand {
  to: string;
  label: string;
  icon: string;
  /** Permission required to list this page; "*" restricts to admin wildcard. */
  requires?: string;
}

export const NAV_COMMANDS: NavCommand[] = [
  { to: "/overview", label: "Overview", icon: "dashboard" },
  { to: "/projects", label: "Projects", icon: "folder_managed" },
  { to: "/customers", label: "Customers", icon: "groups" },
  { to: "/daily-review", label: "Daily Review", icon: "edit_note" },
  { to: "/reports", label: "Reports", icon: "analytics" },
  { to: "/executive", label: "Executive", icon: "leaderboard", requires: "report:executive" },
  { to: "/settings", label: "Settings", icon: "settings" },
  { to: "/admin", label: "Admin", icon: "admin_panel_settings", requires: "*" },
];

export function filterNavCommands(
  has: (permission: string) => boolean,
  query: string,
): NavCommand[] {
  const q = query.trim().toLowerCase();
  return NAV_COMMANDS.filter(
    (c) => (!c.requires || has(c.requires)) && (q === "" || c.label.toLowerCase().includes(q)),
  );
}
```

(`requires: "*"` for Admin is equivalent to Sidebar's `adminOnly` check: `hasPermission(user, "*")` is true only when the permissions array contains `"*"`.)

- [ ] **Step 4: Run tests to verify they pass**

Same command as Step 2. Expected: 5 passed. Then `docker compose exec frontend npm run typecheck`.

- [ ] **Step 5: CHANGELOG + stage + draft commit (do NOT commit — user approval required)**

Append under `[Unreleased]` → `### Added`:

```markdown
- Palette page-navigation catalogue: `frontend/src/lib/navCommands.ts` (pure module + tests) mirroring the sidebar's permission-gated destinations for the ⌘K palette.
```

```bash
git add frontend/src/lib/navCommands.ts frontend/src/lib/navCommands.test.ts CHANGELOG.md
```

Drafted message: `feat(search): add permission-gated nav-command catalogue for the palette`

---

### Task 3: Vendor `@reui/autocomplete`

**Files:**
- Create (via CLI): `frontend/src/components/reui/autocomplete.tsx`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Produces (Task 4 consumes): the vendored file's exports — expected per ReUI's published API: `Autocomplete`, `AutocompleteInput`, `AutocompleteContent`, `AutocompleteList`, `AutocompleteItem`, `AutocompleteEmpty` (+ possibly group primitives). **The vendored file is the source of truth** — Task 4 must read its actual exports before writing imports.

- [ ] **Step 1: Vendor the component**

~~`cd frontend && npx shadcn@latest add @reui/autocomplete`~~ **Amendment 2026-07-27 (executed path):** the CLI is unusable for this item — ReUI's `scroll-area` registry URL (`https://reui.io/r/new-york/scroll-area.json`) returns 401, and the CLI's fallback resolves the registryDependency to shadcn's default **Radix** scroll-area, adding `radix-ui` to `package.json` (guardrail violation; first attempt reverted cleanly). Hand-vendor instead: fetch `https://reui.io/r/new-york/autocomplete.json` (verified clean — deps only `@base-ui/react` + `class-variance-authority`, both installed), write its file content to `frontend/src/components/reui/autocomplete.tsx` with a vendor header comment (source URL, date, why hand-vendored), and point its scroll-area import at the existing Base-UI `@/components/ui/scroll-area` with a `// SOLVRO PATCH` marker. No other edits; still zero new dependencies.

- [ ] **Step 2: Verify the vendored file**

```bash
grep -c "radix" frontend/src/components/reui/autocomplete.tsx        # expected: 0
grep -n "@base-ui/react" frontend/src/components/reui/autocomplete.tsx  # expected: ≥1 import
git diff --stat frontend/package.json                                 # expected: empty
docker compose exec frontend npm run typecheck                        # expected: clean
```

If the file imports the `scroll-area` primitive, confirm it resolves to the existing `@/components/ui/scroll-area`. If typecheck fails on a missing icon import, replace with an inline SVG or `lucide-react` icon and mark the line `// SOLVRO PATCH`.

- [ ] **Step 3: CHANGELOG + stage + draft commit (do NOT commit — user approval required)**

Append under `[Unreleased]` → `### Added`:

```markdown
- Vendored ReUI autocomplete (Base-UI-backed) at `frontend/src/components/reui/autocomplete.tsx` for the ⌘K palette — zero new npm dependencies (`@base-ui/react`, `class-variance-authority`, `scroll-area` all pre-existing).
```

```bash
git add frontend/src/components/reui/autocomplete.tsx CHANGELOG.md
```

Drafted message: `feat(search): vendor ReUI autocomplete component`

---

### Task 4: `useSearch` hook + `CommandPalette` + Shell/TopBar wiring

**Files:**
- Modify: `frontend/src/lib/queries.ts` (types after the `TaskWithProject` block ~line 148; key in `queryKeys` ~line 272; hook after `useOverview`)
- Create: `frontend/src/components/CommandPalette.tsx`
- Modify: `frontend/src/components/layout/Shell.tsx` (palette state + ⌘K listener + render)
- Modify: `frontend/src/components/layout/TopBar.tsx` (trigger + mobile icon; lines 82–94 replaced)
- Modify: `frontend/src/components/layout/Sidebar.tsx` (derive nav items from `NAV_COMMANDS`; delete local `NavItem`/`NAV_ITEMS` — scope amendment approved by user 2026-07-27 resolving Task 2 review finding I1: the catalogue must not be a hand-copied second source of truth)
- Modify: `frontend/src/lib/navCommands.ts` (`NAV_COMMANDS` export becomes `readonly NavCommand[]`; absorb Sidebar's Work Logs/Tasks absence comment)
- Modify: `frontend/src/lib/navCommands.test.ts` (rename the route-list test honestly — it pins the catalogue, it does not cross-check `App.tsx`)
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: Task 1's response contract; Task 2's `filterNavCommands(has, query)` + `NavCommand`; Task 3's vendored autocomplete exports; `hasPermission(user, permission)` from `@/lib/auth`; `apiRequest<T>(path, opts)` from `@/lib/api`.
- Produces: `useSearch(q: string)` hook; `SearchResults`/`SearchProjectHit`/`SearchTaskHit`/`SearchCustomerHit` types; `<CommandPalette open onClose />`; `TopBar` gains required prop `onOpenSearch: () => void`.

- [ ] **Step 1: Add types, query key, and hook to `queries.ts`**

Types (after `TaskWithProject`):

```ts
export interface SearchProjectHit {
  id: number;
  name: string;
  status: ProjectStatus;
  customerName: string | null;
}

export interface SearchTaskHit {
  id: number;
  title: string;
  status: TaskStatus;
  projectId: number;
  projectName: string;
}

export interface SearchCustomerHit {
  id: number;
  name: string;
}

export interface SearchResults {
  projects: SearchProjectHit[];
  tasks: SearchTaskHit[];
  customers: SearchCustomerHit[];
}
```

Key (inside `queryKeys`, after `comments`):

```ts
  search: (q: string) => ["search", q] as const,
```

Hook (after `useOverview`):

```ts
export function useSearch(q: string) {
  return useQuery({
    queryKey: queryKeys.search(q),
    queryFn: ({ signal }) =>
      apiRequest<SearchResults>(`/search?q=${encodeURIComponent(q)}`, { signal }),
    enabled: q.trim().length >= 2,
    staleTime: 30_000,
    // Keep the previous page of results rendered while the next keystroke's
    // query is in flight — prevents the list flashing empty on every char.
    placeholderData: (prev: SearchResults | undefined) => prev,
  });
}
```

- [ ] **Step 2: Read the vendored autocomplete's actual exports**

```bash
grep -n "^export" frontend/src/components/reui/autocomplete.tsx
```

Reconcile the imports/JSX in Step 3 against what actually exists (ReUI's published usage: `Autocomplete`, `AutocompleteInput`, `AutocompleteContent`, `AutocompleteEmpty`, `AutocompleteList`, `AutocompleteItem`). If group primitives exist (`AutocompleteGroup`/`AutocompleteGroupLabel` — see free example `c-autocomplete-8`), prefer them over the heading-row divs below and keep the same visible text. If the anchored `AutocompleteContent` popup fights the fixed overlay layout, render the list inline inside the panel using Base UI primitives directly — same semantics, still zero new deps (risk pre-approved in the spec).

- [ ] **Step 3: Create `CommandPalette.tsx`**

```tsx
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import {
  Autocomplete,
  AutocompleteContent,
  AutocompleteEmpty,
  AutocompleteInput,
  AutocompleteItem,
  AutocompleteList,
} from "@/components/reui/autocomplete";
import { hasPermission, useAuth } from "@/lib/auth";
import { filterNavCommands } from "@/lib/navCommands";
import { useSearch } from "@/lib/queries";

interface PaletteItem {
  value: string; // unique: "page:/reports", "project:3", "task:17", "customer:2"
  label: string;
  group: "Pages" | "Projects" | "Tasks" | "Customers";
  to: string;
  hint?: string; // secondary text: customer/project name or status
  icon?: string; // material symbol name (pages only)
}

function useDebounced(value: string, ms: number): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

const GROUP_ORDER: PaletteItem["group"][] = ["Pages", "Projects", "Tasks", "Customers"];

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const debounced = useDebounced(query, 200);
  const { data, isLoading } = useSearch(debounced);

  // Fresh palette every open — stale queries are disorienting on reopen.
  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  // Esc + body scroll lock, same recipe as Modal.tsx.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  const items = useMemo<PaletteItem[]>(() => {
    const pages: PaletteItem[] = filterNavCommands(
      (p) => hasPermission(user, p),
      query,
    ).map((c) => ({
      value: `page:${c.to}`,
      label: c.label,
      group: "Pages",
      to: c.to,
      icon: c.icon,
    }));
    const remote: PaletteItem[] = !data
      ? []
      : [
          ...data.projects.map((p) => ({
            value: `project:${p.id}`,
            label: p.name,
            group: "Projects" as const,
            to: `/projects/${p.id}`,
            hint: p.customerName ?? p.status,
          })),
          ...data.tasks.map((t) => ({
            value: `task:${t.id}`,
            label: t.title,
            group: "Tasks" as const,
            // ProjectDetail.tsx already reads ?task= to open the TaskPanel.
            to: `/projects/${t.projectId}/list?task=${t.id}`,
            hint: t.projectName,
          })),
          ...data.customers.map((c) => ({
            value: `customer:${c.id}`,
            label: c.name,
            group: "Customers" as const,
            to: `/customers/${c.id}`,
          })),
        ];
    return [...pages, ...remote];
  }, [user, query, data]);

  function handleSelect(item: PaletteItem) {
    onClose();
    navigate(item.to);
  }

  if (!open) return null;

  const showEmpty =
    !isLoading && items.length === 0 && debounced.trim().length >= 2;

  return createPortal(
    <div
      className="fixed inset-0 z-100 flex items-stretch justify-center bg-inverse-surface/40 p-0 backdrop-blur-sm md:items-start md:p-4 md:pt-[15vh]"
      onMouseDown={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Global search"
        className="flex max-h-screen w-full flex-col rounded-none border-outline-variant bg-surface-container-lowest font-display shadow-overlay md:max-h-[60vh] md:max-w-xl md:rounded-sm md:border"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <Autocomplete items={items}>
          <div className="flex items-center gap-2 border-b border-outline-variant px-4 py-3">
            <span className="material-symbols-outlined text-base text-on-surface-variant">
              search
            </span>
            <AutocompleteInput
              autoFocus
              value={query}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setQuery(e.target.value)}
              placeholder="Search projects, tasks, customers…"
              className="flex-1 border-none bg-transparent text-[13px] text-on-surface outline-hidden placeholder:text-on-surface-variant"
            />
            <span className="rounded-sm border border-outline-variant bg-surface-container-low px-1.5 py-0.5 font-mono text-[10px] text-on-surface-variant">
              esc
            </span>
          </div>
          <AutocompleteContent>
            {showEmpty && (
              <AutocompleteEmpty className="px-4 py-6 text-center text-[13px] text-on-surface-variant">
                No results for “{debounced}”
              </AutocompleteEmpty>
            )}
            <AutocompleteList className="overflow-y-auto p-1">
              {GROUP_ORDER.map((group) => {
                const groupItems = items.filter((i) => i.group === group);
                if (groupItems.length === 0) return null;
                return (
                  <div key={group}>
                    <div className="px-3 pb-1 pt-2 text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">
                      {group}
                    </div>
                    {groupItems.map((item) => (
                      <AutocompleteItem
                        key={item.value}
                        value={item}
                        onClick={() => handleSelect(item)}
                        className="flex cursor-pointer items-center gap-2 rounded-sm px-3 py-2 text-[13px] text-on-surface data-highlighted:bg-surface-container"
                      >
                        {item.icon && (
                          <span className="material-symbols-outlined text-base text-on-surface-variant">
                            {item.icon}
                          </span>
                        )}
                        <span className="min-w-0 flex-1 truncate">{item.label}</span>
                        {item.hint && (
                          <span className="shrink-0 text-[11px] text-on-surface-variant">
                            {item.hint}
                          </span>
                        )}
                      </AutocompleteItem>
                    ))}
                  </div>
                );
              })}
            </AutocompleteList>
          </AutocompleteContent>
        </Autocomplete>
      </div>
    </div>,
    document.body,
  );
}
```

Wiring notes bound to Step 2's reconciliation: disable the autocomplete's built-in client-side filtering (results are already server-filtered; Base UI exposes a `filter` prop — pass `filter={null}` or the vendored equivalent). Wire Enter-to-select through the component's selection callback (`onValueChange` on `Autocomplete` per Base UI) calling `handleSelect`; the per-item `onClick` covers mouse selection either way.

- [ ] **Step 4: Wire `Shell.tsx`**

```tsx
import { useEffect, useState } from "react";
import { Outlet } from "react-router-dom";
import { CommandPalette } from "@/components/CommandPalette";
import { InstallBanner } from "@/components/InstallBanner";
import { Sidebar } from "./Sidebar";
import { SidebarProvider, useSidebar } from "./SidebarContext";
import { TopBar } from "./TopBar";

function ShellLayout() {
  const { open } = useSidebar();
  const [paletteOpen, setPaletteOpen] = useState(false);

  // Single app-wide ⌘K/Ctrl+K listener. Skips editable targets so typing
  // "k" with modifiers inside inputs/textareas never hijacks focus (spec).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "k") return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      e.preventDefault();
      setPaletteOpen((v) => !v);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const shift = open ? "md:ml-sidebar" : "md:ml-sidebar-collapsed";
  return (
    <div className="flex h-screen w-full flex-col overflow-hidden bg-background text-on-surface">
      <InstallBanner />
      <Sidebar />
      <TopBar onOpenSearch={() => setPaletteOpen(true)} />
      <main
        className={`min-h-0 flex-1 overflow-y-auto overflow-x-hidden bg-background p-4 transition-[margin] duration-200 ease-out md:p-6 ${shift}`}
      >
        <Outlet />
      </main>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  );
}
```

(Keep the existing explanatory comments in the file; only the additions above change. `Shell()` wrapper is untouched.)

- [ ] **Step 5: Wire `TopBar.tsx`**

Signature becomes `export function TopBar({ onOpenSearch }: { onOpenSearch: () => void })`. Replace lines 82–94 (the decorative search `div`) with a button trigger keeping the identical look, plus a mobile icon before the theme toggle:

```tsx
        <button
          type="button"
          onClick={onOpenSearch}
          aria-label="Open search"
          className="hidden min-w-[260px] cursor-text items-center gap-2 rounded-sm bg-surface-container px-3 py-1.5 md:flex"
        >
          <span className="material-symbols-outlined text-base text-on-surface-variant">
            search
          </span>
          <span className="flex-1 text-left text-[13px] text-on-surface-variant">
            Search projects, tasks, customers…
          </span>
          <span className="rounded-sm border border-outline-variant bg-surface-container-low px-1.5 py-0.5 font-mono text-[10px] text-on-surface-variant">
            ⌘K
          </span>
        </button>

        <button
          type="button"
          onClick={onOpenSearch}
          aria-label="Open search"
          className="flex h-8 w-8 items-center justify-center rounded-sm text-on-surface-variant hover:bg-surface-container hover:text-on-surface md:hidden"
        >
          <span className="material-symbols-outlined text-[20px]">search</span>
        </button>
```

- [ ] **Step 5b: Unify Sidebar with the catalogue (scope amendment, user-approved 2026-07-27)**

In `frontend/src/components/layout/Sidebar.tsx`: delete the local `NavItem` interface and `NAV_ITEMS` array (lines 6–27) and derive from the catalogue instead — the render below the filter stays byte-identical (`to`/`label`/`icon` field names already align):

```tsx
import { NAV_COMMANDS } from "@/lib/navCommands";
// …inside Sidebar():
const items = NAV_COMMANDS.filter((i) => !i.requires || hasPermission(user, i.requires));
```

Move the explanatory comment about Work Logs/Tasks being intentionally absent from the sidebar (old `Sidebar.tsx:19-22`) onto `NAV_COMMANDS` in `navCommands.ts` so the knowledge survives the deletion. In `navCommands.ts`, change the export to `export const NAV_COMMANDS: readonly NavCommand[] = [...]` (guards against consumer mutation; `filterNavCommands` still returns a fresh `NavCommand[]`). In `navCommands.test.ts`, rename `"keeps every route in sync with the app's route table"` to `"pins the catalogue's route list"` — with Sidebar now consuming the catalogue, the pin is genuinely load-bearing.

- [ ] **Step 6: Verify**

```bash
docker compose exec frontend npm run typecheck   # expected: clean
docker compose exec frontend npm test            # expected: navCommands + kanban-v2 suites pass
```

Manual: sidebar renders identically (order, labels, icons, Executive/Admin gating) — compare against `develop` if in doubt.

Manual smoke in the dev app (`http://localhost:5173`): ⌘K opens; typing ≥2 chars shows grouped results; Enter and click both navigate; Esc, backdrop, and selection all close; mobile viewport (≤375px) shows the icon button; light + dark themes both render from tokens.

- [ ] **Step 7: CHANGELOG + stage + draft commit (do NOT commit — user approval required)**

Append under `[Unreleased]` → `### Added` and `### Changed`:

```markdown
### Added
- ⌘K command palette (`frontend/src/components/CommandPalette.tsx`): searches projects/tasks/customers via `GET /search` (debounced `useSearch` hook in `queries.ts`) plus permission-gated page commands; task hits deep-link through the existing `?task=` param. Composes the vendored ReUI autocomplete inside a Modal-convention overlay.

### Changed
- `TopBar` search box is now a live palette trigger (was decorative) with a mobile search icon below `md:`; `Shell` hosts the palette and the global ⌘K/Ctrl+K listener.
- `Sidebar` now derives its nav items from the palette's `NAV_COMMANDS` catalogue (`navCommands.ts`) — single source of truth, replacing the hand-copied local `NAV_ITEMS`.
```

```bash
git add frontend/src/lib/queries.ts frontend/src/components/CommandPalette.tsx \
  frontend/src/components/layout/Shell.tsx frontend/src/components/layout/TopBar.tsx CHANGELOG.md
```

Drafted message: `feat(search): wire ⌘K command palette to /search with nav commands`

---

### Task 5: Playwright e2e spec

**Files:**
- Create: `e2e/tests/search.spec.ts`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: `seededProject` worker fixture (`{ token, userId, projectId, customerId, alpha…delta }` — project name is `Gate <stamp>`, unique per worker); `loginViaUi(page)`; `apiBase(testInfo)`. The dev DB is polluted by years of fixture runs (see `seed.ts` comments), so **every assertion targets run-unique strings** — never search for "Alpha".

**Addendum (2026-07-27, mandated by Task 4 review) — four additional assertions, added to the tests below where noted:**
1. **Esc from input focus** closes the palette — press Escape while the palette *input* is focused (the existing Esc test must not rely on backdrop focus). Static analysis says Base UI lets it bubble in `inline` mode; assert the real keyboard path.
2. **Autofocus**: immediately after ⌘K opens the palette, the input has focus (`toBeFocused()`).
3. **No stale rows on reopen (B1 regression)**: search successfully, close the palette, reopen it — assert result rows are absent (auto-retrying `toHaveCount(0)` absorbs the ≤200ms debounce residual) and only the Pages group renders.
4. **Mobile fit**: in the mobile-project test, fill a run-unique query that returns hits, then measure the *dialog's own box* — `dialog.evaluate(el => el.scrollWidth - el.clientWidth) ≤ 1` via `expect.poll`, plus bounding-box x ≥ 0 and bottom ≤ viewport height. *(Corrected 2026-07-27 after Task 5 review finding S1: the originally-prescribed document-level `scrollWidth − clientWidth` recipe from `smoke.spec.ts` is blind to a `fixed inset-0` overlay and could never fail.)*

- [ ] **Step 1: Write the spec**

```ts
import { test, expect, loginViaUi, apiBase } from "../fixtures/test";

// The palette is desktop-first (⌘K + top-bar box are md:-gated); the mobile
// entry point is the TopBar search icon. Desktop assertions skip the mobile
// project and vice versa, mirroring smoke.spec.ts's pattern.

async function createUniqueTask(
  base: string,
  token: string,
  projectId: number,
): Promise<{ id: number; title: string }> {
  const title = `SearchTarget ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const res = await fetch(`${base}/api/projects/${projectId}/tasks`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });
  if (!res.ok) throw new Error(`task seed failed: ${res.status}`);
  const body = (await res.json()) as { id: number };
  return { id: body.id, title };
}

test.describe("global search palette", () => {
  test("⌘K opens the palette and a task hit deep-links into List with the panel param", async ({ page, seededProject }, testInfo) => {
    test.skip(testInfo.project.name === "mobile", "⌘K entry point is desktop-only");
    const target = await createUniqueTask(
      apiBase(testInfo),
      seededProject.token,
      seededProject.projectId,
    );

    await loginViaUi(page);
    await page.goto("/overview", { waitUntil: "networkidle" });
    await page.keyboard.press("ControlOrMeta+k");

    const dialog = page.getByRole("dialog", { name: /global search/i });
    await expect(dialog).toBeVisible();

    await dialog.getByPlaceholder(/search projects/i).fill(target.title);
    const hit = dialog.getByText(target.title, { exact: true });
    await expect(hit).toBeVisible();
    await hit.click();

    await page.waitForURL(
      new RegExp(`/projects/${seededProject.projectId}/list\\?task=${target.id}`),
      { timeout: 10_000 },
    );
  });

  test("a project hit navigates to the project and grouping headers render", async ({ page, seededProject }, testInfo) => {
    test.skip(testInfo.project.name === "mobile", "⌘K entry point is desktop-only");
    // The fixture project's name ("Gate <stamp>") is unique per worker; fetch it.
    const res = await fetch(`${apiBase(testInfo)}/api/projects/${seededProject.projectId}`, {
      headers: { Authorization: `Bearer ${seededProject.token}` },
    });
    const project = (await res.json()) as { name: string };

    await loginViaUi(page);
    await page.goto("/overview", { waitUntil: "networkidle" });
    await page.keyboard.press("ControlOrMeta+k");

    const dialog = page.getByRole("dialog", { name: /global search/i });
    await dialog.getByPlaceholder(/search projects/i).fill(project.name);
    await expect(dialog.getByText("Projects", { exact: true })).toBeVisible();

    await dialog.getByText(project.name, { exact: true }).click();
    await page.waitForURL(new RegExp(`/projects/${seededProject.projectId}(/overview)?$`), {
      timeout: 10_000,
    });
  });

  test("Escape closes the palette", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === "mobile", "⌘K entry point is desktop-only");
    await loginViaUi(page);
    await page.goto("/overview", { waitUntil: "networkidle" });
    await page.keyboard.press("ControlOrMeta+k");

    const dialog = page.getByRole("dialog", { name: /global search/i });
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
  });

  test("mobile: TopBar search icon opens the palette", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "icon entry point is the mobile affordance");
    await loginViaUi(page);
    await page.goto("/overview", { waitUntil: "networkidle" });

    await page.getByRole("button", { name: /open search/i }).click();
    await expect(page.getByRole("dialog", { name: /global search/i })).toBeVisible();
  });
});
```

- [ ] **Step 2: Run the spec**

```bash
cd e2e && npx playwright test tests/search.spec.ts
```

Expected: desktop tests pass on the desktop project, mobile test passes on the mobile project, skips elsewhere. (Known unrelated caveat: `pwa.spec.ts` fails against the dev server — irrelevant here.)

- [ ] **Step 3: CHANGELOG + stage + draft commit (do NOT commit — user approval required)**

Append under `[Unreleased]` → `### Added`:

```markdown
- E2E coverage for the ⌘K palette (`e2e/tests/search.spec.ts`): open/close, run-unique task + project hits, task deep-link `?task=` assertion, mobile icon entry point.
```

```bash
git add e2e/tests/search.spec.ts CHANGELOG.md
```

Drafted message: `test(search): add Playwright coverage for the command palette`

---

### Task 6: Full gates, pipeline close-out, PR draft

**Files:** none created — verification + orchestration only.

- [ ] **Step 1: Run every gate from the spec's Commands section**

```bash
docker compose exec backend npx tsc --noEmit
docker compose exec frontend npm run typecheck
TEST_URL=$(docker compose exec backend printenv DATABASE_URL | tr -d '\r\n' | sed 's|/solvro?|/solvro_test?|') \
  && docker compose exec -e DATABASE_URL="$TEST_URL" backend npm test
docker compose exec frontend npm test
cd e2e && npm test
git diff origin/develop -- '**/package.json'   # expected: empty (zero new deps)
```

All green before proceeding. Any failure routes back to the owning task.

- [ ] **Step 2: Verify spec success criteria**

Walk the spec's Success Criteria 1–7 one by one against the running app and test output; record pass/fail for each in the report to the user.

- [ ] **Step 3: Repo pipeline (orchestrator dispatches)**

Per CLAUDE.md agent flow: `solvro-qa` (gates + standing guardrail greps) → `solvro-reviewer` (frontend-touching diff ⇒ design lens reads DESIGN.md + token spot-checks) → `solvro-docs-keeper` (verify CHANGELOG entries; sync CLAUDE.md Facts: add `search` to the backend routes inventory and correct the "search bar is decorative" reality; file any deferred findings in ISSUES.md).

- [ ] **Step 4: Draft commit(s) and PR for user approval (do NOT execute without it)**

Present to the user: the staged per-task commits (messages drafted in Tasks 1–5, no Claude attribution), and the PR draft targeting `develop`:

```bash
# Only after explicit user approval:
git push -u origin feat/global-search
gh pr create --base develop --title "feat: global search & ⌘K command palette" --body "<drafted body>"
gh pr edit <number> --add-assignee alfi-rajasyah
```

---

## Self-Review (performed at plan time)

- **Spec coverage:** endpoint + validation + visibility (Task 1); nav commands + permission gating (Task 2); vendored autocomplete, zero deps (Task 3); palette UX, ⌘K listener, TopBar trigger, mobile icon, deep-link, tokens (Task 4); e2e incl. mobile (Task 5); gates + success criteria + docs sync (Task 6). Deferred by spec, deliberately absent: pg_trgm index, notes search, recents, prefix ranking.
- **Known uncertainty, contained:** exact vendored autocomplete export/prop names — bounded by Task 4 Step 2 (read the vendored file first; fallback pre-approved in spec). E2E resilience against the polluted dev DB — handled via run-unique strings only.
- **Type consistency:** `SearchResults` field lists in Task 1's response, Task 4's types, and the e2e assertions all match (`customerName`/`projectName` naming verified consistent).
