# Solvro — Configuration Reference

This document is the single-page reference for **how Solvro is configured** across local development and production deployment. It comes in two layers:

- [Part 1 — High-level overview](#part-1--high-level-overview): the mental model in one page.
- [Part 2 — Detailed reference](#part-2--detailed-reference): every variable, port, file, and volume — what it is, where it's read, what happens if it's wrong.

For *what changed and why*, see [CHANGELOG.md](CHANGELOG.md). For *coding conventions*, see [CLAUDE.md](CLAUDE.md).

> This file is tracked and maintained by the `solvro-docs-keeper` agent. It's synced whenever a diff touches `backend/src/env.ts`, `docker-compose.yml`, `setup.sh`, `frontend/nginx.conf`, or `frontend/vite.config.ts`.

---

## Part 1 — High-level overview

### The three deployment shapes

Solvro has **three** ways to run, and each uses a different combination of the same building blocks:

| Shape | What it is | Compose file | Ports exposed to host | When to use |
|---|---|---|---|---|
| **Native dev** | Postgres in Docker, backend + frontend run with `npm run dev` on your laptop | `docker-compose.yml` (only `postgres` service started) | 5432 (pg), 3000 (backend, native), 5173 (vite, native) | Day-to-day coding |
| **Dockerised dev** | Everything in Docker, with hot-reload bind mounts | `docker-compose.yml` (full stack — `postgres` + `backend` + `frontend`) | 5432, 3000, 5173 | When you want a clean, host-agnostic dev environment |
| **Production** | Prebuilt GHCR images; nginx serves the frontend and reverse-proxies `/api/*`, but the backend is *also* published directly to the host | `~/solvro/docker-compose.yml` written by [setup.sh](setup.sh) on the server (not committed) | `FRONTEND_PORT` (default 80) + `BACKEND_PORT` (default 3000), both bound to `BIND_ADDR` (default `127.0.0.1`, loopback-only); Postgres optional via `POSTGRES_PORT` | The deployment host |

The same env vars drive all three; the difference is *which* compose file is running and *whether* the backend/frontend are containerised or native.

### Three tiers, one network

```
┌─────────────────────────┐    ┌─────────────────────────┐    ┌─────────────────────────┐
│  Frontend               │    │  Backend                │    │  Database               │
│  (Vite dev OR nginx)    │───▶│  Express + Prisma       │───▶│  PostgreSQL 15-alpine   │
│  port 5173 dev / 80 prod│    │  port 3000              │    │  port 5432              │
│  proxies /api/* ──────────────▶ strips /api prefix     │    │  volume: solvro_pgdata  │
└─────────────────────────┘    └─────────────────────────┘    └─────────────────────────┘
```

The frontend **never** calls the backend directly. It always calls **same-origin** `/api/*`, which is then reverse-proxied — by Vite's dev server in dev, or by nginx in prod. This is what makes the same frontend bundle work behind Cloudflare Tunnel, a TLS terminator, or a k8s ingress without rebuilding.

> The diagram's "port 5173 dev / 80 prod" is the *default* — production ports are configurable (`FRONTEND_PORT` / `BACKEND_PORT` / `BIND_ADDR`, see [2.13](#213--production-deployment-via-setupsh)), and the backend port is published to the host in both dev and prod, not internal-only.

### Configuration sources, in priority order

When the backend reads a value, it looks here in this order (last wins):

1. **`backend/.env`** — loaded by `dotenv/config` at the top of [backend/src/env.ts](backend/src/env.ts). Used by **native dev** only.
2. **`process.env`** — set by docker-compose's `environment:` block when running in Docker. Used by **dockerised dev** and **prod**.
3. **Zod schema defaults** in [backend/src/env.ts](backend/src/env.ts) — applied if the variable is missing entirely.

A missing or invalid env var **crashes the process at startup** with a printed Zod error. There is no silent fallback for required values (`DATABASE_URL`, `JWT_SECRET`, `SECRETS_KEY`).

### Frontend: no env vars in the bundle

The compiled bundle has **no runtime env vars**. It uses the literal string `/api` as its API base and inherits the origin from `window.location`. The only build-time / dev-time variable is `VITE_API_PROXY_TARGET` — which only matters if you run Vite *inside* a container and need to point its dev proxy at `http://backend:3000` instead of `http://localhost:3000`.

The one runtime variable on the frontend side belongs to the **nginx container**, not the bundle: `EMBED_FRAME_ANCESTORS` (the Outline address allowed to frame a few Solvro pages — see [2.2](#22--frontend-environment-variables)). It only changes response headers; it is empty (embedding off) by default.

### Secrets discipline

- `JWT_SECRET` must be at least 32 chars, generated with `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`.
- **Rotate `JWT_SECRET` once after upgrading to the release that redacts request logs.** Earlier releases wrote every signed-in request's bearer token into the backend logs, so existing log files can hold tokens that stay valid until they expire. For a `setup.sh` install: put a new value (`openssl rand -hex 48`) in `~/solvro/.env`, run `docker compose up -d backend` in `~/solvro`, and everyone signs in again once. Rotating invalidates every issued token; `SECRETS_KEY` is separate and must not be changed. The default in `.env.example` is **a placeholder that will fail Zod validation** — this is intentional.
- `SECRETS_KEY` must be a base64 string decoding to exactly 32 bytes, generated with `openssl rand -base64 32`. It's the AES-256-GCM key for secrets at rest (integration tokens — see [2.16](#216--itop-integration) and [2.17](#217--outline-integration)); rotating it invalidates every stored token, which must be re-entered.
- `POSTGRES_PASSWORD` defaults to `solvro_dev` for local dev. **Rotate before any deployment.**
- `.env` files are `.gitignored`; only `.env.example` is committed.
- The dev-stack `docker-compose.yml` ships a fixed `JWT_SECRET=solvro-dev-jwt-secret-not-for-production-32-chars-minimum-here` and a fixed dev-only `SECRETS_KEY` so the container starts without an `.env` next to it. **Never use either outside your laptop.**

---

## Part 2 — Detailed reference

### 2.1 — Backend environment variables

Defined and validated in [backend/src/env.ts](backend/src/env.ts) (Zod). All other code imports `env` from `./env.js` rather than reading `process.env` directly.

| Variable | Required? | Default | Validation | Purpose / failure mode |
|---|---|---|---|---|
| `NODE_ENV` | no | `development` | enum: `development` \| `production` \| `test` | Toggles dev-only behavior (e.g. pino-pretty logs, stack-trace exposure). |
| `PORT` | no | `3000` | positive int (coerced) | The HTTP port `index.ts` binds to. Inside Docker the container always listens on 3000 regardless. |
| `DATABASE_URL` | **yes** | none | must be a URL | Prisma connection string. Crashes on startup if unset/invalid. |
| `JWT_SECRET` | **yes** | none | string, **min 32 chars** | HMAC key for issued tokens. Anything shorter is rejected by Zod. **Rotate before deploy.** |
| `JWT_EXPIRES_IN` | no | `8h` | string (passed to `jsonwebtoken`) | Token lifetime. Accepts the `jsonwebtoken` shorthand (`60`, `"2 days"`, `"10h"`, `"7d"`). |
| `SECRETS_KEY` | **yes** | none | base64 string decoding to **exactly 32 bytes** | AES-256-GCM key for secrets at rest (`backend/src/lib/secretBox.ts`) — the iTop application and per-TAM tokens, and the Outline OAuth client secret, webhook secret and per-user Outline tokens. Generate with `openssl rand -base64 32`. Crashes on startup if unset or the wrong length. **Rotating it invalidates every stored token** — they must be re-entered after a rotation. |
| `CORS_ORIGIN` | no | `http://localhost:5173` | string | Comma-separated origin allowlist. The literal value `*` (after trim) enables `cors({ origin: true })`. |
| `APP_URL` | no (set it in production) | `http://localhost:5173` outside production; **unset in production** | a bare `http(s)` origin — `scheme://host[:port]`, no path, query string, fragment or login; anything else crashes startup with a Zod error | The public address users reach Solvro on (e.g. `https://solvro.acme.com`). The [Outline integration](#217--outline-integration) builds its URLs from it: the OAuth redirect URI `${APP_URL}/api/outline/oauth/callback` and the webhook URL `${APP_URL}/api/webhook/outline` (both shown in **Admin > Outline**), and it recognises Solvro links in Outline pages against it. `CORS_ORIGIN` cannot serve for this (it may be a list or `*`). **In production, unset** → Outline sign-in and mentions answer `409 outline_app_url_unset` and the backend logs a boot WARN (nothing else is affected, no crash). **`http` on a non-loopback host** → boot WARN plus a warning in Admin > Outline: Outline only accepts `https` redirect URIs (loopback excepted), so sign-in fails after Authorize until `APP_URL` is `https`. `setup.sh` asks for it on a fresh install and saves it; on an update it defaults it if missing — see [2.13](#213--production-deployment-via-setupsh). |
| `LOG_LEVEL` | no | `info` | enum: `fatal` \| `error` \| `warn` \| `info` \| `debug` \| `trace` | Pino level threshold. |
| `TRUST_PROXY` | no | `1` | hop count `0`-`10`, **or** a comma-separated list of `loopback` / `linklocal` / `uniquelocal` and IPv4/IPv6 addresses or CIDR subnets (e.g. `loopback, uniquelocal`); parsed by [backend/src/http/trustProxy.ts](backend/src/http/trustProxy.ts). **`true` is rejected**, as is anything else unparseable — the backend crashes at startup with a Zod error. | Which `X-Forwarded-For` hops Express believes when it works out the client address (`req.ip`; `app.set("trust proxy", …)` in [backend/src/app.ts](backend/src/app.ts)). Today its only consumer is the per-IP rate limit on the public guest-link API (IPv6 clients are grouped by /56, IPv4 per address). Too few hops puts every visitor in the proxy's bucket; too many lets a client spoof its address (the reason bare `true` is refused). `1` = nginx only (the default, right for the prod stack and the dev stack). With a tunnel or CDN (e.g. cloudflared) in front of nginx, prefer the subnet form `loopback, uniquelocal`: it trusts only proxies on loopback/private addresses, so a client that reaches a directly published `BACKEND_PORT` cannot spoof its address with a forged `X-Forwarded-For` — which a hop count allows. `2` is the simple alternative, with that caveat. For `setup.sh` deploys, set it in `~/solvro/.env` — see [2.13](#213--production-deployment-via-setupsh). |
| `ITOP_SYNC_DISABLED` | no | `false` | enum: `true` \| `false` | Kill switch for the in-process iTop sync scheduler (`backend/src/lib/itop/scheduler.ts`) — set `true` to turn the background sync off (e.g. a dev stack with no iTop admin config yet, or a maintenance window). Default off means the sync runs whenever iTop is configured. |

> Looking for Google OAuth config (Client ID, allowed domains)? It's **not** an env var — it's admin-managed in the database. See [2.9](#29--auth--rbac-configuration).

#### Database URL format

```
postgresql://<user>:<password>@<host>:<port>/<db>?schema=public
```

- **Native dev** → `postgresql://solvro:solvro_dev@localhost:5432/solvro?schema=public`
- **Inside Docker** → `postgresql://solvro:solvro_dev@postgres:5432/solvro?schema=public` (uses the compose service name `postgres`, not `localhost`)

The `?schema=public` query param is required by Prisma — if you drop it, migrations and queries silently target the user's default schema.

### 2.2 — Frontend environment variables

| Variable | Where it's read | Default | Purpose |
|---|---|---|---|
| `VITE_API_PROXY_TARGET` | [frontend/vite.config.ts](frontend/vite.config.ts) `server.proxy["/api"].target` | `http://localhost:3000` | Where the **Vite dev server** forwards `/api/*` requests. Only used in dev. Set to `http://backend:3000` when Vite runs *inside* the docker dev stack. |

The runtime bundle has no `VITE_*` vars baked in. **If you find yourself adding one, reconsider — the `/api` reverse-proxy pattern is what keeps the bundle environment-agnostic.**

One variable is read by the **production frontend container** (the nginx image) rather than the bundle:

| Variable | Where it's read | Default | Purpose |
|---|---|---|---|
| `EMBED_FRAME_ANCESTORS` | `/docker-entrypoint.d/15-embed-frame-ancestors.envsh` ([frontend/nginx-embed-frame-ancestors.envsh](frontend/nginx-embed-frame-ancestors.envsh)) at container start | empty (embedding off) | Space- or comma-separated `http(s)` origins (`scheme://host[:port]`, no path, wildcard or other characters; one trailing `/` tolerated), e.g. `https://docs.acme.com`: the Outline address(es) allowed to put Solvro pages in an iframe. See below. |

**What it widens.** With it set, `Content-Security-Policy: frame-ancestors 'self' <origins>` replaces the strict `frame-ancestors 'self'` on exactly these pages and no others: `/embed/projects/<numeric id>/tasks`, `/embed/projects/<numeric id>/status`, `/embed/projects/<numeric id>/timeline` (the signed-in embeds) and `/share/<token>` (the guest link, also used by the guest embed, `?embed=1`). A trailing `/` and a query string are allowed. Every other page, asset and `/sw.js` keeps `'self'`. While at least one origin is set, `X-Frame-Options` is dropped on those pages (it cannot express an allow-list, and current browsers ignore it when `frame-ancestors` is present); with embedding off it stays (`SAMEORIGIN`).

**Decided on the raw request URI.** nginx matches locations on the decoded, merged-slash path, but the browser keeps the URI as sent, so `/embed%2Fprojects%2F1%2Ftasks` or `//embed/projects/1/tasks` can reach a widened *location* while no SPA route matches the raw path (whose catch-all would then load the whole app inside the allowed frame). The widening is therefore decided by two `map $request_uri` blocks in [frontend/nginx-frame-protection-embed-map.conf.template](frontend/nginx-frame-protection-embed-map.conf.template) (rendered at container start into `/etc/nginx/snippets/frame-protection-embed-map.conf` and included at `http` level from [frontend/nginx.conf](frontend/nginx.conf)): the values are widened only when the **raw** request URI is exactly `/embed/projects/<numeric id>/(tasks|status|timeline)` or `/share/<token>` (a query string and one trailing slash allowed). Percent-encoded separators, doubled slashes and anything else stay strict, even if they reach a widened location. `merge_slashes` is left at nginx's default (on), so doubled slashes are merged before location matching.

**Fail closed.** The `.envsh` hook validates the value and exports the result as `EMBED_FRAME_ANCESTORS_SAFE`, the only variable the rendered nginx snippet reads. Unset, empty, longer than 2000 characters, or **any** entry that is not a plain `http(s)` origin (`*`, `;`, quotes, paths, `data:`, …) disables embedding entirely — the pages keep `'self'` + `X-Frame-Options: SAMEORIGIN` and the container logs why on stderr (`15-embed-frame-ancestors: ERROR: …`); it never fails to start. [ci/check-frame-ancestors.sh](ci/check-frame-ancestors.sh) asserts this against the built image (every unsafe value collapses to `'self'`, valid origins pass through).

**Service worker.** `/embed/` navigations are in the PWA `navigateFallbackDenylist` ([frontend/vite.config.ts](frontend/vite.config.ts), alongside `/api/` and `/share/`), so they always reach nginx; a precached shell would carry the strict header and the frame would be blocked.

**Signed-in embeds need a shared parent domain (D6).** The embed pages run in a third-party iframe, so the browser partitions their storage unless Solvro and Outline share a registrable parent domain (e.g. `solvro.acme.com` and `docs.acme.com`). On a shared parent domain the Outline page can embed the task table already signed in; otherwise the embed shows its sign-in prompt, and the supported alternative is a guest link embedded with `/share/<token>?embed=1`, which needs no sign-in.

For `setup.sh` deploys it is saved to `~/solvro/.env` and passed to the frontend container — see [2.13](#213--production-deployment-via-setupsh). The Vite dev server (`:5173`) does not read it.

### 2.3 — Postgres / database environment variables

Used by the `postgres` service in [docker-compose.yml](docker-compose.yml). When you run native-dev, these come from `.env`; when the compose stack is up, they're substituted into the container's environment.

| Variable | Default (`.env.example`) | Purpose |
|---|---|---|
| `POSTGRES_USER` | `solvro` | Initial superuser created on first container start. |
| `POSTGRES_PASSWORD` | `solvro_dev` | Password for that user. **Dev only — rotate before deploy.** |
| `POSTGRES_DB` | `solvro` | The database created on first start. |
| `POSTGRES_PORT` | `5432` | Host-side port mapping (the container always exposes 5432 internally). Override if 5432 is already taken on your laptop. |

> **First-start behavior**: postgres only initializes its data directory when the `solvro_pgdata` volume is empty. Changing `POSTGRES_PASSWORD` after the first start has no effect — you need to either drop the volume (`docker compose down -v` — destructive!) or `ALTER USER` from inside the container.

> The dev `postgres` service hosts the single `solvro` database. The former `velora` logical database was retired with the reference stack (2026-09-21).

### 2.4 — GHCR image references (production only)

The **prod-shaped** `docker-compose.yml` written by [setup.sh](setup.sh) pulls prebuilt images with the registry path **hardcoded in the script**: `ghcr.io/alfi-rajasyah/solvro-cust-backend:latest` and `ghcr.io/alfi-rajasyah/solvro-cust-frontend:latest`. There is no env-var override for the owner or tag in the current script — both are always `latest` from the `alfi-rajasyah` GHCR namespace. Re-running `setup.sh` on an existing install does `docker compose pull && docker compose up -d`, which refreshes to whatever `latest` currently points at (see [.github/workflows/docker-publish.yml](.github/workflows/docker-publish.yml) for what publishes it).

> **Drift note**: `.env.example` still documents `IMAGE_OWNER` / `IMAGE_TAG` variables from an earlier version of the deploy flow. Neither the committed dev `docker-compose.yml` nor the prod compose `setup.sh` writes reads them today — treat them as vestigial unless `setup.sh` is updated to honor them again.

### 2.5 — Services, ports, and volumes

#### Services in [docker-compose.yml](docker-compose.yml) (committed dev stack)

| Service | Image | Container | Internal port | Host port | Notes |
|---|---|---|---|---|---|
| `postgres` | `postgres:15-alpine` | `solvro-postgres` | 5432 | 5432 | Has a `pg_isready` healthcheck; the backend `depends_on` it with `condition: service_healthy`. |
| `backend` | built from `./backend` (target `dev`) | `solvro-backend` | 3000 | 3000 | Runs `prisma generate && prisma migrate deploy && prisma db seed && npm run dev`. Mounts `./backend` for hot reload. |
| `frontend` | built from `./frontend` (target `dev`) | `solvro-frontend` | 5173 | 5173 | Vite dev server with HMR. Mounts `./frontend` for hot reload. `VITE_API_PROXY_TARGET=http://backend:3000`. |

#### Volumes

| Volume | Mounted at | Lifetime | Notes |
|---|---|---|---|
| `solvro_pgdata` | `/var/lib/postgresql/data` (postgres) | Survives `down`; lost on `down -v` | Postgres data directory. **Treat `down -v` as destructive.** |
| `solvro_backend_node_modules` | `/app/node_modules` (backend) | Survives `down` | Keeps backend deps off the host filesystem so the bind mount of `./backend` doesn't shadow them. |
| `solvro_frontend_node_modules` | `/app/node_modules` (frontend) | Survives `down` | Same pattern for frontend. |

> The `node_modules` volumes are why a `package.json` change requires `docker compose up --build` (rebuild the dev image so the new deps land in the volume) — a plain `up` won't pick them up.

#### Ports — quick reference

| Port | Process | Direction |
|---|---|---|
| 5432 | postgres | Backend → DB |
| 3000 | backend (Express) | Frontend (via proxy) → Backend |
| 5173 | frontend (Vite dev) | Browser → Frontend (dev only) |
| 80 | nginx (prod only) | Browser → Frontend (prod) |

> This table describes the dev stack (`backend` on 3000 is reached only via the frontend's proxy). In prod, `BACKEND_PORT` (default 3000) is published to the host directly, not just internally — see [2.13](#213--production-deployment-via-setupsh).

### 2.6 — The `/api` reverse-proxy pattern (critical detail)

The frontend always calls `/api/*`. Two layers strip the prefix before forwarding to the backend:

**Dev** — [frontend/vite.config.ts](frontend/vite.config.ts):

```ts
server: {
  proxy: {
    "/api": {
      target: process.env.VITE_API_PROXY_TARGET ?? "http://localhost:3000",
      changeOrigin: true,
      rewrite: (p) => p.replace(/^\/api/, ""),  // strips /api
    },
  },
}
```

**Prod** — [frontend/nginx.conf](frontend/nginx.conf):

```nginx
location /api/ {
  proxy_pass http://backend:3000/;   # the trailing / on the target strips /api
  ...
}
```

Backend routers stay mounted at `/auth`, `/projects`, `/tasks`, etc. — **without** an `/api` prefix. If you add a router, do **not** prefix it with `/api`; the proxy handles that.

**Nginx files**: [frontend/nginx.conf](frontend/nginx.conf) (locations), [frontend/nginx-frame-protection.conf](frontend/nginx-frame-protection.conf) (strict framing headers), [frontend/nginx-frame-protection-embed.conf](frontend/nginx-frame-protection-embed.conf) (static snippet that sends the mapped framing headers), [frontend/nginx-frame-protection-embed-map.conf.template](frontend/nginx-frame-protection-embed-map.conf.template) (the `map` blocks, rendered at start) and [frontend/nginx-embed-frame-ancestors.envsh](frontend/nginx-embed-frame-ancestors.envsh) (validates `EMBED_FRAME_ANCESTORS`, see [2.2](#22--frontend-environment-variables)). [frontend/Dockerfile](frontend/Dockerfile) copies them into the image.

**Secret-bearing URLs (no access logging)**: `access_log off` is set wherever a secret is part of the URL, so the access log never holds one:

- `/api/public/share/` (`location ^~`) — the guest-link API, proxied to the backend's `/public/share/` exactly like `/api/`, with the same `X-Forwarded-For` / `X-Real-IP` / `X-Forwarded-Proto` headers (this is the hop that `TRUST_PROXY=1` counts).
- `= /api/outline/oauth/callback` and `= /api/outline/oauth/callback/` — the Outline OAuth callback, whose query string carries the one-time `code` and `state`; proxied to the backend's `/outline/oauth/callback`.
- `= /api/webhook/outline` — the Outline webhook, proxied to `/webhook/outline` with a **2 MB** body limit (`client_max_body_size 2m`, matching the backend's raw-body limit; the generic `/api/` location caps at 1 MB). Access logging stays on here: the URL carries no secret.
- `/share/<token>` — a regex location (`^/share/[A-Za-z0-9_-]+/?\z`, the backend's base64url token format) that serves the SPA shell (`index.html`, via `rewrite ^ /index.html break`) with `Cache-Control: no-store`, `Referrer-Policy: no-referrer` and `X-Robots-Tag: noindex` on the document itself, so no subresource request can carry the token in a `Referer`. It takes the *widened* framing snippet (see [2.2](#22--frontend-environment-variables)).
- Any other `/share/…` path (bare `/share/`, extra segments, odd characters) — `location ~ ^/share/`, a regex too, with the same token-hygiene headers and `access_log off` but strict framing.

nginx keeps `merge_slashes` on, so a doubled slash (`/api//public/share/<token>`, `/api//outline/oauth/callback?code=…`) is collapsed before location matching and still lands in the unlogged locations above.

The guest page still loads Google Fonts from Google; the no-referrer policy keeps the token out of those requests.

`access_log off` does **not** cover nginx's `error_log`: when the backend is down or times out, the error-log lines for `/api/public/share/…` and the OAuth callback can contain the token or one-time `code` in the request path. Treat nginx error logs as sensitive (restrict access, don't ship them to shared tooling).

Guest-page navigations (`/share/<token>`) bypass the PWA service-worker cache: [frontend/vite.config.ts](frontend/vite.config.ts) excludes `/share/` and `/embed/` (alongside `/api/`) from `navigateFallbackDenylist`, so they always reach nginx and get its `no-store` / `no-referrer` / framing headers instead of a precached app shell.

**Embed pages**: `location ~ ^/embed/projects/[0-9]+/(tasks|status|timeline)/?\z` serves the SPA shell in place with `no-store`, `no-referrer`, `noindex` and the framing snippet whose values come from the maps (widened only for a raw URI that is exactly such a page). Access logging stays on (the path carries a project id, no secret). Every other `/embed/…` path falls through to `location /` with strict headers. The patterns end in `\z`, not `$`: PCRE's `$` also matches before a trailing newline (`%0A`).

**Framing protection**: every page and static asset the bundled nginx serves carries `Content-Security-Policy: frame-ancestors 'self'` and `X-Frame-Options: SAMEORIGIN` (with `always`, so 304/404/error responses keep them), so other sites cannot embed Solvro in a frame. The two headers live in one snippet, [frontend/nginx-frame-protection.conf](frontend/nginx-frame-protection.conf), which [frontend/Dockerfile](frontend/Dockerfile) copies to `/etc/nginx/snippets/frame-protection.conf`; [frontend/nginx.conf](frontend/nginx.conf) `include`s it **per location**, not at server level, because an `add_header` inside a location discards every server-level `add_header` (and most locations here set their own `Cache-Control`). **A new location that serves files or the SPA shell must `include` the snippet.** The `/api/` locations are left out on purpose: API responses rely on the backend's own `helmet()` framing headers, and a second copy would duplicate them. The Vite dev server (`:5173`) sends neither header; only the built image does.

The one exception is the set of exact pages in [2.2](#22--frontend-environment-variables) (`/embed/projects/<id>/(tasks|status|timeline)`, `/share/<token>`): those locations include [frontend/nginx-frame-protection-embed.conf](frontend/nginx-frame-protection-embed.conf) instead, a static snippet that sends `$embed_frame_csp` / `$embed_frame_xfo`. Those two variables come from the `map $request_uri` blocks in the rendered map file (nginx's envsubst step, filtered to the `EMBED_FRAME_*` variables, output to `/etc/nginx/snippets/`) and are widened to the validated `EMBED_FRAME_ANCESTORS` only when the raw request URI is exactly such a page. The only env var involved is `EMBED_FRAME_ANCESTORS`.

### 2.7 — Database migrations

- **Dev**: `npm run prisma:migrate -- --name <slug>` from `backend/`. Always pass `--name`, otherwise it will hang waiting for interactive input.
- **Container startup (dev stack)**: the backend service's command runs `npx prisma migrate deploy && npx prisma db seed && npm run dev` — so a fresh container always lands with the schema migrated and seed data present.
- **Container startup (prod stack)**: same pattern as dev, seed included — `prisma migrate deploy && prisma db seed && node dist/index.js`. This is safe in prod because the seed creates no users (see [2.8](#28--default-seeded-data--first-admin-dev-and-prod)); see [setup.sh](setup.sh)'s `write_compose_file` function for the backend `command:`.
- **Schema convention**: tables/columns use `@map("snake_case")`, while the TS surface stays camelCase. Preserve this when editing [backend/prisma/schema.prisma](backend/prisma/schema.prisma).

### 2.8 — Default seeded data & first admin (dev and prod)

[backend/prisma/seed.ts](backend/prisma/seed.ts) seeds **no users**. It only upserts:

- **Four built-in roles**: `ADMIN` (`*` wildcard), `TAM` (`project:read`, `project:write`, `task:read`, `task:write`), `STAKEHOLDER` (`project:read` only — read-only on the projects it is attached to as TAM, member or customer owner; for a read-everything role, create a custom role with `project:view-all` in Admin > Roles — the built-in roles are re-seeded to these permissions on every backend start, so editing them does not stick), `PENDING` (empty permissions — the auto-provisioning role for first-time Google sign-ins, see [2.9](#29--auth--rbac-configuration)).
- The `AuthConfig` singleton (`id: "default"`), bootstrapped with an empty `googleAllowedDomains` array so Google sign-in starts disabled until an admin configures it.

The seed is idempotent (`upsert`) and re-running it never overwrites an admin-edited `AuthConfig` row.

**There are no default credentials.** The first admin user is created explicitly:

```bash
docker compose exec -e ADMIN_EMAIL=you@example.com -e ADMIN_PASSWORD=your-password \
  backend npx tsx scripts/create-admin.ts
# equivalently, from backend/ on the host: npm run admin:create
```

[backend/scripts/create-admin.ts](backend/scripts/create-admin.ts) upserts a user by email against the `ADMIN` role (errors if the seed hasn't run yet, since it looks the role up by name). It's idempotent — re-running with the same email resets that user's password, which doubles as the password-reset flow until a proper one exists. In production, [setup.sh](setup.sh) runs this automatically at the end of a fresh install using the `ADMIN_EMAIL` / `ADMIN_PASSWORD` it collected — see [2.13](#213--production-deployment-via-setupsh).

### 2.9 — Auth & RBAC configuration

- **Built-in roles** (hard-coded): `TAM`, `ADMIN`, `STAKEHOLDER`, `PENDING`. `PENDING` is the auto-provisioning role for first-time Google sign-ins — empty permissions, so every screen renders a permission-denied empty state until an admin promotes the user from Admin > Users.
- **Custom roles**: created by admins via `POST /admin/roles` with an arbitrary `permissions: string[]`. The wildcard `"*"` short-circuits all permission checks.
- **JWT payload**: `{ sub: <userId>, ver: <tokenVersion> }`. Role and permissions are read from the database on every request, so a role change applies to live sessions on the next request; `ver` must equal `User.tokenVersion`, which a password change, an admin password reset and a deactivation increment — every older token is then refused with 401 `token_revoked`. A deactivated account's token is refused with 401 `account_disabled`; a deleted account's with 401 `unauthenticated`. `POST /auth/change-password` returns 200 `{ token }` (a replacement token, so the current session continues).
- **Upgrade note**: tokens issued before this version carry no `ver` claim and are refused with 401 `token_revoked`, so after deploying this release every user signs in once again.
- **Utilization needs `project:read`** (all scopes, plus the iTop read routes): a custom role granted `report:executive` for the team/customer views also needs `project:read`.
- **Authorization gate to use** (in priority order):
  1. `requirePermission("project:write")` — the canonical pattern; works for both built-in and custom roles.
  2. `requireRole("ADMIN", ...)` — narrow legacy use only (e.g. `services.ts` writes).
  3. `requireAdmin` — router-level mount on the entire `/admin` tree.

#### Google OAuth (config lives in the database, not env vars)

Login supports two paths, both minting the same `{sub, ver}` JWT: password (`POST /auth/login`) and Google (`POST /auth/google`, verified server-side via `google-auth-library`). Full routes live in [backend/src/routes/auth.ts](backend/src/routes/auth.ts).

**Unlike every other setting in this document, Google OAuth config is not an env var.** It lives in the `AuthConfig` DB singleton (`id: "default"`), managed by admins in-app at **Admin > Sign-in** (`GET`/`PATCH /admin/settings/auth` in [backend/src/routes/admin.ts](backend/src/routes/admin.ts)) — not in `backend/.env`, not in docker-compose. This is a deliberate surprise worth flagging to an operator: setting a `GOOGLE_CLIENT_ID` env var does nothing.

- Two fields make up the policy: `googleClientId` and `googleAllowedDomains` (an email-domain allowlist, up to 32 entries). **Google sign-in stays disabled until an admin sets both.**
- `GET /auth/google/config` is a public, unauthenticated endpoint the frontend polls to decide whether to render the Google button and what Client ID to initialize it with.
- `POST /auth/google` requires `email_verified: true` on the token and checks the token's `hd` claim (or the email's domain) against `googleAllowedDomains`; first-time sign-ins with no matching user (by `googleSub`, falling back to a match by `email`) are auto-provisioned into `PENDING` with `passwordHash: null`.
- Frontend: `@react-oauth/google`'s `GoogleOAuthProvider` wraps the button in [frontend/src/pages/Login.tsx](frontend/src/pages/Login.tsx), initialized at runtime from `useGoogleAuthConfig()` — never a build-time `VITE_*` var (consistent with [2.2](#22--frontend-environment-variables)).
- [backend/src/authConfig.ts](backend/src/authConfig.ts) caches the DB row in memory for a short TTL; `PATCH /admin/settings/auth` busts the cache immediately, so policy changes take effect without a restart.
- Post-deploy setup is manual: create an OAuth 2.0 Client ID in Google Cloud Console (Web application, add the deployed origin as an Authorized JS origin), then paste it + at least one allowed domain into Admin > Sign-in.

### 2.10 — Logging configuration

- **Library**: `pino` + `pino-http` request middleware.
- **Shared logger**: imported from [backend/src/logger.ts](backend/src/logger.ts) — never `new Logger()` ad hoc.
- **Level**: controlled by `LOG_LEVEL` env (default `info`; the dev compose stack sets `debug`).
- **Format**: JSON in prod (default pino), pretty in dev if pino-pretty is wired.
- **Redaction**: request logging goes through [backend/src/http/requestLogger.ts](backend/src/http/requestLogger.ts), which masks the `Authorization`, `X-Solvro-Webhook-Secret`, `Outline-Signature`, `Cookie` and `Set-Cookie` headers (request and response), replaces the `/share/<token>` segment of any URL or `Referer` with `[redacted]`, and masks the `code` and `state` query parameters of the Outline OAuth callback, so no bearer JWT, webhook secret or signature, session cookie, guest-link token or OAuth authorization code reaches the logs. Outline response bodies (which can hold page text) are never logged, and request-body parse errors are answered without logging the offending body. Each request log line carries `clientIp` (the address `req.ip` resolves to under `TRUST_PROXY`, i.e. what the guest-link rate limit keys on) alongside `remoteAddress` / `remotePort` (the direct socket peer — the proxy, when behind nginx). (nginx separately skips access logging for the guest-link paths — see [2.6](#26--the-api-reverse-proxy-pattern-critical-detail).)

### 2.11 — Frontend storage & client-side state

| Storage key | Where it's written | Purpose |
|---|---|---|
| `localStorage["solvro.token"]` | [frontend/src/lib/auth.tsx](frontend/src/lib/auth.tsx) on login | JWT bearer; auto-injected by `apiRequest()` in [frontend/src/lib/api.ts](frontend/src/lib/api.ts). Cleared on logout/401. |
| `localStorage[<theme key>]` | [frontend/src/lib/theme.tsx](frontend/src/lib/theme.tsx) | Persisted light/dark preference. Read/write only via the theme provider — don't touch `document.documentElement.classList` directly. |

### 2.12 — Design-system configuration ("Technical Precision")

- **Theme source-of-truth is code, CSS-first (Tailwind v4)**: [frontend/src/index.css](frontend/src/index.css) defines every semantic color as a CSS custom property (`--primary`, `--surface`, etc. — light under `:root`, dark under `.dark`), then re-exposes them to Tailwind directly in an `@theme inline` block via `rgb(var(--token))`, which is what lets opacity utilities like `bg-primary/10` work. `frontend/tailwind.config.ts` and `frontend/postcss.config.js` were **deleted** (Plan A Task 1-2, 2026-07-24) — the Tailwind toolchain is now driven by the `@tailwindcss/vite` plugin registered in [frontend/vite.config.ts](frontend/vite.config.ts) rather than a JS/TS config file. A second `@theme inline` block in the same file bridges vendored shadcn/ReUI component class names (`bg-background`, `border-border`, etc.) onto these same tokens. Full token tables and behavioral rules live in [DESIGN.md](DESIGN.md) — don't duplicate values here; they drift.
- **Primary color** is Elitery Green, not the old spec blue: `#3aae51` in the dark theme, `#2d9042` in the light theme (darkened for WCAG contrast on white surfaces).
- **Dark is the default theme.** [frontend/src/lib/theme.tsx](frontend/src/lib/theme.tsx) resolves the OS `prefers-color-scheme` on first load and persists the user's explicit choice to `localStorage["solvro.theme"]`.
- **Sidebar is a fixed color in both themes**: `#232321`, hardcoded as the `sidebar` Tailwind token (not CSS-var-routed) — it does not flip with light/dark.
- Layout sizing tokens: `w-sidebar` (260px), `w-context-panel` (320px), `w-sidebar-collapsed` (4rem, icon-only rail).
- Typography: `font-display` and `font-body` both alias **Source Sans 3**; `font-mono` keeps Tailwind's default monospace stack; `data-mono` is a separate Source-Sans-3-with-`tnum` token for tabular numerics.
- Radius scale tops out small (`DEFAULT: 0.25rem`); large radii are forbidden by the spec.
- Elevation is 1px outlines + tonal shifts, not drop shadows — the one sanctioned exception is the `shadow-overlay` token for modals/drawers/floating panels.
- **Mobile breakpoint**: `md:` = 768px. The convention is desktop-first with `md:`-gated chrome — see CLAUDE.md "Mobile responsiveness" for the patterns.

### 2.13 — Production deployment via [setup.sh](setup.sh)

The committed `docker-compose.yml` is a **dev** file. Production is bootstrapped on the deployment host by running `bash setup.sh`, which behaves differently on a fresh install vs. a re-run.

**Fresh install** (no `~/solvro/.env` yet):

1. Collects `ADMIN_EMAIL` / `ADMIN_PASSWORD` and the host ports/bind address — `FRONTEND_PORT` (default `80`), `BACKEND_PORT` (default `3000`), `POSTGRES_PORT` (default: unset, stays unpublished), `BIND_ADDR` (default `127.0.0.1`, loopback-only; `0.0.0.0` publishes to the network) — either from env vars (so `ADMIN_EMAIL=... bash <(curl -sSL <url>)` works non-interactively) or interactive prompts read from `/dev/tty`. It also asks for `APP_URL` (the public Solvro address; the prompt default is derived from the bind address and website port, taken silently when there is no terminal; if no valid address can be derived, `APP_URL` is left unset, with a note — the Outline integration is then disabled and the backend logs a boot warning, until you set it) and `EMBED_FRAME_ANCESTORS` (the Outline address allowed to embed Solvro; blank = embedding off). Both are validated as bare `http(s)` origins (`EMBED_FRAME_ANCESTORS` as a list of them) and an invalid value aborts before anything is written.
2. **Auto-generates** `POSTGRES_PASSWORD` (`openssl rand -hex 24`), `JWT_SECRET` (`openssl rand -hex 48`), and `SECRETS_KEY` (`openssl rand -base64 32`) — these are never prompted for. On a **re-run** against an install that predates `SECRETS_KEY` (older installs), the script generates one and appends it to `~/solvro/.env` once, without overwriting any value already there.
3. Writes `~/solvro/.env` (`chmod 600`, including `APP_URL` and, when given, `EMBED_FRAME_ANCESTORS`, both double-quoted) and `~/solvro/docker-compose.yml` — a prod-shaped compose file with the GHCR image references hardcoded (see [2.4](#24--ghcr-image-references-production-only)).
4. Drops any prior `solvro_pgdata` volume (`docker compose down` + `docker volume rm` — **destructive**, intentional on a fresh install to clear stale postgres state), then pulls images and starts the stack.
5. Polls `GET /health` for up to ~2 minutes, then runs `scripts/create-admin.ts` inside the backend container with the collected admin credentials — a fresh install ends with a working login, no manual step required.

**Re-run** (`~/solvro/.env` already exists): skips all prompts, reuses the persisted ports/bind address, rewrites the compose file, `docker compose pull && docker compose up -d`. Does not touch the admin user or the database volume. `APP_URL` and `EMBED_FRAME_ANCESTORS` are read from `~/solvro/.env` without sourcing it (a hand-edited, unquoted list with spaces would otherwise be run as a command); a value passed in the environment of the re-run replaces the saved one. An older install with no `APP_URL` gets the default derived from the bind address and website port, saved to `.env` with a note; when no valid address can be derived, `APP_URL` stays unset (Outline disabled, boot-log warning), never a placeholder. Set the real public address by re-running with `APP_URL=https://… bash setup.sh` or by editing `.env`.

Backend container command in both cases: `prisma migrate deploy && prisma db seed && node dist/index.js` — see [2.7](#27--database-migrations).

**Ports**: `FRONTEND_PORT` (nginx — serves the SPA and reverse-proxies `/api/*`) and `BACKEND_PORT` (the Express API, published *directly*, not only reachable through nginx) are both bound to `BIND_ADDR` on the host. With the defaults that means only `127.0.0.1:80` and `127.0.0.1:3000` — reachable from the server itself or over an SSH tunnel, not the network. Postgres stays unpublished unless `POSTGRES_PORT` is set, and even then it's forced to `127.0.0.1` regardless of `BIND_ADDR` — the "expose to the network" flag never publishes the database.

**`TRUST_PROXY`**: the generated compose file passes `TRUST_PROXY: "${TRUST_PROXY:-1}"` through to the backend container, read from `~/solvro/.env` (or the environment of the run). The default `1` is right when nginx is the only proxy. If a tunnel or CDN (e.g. cloudflared on the same host or network) sits in front of nginx, set `TRUST_PROXY` to the subnet form `loopback, uniquelocal` (or, simpler, `2`) — otherwise every guest-link visitor shares one rate-limit bucket; the subnet form is preferred because, unlike a hop count, it normally cannot be spoofed by a client that reaches a directly published `BACKEND_PORT`. `1` suits nginx alone. On a **fresh install** `setup.sh` validates a `TRUST_PROXY` given in the environment of the run (hop count `0`-`10`, or a comma list of `loopback` / `linklocal` / `uniquelocal` / IPs / CIDRs; anything else aborts) and saves it, double-quoted, to `~/solvro/.env` — so `TRUST_PROXY="loopback, uniquelocal" bash <(curl …)` persists across later updates. It is not prompted for; if unset, nothing is written and the default `1` applies. On an existing install, edit `~/solvro/.env` and run `docker compose up -d`; quote a list value (`TRUST_PROXY="loopback, uniquelocal"`), because the update path sources `.env` as a shell file and an unquoted value with a space aborts it. See the [2.1](#21--backend-environment-variables) row for accepted values.

**`APP_URL` and `EMBED_FRAME_ANCESTORS`**: the generated compose file passes `APP_URL` to the backend container and `EMBED_FRAME_ANCESTORS` to the frontend container, both read from `~/solvro/.env`. Change either later by editing `.env` and running `docker compose up -d` (the frontend container re-validates `EMBED_FRAME_ANCESTORS` at start and fails closed — see [2.2](#22--frontend-environment-variables)). `APP_URL` must be the address users actually type, and `https` if Outline is to accept it as an OAuth redirect (see the [2.1](#21--backend-environment-variables) row).

Google sign-in still needs a manual post-deploy step, since it's DB-config not env-config (see [2.9](#29--auth--rbac-configuration)): create an OAuth Client ID in Google Cloud Console, then set it + an allowed domain via Admin > Sign-in in the running app — no restart or rebuild needed.

### 2.14 — Bind-mount layout (dev stack)

Bind mounts in the dev stack so code edits trigger hot-reload without rebuilding the image:

| Host path | Container path | Service |
|---|---|---|
| `./backend` | `/app` | backend |
| `./frontend` | `/app` | frontend |

The `node_modules` directories inside `/app` are intentionally shadowed by **named volumes** (`solvro_backend_node_modules`, `solvro_frontend_node_modules`) so a host-side `npm install` doesn't pollute the container's deps and vice versa.

### 2.15 — Testing, and what's intentionally **not** configured

- **Backend has a test runner**: `vitest` — `npm test` (= `vitest run`) from `backend/`. Don't call this unconfigured.
- **A Playwright e2e suite exists** in `e2e/` (own `package.json`, `playwright.config.ts`): `auth`, `kanban-dnd`, `pwa`, and `smoke` specs in `e2e/tests/`, run against desktop and mobile projects (`npm test` / `npm run test:desktop` / `npm run test:mobile` from `e2e/`).
- **`ci/docker-compose.ci.yml`** stands up an ephemeral stack (real Postgres, `runtime`-target backend/frontend images) for CI — credentials come entirely from the environment (`POSTGRES_PASSWORD`, `JWT_SECRET`, `SECRETS_KEY`; see `ci/.env.ci.example`), no literals in the file. `.github/workflows/ci.yml` generates a throwaway `SECRETS_KEY` per run in every job that boots the backend.
- **Frontend still has no unit test runner, and no linter/formatter is wired into either app.** Use `npm run typecheck` (frontend) or `npm run build` (backend = `tsc`) for frontend/type verification; don't fabricate a frontend `npm test`.
- **No Secure Ingestion Port webhook** — cancelled 2026-08-03; the user ended the SA-blueprint ingestion path, so Solvro has no Solution Architect ingestion route and none is planned. No env vars exist for it. Its spec is archived at [docs/archive/plans/secure-ingestion-port-spec.md](archive/plans/secure-ingestion-port-spec.md).
- **No WS / SSE push** layer yet — also PRD §6, also unimplemented (verified: no `ws`/`socket.io`/`EventSource` usage in `backend/src`).
- **No CI-side env** beyond GitHub Actions defaults — see [.github/workflows/docker-publish.yml](.github/workflows/docker-publish.yml) for the image-publish flow that produces the GHCR artifacts `setup.sh` consumes.

### 2.16 — iTop integration

Solvro reads tickets (and, in later phases, time entries and write actions) from an external [iTop](https://www.itophub.io/) ITSM instance. Unlike Google sign-in ([2.9](#29--auth--rbac-configuration)), the *connection itself* is env-adjacent (`SECRETS_KEY` gates it) but its settings are DB-configured, not env vars:

- **What the connection needs**: the iTop base URL, and an iTop **application token** with the `REST Services` user right plus a read profile on `Organization`, `UserRequest`, `Incident`, `Person` (and, from Phase 3, `TimeSpent`). These are entered by an admin at **Admin > iTop**, not in `backend/.env` or docker-compose — `POST/PATCH /admin/itop/settings` seals the token with `SECRETS_KEY` before it reaches the `itop_config` table (`backend/src/lib/itop/config.ts`, `backend/src/routes/itopAdmin.ts`). `GET /admin/itop/settings` never echoes the token back.
- **Sync interval**: `ItopConfig.refreshMinutes`, admin-configurable, **default 5 minutes**, minimum 1 minute — read fresh on every tick so a change applies without a restart (`backend/src/lib/itop/scheduler.ts`). A full resync (drops tickets iTop no longer returns) runs once every 24 hours and on a manual "Sync now" / Refresh. `ITOP_SYNC_DISABLED=true` (see [2.1](#21--backend-environment-variables)) stops the scheduler entirely, independent of `refreshMinutes`.
- **Time Tracking (Phase 3)**: the same sync also pulls iTop's Time Tracking extension entries (`TimeSpent`) for every user matched to an iTop account, into the `itop_time_entries` snapshot table — this is what the Utilization page (`/utilization`) reads. `TimeSpent.duration` is currently assumed to be in seconds (`ITOP_TIME_SPENT_DURATION_IN_SECONDS` in `backend/src/lib/itop/types.ts`) — verify against the real install before go-live (see `docs/ISSUES.md`). The weekly capacity used for utilisation percentages is set once, org-wide, as **Admin > iTop**'s capacity hours per week (`ItopConfig.capacityHoursPerWeek`, default 40).
- **Ports / network**: the backend calls out to iTop's `rest.php` over HTTPS (outbound only — no inbound port to open for the pull path). Browsers never talk to iTop through Solvro's backend; the "Open in iTop ↗" links on the Tickets tab open the iTop base URL directly from the browser, so the iTop host must also be reachable from wherever Solvro's users sit.
- **Secrets**: the application token (and, from Phase 5, each TAM's personal iTop token) is encrypted at rest with `SECRETS_KEY` via `backend/src/lib/secretBox.ts` (AES-256-GCM, versioned `v1:` prefix) — see the `SECRETS_KEY` row in [2.1](#21--backend-environment-variables) and the Secrets discipline note above for the rotation caveat.
- **iTop webhook (optional)**: `POST /api/webhook/itop` (public URL `https://<solvro-host>/api/webhook/itop`) lets iTop itself nudge Solvro the moment a ticket changes, instead of waiting up to `refreshMinutes` for the next scheduled pull. The request body is ignored entirely — the call is a nudge, not a payload — and it only ever triggers a normal incremental sync. The route answers 404 until an admin generates a secret at **Admin > iTop** ("Generate webhook secret", shown once; `POST`/`DELETE /admin/itop/webhook-secret`), after which every call must carry that secret in the `X-Solvro-Webhook-Secret` header (compared in constant time — a wrong value gets 401). At most 6 accepted calls per minute are honoured; further calls get 429. On the iTop side: install the Webhook integration extension and add a trigger "on ticket update" (`UserRequest`/`Incident`) whose action is an HTTP POST to the URL above with that header set to the generated secret. Firewall note: only the iTop server needs outbound reach to this URL — the pull path (backend-initiated HTTPS to iTop) is unaffected and needs no inbound port anywhere.
- **Actions from Solvro (optional)**: with the application token, Solvro is read-only. Turning on **Admin > iTop**'s "Actions from Solvro" switch (`ItopConfig.actionsEnabled`) additionally lets a TAM assign/pending/resolve/close/reopen a ticket and add a log entry, from the ticket panel — but only once that TAM has saved their own personal iTop token in **Settings > iTop**.
  - **What each TAM needs on the iTop side**: a personal token (iTop: **My Account → Personal tokens**, scope `REST/JSON`), and either the `REST Services` profile assigned to that TAM or the instance-wide configuration parameter `allow_rest_services_via_tokens` set to true — this is what puts the TAM's own name on every write. They also need write rights on `UserRequest`/`Incident` — a profile such as `Support Agent` or `Service Desk Agent`, including bulk write, which iTop's REST layer requires even for a single-object update.
  - **Token ownership rule**: `PUT /itop/me/token` (**`backend/src/routes/itopUser.ts`**) accepts a pasted token only when it resolves, via `core/get Person WHERE email = <the Solvro user's email>`, to the iTop person with that same email — never a fallback to another user's token. Every write route (`POST /itop/tickets/:id/actions`, `POST /itop/tickets/:id/log` in **`backend/src/routes/itop.ts`**) then re-decrypts and uses that acting user's own token; the application token (`ItopConfig.appTokenEnc`) is read-only and is never used to write.
  - **Lifecycle rules are iTop's, not Solvro's**: Solvro assumes iTop's own defaults — assigning needs a team and an agent, resolving needs a resolution code and a solution — and sends exactly those fields. A custom rule on your install (an extra mandatory field, an approval step, a narrower state machine) is not modelled by Solvro; when a stimulus doesn't satisfy it, the ticket panel shows iTop's own refusal text verbatim (`409 itop_refused`) rather than a Solvro-authored message.
  - **Storage**: personal tokens are encrypted at rest the same way as the application token — AES-256-GCM via `SECRETS_KEY` (see the `SECRETS_KEY` row in [2.1](#21--backend-environment-variables) and the Secrets discipline note above). Rotating `SECRETS_KEY` invalidates every stored token, application and personal alike — each TAM must re-enter theirs in Settings after a rotation, same as the admin re-entering the application token.
- **New ticket (optional, same "Actions from Solvro" gate)**: `POST /itop/tickets` (**`backend/src/routes/itop.ts`**) requires the chosen caller to be an iTop Person in the customer's own mapped organisation, checked with the read-only application token before the create is sent under the acting TAM's own token; the service pick-list (`GET /itop/services`) comes from iTop's Service catalogue, also read with the application token.
- **Logging time on a ticket (same gate)**: `POST /itop/tickets/:id/time` (**`backend/src/routes/itop.ts`**) creates a `TimeSpent` entry in iTop under the acting user's own token. It requires the same preconditions as every write above, plus a linked iTop **user** account — not just a Person: a TAM whose email resolves to an iTop Person but whose `contactid` doesn't resolve to an iTop User needs an admin to re-run "Match users" (Admin > iTop) before they can log time. The window is validated server-side: at least 1 minute, at most 24 hours, the start time not in the future (a 5-minute clock-skew allowance), and the start time no more than 8 weeks old (the same window `syncTimeEntries` pulls). The write also sends `ticket_ref` (`ITOP_TIME_SPENT_TICKET_REF_FIELD` in `backend/src/lib/itop/types.ts`) to link the entry back to its ticket, the same as `TimeSpent.duration`'s assumed unit above — **unverified against the real install**: confirm the attribute name and that it is writable via REST before go-live (see `docs/ISSUES.md`'s "iTop integration Phase 7" entry). The frontend's running timer itself — one per browser, started/stopped from the ticket panel and mirrored as a compact pill in the top bar — is stored client-side only, in `localStorage["solvro.itopTimer"]`; nothing is sent to the backend until Stop, and a page reload or navigation doesn't lose it. See the same ISSUES.md entry for the follow-up this local-only storage needs (it isn't scoped per signed-in user).

### 2.17 — Outline integration

Solvro connects to the deployment's own, self-hosted Outline wiki in two directions: Outline inside Solvro (browse and create pages, see which pages mention a project or task) and Solvro inside Outline (embeddable task, status and timeline views). Like Google sign-in and iTop, the connection itself is **DB-configured in Admin > Outline**, not env-configured; two env vars support it: `APP_URL` ([2.1](#21--backend-environment-variables)) and `EMBED_FRAME_ANCESTORS` ([2.2](#22--frontend-environment-variables)). Plan and decisions: [docs/archive/plans/outline-integration.md](archive/plans/outline-integration.md).

**Not bundled.** Solvro never ships or deploys Outline — each deployment runs its own (Outline's BSL "Document Service" limit). Nothing Outline-related is added to `docker-compose.yml` or `setup.sh` beyond the two variables above. Solvro stores no Outline API key or admin token: every Outline call runs under the signed-in user's own OAuth token, accepted only when Outline reports the user's Solvro email.

**Address and per-record links.** An admin sets the base URL of the Outline at **Admin > Outline** (`GET`/`PATCH /admin/settings/outline`, [backend/src/routes/outlineAdmin.ts](backend/src/routes/outlineAdmin.ts); stored in the `outline_config` singleton). It must be a plain `http://` or `https://` address — no login, query string or fragment. Saving an empty value removes it. Every signed-in user reads it via `GET /outline/config` (address only) and sees an "Outline" item at the end of the sidebar's Workspace group, opening in a new tab; with no address set, the item is hidden. Customers and projects each carry an optional `outline_url` (http/https, at most 2048 characters), edited in their forms and shown as an "Outline" button in the headers; independent of the base URL, and never included in guest share links or exports.

**Operator setup** (needs `APP_URL` set to the public Solvro address, `https` unless the host is loopback):

1. **Register an OAuth application in Outline** (Outline: **Settings > Applications**). Use the redirect URI shown in Admin > Outline — `${APP_URL}/api/outline/oauth/callback`. Paste the client id and client secret into **Admin > Outline** ("API access"). The secret is sealed with `SECRETS_KEY` and write-only. Solvro requests the scopes `read create` — nothing that writes over or deletes existing pages.
2. **Each user connects their own account** from **Settings** (the Outline card). The sign-in is OAuth with PKCE; the grant is accepted only if Outline's `auth.info` email equals the user's Solvro email, and one Outline account can be linked to only one Solvro account. The email is checked at connect time, not again on every token refresh.
3. **Register the webhook in Outline** (optional; it feeds the "mentioned in Outline" index): **Settings > Webhooks**, URL `${APP_URL}/api/webhook/outline` (shown in Admin > Outline), subscribed to document events, signed with the secret generated in **Admin > Outline** ("Rotate webhook secret" — the secret is shown **once**; rotating replaces it immediately). Deliveries without a valid `Outline-Signature` (HMAC-SHA256 over `<timestamp>.<raw body>`, timestamp within 5 minutes) are refused with 401. The page text a delivery carries is read in memory to find Solvro links and is never stored or logged.
4. Watch **"last delivery"** in Admin > Outline. It warns when nothing has arrived for 24 hours.

**Webhook caveats (Outline's behaviour).**

- Outline delivers webhooks to **private IP addresses only when `ALLOWED_PRIVATE_IP_ADDRESSES` is set on the Outline server** (its own environment). It matters when Solvro and Outline run on the same network and `APP_URL` resolves to a private address; add Solvro's address to that variable on the Outline side.
- Outline gives a delivery 5 seconds and **never retries**. It turns a webhook off after repeated failures (about 80% failed deliveries over 10 or more in 24 hours); re-enable it in Outline. A missed delivery is a lost update to the mentions index until that page is edited again.
- Accepted deliveries are rate limited per client IP and globally; Outline fires roughly one delivery per page edit, so the limits are generous.

**Things that disconnect everyone.** Changing the Outline address or the OAuth client id in Admin > Outline (a real change, not a same-value re-save) clears every user's Outline connection and pending sign-ins in the same step — stored tokens would otherwise be sent to a different server — and a changed address also drops the mentions index (its page ids belong to the old Outline). Each user reconnects from Settings. Changing only the client secret keeps connections. Rotating `SECRETS_KEY` makes stored tokens unreadable, so users reconnect, the OAuth client secret is re-entered and a new webhook secret is generated and pasted into Outline.

**Rate limits.** Outline counts its rate limits per client IP as well as per token, and every Solvro user reaches it from the backend's address, so all users share each limit (notably the OAuth token/authorize/revoke endpoints at 100 per hour and search/list at 100 per minute). A limit hit surfaces as an `outline_rate_limited` answer carrying Outline's retry-after, not a retry loop.

**Database.** The mentions index relies on `UNIQUE … NULLS NOT DISTINCT`, so **PostgreSQL 15 or newer is required** (the dev and prod stacks use `postgres:15-alpine`); the migration fails on older servers.

## Quick reference card

```
┌───────────────────────────────────────────────────────────────────────────┐
│  REQUIRED FOR ANY RUN:                                                    │
│    DATABASE_URL          (postgresql://… ?schema=public)                  │
│    JWT_SECRET            (≥ 32 chars; generate with node -e crypto)       │
│    SECRETS_KEY           (base64, 32 bytes; openssl rand -base64 32)      │
│                                                                           │
│  NATIVE DEV BOOTSTRAP:                                                    │
│    cp .env.example .env                                                   │
│    docker compose up -d postgres                                          │
│    cd backend && npm i && npm run prisma:migrate && npm run db:seed       │
│    npm run dev                            # backend on :3000              │
│    cd ../frontend && npm i && npm run dev # frontend on :5173             │
│                                                                           │
│  DOCKERISED DEV BOOTSTRAP:                                                │
│    docker compose up -d --build                                           │
│    # everything on :5432, :3000, :5173                                    │
│                                                                           │
│  PROD BOOTSTRAP (deployment host):                                        │
│    bash setup.sh          # prompts admin+ports; auto-gens secrets;       │
│                            # auto-creates the admin user on first install │
└───────────────────────────────────────────────────────────────────────────┘
```
