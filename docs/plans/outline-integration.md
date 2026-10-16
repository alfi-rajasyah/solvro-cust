# Plan: Outline integration (links → Outline in Solvro → Solvro in Outline)

- **Date:** 2026-10-09
- **Status:** approved 2026-10-09 (mockup and §2 decisions). Phase A shipped (PR #27). Phases B and C ship together as ONE branch and PR, `feat/outline-api-embed` (user decision 2026-10-09); tasks keep their B/C ids and run in waves.
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
| D1 | Scope | Phases A, B, C in that order. A = its own PR (#27); B + C = one combined branch/PR into `develop` | **approved 2026-10-09** (combined B+C: user, 2026-10-09) |
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

## 4. Phase B — Tier 1: Outline inside Solvro (branch `feat/outline-api-embed`, shared with C)

Mockup page 2, row "Tier 1". Builds on Phase A's `outlineUrl` fields as the anchor — no extra
mapping UI.

### B1 spike findings (real Outline 1.10.1, 2026-10-09) — these OVERRIDE the design below where they differ

Evidence: dev instance `~/outline-dev` (README there); spike scripts and redacted evidence were kept outside the repo.

| # | Finding | Consequence for the build |
|---|---|---|
| F1 | OAuth endpoints `/oauth/authorize` (GET → consent page), `/oauth/token`, `/oauth/revoke`; grants `authorization_code`, `refresh_token`; client auth `client_secret_post`. **Token requests must be `application/x-www-form-urlencoded`** (JSON → 400). PKCE S256 supported (optional for confidential clients). `state` required. Codes valid 300 s, single-use. Consent screen shows every time. Cancel → `?error=access_denied` **without `state`**. | Form-encode token/refresh/revoke calls; use PKCE S256 anyway; callback handles a stateless `access_denied` (show "Connection cancelled", store nothing). |
| F2 | Scopes: `read`, `write`, `create`, `<namespace>:read|write|create`, or `/api/ns.method`; `*` not allowed. **`read create` covers every Phase B call** (auth.info, collections/documents info+list+tree, templates.list, search, documents.create); update/delete → 403. | Request `read create` only (least privilege). |
| F3 | Redirect URIs: exact match; **https required unless loopback** (a plain-http non-loopback URI is accepted at registration but fails after Authorize with a misleading `redirect_uri does not match`). | Admin card shows the exact redirect URI to register; `docs/CONFIGURATION.md`: production callback must be https. |
| F4 | Tokens: access `ol_at_…` (1 h, `OAUTH_PROVIDER_ACCESS_TOKEN_LIFETIME`), refresh `ol_rt_…` (30 days sliding). **Refresh rotates BOTH tokens**; old access token dies at once; confidential client must send `client_secret`; replaying a rotated refresh token after 10 s **revokes the whole grant**. `/oauth/revoke` (RFC 7009) kills the pair. Tokens only in the `Authorization` header. **Suspending/deleting the Outline user destroys all grants permanently** (401 / `invalid_grant`). | Store the new pair atomically; **single-flight refresh per user** (row lock or advisory lock); refresh only when needed (expiry − 60 s or on 401); `invalid_grant` → clear tokens → UI shows "Reconnect". Disconnect also calls `/oauth/revoke`. |
| F5 | `auth.info` → `data.user.{id,name,email,role}` with `read` scope. `createdBy` elsewhere has no email. | D2 email check uses `auth.info`; also store `outlineUserId`. |
| F6 | `collections.info` / `documents.info` accept UUID, urlId or full slug. **`documents.list` `collectionId`/`parentDocumentId` accept UUIDs only** (deprecated for a `filters` list) and return direct children only. **`collections.documents` / `documents.documents` return the whole tree in one call** (`{id,url,title,children}`, no page text, accept urlId). List items carry full markdown `text`. Pagination `limit` ≤ 100, `offset`. | Anchor resolver: urlId → `*.info` → UUID; Docs tab tree from `collections.documents` / `documents.documents` (no text → nothing to drop). Never return Outline `text` to the client. |
| F7 | Permissions: hidden collection → absent from list/search; `*.info` → 403 `authorization_error`; unknown → 404 `not_found`. **A trashed doc still returns 200 with `deletedAt` set.** | D5 visibility = 200 **and** `deletedAt == null` **and** `archivedAt == null`; 403/404 = hidden. |
| F8 | `templates.list` (no collection filter) → workspace templates; `documents.create` with `templateId` + `collectionId` or `parentDocumentId` (UUID) + `title` + `publish` → creator = acting user. **`url` is relative** (`/doc/<slug>-<urlId>`). | Prefix every Outline `url` with `OutlineConfig.baseUrl`. |
| F9 | `documents.search` → `data[].{ranking, context, document}`; **`context` contains `<b>…</b>` HTML**; respects permissions; 100/min. | Render the snippet as text with highlights parsed from `<b>` only (never `dangerouslySetInnerHTML` of Outline HTML); return only `{id,title,url,snippet}` to the client. |
| F10 | Webhooks: header `Outline-Signature: t=<ms>,s=<hex>`, HMAC-SHA256(secret, `${t}.${rawBody}`), **`t` in milliseconds**; **no secret configured → no header**; payload `{id, actorId, webhookSubscriptionId, createdAt, event, payload:{id, model}}` with full markdown in `model.text`; **no retries**, 5 s timeout, redirects = errors; **auto-disabled** after ≥ 10 deliveries in 24 h with ≥ 80 % failures (re-enable via `webhookSubscriptions.update`); subscriptions need an admin session/key (OAuth refused). Events seen: `documents.create`, `.publish`, `.update` (+ `.title_change`), `.archive`, `.unarchive`, `.unpublish`, `.delete`; editor typing → one `documents.update` ~4 s later. **Outline refuses to deliver to private IP addresses unless `ALLOWED_PRIVATE_IP_ADDRESSES` is set on Outline.** | Verify with ms timestamps (±5 min); **reject a delivery without the header**; respond < 5 s (verify, extract, upsert — no Outline calls in the request path); Admin shows "last delivery" and warns when it is older than a threshold; the admin registers the webhook in Outline (Solvro holds no admin key); `docs/CONFIGURATION.md` explains `ALLOWED_PRIVATE_IP_ADDRESSES` for same-network deployments. |
| F11 | Rate limits are counted **per client IP as well as per token**: all Solvro users share each route's limit via the backend's IP. Defaults: global 1000/60 s; `documents.list`/`search` 100/min; **`/oauth/token|authorize|revoke` 100/hour**. 429 carries `Retry-After`. | Short per-user caches (docs tree 60 s, mentions visibility 5 min); debounce ⌘K (≥ 300 ms, ≥ 2 chars); never refresh tokens eagerly; 429 → `outline_rate_limited` with retry-after, no retry loop. |
| F12 | Solvro authenticates with a Bearer header (`backend/src/http/auth.ts`), not a cookie, so the browser's navigation to the OAuth callback carries no Solvro identity. | `POST /outline/oauth/start` is an authenticated XHR returning the authorize URL; the callback identifies the user **only** via the signed, single-use, short-lived `state` (user id + PKCE verifier reference). |
| F13 | `CORS_ORIGIN` is a comma list or `*` (`backend/src/app.ts`), so it cannot serve as the app origin. | New env `APP_URL` (the public Solvro origin) for link extraction and the callback/redirect URIs. |

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
| B1 | Spike on the dev Outline — **done 2026-10-09**, findings F1–F13 above (webhook delivery proven from source; live delivery verified end to end on the dev Outline with `ALLOWED_PRIVATE_IP_ADDRESSES` set, 2026-10-09) | backend | Phase A merged | — |
| B2 | Migration + config/admin routes for OAuth and webhook secrets + tests | backend | B1 | yes (schema) |
| B3 | OAuth flow, client, identity check, disconnect, refresh + tests (mismatch email → nothing stored) | backend | B2 | — |
| B4 | Anchor resolver + docs list + templates + create doc + search endpoints + tests | backend | B3 | — |
| B5 | Webhook + link extraction + mentions endpoints + tests (bad signature 401, old timestamp 401, link removed → row deleted, hidden count) | backend | B2 | — |
| B6 | Frontend: Settings connect card, Admin cards, Docs tab (project + customer), New doc dialog | frontend | B4 | yes (`lib/queries.ts`) |
| B7 | Frontend: ⌘K Outline group (debounced, own query), task panel "Mentioned in Outline" | frontend | B4, B5 | yes (`lib/queries.ts`) |

Waves: see the combined B + C wave plan at the end of §5.

### Acceptance

- A TAM connects; a different-email Outline account is refused. Disconnect removes the tokens.
- Docs tab lists only pages the TAM can open in Outline; New doc creates under the TAM's Outline user.
- ⌘K shows Solvro results immediately and Outline results when they arrive.
- Pasting a task link into an Outline page → the task shows it within one webhook round-trip;
  removing the link removes it; a page the viewer cannot open shows only as a count.
- No Outline page text is stored (DB check in the webhook test).

## 5. Phase C — Tier 2: Solvro inside Outline (branch `feat/outline-api-embed`, shared with B)

Mockup page 2, row "Tier 2".

### Design

- **Frame allow-list (D8):** `frontend/nginx.conf` stays a plain file; only the widened snippet
  `frontend/nginx-frame-protection-embed.conf.template` is rendered by the nginx image's envsubst at start, from a
  value validated (fail-closed) by `frontend/nginx-embed-frame-ancestors.envsh`. nginx widens framing only on the
  exact paths the SPA renders (`/embed/projects/<id>/(tasks|status|timeline)`, `/share/<token>`); the SPA never
  navigates out of those prefixes. New env
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
| C1 | nginx template + `EMBED_FRAME_ANCESTORS` + Dockerfile + `setup.sh` prompt + `docs/CONFIGURATION.md` + header e2e. Phase A ships one shared `frontend/nginx-frame-protection.conf` (`frame-ancestors 'self'` + `X-Frame-Options`) included per location: C1 adds a `location ^~ /embed/` that rewrites to the shell (like `/share/`), swaps the include in `/embed/` and `/share/` for the widened one, decides whether to drop `X-Frame-Options` there (ignored when `frame-ancestors` is present), and adds `/^\/embed\//` to Workbox `navigateFallbackDenylist` in `frontend/vite.config.ts` — otherwise the service worker serves `/embed/*` from the precached shell with `'self'` and the frame is blocked | ops | — | yes (nginx, setup.sh, docker) |
| C2 | Embed routes + embed layout + signed-out state + e2e | frontend | — | — |
| C3 | Embed dialog | frontend | C2 | — |
| C4 | Guest `?embed=1` mode | frontend | — | — |

Waves: see below.

### Combined B + C waves (one branch, one PR — user decision 2026-10-09)

| Wave | Tasks (parallel) | Why this grouping |
|---|---|---|
| 1 | B2 (schema + config + `APP_URL`) ∥ C1 (nginx/ops) ∥ C2 (embed routes) | disjoint areas: backend schema, nginx/setup/vite, new frontend routes |
| 2 | B3 (OAuth + client) ∥ B5 (webhook + mentions) ∥ C4 (guest embed) | B3/B5 both need B2's schema; C4 is frontend-only |
| 3 | B4 (anchor + docs + templates + search) ∥ C3 (embed dialog) | B4 needs B3's client |
| 4 | B6 (Settings/Admin/Docs tab/New doc) ∥ B7 (⌘K + mentions panel) | both touch `lib/queries.ts` — strict file ownership, `Edit` only |

Full gates after each wave; instant opus review per spine task; one phase review over the combined diff.

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
