# Plan: Outline integration (links → Outline in Solvro → Solvro in Outline)

- **Date:** 2026-10-09
- **Status:** approved 2026-10-09 (mockup and §2 decisions). Phase A in progress on `feat/outline-links`; Phases B and C follow, each as its own PR.
- **Research:** `docs/ideas/outline-knowledge-base.md` §10 (link-out decision), §11 (gap research).
- **Mockup (approved look, 2026-10-09):** https://claude.ai/artifact/Vhf62KES65HwWN6qLC2tfj —
  page 1 "Link-only plan" = Phase A, page 2 "Closing the gap" = Phases B (Tier 1) and C (Tier 2).
- **Code comments cite:** `docs/archive/plans/outline-integration.md`.

## 1. Goal

Bring Solvro ↔ Outline as close to Jira ↔ Confluence as Outline allows without
changing Outline's code. Each deployment runs its own self-hosted Outline; Solvro never
bundles it (BSL "Document Service" limit, idea §7.1 / §10).

Out of scope (not possible without a custom Outline build, idea §11.3): create a task from
selected Outline text, native status chips with per-user permissions, Outline searching
Solvro. Also out: comment sync, Outline group/permission sync (needs an Outline admin
token — see D3).

## 2. Decisions

| # | Decision | Proposal | Status |
|---|---|---|---|
| D1 | Scope | Phases A, B, C in that order; each phase = 1 branch = 1 PR into `develop` | **approved 2026-10-09** |
| D2 | Outline identity for reads and writes | Per-user OAuth token only (`User.outlineAccessTokenEnc`), accepted only when Outline's `auth.info` email = the user's Solvro email. Solvro holds **no** Outline API key or admin token. Same shape as the iTop write rule. | **approved 2026-10-09** — prove it on a real self-hosted Outline on the dev VM (`~/outline-dev`, like `~/itop-dev`) before Phase B code: B1 runs there |
| D3 | Group/permission sync | Not built (would need an Outline admin token, conflicts with D2) | proposed |
| D4 | Mentions storage | Solvro stores only Outline doc id, title, URL and the Solvro ids found — never page text | proposed |
| D5 | Mentions visibility | A title shows only when the viewer's own token can open the doc; else a count ("1 more page you cannot open") | proposed |
| D6 | Signed-in embeds | Supported only when Solvro and Outline share a parent domain (browser storage partitioning, idea §11.2). Documented in `docs/CONFIGURATION.md`. Otherwise the guest-link embed. | proposed |
| D7 | Link preview shim (Iframely-compatible endpoint) | Not built: no per-user check, up to 1 day stale, replaces Outline's general web previews | **rejected 2026-10-09** |
| D8 | Framing protection | Phase A adds `frame-ancestors 'self'` to every page (closes the open clickjacking gap); Phase C widens it to the Outline origin for `/embed/*` and `/share/*` only | **approved 2026-10-09** |
| D9 | Docs tab scope | Project **and** customer (same component; customer uses `Customer.outlineUrl`). Mockup shows the project. | proposed |
| D10 | Guardrail | CLAUDE.md Guardrails: "Outline calls never use an application token" (D2) | **added 2026-10-09** (explicit user approval) |

## 3. Phase A — links (`feat/outline-links`)

Mockup page 1. No Outline API.

### Design

- **Schema** (one migration, spine): singleton `OutlineConfig` (id `"default"`, `baseUrl String?`,
  `updatedAt`, `updatedById`; migration inserts the row); `Customer.outlineUrl String?`,
  `Project.outlineUrl String?` (`@map("outline_url")`).
- **URL rule** (shared Zod helper): trimmed; `""` → `null`; `http:`/`https:` only; ≤ 2048 chars.
- **Routes:** `GET|PATCH /admin/settings/outline` (admin; new `routes/outlineAdmin.ts`, mirrors
  `itopAdmin.ts`); `GET /outline/config` (any authed user → `{ baseUrl }`); customer and project
  create/update schemas accept `outlineUrl` (existing permission + visibility checks).
- **Never exposed:** `lib/shareLinks.ts` select stays allow-listed (no `outlineUrl` for guests);
  the Gantt exports (`frontend/src/lib/gantt/exportExcel.ts`, `exportPdf.ts`) unchanged.
- **Frontend:** Admin › Outline tab (status card + Manage dialog); sidebar Workspace item
  "Outline" (`menu_book`, trailing `open_in_new`, new tab) when `baseUrl` set; "Outline" button
  before Copy link in the project header and the customer header when set; "Outline URL" field —
  below Description in `ProjectFormModal`, above Description in `CustomerFormModal`. A project link
  never inherits the customer link.
- **Framing (D8):** `frontend/nginx.conf` sends `Content-Security-Policy: frame-ancestors 'self'`
  and `X-Frame-Options: SAMEORIGIN` on every HTML response. Trap: an `add_header` inside a
  `location` drops the server-level ones — put the shared headers in one include and include it
  in every location that has its own `add_header`.

### Tasks

| # | Task | Area | Depends | Spine |
|---|---|---|---|---|
| A1 | Migration + `OutlineConfig` + URL helper + `outlineAdmin.ts` + `GET /outline/config` + customer/project schemas + tests (URL rule, admin-only PATCH 403, `javascript:` 400, guest payload has no `outlineUrl`) | backend | — | yes (schema, `routes/projects.ts`) |
| A2 | `frame-ancestors` / `X-Frame-Options` on all HTML locations + e2e header check | frontend nginx | — | yes (`nginx.conf`) |
| A3 | Hooks, Admin tab, sidebar item, header buttons, form fields + unit test for the URL rule | frontend | A1 | yes (`lib/queries.ts`) |

Wave 1: A1 ∥ A2 → wave 2: A3.

### Acceptance

- Admin saves a base URL → every user sees the sidebar item; clearing hides it. Non-admin PATCH → 403.
- A customer and a project each save, show, and clear their own link; `javascript:alert(1)` → 400.
- Guest share payload and exports contain no Outline URL.
- `curl -I` on `/`, `/projects/1`, `/share/x` shows `frame-ancestors 'self'`.

## 4. Phase B — Tier 1: Outline inside Solvro (`feat/outline-api`)

Mockup page 2, row "Tier 1". Builds on Phase A's `outlineUrl` fields as the anchor — no extra
mapping UI.

### Design

- **Schema** (migration, spine):
  - `OutlineConfig` + `oauthClientId String?`, `oauthClientSecretEnc String?`,
    `webhookSecretEnc String?`, `lastWebhookAt DateTime?` (sealed with `lib/secretBox.ts`).
  - `User` + `outlineAccessTokenEnc`, `outlineRefreshTokenEnc`, `outlineTokenExpiresAt`,
    `outlineEmail` (all nullable).
  - `OutlineMention` (`id`, `outlineDocId`, `docTitle`, `docUrl`, `projectId?`, `taskId?`,
    `updatedAt`; unique on (`outlineDocId`, `projectId`, `taskId`); cascade on project/task delete).
- **OAuth** (`lib/outline/oauth.ts`, `routes/outline.ts`): `GET /outline/oauth/start` → Outline
  authorize URL with a signed, single-use `state` (+ PKCE if Outline supports it — verify in B1);
  `GET /outline/oauth/callback` → token exchange → `auth.info` → email must equal the Solvro
  user's email, else 400 `outline_identity_mismatch` and nothing stored (D2); `GET /outline/me`;
  `DELETE /outline/me` (disconnect = delete tokens). Refresh on expiry; a failed refresh clears
  the tokens and the UI shows "Connect".
- **Client** (`lib/outline/client.ts`): `POST {baseUrl}/api/<method>` JSON, Bearer = the acting
  user's token only, 10 s timeout, `429` → surface `outline_rate_limited` (no retry storm).
- **Anchor resolver** (`lib/outline/anchor.ts`): parses `outlineUrl` → `{ kind: doc|collection, urlId }`;
  must be on `OutlineConfig.baseUrl`'s host, else the Docs tab says "link points outside your Outline".
- **Endpoints** (all `requireAuth` + `ensureProjectVisible` / `ensureCustomerVisible`; 409
  `outline_not_connected` when the user has no token):
  - `GET /projects/:id/outline/docs`, `GET /customers/:id/outline/docs` → `documents.list` under the
    anchor (`parentDocumentId` or collection filter) → flat list + `parentId` for the tree.
  - `GET /outline/templates` → `templates.list`.
  - `POST /projects/:id/outline/docs` `{ templateId?, title, parentDocumentId?, publish }` →
    `documents.create` → `{ url }`.
  - `GET /outline/search?q=` → `documents.search` (Outline applies the user's permissions);
    separate from `routes/search.ts` so Solvro results never wait on Outline (sub-200 ms rule).
- **Webhook** (`POST /webhook/outline`, `routes/webhook.ts`, mounted before `express.json()`):
  `express.raw` body; verify `Outline-Signature: t=<ts>,s=<hex>` = HMAC-SHA256(secret, `${t}.${body}`),
  timing-safe, reject |now − t| > 5 min; rate-limit windows like the iTop nudge; events
  `documents.publish|update|title_change` → extract Solvro links whose origin = the app origin
  (`CORS_ORIGIN`; add `APP_URL` if that value can hold several origins — settle in B1) with paths
  `/projects/<id>[/<tab>][?task=<id>]` → upsert `OutlineMention` rows, delete rows for links no longer
  present; `documents.delete|archive` → delete rows. Page text is parsed in memory and dropped (D4).
- **Mentions read:** `GET /tasks/:id/outline-mentions` (and project-level) → rows → for each doc,
  `documents.info` with the viewer's token (per-user cache 5 min) → `{ visible: [...], hiddenCount }` (D5).
- **Admin:** Admin › Outline tab gains the "API access" and "Webhook" cards (redirect URL and
  webhook URL with copy buttons; secrets write-only; rotate secret shows it once).

### Tasks

| # | Task | Area | Depends | Spine |
|---|---|---|---|---|
| B1 | Spike: on the dev Outline, register an OAuth app, confirm authorize/token paths, PKCE, token lifetime, `templates.list`, `documents.list` filters for a doc vs a collection `urlId`, webhook signature. Record findings in this plan. | backend | Phase A merged | — |
| B2 | Migration + config/admin routes for OAuth and webhook secrets + tests | backend | B1 | yes (schema) |
| B3 | OAuth flow, client, identity check, disconnect, refresh + tests (mismatch email → nothing stored) | backend | B2 | — |
| B4 | Anchor resolver + docs list + templates + create doc + search endpoints + tests | backend | B3 | — |
| B5 | Webhook + link extraction + mentions endpoints + tests (bad signature 401, old timestamp 401, link removed → row deleted, hidden count) | backend | B2 | — |
| B6 | Frontend: Settings connect card, Admin cards, Docs tab (project + customer), New doc dialog | frontend | B4 | yes (`lib/queries.ts`) |
| B7 | Frontend: ⌘K Outline group (debounced, own query), task panel "Mentioned in Outline" | frontend | B4, B5 | yes (`lib/queries.ts`) |

Waves: B1 → B2 → (B3 ∥ B5) → B4 → (B6 ∥ B7, worktree isolation — both touch `lib/queries.ts`).

### Acceptance

- A TAM connects; a different-email Outline account is refused. Disconnect removes the tokens.
- Docs tab lists only pages the TAM can open in Outline; New doc creates under the TAM's Outline user.
- ⌘K shows Solvro results immediately and Outline results when they arrive.
- Pasting a task link into an Outline page → the task shows it within one webhook round-trip;
  removing the link removes it; a page the viewer cannot open shows only as a count.
- No Outline page text is stored (DB check in the webhook test).

## 5. Phase C — Tier 2: Solvro inside Outline (`feat/outline-embed`)

Mockup page 2, row "Tier 2".

### Design

- **Frame allow-list (D8):** `frontend/nginx.conf` becomes `nginx.conf.template` (the nginx image runs
  `envsubst` on `/etc/nginx/templates/*.template` for defined variables only). New env
  `EMBED_FRAME_ANCESTORS` (e.g. `https://docs.acme.com`) → `/embed/*` and `/share/*` send
  `frame-ancestors 'self' ${EMBED_FRAME_ANCESTORS}`; every other location keeps `'self'`.
  `setup.sh` asks for the Outline address; `docs/CONFIGURATION.md` documents D6.
- **Embed routes** (frontend, outside `Shell`, no sidebar/top bar): `/embed/projects/:id/tasks`
  (`?epic=`), `/embed/projects/:id/status`, `/embed/projects/:id/timeline`. They reuse existing
  read APIs. Signed out → "Sign in to Solvro" link opening top-level in a new tab, then "Reload".
  No editing inside the frame; rows link to Solvro in a new tab.
- **Embed dialog:** project header action "Embed in Outline" → view, filter, audience
  (signed-in / guest link), copy link.
- **Guest embed:** `/share/:token?embed=1` renders the existing guest timeline without page chrome.
  Guest payload unchanged (allow-list stays as is).
### Tasks

| # | Task | Area | Depends | Spine |
|---|---|---|---|---|
| C1 | nginx template + `EMBED_FRAME_ANCESTORS` + Dockerfile + `setup.sh` prompt + `docs/CONFIGURATION.md` + header e2e. Phase A ships one shared `frontend/nginx-frame-protection.conf` (`frame-ancestors 'self'` + `X-Frame-Options`) included per location: C1 adds a `location ^~ /embed/` that rewrites to the shell (like `/share/`), swaps the include in `/embed/` and `/share/` for the widened one, decides whether to drop `X-Frame-Options` there (ignored when `frame-ancestors` is present), and adds `/^\/embed\//` to Workbox `navigateFallbackDenylist` in `frontend/vite.config.ts` — otherwise the service worker serves `/embed/*` from the precached shell with `'self'` and the frame is blocked | ops | Phase B merged | yes (nginx, setup.sh, docker) |
| C2 | Embed routes + embed layout + signed-out state + e2e | frontend | — | — |
| C3 | Embed dialog | frontend | C2 | — |
| C4 | Guest `?embed=1` mode | frontend | — | — |

Waves: (C1 ∥ C2 ∥ C4) → C3.

### Acceptance

- On `solvro.acme.com` + `docs.acme.com`, an Outline page embeds the task table signed in; on a
  different domain it shows the sign-in prompt; the guest embed works on both.
- `/embed/*` and `/share/*` allow only `'self'` + `EMBED_FRAME_ANCESTORS`; all other pages `'self'`.

## 6. Every phase

- Branch off fresh `origin/develop`; PR into `develop`; assign `alfi-rajasyah`; commit and PR only
  after user approval; no AI attribution.
- CHANGELOG entries under `[Unreleased]` per task (orchestrator appends at integration).
- Full `gates.sh` once per wave integration and at phase close; instant opus review for spine tasks;
  one phase review; docs-keeper (triggers: env/compose/`setup.sh`/`nginx.conf` in A and C, CONFIGURATION).
- Phase screenshots into the tracker gallery at phase close.
