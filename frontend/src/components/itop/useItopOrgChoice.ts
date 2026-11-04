// Which customer ("organisation") a project's iTop tickets default to, and the
// choices the New-ticket sheet offers (docs/archive/plans/multi-customer-projects.md,
// 7.3). A single-customer project returns its one customer and no choices, so
// it looks and behaves exactly as before. With 2+ linked customers the
// choices are the iTop-mapped ones; the default is the primary when mapped,
// else the first mapped one, else the primary (so the create gate can still
// say "map X to an iTop organisation").
import { useMemo } from "react";
import { hasPermission, useAuth } from "@/lib/auth";
import { useItopMappedCustomerIds, useItopStatus, useMyItopToken } from "@/lib/queries";

export interface ItopOrg {
  id: number;
  name: string;
}

export interface ItopOrgChoice {
  /** Default organisation: feeds `useCanCreateItopTicket` and the sheet's initial pick. */
  customerId: number | null;
  customerName: string | null;
  /** Organisations the sheet lets the user pick from; empty unless 2+ are iTop-mapped. */
  organisations: ItopOrg[];
  /** Name of the default org when the picker is hidden but it is not the primary (shown read-only in the sheet). */
  organisationLabel: string | null;
}

export function pickItopOrgs(
  customers: readonly { id: number; name: string; isPrimary: boolean }[],
  mappedIds: ReadonlySet<number>,
): ItopOrgChoice {
  const primary = customers.find((c) => c.isPrimary) ?? customers[0] ?? null;
  if (customers.length <= 1) {
    return { customerId: primary?.id ?? null, customerName: primary?.name ?? null, organisations: [], organisationLabel: null };
  }
  const mapped = customers.filter((c) => mappedIds.has(c.id));
  const fallback = primary && mappedIds.has(primary.id) ? primary : (mapped[0] ?? primary);
  const organisations = mapped.length >= 2 ? mapped.map((c) => ({ id: c.id, name: c.name })) : [];
  return {
    customerId: fallback?.id ?? null,
    customerName: fallback?.name ?? null,
    organisations,
    organisationLabel: organisations.length === 0 && fallback && fallback.id !== primary?.id ? fallback.name : null,
  };
}

export function useItopOrgChoice(
  customers: readonly { id: number; name: string; isPrimary: boolean }[],
): ItopOrgChoice {
  const { user } = useAuth();
  const { data: status } = useItopStatus();
  const { data: myToken } = useMyItopToken();
  const shared = customers.length > 1;
  // Same cheap predicates as useCanCreateItopTicket: no lookups unless creating is possible at all.
  const cheapPass =
    hasPermission(user, "task:write") &&
    hasPermission(user, "customer:write") &&
    hasPermission(user, "customer:read") &&
    (status?.configured ?? false) &&
    (status?.actionsEnabled ?? false) &&
    (myToken?.set ?? false);
  const { mappedIds } = useItopMappedCustomerIds(shared ? customers.map((c) => c.id) : [], {
    enabled: shared && cheapPass,
  });
  const key = `${customers.map((c) => `${c.id}:${c.isPrimary ? 1 : 0}:${c.name}`).join("|")}#${[...mappedIds].sort().join(",")}`;
  // Keyed by content so callers can use the result as a stable memo dependency.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => pickItopOrgs(customers, mappedIds), [key]);
}
