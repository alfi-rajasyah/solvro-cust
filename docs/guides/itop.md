# Connect Solvro to iTop

Solvro shows each customer's [iTop](https://www.itophub.io/) tickets on that customer's page, with a board that follows iTop's own ticket lifecycle. Optionally, TAMs can act on tickets from Solvro, and iTop can notify Solvro the moment a ticket changes.

Solvro reads from iTop with one read-only application token. Every change Solvro makes in iTop runs under the acting TAM's own personal token, so iTop records the TAM's name and applies the TAM's own rights.

**Steps:** [1. Install iTop](#1-install-itop) → [2. Prepare iTop](#2-prepare-itop) → [3. Connect Solvro](#3-connect-solvro) → [4. Optional features](#4-optional-features) → [Troubleshooting](#troubleshooting)

For every setting in detail, see the [configuration reference](../CONFIGURATION.md#216--itop-integration). To run iTop on the same server as Solvro, read [Server setup](server-setup.md) first.

## 1. Install iTop

Follow Combodo's [installation guide](https://www.itophub.io/wiki/page?id=latest:install:start): a PHP web server and a MariaDB or MySQL database, then the setup wizard at `https://<itop-host>/setup/`. Solvro is tested against iTop 3.2. The requirements are in [Server setup](server-setup.md#requirements).

For a test instance, the community image `vbkunin/itop` runs iTop and MariaDB in one container:

```bash
docker run -d --name itop -p 127.0.0.1:8000:80 vbkunin/itop:3.2.2
# then open http://localhost:8000/setup/
```

Solvro accepts only an `https://` iTop address. Put iTop behind TLS before you connect it, and set iTop's `app_root_url` to that address.

## 2. Prepare iTop

### Application token (read-only)

1. Create an iTop user for Solvro, linked to a Person.
2. Give it the `REST Services User` profile and a profile that can read `Organization`, `UserRequest`, `Incident`, `Person`, and `Service`.
3. Create an application token for it. Keep the token for step 3.

Solvro uses this token only to read. It never writes to iTop with it.

### Organisations and people

- Each Solvro customer maps to one iTop organisation. Create the organisations you need.
- Each TAM needs an iTop Person with **the same email address as their Solvro account**. Solvro matches people by email only.

### Timezone

Note the `timezone` value in iTop's configuration file (Admin tools > Configuration). Solvro needs the same value, or ticket times are shifted.

## 3. Connect Solvro

Sign in to Solvro as an admin and open **Admin > iTop**.

1. **Connection.** Enter the **iTop URL** (`https://...`) and the **Application token**. Click **Test connection**. Every check must pass.
2. **Sync.** Set **Refresh every** (minutes between syncs, default 5) and **Capacity per TAM** (hours per week, default 40, used for utilisation percentages).
3. **Timezone.** Set **iTop server timezone** to the same value as iTop's `timezone`. Save.
4. **Customers → iTop organisations.** Choose the iTop organisation for each customer.
5. **Users → iTop persons.** Run the email match. Check that every TAM is matched.

Each mapped customer now has a **Tickets** tab. The first sync runs within the refresh interval; **Sync now** starts one at once.

## 4. Optional features

### Actions from Solvro

TAMs can assign, set pending, resolve, close, and reopen tickets, add log entries, and create tickets from Solvro.

1. **In iTop, allow personal tokens** for the TAMs' profile. In the `authent-token` module settings of iTop's configuration file:

   ```php
   'authent-token' => array(
     'personal_tokens_allowed_profiles' => array('Support Agent'),
   ),
   ```

2. **Give each TAM write rights in iTop** on `UserRequest` and `Incident` (for example the `Support Agent` profile), plus either the `REST Services User` profile or `allow_rest_services_via_tokens` set to `true` in iTop's configuration.
3. **In Solvro, turn on Actions from Solvro** in Admin > iTop.
4. **Each TAM creates a personal token** in iTop (**My Account → Personal tokens**, scope `REST/JSON`) and saves it in Solvro at **Settings > iTop**.

Solvro accepts a personal token only when it can confirm the token is the TAM's own: used with that token, Solvro reads the iTop User of the Person with the TAM's email and that user's own PersonalToken. If the token's profile cannot read those two classes, Solvro refuses it unless you opt in (see the troubleshooting table below and [CONFIGURATION.md](../CONFIGURATION.md)). Solvro never falls back to another token for a write.

iTop's own lifecycle rules apply. Solvro sends iTop's default fields (assigning needs a team and an agent; resolving needs a solution). When your iTop has extra rules, the ticket panel shows iTop's refusal text as iTop wrote it.

### Webhook: sync at once when a ticket changes

Without the webhook, Solvro syncs on its schedule. With it, iTop tells Solvro to sync the moment a ticket changes.

1. In Admin > iTop, open the **Webhook** card and generate a secret. Solvro shows the URL, the header name, and the secret.
2. In iTop, create a webhook action that sends `POST` to `https://<solvro-host>/api/webhook/itop` with the header `X-Solvro-Webhook-Secret: <secret>`.
3. Attach the action to a trigger on ticket create and update (`UserRequest`, `Incident`).

iTop must be able to reach the Solvro address. Solvro ignores the request body: the call only starts a normal sync, at most 6 times a minute.

### Time tracking and Utilization

The **Utilization** page and the ticket timer use iTop's Time Tracking extension (`TimeSpent`). It is a paid extension on iTop Hub and is not part of a standard iTop install. Without it, the rest of the integration works.

### Pause the sync

To stop the background sync, for example during iTop maintenance, set `ITOP_SYNC_DISABLED=true` in `~/solvro/.env` and run `docker compose up -d` in `~/solvro`.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| Saving the settings fails with "baseUrl must be an https:// URL". | Solvro accepts only `https://`. Put iTop behind TLS and use that address. |
| **Test connection** fails a check. | The application token cannot read that class. Add read rights on `Organization`, `UserRequest`, `Incident`, `Person`, and `Service`, and check the `REST Services User` profile. |
| A TAM is not matched. | The iTop Person email differs from the Solvro email. Correct the email in iTop, then run the match again. |
| A TAM's personal token is refused. | The token belongs to another iTop Person, or that Person's email differs from the TAM's Solvro email. Create the token while signed in to iTop as the TAM. |
| Saving a personal token fails with "Solvro could not confirm this token is yours: it cannot read your iTop user account or its personal tokens. Ask your iTop administrator to allow that, or ask your Solvro admin to allow tokens Solvro cannot verify." (`itop_token_unverified`). | The token's iTop profile cannot read `User` or `PersonalToken` (a Support Agent profile cannot by default), so Solvro cannot prove the token is the TAM's own. Either grant that read right in iTop, or set `ITOP_ALLOW_UNVERIFIED_PERSONAL_TOKENS=true` in `~/solvro/.env` and run `docker compose up -d` in `~/solvro`; Solvro then accepts the token on the email match alone. Tokens saved before this check existed are not re-checked. Details: [CONFIGURATION.md](../CONFIGURATION.md). |
| The TAM cannot create a personal token in iTop. | The TAM's profile is not in `personal_tokens_allowed_profiles`. |
| An action fails with a message from iTop. | iTop refused the change under its own rules. Fix the ticket in iTop, or adjust the rule there. |
| Ticket times are off by some hours. | The **iTop server timezone** in Solvro differs from iTop's `timezone`. Make them equal; times are corrected at the next sync. |
| The webhook gets 404. | No webhook secret is generated in Solvro yet. |
| The webhook gets 401. | The `X-Solvro-Webhook-Secret` header is missing or wrong. Copy the secret again, or generate a new one. |
| Tickets stop updating. | Check the last sync line in Admin > iTop, and check that `ITOP_SYNC_DISABLED` is not `true`. |
| Every stored token stopped working. | `SECRETS_KEY` changed. Enter the application token again, and each TAM saves their personal token again. |
