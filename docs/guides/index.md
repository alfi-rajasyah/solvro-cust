# Solvro guides

Step-by-step guides for running Solvro and connecting it to the tools around it. Each guide tells you what to do, in order. For every setting and environment variable in detail, see the [configuration reference](../CONFIGURATION.md).

| Guide | Read it when |
|---|---|
| [Install Solvro](../../INSTALL.md) | You install or upgrade Solvro on a server. |
| [Operate Solvro](../../OPERATIONS.md) | You need the containers, files, backup and restore, or logs. |
| [Server setup](server-setup.md) | You run Solvro, iTop, and Outline together on one server. |
| [Production runbook](production-runbook.md) | You install all three on a production server and need the order of the steps. |
| [iTop](itop.md) | You connect Solvro to an iTop service desk. |
| [Outline](outline.md) | You connect Solvro to an Outline wiki. |

## Reading order

1. Install Solvro with [INSTALL.md](../../INSTALL.md).
2. If iTop or Outline will share the server, read [Server setup](server-setup.md) before you install them, and follow the [Production runbook](production-runbook.md) for the order of the steps.
3. Connect each integration you need: [iTop](itop.md), [Outline](outline.md). Both are optional and independent of each other.

## Before you start

- Solvro does not ship or deploy iTop or Outline. Each deployment runs its own instance, and Solvro connects to it.
- Both integrations are configured inside Solvro (Admin > iTop, Admin > Outline), not in environment variables. Outline also needs two Solvro environment variables, `APP_URL` and `EMBED_FRAME_ANCESTORS`.
- Solvro encrypts every stored iTop and Outline token with the `SECRETS_KEY` in `~/solvro/.env`. If you change or lose that key, every token must be entered again.
