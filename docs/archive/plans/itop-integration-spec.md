---
source: claude.ai artifact 6t5nKyWt7PzkTZbX8Vrk94 ("iTop in Solvro", research draft v2, 2026-09-12)
extracted: 2026-09-22 from a saved copy of the artifact frame
status: proposal — not yet a plan; the plan lands in docs/plans/itop-integration.md after the unknowns are answered
note: text extraction of an HTML artifact; mockup screens are flattened, diagrams are lost
---

Solvro
 Integration proposal
 Research draft · v2, two options
 2026-09-12

# iTop in Solvro

 Two ways to put iTop inside Solvro. In both, iTop stays the owner of tickets and hours. They differ in one thing: whether a TAM can act on a ticket without leaving Solvro.

## The answer

 Both options

### iTop owns the tickets. Solvro shows them where the TAM works.

 Open tickets per customer on the customer page and in Daily Review. Hours per TAM per customer on a Utilization page that replaces the Work Logs placeholder. Solvro keeps a cache, never a fact of its own.

 Option 1 · Read-only

### You act in iTop. Solvro shows.

 Every action is a link that opens the ticket in iTop. Solvro needs a read profile only. Small build, no risk of writing the wrong thing.

 Option 2 · Managed from Solvro

### You act in Solvro. iTop records.

 Assign, set pending, resolve, add a log entry, log time, create a ticket: all from Solvro, written straight into iTop under your name. iTop's own rules still apply, so its mandatory fields show up as small sheets.

 Recommendation: build Option 1 first in both cases. It is the first four phases of Option 2, so nothing is thrown away. Decide on Option 2 once questions 1, 8 and 9 below are answered.

 Blue marks data that comes from iTop, and Option 1.
 Green marks what Solvro owns, and what Option 2 adds.

## Two options, one difference

 The drawing shows which way the arrows point. The third panel is the trap both options avoid.

 Option 2 is write-through, not sync: Solvro never stores a ticket status that iTop has not confirmed. That is why it keeps Option 1's safety while adding actions.

| What a TAM can do | Option 1 · Read-only | Option 2 · Managed from Solvro | 

| See a customer's tickets: status, agent, age, SLA | Yes | Yes | 

| See hours per customer and per TAM (Utilization) | Yes | Yes | 

| Open the ticket in iTop | Link | Link | 

| Change status: assign, pending, resolve, close, reopen | In iTop | Drag on the board, or a button. iTop's mandatory fields open as a sheet. | 

| Assign a ticket to me | In iTop | One click | 

| Add a public or private log entry | In iTop | From the ticket panel | 

| Create a ticket | In iTop | From the customer page, or from a Solvro task | 

| Log time on a ticket | In iTop | Start / stop in Solvro; the entry is created in iTop | 

| Who appears in iTop's history | — | The TAM, through a personal iTop token | 

| When iTop is down | Pages show the last snapshot, clearly dated | Same for reading. Every action fails with iTop's message; nothing is queued. | 

| What iTop must provide | Read access, one token | Write access, one token per TAM, the lifecycle rules of your install | 

| Build | 4 phases | 4 + 3 phases | 

 About the word "tasks". iTop tickets have no planned start and due dates, no dependencies, no sections, no baseline. Solvro's project tasks (List, Kanban, Gantt) stay in Solvro in both options. Option 2 makes iTop the backend for operational tickets, managed from Solvro. A task can create a ticket and show its status. A task never moves into iTop.

## Both options: what you see

 Four screens, from the TAM's side of the glass. Example data throughout; names and numbers are not real.

### 1 · Customer page gets a Tickets tab /customers/:id?tab=tickets

 You doOpen a customer. Click Tickets. Filter to Mine or to what was resolved this week. Click a row to open it in iTop.

 You seeEvery ongoing iTop ticket for that organisation: ref, title, type, status, agent, age, SLA. Refreshed every 5 minutes.

 Solvro

 dashboardOverview

 folder_managedProjects

 groupsCustomers

 edit_noteDaily Review

 table_chartWeekly Sync

 scheduleUtilization

 monetization_onPipeline

 leaderboardExecutive

 settingsSettings

 admin_panel_settingsAdmin

 Customers / Northwind Freight

#### Northwind Freight

 TAM · Rina S.3 active projectsiTop org · Northwind Freight Sdn Bhd

 OverviewServices
 Tickets 
 TopologyDocumentsOrg

 Ongoing · 4Resolved this week · 3Mine · 2IncidentsRequests

 Synced 2 min agorefreshRefresh

| Ref | Title | Type | Status | Agent | Age | SLA | | 

| R-004512 | Branch 5 VPN tunnel flapping | Incident | Escalated TTR | Rina S. | 2 d | TTR breached | Open in iTop ↗ | 

| R-004530 | Add 2 users to the Acronis console | User request | Assigned | Rina S. | 5 h | TTR 3 h left | Open in iTop ↗ | 

| R-004498 | Monthly backup report not received | User request | Pending | Dedi P. | 4 d | Paused | Open in iTop ↗ | 

| R-004535 | Firewall rule for the new HR app | User request | New | Unassigned | 40 min | TTO 1 h 20 left | Open in iTop ↗ | 

 Tickets belong to the customer's iTop organisation. Solvro shows them; it does not own them.

- 1New tab. The blue dot says "from iTop". The customer header shows which iTop organisation is mapped.

- 2Filters are counts, so the tab answers "how many?" before you read a row. Mine = tickets where the agent is you.

- 3Snapshot age and a manual refresh. The page never waits on iTop to load.

- 4In Option 1 the only action is this link. Option 2 adds a Board view and a ticket panel to this same tab (screens 5 and 6).

### 2 · Daily Review shows the operations picture /daily-review

 You doReview the customer as today. When a ticket matters, click "Add to note" and the ref lands in the operations note.

 You seeA one-line iTop strip per customer: new today, resolved today, SLA breaches. The 3 tickets that changed most recently.

 Solvro

 dashboardOverview

 folder_managedProjects

 groupsCustomers

 edit_noteDaily Review

 table_chartWeekly Sync

 scheduleUtilization

 monetization_onPipeline

 leaderboardExecutive

 settingsSettings

 admin_panel_settingsAdmin

#### Daily Review

 ‹Fri 12 Sep 2026›Week 37

 Northwind Freight2 / 3 projects reviewed · Weekly update: Draft

##### Operations · Northwind Freightno project

 iTop today
 2 new1 resolved1 SLA breached
 4 ongoing · synced 09:41

 R-004512Branch 5 VPN tunnel flappingEscalated TTRAdd to note

 R-004535Firewall rule for the new HR appNewAdd to note

 R-004471Veeam job failing on VM-DB02ResolvedAdd to note

 R-004512 Branch 5 VPN tunnel flapping — ISP escalated, LTE fallback kit on standby.
Operations note for today…

 Title: "VPN outage branch 5" · author Rina S.Save note

 Project cards below are unchanged. Tickets attach to the customer, so they sit with the operations note. In Option 2 each row also gets "Assign to me" and "Resolve".

- 1The strip is the whole operations context in one glance. It sits on the operations card, because tickets belong to the customer, not to a project.

- 2"Add to note" writes the ref and title into the Solvro note. It writes nothing into iTop, in either option.

- 3The note stays a plain Solvro operations note (title + body, Decision 4 of Daily Review v2). The ref is text, so the Weekly Sync draft picks it up as today.

### 3 · Work Logs becomes Utilization /utilization (today: /work-logs)

 You doLog time in iTop as usual: the Time Tracking tab, the stopwatch, or "Track my time". Open Utilization in Solvro to see the week. In Option 2 the stopwatch also lives in Solvro.

 You seeYour hours per customer per day, the week total against capacity, and time not tied to a customer. Managers switch to "By TAM".

 Solvro

 dashboardOverview

 folder_managedProjects

 groupsCustomers

 edit_noteDaily Review

 table_chartWeekly Sync

 scheduleUtilization

 monetization_onPipeline

 leaderboardExecutive

 settingsSettings

 admin_panel_settingsAdmin

#### Utilization

 ‹Week 37 · 7–13 Sep 2026›MeBy TAMBy customer

 Source · iTop Time TrackingSynced 09:41 · refreshRefresh

 Hours logged32.0of 40 h

 Customers touched3of 4 assigned to you

 Not tied to a customer3.0hinternal, no organisation on the entry

| Customer | Mon | Tue | Wed | Thu | Fri | Sat | Sun | Total | Tickets | 

| Northwind Freight | 2.5 | 3.0 | 1.5 | 4.0 | 2.0 | – | – | 13.0 | R-004512 · R-004530 · +2 | 

| PT Sinar Logistik | 1.0 | 2.0 | 3.5 | 0.5 | 1.5 | – | – | 8.5 | R-004488 · R-004519 | 

| Bumi Retail | – | 1.5 | 2.0 | 1.0 | 3.0 | – | – | 7.5 | R-004501 | 

| No customer | 1.0 | 0.5 | 0.5 | 0.5 | 0.5 | – | – | 3.0 | — | 

| Total | 4.5 | 7.0 | 7.5 | 6.0 | 7.0 | – | – | 32.0 | | 

 Hours come from iTop TimeSpent entries by you. To change a number, edit the entry in iTop.

- 1Same route file, new name. The sidebar entry sits after Weekly Sync. Every TAM sees their own hours.

- 2"By TAM" and "By customer" are for managers (proposed gate: the Executive permission). The table pivots; the tiles follow.

- 3Capacity is one number in Admin, 40 h by default. The bar is utilisation; there is no billable flag in iTop's free module.

- 4No cell is editable in either option. Option 2 creates entries through the ticket panel's timer (screen 6), never by typing into this table.

### 4 · Admin connects and maps, once /admin · iTop tab

 You do (admin)Paste the iTop URL and an application token. Test. Confirm the customer-to-organisation matches and fix the ones that did not match.

 You seeConnection status with the iTop version and profiles, the sync interval, the ticket classes read, and two mapping tables.

 Solvro

 dashboardOverview

 folder_managedProjects

 groupsCustomers

 edit_noteDaily Review

 table_chartWeekly Sync

 scheduleUtilization

 monetization_onPipeline

 leaderboardExecutive

 settingsSettings

 admin_panel_settingsAdmin

#### Admin

 UsersRolesSign-inProject OverridePipeline
 iTop 

##### Connection

 iTop URLhttps://itop.example.co.id

 Application token••••••••••••••••••••••••••••Auth-Token header

 Statuscheck_circleConnected · iTop 3.2.1 · profiles: REST Services, Support Agent Test connection

 Refresh every5 min

 ReadUser requestsIncidentsChangesTime entries

 Capacity per TAM40 h / week

 Actions from SolvroAllowed (Option 2)each TAM needs a personal token, see Settings

##### Customers → iTop organisations7 of 8 matched by name

| Solvro customer | iTop organisation | Match | 

| Northwind Freight | Northwind Freight Sdn Bhd | by name | 

| PT Sinar Logistik | PT Sinar Logistik | by name | 

| Bumi Retail | Choose an organisation…▾
 | unmatched | 

##### Users → iTop persons3 of 4 matched by email

 dedi.p@example.co.id has no iTop person. Their "Mine" filter and Utilization stay empty until iTop has that email.

- 1Same place as the Google sign-in settings: stored in the database, no redeploy. One row, like `AuthConfig`.

- 2Test connection calls iTop's check and lists the profiles behind the token, so a wrong profile shows here and not as an empty Tickets tab.

- 3Organisations match by exact name first. The admin fixes the rest once. An unmatched customer simply has no Tickets tab.

- 4Users match by email only. No manual user mapping: the fix is in iTop.

- 5Option 2 is one switch. The application token still only reads; every write uses the acting TAM's own token.

## Option 2 adds: what you can do
Managed from Solvro

 Three more screens. Each action goes to iTop at once, under the TAM's own name, and the screen then shows what iTop answered.

### 5 · The Tickets tab gets a Board /customers/:id?tab=tickets&view=board

 You doDrag a card from Assigned to Resolved. iTop needs a resolution code and a solution for that step, so a sheet asks for them. Confirm, and the card lands.

 You seeColumns are iTop's lifecycle, not Solvro's To do / In progress / Done. Escalations show as a red chip inside their column.

 Solvro

 dashboardOverview

 folder_managedProjects

 groupsCustomers

 edit_noteDaily Review

 table_chartWeekly Sync

 scheduleUtilization

 monetization_onPipeline

 leaderboardExecutive

 settingsSettings

 admin_panel_settingsAdmin

 Customers / Northwind Freight

 OverviewServices
 Tickets 
 TopologyDocumentsOrg

 TableBoardMine · 2IncidentsRequests

 addNew ticketSynced 09:41

 New1

 R-004535Firewall rule for the new HR appUser requestTTO 1 h 20
UnassignedAssign to me

 Assigned2

 R-004512Branch 5 VPN tunnel flappingIncidentEscalated TTR
Rina S.2 d

 R-004530Add 2 users to the Acronis consoleUser request

 Pending1

 R-004498Monthly backup report not receivedUser requestPaused
Dedi P.4 d

 Resolved1 → 2

 R-004530Add 2 users to the Acronis consoleUser requestTTR 3 h left
Rina S.5 h

 R-004471Veeam job failing on VM-DB02Incident
Rina S.Tue

 Closed1

 R-004402Printer queue stuck, floor 3User request
Dedi P.Mon

###### Resolve R-004530

 Add 2 users to the Acronis console · iTop asks for 2 fields on this step.
 Resolution code required by iTopAssistance▾

 Solution required by iTopBoth users created in the Acronis console with the Backup Operator role. Welcome mail sent.

 Written to iTop as Rina S.CancelResolve in iTop

 If iTop refuses (rule, permission, outage), the card snaps back and the sheet shows iTop's message. Nothing is queued.

- 1Table and Board are two views of the same tab. The Table (screen 1) stays the default.

- 2A drag sends one lifecycle step to iTop (assign, pending, resolve, close, reopen). Steps that iTop forbids are not drop targets.

- 3New ticket asks for title, type, caller, service and description, then creates it in iTop under this customer's organisation.

- 4Assign to me sets team and agent in one step, because iTop requires both together.

### 6 · A ticket panel, like the task panel /customers/:id?tab=tickets&ticket=4512

 You doClick a row or card. Read the log. Type a public or private entry. Start the timer while you work; stop it when you are done.

 You seeThe ticket's facts from iTop, the public and private log, your running timer, and who the writes are signed as.

 Solvro

 dashboardOverview

 folder_managedProjects

 groupsCustomers

 edit_noteDaily Review

 table_chartWeekly Sync

 scheduleUtilization

 monetization_onPipeline

 leaderboardExecutive

 settingsSettings

 admin_panel_settingsAdmin

 Customers / Northwind Freight / Tickets

| Ref | Title | Status | Agent | SLA | 

| R-004512 | Branch 5 VPN tunnel flapping | Escalated TTR | Rina S. | Breached | 

| R-004530 | Add 2 users to the Acronis console | Assigned | Rina S. | 3 h left | 

| R-004498 | Monthly backup report not received | Pending | Dedi P. | Paused | 

| R-004535 | Firewall rule for the new HR app | New | Unassigned | 1 h 20 | 

 R-004512IncidentEscalated TTR

###### Branch 5 VPN tunnel flapping

 PendingResolveReassignOpen in iTop ↗

 CallerBudi H. · Northwind
 ServiceNetwork / WAN
 TeamTAM Team
 AgentRina S.
 PriorityHigh
 TTRBreached 3 h ago

 Public log
 Branch 5 users lose the VPN every 10 minutes since 08:40.Budi H. · in iTop · 09:02

 ISP escalated, their ref INC-88121. LTE fallback kit on standby.Rina S. · from Solvro · 10:15

 PublicPrivateAdd a log entry…
Add entry

 Time
 01:12:34Stop2.5 h this week on this ticket

 Writes go to iTop as rina.s@example.co.id · personal token valid until 2027-03-01

- 1The same lifecycle steps as the board, as buttons. Resolve opens the same sheet as screen 5.

- 2A log entry is appended to iTop's public or private log. iTop stamps it with the TAM's name and time.

- 3Stop creates one iTop time entry on this ticket. It appears on Utilization at the next sync.

- 4Every write is signed by the TAM's personal token. Without one, the panel is read-only and says so here.

### 7 · Each TAM pastes their own iTop token, once /settings

 You doIn iTop: My Account → Personal tokens → new token with scope REST/JSON. In Solvro: paste it here and save.

 You seeWhether the token works, which iTop person it is, and when it expires. Without it, everything in Option 2 is read-only for you.

 Solvro

 dashboardOverview

 folder_managedProjects

 groupsCustomers

 edit_noteDaily Review

 table_chartWeekly Sync

 scheduleUtilization

 monetization_onPipeline

 leaderboardExecutive

 settingsSettings

 admin_panel_settingsAdmin

#### Settings

##### iTopOption 2

 My personal token••••••••••••••••••••••••••••••••scope REST/JSON

 Statuscheck_circleValid · rina.s@example.co.id · profiles: Support Agent, REST Services · expires 2027-03-01

 SaveRemove

 Create it in iTop under My Account → Personal tokens. Without a token, tickets are read-only for you; the application token never writes.

- 1Stored encrypted next to the user, never shown again. Rotate by pasting a new one.

- 2Solvro checks the token against iTop and reads back the person and profiles, so a missing write profile shows here, not on a failed drag.

- 3The alternative, one shared "Solvro" account for all writes, puts "Solvro" in every log entry and loses per-TAM rights. Question 8 asks which you want.

## How it works

 Solvro's backend pulls from iTop on a timer and keeps a snapshot in its own Postgres. Pages read the snapshot. Option 2 adds one path: an action goes to iTop, and the answer refreshes the snapshot.

 Blue: reads, both options. Green: Option 2's write path. Tokens live in the backend only; browsers never see them.

| Solvro | iTop | Join rule | 

| `Customer` | Organization | Exact name match on first sync; the admin fixes the rest in the mapping table. Stored as `itop_org_map`. | 

| `User` (TAM) | Person → agent on tickets, user on time entries | Email equality. No manual mapping. Option 2 adds the TAM's personal token, stored encrypted on the user. | 

| Ticket row (new) | UserRequest, Incident | Read: `ref, title, finalclass, status, operational_status, priority, agent_id, team_id, service_id, start_date, last_update, tto, ttr, sla_tto_passed, sla_ttr_passed, resolution_date`. Scoped by `org_id`. Option 2 also reads `public_log`, `private_log`. | 

| Hours row (new) | TimeSpent (Time Tracking extension) | Read: `user_id, org_id, start_date, end_date, duration, title` plus the linked ticket. Scoped by mapped users, last 8 weeks. Option 2 creates them from the panel timer. | 

| `Project`, `Task` | — | No join. iTop has no project object that matches. A task may pin one ticket ref, and in Option 2 may create the ticket. | 

| `Service` | Service | Read as a pick-list for "New ticket" in Option 2. Not joined to Solvro's own catalogue. | 

### What one pull looks like both options

 `POST https://itop.example.co.id/webservices/rest.php?version=1.3
Auth-Token: <application token>

json_data = {
 "operation": "core/get",
 "class": "UserRequest",
 "key": "SELECT UserRequest WHERE org_id IN (42, 57) AND last_update > '2026-09-12 09:36:00'",
 "output_fields": "ref,title,status,operational_status,priority,agent_id_friendlyname,team_id_friendlyname,start_date,last_update,tto,ttr,sla_ttr_passed",
 "limit": 100, "page": 1
}

-- hours, same call shape
"class": "TimeSpent",
"key": "SELECT TimeSpent WHERE user_id IN (17, 23) AND start_date >= '2026-07-20'"`

### What one action looks like Option 2

 `POST https://itop.example.co.id/webservices/rest.php?version=1.3
Auth-Token: <the TAM's personal token>

-- resolve: a lifecycle step with the fields iTop demands for it
{ "operation": "core/apply_stimulus", "class": "UserRequest", "key": 4530,
 "stimulus": "ev_resolve",
 "fields": { "resolution_code": "assistance", "solution": "Both users created in the Acronis console…" } }

-- log entry: an update appends to the case log
{ "operation": "core/update", "class": "UserRequest", "key": 4512,
 "fields": { "public_log": "ISP escalated, their ref INC-88121. LTE fallback kit on standby." } }

-- time: one entry on the ticket
{ "operation": "core/create", "class": "TimeSpent",
 "fields": { "user_id": 17, "org_id": 42, "start_date": "2026-09-12 10:15:00", "end_date": "2026-09-12 11:27:34", "title": "R-004512" } }

-- then the same core/get as above, for this ticket, so the page shows iTop's answer`
 One fact to keep straight: iTop's `time_spent` field on a ticket is labelled "Resolution delay". It is a clock, not effort. Hours come only from the Time Tracking extension's `TimeSpent` objects.

## What iTop must provide

 The list to hand to whoever runs iTop. Items 1 to 5 unlock tickets. Item 6 unlocks hours. Item 7 is speed only. Items 8 to 10 are Option 2.

| # | Item | Needed for | Option | Who | 

| 1 | iTop 3.2.1 or later.The token module ships with 3.2.1. On an older iTop the fallback is a dedicated user with password login, which is weaker and should be temporary. | Tickets | 1 + 2 | iTop admin | 

| 2 | Network path from the Solvro backend to the iTop URL over HTTPS.Allow-list the Solvro host if iTop sits behind a firewall. Browsers open iTop directly for "Open in iTop", so users need their normal iTop access too. | Tickets | 1 + 2 | Network | 

| 3 | One Application Token user (User accounts → new Application Token) with scope REST/JSON.Sent as the `Auth-Token` header. Rotated from Admin in Solvro; the old one is revoked in iTop. It only ever reads. | Tickets | 1 + 2 | iTop admin | 

| 4 | Profiles on that user: `REST Services` plus a profile that can read tickets, organisations, and persons.Support Agent works but can also write. A custom read-only profile is cleaner and is the recommendation. | Tickets | 1 + 2 | iTop admin | 

| 5 | Data that lines up: organisation names equal to Solvro customer names where possible, and TAM emails on iTop persons equal to Solvro logins.Names that differ are mapped once in Admin. Emails cannot be mapped by hand; they must match. | Tickets, Mine, Hours | 1 + 2 | iTop admin, TAMs | 

| 6 | Time Tracking extension installed (free from the iTop store, iTop 3.2.0+) and TAMs logging time on tickets in iTop.Entries live on User Requests and Incidents only. Entries older than 30 days cannot be deleted in iTop, so late corrections are edits, not deletions. Option 2 writes entries into it. | Hours | 1 + 2 | iTop admin, TAMs | 

| 7 | Webhook integration extension (in iTop Community since 3.0) with one trigger, "on ticket update", calling Solvro's `/webhook/itop` with a shared-secret header.Without it, tickets are at most 5 minutes stale. With it, seconds. Matters more in Option 2, where two TAMs may work the same board. | Speed | 1 + 2 | iTop admin | 

| 8 | A personal token per TAM (My Account → Personal tokens, scope REST/JSON), and either the `REST Services` profile on each TAM or the configuration parameter `allow_rest_services_via_tokens` set to true.This is what puts the TAM's name on every write. TAMs must be allowed to manage their own tokens, or the admin creates them. | Actions | 2 | iTop admin, each TAM | 

| 9 | Write rights on each TAM's iTop user: a profile that can modify User Requests and Incidents (Support Agent or Service Desk Agent), including bulk write, which REST requires.Most TAMs who already work tickets in iTop have this. Solvro adds no rights: what a TAM cannot do in iTop, they cannot do from Solvro. | Actions | 2 | iTop admin | 

| 10 | The lifecycle rules of your iTop install: which fields are mandatory on assign (team and agent), on resolve (resolution code and solution), on pending (pending reason), and any custom states or approval steps.Solvro mirrors them as the sheets in screen 5. A rule Solvro does not know shows as iTop's error text, so this list is worth getting right before Phase 5. | Actions | 2 | iTop admin | 

## Unknowns to settle

 These change the build, so they come before the plan. Answer in any order.

 1Option 1 or Option 2?
Option 1 ships first either way. The answer decides whether Phases 5–7 go into the plan now.

 2Which iTop version and edition runs today?
3.2.1 or later gives tokens. Older needs the password fallback first.

 3Is the Time Tracking extension installed, and do TAMs log time in iTop already?
If not, the Utilization page ships empty until they do. Tickets still work.

 4Are TAMs the agents on the tickets, or does a service-desk team own them?
Decides whether "Mine" is a useful filter, and in Option 2 whether TAMs may resolve at all.

 5Do iTop organisation names match the customer names in Solvro?
If most do, the mapping table is a 5-minute job. If none do, the admin maps every customer once.

 6Who may see another TAM's hours?
Proposed: holders of the Executive permission. A new permission is the alternative.

 7Only User Requests and Incidents, or also Changes and Work Orders?
Time Tracking covers the first two only. Changes would be tickets-only.

 8Option 2Writes as each TAM, or as one shared "Solvro" account?
Per TAM: a token each, real names in iTop's history, iTop's own rights apply. Shared: one token, "Solvro" in every log entry, and Solvro must enforce who may do what.

 9Option 2Operational tickets only, or do you mean project tasks too?
The proposal keeps project tasks in Solvro. iTop cannot hold planned dates, dependencies or baselines, so moving them would lose the Gantt.

## Defaults to confirm

 Each one has a proposed answer. Say "ok" to take all 8, or change the ones you want. Defaults 6 to 8 only matter if Option 2 is chosen.

 1The application token only reads. "Open in iTop" is a link; "Add to note" writes a Solvro note.
Keeps one owner per fact. In Option 2, writes use personal tokens, never this one.

 2Snapshot every 5 minutes, plus a Refresh button. Pages read Solvro's own database.
No page waits on iTop. An iTop outage shows as "synced 40 min ago", not as a broken page.

 3Work Logs becomes Utilization, in the sidebar after Weekly Sync. Every TAM sees their own hours; Executive-permission holders see all.
Same route file, renamed as the 2026-07 note suggested.

 4Tickets live with the customer: a Tickets tab on the customer page and a strip on the Daily Review operations card. Nothing on the project page.
Tickets belong to an organisation in iTop, not to a project.

 5Capacity is 40 h per TAM per week, one number in Admin.
Enough for a utilisation bar. Per-person capacity can come later.

 6Option 2Writes carry the TAM's identity through a personal token pasted in Settings. No token means read-only for that user.
iTop's history stays honest and iTop's own rights apply. Solvro adds no permissions of its own for tickets.

 7Option 2An action waits for iTop's answer. No optimistic move. On failure the card snaps back and shows iTop's message. Nothing is queued for later.
A queued write that fails an hour later is the two-owner trap through the back door.

 8Option 2Project tasks stay in Solvro. Tickets live on the customer board. A task may create a ticket and show its status; it never becomes one.
Keeps the Gantt, dependencies and baselines, which iTop cannot hold.

## Build sketch

 Each phase is its own branch and PR into `develop`. Phases 1–4 are Option 1 and are useful alone. Phases 5–7 turn it into Option 2 without rework. The plan comes after the unknowns are settled.

- Connection, snapshot, and the Tickets tab.Admin iTop tab, sync job, snapshot tables, customer mapping, Tickets table. Needs items 1–5 from iTop.

- Daily Review strip and "Add to note".Reads the same snapshot. No new iTop access.

- Utilization page.TimeSpent in the sync, the week table, Me / By TAM / By customer. Needs item 6.

- Webhook nudge and the task ticket chip.A public `/webhook/itop` route with a shared secret, and one optional ref field on a task. Needs item 7 for the first half.

- Personal tokens and the write path.Settings token field, encrypted storage, token check, the backend action route, and on the panel: log entry, assign to me, pending, resolve, close, reopen. Needs items 8–10.

- The Board and the sheets.Board view of the Tickets tab on the vendored Kanban engine with iTop's columns; the resolve, assign and new-ticket sheets driven by item 10.

- Timer and task-to-ticket.Start / stop on the panel creating TimeSpent; "Create ticket" on a Solvro task. Needs item 6.

## Not in either option

- Moving Solvro project tasks into iTop

- A Solvro copy of ticket status as a fact

- Queued or offline writes to iTop

- Our own SLA math (iTop's flags are shown as they are)

- Any export of ticket or hour data

- Editing iTop CMDB objects: CIs, contacts, services

- Ticket attachments

- Pipeline or opportunity links

- Notifications or email

## Sources

- iTop REST/JSON services — endpoint, operations (`core/get`, `core/create`, `core/update`, `core/apply_stimulus`), `key` as OQL, `limit`/`page`, write and bulk-write requirement

- Authentication by token — application and personal tokens, scopes, `Auth-Token` header, REST Services profile or `allow_rest_services_via_tokens`, minimum 3.2.1

- Time Tracking extension — `TimeSpent` fields, User Requests and Incidents only, free, 3.2.0+

- Webhook integrations — triggers, generic webhook action, included in Community since 3.0

- iTop datamodel dictionaries — Ticket and UserRequest field names and states; `time_spent` = "Resolution delay"

 Nothing in this page is code. On approval: answers to the unknowns, then a plan in `docs/plans/itop-integration.md`, then Phase 1 on a new branch.
 Standing decision honoured: `WorkLogs.tsx` stays untouched until that plan exists.
