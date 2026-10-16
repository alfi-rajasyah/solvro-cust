# Idea: Outline as Solvro's knowledge base (Confluence replacement)

- **Date:** 2026-09-26
- **Status:** research. 2026-10-07 decision (§10) supersedes §8: **link-out only**, no native wiki.
  Nothing here is approved to build.
- **Question asked:** can Outline (getoutline.com) become the Solvro feature that
  replaces Atlassian Confluence? What are the possibility, the integration, and the
  architecture?

---

## 1. Verdict

**Possible — as a sidecar service Solvro integrates with, not as code merged into Solvro.**

- Outline is a complete wiki (nested docs, collections, realtime co-editing, version
  history, comments, templates, search, public shares, API, webhooks, built-in MCP
  server). It covers the Confluence core that TAMs use.
- Merging Outline's code into Solvro is not viable: different stack (Koa + Sequelize
  + Redis + Yjs vs Express + Prisma), a very large codebase, and a BSL licence.
- Building a native wiki inside Solvro is possible but costs several phases before it
  reaches Outline's current feature level (see §5, option C).

Four decisions block any plan (§7): licence use, identity provider, edition, and the
anchor object (customer vs project).

---

## 2. Outline facts (verified 2026-09-26)

| Topic | Fact |
|---|---|
| Latest release | v1.10.1, 2026-09-09 (v1.10.0 added split view, PDF/web-page/email import) |
| Licence | BSL 1.1. Additional Use Grant: any use **except a "Document Service"** — a commercial offering that lets third parties (not your employees/contractors) create their own teams and documents. Converts to Apache 2.0 on **2030-09-09**. |
| Stack | Node.js + TypeScript, Koa, Sequelize, React + MobX, ProseMirror editor, Yjs realtime |
| Services | Outline app + **PostgreSQL** + **Redis** (required). File storage: **local volume** (now supported) or S3-compatible. |
| Min. hardware | ~1 GB RAM, 2 vCPU, 10 GB disk (community guides) |
| Hosting | Own hostname required; runs behind a reverse proxy with TLS |
| Auth | **No email + password login.** SSO only: Google, Microsoft/Azure AD, Slack, Discord, generic **OIDC**; **SAML = licensed only**. Email magic-link sign-in exists when SMTP is set (for already-provisioned users). |
| API | RPC style: every call is `POST /api/<method>` with JSON. Auth by API key (`ol_api_…`, `Authorization: Bearer`) or **OAuth 2.0 apps** (Settings › Applications) with scopes (`read`, `write`, `documents:read`, …). |
| Key endpoints | `documents.info/list/create/update/search/search_titles/export/import`, `collections.info/list/create/update`, `users.*`, `groups.*`, `shares.*`, `attachments.*`, `templates.list`, `webhookSubscriptions.*` |
| Webhooks | Admin-configured per event. Signed: header `Outline-Signature: t=<ts>,s=<sig>` = HMAC-SHA256 of `${timestamp}.${body}`. Payload `{ id, actorId, webhookSubscriptionId, createdAt, event, payload: { id, model } }`. |
| Rate limits | Yes; `429` + `Retry-After`. Mutations stricter than reads. |
| MCP | Built-in MCP server per workspace (search, read, create, patch, move, comments). v1.10.1 adds WebMCP. |
| Embeds | Outline embeds other services inside its docs. Embedding Outline **inside** another app via iframe is not a supported path (frame headers; auth cookies cross-site). |

### Editions

| Edition | Cost | Adds |
|---|---|---|
| Community, self-hosted (`outlinewiki/outline`) | free | everything in the table above except the row below |
| Business + Enterprise, self-hosted (`outlinewiki/outline-enterprise` + `LICENSE_KEY`) | quote only | **SAML, security audit log, structured data attributes, Confluence importer** |
| Cloud | flat per team size: $10/mo (1–10), $79/mo (11–100), $249/mo (101–200); API + webhooks only from Business ($249) | hosted by Outline |

### Confluence migration

- **Official importer:** licensed/Cloud only. Input = Confluence *Space → Export → HTML* zip.
  Keeps page nesting, attachments, basic formatting. **Loses comments, permissions,
  macros, multi-column layouts.** Fails on very large exports.
- **Community edition path:** convert the HTML/XML export to Markdown with an
  open-source tool (e.g. `OskarsPakers/confluence-to-outline`,
  `matbrgz/confluence-outline-migration`), then use Outline's Markdown/HTML/DOCX
  import or `documents.import`. Same losses, more manual work.
- Every path loses page permissions → rebuild them as Outline collection/group
  permissions after import.

---

## 3. Fit with Solvro today (derived from the code, 2026-09-26)

- **Auth:** Solvro has username/password plus Google Sign-In (`User.googleSub`,
  `AuthConfig.googleClientId`, `googleAllowedDomains`). Password-only Solvro users
  have no identity Outline accepts.
- **Prod stack (`setup.sh`):** `postgres:15-alpine`, `backend`, `frontend` (nginx).
  No Redis, no object storage — Outline adds both a Redis service and a file volume.
- **Documents today:** `ProjectNote` / `CustomerNote` bodies are plain `Text`; no
  rich-text editor dependency exists in `frontend/package.json`.
- **Integration precedent:** iTop — admin singleton config (`ItopConfig`), sealed
  tokens (`lib/secretBox.ts`), per-user token for writes, snapshot + webhook nudge
  (`routes/webhook.ts`), customer-level mapping (`Customer.itopOrgId`). Outline can
  copy this pattern almost 1:1.
- **Guardrail touch points:**
  - *INTERNAL notes never appear in exports* — any "push notes/weekly update to
    Outline" feature is an export surface (Outline has public shares). Only
    `CUSTOMER_FACING` content may go.
  - *iTop write rule* is iTop-specific, but the same principle (writes under the
    acting user's own identity) should apply to Outline — needs a user decision.
  - `setup.sh`, compose, env, `nginx.conf`, `schema.prisma` are all spine-list files.

---

## 4. Target architecture (option A — recommended)

```
                 ┌───────────── shared IdP (Google Workspace or OIDC) ─────────────┐
                 │                                                                 │
   browser ──► solvro.<domain>  (nginx → frontend / backend)      docs.<domain>  (Outline)
                 │                                                     ▲   │
                 │  backend/src/lib/outline/client.ts ── POST /api/* ──┘   │ webhooks
                 │  (per-user OAuth token, sealed)                         ▼
                 │  routes/outline.ts   ◄──────────── POST /webhook/outline (HMAC)
                 ▼
             postgres  (solvro DB)  +  outline DB (same instance, separate db/user)
                                         redis  (Outline only)
                                         outline_data volume (attachments)
```

### 4.1 Deployment

- Add `outline` + `redis` services to the compose file `setup.sh` writes, **opt-in**
  (flag / env), so installs that do not want a wiki are unchanged.
- Reuse the existing Postgres container with a second database and role
  (`outline`) — one backup target, one fewer container.
- Local file storage on a named volume (`outline_data`); S3 stays optional.
- Own hostname (`docs.<domain>`), TLS at the existing proxy.
- Pin the image tag (e.g. `outlinewiki/outline:1.10.1`); upgrades follow Outline's
  release notes because Outline runs its own DB migrations on start.

### 4.2 Identity

| Choice | Works when | Cost |
|---|---|---|
| **Google (shared)** | every TAM already signs in to Solvro with Google | config only |
| OIDC via a small IdP (Pocket ID / Authentik / Keycloak) | mixed or password users | +1 service; Solvro should then also log in via that IdP |
| Solvro as OIDC provider | want Solvro as the single login | security-critical new code in `http/auth.ts` (spine) — not recommended |

### 4.3 Data model (Solvro side, minimal)

- `OutlineConfig` singleton (copy of `ItopConfig`): base URL, OAuth client id,
  sealed client secret, sealed webhook signing secret, enabled flag.
- `User.outlineTokenEnc` (+ refresh token / expiry): per-user OAuth grant, sealed.
- Anchor link: `Customer.outlineCollectionId` (and optionally
  `Project.outlineDocumentId` — a project home doc inside the customer's collection).
- No document content is stored in Solvro. At most a small cache
  (`OutlineDocRef`: id, title, url, updatedAt, collectionId) for listing and search.

### 4.4 Integration features (in value order)

1. **Docs tab** on Customer (and Project): list the linked collection's documents
   (`documents.list`), open in Outline in a new tab. No iframe.
2. **Create from template:** "New doc" → `templates.list` → `documents.create` in
   the linked collection, under the acting user's token.
3. **Federated search:** Solvro's existing `routes/search.ts` adds an Outline group
   via `documents.search` with the user's token (results respect Outline permissions).
4. **Webhook nudge:** `POST /webhook/outline` verifies `Outline-Signature`, then
   refreshes the cache for that document/collection (same shape as the iTop nudge).
5. **Back-links (optional):** paste a Solvro task/project URL in Outline → it renders
   as a link; Solvro shows "Referenced in N docs" via search on its own URL.

### 4.5 Token model

- **Per-user OAuth for reads and writes.** An application API key would read every
  collection and bypass Outline's per-collection permissions — a leak path into
  Solvro views. Per-user tokens keep Outline's permissions authoritative.
- A read-only admin API key is acceptable only for the webhook-driven cache of
  collections that are linked to customers — decide explicitly.

---

## 5. Options compared

| | A. Self-hosted Outline sidecar | B. Outline Cloud | C. Native wiki in Solvro |
|---|---|---|---|
| Wiki features on day 1 | full | full | none — built phase by phase |
| Realtime co-editing | yes | yes | only with Yjs + websocket server (large) |
| Confluence import | licensed edition, or community tools | yes | custom HTML importer to build |
| Data location | your server | Outline's cloud | your server |
| API + webhooks | yes (community) | Business plan ($249/mo) only | n/a |
| Ops cost | +Outline, +Redis, +volume, +hostname | none | none extra |
| Single UI | no — second app, second tab | no | yes |
| Auth fit | needs SSO (Google/OIDC) | needs SSO | existing Solvro auth |
| Licence risk | BSL — see §7.1 | none | none |
| Effort in Solvro | 3–4 phases of integration | same, minus deployment | 6+ phases (tree, editor, versions, attachments, search, permissions, import) |

Fork/merge of Outline's code into Solvro: rejected (stack mismatch, BSL, maintenance).

---

## 6. Rough phase plan (option A) — for discussion only

| Phase | Scope |
|---|---|
| 0 | Decisions in §7; spike: run Outline in the dev compose, sign in with the chosen IdP, import one Confluence space |
| 1 | `setup.sh` opt-in Outline + Redis + volume + DB role; `docs/CONFIGURATION.md` section |
| 2 | `OutlineConfig`, Admin › Outline, per-user OAuth connect (Settings › Outline), client in `lib/outline/` |
| 3 | Customer ↔ collection mapping, Docs tab, create-from-template |
| 4 | Federated search, `POST /webhook/outline`, doc cache |
| 5 | Confluence migration runbook per space (export → import → re-permission → redirect list) |

---

## 7. Open decisions (user-owned)

1. **Licence use.** Internal use by your own TAMs is inside the BSL grant. If Solvro
   is deployed *by you* for multiple outside customers who each get their own
   Outline teams, that can be a "Document Service" — get a licence or confirm with
   Outline first.
2. **Identity provider.** Do all TAMs sign in with Google Workspace? If yes, Google is
   the zero-code path. If no, pick an OIDC IdP.
3. **Edition.** Community (free; manual Confluence migration, no SAML/audit log) or
   licensed Enterprise (official Confluence importer, SAML, audit log; price on quote).
4. **Anchor.** Does a knowledge space hang off the customer (like iTop tickets) or
   off the project?
5. **Write identity.** Apply the iTop rule to Outline (all writes under the acting
   user's own token, no app-token fallback)?
6. **Notes flow.** Should Solvro ever push content (weekly updates, customer-facing
   notes) into Outline? If yes, the INTERNAL-notes guardrail applies.

---

## Sources

- https://github.com/outline/outline — repo, README, releases (v1.10.1, 2026-09-09)
- https://raw.githubusercontent.com/outline/outline/main/LICENSE — BSL 1.1 grant, change date
- https://www.getoutline.com/developers — API, OAuth, scopes, webhooks endpoints
- https://docs.getoutline.com/s/guide/doc/webhooks-gB7HYhS6yq — webhook payload + signature
- https://docs.getoutline.com/s/hosting/doc/authentication-7ViKRmRY5o — no email+password auth
- https://docs.getoutline.com/s/hosting/doc/business-enterprise-rv0715NxO3 — licensed-only features
- https://docs.getoutline.com/s/guide/doc/confluence-import-UGCiYLYgBd — Confluence importer scope
- https://www.getoutline.com/pricing — cloud pricing
- https://www.getoutline.com/changelog/mcp — built-in MCP server
- https://ossalt.com/guides/self-hosting-guide-outline-2026 — local storage, hardware, OIDC IdPs
- https://github.com/OskarsPakers/confluence-to-outline — community migration tool

---

## 8. User answers (2026-09-26) and what they change

| # | Answer | Consequence |
|---|---|---|
| 1 | Solvro for customers will use Google Workspace OAuth | Identity is solved for any option. |
| 2 | Previous client used Confluence; the wiki must be **a Solvro feature** | Rules out a second app. Confluence migration becomes a Solvro feature too. |
| 3 | Anchor = **project and customer** | Two space types: a customer space and a project space. |
| 4 | Writes under the user's own identity: yes. Confluence is a **collaborative space** | Realtime co-editing, comments, and page history are in scope. |
| 5 | Solvro is offered **to outside customers** | Bundling Outline makes Solvro a likely BSL "Document Service" — **blocked** without a commercial licence from Outline. Outline's code (editor included) cannot be copied either. |

**Revised recommendation: option C — a native "Spaces" feature in Solvro,** built on
permissively licensed parts only. Outline stays a reference for the UX, not a dependency.

### 8.1 Licence-safe building blocks

| Part | Licence | Note |
|---|---|---|
| ProseMirror | MIT | editor engine (same as Outline and Confluence's ADF) |
| Tiptap core + `@tiptap/extension-collaboration` | MIT | editor toolkit on ProseMirror. **Tiptap Pro** (comments, version history, conversion) is paid — build those in Solvro instead |
| Yjs | MIT | CRDT for realtime co-editing |
| Hocuspocus (`@hocuspocus/server`) | MIT | Yjs websocket server; no Redis needed for one backend instance |
| Excluded | — | Outline (BSL), Docmost (AGPL-3.0: network-use copyleft conflicts with a closed commercial product), BlockNote XL packages (GPL/commercial) |

These are new dependencies — not on the guardrail's banned list, but each needs user
approval. Page-tree drag reorder uses the sanctioned dnd-kit packages only.

### 8.2 Architecture sketch

```
frontend  /customers/:id/space, /projects/:id/space
  page tree (dnd-kit)  ·  Tiptap editor + Yjs  ·  comments  ·  history
      │ REST (pages CRUD, tree, search)       │ websocket /collab (Yjs sync)
      ▼                                        ▼
backend  routes/spaces.ts                 Hocuspocus attached to the Express server
      │   auth = Solvro session; access = projectVisibilityFilter / customer TAM rules
      ▼
postgres
  Space        (id, kind CUSTOMER|PROJECT, customerId?, projectId?)
  Page         (id, spaceId, parentId, position, title, ydoc bytea, contentJson,
                plainText + tsvector for search, visibility INTERNAL default)
  PageVersion  (pageId, authorId, snapshot, createdAt)   — named/periodic snapshots
  PageComment  (pageId, authorId, anchor, body, resolvedAt)
  Attachment   (pageId, key, mime, size) → file volume (Solvro has no file store yet)
```

- Every Yjs update comes through an authenticated websocket, so each edit and
  version carries the acting user — this satisfies answer 4 by construction.
- Search: Postgres full-text on `Page.plainText`, joined into `routes/search.ts`.
- `nginx.conf` needs a websocket upgrade route (spine file).
- Exports (PDF/Markdown) and any public share obey the INTERNAL-by-default rule,
  the same way `ProjectNote.visibility` does.

### 8.3 Confluence migration as a Solvro feature

- **Confluence Cloud:** REST API v2 (`/wiki/api/v2/spaces/{id}/pages`) returns
  `parentId` + `position` (the tree) and `body-format=atlas_doc_format` (ADF). ADF
  is ProseMirror-shaped JSON, so ADF → Tiptap JSON is a structural node mapping.
  Attachments and footer/inline comments are also readable via the API.
- **Confluence Data Center / Server:** REST v1 or the space HTML/XML export;
  content is XHTML "storage format" → parse to ProseMirror via Tiptap's HTML parser.
- Macros (Jira issue lists, page trees, panels…) need a mapping table; unknown macros
  become a "not imported" placeholder block with the original name.
- Confluence page permissions do not map 1:1; imported pages take the permissions
  of the Solvro space they land in.

### 8.4 Still open

1. Confluence **Cloud or Data Center/Server** at the client? (decides the importer)
2. Realtime co-editing in the **first** release, or page locking first and co-editing later?
3. Approval for new deps: Tiptap core, Yjs, Hocuspocus.
4. Attachment storage: local volume in `setup.sh`, or S3-compatible?
5. Can customer contacts (non-Solvro users) ever read a space, or TAM-internal only?

---

## 9. Can Solvro fork Outline? (checked 2026-09-26)

Licence text, per version (BSL 1.1): each version turns Apache 2.0 on its Change Date
**or on the fourth anniversary of that version's first public release, whichever
comes first.** This is a reading of the licence text, not legal advice.

| Fork base | Licence today | Usable in a product sold to outside customers? |
|---|---|---|
| Current `main` / v1.10.1 | BSL, Change Date 2030-09-09 | **No** — "Document Service" restriction. Only with a commercial/OEM licence from Outline. |
| v0.72.0 (Licensed Work 0.71.0) | BSL, Change Date 2027-08-18 | No, until 2027 |
| **v0.66.1** (released 2022-09-21) | **Apache 2.0** since 2026-09-21 (4-year clause) | **Yes** — keep LICENSE/NOTICE, remove the "Outline" name and logo (Apache 2.0 grants no trademark) |
| Any later version | converts 4 years after its release | You stay ≥ 4 years behind upstream forever |

### v0.66.1 as a fork base

- Stack: Node `>= 14 <=16` (both end-of-life), React 17, Koa 2, Sequelize 6, ioredis 4,
  `@hocuspocus/server` 1.0 **alpha**, Yjs 13, ProseMirror.
- Has realtime co-editing, nested docs, collections, comments are minimal/absent,
  S3 **required** (no local storage), SSO only.
- Missing vs today: 4 years of features (local storage, OAuth apps, MCP, imports,
  split view, …) and 4 years of **security fixes**.
- Still a separate app (own DB, Redis, auth, UI) — not "a Solvro feature" without
  deep rework.

### Ways to use a fork

1. **Whole-app fork of v0.66.1**, rebranded, run beside Solvro — legal, but a second
   product to upgrade (Node 16 → 22, deps) and secure; no upstream fixes can be merged
   (newer code is BSL).
2. **Harvest parts of v0.66.1 into native Solvro Spaces** — e.g. the ProseMirror editor
   schema, nodes, and markdown serializer from `shared/editor`, with Apache notices kept.
   Head start for §8, same Solvro stack.
3. **Buy a commercial licence** from Outline for the current version — the only way to
   ship today's Outline to outside customers.

---

## 10. User decision (2026-10-07) — link-out only

- **Decision:** the wiki is **not** a native Solvro feature. Solvro shows a link that
  opens the self-hosted Outline in a new tab. This supersedes §8 (option C) and §8.4.
- **Consequences:**
  - No API client, no tokens, no webhooks, no new editor dependencies.
  - Solvro never bundles Outline: no Outline/Redis service in `setup.sh`. Each
    deployment runs its own Outline, so Solvro is not a BSL "Document Service" (§7.1 —
    a reading of the licence text, not legal advice).
  - Solvro stores only URLs; no document content enters Solvro, so the
    INTERNAL-notes export guardrail is not touched.
- **Settled 2026-10-09 (was open):** where the link lives — one global sidebar link (admin-set base URL),
  a per-customer / per-project URL field, or both.

---

## 11. Closing the gap to Jira ↔ Confluence (researched 2026-10-07)

Question: the §10 link-out is far from the Jira–Confluence integration. What can close
the gap, and what cannot? Verified against Outline `main` source (v1.10.1 era).

### 11.1 Outline extension points (facts)

| Extension point | Fact | Source |
|---|---|---|
| Generic iframe embed | The last embed descriptor (`id: "embed"`) matches **any** `https?://` URL and renders it in an iframe. | `shared/editor/embeds/index.tsx` |
| Link unfurl (hover preview) | `urls.unfurl` tries public shares → mentions → internal docs → `Hook.UnfurlProvider` plugins. Plugins get the acting user; external results are cached (1 h default). | `server/routes/api/urls/urls.ts` |
| Iframely provider | Enabled when `IFRAMELY_URL` is a non-default host (no key needed). Request: `GET ${IFRAMELY_URL}/{type}?url=…&api_key=…`. **No user identity is sent.** Cache: **1 day**. Response: `meta.title/description/site`, `links.thumbnail/icon`. | `plugins/iframely/server/{index,iframely}.ts` |
| Rich in-app integrations (GitHub, Linear, GitLab issue chips) | Built as server plugins inside Outline's code. No runtime plugin loading — a new one means a custom Outline build. | `plugins/` |
| Webhooks | Admin-created. Events include `documents.create/publish/update/delete/move/title_change`, `revisions.create`, `comments.*`, `collections.*`, `groups.*`. Document payload is presented with `includeText: true` — **the full markdown arrives in the webhook**. | `plugins/webhooks/server/tasks/DeliverWebhookTask.ts` |
| API | `documents.list` (`parentDocumentId`, `backlinkDocumentId`, `filters`), `documents.search`, `documents.create` (`templateId`, `collectionId`, `parentDocumentId`, `publish`), `comments.create`, `groups.create/add_user`, `collections.add_group`. OAuth 2.0 apps with scopes. | `server/routes/api/documents/schema.ts`, developers page |
| Client-side extensions (toolbar buttons, slash commands, text-selection actions) | None. Editor UI changes need a fork. | repo structure |

### 11.2 Solvro facts that decide feasibility

- Session token lives in `localStorage` (`frontend/src/lib/api.ts`). Browsers partition
  iframe storage by top-level **site**: a Solvro iframe inside Outline is signed in only
  when both share a registrable domain (`solvro.acme.com` + `docs.acme.com`). On
  different domains the iframe shows the login screen, and Google sign-in refuses to run
  framed.
- (Fixed in Outline Phase A, 2026-10-09 — kept as the finding that motivated it.) The bundled `frontend/nginx.conf` set **no** `X-Frame-Options` / `frame-ancestors`, so
  any site can frame Solvro today (clickjacking exposure). helmet only covers API
  responses. Any embed work must add `frame-ancestors 'self' <outline origin>`, which
  also closes this gap.
- Guest share links (`routes/publicShare.ts`) already give a read-only, token-scoped
  project timeline that needs no session.

### 11.3 Feature map

| Jira ↔ Confluence feature | Solvro ↔ Outline | How | Limits |
|---|---|---|---|
| Link project ↔ space | **Yes** | §10 links | — |
| Space page tree inside Jira project | **Yes** | `documents.list` under the linked collection/doc, per-user OAuth token | Read-only list; open in Outline |
| Create page from template (e.g. kickoff, meeting notes) | **Yes** | `documents.create` + `templateId`, per-user token | — |
| Cross-app search | **One way** | Solvro ⌘K adds `documents.search` (per-user token → Outline permissions apply) | Outline cannot search Solvro |
| "Mentioned in" back-links on issues | **Yes** | Webhook `documents.update/publish` carries markdown → Solvro extracts its own task/project URLs → stores doc id + title | Titles shown to Solvro users who may lack access in Outline → show only docs the viewer can open (check with their token) or show a count |
| Live issue table / roadmap inside a page (Jira macro) | **Yes, with conditions** | Outline generic embed of a new compact Solvro embed view (task list / status / Gantt strip) | Signed-in only on a shared parent domain; else use a guest share link (read-only, public token). Needs `frame-ancestors` |
| Smart link with status chip | **Partial** | Solvro answers as the `IFRAMELY_URL` provider for its own URLs (title, status, due date) and forwards or rejects others | No user identity → no per-user permission check; up to 1 day stale; replaces general web previews unless Solvro proxies them |
| Create issue from selected page text | **No** (without fork) | Outline has no client extension point | Workaround: paste the Outline URL into a Solvro task's source field |
| Shared permissions | **Partial** | Sync Solvro project members → an Outline group per project (`groups.*`, `collections.add_group`) | Needs an Outline admin token — conflicts with the "writes under the user's own identity" rule (§8 answer 4) → user decision |
| Single sign-on | **Yes (already)** | Both use the same Google Workspace account | Two sign-ins, same account; a shared session is not possible |
| Comments sync | **No value** | `comments.create` exists, but mirroring threads duplicates both apps | — |
| Rich native chips like GitHub/Linear in Outline | **Only with a custom Outline build** | Write a Solvro plugin (`Hook.UnfurlProvider`) and ship a patched image | BSL allows modification, but every Outline upgrade means a rebuild; internal plugin API is not stable — not recommended |

### 11.4 What the gap costs

- **Tier 1 — Solvro side only (Outline API + webhook):** docs list, create-from-template,
  ⌘K search, back-links. Needs `OutlineConfig` (base URL, OAuth client, webhook secret),
  per-user OAuth connect, `POST /webhook/outline`. Pattern = the iTop integration.
- **Tier 2 — Solvro inside Outline:** embed view + `frame-ancestors`; optional Iframely
  shim for previews. Deployment rule: Outline and Solvro on one parent domain.
- **Out of reach without a fork:** create-task-from-selection, native status chips with
  per-user permissions, Outline searching Solvro.

---

## 12. Plan

2026-10-09: the user approved the mockup (links + Tier 1 + Tier 2). Plan:
`docs/plans/outline-integration.md` (Phases A, B, C).
