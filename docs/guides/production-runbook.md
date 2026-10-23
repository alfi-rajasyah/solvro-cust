# Production runbook: Solvro, iTop, and Outline

This runbook gives the order in which to install Solvro, iTop, and Outline on one production server, and the order in which to connect them. Each step links to the guide that has the detail. Do the steps in order: a later step needs the result of an earlier one.

**Flow:** [0. Decide](#0-decide) → [1. Platform](#1-platform) → [2. iTop](#2-itop) → [3. Outline](#3-outline) → [4. Solvro](#4-solvro) → [5. Proxy and TLS](#5-reverse-proxy-and-tls) → [6. Connect](#6-connect) → [7. Optional features](#7-optional-features) → [8. Operate](#8-operate)

## Recommended stack

| Part | Recommendation | Reason |
|---|---|---|
| Server | 4 vCPU, 8 GB RAM, 40 GB disk, Ubuntu 24.04 LTS | The integrations are tested on this size. See [Server setup](server-setup.md#requirements). |
| Reverse proxy | Caddy on the host | It gets and renews the TLS certificates. iTop and Outline both need `https://`. |
| iTop | Native install: Apache, PHP 8.3, and MariaDB | Combodo supports this install. The `vbkunin/itop` image is for test instances only. |
| Outline | The `outlinewiki/outline` image with Docker Compose | Outline's own self-hosting guide uses Docker. |
| Solvro | `setup.sh` | See [INSTALL.md](../../INSTALL.md). |

Move iTop to its own server above 200 tickets a month or 20 iTop console users. It then needs 4 vCPU and 8 GB by itself.

## 0. Decide

Make these decisions before you install anything:

1. **Hostnames.** Give each application its own hostname under one parent domain, for example `solvro.example.com`, `itop.example.com`, and `docs.example.com`. Signed-in embeds need the shared parent domain.
2. **Network access.** Choose public access, an IP allowlist in the reverse proxy, or a VPN. See [Private iTop and Outline](#private-itop-and-outline).
3. **Outline sign-in provider.** Choose Google, Microsoft, or OIDC. Outline has no password login. Register the app at the provider now.
4. **User emails.** Each user needs the same email address in Solvro, iTop, and Outline. Solvro matches people by email only.

## 1. Platform

1. Install Ubuntu 24.04, apply the updates, and turn on the firewall. Open only SSH, `80`, and `443`.
2. Point the DNS records of the three hostnames to the server.
3. Install Docker Engine and the Docker Compose plugin.

## 2. iTop

Detail: [iTop guide](itop.md), steps 1 and 2.

1. Install Apache, PHP 8.3, and MariaDB. Make Apache listen on `127.0.0.1:8000` **before** you install Caddy: both use port `80`.
2. Create the iTop database and copy the iTop files to the web root.
3. Run the setup wizard at `/setup/`. If TLS is not ready yet, open it through an SSH tunnel to `127.0.0.1:8000`.
4. In iTop's configuration file, set `app_root_url` to the public address and `behind_reverse_proxy` to `true`. Add the cron job that runs `webservices/cron.php` every minute. Note the `timezone` value.
5. Create the organisations, a Person for each TAM, and the read-only API user with its application token.

## 3. Outline

Detail: [Outline guide](outline.md), step 1.

1. Write the `.env` file and `docker-compose.yml`. Bind Outline to `127.0.0.1:3100`, and add the sign-in provider from step 0.
2. Start Outline and sign in once. The first sign-in creates the workspace, and the first user becomes the Outline admin.

## 4. Solvro

Detail: [INSTALL.md](../../INSTALL.md) and [Server setup](server-setup.md#ports).

1. Run `setup.sh` with `FRONTEND_PORT=8090`, `APP_URL=https://<solvro-host>`, `EMBED_FRAME_ANCESTORS=https://<outline-host>`, and `TRUST_PROXY="loopback, uniquelocal"`.
2. Sign in as the admin. Create the TAM users with the same emails as in iTop and Outline.

Solvro needs only the Outline address here. Outline does not have to run yet.

## 5. Reverse proxy and TLS

Detail: [Server setup](server-setup.md#reverse-proxy).

1. Install Caddy and add one site block for each hostname: Solvro to `127.0.0.1:8090`, iTop to `127.0.0.1:8000`, Outline to `127.0.0.1:3100`.
2. Add the access rules from step 0, if you chose an allowlist or a VPN.
3. Open the three `https://` addresses and check each certificate.

## 6. Connect

1. **Solvro to iTop.** In Admin > iTop, enter the iTop URL, the application token, and the iTop timezone. Run **Test connection**. Map the customers to organisations and the users to persons. See [iTop guide](itop.md#3-connect-solvro).
2. **Outline OAuth application.** In Outline, create an application with the redirect URL that Admin > Outline shows. This step needs Solvro to run.
3. **Solvro to Outline.** In Admin > Outline, set the Outline address and paste the client ID and secret. See [Outline guide](outline.md#3-connect-solvro).
4. **Each user** connects their own Outline account at Settings > Outline.
5. **Each customer and project** gets the link to its Outline collection or page.

## 7. Optional features

Do these after step 6 works.

1. **iTop actions from Solvro.** In iTop, set `personal_tokens_allowed_profiles`. Turn on the actions in Admin > iTop. Each TAM saves a personal token at Settings > iTop.
2. **iTop webhook.** Generate the secret in Admin > iTop first, then create the webhook in iTop.
3. **Outline webhook.** Generate the secret in Admin > Outline first, then add the webhook in Outline.
4. **Embeds.** Embed one Solvro view in an Outline page to test it.

## 8. Operate

1. Turn on nightly backups: the three databases, the Outline files, iTop's `conf/` directory, and `~/solvro/.env`. See [Server setup](server-setup.md#backups).
2. Copy the backups off the server.
3. Restore a backup once, to prove that it works.

## Why this order

| Rule | Reason |
|---|---|
| Apache moves to port `8000` before Caddy is installed. | Both use port `80`. |
| Solvro runs before the Outline OAuth application is created. | The redirect URL comes from Admin > Outline. |
| Solvro generates each webhook secret before the webhook is created. | iTop and Outline need the secret when you create the webhook. |
| Emails match in all three applications before users are mapped or connected. | Solvro matches people by email only. |

## Private iTop and Outline

iTop and Outline do not have to be on the internet. Two parties must still reach them:

- **Solvro's API** calls iTop and Outline. On the same server, it does not need the internet.
- **The users' browsers** open Outline for sign-in, the sidebar link, and embeds, and open iTop to create personal tokens.

| | IP allowlist in Caddy | VPN only |
|---|---|---|
| How | DNS stays public. Caddy refuses every address that is not on the list. | The iTop and Outline names resolve only inside the VPN. |
| Certificates | Let's Encrypt works as usual. | Needs DNS-01 challenges, or the VPN's own certificates. |
| Users | Work from the office or a VPN exit address. | Each user runs the VPN client. |

With an allowlist, put the server's own public address and the private ranges on the list: Solvro's containers reach iTop and Outline through them.

```
itop.example.com {
    @blocked not remote_ip <office-ip>/32 <server-public-ip>/32 private_ranges
    respond @blocked 403
    reverse_proxy 127.0.0.1:8000
}
```

In both cases:

- Keep `https` with a trusted certificate. Solvro refuses an `http://` iTop address, and a self-signed certificate breaks Solvro's calls.
- If Solvro's address resolves to a private address from Outline, set `ALLOWED_PRIVATE_IP_ADDRESSES` on Outline, or its webhooks never arrive.
