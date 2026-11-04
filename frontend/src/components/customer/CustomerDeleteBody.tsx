import type { ProjectCustomerLink } from "@/lib/queries";

interface SharedProject {
  id: number;
  name: string;
  customers: readonly ProjectCustomerLink[];
}

/**
 * The shared projects (2+ customers) that lose `customerId` when it is
 * deleted. Pure, for the confirmation copy and its test.
 */
export function sharedProjectsOf(
  customerId: number,
  projects: readonly SharedProject[],
): { id: number; name: string; heir: string | null }[] {
  return projects
    .filter((p) => p.customers.length > 1 && p.customers.some((c) => c.id === customerId))
    .map((p) => {
      const me = p.customers.find((c) => c.id === customerId);
      // `customers` is primary first, then oldest link first: the first one left is the heir.
      const heir = me?.isPrimary ? (p.customers.find((c) => c.id !== customerId)?.name ?? null) : null;
      return { id: p.id, name: p.name, heir };
    });
}

// Confirmation body for deleting a customer
// (docs/archive/plans/multi-customer-projects.md, decision 3): projects linked
// only to it become unlinked; shared projects just lose this link, and the
// oldest remaining customer becomes their primary when this one was.
export function CustomerDeleteBody({
  name,
  shared,
}: {
  name: string;
  shared: { id: number; name: string; heir: string | null }[];
}) {
  return (
    <div className="space-y-3">
      <p>
        Delete customer &quot;{name}&quot;? Projects linked only to it keep their tasks but become unlinked.
      </p>
      {shared.length > 0 && (
        <div data-testid="customer-delete-shared">
          <p className="mb-1 text-label-caps uppercase text-on-surface-variant">
            Shared projects that lose this customer
          </p>
          <ul className="space-y-1 text-xs">
            {shared.map((p) => (
              <li key={p.id}>
                <span className="font-semibold">{p.name}</span>
                {p.heir && <span className="text-on-surface-variant"> · {p.heir} becomes primary</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
