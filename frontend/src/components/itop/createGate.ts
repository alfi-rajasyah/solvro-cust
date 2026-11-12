// Pure ordering for "why can't I create an iTop ticket here?" — dependency-free
// so the hook (useCanCreateItopTicket.ts) and its unit test share one source of
// truth. The first failing condition wins. Cheap checks come first so the
// customer-mapping request is only made once they pass
// (docs/archive/plans/subtask-itop-tickets.md Task 0).
export type MappingState = "loading" | "error" | "mapped" | "unmapped";

export interface CreateGateInput {
  customerId: number | null;
  customerName: string | null;
  actionsEnabled: boolean;
  hasToken: boolean;
  /** The viewer may manage customers (POST /itop/tickets needs `customer:write`). */
  canWriteCustomers: boolean;
  /** The viewer may read customers (the mapping lookup needs `customer:read`). */
  canViewCustomers: boolean;
  /** The customer's iTop mapping; only meaningful once the cheap checks pass. */
  mapping: MappingState;
  /** The viewer holds the wildcard permission (can reach Admin › iTop). */
  isAdmin: boolean;
}

/** Where a reason can be fixed: `label` is the substring of `reason` to render as a link. */
export interface CreateGateFix {
  label: string;
  to: string;
}

export interface CreateGate {
  canCreate: boolean;
  /** Muted one-line explanation, or null when creation is available or the cause is still loading. */
  reason: string | null;
  fix: CreateGateFix | null;
}

const NONE: CreateGate = { canCreate: false, reason: null, fix: null };

export function resolveCreateGate(input: CreateGateInput): CreateGate {
  if (input.customerId === null) {
    return { canCreate: false, reason: "Add a customer to this project to create tickets", fix: null };
  }
  if (!input.canWriteCustomers) {
    return { canCreate: false, reason: "You need the 'Manage customers' permission to create iTop tickets", fix: null };
  }
  if (!input.actionsEnabled) {
    return input.isAdmin
      ? { canCreate: false, reason: "iTop actions are turned off (Admin › iTop)", fix: { label: "Admin › iTop", to: "/admin?tab=itop" } }
      : { canCreate: false, reason: "iTop actions are turned off. Ask an admin to turn them on", fix: null };
  }
  if (!input.hasToken) {
    return { canCreate: false, reason: "Add your iTop token in Settings", fix: { label: "Settings", to: "/settings?tab=integrations" } };
  }
  if (!input.canViewCustomers) {
    return { canCreate: false, reason: "You need the 'View customers' permission to create iTop tickets", fix: null };
  }
  if (input.mapping === "loading") return NONE;
  if (input.mapping === "error") {
    return { canCreate: false, reason: "Couldn't check the customer's iTop mapping", fix: null };
  }
  if (input.mapping === "unmapped") {
    const name = input.customerName ?? "this customer";
    return input.isAdmin
      ? {
          canCreate: false,
          reason: `Map ${name} to an iTop organisation (Admin › iTop)`,
          fix: { label: "Admin › iTop", to: "/admin?tab=itop" },
        }
      : { canCreate: false, reason: `Ask an admin to map ${name} to an iTop organisation`, fix: null };
  }
  return { canCreate: true, reason: null, fix: null };
}
