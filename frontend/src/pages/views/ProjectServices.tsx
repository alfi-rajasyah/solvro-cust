import { useMemo, useState } from "react";
import { useProjectContext } from "../ProjectDetail";
import { Alert, AlertDescription } from "@/components/reui/alert";
import { CardGridSkeleton } from "@/components/skeletons";
import { ServiceMappingList } from "@/components/services/ServiceMappingList";
import { ApiError } from "@/lib/api";
import { hasPermission, useAuth } from "@/lib/auth";
import {
  type ServiceAssignmentInput,
  useCustomer,
  useUpdateProjectServices,
} from "@/lib/queries";

export function ProjectServices() {
  const { project } = useProjectContext();
  const { user } = useAuth();
  const canMutate = hasPermission(user, "project:write");

  const update = useUpdateProjectServices(project.id);
  const { data: customer, isLoading: customerLoading } = useCustomer(project.customerId);
  const [addAllError, setAddAllError] = useState<string | null>(null);

  const subscribedServiceIds = useMemo(() => {
    if (!project.customerId || !customer) return undefined;
    return new Set(customer.services.map((a) => a.serviceId));
  }, [project.customerId, customer]);

  // Subscribed services not yet assigned at the project level — the set the
  // "Add all subscribed" bulk action fills in, carrying over the customer's
  // per-service tools for each newly-added row.
  const missingSubscribed = useMemo(() => {
    if (!customer) return [];
    const assignedIds = new Set(project.services.map((a) => a.serviceId));
    return customer.services.filter((a) => !assignedIds.has(a.serviceId));
  }, [customer, project.services]);

  const showAddAll = canMutate && Boolean(customer) && missingSubscribed.length > 0;

  async function handleAddAllSubscribed() {
    if (missingSubscribed.length === 0) return;
    setAddAllError(null);
    const merged: ServiceAssignmentInput[] = [
      ...project.services.map((a) => ({ serviceId: a.serviceId, tools: a.tools })),
      ...missingSubscribed.map((a) => ({ serviceId: a.serviceId, tools: a.tools })),
    ];
    try {
      await update.mutateAsync(merged);
    } catch (err) {
      setAddAllError(
        err instanceof ApiError ? err.message : "Could not add subscribed services.",
      );
    }
  }

  return (
    <div className="flex flex-col gap-4 md:min-h-0 md:flex-1">
      {showAddAll && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="font-display text-[12px] font-bold uppercase tracking-wider text-on-surface-variant">
            Bulk actions
          </p>
          <button
            type="button"
            onClick={handleAddAllSubscribed}
            disabled={update.isPending}
            className="inline-flex items-center gap-2 rounded-sm border border-outline-variant bg-surface-container-lowest px-3 py-1.5 font-display text-xs font-bold text-on-surface hover:bg-surface-container disabled:opacity-60"
          >
            <span className="material-symbols-outlined text-base">playlist_add</span>
            Add all subscribed
          </button>
        </div>
      )}

      {addAllError && (
        <Alert variant="destructive">
          <AlertDescription>{addAllError}</AlertDescription>
        </Alert>
      )}

      <div className="md:min-h-0 md:flex-1 md:overflow-y-auto">
        {customerLoading ? (
          <CardGridSkeleton count={4} />
        ) : (
          <ServiceMappingList
            assignments={project.services}
            onSave={(assignments) => update.mutateAsync(assignments)}
            canMutate={canMutate}
            saving={update.isPending}
            subscribedServiceIds={subscribedServiceIds}
            title="Services in Scope"
            description="Select the services in play for this engagement and the tools used for each. Services the customer subscribes to are badged."
          />
        )}
      </div>
    </div>
  );
}
