# Connect Solvro to Outline

Solvro connects to your own self-hosted [Outline](https://www.getoutline.com/) wiki in two directions:

- **Outline inside Solvro:** each customer and project gets a **Docs** tab with its Outline pages and a "New doc" button; the ⌘K palette searches Outline; tasks and projects show the pages that mention them.
- **Solvro inside Outline:** an Outline page can embed a read-only task table, status card, or timeline from Solvro.

Solvro stores no Outline API key. Every Outline call runs under the signed-in user's own Outline account, which they connect themselves, and only when its email matches their Solvro email.

**Steps:** [1. Install Outline](#1-install-outline) → [2. Set Solvro's public address](#2-set-solvros-public-address) → [3. Connect Solvro](#3-connect-solvro) → [4. Optional features](#4-optional-features) → [Troubleshooting](#troubleshooting)

For every setting in detail, see the [configuration reference](../CONFIGURATION.md#217--outline-integration). To run Outline on the same server as Solvro, read [Server setup](server-setup.md) first.

## 1. Install Outline

Solvro does not ship Outline: you run your own. Follow Outline's [self-hosting guide](https://docs.getoutline.com/s/hosting). Outline needs:

- PostgreSQL 14+ and Redis 4+.
- Its own `https://` hostname, set in `URL`.
- `SECRET_KEY` and `UTILS_SECRET`, each generated with `openssl rand -hex 32`.
- File storage: a local volume (`FILE_STORAGE=local`) or S3.
- A sign-in provider. Outline has no password login: use OIDC, Google, Microsoft, Slack, or email links over SMTP.

A minimal `docker-compose.yml`, with the secrets in a `.env` file beside it:

```yaml
services:
  outline:
    image: outlinewiki/outline:1.10.1
    ports: ["127.0.0.1:3100:3100"]
    environment:
      URL: https://docs.example.com
      PORT: "3100"
      SECRET_KEY: ${SECRET_KEY}
      UTILS_SECRET: ${UTILS_SECRET}
      DATABASE_URL: postgres://outline:${POSTGRES_PASSWORD}@outline-db:5432/outline
      PGSSLMODE: disable
      REDIS_URL: redis://outline-redis:6379
      FILE_STORAGE: local
      FILE_STORAGE_LOCAL_ROOT_DIR: /var/lib/outline/data
      # Sign-in provider, for example OIDC:
      # OIDC_CLIENT_ID, OIDC_CLIENT_SECRET, OIDC_AUTH_URI, OIDC_TOKEN_URI, OIDC_USERINFO_URI
    volumes: ["outline-data:/var/lib/outline/data"]
    depends_on: [outline-db, outline-redis]
  outline-db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: outline
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: outline
    volumes: ["outline-db:/var/lib/postgresql/data"]
  outline-redis:
    image: redis:7-alpine
volumes:
  outline-data:
  outline-db:
```

Start it with `docker compose up -d`, and sign in once to create the workspace.

Each Solvro user who will use Outline needs an Outline account with **the same email address as their Solvro account**.

## 2. Set Solvro's public address

After sign-in, Outline sends the user back to Solvro, so Solvro must know the address users open it on. Set these in `~/solvro/.env` (`setup.sh` asks for both on a fresh install):

| Variable | Value | Notes |
|---|---|---|
| `APP_URL` | `https://solvro.example.com` | Must be `https`: Outline refuses `http` return addresses, except on `localhost`. Without `APP_URL`, Outline sign-in and mentions stay off. |
| `EMBED_FRAME_ANCESTORS` | `https://docs.example.com` | The Outline address allowed to embed Solvro pages. Empty means embedding is off. |

Apply the change with `docker compose up -d` in `~/solvro`.

## 3. Connect Solvro

Sign in to Solvro as an admin and open **Admin > Outline**.

1. **Address.** Set the Outline workspace address. It must not contain a user name or password (`https://user:pass@...` is refused). A plain `http://` address is allowed for a LAN install, but Admin > Outline shows a warning for it. An "Outline" item appears in every user's sidebar.
2. **API access.** In Outline, open **Settings › Applications** and create an application. Use the redirect URL that the **API access** card shows (`<APP_URL>/api/outline/oauth/callback`). Paste the application's **Client ID** and client secret into the card. Solvro asks Outline only for the `read` and `create` scopes: it can read pages and create new ones, never change or delete existing ones.
3. **Each user connects their own account** at **Settings > Outline**. The connection succeeds only when the Outline account's email equals the user's Solvro email.
4. **Per customer and project.** Put an Outline collection or page link in the "Outline URL" field of a customer or project (a link containing a user name or password is refused). Its **Docs** tab lists the pages under that link, and "New doc" creates pages there.

## 4. Optional features

### Mentions: "Mentioned in Outline"

Solvro learns which Outline pages link to a task or project from Outline's webhook.

1. In Admin > Outline, open the **Webhook** card and click **Generate secret**. Solvro shows the secret once: copy it now.
2. In Outline, open **Settings › Webhooks** and add a webhook with the URL from the card (`<APP_URL>/api/webhook/outline`), the signing secret, and the document events.
3. Watch **last delivery** in the Webhook card. It warns when nothing has arrived for 24 hours.

Solvro reads the page text of a delivery only to find Solvro links. It stores the page id, title, and path, never the text.

### Embeds: Solvro inside an Outline page

1. Set `EMBED_FRAME_ANCESTORS` to your Outline address (step 2).
2. In a project, open the **⋯** menu and choose **Embed in Outline**. Pick the task table, the status card, or the timeline, and copy the link.
3. Paste the link into an Outline page.

Signed-in embeds work only when Solvro and Outline share a parent domain, for example `solvro.example.com` and `docs.example.com`. Otherwise the embed shows a sign-in card. In that case, embed a guest link for the timeline instead: it needs no sign-in.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| The Outline card in Settings or the Docs tab is missing. | No Outline address is set in Admin > Outline. |
| The sign-in redirect shows a plain "Not found" page. | `APP_URL` is not set. Set it and run `docker compose up -d`. |
| Connecting fails, and Admin > Outline warns about `APP_URL`. | `APP_URL` is unset or uses `http`. Set an `https` `APP_URL` and run `docker compose up -d`. |
| Connecting fails with an email message. | The Outline account's email differs from the Solvro email. Sign in to Outline with the matching account, or correct the email. |
| Outline shows a redirect error before its consent screen. | The redirect URL in the Outline application differs from the one in the API access card. Copy it again. |
| "Mentioned in Outline" stays empty. | Check **last delivery** in Admin > Outline. If nothing arrives: the webhook is missing, the secret is wrong, or Outline refuses a private address — set `ALLOWED_PRIVATE_IP_ADDRESSES` on Outline (see [Server setup](server-setup.md#traffic-between-the-applications)). |
| The webhook stopped after a period of errors. | Outline turns off a webhook after repeated failures and does not retry. Fix the cause and turn the webhook on again in Outline. |
| Every user was disconnected. | The Outline address or the OAuth client ID changed in Admin > Outline. This is deliberate. Each user connects again from Settings. |
| An embed shows "Sign in to Solvro to see this". | Solvro and Outline do not share a parent domain. Use a guest link, or move both under one domain. |
| An embed is blocked and shows nothing. | `EMBED_FRAME_ANCESTORS` is empty or invalid. The website container logs the reason at start (`15-embed-frame-ancestors: ERROR: ...`). Use plain addresses like `https://docs.example.com`. |
| A short "rate limited" note appears. | Outline limits requests per address, and all Solvro users reach Outline from one address. Wait and try again. |
| Every user's connection stopped working. | `SECRETS_KEY` changed. Enter the client secret again, generate a new webhook secret and paste it into Outline, and each user connects again. |
