// Static content for the in-app Help page (pages/Help.tsx). Pure module, no
// React import, so the filter below stays unit-testable in the node-env
// Vitest config (same pattern as navCommands.ts). Keep every UI string quoted
// here identical to the label in the code it describes — when a feature's
// label changes, update its entry in the same change.
//
// Deliberately absent: the /tasks page (hidden from the sidebar by design),
// note visibility (no UI control), backend-only operations, and the customer
// page's placeholder tabs (Topology, Organization Structure, Documents).

export interface HelpEntry {
  title: string;
  /** Rendered as a bullet list. */
  points: string[];
}

export interface HelpShortcut {
  keys: string[];
  action: string;
}

export interface HelpTopic {
  /** Anchor id — /help#<id> deep-links to the topic. */
  id: string;
  title: string;
  icon: string;
  summary: string;
  /** Page the topic describes; rendered as an "Open …" link. */
  route?: string;
  /** Permission required to see the topic; "*" restricts to admin wildcard. */
  requires?: string;
  entries: HelpEntry[];
  shortcuts?: HelpShortcut[];
}

export const HELP_TOPICS: readonly HelpTopic[] = [
  {
    id: "getting-started",
    title: "Getting started",
    icon: "explore",
    summary:
      "Solvro is the delivery workspace for TAMs: projects, tasks, daily notes, and weekly customer updates in one place.",
    entries: [
      {
        title: "Sign in",
        points: [
          "Use your work Google account. Password sign-in sits under \"Admin sign-in (password)\".",
          "A first Google sign-in creates your account without a role. An admin assigns your role in Admin › Users.",
          "If you see \"This account has been deactivated\", ask an admin to reactivate it.",
        ],
      },
      {
        title: "Find your way around",
        points: [
          "The left sidebar lists every page you have access to. Collapse it with the menu button at its top; on a phone, open it with the menu button in the top bar.",
          "Press ⌘K (Ctrl+K on Windows/Linux) or use search in the top bar (the search icon on a phone) to jump to a page, project, task, or customer. Type at least 2 characters.",
          "On a project page, the top bar reads \"Projects / <project name>\" with the project's status. Click \"Projects\" to go back to the list.",
          "Your avatar menu (top right) holds Settings and \"Sign out\".",
        ],
      },
      {
        title: "Appearance and install",
        points: [
          "Switch between light and dark with the sun/moon button in the top bar, or pick Light, Dark, or System in Settings.",
          "Solvro installs as an app. On Chrome or Android, use \"Install Solvro\" in the banner; on iPhone, use \"Add to Home Screen\" from Safari's share menu.",
        ],
      },
      {
        title: "Who can do what",
        points: [
          "Your role decides what you can change. \"Manage projects\" lets you create and edit projects, customers, sections, risks, notes, and weekly updates. \"Manage tasks\" lets you create, edit, move, and delete tasks.",
          "Without a permission, the matching buttons do not appear. Ask an admin if you need more access.",
          "You see projects where you are the TAM and every project of a customer you own. Roles with \"See all projects\" see every project.",
        ],
      },
    ],
  },
  {
    id: "overview",
    title: "Overview",
    icon: "dashboard",
    route: "/overview",
    summary: "Your landing page: a snapshot of every project you can see.",
    entries: [
      {
        title: "What it shows",
        points: [
          "Counters for Active Projects, Open Tasks, Completed, and Total tasks.",
          "\"Portfolio timeline\": a year calendar of your projects. Use the arrows to change the year.",
          "\"Projects needing attention\": up to 6 projects, overdue ones first. \"View all →\" opens the Projects page.",
          "\"Recent notes\": project and operations notes from the last 7 days. Add notes on the Daily Review page.",
          "Projects marked \"Administrative project\" are left out of the counters, the timeline, and the attention list.",
        ],
      },
    ],
  },
  {
    id: "projects",
    title: "Projects",
    icon: "folder_managed",
    route: "/projects",
    summary: "Create projects, open one to plan and track it, and lock a baseline to measure slip.",
    entries: [
      {
        title: "Create or edit a project",
        points: [
          "Click \"New project\" on the Projects page. Name and Customer are required — create the customer first on the Customers page.",
          "Set a WIP limit per Kanban column if you want the board to warn when a column is too full. Leave a field empty for no limit.",
          "Tick \"Administrative project\" for internal work that should stay out of the Overview, Executive, and overdue roll-ups.",
          "Inside a project, use \"Edit project\" or \"Delete project\" at the top. Delete removes all of the project's tasks, sections, labels, notes, risks, and reviews, and cannot be undone.",
          "Filter the Projects page by customer with the \"Customer is …\" chip, or from a customer card's \"View projects →\".",
        ],
      },
      {
        title: "Project tabs",
        points: [
          "Overview: counters, the Progress S-Curve, tasks that need attention, status breakdown, top risks, and recent notes.",
          "List, Kanban, Gantt, and Timeline: four views of the same tasks — see \"Project views\".",
          "Risks: the risk register. Services: the services and tools in scope.",
        ],
      },
      {
        title: "Context panel and baseline",
        points: [
          "Click \"Context\" to open the right panel with status, stakeholders, baseline, export, and documents.",
          "\"Lock baseline\" saves a snapshot of every task's dates. You can backdate it with \"Baseline as-of date\". \"Reset baseline\" overwrites or clears it.",
          "With a baseline, the Overview S-Curve shows planned vs. actual progress and \"Slip\", the Gantt can show ghost bars, and the Daily Review shows days ahead or behind.",
          "\"Export schedule\" (while the Gantt tab is open) downloads Excel or PDF. Use \"View\" to open the PDF in a new tab if a download hangs.",
        ],
      },
    ],
  },
  {
    id: "project-views",
    title: "Project views",
    icon: "view_kanban",
    summary: "List, Kanban, Gantt, and Timeline show the same tasks. A change in one view appears in all of them.",
    entries: [
      {
        title: "List",
        points: [
          "Tasks grouped by section. Use \"Add section\", \"Add task\", and \"Reorder sections\" in the toolbar.",
          "Drag a row by its handle to reorder it or move it to another section.",
          "Change the assignee, due date, priority, and status directly in the row. Click the priority flag to cycle Low → Medium → High; set Urgent from the task form.",
          "Each section's menu can rename, duplicate, or delete it. Deleting a section keeps its tasks.",
          "Click a row to open the task panel.",
        ],
      },
      {
        title: "Kanban",
        points: [
          "Columns To Do, In Progress, and Done. Drag cards between or within columns.",
          "Use \"Filter\" to show one assignee or priority. Use \"Add task\" or a column's \"Add task here\".",
          "A column count turns amber when it goes over its WIP limit.",
          "On a phone, swipe between columns and move a card with its \"Card options\" button and the \"Move to\" sheet.",
        ],
      },
      {
        title: "Gantt (desktop only)",
        points: [
          "Zoom with Day, Week, Month, and Quarter. Use Today and the arrows to move through time.",
          "Drag a bar to move a task, or drag its ends to change the dates. Drag rows in the left tree to reorder tasks and sections.",
          "Drag from a bar's dot onto another bar to create a dependency. Hover a dependency line and click ⊗ to delete it.",
          "\"Color by\" colors bars by Status, Section, or Priority. \"Baseline\" shows the locked baseline as ghost bars.",
          "A row's \"…\" menu (or right-click) can edit, duplicate, add a subtask, mark Critical Path, or delete. Weekends and Indonesian public holidays are shaded.",
        ],
      },
      {
        title: "Timeline",
        points: [
          "Top-level tasks as a vertical timeline, sorted by start date. Change a task's status with its one-click buttons. Click a title to edit the task.",
          "This is a phase-level read of the plan; the Gantt is the task-level view where you change dates.",
        ],
      },
    ],
  },
  {
    id: "tasks",
    title: "Tasks",
    icon: "task_alt",
    summary: "Open a task to edit it, split it into subtasks, and discuss it in comments.",
    entries: [
      {
        title: "Create a task",
        points: [
          "Use \"Add task\" in the List or Kanban, or \"+ Task\" in the Gantt. Only the title is required.",
          "Set priority, status, assignee, dates, section, parent task, labels, and description in the form. The due date must be on or after the start date.",
        ],
      },
      {
        title: "The task panel",
        points: [
          "Clicking a task in the List, Kanban, Overview, or search opens the panel on the right. Press Esc to close it.",
          "Click any field to change it: title, assignee, dates, priority, type, Critical Path, section, labels.",
          "Type switches between a normal task and a Milestone (a diamond on the Gantt).",
          "Critical Path is a manual flag for tasks whose slip moves the project end date.",
          "\"Task options\" can duplicate or delete the task. Deleting a task also deletes its subtasks.",
        ],
      },
      {
        title: "Subtasks, labels, and comments",
        points: [
          "Add subtasks at the bottom of the panel. Tick one to mark it done; drag to reorder. Subtasks go one level deep.",
          "Click a label to toggle it. \"+ Label\" creates a new project label with a color.",
          "Write in \"Write a comment…\" and send to discuss the task. Comment counts show on Kanban cards.",
          "Link an iTop ticket from the task's \"iTop ticket\" field — see \"iTop tickets\".",
        ],
      },
    ],
  },
  {
    id: "risks",
    title: "Risks",
    icon: "warning",
    summary: "Track what could go wrong on a project, how likely it is, and what you will do about it.",
    entries: [
      {
        title: "Manage risks",
        points: [
          "Open a project's Risks tab and click \"Add risk\".",
          "Set Probability and Impact from 1 to 5. Score = Probability × Impact: up to 8 is Low, up to 15 is Medium, above 15 is High.",
          "Record a mitigation plan and a contingency plan, and move the status through Open, Mitigated, and Closed.",
          "Search, filter by category or status, and change probability, impact, or status directly in the table.",
          "Open risks also appear on the project Overview and in the Daily Review.",
        ],
      },
    ],
  },
  {
    id: "customers",
    title: "Customers",
    icon: "groups",
    route: "/customers",
    summary: "Every project belongs to a customer. The customer page gathers its projects, services, weekly updates, and tickets.",
    entries: [
      {
        title: "Create and manage customers",
        points: [
          "Click \"New customer\". Name and Description are required. Account Manager is free text; pick the Solution Architect from the user list.",
          "The TAM owns the customer. If you hand a customer to another TAM, you can lose access to it unless one of its projects is yours.",
          "Deleting a customer keeps its projects; they lose the customer link.",
        ],
      },
      {
        title: "Customer page",
        points: [
          "Overview: a profile-completion checklist, services, weekly-update history for the last 52 weeks, and the customer's projects.",
          "Services: which catalogue services the customer subscribes to, with their tools.",
          "Tickets: the customer's iTop tickets, when the customer is linked to an iTop organisation.",
        ],
      },
      {
        title: "Services and tools",
        points: [
          "Tick a service to include it; type a tool name and press Enter or \",\" to add it. Backspace removes the last tool.",
          "On a project's Services tab, \"Add all subscribed\" brings in every service the customer subscribes to.",
          "You can add a new service to the catalogue from the bottom of the list. Manage the full catalogue in Settings.",
        ],
      },
    ],
  },
  {
    id: "daily-review",
    title: "Daily Review",
    icon: "edit_note",
    route: "/daily-review",
    summary: "Your daily routine: walk through each customer's active projects, write a note, and mark them reviewed.",
    entries: [
      {
        title: "Daily notes",
        points: [
          "Projects are grouped by customer. Each project card shows schedule status, progress, overdue tasks, and open risks.",
          "Write what happened today in the note box and click \"Save note\" (or press ⌘/Ctrl+Enter).",
          "Nothing happened? Click \"Mark reviewed\" instead.",
          "Use the \"Operations\" card for customer issues outside any project. Operations notes need a title.",
          "You can edit only your own notes. Admins can delete any note.",
        ],
      },
      {
        title: "Navigate the week",
        points: [
          "Use the week arrows to move between weeks; the day strip shows how many customers have a note each day.",
          "\"Show week\" on a card shows the notes of the other days. Add a missed day with \"Add\".",
          "A customer group collapses on its own when every project is reviewed today and its weekly update is done.",
          "Projects without a customer sit under \"No customer\". Their notes work, but they have no weekly update.",
        ],
      },
      {
        title: "Weekly updates from here",
        points: [
          "Each customer has a weekly sync row with \"Mid-week sync\" and \"Reflection sync\" buttons — see \"Weekly Sync\".",
          "When iTop is connected, the \"iTop today\" strip shows new, resolved, and SLA-breached tickets. \"Add to note\" copies a ticket into today's operations note.",
        ],
      },
    ],
  },
  {
    id: "weekly-sync",
    title: "Weekly Sync",
    icon: "table_chart",
    route: "/weekly-sync",
    summary: "One update per customer per week: a mid-week check on Wednesday and a reflection on Friday, read together on Monday.",
    entries: [
      {
        title: "Write the updates",
        points: [
          "Open \"Mid-week sync\" or \"Reflection sync\" from the Daily Review, or click a customer's row on the Weekly Sync page.",
          "Mid-week: set Health (Green, Amber, Red), a one-line category, and highlights with a risk and an action. \"Draft from Mon–Wed notes\" builds highlights from your daily notes.",
          "Reflection: list achievements with outstanding issues, lessons learned, next-week focus, and any manager decision needed. \"Draft from this week\" builds a draft from your notes.",
          "The mid-week dialog saves with \"Save mid-week\". In the reflection dialog, \"Save draft\" keeps working and \"Mark done\" needs a health value and at least one achievement; a done week can be reopened as a draft.",
          "⌘/Ctrl+Enter runs the main button of either dialog.",
        ],
      },
      {
        title: "Read the tables",
        points: [
          "The page opens on the table you most likely need: last week's Reflection on Monday, this week's Mid-week Tuesday to Thursday, this week's Reflection from Friday.",
          "Customers with a manager decision are pinned first under \"Needs a manager decision\".",
          "\"Copy as table\" copies the table for pasting into email or a document.",
        ],
      },
    ],
  },
  {
    id: "itop",
    title: "iTop tickets",
    icon: "confirmation_number",
    summary: "When your admin connects iTop, Solvro shows each customer's tickets and lets you act on them. iTop stays the owner of every ticket.",
    entries: [
      {
        title: "Before you start",
        points: [
          "To act on tickets, save your own iTop personal token in Settings › iTop. Create it in iTop under My Account › Personal tokens.",
          "Without a token, tickets are read-only for you. Every change goes to iTop under your own name.",
          "An admin must also turn on \"Actions from Solvro\". If it is off, the ticket screens tell you so.",
        ],
      },
      {
        title: "Work with tickets",
        points: [
          "Open a customer's Tickets tab. Switch between Table and Board, and filter by Incidents or Requests. The Table view also filters by Ongoing, Resolved this week, and Mine.",
          "On the Board, drag a card to change its state: to Assigned to take it, to Pending (needs a reason), to Resolved (needs a resolution code and solution), or to Closed. A card moves only after iTop accepts the change.",
          "Click a ticket to open its panel: take actions, read and add public or private log entries, and \"Open in iTop ↗\".",
          "\"New ticket\" creates a user request or incident in iTop.",
          "\"Refresh from iTop\" fetches the latest tickets now.",
        ],
      },
      {
        title: "Time and task links",
        points: [
          "In a ticket panel, \"Start timer\" tracks time; \"Stop\" logs it to iTop. Only one timer runs at a time, and the running timer shows in the top bar.",
          "Link a task to a ticket from the task panel's \"iTop ticket\" field with its ref (e.g. R-004512), or \"Create in iTop\" from the task.",
        ],
      },
    ],
  },
  {
    id: "utilization",
    title: "Utilization",
    icon: "schedule",
    route: "/utilization",
    summary: "Hours logged per customer per day, read from iTop's time tracking.",
    entries: [
      {
        title: "Read your hours",
        points: [
          "\"Me\" shows your own week. Users with Executive access also get \"By TAM\" and \"By customer\".",
          "Move between weeks with the arrows. Solvro keeps the last 8 weeks of time entries.",
          "The tiles show \"Hours logged\" against your weekly capacity (the bar turns amber at capacity), \"Customers touched\", and hours \"Not tied to a customer\".",
          "Hours come from iTop. To change a number, edit the time entry in iTop, then click \"Refresh from iTop\".",
        ],
      },
    ],
  },
  {
    id: "executive",
    title: "Executive",
    icon: "leaderboard",
    route: "/executive",
    requires: "report:executive",
    summary: "An org-wide, read-only roll-up of every TAM's projects.",
    entries: [
      {
        title: "What it shows",
        points: [
          "\"Overdue Projects\": every project past its committed end, with its TAM and how late it is.",
          "\"Portfolio Timelines\": every project as a Calendar or a List with progress bars.",
          "Administrative projects are left out.",
        ],
      },
    ],
  },
  {
    id: "settings",
    title: "Settings",
    icon: "settings",
    route: "/settings",
    summary: "Your appearance, profile, iTop token, password, and the service catalogue.",
    entries: [
      {
        title: "Your account",
        points: [
          "Appearance: Light, Dark, or System (follows your device).",
          "Profile shows your username, email, and role. Only an admin can change them.",
          "Change password: at least 8 characters, different from the current one.",
          "iTop: save or remove your personal token (shown when iTop is connected).",
        ],
      },
      {
        title: "Service Catalogue",
        points: [
          "Users who manage projects can add, edit, deactivate, and delete catalogue services here.",
          "Deleting a service removes it from every customer and project that uses it.",
        ],
      },
    ],
  },
  {
    id: "admin",
    title: "Admin",
    icon: "admin_panel_settings",
    route: "/admin",
    requires: "*",
    summary: "Manage users, roles, sign-in, project ownership, and the iTop connection.",
    entries: [
      {
        title: "Users and roles",
        points: [
          "Users: assign roles (new Google users arrive as \"Needs role\"), deactivate or reactivate, reset passwords, delete, or add a user.",
          "Roles: create custom roles and tick their permissions. Built-in roles are reserved; a role with users cannot be deleted.",
        ],
      },
      {
        title: "Sign-in and ownership",
        points: [
          "Sign-in: connect Google sign-in with a client ID and the allowed email domains.",
          "Project Override: reassign the TAM of any project.",
        ],
      },
      {
        title: "iTop",
        points: [
          "Enter the iTop URL and the application token, then \"Test connection\". The application token only reads.",
          "Set the refresh interval, weekly capacity per TAM, and the iTop server timezone (it must match iTop's own setting).",
          "Turn on \"Actions from Solvro\" to let users act on tickets with their personal tokens.",
          "Map customers to iTop organisations (\"Automatch by name\") and users to iTop persons (\"Match now\"). Use \"Sync now\" for an immediate sync.",
          "\"Webhook (optional)\": let iTop notify Solvro of ticket changes, so tickets update in seconds instead of at the next refresh.",
        ],
      },
    ],
  },
  {
    id: "shortcuts",
    title: "Keyboard shortcuts",
    icon: "keyboard",
    summary: "Work faster without the mouse.",
    entries: [],
    shortcuts: [
      { keys: ["⌘K", "Ctrl+K"], action: "Open or close search" },
      { keys: ["↑", "↓", "Enter"], action: "Move through and open search results" },
      { keys: ["Esc"], action: "Close a dialog, the search, or the task or ticket panel" },
      { keys: ["⌘Enter", "Ctrl+Enter"], action: "Save a daily note, or run the main button of a sync dialog" },
      { keys: ["Enter"], action: "Add a subtask, a label, or a tool" },
    ],
  },
];

/**
 * Topics visible to a user, narrowed by a free-text query. The permission
 * check is injected (`has`) so this module stays free of React/auth imports.
 */
export function filterHelpTopics(
  has: (permission: string) => boolean,
  query: string,
): HelpTopic[] {
  const q = query.trim().toLowerCase();
  return HELP_TOPICS.filter((t) => {
    if (t.requires && !has(t.requires)) return false;
    if (q === "") return true;
    const haystack = [
      t.title,
      t.summary,
      ...t.entries.flatMap((e) => [e.title, ...e.points]),
      ...(t.shortcuts ?? []).map((s) => s.action),
    ];
    return haystack.some((s) => s.toLowerCase().includes(q));
  });
}
