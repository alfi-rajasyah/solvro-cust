import { useMemo, useState, type FormEvent, type KeyboardEvent } from "react";
import { EmptyState } from "@/components/EmptyState";
import { Alert, AlertDescription } from "@/components/reui/alert";
import { ApiError } from "@/lib/api";
import {
  type ServiceAssignmentInput,
  useCreateService,
  useServices,
} from "@/lib/queries";

export interface ServiceMappingListProps {
  /** Current saved set for the entity being edited (customer or project). */
  assignments: { serviceId: number; tools: string[] }[];
  /** Full-replace semantics: called with the complete next assignment list. */
  onSave: (next: ServiceAssignmentInput[]) => Promise<unknown>;
  canMutate: boolean;
  saving: boolean;
  /** When provided (project context): badge these services as "Subscribed" and sort them first. */
  subscribedServiceIds?: Set<number>;
  /** Copy overrides so customer/project screens can keep distinct headings. */
  title: string;
  description: string;
}

/**
 * Reusable service-catalogue mapping UI: checkbox rows to assign/unassign a
 * service, a chip-input tools editor per assigned row, and an inline
 * "Add service" form so new catalogue entries don't require a trip to Admin.
 *
 * Shared by CustomerDetail's Services tab and ProjectDetail's Services tab.
 */
export function ServiceMappingList({
  assignments,
  onSave,
  canMutate,
  saving,
  subscribedServiceIds,
  title,
  description,
}: ServiceMappingListProps) {
  const { data: catalogue, isLoading } = useServices();
  const create = useCreateService();
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");

  const assignmentByServiceId = useMemo(() => {
    const m = new Map<number, { serviceId: number; tools: string[] }>();
    for (const a of assignments) m.set(a.serviceId, a);
    return m;
  }, [assignments]);

  // Subscribed-first (when subscribedServiceIds is present), then by name.
  const sortedCatalogue = useMemo(() => {
    if (!catalogue) return [];
    const list = [...catalogue];
    list.sort((a, b) => {
      if (subscribedServiceIds) {
        const aSub = subscribedServiceIds.has(a.id) ? 0 : 1;
        const bSub = subscribedServiceIds.has(b.id) ? 0 : 1;
        if (aSub !== bSub) return aSub - bSub;
      }
      return a.name.localeCompare(b.name);
    });
    return list;
  }, [catalogue, subscribedServiceIds]);

  // Build the full assignment list for an idempotent PUT, optionally
  // overriding one service's tools or toggling a service's presence.
  function buildAssignments(
    serviceId: number,
    intent: "toggle" | "set-tools",
    tools?: string[],
  ): ServiceAssignmentInput[] {
    const out: ServiceAssignmentInput[] = [];
    const wasAssigned = assignmentByServiceId.has(serviceId);
    for (const a of assignments) {
      if (a.serviceId === serviceId && intent === "toggle" && wasAssigned) continue; // remove
      if (a.serviceId === serviceId && intent === "set-tools") {
        out.push({ serviceId, tools: tools ?? [] });
      } else {
        out.push({ serviceId: a.serviceId, tools: a.tools });
      }
    }
    if (intent === "toggle" && !wasAssigned) {
      out.push({ serviceId, tools: [] });
    }
    return out;
  }

  async function toggle(serviceId: number) {
    if (!canMutate) return;
    setError(null);
    try {
      await onSave(buildAssignments(serviceId, "toggle"));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not update services.");
    }
  }

  async function setTools(serviceId: number, tools: string[]) {
    if (!canMutate) return;
    setError(null);
    try {
      await onSave(buildAssignments(serviceId, "set-tools", tools));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not update tools.");
    }
  }

  async function handleAdd(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (!newName.trim()) return;
    try {
      const created = await create.mutateAsync({
        name: newName.trim(),
        description: newDesc.trim() || undefined,
      });
      await onSave([
        ...assignments.map((a) => ({ serviceId: a.serviceId, tools: a.tools })),
        { serviceId: created.id, tools: [] },
      ]);
      setNewName("");
      setNewDesc("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create service.");
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-display text-[13px] font-bold uppercase tracking-wider text-on-surface">
          {title}
        </h2>
        <p className="text-[12px] text-on-surface-variant">{description}</p>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {isLoading ? (
        <div className="h-24 animate-pulse rounded-sm border border-outline-variant bg-surface-container-low" />
      ) : !catalogue || catalogue.length === 0 ? (
        <EmptyState
          icon="category"
          message="No services yet — add the first one below."
        />
      ) : (
        <div className="space-y-1.5">
          {sortedCatalogue.map((s) => {
            const assignment = assignmentByServiceId.get(s.id);
            const assigned = Boolean(assignment);
            const subscribed = subscribedServiceIds?.has(s.id) ?? false;
            return (
              <div
                key={s.id}
                className={[
                  "rounded-sm border px-3 py-2 transition-colors",
                  assigned
                    ? "border-primary bg-primary/5"
                    : "border-outline-variant bg-surface-container-lowest",
                  !s.active ? "opacity-60" : "",
                ].join(" ")}
              >
                <button
                  type="button"
                  disabled={!canMutate || saving}
                  onClick={() => toggle(s.id)}
                  className={[
                    "flex w-full items-center justify-between gap-3 text-left text-sm",
                    canMutate ? "" : "cursor-default",
                  ].join(" ")}
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <span
                      className={[
                        "material-symbols-outlined text-[19px]",
                        assigned ? "text-primary" : "text-on-surface-variant",
                      ].join(" ")}
                    >
                      {assigned ? "check_box" : "check_box_outline_blank"}
                    </span>
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-2 font-medium text-on-surface">
                        {s.name}
                        {!s.active && (
                          <span className="font-display text-label-caps uppercase text-on-surface-variant">
                            inactive
                          </span>
                        )}
                        {subscribed && (
                          <span className="inline-flex items-center rounded-full border border-primary/30 bg-primary/10 px-1.5 py-0.5 font-display text-label-caps uppercase text-primary">
                            Subscribed
                          </span>
                        )}
                      </p>
                      {s.description && (
                        <p className="truncate text-[12px] text-on-surface-variant">
                          {s.description}
                        </p>
                      )}
                    </div>
                  </div>
                </button>

                {assigned && assignment && (
                  <div className="mt-2 border-t border-outline-variant/60 pt-2">
                    <ToolsEditor
                      tools={assignment.tools}
                      canMutate={canMutate}
                      saving={saving}
                      onChange={(next) => setTools(s.id, next)}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {canMutate && (
        <form
          onSubmit={handleAdd}
          className="flex flex-wrap items-end gap-2 rounded-sm border border-outline-variant bg-surface-container-lowest p-3"
        >
          <label className="w-full md:flex-1 md:min-w-[160px]">
            <span className="mb-1 block font-display text-label-caps uppercase text-on-surface-variant">
              Name
            </span>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              maxLength={100}
              placeholder="e.g. Penetration Testing"
              className="w-full rounded-sm border border-outline-variant bg-surface px-2 py-1.5 text-sm focus:border-primary focus:outline-hidden"
            />
          </label>
          <label className="w-full md:flex-2 md:min-w-[240px]">
            <span className="mb-1 block font-display text-label-caps uppercase text-on-surface-variant">
              Description
            </span>
            <input
              type="text"
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              maxLength={1000}
              placeholder="Short blurb shown in the catalogue"
              className="w-full rounded-sm border border-outline-variant bg-surface px-2 py-1.5 text-sm focus:border-primary focus:outline-hidden"
            />
          </label>
          <button
            type="submit"
            disabled={create.isPending || !newName.trim()}
            className="w-full rounded-sm bg-primary px-4 py-1.5 font-display text-xs font-bold text-on-primary hover:bg-primary-container disabled:opacity-60 md:w-auto"
          >
            {create.isPending ? "Adding…" : "Add service"}
          </button>
        </form>
      )}
    </div>
  );
}

function ToolsEditor({
  tools,
  canMutate,
  saving,
  onChange,
}: {
  tools: string[];
  canMutate: boolean;
  saving: boolean;
  onChange: (next: string[]) => void;
}) {
  const [draft, setDraft] = useState("");

  function commit(value: string) {
    const trimmed = value.trim();
    if (!trimmed) return;
    if (tools.some((t) => t.toLowerCase() === trimmed.toLowerCase())) {
      setDraft("");
      return;
    }
    onChange([...tools, trimmed]);
    setDraft("");
  }

  function remove(idx: number) {
    onChange(tools.filter((_, i) => i !== idx));
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      commit(draft);
    } else if (e.key === "Backspace" && draft === "" && tools.length > 0) {
      onChange(tools.slice(0, -1));
    }
  }

  return (
    <div>
      <p className="mb-1 font-display text-label-caps uppercase text-on-surface-variant">
        Tools used
      </p>
      <div className="flex flex-wrap items-center gap-1.5">
        {tools.map((t, i) => (
          <span
            key={`${t}-${i}`}
            className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 font-mono text-[12px] text-primary"
          >
            {t}
            {canMutate && (
              <button
                type="button"
                onClick={() => remove(i)}
                disabled={saving}
                aria-label={`Remove ${t}`}
                className="rounded-full text-primary/70 hover:text-primary disabled:opacity-50"
              >
                <span className="material-symbols-outlined text-[13px]">close</span>
              </button>
            )}
          </span>
        ))}
        {canMutate && (
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            onBlur={() => commit(draft)}
            disabled={saving}
            placeholder={tools.length === 0 ? "e.g. Acronis, Crowdstrike" : "Add tool…"}
            className="min-w-[140px] flex-1 rounded-sm border border-outline-variant bg-surface px-2 py-0.5 text-[12px] focus:border-primary focus:outline-hidden disabled:opacity-50"
          />
        )}
        {!canMutate && tools.length === 0 && (
          <span className="text-[12px] italic text-on-surface-variant">
            No tools listed.
          </span>
        )}
      </div>
    </div>
  );
}
