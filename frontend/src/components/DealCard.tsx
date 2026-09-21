// Won-deal <-> delivery-project handoff (PRD §2.10, M5.24). Two related
// exports live in this one file per the task's own routing:
//
// - `DealCard` — mounted on `pages/views/ProjectOverview.tsx`, scoped to
//   just the Overview tab per PRD §2.10 (finding N9; it lived directly on
//   the always-mounted `ProjectDetail.tsx` shell before, so it rendered on
//   every tab). Shows the Pipeline deal that handed off INTO this project,
//   found client-side via
//   `useOpportunities()` + `find(o => o.projectId === projectId)` rather
//   than a new backend lookup — deliberate: there's exactly one deal per
//   project (the backend transaction sets `Opportunity.projectId` once, on
//   handoff; the only path back to null is `DELETE /projects/:id`, which
//   clears it via `onDelete: SetNull` — its `useDeleteProject` hook
//   invalidates `pipelineKeys.root` so this lookup refreshes), the
//   opportunities list is already fetched everywhere else
//   the Pipeline module needs it, and a project-side "find my linked deal"
//   endpoint would be a second, redundant way to answer the same question
//   `useOpportunities()` already knows. Gated on `pipeline:view` — a
//   delivery-only user (no Pipeline access) never even fires the request
//   (see `DealCardInner` split below), not just never sees the card.
// - `HandoffProjectModal` — mounted from `OpportunityDetail.tsx` (detail
//   page's persistent "Create project" button + the post-won inline offer)
//   and `SolvroPipelineKanban.tsx` (the board's own post-won offer). A thin
//   variant of `ProjectFormModal.tsx`'s form, NOT a reuse of that component
//   — `ProjectFormModal` hard-wires `useCreateProject`/`useUpdateProject`
//   with no submit-override prop, and it's shared delivery-side code this
//   task must not touch for parallel-safety. This duplicates
//   `ProjectFormModal`'s field set, its private `Field` label wrapper (both
//   `ProjectFormModal.tsx` and `OpportunityFormModal.tsx` already carry
//   their own private copy of that one — this is a third, not a new
//   pattern), and its WIP-limits form<->API helpers verbatim. Flagged for
//   the reviewer as the noted duplication the task brief called out.
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AssigneeAvatar } from "./AssigneeAvatar";
import { Modal } from "./Modal";
import { StageChip } from "./StageChip";
import { Alert, AlertDescription } from "@/components/reui/alert";
import { ApiError } from "@/lib/api";
import { hasPermission, useAuth } from "@/lib/auth";
import { computeHandoffDefaults } from "@/lib/handoffDefaults";
import { formatIDR } from "@/lib/pipelineFormat";
import {
  type Opportunity,
  type ProjectStatus,
  type TaskStatus,
  type WipLimits,
  useCustomers,
  useHandoffOpportunity,
  useOpportunities,
  useUsers,
} from "@/lib/queries";

// ─────────────────────────────────────────────────────────────────────────
// DealCard
// ─────────────────────────────────────────────────────────────────────────

interface DealCardProps {
  projectId: number;
}

/**
 * Outer component only runs the `pipeline:view` permission check — the
 * actual `useOpportunities()` call lives in `DealCardInner`, mounted
 * conditionally, so a caller without Pipeline access never fires that
 * request at all (not just renders nothing once it 403s).
 */
export function DealCard({ projectId }: DealCardProps) {
  const { user } = useAuth();
  if (!hasPermission(user, "pipeline:view")) return null;
  return <DealCardInner projectId={projectId} />;
}

// id-ID day formatter for the `wonAt` ISO instant (finding S5) — NOT
// `dayFromIso`/`formatPipelineDate`: that pair's contract is for plain
// "yyyy-MM-dd" UTC-midnight day strings only (Opportunity.deadline/
// requestDate, DateField's own convention), while `wonAt` is a real ISO
// instant (a Prisma DateTime, set to `new Date()` at the moment a deal
// enters WON — backend/src/routes/opportunities.ts's POST /:id/move).
// Feeding an instant through `dayFromIso` would misinterpret it as a plain
// day string and silently render the wrong calendar date around midnight
// in any timezone away from the exact moment `wonAt` was recorded in UTC.
function formatWonAt(wonAt: string): string {
  return new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short", year: "numeric" }).format(
    new Date(wonAt),
  );
}

function DealCardInner({ projectId }: DealCardProps) {
  const { data: deals } = useOpportunities();
  const deal = (deals ?? []).find((d) => d.projectId === projectId);
  if (!deal) return null;

  const wonLabel = deal.wonAt ? formatWonAt(deal.wonAt) : null;

  return (
    <section className="mb-4">
      <p className="mb-1.5 font-display text-label-caps uppercase tracking-widest text-on-surface-variant">
        Linked deal
      </p>
      <Link
        to={`/pipeline/${deal.id}`}
        className="flex flex-col gap-2 rounded-sm border border-outline-variant bg-surface-container-lowest p-3 transition-colors hover:border-primary/40 sm:flex-row sm:items-center sm:justify-between"
      >
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate font-display text-sm font-semibold text-on-surface">
              {deal.title}
            </span>
            <StageChip stage={deal.stage} />
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-on-surface-variant">
            <span className="font-mono text-primary">{formatIDR(deal.dealValue)}</span>
            {wonLabel && <span>Won {wonLabel}</span>}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <AssigneeAvatar user={deal.pic} size="xs" />
          <span className="text-[12px] text-on-surface-variant">
            {deal.pic?.username ?? "Unassigned"}
          </span>
        </div>
      </Link>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// HandoffProjectModal
// ─────────────────────────────────────────────────────────────────────────

const PROJECT_STATUSES: ProjectStatus[] = [
  "PLANNING",
  "ACTIVE",
  "ON_HOLD",
  "COMPLETED",
  "CANCELLED",
];

const WIP_COLUMNS: { id: TaskStatus; label: string }[] = [
  { id: "TODO", label: "To Do" },
  { id: "IN_PROGRESS", label: "In Progress" },
  { id: "DONE", label: "Done" },
];

// Duplicated verbatim from ProjectFormModal.tsx (private there, and this
// task must not edit that shared file — see this file's header doc).
type WipLimitsForm = Record<TaskStatus, string>;

function wipLimitsToForm(limits: WipLimits | null | undefined): WipLimitsForm {
  return {
    TODO: limits?.TODO != null ? String(limits.TODO) : "",
    IN_PROGRESS: limits?.IN_PROGRESS != null ? String(limits.IN_PROGRESS) : "",
    DONE: limits?.DONE != null ? String(limits.DONE) : "",
  };
}

function formToWipLimits(form: WipLimitsForm): WipLimits {
  const toLimit = (v: string): number | null => {
    const n = Number(v);
    return v.trim() !== "" && Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
  };
  return { TODO: toLimit(form.TODO), IN_PROGRESS: toLimit(form.IN_PROGRESS), DONE: toLimit(form.DONE) };
}

interface HandoffProjectModalProps {
  open: boolean;
  onClose: () => void;
  /** The WON deal being handed off. `null` is a valid transient state (e.g.
   * the caller cleared its "which deal" state on close) — the modal just
   * renders nothing until both `open` and `deal` are set. */
  deal: Opportunity | null;
}

/**
 * Thin variant of `ProjectFormModal`'s create form, POSTing through
 * `useHandoffOpportunity` instead of `useCreateProject`. Diverges from
 * `ProjectFormModal` in one deliberate way: the Technical Account Manager
 * field is ALWAYS shown and required here (not gated behind an admin-only
 * `canPickTam` check, and not left optional). The backend's handoff route
 * (`POST /opportunities/:id/handoff`) actually mirrors plain project
 * creation's leniency — an omitted `tamId` defaults to the caller — but
 * silently applying that default here would be the wrong call for THIS
 * flow specifically: the person completing a handoff is typically the SA,
 * not the TAM who'll actually own the delivery project, so defaulting to
 * "the caller becomes TAM" would misassign ownership more often than not.
 * Requiring an explicit pick tightens the backend's own leniency on
 * purpose, rather than reproducing it.
 */
export function HandoffProjectModal({ open, onClose, deal }: HandoffProjectModalProps) {
  const navigate = useNavigate();
  const { data: users, isSuccess: usersLoaded } = useUsers();
  const { data: customers, isSuccess: customersLoaded } = useCustomers();
  const handoff = useHandoffOpportunity(deal?.id ?? "");

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saId, setSaId] = useState<number | "">("");
  const [tamId, setTamId] = useState<number | "">("");
  const [customerId, setCustomerId] = useState<number | "">("");
  const [status, setStatus] = useState<ProjectStatus>("PLANNING");
  const [wipLimits, setWipLimits] = useState<WipLimitsForm>(wipLimitsToForm(null));
  const [excludeFromPortfolio, setExcludeFromPortfolio] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Guards the prefill effect below so it runs exactly once per modal open
  // (finding S4), keyed on the deal's id and cleared when the modal
  // closes. Without this, the effect's old deps (`customers`/`users` — the
  // query DATA itself) meant ANY background refetch of either list while
  // the modal sat open — e.g. TanStack's own refetch-on-window-focus —
  // re-ran the whole prefill and silently overwrote whatever the user had
  // already typed. The deps below deliberately track only the
  // loading->success EDGE (`usersLoaded`/`customersLoaded`) and `deal?.id`,
  // never the data arrays themselves — mirrors `ProjectFormModal.tsx`'s own
  // `[open, project, user]` effect shape: re-run only on the thing that
  // should actually reset the form, not on every render its data
  // dependencies churn.
  const prefilledDealId = useRef<string | null>(null);

  useEffect(() => {
    if (!open) {
      prefilledDealId.current = null;
      return;
    }
    if (!deal) return;
    if (!usersLoaded || !customersLoaded) return;
    if (prefilledDealId.current === deal.id) return;
    prefilledDealId.current = deal.id;

    setError(null);
    const defaults = computeHandoffDefaults(deal, customers ?? [], users ?? []);
    setName(defaults.name);
    setDescription(defaults.description);
    setSaId(defaults.saId);
    setCustomerId(defaults.customerId);
    // No handoff-side default for tamId (unlike ProjectFormModal's regular
    // create flow, which defaults an admin-hidden field to the current
    // user) — the deal carries no TAM-shaped field to prefill from, so this
    // stays a deliberate manual pick every time.
    setTamId("");
    setStatus("PLANNING");
    setWipLimits(wipLimitsToForm(null));
    setExcludeFromPortfolio(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberately excludes `customers`/`users` (the query DATA) so a mid-edit refetch never re-runs this and stomps user input; see prefilledDealId's doc comment above.
  }, [open, deal?.id, usersLoaded, customersLoaded]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (!deal) return;
    if (!name.trim()) {
      setError("Name is required.");
      return;
    }
    if (customerId === "") {
      setError("Customer is required.");
      return;
    }
    if (tamId === "") {
      setError("Technical Account Manager is required.");
      return;
    }

    try {
      const result = await handoff.mutateAsync({
        name: name.trim(),
        description: description.trim() || undefined,
        saId: saId === "" ? undefined : Number(saId),
        tamId: Number(tamId),
        customerId: Number(customerId),
        status,
        wipLimits: formToWipLimits(wipLimits),
        excludeFromPortfolio,
      });
      onClose();
      navigate(`/projects/${result.project.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Handoff failed.");
    }
  }

  const submitting = handoff.isPending;
  const users_ = users ?? [];
  const customers_ = customers ?? [];

  return (
    <Modal
      open={open && deal !== null}
      onClose={onClose}
      title="Create delivery project"
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded-lg border border-outline-variant px-4 py-1.5 text-xs font-semibold text-on-surface-variant hover:bg-surface-container disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            form="handoff-project-form"
            disabled={submitting}
            className="rounded-lg bg-primary px-4 py-1.5 text-xs font-bold text-on-primary hover:bg-primary/90 disabled:opacity-60"
          >
            {submitting ? "Creating…" : "Create project"}
          </button>
        </>
      }
    >
      <form id="handoff-project-form" onSubmit={handleSubmit} className="space-y-4">
        {deal && (
          <p className="text-[12px] text-on-surface-variant">
            From deal <span className="font-semibold text-on-surface">{deal.title}</span>
          </p>
        )}

        <Field label="Name" required>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={200}
            autoFocus
            className="w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-2 text-sm text-on-surface focus:border-primary focus:outline-hidden focus:ring-2 focus:ring-primary/30"
          />
        </Field>

        <Field label="Description">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            maxLength={2000}
            className="w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-2 text-sm text-on-surface focus:border-primary focus:outline-hidden focus:ring-2 focus:ring-primary/30"
          />
        </Field>

        <Field label="Customer" required>
          <select
            value={customerId === "" ? "" : String(customerId)}
            onChange={(e) => setCustomerId(e.target.value === "" ? "" : Number(e.target.value))}
            className="w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-2 text-sm text-on-surface focus:border-primary focus:outline-hidden focus:ring-2 focus:ring-primary/30"
          >
            <option value="">
              {customers_.length === 0
                ? "No customers — create one in the Customers tab first"
                : "Select customer…"}
            </option>
            {customers_.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Solution Architect">
            <select
              value={saId === "" ? "" : String(saId)}
              onChange={(e) => setSaId(e.target.value === "" ? "" : Number(e.target.value))}
              className="w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-2 text-sm text-on-surface focus:border-primary focus:outline-hidden focus:ring-2 focus:ring-primary/30"
            >
              <option value="">No SA</option>
              {users_.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.username}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Technical Account Manager" required>
            <select
              value={tamId === "" ? "" : String(tamId)}
              onChange={(e) => setTamId(e.target.value === "" ? "" : Number(e.target.value))}
              className="w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-2 text-sm text-on-surface focus:border-primary focus:outline-hidden focus:ring-2 focus:ring-primary/30"
            >
              <option value="">Select TAM…</option>
              {users_.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.username}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <Field label="Status">
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as ProjectStatus)}
            className="w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-2 text-sm text-on-surface focus:border-primary focus:outline-hidden focus:ring-2 focus:ring-primary/30"
          >
            {PROJECT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.replace("_", " ")}
              </option>
            ))}
          </select>
        </Field>

        <Field label="WIP limit — leave empty for none">
          <div className="grid grid-cols-3 gap-3">
            {WIP_COLUMNS.map((col) => (
              <label key={col.id} className="block">
                <span className="mb-1 block text-[11px] text-on-surface-variant">{col.label}</span>
                <input
                  type="number"
                  min={1}
                  step={1}
                  inputMode="numeric"
                  value={wipLimits[col.id]}
                  onChange={(e) => setWipLimits((prev) => ({ ...prev, [col.id]: e.target.value }))}
                  placeholder="—"
                  className="w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-2 py-1.5 text-sm text-on-surface focus:border-primary focus:outline-hidden focus:ring-2 focus:ring-primary/30"
                />
              </label>
            ))}
          </div>
        </Field>

        <label className="flex cursor-pointer items-start gap-2">
          <input
            type="checkbox"
            checked={excludeFromPortfolio}
            onChange={(e) => setExcludeFromPortfolio(e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
          />
          <span className="min-w-0">
            <span className="block text-[12px] font-bold uppercase tracking-wider text-on-surface-variant">
              Administrative project
            </span>
            <span className="block text-[11px] text-on-surface-variant">
              Exclude from portfolio roll-ups (Executive dashboard, Overview, overdue monitoring). The
              project stays fully usable here.
            </span>
          </span>
        </label>

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
      </form>
    </Modal>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[12px] font-bold uppercase tracking-wider text-on-surface-variant">
        {label}
        {required && <span className="ml-1 text-error">*</span>}
      </span>
      {children}
    </label>
  );
}
