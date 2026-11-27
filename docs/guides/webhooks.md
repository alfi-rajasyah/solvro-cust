# Connect Solvro to other tools with webhooks

A webhook sends a message to another tool when something happens in Solvro, for example when a task changes status or someone comments. Use it to feed your own app. In the other direction, an [incoming URL](#receive-events-from-other-tools) lets a tool such as GitLab or GitHub comment on Solvro tasks.

Each user manages their own webhooks. A webhook sends events only about projects its owner can open. If the owner loses access to a project, loses the `webhook:manage` or `project:read` permission, or their account is deactivated, the webhook stops sending events.

**Steps:** [1. Check the permission](#1-check-the-permission) → [2. Add a webhook](#2-add-a-webhook) → [3. Check the signature](#3-check-the-signature) → [Events and payload](#events-and-payload) → [Deliveries and retries](#deliveries-and-retries) → [Receive events from other tools](#receive-events-from-other-tools) → [Troubleshooting](#troubleshooting)

For the server settings, see the [configuration reference](../CONFIGURATION.md#21--backend-environment-variables) (`WEBHOOK_ALLOW_PRIVATE_HOSTS`, `WEBHOOK_ALLOW_HTTP`).

## 1. Check the permission

Webhooks need the `webhook:manage` permission. The built-in TAM and Stakeholder roles have it, and admins have every permission. For a custom role, an admin adds it in Admin > Roles.

## 2. Add a webhook

1. Open **Settings > Integrations > Webhooks** and select **Add webhook**.
2. Give it a name, and paste the URL that receives the events.
   Solvro sends a signed JSON message in the [Standard Webhooks](https://www.standardwebhooks.com/) format, so the receiver must read that format: your own app, or a tool that accepts it.
3. Pick the events, and either every project you can open or only some of them.
4. Save. Solvro shows the signing secret (`whsec_…`) **once**. Copy it into the receiving app now. You can make a new one later with **Rotate secret**, which stops the old one from working.
5. Select **Send test** to send a `webhook.test` event and see the answer the receiver gave.
6. To change the URL later, select **Edit** and type a new one. Solvro never shows the stored URL again, only its host and a shortened path; leave the field blank to keep it.

Each user can have up to 10 webhooks. The URL must be `https://` and reach a public address, unless the server allows otherwise (see [Troubleshooting](#troubleshooting)).

The "Comment added" and "Comment edited" events carry the first 500 characters of the comment. The receiving tool may show it to people who cannot open the project in Solvro, so pick the receiver with care.

## 3. Check the signature

Every Standard Webhooks message has three headers: `webhook-id`, `webhook-timestamp` and `webhook-signature`. The signature is an HMAC-SHA256 of `<webhook-id>.<webhook-timestamp>.<body>`, keyed with the secret's base64 part after `whsec_`, and written as `v1,<base64>`.

Do not write this check by hand. The Standard Webhooks project publishes a verification library for most languages; pass it the secret, the headers and the raw body. Refuse a message whose timestamp is more than 5 minutes old, and use `webhook-id` to ignore a message you already handled.

## Events and payload

| Event | Sent when |
|---|---|
| `task.created` | A task is added. |
| `task.status_changed` | A task moves to another status. |
| `task.assigned` | A task gets an assignee, at creation or later. |
| `task.due_date_changed` | A task's start or due date changes. |
| `task.completed` | A task moves to a status in the Done group. |
| `comment.created` | Someone comments on a task. |
| `comment.updated` | The author changes the text of a comment on a task. |
| `comment.deleted` | A comment on a task is deleted. |
| `project.created` | A project is added. |
| `risk.created` | A risk is added to a project. |

One change can send two events. For example, a task created with an assignee sends `task.created` and `task.assigned`, to a webhook that follows both.

A Standard Webhooks body looks like this:

```json
{
  "type": "task.status_changed",
  "timestamp": "2026-11-25T08:00:00.000Z",
  "data": {
    "project": { "id": 12, "name": "Core banking migration", "url": "https://solvro.example.com/projects/12" },
    "task": { "id": 345, "title": "Cut-over rehearsal", "status": "In review", "assignee": "maya.putri", "dueDate": "2026-12-01", "url": "https://solvro.example.com/tasks/345" },
    "changes": { "status": { "from": "In progress", "to": "In review" } },
    "actor": "rizky.pratama"
  }
}
```

- `comment.created` adds `comment: { id, text }`, with the first 500 characters of the comment.
- `comment.updated` adds `comment: { id, text }`, with the first 500 characters of the edited comment.
- `comment.deleted` adds `comment: { id, text: null }`. The deleted text is never sent.
- For all three comment events, `text` is the comment as it is when the delivery is sent, so a delayed or retried delivery can carry text edited since, and it is `null` once the comment is deleted.
- Comments written through an incoming webhook URL send none of the three comment events, so two Solvro installations that relay to each other cannot loop.
- A webhook keeps the event types it was set up with. After an upgrade, open it in Settings and select `comment.updated` and `comment.deleted` to receive them.
- `risk.created` adds `risk: { id, title, status, probability, impact }`. `title` is the first 120 characters of the risk description.
- A task description is never sent. Notes are never sent, so an internal note can never leave Solvro through a webhook.
- The links use the server's `APP_URL`. Without it, `url` fields are empty.

## Deliveries and retries

- Solvro sends an event within a few seconds of the change.
- A delivery succeeds when the receiver answers with a 2xx status within 10 seconds. Solvro does not follow redirects.
- A timeout, a connection error, a 429 or a 5xx answer is retried after 5 seconds, 5 minutes, 30 minutes, 2 hours, 5 hours and 10 hours, then the delivery fails. Any other answer fails at once.
- After 20 failed deliveries in a row, Solvro turns the webhook off and shows why in Settings. Select **Enable** to turn it on again.
- **Deliveries** shows the last 50 deliveries of a webhook. Solvro keeps them for 30 days.

## Receive events from other tools

An incoming URL lets any tool that can send a webhook write comments on the tasks of one project. Solvro has no setup for each tool: it reads the JSON the tool sends and finds the Solvro task links in it.

### Add an incoming URL

1. Open the project, open the actions menu (**⋯**) and select **Integrations**. Only the project's owner sees it: its TAM, or the owner of a linked customer.
2. Give the URL a name, for example "GitLab", select **Add URL**, and copy the URL. Solvro shows it **once**. Select **Rotate URL** later to make a new one; the old URL stops at once.
3. In the other tool, paste the URL into its webhook settings and choose JSON:
   - **GitLab:** Project > Settings > Webhooks. Turn on "Push events" and "Merge request events". Leave "Secret token" empty, because the token is in the URL.
   - **GitHub:** Repository > Settings > Webhooks > Add webhook. Content type `application/json` (`application/x-www-form-urlencoded` also works). Pick "Pushes" and "Pull requests".
   - **Any other tool or script:** send a `POST` with a JSON body.
4. Put task links in commit messages, merge request titles or descriptions, for example `Fix cut-over script https://solvro.example.com/tasks/345`.

Each project can have up to 5 incoming URLs.

### What Solvro writes

- For each task link it finds, Solvro adds a comment with the first line of the text that held the link, and a link back to the source (the commit or merge request) when the JSON has one.
- The comment's author is the user who created the incoming URL, and the comment shows "via <URL name>". When another owner rotates the URL, changes its signing secret or enables it, that owner becomes the author of later comments.
- Only tasks of the URL's own project count. Links to other projects are ignored. One request comments on at most 20 tasks, with at most 100 comments in all.
- The same commit or merge request comments once, even when the tool sends it again. Solvro writes a comment with the same text, or the same source link, on the same task only once, with no time limit. To get one comment for each run of a script, send a different `url` for each run.
- If the author is deactivated, can no longer open the project, or can no longer comment on tasks, the URL turns itself off. The Integrations dialog shows why. Select **Enable** to make yourself the author and turn it on again.

To write a comment from your own script, send a body with a `solvro` key:

```bash
curl -X POST "https://solvro.example.com/api/webhook/in/<token>" \
  -H "Content-Type: application/json" \
  -d '{ "solvro": { "task": 345, "text": "Deployed to prod", "url": "https://ci.example.com/run/88" } }'
```

`task` is a task number or a task link, `text` is required (up to 2,000 characters), and `url` is optional. A wrong body gets a 400 answer that says what to fix.

### Require a signature

The token in the URL is enough to send comments, so treat the URL as a password. For extra safety, select **Require a Standard Webhooks signature**. Solvro shows a signing secret (`whsec_…`) once. From then on, every request must be signed in the [Standard Webhooks](https://www.standardwebhooks.com/) format, at most 5 minutes old, or Solvro refuses it. Use this for a sender that signs this way, such as another Solvro server or your own app with a Standard Webhooks library. GitLab and GitHub do not sign this way, so leave it off for them.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| An error such as "The URL must start with https://" or "The URL points at a private, loopback or local address" when you save | The URL is not `https://`, holds a user name or password, points to a private or local address, or its host name does not resolve. A server admin can allow private addresses with `WEBHOOK_ALLOW_PRIVATE_HOSTS=true` and plain http with `WEBHOOK_ALLOW_HTTP=true` (`solvro config set …`). |
| Send test shows "The receiver did not answer in time" or "Could not connect to the receiver" | The receiver did not answer within 10 seconds, or the Solvro server cannot reach it. Check the URL and the receiver's firewall. |
| Send test shows "The receiver answered 301" or "302" | The URL redirects. Use the final URL. |
| The webhook shows "Disabled" | It failed 20 times in a row. Fix the receiver, then select **Enable**. |
| No events for one project | The webhook owner cannot open that project any more, or the webhook is limited to other projects. Deliveries show "The webhook owner can no longer see this project, or lost the permission to receive its events" when access was lost after an event. |
| An incoming URL answers 404 | The URL is wrong, was rotated, deleted or turned off. Check it in **Integrations**. Select **Enable** to turn it on again as its new author, or **Rotate URL** when the old URL is lost. |
| An incoming URL answers 401 | The URL requires a Standard Webhooks signature, and the request was unsigned, wrongly signed, or older than 5 minutes. |
| A commit with a task link adds no comment | The link points to a task of another project, the link does not start with the server's `APP_URL`, or Solvro already wrote a comment with the same text or source link on that task. |
