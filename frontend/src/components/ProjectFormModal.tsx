import { useEffect, useState, type FormEvent } from "react";
import { Modal } from "./Modal";
import { Alert, AlertDescription } from "@/components/reui/alert";
import { ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { PROJECT_STATUS_LABEL, taskStatusOptions } from "@/lib/labels";
import {
  type ProjectDetail,
  type ProjectStatus,
  type TaskStatus,
  type WipLimits,
  useCreateProject,
  useCustomers,
  useUpdateProject,
  useUsers,
} from "@/lib/queries";

const PROJECT_STATUSES: ProjectStatus[] = [
  "PLANNING",
  "ACTIVE",
  "ON_HOLD",
  "COMPLETED",
  "CANCELLED",
];

const WIP_COLUMNS = taskStatusOptions;

// Form-local representation: each column's limit as the literal <input>
// string value ("" = no limit) so the field can be edited freely without
// fighting number coercion on every keystroke.
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

interface Props {
  open: boolean;
  onClose: () => void;
  /** When supplied, the form opens in edit mode for this project. */
  project?: ProjectDetail | null;
  onSaved?: (id: number) => void;
}

export function ProjectFormModal({ open, onClose, project, onSaved }: Props) {
  const { user } = useAuth();
  const isEdit = Boolean(project);
  const { data: users } = useUsers();
  const { data: customers } = useCustomers();

  const create = useCreateProject();
  const update = useUpdateProject(project?.id ?? 0);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [tamId, setTamId] = useState<number | "">("");
  const [customerId, setCustomerId] = useState<number | "">("");
  const [status, setStatus] = useState<ProjectStatus>("PLANNING");
  const [wipLimits, setWipLimits] = useState<WipLimitsForm>(wipLimitsToForm(null));
  const [excludeFromPortfolio, setExcludeFromPortfolio] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    if (project) {
      setName(project.name);
      setDescription(project.description ?? "");
      setTamId(project.tamId);
      setCustomerId(project.customerId ?? "");
      setStatus(project.status);
      setWipLimits(wipLimitsToForm(project.wipLimits));
      setExcludeFromPortfolio(project.excludeFromPortfolio);
    } else {
      setName("");
      setDescription("");
      setTamId("");
      setCustomerId("");
      setStatus("PLANNING");
      setWipLimits(wipLimitsToForm(null));
      setExcludeFromPortfolio(false);
    }
  }, [open, project, user]);

  // TAM dropdown lists all users — role names no longer gate who's eligible
  // to be assigned (admin's choice). Anti-self-clutter not done here because
  // useUsers() doesn't expose `active`.
  const tams = users ?? [];
  const canPickTam = user?.permissions?.includes("*") ?? false;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError("Name is required.");
      return;
    }
    if (customerId === "") {
      setError("Customer is required.");
      return;
    }

    try {
      if (isEdit && project) {
        await update.mutateAsync({
          name: name.trim(),
          description: description.trim() || null,
          tamId: tamId === "" ? undefined : Number(tamId),
          customerId: Number(customerId),
          status,
          wipLimits: formToWipLimits(wipLimits),
          excludeFromPortfolio,
        });
        onSaved?.(project.id);
      } else {
        const created = await create.mutateAsync({
          name: name.trim(),
          description: description.trim() || undefined,
          tamId: tamId === "" ? undefined : Number(tamId),
          customerId: Number(customerId),
          status,
          wipLimits: formToWipLimits(wipLimits),
          excludeFromPortfolio,
        });
        onSaved?.(created.id);
      }
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Save failed.");
    }
  }

  const submitting = create.isPending || update.isPending;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? "Edit project" : "New project"}
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
            form="project-form"
            disabled={submitting}
            className="rounded-lg bg-primary px-4 py-1.5 text-xs font-bold text-on-primary hover:bg-primary/90 disabled:opacity-60"
          >
            {submitting ? "Saving…" : isEdit ? "Save changes" : "Create project"}
          </button>
        </>
      }
    >
      <form id="project-form" onSubmit={handleSubmit} className="space-y-4">
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
            rows={3}
            maxLength={2000}
            className="w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-2 text-sm text-on-surface focus:border-primary focus:outline-hidden focus:ring-2 focus:ring-primary/30"
          />
        </Field>

        <Field label="Customer" required>
          <select
            value={customerId === "" ? "" : String(customerId)}
            onChange={(e) =>
              setCustomerId(e.target.value === "" ? "" : Number(e.target.value))
            }
            className="w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-2 text-sm text-on-surface focus:border-primary focus:outline-hidden focus:ring-2 focus:ring-primary/30"
          >
            <option value="">
              {customers && customers.length === 0
                ? "No customers — create one in the Customers tab first"
                : "Select customer…"}
            </option>
            {(customers ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Status">
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as ProjectStatus)}
            className="w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-2 text-sm text-on-surface focus:border-primary focus:outline-hidden focus:ring-2 focus:ring-primary/30"
          >
            {PROJECT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {PROJECT_STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </Field>

        {canPickTam && (
          <Field label="Technical Account Manager">
            <select
              value={tamId === "" ? "" : String(tamId)}
              onChange={(e) => setTamId(e.target.value === "" ? "" : Number(e.target.value))}
              className="w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-2 text-sm text-on-surface focus:border-primary focus:outline-hidden focus:ring-2 focus:ring-primary/30"
            >
              <option value="">Defaults to current user</option>
              {tams.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.username}
                </option>
              ))}
            </select>
          </Field>
        )}

        <Field label="WIP limit — leave empty for none">
          <div className="grid grid-cols-3 gap-3">
            {WIP_COLUMNS.map((col) => (
              <label key={col.value} className="block">
                <span className="mb-1 block text-xs text-on-surface-variant">
                  {col.label}
                </span>
                <input
                  type="number"
                  min={1}
                  step={1}
                  inputMode="numeric"
                  value={wipLimits[col.value]}
                  onChange={(e) =>
                    setWipLimits((prev) => ({ ...prev, [col.value]: e.target.value }))
                  }
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
            <span className="block text-xs text-on-surface-variant">
              Exclude from portfolio roll-ups (Executive dashboard, Overview,
              overdue monitoring). The project stays fully usable here.
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
