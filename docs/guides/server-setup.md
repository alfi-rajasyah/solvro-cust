# Server setup: Solvro, iTop, and Outline on one server

Solvro, iTop, and Outline can share one server. Each runs as its own Docker Compose project with its own database, and one reverse proxy with TLS sits in front of all three.

## Requirements

### Per application

| | Solvro | iTop (small install) | Outline |
|---|---|---|---|
| CPU | low | 2 vCPU | low; grows with users |
| RAM | about 0.3 GB at idle | 4 GB | 512 MB minimum, 1 GB or more recommended |
| Database | PostgreSQL 15 or later (included) | MariaDB 10.6–11.8 (preferred) or MySQL 5.7+, 10 GB disk | PostgreSQL 14+ and Redis 4+ |
| Runtime | Docker Engine and the Docker Compose plugin | PHP 8.1–8.3 (8.4 from iTop 3.2.3-1) with Apache or nginx | Docker image `outlinewiki/outline` |

- The iTop figures are Combodo's [requirements](https://www.itophub.io/wiki/page?id=3_2_0:install:requirements) for fewer than 200 tickets a month and fewer than 20 console users. Up to 5,000 tickets a month and 50 console users, iTop alone needs 4 vCPU and 8 GB.
- The Outline figures are Outline's [requirements](https://docs.getoutline.com/s/hosting/doc/requirements-ULdYnwi4wG).
- The Solvro figure is measured at idle: the API and its database. The website is a small nginx container.

### Recommended server for all three

**4 vCPU, 8 GB RAM, 40 GB disk, Ubuntu 24.04 LTS or Debian 12**, for a small team.

This is the size of the server the integrations are tested on. With all three running at idle, it uses about 1.4 GB of RAM and 19 GB of disk, Docker images included. Plan for more as tickets, users, and pages grow.

## DNS

Give each application its own hostname under one parent domain, for example:

| Application | Hostname |
|---|---|
| Solvro | `solvro.example.com` |
| iTop | `itop.example.com` |
| Outline | `docs.example.com` |

The shared parent domain matters: Solvro pages embedded in Outline show signed-in content only when both share one. Every hostname needs a TLS certificate. Solvro accepts only an `https://` iTop address, and Outline sign-in needs an `https://` Solvro address.

## Ports

Bind every application to `127.0.0.1` on its own port. Only the reverse proxy listens on the network.

| Application | Bind to | How |
|---|---|---|
| Solvro website | `127.0.0.1:8090` | `FRONTEND_PORT=8090` when you run `setup.sh`. The default `80` collides with the proxy. |
| Solvro API | `127.0.0.1:3000` | `BACKEND_PORT`, default `3000`. The website reaches the API by itself, so the proxy does not need this port. |
| iTop | `127.0.0.1:8000` | Its compose file or web server. |
| Outline | `127.0.0.1:3100` | `PORT=3100` and a `127.0.0.1:3100:3100` port mapping. |

In the firewall, open `443`, and `80` if your certificates renew over HTTP. Keep every other port closed.

## Reverse proxy

Any proxy that terminates TLS works. With [Caddy](https://caddyserver.com/), which also gets and renews the certificates, the whole configuration is:

```
solvro.example.com { reverse_proxy 127.0.0.1:8090 }
itop.example.com   { reverse_proxy 127.0.0.1:8000 }
docs.example.com   { reverse_proxy 127.0.0.1:3100 }
```

Then tell each application its public address:

| Application | Setting |
|---|---|
| Solvro | In `~/solvro/.env`: `APP_URL=https://solvro.example.com`, `EMBED_FRAME_ANCESTORS=https://docs.example.com`, and `TRUST_PROXY="loopback, uniquelocal"`. Run `docker compose up -d` in `~/solvro`. |
| iTop | In iTop's configuration file: `app_root_url` = `https://itop.example.com/` and `behind_reverse_proxy` = `true`. |
| Outline | `URL=https://docs.example.com`. |

`TRUST_PROXY` changes because two proxies now sit in front of the Solvro API: your proxy and the Solvro website container. With the default `1`, Solvro sees every visitor as the same address, and its per-visitor limit on guest links applies to everyone together.

## Traffic between the applications

- Solvro's API calls iTop and Outline at their public `https://` addresses.
- The iTop and Outline webhooks call Solvro at `https://solvro.example.com/api/webhook/...`.
- On one server, these names can resolve to a private address. Outline refuses to send a webhook to a private address until you add it to `ALLOWED_PRIVATE_IP_ADDRESSES` in Outline's environment.

## Backups

Back up all three applications:

| Application | What to back up |
|---|---|
| Solvro | The database volume and `~/solvro/.env` — see [OPERATIONS.md](../../OPERATIONS.md#7-backup-and-restore). Keep the `.env` file: without its `SECRETS_KEY`, the stored iTop and Outline tokens cannot be read. |
| iTop | Its MariaDB or MySQL database and its `conf/` directory. |
| Outline | Its PostgreSQL database and its file storage (the data volume or the S3 bucket). |

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `setup.sh` fails to start the website on port 80. | The proxy already uses port 80. Re-run with `FRONTEND_PORT=8090`. |
| Every guest-link visitor hits the rate limit together. | `TRUST_PROXY` is still `1` behind a second proxy. Set `TRUST_PROXY="loopback, uniquelocal"`. |
| iTop pages load without styles or redirect to the wrong address. | iTop does not know its public address. Set `app_root_url` and `behind_reverse_proxy`. |
| Outline webhook deliveries never arrive. | Solvro resolves to a private address from Outline. Set `ALLOWED_PRIVATE_IP_ADDRESSES` on Outline. |
| The server runs out of memory. | iTop is the largest of the three. Check its ticket and user volume against the sizing above, and add RAM. |
