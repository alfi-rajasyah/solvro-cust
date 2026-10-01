import type { ReactNode } from "react";
import { CopyLinkButton } from "@/components/CopyLinkButton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { fmtWeek } from "@/lib/formatDate";
import { WEEKLY_STATUS_LABEL } from "@/lib/labels";
import type {
  CustomerDetail,
  ProjectSummary,
  WeeklyUpdate,
} from "@/lib/queries";

// Header strip of the customer account page: name, who owns the account, and
// one health line rolled up from the nested `projects[].health` blocks
// (GET /customers/:id). `health` is optional on the type, so a project
// without one simply adds nothing to the totals.

export interface AccountHealthTotals {
  overdue: number;
  openRisks: number;
  /** Projects with status ACTIVE (not the linked-project total). */
  activeProjects: number;
}

export function sumProjectHealth(projects: ProjectSummary[]): AccountHealthTotals {
  let overdue = 0;
  let openRisks = 0;
  let activeProjects = 0;
  for (const p of projects) {
    overdue += p.health?.overdueCount ?? 0;
    openRisks += p.health?.openRiskCount ?? 0;
    if (p.status === "ACTIVE") activeProjects += 1;
  }
  return { overdue, openRisks, activeProjects };
}

/** True when every profile field the account page asks for is filled in. */
export function isProfileComplete(customer: CustomerDetail): boolean {
  return (
    customer.description.trim().length > 0 &&
    Boolean(customer.accountManager) &&
    Boolean(customer.solutionArchitect) &&
    customer.services.length > 0 &&
    customer.projects.length > 0
  );
}

function Person({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className="inline-flex min-w-0 items-baseline gap-1.5">
      <span className="font-display text-label-caps uppercase text-on-surface-variant">
        {label}
      </span>
      <span className="truncate text-sm font-medium text-on-surface">{children}</span>
    </span>
  );
}

function Dot() {
  return (
    <span aria-hidden="true" className="text-on-surface-variant">
      ·
    </span>
  );
}

export function AccountHeader({
  customer,
  itopOrgName,
  totals,
  lastUpdate,
  updatesLoaded,
  canMutate,
  canDelete,
  onEdit,
  onDelete,
  deleting,
}: {
  customer: CustomerDetail;
  /** Set only when iTop is configured and this customer is mapped to an organisation. */
  itopOrgName: string | null;
  totals: AccountHealthTotals;
  lastUpdate: WeeklyUpdate | null;
  /** False while the weekly-update query is still loading (avoids a "none yet" flash). */
  updatesLoaded: boolean;
  canMutate: boolean;
  /** Owner-only (server: 403 owner_only) — false hides the ⋯ menu that holds Delete. */
  canDelete: boolean;
  onEdit: () => void;
  onDelete: () => void;
  deleting: boolean;
}) {
  const complete = isProfileComplete(customer);

  return (
    <header className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between md:gap-4">
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <h1 className="truncate font-display text-xl font-bold text-on-surface">
            {customer.name}
          </h1>
          {complete && (
            <span
              className="material-symbols-outlined shrink-0 text-[19px] text-chip-emerald-text"
              title="Profile complete"
              role="img"
              aria-label="Profile complete"
            >
              check_circle
            </span>
          )}
        </div>

        <div className="mt-1.5 flex flex-wrap items-baseline gap-x-5 gap-y-1">
          <Person label="AM">{customer.accountManager || "—"}</Person>
          <Person label="SA">{customer.solutionArchitect || "—"}</Person>
          <Person label="TAM">{customer.tam ? customer.tam.username : "—"}</Person>
          {itopOrgName !== null && <Person label="iTop org">{itopOrgName}</Person>}
        </div>

        <p
          className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs tabular-nums text-on-surface-variant"
          data-testid="account-health-line"
        >
          <span>
            {totals.activeProjects} active {totals.activeProjects === 1 ? "project" : "projects"}
          </span>
          <Dot />
          <span className={totals.overdue > 0 ? "font-semibold text-error" : undefined}>
            {totals.overdue} overdue
          </span>
          <Dot />
          <span>
            {totals.openRisks} open {totals.openRisks === 1 ? "risk" : "risks"}
          </span>
          <Dot />
          {lastUpdate ? (
            <span>
              Weekly update {fmtWeek(lastUpdate.weekStart)} ·{" "}
              {WEEKLY_STATUS_LABEL[lastUpdate.status]}
            </span>
          ) : (
            <span>{updatesLoaded ? "No weekly update yet" : "Weekly update…"}</span>
          )}
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-2 self-end md:self-auto">
        <CopyLinkButton
          label="Copy link"
          className="h-8 w-8 rounded-lg border border-outline-variant bg-surface-container-lowest hover:bg-surface-container"
        />
        {canMutate && (
          <>
          <button
            type="button"
            onClick={onEdit}
            className="inline-flex items-center gap-2 rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-1.5 font-display text-xs font-bold text-on-surface hover:bg-surface-container"
          >
            <span className="material-symbols-outlined text-base">edit</span>
            Edit
          </button>
          {canDelete && (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <button
                  type="button"
                  aria-label="More customer actions"
                  title="More customer actions"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-outline-variant bg-surface-container-lowest text-on-surface-variant outline-hidden transition-colors hover:bg-surface-container hover:text-on-surface focus-visible:ring-2 focus-visible:ring-primary/30"
                >
                  <span className="material-symbols-outlined text-base" aria-hidden="true">
                    more_horiz
                  </span>
                </button>
              }
            />
            {/* z-50 on the Positioner (frontend/CLAUDE.md "Popover z-index"). */}
            <DropdownMenuContent
              align="end"
              className="w-48 bg-surface-container-lowest shadow-overlay!"
              positionerClassName="z-50"
            >
              <DropdownMenuItem
                variant="destructive"
                disabled={deleting}
                onClick={onDelete}
                className="text-xs"
              >
                <span className="material-symbols-outlined text-base" aria-hidden="true">
                  delete
                </span>
                Delete customer
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          )}
          </>
        )}
      </div>
    </header>
  );
}
