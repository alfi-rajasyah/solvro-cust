import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import { ConfirmModal } from "@/components/ConfirmModal";
import { Modal } from "@/components/Modal";
import { ProjectStatusChip } from "@/components/StatusChip";
import { Tabs } from "@/components/Tabs";
import { ItopTab } from "@/components/admin/ItopTab";
import { OutlineTab } from "@/components/admin/OutlineTab";
import { ApiError } from "@/lib/api";
import {
  type AdminProject,
  type AdminRole,
  type AdminUser,
  useAdminCreateRole,
  useAdminCreateUser,
  useAdminDeleteRole,
  useAdminDeleteUser,
  useAdminProjects,
  useAdminReassignProject,
  useAdminResetPassword,
  useAdminRoles,
  useAdminSetActive,
  useAdminUpdateRole,
  useAdminUpdateRolePermissions,
  useAdminUsers,
  useAuthSettings,
  useUpdateAuthSettings,
} from "@/lib/queries";
import type { Role } from "@/lib/auth";
import { PERMISSION_CATALOG, useAuth } from "@/lib/auth";
import { copyText } from "@/lib/clipboard";
import { fmtDateTime } from "@/lib/formatDate";
import { personNameSortingFn } from "@/lib/tableSort";
import { DataGrid, DataGridContainer } from "@/components/reui/data-grid/data-grid";
import { DataGridColumnHeader } from "@/components/reui/data-grid/data-grid-column-header";
import { DataGridScrollArea } from "@/components/reui/data-grid/data-grid-scroll-area";
import { DataGridTable } from "@/components/reui/data-grid/data-grid-table";
import { Skeleton } from "@/components/ui/skeleton";

type Tab = "users" | "roles" | "signin" | "projects" | "itop" | "outline";

const TAB_ITEMS: ReadonlyArray<{ key: Tab; label: string }> = [
  { key: "users", label: "Users" },
  { key: "roles", label: "Roles" },
  { key: "signin", label: "Sign-in" },
  { key: "projects", label: "Project Override" },
  { key: "itop", label: "iTop" },
  { key: "outline", label: "Outline" },
];

// Domain regex matches the backend validator (PATCH /admin/settings/auth).
const DOMAIN_PATTERN = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/;

// Stable empty-array reference for the users DataGrid's `data:` while
// useAdminUsers is loading — same rationale as Tasks.tsx's EMPTY_TASKS:
// avoids a fresh `[]` literal (and therefore a new TanStack row model) on
// every render that a `users ?? []` inline fallback would produce.
const EMPTY_USERS: AdminUser[] = [];
// Same rationale as EMPTY_USERS above, for the Roles and Project Override
// tabs' own DataGrids (T1 migration).
const EMPTY_ROLES: AdminRole[] = [];
const EMPTY_PROJECTS: AdminProject[] = [];

export function Admin() {
  const [tab, setTab] = useState<Tab>("users");

  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-outline-variant px-4 py-4 md:px-6">
        <h1 className="font-display text-2xl font-bold tracking-tight text-on-surface">
          Admin
        </h1>
        <p className="mt-1 text-sm text-on-surface-variant">
          Manage users and force-reassign project ownership.
        </p>
        <div className="mt-4 overflow-x-auto">
          <Tabs items={TAB_ITEMS} active={tab} onChange={setTab} />
        </div>
      </header>
      <div className="flex-1 overflow-auto p-4 md:p-6">
        {tab === "users" && <UsersTab />}
        {tab === "roles" && <RolesTab />}
        {tab === "signin" && <SignInTab />}
        {tab === "projects" && <ProjectsTab />}
        {tab === "itop" && <ItopTab />}
        {tab === "outline" && <OutlineTab />}
      </div>
    </div>
  );
}

// ---- Users tab ------------------------------------------------------------

function UsersTab() {
  const { user: currentUser } = useAuth();
  const { data: users, isLoading, isError } = useAdminUsers();
  // Loading-safe fallback (fix round S2): the grid's own `loadingMode`
  // skeleton is now the loading UI (see `isLoading` on <DataGrid> below), so
  // this component no longer blocks its whole render on `isLoading` — every
  // `users`-derived computation below (KPI counts, table data, recordCount)
  // reads through `rows` instead of the possibly-undefined `users` so they
  // render safely (as zero/empty) during the brief window before the first
  // response lands.
  const rows = users ?? EMPTY_USERS;
  const { data: roles } = useAdminRoles();
  const createUser = useAdminCreateUser();
  const deleteUser = useAdminDeleteUser();
  const updateRole = useAdminUpdateRole();
  const setActive = useAdminSetActive();
  const resetPassword = useAdminResetPassword();
  const [deletingUser, setDeletingUser] = useState<AdminUser | null>(null);
  const [resettingUser, setResettingUser] = useState<AdminUser | null>(null);
  const [resetResult, setResetResult] = useState<
    { username: string; tempPassword: string } | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const [newEmail, setNewEmail] = useState("");
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState<Role>("TAM");

  // PENDING is provisioning-only — never offer it as a target in any
  // user-facing dropdown (assignment goes one-way: PENDING → real role).
  const assignableRoles = useMemo<Role[]>(
    () => (roles ?? []).map((r) => r.roleName).filter((r) => r !== "PENDING"),
    [roles],
  );
  // For an existing user, the dropdown must still include their current
  // role (even if it's PENDING) so the select renders without a phantom
  // value mismatch — but it remains the only PENDING option available.
  function roleOptionsFor(currentRole: Role): Role[] {
    return currentRole === "PENDING"
      ? ["PENDING", ...assignableRoles]
      : assignableRoles;
  }

  // No default sort — rows render in the order useAdminUsers returns them,
  // same as the pre-DataGrid table.
  const [sorting, setSorting] = useState<SortingState>([]);

  // `handleRoleChange`/`handleToggleActive`/`handleResetPassword`/
  // `handleDelete` are `function` declarations further down this component —
  // hoisted within the function body, so referencing them here (columns are
  // defined before their textual position) is valid.
  //
  // Not wrapped in useMemo: several cell renderers close over the mutation
  // handlers above, and this table has no resizing/pinning/visibility state
  // (Wave 3 binding decisions leave those off) for a stale/fresh columns
  // identity to disturb — a plain per-render array keeps every handler
  // reference current with zero staleness risk, at negligible cost for an
  // admin-sized user list.
  const columns: ColumnDef<AdminUser>[] = [
    {
      id: "user",
      accessorKey: "username",
      header: ({ column }) => <DataGridColumnHeader column={column} title="User" />,
      // Person column (username) — decision 7 (reui-data-grid.md
      // Checkpoint B) requires every string column to declare an explicit
      // sortingFn. Shared helper: see lib/tableSort.ts for the full
      // ≤10-row auto-detection rationale (also used by CustomerDetail.tsx's
      // own "tam" column).
      sortingFn: personNameSortingFn,
      cell: ({ row }) => (
        <span
          className={[
            "font-medium text-on-surface",
            row.original.active ? "" : "opacity-60",
          ].join(" ")}
        >
          {row.original.username}
        </span>
      ),
      meta: { skeleton: <Skeleton className="h-3.5 w-24" /> },
    },
    {
      id: "email",
      accessorKey: "email",
      header: ({ column }) => <DataGridColumnHeader column={column} title="Email" />,
      // Person column — same shared-helper rationale as "user" above.
      sortingFn: personNameSortingFn,
      cell: ({ row }) => (
        <span
          className={[
            // text-xs (13px, this theme's own --text-xs override — see
            // index.css) replaces the carried-over text-[13px] magic number.
            "text-xs text-on-surface-variant",
            row.original.active ? "" : "opacity-60",
          ].join(" ")}
        >
          {row.original.email}
        </span>
      ),
      meta: { skeleton: <Skeleton className="h-3.5 w-36" /> },
    },
    {
      id: "provider",
      accessorFn: (row) => row.provider,
      header: ({ column }) => <DataGridColumnHeader column={column} title="Provider" />,
      enableSorting: false,
      cell: ({ row }) => (
        <span className={row.original.active ? undefined : "opacity-60"}>
          <ProviderChip provider={row.original.provider} />
        </span>
      ),
      meta: { skeleton: <Skeleton className="h-4 w-16 rounded-full" /> },
    },
    {
      id: "role",
      accessorKey: "role",
      header: ({ column }) => <DataGridColumnHeader column={column} title="Role" />,
      // Not a person column — role names are operator-entered, uppercase
      // ASCII only (create/rename validates `[A-Z0-9_]+`), so the
      // "alphanumeric" built-in is enough. Still explicit per decision 7's
      // ≤10-row auto-detection gap (see "user"/"email" above) — same
      // deliberate choice as Tasks.tsx's project-name column.
      sortingFn: "alphanumeric",
      cell: ({ row }) => {
        const u = row.original;
        const isSelf = currentUser?.id === u.id;
        return (
          <div
            className={["flex items-center gap-2", u.active ? "" : "opacity-60"].join(
              " ",
            )}
          >
            <select
              aria-label={`Role of ${u.username}`}
              value={u.role}
              disabled={isSelf}
              onChange={(e) => handleRoleChange(u, e.target.value as Role)}
              // text-label-caps (12px/700/0.05em) replaces the carried-over
              // text-[12px] font-bold ... tracking-wider combo. Near-exact:
              // size/weight/tracking match the token, but the token also
              // sets line-height 1 where text-[12px] inherited ~1.35 — the
              // select renders ~4px shorter, accepted as a density win.
              // font-bold stays explicit — see data-grid-column-header.tsx's
              // comment on why the token's baked-in weight needs the guard.
              className="rounded-sm border border-outline-variant bg-surface px-2 py-1 font-display text-label-caps uppercase text-on-surface focus:border-primary focus:outline-hidden disabled:cursor-not-allowed disabled:opacity-60"
              title={isSelf ? "You cannot change your own role" : undefined}
            >
              {roleOptionsFor(u.role).map((r) => (
                <option key={r} value={r} disabled={r === "PENDING"}>
                  {r}
                </option>
              ))}
            </select>
            {u.role === "PENDING" && (
              <span
                title="Auto-provisioned via Google. Pick a role above to grant access."
                // No token matches 10px (the smallest named size is
                // text-label-caps at 12px) — left as an arbitrary value per
                // N5 (do not invent a size to fill the gap).
                className="rounded-full bg-chip-amber-bg px-2 py-0.5 font-display text-label-caps leading-4 uppercase text-chip-amber-text"
              >
                Needs role
              </span>
            )}
          </div>
        );
      },
      meta: { skeleton: <Skeleton className="h-6 w-28" /> },
    },
    {
      id: "projects",
      accessorFn: (row) => row.projectsAsTAM,
      header: ({ column }) => (
        <DataGridColumnHeader column={column} title="Projects (TAM)" />
      ),
      cell: ({ row }) => (
        <span className={row.original.active ? undefined : "opacity-60"}>
          {row.original.projectsAsTAM}
        </span>
      ),
      meta: {
        headerClassName: "text-right",
        // text-xs (13px, this theme's own --text-xs override) replaces the
        // carried-over text-[13px] magic number — see the "email" column.
        cellClassName: "text-right font-mono text-xs text-on-surface-variant",
        skeleton: <Skeleton className="ml-auto h-3.5 w-10" />,
      },
    },
    {
      id: "status",
      accessorFn: (row) => (row.active ? 1 : 0),
      header: ({ column }) => <DataGridColumnHeader column={column} title="Status" />,
      cell: ({ row }) => (
        <span
          className={[
            "rounded-full px-2 py-0.5 font-display text-label-caps uppercase",
            row.original.active
              ? "bg-chip-emerald-bg text-chip-emerald-text"
              : "bg-surface-container-high text-on-surface-variant opacity-60",
          ].join(" ")}
        >
          {row.original.active ? "Active" : "Disabled"}
        </span>
      ),
      meta: { skeleton: <Skeleton className="h-4 w-16 rounded-full" /> },
    },
    {
      id: "actions",
      header: ({ column }) => <DataGridColumnHeader column={column} title="Actions" />,
      enableSorting: false,
      cell: ({ row }) => {
        const u = row.original;
        const isSelf = currentUser?.id === u.id;
        return (
          <div
            className={[
              "flex items-center justify-end gap-1",
              u.active ? "" : "opacity-60",
            ].join(" ")}
          >
            <button
              type="button"
              onClick={() => handleToggleActive(u)}
              disabled={isSelf}
              className="rounded-sm px-2 py-1 font-display text-sm text-on-surface-variant hover:bg-surface-container hover:text-on-surface disabled:cursor-not-allowed disabled:opacity-50 font-semibold"
              title={isSelf ? "You cannot deactivate yourself" : undefined}
            >
              {u.active ? "Deactivate" : "Reactivate"}
            </button>
            <button
              type="button"
              onClick={() => setResettingUser(u)}
              disabled={isSelf}
              className="rounded-sm px-2 py-1 font-display text-sm text-on-surface-variant hover:bg-surface-container hover:text-on-surface disabled:cursor-not-allowed disabled:opacity-50 font-semibold"
              title={isSelf ? "Use Settings › Change password for your own account" : undefined}
            >
              Reset password
            </button>
            <button
              type="button"
              onClick={() => setDeletingUser(u)}
              disabled={isSelf || deleteUser.isPending}
              className="rounded-sm px-2 py-1 font-display text-sm text-on-surface-variant hover:bg-error-container hover:text-on-error-container disabled:cursor-not-allowed disabled:opacity-50 font-semibold"
              title={
                isSelf
                  ? "You cannot delete yourself"
                  : "Permanently delete this user"
              }
            >
              Delete
            </button>
          </div>
        );
      },
      meta: {
        headerClassName: "text-right",
        skeleton: <Skeleton className="ml-auto h-6 w-44" />,
      },
    },
  ];

  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getRowId: (row) => String(row.id),
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    // Pagination stays OFF (docs/plans/reui-data-grid.md Checkpoint B,
    // binding for every DataGrid table this phase): no
    // getPaginationRowModel, so the full sorted row model renders.
    // `pageSize` here only sizes the loading-skeleton row count.
    initialState: { pagination: { pageSize: 8 } },
  });

  // Fix round S2: no blocking return on isLoading anymore — Tasks.tsx's own
  // pilot pattern (never blocks the whole page on isLoading, only shows a
  // banner in place of the grid on a genuine isError) is the model. The
  // grid's `isLoading`/`loadingMode="skeleton"` below is the loading UI now,
  // engaging the seven `meta.skeleton` entries in `columns`. isError still
  // short-circuits the whole tab, same as before — a fetch failure means
  // there's nothing else on this tab worth rendering (the KPI strip and
  // create-user form are meaningless without a user list to reconcile
  // against), so this keeps the original full-block behavior for that case.
  if (isError) return <p className="text-error">Failed to load users.</p>;

  async function handleCreate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (!newEmail.trim() || !newUsername.trim() || newPassword.length < 8) return;
    try {
      await createUser.mutateAsync({
        email: newEmail.trim(),
        username: newUsername.trim(),
        password: newPassword,
        role: newRole,
      });
      setNewEmail("");
      setNewUsername("");
      setNewPassword("");
      setNewRole("TAM");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create user.");
    }
  }

  async function handleRoleChange(u: AdminUser, role: Role) {
    setError(null);
    try {
      await updateRole.mutateAsync({ id: u.id, role });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to update role.");
    }
  }

  async function handleToggleActive(u: AdminUser) {
    setError(null);
    try {
      await setActive.mutateAsync({ id: u.id, active: !u.active });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to update status.");
    }
  }

  async function handleDelete(u: AdminUser) {
    setDeletingUser(null);
    setError(null);
    try {
      await deleteUser.mutateAsync(u.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to delete user.");
    }
  }

  async function handleResetPassword(u: AdminUser) {
    setResettingUser(null);
    setError(null);
    try {
      const res = await resetPassword.mutateAsync(u.id);
      setResetResult({ username: u.username, tempPassword: res.tempPassword });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to reset password.");
    }
  }

  const activeCount = rows.filter((u) => u.active).length;
  const adminCount = rows.filter((u) => u.role === "ADMIN").length;
  const pendingCount = rows.filter((u) => u.role === "PENDING").length;
  const customRoleCount = (roles ?? []).filter(
    (r) => !["ADMIN", "TAM", "STAKEHOLDER", "PENDING"].includes(r.roleName),
  ).length;

  return (
    <div className="space-y-4">
      {/* KPI strip */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Ledger fix: em-dash (not the pre-fetch computed zero) while
            `isLoading` — `rows`/`activeCount`/etc. all read through the
            EMPTY_USERS fallback (see `rows` above) so they compute to 0
            before the first response lands, and rendering that 0 as a KPI
            value reads as a real "zero users" flash. The em-dash is
            unambiguously "not loaded yet"; the `rows` fallback wiring itself
            is unchanged (still needed so every other computation below stays
            render-safe). */}
        <AdminKpi label="Users" value={isLoading ? "—" : rows.length} hint={`${activeCount} active · ${adminCount} admins`} icon="group" tone="primary" />
        <AdminKpi label="Pending" value={isLoading ? "—" : pendingCount} hint="Needs role assignment" icon="hourglass_top" tone="amber" />
        <AdminKpi label="Custom roles" value={isLoading ? "—" : customRoleCount} hint={`${(roles ?? []).length} total roles`} icon="shield_person" tone="emerald" />
        <AdminKpi label="Inactive" value={isLoading ? "—" : rows.length - activeCount} hint="Cannot sign in" icon="block" tone="neutral" />
      </div>
      {error && (
        <div className="rounded-sm border border-error/40 bg-error/10 px-3 py-2 text-sm text-error">
          {error}
        </div>
      )}
      {resetResult && (
        <div className="rounded-sm border border-tertiary/40 bg-tertiary/10 px-3 py-3 text-sm text-on-surface">
          <p className="font-display text-[12px] font-bold uppercase tracking-wider text-tertiary">
            Temporary password generated
          </p>
          <p className="mt-1">
            For <strong>{resetResult.username}</strong>:{" "}
            <code className="rounded-sm bg-surface px-1.5 py-0.5 font-mono text-[13px]">
              {resetResult.tempPassword}
            </code>
          </p>
          <p className="mt-1 text-on-surface-variant">
            Share this with the user via a secure channel. It will not be shown again.
          </p>
          <button
            type="button"
            onClick={() => setResetResult(null)}
            className="mt-2 font-display text-sm text-on-surface-variant hover:text-on-surface font-semibold"
          >
            Dismiss
          </button>
        </div>
      )}
      <form
        onSubmit={handleCreate}
        className="flex flex-wrap items-end gap-2 rounded-sm border border-outline-variant bg-surface-container-lowest p-3"
      >
        <label className="w-full md:flex-1 md:min-w-[160px]">
          <span className="mb-1 block font-display text-label-caps uppercase text-on-surface-variant">
            Email
          </span>
          <input
            type="email"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            placeholder="user@example.com"
            className="w-full rounded-sm border border-outline-variant bg-surface px-2 py-1.5 text-sm focus:border-primary focus:outline-hidden"
          />
        </label>
        <label className="w-full md:flex-1 md:min-w-[120px]">
          <span className="mb-1 block font-display text-label-caps uppercase text-on-surface-variant">
            Username
          </span>
          <input
            type="text"
            value={newUsername}
            onChange={(e) => setNewUsername(e.target.value)}
            maxLength={50}
            placeholder="alice"
            className="w-full rounded-sm border border-outline-variant bg-surface px-2 py-1.5 text-sm focus:border-primary focus:outline-hidden"
          />
        </label>
        <label className="w-full md:flex-1 md:min-w-[140px]">
          <span className="mb-1 block font-display text-label-caps uppercase text-on-surface-variant">
            Password (min 8)
          </span>
          <input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            autoComplete="new-password"
            className="w-full rounded-sm border border-outline-variant bg-surface px-2 py-1.5 text-sm focus:border-primary focus:outline-hidden"
          />
        </label>
        <label className="w-full md:w-auto md:min-w-[120px]">
          <span className="mb-1 block font-display text-label-caps uppercase text-on-surface-variant">
            Role
          </span>
          <select
            value={newRole}
            onChange={(e) => setNewRole(e.target.value as Role)}
            className="w-full rounded-sm border border-outline-variant bg-surface px-2 py-1.5 font-display text-[12px] font-bold uppercase tracking-wider text-on-surface focus:border-primary focus:outline-hidden"
          >
            {assignableRoles.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          disabled={
            createUser.isPending ||
            !newEmail.trim() ||
            !newUsername.trim() ||
            newPassword.length < 8
          }
          className="w-full rounded-sm bg-primary px-4 py-1.5 font-display text-xs font-bold text-on-primary hover:bg-primary-container disabled:opacity-60 md:w-auto"
        >
          {createUser.isPending ? "Adding…" : "Add user"}
        </button>
      </form>

      <DataGrid
        table={table}
        recordCount={rows.length}
        isLoading={isLoading}
        loadingMode="skeleton"
        emptyMessage="No users found."
        tableLayout={{
          dense: true,
          rowBorder: true,
          headerBorder: true,
          headerBackground: false,
          // SOLVRO PATCH — see Tasks.tsx's DataGrid pilot (reui-data-grid.md
          // Checkpoint B, decision 6): "fixed" pins every column to
          // TanStack's untouched 150px default, crushing the table instead
          // of sizing columns to content. "auto" restores content-
          // proportional layout, matching the pre-DataGrid table's look.
          width: "auto",
        }}
        tableClassNames={{
          // SOLVRO PATCH — Checkpoint B decision 2: the grid's own
          // `headerBackground` boolean resolves to `bg-muted` →
          // `surface-container`, the wrong token; pinned here instead. No
          // text colour here — every `<th>` already renders
          // `text-muted-foreground` via data-grid-column-header.tsx.
          header: "bg-surface-container-low",
        }}
      >
        {/* SOLVRO PATCH — DataGridContainer's own `border` prop is
            accepted-and-ignored (see data-grid.tsx), so the Level-1 hairline
            (DESIGN.md §4) is carried on this className instead — same
            phase-wide convention as Tasks.tsx's pilot. */}
        <DataGridContainer className="rounded-sm border border-outline-variant bg-surface-container-lowest">
          <DataGridScrollArea>
            <DataGridTable />
          </DataGridScrollArea>
        </DataGridContainer>
      </DataGrid>

      <ConfirmModal
        open={deletingUser !== null}
        onClose={() => setDeletingUser(null)}
        onConfirm={() => deletingUser && void handleDelete(deletingUser)}
        title="Delete user"
        body={`Permanently delete ${deletingUser?.username ?? ""} (${deletingUser?.email ?? ""})? This cannot be undone.`}
        confirmLabel="Delete"
        confirmTone="danger"
        busy={deleteUser.isPending}
      />
      <ConfirmModal
        open={resettingUser !== null}
        onClose={() => setResettingUser(null)}
        onConfirm={() => resettingUser && void handleResetPassword(resettingUser)}
        title="Reset password"
        body={`Reset password for ${resettingUser?.username ?? ""}? Their current password will stop working.`}
        confirmLabel="Reset password"
        confirmTone="warning"
        busy={resetPassword.isPending}
      />
    </div>
  );
}

function ProviderChip({ provider }: { provider: "google" | "password" }) {
  if (provider === "google") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 font-display text-meta font-semibold text-primary dark:bg-primary/20">
        <span aria-hidden="true" className="material-symbols-outlined text-[12px]">mail</span>
        Google
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-surface-container-high px-2 py-0.5 font-display text-meta font-semibold text-on-surface-variant">
      <span aria-hidden="true" className="material-symbols-outlined text-[12px]">key</span>
      Password
    </span>
  );
}

function AdminKpi({
  label,
  value,
  hint,
  icon,
  tone,
}: {
  label: string;
  // "—" while the tab's underlying query is still loading (ledger fix,
  // Admin.tsx:439-444) — every call site passes the computed number once
  // loaded, an em-dash literal until then.
  value: number | string;
  hint?: string;
  icon: string;
  tone: "primary" | "emerald" | "amber" | "neutral";
}) {
  const iconColor =
    tone === "primary"
      ? "text-primary"
      : tone === "emerald"
        ? "text-emerald-600"
        : tone === "amber"
          ? "text-amber-600"
          : "text-on-surface-variant";
  return (
    <div className="rounded-sm border border-outline-variant bg-surface-container-lowest p-4">
      <div className="flex items-center justify-between">
        <span className="text-label-caps uppercase text-on-surface-variant">{label}</span>
        <span aria-hidden="true" className={`material-symbols-outlined text-base ${iconColor}`}>{icon}</span>
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="text-3xl font-bold tabular-nums text-on-surface">{value}</span>
        {hint && <span className="text-meta text-on-surface-variant">{hint}</span>}
      </div>
    </div>
  );
}

// ---- Roles tab ------------------------------------------------------------

// Tick-box editor over the curated PERMISSION_CATALOG. "*" (Full access)
// supersedes the rest: when it's on, the specific permissions show as
// implied + disabled; ticking a specific one drops the wildcard.
function PermissionPicker({
  value,
  onChange,
}: {
  value: string[];
  onChange: (v: string[]) => void;
}) {
  const all = value.includes("*");
  function toggle(perm: string) {
    if (perm === "*") {
      onChange(all ? [] : ["*"]);
      return;
    }
    if (all) {
      onChange([perm]); // selecting a specific permission drops the wildcard
      return;
    }
    onChange(
      value.includes(perm)
        ? value.filter((p) => p !== perm)
        : [...value, perm],
    );
  }
  return (
    <ul className="divide-y divide-outline-variant/60 rounded-sm border border-outline-variant bg-surface">
      {PERMISSION_CATALOG.map((perm) => {
        const isWildcard = perm.value === "*";
        const checked = isWildcard ? all : all || value.includes(perm.value);
        const disabled = all && !isWildcard;
        return (
          <li key={perm.value}>
            <label
              title={perm.hint}
              className={`flex items-center gap-2.5 px-3 py-1.5 text-[13px] ${
                disabled ? "opacity-50" : "cursor-pointer hover:bg-surface-container-low"
              }`}
            >
              <input
                type="checkbox"
                checked={checked}
                disabled={disabled}
                onChange={() => toggle(perm.value)}
                className="accent-primary"
              />
              <span className="font-mono text-on-surface">{perm.value}</span>
              <span className="text-on-surface-variant">— {perm.label}</span>
            </label>
          </li>
        );
      })}
    </ul>
  );
}

function RolesTab() {
  const { data: roles, isLoading, isError } = useAdminRoles();
  // Loading-safe fallback (T1 DataGrid migration — same rationale as
  // UsersTab's own `rows`, "fix round S2"): `useReactTable` below is a hook
  // and must run on every render, so it can no longer sit after a blocking
  // `if (isLoading) return ...` the way the pre-DataGrid table did. `rows`
  // reads through this fallback instead of the possibly-undefined `roles`;
  // the grid's own `isLoading`/`loadingMode="skeleton"` (see <DataGrid>
  // below) is the loading UI now, engaging each column's `meta.skeleton`.
  const rows = roles ?? EMPTY_ROLES;
  const createRole = useAdminCreateRole();
  const updatePerms = useAdminUpdateRolePermissions();
  const deleteRole = useAdminDeleteRole();
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [newPerms, setNewPerms] = useState<string[]>([]);
  const [deletingRole, setDeletingRole] = useState<AdminRole | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editPerms, setEditPerms] = useState<string[]>([]);
  // No default sort — same rationale as the Users-tab pilot: rows render in
  // the order useAdminRoles returns them, same as the pre-DataGrid table.
  const [sorting, setSorting] = useState<SortingState>([]);

  // `startEdit`/`saveEdit`/`handleDelete` are `function` declarations further
  // down this component (hoisted), same forward-reference pattern as
  // UsersTab's own mutation handlers — see that tab's comment.
  //
  // Not wrapped in useMemo, for the same reason as UsersTab's columns: cell
  // renderers close over `editingId`/`editName`/`editPerms` and the mutation
  // handlers, and this table has no resizing/pinning/visibility state for a
  // stale columns identity to disturb.
  const columns: ColumnDef<AdminRole>[] = [
    {
      id: "role",
      accessorKey: "roleName",
      header: ({ column }) => <DataGridColumnHeader column={column} title="Role" />,
      // Role names are operator-entered, uppercase ASCII only (create/rename
      // validates `[A-Z0-9_]+`) — same "alphanumeric" choice as this file's
      // own Users-tab "role" column (decision 7's explicit-sortingFn rule
      // still applies at this table's row count).
      sortingFn: "alphanumeric",
      cell: ({ row }) => {
        const r = row.original;
        const isEditing = editingId === r.id;
        return (
          <>
            {isEditing ? (
              <input
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                disabled={r.builtIn}
                maxLength={50}
                className="w-32 rounded-sm border border-outline-variant bg-surface px-2 py-1 font-mono text-sm uppercase focus:border-primary focus:outline-hidden disabled:opacity-60"
                title={
                  r.builtIn
                    ? "This role is reserved and cannot be renamed"
                    : undefined
                }
              />
            ) : (
              <span className="font-mono font-medium text-on-surface">
                {r.roleName}
              </span>
            )}
            {r.builtIn && (
              <span className="ml-2 rounded-full bg-surface-container-high px-2 py-0.5 font-display text-label-caps leading-4 uppercase text-on-surface-variant">
                Reserved
              </span>
            )}
          </>
        );
      },
      meta: {
        // align-top (not the grid's default align-middle): editing this row
        // can swap the Permissions cell for the multi-row PermissionPicker
        // list, and every other cell in that row should stay pinned to the
        // top instead of centering against that taller content — same as
        // the pre-DataGrid table's own `align-top` on every `<td>`.
        cellClassName: "align-top",
        skeleton: <Skeleton className="h-3.5 w-24" />,
      },
    },
    {
      id: "permissions",
      header: ({ column }) => (
        <DataGridColumnHeader column={column} title="Permissions" />
      ),
      // Renders a chip list or the PermissionPicker editor, not a single
      // sortable value — same "interactive control column" exemption as
      // UsersTab's "provider"/"actions" columns.
      enableSorting: false,
      cell: ({ row }) => {
        const r = row.original;
        const isEditing = editingId === r.id;
        return isEditing ? (
          <PermissionPicker value={editPerms} onChange={setEditPerms} />
        ) : r.permissions.length === 0 ? (
          <span className="text-on-surface-variant/60">—</span>
        ) : (
          <div className="flex flex-wrap gap-1">
            {r.permissions.map((p) => (
              <span
                key={p}
                className={`rounded-sm px-1.5 py-0.5 font-mono text-meta ${
                  p === "*"
                    ? "bg-primary/15 text-primary"
                    : "bg-surface-container-high text-on-surface"
                }`}
              >
                {p === "*" ? "* full access" : p}
              </span>
            ))}
          </div>
        );
      },
      meta: {
        cellClassName: "align-top text-on-surface-variant",
        skeleton: <Skeleton className="h-6 w-40" />,
      },
    },
    {
      id: "users",
      accessorFn: (row) => row.userCount,
      header: ({ column }) => <DataGridColumnHeader column={column} title="Users" />,
      cell: ({ row }) => row.original.userCount,
      meta: {
        headerClassName: "text-right",
        cellClassName:
          "align-top text-right font-mono text-[13px] text-on-surface-variant",
        skeleton: <Skeleton className="ml-auto h-3.5 w-6" />,
      },
    },
    {
      id: "actions",
      header: ({ column }) => <DataGridColumnHeader column={column} title="Actions" />,
      enableSorting: false,
      cell: ({ row }) => {
        const r = row.original;
        const isEditing = editingId === r.id;
        return (
          <div className="flex items-center justify-end gap-1">
            {isEditing ? (
              <>
                <button
                  type="button"
                  onClick={() => saveEdit(r)}
                  disabled={updatePerms.isPending}
                  className="rounded-sm bg-primary px-2 py-1 font-display text-sm text-on-primary hover:bg-primary-container disabled:opacity-50 font-semibold"
                >
                  Save
                </button>
                <button
                  type="button"
                  onClick={() => setEditingId(null)}
                  className="rounded-sm px-2 py-1 font-display text-sm text-on-surface-variant hover:bg-surface-container font-semibold"
                >
                  Cancel
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => startEdit(r)}
                  disabled={r.builtIn}
                  className="rounded-sm px-2 py-1 font-display text-sm text-on-surface-variant hover:bg-surface-container hover:text-on-surface disabled:cursor-not-allowed disabled:opacity-50 font-semibold"
                  title={
                    r.builtIn
                      ? "Reserved role: new Google sign-ins get no permissions until an admin promotes them"
                      : undefined
                  }
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => setDeletingRole(r)}
                  disabled={r.builtIn || r.userCount > 0}
                  className="rounded-sm px-2 py-1 font-display text-sm text-on-surface-variant hover:bg-error-container hover:text-on-error-container disabled:cursor-not-allowed disabled:opacity-50 font-semibold"
                  title={
                    r.builtIn
                      ? "Reserved role"
                      : r.userCount > 0
                        ? "Reassign users first"
                        : undefined
                  }
                >
                  Delete
                </button>
              </>
            )}
          </div>
        );
      },
      meta: {
        headerClassName: "text-right",
        cellClassName: "align-top",
        skeleton: <Skeleton className="ml-auto h-6 w-32" />,
      },
    },
  ];

  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getRowId: (row) => String(row.id),
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    // Pagination stays OFF (Checkpoint B, binding for every DataGrid table
    // this phase). `pageSize` here only sizes the loading-skeleton row count.
    initialState: { pagination: { pageSize: 6 } },
  });

  // Same isError-only short-circuit as UsersTab: a fetch failure means
  // there's nothing else on this tab worth rendering.
  if (isError) return <p className="text-error">Failed to load roles.</p>;

  async function handleCreate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const trimmed = newName.trim().toUpperCase();
    if (!trimmed) return;
    if (!/^[A-Z0-9_]+$/.test(trimmed)) {
      setError("Role name must be uppercase letters, digits, or underscores.");
      return;
    }
    try {
      await createRole.mutateAsync({
        roleName: trimmed,
        permissions: newPerms,
      });
      setNewName("");
      setNewPerms([]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create role.");
    }
  }

  function startEdit(r: AdminRole) {
    setEditingId(r.id);
    setEditName(r.roleName);
    setEditPerms(r.permissions);
    setError(null);
  }

  async function saveEdit(original: AdminRole) {
    if (editingId === null) return;
    setError(null);
    const trimmedName = editName.trim().toUpperCase();
    if (!trimmedName) {
      setError("Role name is required.");
      return;
    }
    if (!/^[A-Z0-9_]+$/.test(trimmedName)) {
      setError("Role name must be uppercase letters, digits, or underscores.");
      return;
    }
    const renamed = trimmedName !== original.roleName;
    try {
      await updatePerms.mutateAsync({
        id: editingId,
        permissions: editPerms,
        ...(renamed ? { roleName: trimmedName } : {}),
      });
      setEditingId(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save role.");
    }
  }

  async function handleDelete(r: AdminRole) {
    setDeletingRole(null);
    setError(null);
    try {
      await deleteRole.mutateAsync(r.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not delete role.");
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm leading-relaxed text-on-surface-variant">
        Create, rename and delete roles; tick permissions.{" "}
        <code className="font-mono text-on-surface">*</code> grants admin
        access.{" "}
        <code className="font-mono text-on-surface">project:view-all</code>{" "}
        reveals every project — without it, users only see projects where
        they're the assigned TAM, or that belong to a customer they own. The
        last full-access admin can't be removed.{" "}
        <code className="font-mono text-on-surface">PENDING</code> is reserved
        (Google first-login landing role).
      </p>

      {error && (
        <div className="rounded-sm border border-error/40 bg-error/10 px-3 py-2 text-sm text-error">
          {error}
        </div>
      )}

      <form
        onSubmit={handleCreate}
        className="space-y-3 rounded-sm border border-outline-variant bg-surface-container-lowest p-3"
      >
        <label className="block">
          <span className="mb-1 block font-display text-label-caps uppercase text-on-surface-variant">
            Role name
          </span>
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            maxLength={50}
            placeholder="e.g. MANAGER"
            className="w-full rounded-sm border border-outline-variant bg-surface px-2 py-1.5 font-mono text-sm uppercase focus:border-primary focus:outline-hidden"
          />
        </label>
        <div>
          <span className="mb-1 block font-display text-label-caps uppercase text-on-surface-variant">
            Permissions
          </span>
          <PermissionPicker value={newPerms} onChange={setNewPerms} />
        </div>
        <div className="flex justify-end">
          <button
            type="submit"
            disabled={createRole.isPending || !newName.trim()}
            className="rounded-sm bg-primary px-4 py-1.5 font-display text-xs font-bold text-on-primary hover:bg-primary-container disabled:opacity-60"
          >
            {createRole.isPending ? "Adding…" : "Add role"}
          </button>
        </div>
      </form>

      <DataGrid
        table={table}
        recordCount={rows.length}
        isLoading={isLoading}
        loadingMode="skeleton"
        emptyMessage="No roles found."
        tableLayout={{
          dense: true,
          rowBorder: true,
          headerBorder: true,
          headerBackground: false,
          // SOLVRO PATCH — see Tasks.tsx's DataGrid pilot (reui-data-grid.md
          // Checkpoint B, decision 6): "auto" sizes columns to content
          // instead of TanStack's untouched 150px "fixed" default.
          width: "auto",
        }}
        tableClassNames={{
          // SOLVRO PATCH — Checkpoint B decision 2: the grid's own
          // `headerBackground` boolean resolves to the wrong token; pinned
          // here instead, same as every other DataGrid table this phase.
          header: "bg-surface-container-low",
        }}
      >
        {/* SOLVRO PATCH — Level-1 hairline (DESIGN.md §4), same phase-wide
            convention as every other DataGrid table. Also resolves the
            ledger's tab-panel background-inconsistency item: this wrapper
            now lands on the same `surface-container-lowest` as the Users
            tab's grid instead of the old `bg-surface`, unifying all three
            tabs' panel treatment. */}
        <DataGridContainer className="rounded-sm border border-outline-variant bg-surface-container-lowest">
          <DataGridScrollArea>
            <DataGridTable />
          </DataGridScrollArea>
        </DataGridContainer>
      </DataGrid>

      <ConfirmModal
        open={deletingRole !== null}
        onClose={() => setDeletingRole(null)}
        onConfirm={() => deletingRole && void handleDelete(deletingRole)}
        title="Delete role"
        body={`Delete role "${deletingRole?.roleName ?? ""}"? It currently has no users.`}
        confirmLabel="Delete"
        confirmTone="danger"
        busy={deleteRole.isPending}
      />
    </div>
  );
}

// ---- Sign-in (OAuth policy) tab -------------------------------------------

const GOOGLE_CLIENT_ID_PATTERN =
  /^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/;

function maskClientId(id: string): string {
  // Show "123…xyz.apps.googleusercontent.com" — enough to recognise, not enough
  // to dictate. The Client ID is technically public (it ships in the bundle),
  // but treating it as private in admin chrome keeps the UI feeling intentional.
  const at = id.indexOf(".apps.googleusercontent.com");
  if (at <= 0) return id;
  const prefix = id.slice(0, at);
  if (prefix.length <= 7) return id;
  return `${prefix.slice(0, 3)}…${prefix.slice(-3)}${id.slice(at)}`;
}

function SignInTab() {
  const { data, isLoading, isError } = useAuthSettings();
  const [modalOpen, setModalOpen] = useState(false);

  if (isLoading) return <p className="text-on-surface-variant">Loading sign-in policy…</p>;
  if (isError || !data) return <p className="text-error">Failed to load sign-in policy.</p>;

  const connected =
    data.googleClientId !== null && data.googleAllowedDomains.length > 0;
  const halfConfigured =
    (data.googleClientId !== null) !== (data.googleAllowedDomains.length > 0);

  return (
    <div className="space-y-4">
      <p className="text-sm text-on-surface-variant">
        Connect Solvro to your company's Google Workspace so employees can sign
        in with their work Google account. The first sign-in auto-creates a{" "}
        <span className="font-mono">PENDING</span> account that you assign a
        role to from the Users tab.
      </p>

      {/* Connection card */}
      <div className="rounded-sm border border-outline-variant bg-surface-container-lowest p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div
              className={[
                "grid h-10 w-10 shrink-0 place-items-center rounded-full",
                connected
                  ? "bg-chip-emerald-bg text-chip-emerald-text"
                  : "bg-surface-container-high text-on-surface-variant",
              ].join(" ")}
            >
              <span aria-hidden="true" className="material-symbols-outlined text-[20px]">
                {connected ? "verified_user" : "lock_open"}
              </span>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-display text-sm font-semibold text-on-surface">
                  Google identity provider
                </span>
                <span
                  className={[
                    "rounded-full px-2 py-0.5 font-display text-label-caps leading-4 font-semibold uppercase",
                    connected
                      ? "bg-chip-emerald-bg text-chip-emerald-text"
                      : halfConfigured
                        ? "bg-chip-amber-bg text-chip-amber-text"
                        : "bg-surface-container-high text-on-surface-variant",
                  ].join(" ")}
                >
                  {connected
                    ? "Connected"
                    : halfConfigured
                      ? "Half configured"
                      : "Not connected"}
                </span>
              </div>
              <p className="mt-0.5 text-xs text-on-surface-variant">
                {connected
                  ? `${data.googleAllowedDomains.length} domain${data.googleAllowedDomains.length === 1 ? "" : "s"} allowed`
                  : "Set a Client ID and at least one allowed email domain to enable Google sign-in."}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setModalOpen(true)}
            className="rounded-sm bg-primary px-4 py-1.5 font-display text-xs font-semibold text-on-primary hover:bg-primary-container"
          >
            {connected ? "Manage" : "Connect"}
          </button>
        </div>

        {connected && (
          <div className="mt-4 grid gap-3 border-t border-outline-variant pt-4 sm:grid-cols-2">
            <ClientIdField id={data.googleClientId!} />
            <div>
              <div className="mb-1 font-display text-label-caps uppercase text-on-surface-variant">
                Allowed domains
              </div>
              <div className="flex flex-wrap gap-1.5">
                {data.googleAllowedDomains.map((d) => (
                  <span
                    key={d}
                    className="rounded-full bg-primary/10 px-2.5 py-0.5 font-mono text-[12px] text-primary dark:bg-primary/20"
                  >
                    {d}
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}

        <div className="mt-4 border-t border-outline-variant pt-3 text-xs text-on-surface-variant">
          {data.updatedBy ? (
            <>
              Last updated by{" "}
              <span className="font-semibold">{data.updatedBy.username}</span>{" "}
              on{" "}
              <span>{fmtDateTime(data.updatedAt)}</span>
            </>
          ) : (
            <>Not yet edited since the database was seeded.</>
          )}
        </div>
      </div>

      <SignInModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        initialClientId={data.googleClientId ?? ""}
        initialDomains={data.googleAllowedDomains}
      />
    </div>
  );
}

// Read-only display for the saved Client ID — masked by default, click-to-reveal.
// Reveal is just a UX nicety; the ID isn't actually secret.
function ClientIdField({ id }: { id: string }) {
  const [revealed, setRevealed] = useState(false);
  return (
    <div>
      <div className="mb-1 flex items-center gap-2">
        <span className="font-display text-label-caps uppercase text-on-surface-variant">
          Client ID
        </span>
        <button
          type="button"
          onClick={() => setRevealed((v) => !v)}
          className="font-display text-xs font-semibold text-on-surface-variant hover:text-on-surface"
        >
          {revealed ? "Hide" : "Reveal"}
        </button>
        <button
          type="button"
          onClick={() => void copyText(id)}
          title="Copy to clipboard"
          className="text-on-surface-variant hover:text-on-surface"
        >
          <span aria-hidden="true" className="material-symbols-outlined text-[14px]">
            content_copy
          </span>
        </button>
      </div>
      <div className="break-all rounded-sm bg-surface px-2 py-1.5 font-mono text-[12px] text-on-surface">
        {revealed ? id : maskClientId(id)}
      </div>
    </div>
  );
}

function SignInModal({
  open,
  onClose,
  initialClientId,
  initialDomains,
}: {
  open: boolean;
  onClose: () => void;
  initialClientId: string;
  initialDomains: string[];
}) {
  const update = useUpdateAuthSettings();
  const [clientId, setClientId] = useState(initialClientId);
  const [domains, setDomains] = useState<string[]>(initialDomains);
  const [newDomain, setNewDomain] = useState("");
  const [showClientId, setShowClientId] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset draft whenever the modal opens, so reopening after Save shows the
  // current server state, not stale local edits.
  useEffect(() => {
    if (open) {
      setClientId(initialClientId);
      setDomains(initialDomains);
      setNewDomain("");
      setShowClientId(false);
      setError(null);
    }
  }, [open, initialClientId, initialDomains]);

  const dirty =
    clientId !== initialClientId ||
    domains.length !== initialDomains.length ||
    domains.some((d, i) => d !== initialDomains[i]);

  function addDomain() {
    setError(null);
    const d = newDomain.trim().toLowerCase();
    if (!d) return;
    if (!DOMAIN_PATTERN.test(d)) {
      setError("Enter a valid hostname (e.g. example.com).");
      return;
    }
    if (domains.includes(d)) {
      setError(`"${d}" is already in the list.`);
      return;
    }
    setDomains([...domains, d]);
    setNewDomain("");
  }

  function removeDomain(d: string) {
    setError(null);
    setDomains(domains.filter((x) => x !== d));
  }

  async function save() {
    setError(null);
    const trimmed = clientId.trim();
    if (trimmed !== "" && !GOOGLE_CLIENT_ID_PATTERN.test(trimmed)) {
      setError(
        "Client ID must look like 123456789-abc.apps.googleusercontent.com.",
      );
      return;
    }
    try {
      await update.mutateAsync({
        googleClientId: trimmed === "" ? null : trimmed,
        googleAllowedDomains: domains,
      });
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save policy.");
    }
  }

  async function disconnect() {
    setConfirmDisconnect(false);
    setError(null);
    try {
      await update.mutateAsync({
        googleClientId: null,
        googleAllowedDomains: [],
      });
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not disconnect.");
    }
  }

  // Modal.tsx's per-instance Escape listener would otherwise close this form
  // together with the disconnect confirm; keep the form open underneath.
  return (
    <>
    <Modal
      open={open}
      onClose={confirmDisconnect ? () => {} : onClose}
      title="Configure Google sign-in"
      widthClass="max-w-xl"
      footer={
        <>
          {(initialClientId || initialDomains.length > 0) && (
            <button
              type="button"
              onClick={() => setConfirmDisconnect(true)}
              disabled={update.isPending}
              className="mr-auto rounded-sm px-3 py-1.5 font-display text-xs font-semibold text-error hover:bg-error-container disabled:opacity-50"
            >
              Disconnect
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            disabled={update.isPending}
            className="rounded-sm px-3 py-1.5 font-display text-xs font-semibold text-on-surface-variant hover:bg-surface-container"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={!dirty || update.isPending}
            className="rounded-sm bg-primary px-4 py-1.5 font-display text-xs font-semibold text-on-primary hover:bg-primary-container disabled:opacity-50"
          >
            {update.isPending ? "Saving…" : "Save"}
          </button>
        </>
      }
    >
      <div className="space-y-5">
        <details className="rounded-sm border border-outline-variant bg-surface-container text-sm">
          <summary className="cursor-pointer px-3 py-2 font-display text-[12px] font-bold uppercase tracking-wider text-on-surface-variant">
            How to get a Client ID
          </summary>
          <ol className="list-decimal space-y-1 border-t border-outline-variant px-6 py-3 text-on-surface-variant">
            <li>
              Google Cloud Console → APIs & Services → Credentials → Create
              credentials → <strong>OAuth 2.0 Client ID</strong> (Web application).
            </li>
            <li>
              Add your app origins under{" "}
              <strong>Authorized JavaScript origins</strong> (e.g.{" "}
              <span className="font-mono">http://localhost:5173</span> for dev,
              plus your production URL — no trailing slash, no path).
            </li>
            <li>
              Copy the Client ID (ends in{" "}
              <span className="font-mono">.apps.googleusercontent.com</span>)
              and paste it below.
            </li>
          </ol>
        </details>

        {error && (
          <div className="rounded-sm border border-error/40 bg-error/10 px-3 py-2 text-sm text-error">
            {error}
          </div>
        )}

        <div>
          <label className="block">
            <span className="mb-1 flex items-center justify-between gap-2">
              <span className="font-display text-label-caps uppercase text-on-surface-variant">
                Google OAuth Client ID
              </span>
              <button
                type="button"
                onClick={() => setShowClientId((v) => !v)}
                className="font-display text-xs font-semibold text-on-surface-variant hover:text-on-surface"
              >
                {showClientId ? "Hide" : "Show"}
              </button>
            </span>
            <input
              type={showClientId ? "text" : "password"}
              value={clientId}
              onChange={(e) => {
                setError(null);
                setClientId(e.target.value);
              }}
              placeholder="123456789-abc.apps.googleusercontent.com"
              spellCheck={false}
              autoComplete="off"
              className="w-full rounded-sm border border-outline-variant bg-surface px-2 py-1.5 font-mono text-sm focus:border-primary focus:outline-hidden"
            />
          </label>
          <p className="mt-1 text-xs text-on-surface-variant">
            The Client ID is a public identifier (it ships in any Google
            sign-in button). The Client <em>Secret</em> stays in Google Cloud
            and is never used by Solvro — we verify ID tokens server-side
            against this audience.
          </p>
        </div>

        <div>
          <div className="mb-1 font-display text-label-caps uppercase text-on-surface-variant">
            Allowed email domains
          </div>
          <div className="flex flex-wrap gap-2">
            {domains.length === 0 && (
              <span className="text-xs text-on-surface-variant">
                No domains yet.
              </span>
            )}
            {domains.map((d) => (
              <span
                key={d}
                className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-3 py-1 font-mono text-[12px] text-primary dark:bg-primary/20"
              >
                {d}
                <button
                  type="button"
                  onClick={() => removeDomain(d)}
                  aria-label={`Remove ${d}`}
                  className="rounded-full p-0.5 text-primary/70 hover:bg-primary/20 hover:text-primary"
                >
                  <span aria-hidden="true" className="material-symbols-outlined text-[14px]">
                    close
                  </span>
                </button>
              </span>
            ))}
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              addDomain();
            }}
            className="mt-3 flex items-end gap-2"
          >
            <input
              type="text"
              value={newDomain}
              onChange={(e) => setNewDomain(e.target.value)}
              placeholder="example.com"
              maxLength={253}
              className="flex-1 rounded-sm border border-outline-variant bg-surface px-2 py-1.5 font-mono text-sm focus:border-primary focus:outline-hidden"
            />
            <button
              type="submit"
              disabled={!newDomain.trim()}
              className="rounded-sm bg-surface-container-high px-3 py-1.5 font-display text-xs font-semibold text-on-surface hover:bg-surface-container-highest disabled:opacity-50"
            >
              Add
            </button>
          </form>
        </div>
      </div>
    </Modal>
    <ConfirmModal
      open={confirmDisconnect}
      onClose={() => setConfirmDisconnect(false)}
      onConfirm={() => void disconnect()}
      title="Disconnect Google sign-in"
      body="Disconnect Google sign-in? Users with Google-only accounts won't be able to sign in until you reconnect."
      confirmLabel="Disconnect"
      confirmTone="warning"
      busy={update.isPending}
    />
    </>
  );
}

// ---- Project Override tab -------------------------------------------------

function ProjectsTab() {
  const { data: projects, isLoading, isError } = useAdminProjects();
  // Loading-safe fallback (T1 DataGrid migration — same rationale as
  // RolesTab's own `rows` above / UsersTab's "fix round S2"): `useReactTable`
  // is a hook and must run on every render, so it now sits above the
  // isLoading check instead of after a blocking early return. The grid's own
  // `isLoading`/`loadingMode="skeleton"` below is the loading UI, engaging
  // each column's `meta.skeleton`.
  const rows = projects ?? EMPTY_PROJECTS;
  const { data: users } = useAdminUsers();
  const reassign = useAdminReassignProject();
  const [error, setError] = useState<string | null>(null);
  // No default sort — same rationale as the Users/Roles-tab pilots.
  const [sorting, setSorting] = useState<SortingState>([]);

  // Any active user can be a project's TAM — no role-name gate (role names
  // no longer drive who's eligible). Admin's choice.
  const tamCandidates = useMemo(
    () => (users ?? []).filter((u) => u.active),
    [users],
  );

  // `handleReassign` is a `function` declaration further down this component
  // (hoisted) — same forward-reference pattern as RolesTab/UsersTab's own
  // mutation handlers.
  //
  // Not wrapped in useMemo, for the same reason as the other two tabs'
  // columns: the "reassign" cell closes over `tamCandidates` and
  // `handleReassign`, and this table has no resizing/pinning/visibility
  // state for a stale columns identity to disturb.
  const columns: ColumnDef<AdminProject>[] = [
    {
      id: "project",
      accessorKey: "name",
      header: ({ column }) => <DataGridColumnHeader column={column} title="Project" />,
      // Same underlying field as Tasks.tsx's/CustomerDetail.tsx's "project"
      // column (Project.name) — mirrors their "alphanumeric" choice
      // (decision 7) for natural number ordering, consistent across the app
      // for the same data.
      sortingFn: "alphanumeric",
      cell: ({ row }) => (
        <span className="font-medium text-on-surface">{row.original.name}</span>
      ),
      meta: { skeleton: <Skeleton className="h-3.5 w-32" /> },
    },
    {
      id: "customer",
      // "" fallback (not null) so the column's cell values stay string —
      // required for the "alphanumeric" comparator, and sorts projects
      // without a linked customer first ascending.
      accessorFn: (row) => row.customer?.name ?? "",
      header: ({ column }) => <DataGridColumnHeader column={column} title="Customer" />,
      // Customer names are entity/company names, not person names — same
      // "alphanumeric" bucket as the "project" column above, not
      // personNameSortingFn (that's reserved for real usernames — see
      // lib/tableSort.ts's own doc comment).
      sortingFn: "alphanumeric",
      cell: ({ row }) => (
        <span className="text-on-surface-variant">
          {row.original.customer?.name ?? "—"}
        </span>
      ),
      meta: { skeleton: <Skeleton className="h-3.5 w-28" /> },
    },
    {
      id: "status",
      accessorKey: "status",
      header: ({ column }) => <DataGridColumnHeader column={column} title="Status" />,
      // Operator-set uppercase ASCII enum (ProjectStatus) — same
      // "alphanumeric" choice as this file's own Users-tab "role" column.
      sortingFn: "alphanumeric",
      cell: ({ row }) => (
        <ProjectStatusChip status={row.original.status} />
      ),
      meta: { skeleton: <Skeleton className="h-4 w-20 rounded-sm" /> },
    },
    {
      id: "tasks",
      accessorFn: (row) => row._count.tasks,
      header: ({ column }) => <DataGridColumnHeader column={column} title="Tasks" />,
      cell: ({ row }) => (
        <span className="font-mono text-[13px] text-on-surface-variant">
          {row.original._count.tasks}
        </span>
      ),
      meta: {
        headerClassName: "text-right",
        cellClassName: "text-right",
        skeleton: <Skeleton className="ml-auto h-3.5 w-6" />,
      },
    },
    {
      id: "reassign",
      header: ({ column }) => (
        <DataGridColumnHeader column={column} title="Current TAM → Reassign" />
      ),
      // An interactive <select>, not a single sortable value — same
      // exemption as UsersTab's "role"/"actions" columns.
      enableSorting: false,
      cell: ({ row }) => {
        const p = row.original;
        return (
          <select
            aria-label={`TAM of ${p.name}`}
            value={p.tamId}
            onChange={(e) => handleReassign(p, Number(e.target.value))}
            className="w-full rounded-sm border border-outline-variant bg-surface px-2 py-1 text-[13px] text-on-surface focus:border-primary focus:outline-hidden"
          >
            {tamCandidates.map((u) => (
              <option key={u.id} value={u.id}>
                {u.username} ({u.role})
              </option>
            ))}
            {/* If the current TAM isn't in the candidate list (inactive or wrong role), show them anyway */}
            {!tamCandidates.some((u) => u.id === p.tamId) && (
              <option value={p.tamId}>{p.tam.username} (current)</option>
            )}
          </select>
        );
      },
      meta: { skeleton: <Skeleton className="h-7 w-40" /> },
    },
  ];

  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getRowId: (row) => String(row.id),
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    // Pagination stays OFF (Checkpoint B, binding for every DataGrid table
    // this phase). `pageSize` here only sizes the loading-skeleton row count.
    initialState: { pagination: { pageSize: 8 } },
  });

  // Same isError-only short-circuit as UsersTab/RolesTab: a fetch failure
  // means there's nothing else on this tab worth rendering.
  if (isError) return <p className="text-error">Failed to load projects.</p>;

  async function handleReassign(p: AdminProject, newTamId: number) {
    if (newTamId === p.tamId) return;
    setError(null);
    try {
      await reassign.mutateAsync({ projectId: p.id, newTamId });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to reassign project.");
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-on-surface-variant">
        Force-reassign the TAM owner of any project. This bypasses the standard
        visibility check.
      </p>
      {error && (
        <div className="rounded-sm border border-error/40 bg-error/10 px-3 py-2 text-sm text-error">
          {error}
        </div>
      )}
      <DataGrid
        table={table}
        recordCount={rows.length}
        isLoading={isLoading}
        loadingMode="skeleton"
        emptyMessage="No projects found."
        tableLayout={{
          dense: true,
          rowBorder: true,
          headerBorder: true,
          headerBackground: false,
          // SOLVRO PATCH — see Tasks.tsx's DataGrid pilot (reui-data-grid.md
          // Checkpoint B, decision 6): "auto" sizes columns to content
          // instead of TanStack's untouched 150px "fixed" default.
          width: "auto",
        }}
        tableClassNames={{
          // SOLVRO PATCH — Checkpoint B decision 2: the grid's own
          // `headerBackground` boolean resolves to the wrong token; pinned
          // here instead, same as every other DataGrid table this phase.
          header: "bg-surface-container-low",
        }}
      >
        {/* SOLVRO PATCH — Level-1 hairline (DESIGN.md §4), same phase-wide
            convention as every other DataGrid table. Also resolves the
            ledger's tab-panel background-inconsistency item: this wrapper
            now lands on the same `surface-container-lowest` as the Users
            (and now Roles) tab's grid instead of the old `bg-surface`,
            unifying all three tabs' panel treatment. */}
        <DataGridContainer className="rounded-sm border border-outline-variant bg-surface-container-lowest">
          <DataGridScrollArea>
            <DataGridTable />
          </DataGridScrollArea>
        </DataGridContainer>
      </DataGrid>
    </div>
  );
}
