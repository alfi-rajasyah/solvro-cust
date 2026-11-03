// One source for "may this viewer create an iTop ticket for this customer, and
// if not, why": read by TaskTicketField's panel row, the List's Ticket column
// and the row menus, so they cannot drift. Read-only viewers (no task:write)
// get `{ canCreate: false, reason: null }` — nothing there is theirs to fix.
// The customer-mapping request (GET /itop/customers/:id/tickets, needs
// customer:read) is made only after the cheap reasons (no customer, no customer:write, actions
// off, no personal token, no customer:read) have passed.
import { useMemo } from "react";
import { hasPermission, useAuth } from "@/lib/auth";
import { useItopCustomerMapped, useItopStatus, useMyItopToken } from "@/lib/queries";
import { resolveCreateGate, type CreateGate, type MappingState } from "./createGate";

const NONE: CreateGate = { canCreate: false, reason: null, fix: null };

export function useCanCreateItopTicket(
  customerId: number | null,
  customerName: string | null = null,
): CreateGate {
  const { user } = useAuth();
  const { data: status } = useItopStatus();
  const { data: myToken, isSuccess: tokenKnown } = useMyItopToken();
  const writer = hasPermission(user, "task:write");
  const canViewCustomers = hasPermission(user, "customer:read");
  const canWriteCustomers = hasPermission(user, "customer:write");
  const isAdmin = hasPermission(user, "*");
  const configured = status?.configured ?? false;
  const actionsEnabled = status?.actionsEnabled ?? false;
  const hasToken = myToken?.set ?? false;

  const cheapPass = customerId !== null && canWriteCustomers && actionsEnabled && hasToken && canViewCustomers;
  const mappingQuery = useItopCustomerMapped(customerId, { enabled: writer && configured && cheapPass });
  const mapping: MappingState = mappingQuery.isError
    ? "error"
    : !mappingQuery.known
      ? "loading"
      : mappingQuery.mapped
        ? "mapped"
        : "unmapped";

  return useMemo(() => {
    if (!writer || !configured || !tokenKnown || !status) return NONE;
    return resolveCreateGate({ customerId, customerName, actionsEnabled, hasToken, canViewCustomers, canWriteCustomers, mapping, isAdmin });
  }, [writer, configured, tokenKnown, status, customerId, customerName, actionsEnabled, hasToken, canViewCustomers, canWriteCustomers, mapping, isAdmin]);
}
