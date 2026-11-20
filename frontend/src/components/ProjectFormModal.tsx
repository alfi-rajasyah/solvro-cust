import { useEffect, useRef, useState, type FormEvent } from "react";
import { Modal } from "./Modal";
import { addLink, linkBody, removeLink, setPrimaryLink } from "@/lib/projectCustomerLinks";
import { PrimaryChip } from "@/components/customer/PrimaryChip";
import { OutlineUrlField } from "./OutlineUrlField";
import { Alert, AlertDescription } from "@/components/reui/alert";
import { parseOutlineUrl } from "@/lib/outlineUrl";
import { hasPermission, useAuth } from "@/lib/auth";
import { saveErrorMessage } from "@/lib/ownerAccess";
import { PROJECT_STATUS_LABEL, TASK_CATEGORY_GROUP_LABEL } from "@/lib/labels";
import { STATUS_TONE_DOT_CLASS } from "@/components/StatusChip";
import { groupStatusDefs } from "@/lib/taskStatuses";
import { EMPTY_VALUE } from "@/lib/emptyValue";
import {
  type ProjectCustomerLink,
  type ProjectDetail,
  type ProjectStatus,
  type TaskStatusDef,
  type WipLimits,
  useCreateProject,
  useCustomers,
  useTaskStatuses,
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

// Form-local representation: each status's limit as the literal <input>
// string value ("" = no limit), keyed by status def id, so the field can be
// edited freely without fighting number coercion on every keystroke.
type WipLimitsForm = Record<string, string>;

function wipLimitsToForm(limits: WipLimits | null | undefined, defs: readonly TaskStatusDef[]): WipLimitsForm {
  const form: WipLimitsForm = {};
  for (const def of defs) {
    const v = limits?.[String(def.id)];
    form[String(def.id)] = v != null ? String(v) : "";
  }
  return form;
}

function formToWipLimits(
  form: WipLimitsForm,
  existing: WipLimits | null | undefined,
  knownIds: ReadonlySet<string>,
): WipLimits {
  const toLimit = (v: string): number | null => {
    const n = Number(v);
    return v.trim() !== "" && Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
  };
  // Only statuses that still exist: the server rejects an unknown id.
  const out: WipLimits = {};
  for (const [key, limit] of Object.entries(existing ?? {})) {
    if (knownIds.has(key)) out[key] = limit;
  }
  for (const [key, value] of Object.entries(form)) {
    if (!knownIds.has(key)) continue;
    const limit = toLimit(value);
    // An emptied field clears a stored limit; an untouched empty one stays absent.
    if (limit !== null || key in out) out[key] = limit;
  }
  return out;
}

interface Props {
  open: boolean;
  onClose: () => void;
  /** When supplied, the form opens in edit mode for this project. */
  project?: ProjectDetail | null;
  onSaved?: (id: number) => void;
  /**
   * Edit mode only: false for someone with access through membership alone,
   * who may not change the TAM or customer (server: 403 owner_only). The
   * customer select is then read-only and neither field is sent.
   */
  canChangeOwnership?: boolean;
}

export function ProjectFormModal({
  open,
  onClose,
  project,
  onSaved,
  canChangeOwnership = true,
}: Props) {
  const { user } = useAuth();
  const isEdit = Boolean(project);
  const { data: users } = useUsers();
  // GET /customers needs customer:read; without it the picker can't list anything.
  const canReadCustomers = hasPermission(user, "customer:read");
  const { data: customers } = useCustomers(canReadCustomers);

  const create = useCreateProject();
  const update = useUpdateProject(project?.id ?? 0);
  const { data: statusDefs } = useTaskStatuses();
  const wipDefs = statusDefs ?? [];
  const knownIds = new Set((statusDefs ?? []).map((d) => String(d.id)));

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [outlineUrl, setOutlineUrl] = useState("");
  const [outlineUrlError, setOutlineUrlError] = useState<string | null>(null);
  const outlineUrlInput = useRef<HTMLInputElement>(null);
  const [tamId, setTamId] = useState<number | "">("");
  // Linked customers, in display order; exactly one isPrimary while non-empty.
  const [links, setLinks] = useState<ProjectCustomerLink[]>([]);
  const [status, setStatus] = useState<ProjectStatus>("PLANNING");
  const [wipLimits, setWipLimits] = useState<WipLimitsForm>({});
  const [excludeFromPortfolio, setExcludeFromPortfolio] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setOutlineUrlError(null);
    if (project) {
      setName(project.name);
      setDescription(project.description ?? "");
      setOutlineUrl(project.outlineUrl ?? "");
      setTamId(project.tamId);
      setLinks(project.customers.map((c) => ({ id: c.id, name: c.name, isPrimary: c.isPrimary })));
      setStatus(project.status);
      setWipLimits(wipLimitsToForm(project.wipLimits, wipDefs));
      setExcludeFromPortfolio(project.excludeFromPortfolio);
    } else {
      setName("");
      setDescription("");
      setOutlineUrl("");
      setTamId("");
      setLinks([]);
      setStatus("PLANNING");
      setWipLimits(wipLimitsToForm(null, wipDefs));
      setExcludeFromPortfolio(false);
    }
    // Seed on open / project switch only — `project` gets a fresh identity on
    // every 30 s refetch (and any task edit moves its `health`), and re-running
    // this reset wipes in-progress input (docs/archive/plans/collaboration-and-sharing.md).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, project?.id]);

  // The WIP fields map onto status ids, so they can only be filled once the
  // status list has arrived (usually already cached by the board).
  const defsLoaded = statusDefs !== undefined;
  useEffect(() => {
    if (!open || !defsLoaded) return;
    setWipLimits(wipLimitsToForm(project?.wipLimits, wipDefs));
    // Seed when the list arrives; edits made afterwards are not overwritten.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defsLoaded]);

  // TAM dropdown lists all users — role names no longer gate who's eligible
  // to be assigned (admin's choice). Anti-self-clutter not done here because
  // useUsers() doesn't expose `active`.
  const canEditLinks = canReadCustomers && (!isEdit || canChangeOwnership);
  const tams = users ?? [];
  const canPickTam = user?.permissions?.includes("*") ?? false;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError("Name is required.");
      return;
    }
    // Only enforced where the field is editable: a member (or a user without
    // customer:read) saving other fields of an unlinked project must still work.
    if (links.length === 0 && (!isEdit || canEditLinks)) {
      setError("At least one customer is required.");
      return;
    }
    // Client-side twin of the server rule (http/https, ≤ 2048, empty clears).
    const parsedOutline = parseOutlineUrl(outlineUrl);
    if (!parsedOutline.ok) {
      setOutlineUrlError(parsedOutline.error);
      outlineUrlInput.current?.focus();
      return;
    }
    setOutlineUrlError(null);

    try {
      if (isEdit && project) {
        await update.mutateAsync({
          name: name.trim(),
          description: description.trim() || null,
          outlineUrl: parsedOutline.value,
          ...(canChangeOwnership
            ? {
                tamId: tamId === "" ? undefined : Number(tamId),
                // An unlinked project edited by someone who can't edit links sends none.
                ...(links.length > 0 ? { customers: linkBody(links) } : {}),
              }
            : {}),
          status,
          // Left out while the status list is unknown, so a save can never
          // wipe the stored limits.
          wipLimits: defsLoaded ? formToWipLimits(wipLimits, project.wipLimits, knownIds) : undefined,
          excludeFromPortfolio,
        });
        onSaved?.(project.id);
      } else {
        const created = await create.mutateAsync({
          name: name.trim(),
          description: description.trim() || undefined,
          outlineUrl: parsedOutline.value,
          tamId: tamId === "" ? undefined : Number(tamId),
          customers: linkBody(links),
          status,
          wipLimits: defsLoaded ? formToWipLimits(wipLimits, null, knownIds) : undefined,
          excludeFromPortfolio,
        });
        onSaved?.(created.id);
      }
      onClose();
    } catch (err) {
      setError(saveErrorMessage(err, "Save failed."));
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
            className="[@media(pointer:coarse)]:min-h-11 rounded-sm border border-outline-variant px-4 py-1.5 text-xs font-semibold text-on-surface-variant hover:bg-surface-container disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            form="project-form"
            disabled={submitting}
            className="[@media(pointer:coarse)]:min-h-11 rounded-sm bg-primary px-4 py-1.5 text-xs font-bold text-on-primary hover:bg-primary/90 disabled:opacity-60"
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
            className="[@media(pointer:coarse)]:min-h-11 w-full rounded-sm border border-outline-variant bg-surface-container-lowest px-3 py-2 text-sm text-on-surface focus-visible:outline-hidden focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/30"
          />
        </Field>

        <Field label="Description">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            maxLength={2000}
            className="w-full rounded-sm border border-outline-variant bg-surface-container-lowest px-3 py-2 text-sm text-on-surface focus-visible:outline-hidden focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/30"
          />
        </Field>

        <OutlineUrlField
          value={outlineUrl}
          onChange={(v) => {
            setOutlineUrl(v);
            setOutlineUrlError(null);
          }}
          error={outlineUrlError}
          noun="project"
          inputRef={outlineUrlInput}
          inputClassName="w-full rounded-sm border border-outline-variant bg-surface-container-lowest px-3 py-2 text-sm text-on-surface focus-visible:outline-hidden focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/30"
        />

        <CustomersField
          links={links}
          onChange={setLinks}
          options={customers ?? []}
          canReadCustomers={canReadCustomers}
          readOnly={!canEditLinks}
          noCustomersExist={customers !== undefined && customers.length === 0}
          ownerNotice={canReadCustomers && isEdit && !canChangeOwnership}
        />

        <Field label="Status">
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as ProjectStatus)}
            className="[@media(pointer:coarse)]:min-h-11 w-full rounded-sm border border-outline-variant bg-surface-container-lowest px-3 py-2 text-sm text-on-surface focus-visible:outline-hidden focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/30"
          >
            {PROJECT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {PROJECT_STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </Field>

        {canPickTam && canChangeOwnership && (
          <Field label="Technical Account Manager">
            <select
              value={tamId === "" ? "" : String(tamId)}
              onChange={(e) => setTamId(e.target.value === "" ? "" : Number(e.target.value))}
              className="[@media(pointer:coarse)]:min-h-11 w-full rounded-sm border border-outline-variant bg-surface-container-lowest px-3 py-2 text-sm text-on-surface focus-visible:outline-hidden focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/30"
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

        <Field label="WIP limit (leave empty for none)">
          <div className="space-y-3">
            {groupStatusDefs(statusDefs).map((group) => (
              <div key={group.category}>
                <p className="mb-1 text-label-caps uppercase text-on-surface-variant">
                  {TASK_CATEGORY_GROUP_LABEL[group.category]}
                </p>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {group.defs.map((def) => (
                    <label key={def.id} className="block">
                      <span className="mb-1 flex items-center gap-1.5 text-xs text-on-surface-variant">
                        <span
                          aria-hidden="true"
                          className={`h-2 w-2 shrink-0 rounded-full ${STATUS_TONE_DOT_CLASS[def.color]}`}
                        />
                        <span className="min-w-0 truncate">{def.name}</span>
                      </span>
                      <input
                        type="number"
                        min={1}
                        step={1}
                        inputMode="numeric"
                        value={wipLimits[String(def.id)] ?? ""}
                        disabled={!defsLoaded}
                        onChange={(e) =>
                          setWipLimits((prev) => ({ ...prev, [String(def.id)]: e.target.value }))
                        }
                        placeholder={EMPTY_VALUE}
                        className="[@media(pointer:coarse)]:min-h-11 w-full rounded-sm border border-outline-variant bg-surface-container-lowest px-2 py-1.5 text-sm text-on-surface focus-visible:outline-hidden focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/30"
                      />
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Field>

        <label className="flex [@media(pointer:coarse)]:min-h-11 cursor-pointer items-start gap-2">
          <input
            type="checkbox"
            checked={excludeFromPortfolio}
            onChange={(e) => setExcludeFromPortfolio(e.target.checked)}
            className="mt-0.5 h-4 w-4 [@media(pointer:coarse)]:h-6 [@media(pointer:coarse)]:w-6 shrink-0 accent-primary"
          />
          <span className="min-w-0">
            <span className="block text-label-caps uppercase text-on-surface-variant">
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
      <span className="mb-1.5 block text-label-caps uppercase text-on-surface-variant">
        {label}
        {required && <span className="ml-1 text-error">*</span>}
      </span>
      {children}
    </label>
  );
}

const LINK_ACTION_CLASS =
  "[@media(pointer:coarse)]:inline-flex [@media(pointer:coarse)]:items-center [@media(pointer:coarse)]:min-h-11 rounded-sm font-display text-meta font-semibold text-primary hover:underline outline-hidden focus-visible:ring-2 focus-visible:ring-primary";

// "Customers" list of Triage 05 (docs/archive/plans/multi-customer-projects.md):
// a primary radio, the name, a Primary chip or "Set as primary", remove, and
// an add picker limited to the customers the caller can see.
function CustomersField({
  links,
  onChange,
  options,
  canReadCustomers,
  readOnly,
  noCustomersExist,
  ownerNotice,
}: {
  links: ProjectCustomerLink[];
  onChange: (next: ProjectCustomerLink[]) => void;
  options: readonly { id: number; name: string }[];
  canReadCustomers: boolean;
  readOnly: boolean;
  noCustomersExist: boolean;
  ownerNotice: boolean;
}) {
  const available = options.filter((c) => !links.some((l) => l.id === c.id));
  return (
    <fieldset className="block" data-testid="project-customers-field">
      <legend className="mb-1.5 block text-label-caps uppercase text-on-surface-variant">
        Customers<span className="ml-1 text-error">*</span>
      </legend>
      {links.length > 0 && (
        <ul className="divide-y divide-outline-variant/60 rounded-sm border border-outline-variant bg-surface-container-lowest">
          {links.map((l) => (
            <li key={l.id} className="flex [@media(pointer:coarse)]:min-h-11 items-center gap-3 px-3 py-2" data-testid="project-customer-row">
              <label className="contents [@media(pointer:coarse)]:grid [@media(pointer:coarse)]:size-11 [@media(pointer:coarse)]:cursor-pointer [@media(pointer:coarse)]:place-items-center">
              <input
                type="radio"
                name="primary-customer"
                checked={l.isPrimary}
                disabled={readOnly}
                onChange={() => onChange(setPrimaryLink(links, l.id))}
                aria-label={`Make ${l.name} the primary customer`}
                className="h-4 w-4 [@media(pointer:coarse)]:h-6 [@media(pointer:coarse)]:w-6 shrink-0 accent-primary"
              />
              </label>
              <span className="min-w-0 flex-1 truncate text-sm text-on-surface">{l.name}</span>
              {l.isPrimary ? (
                <PrimaryChip />
              ) : (
                !readOnly && (
                  <button
                    type="button"
                    onClick={() => onChange(setPrimaryLink(links, l.id))}
                    className={LINK_ACTION_CLASS}
                  >
                    Set as primary
                  </button>
                )
              )}
              {!readOnly && (
                <button
                  type="button"
                  onClick={() => onChange(removeLink(links, l.id))}
                  disabled={links.length === 1}
                  aria-label={`Remove ${l.name}`}
                  title={links.length === 1 ? "A project needs at least one customer" : undefined}
                  className="flex h-6 w-6 [@media(pointer:coarse)]:size-11 shrink-0 items-center justify-center rounded-sm text-on-surface-variant hover:bg-surface-container hover:text-on-surface outline-hidden focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <span aria-hidden="true" className="material-symbols-outlined text-[18px]">
                    close
                  </span>
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {!readOnly && (
        <div className="mt-2 flex items-center gap-2">
          <span aria-hidden="true" className="material-symbols-outlined text-[18px] text-primary">
            add
          </span>
          <select
            value=""
            onChange={(e) => {
              const c = options.find((o) => o.id === Number(e.target.value));
              if (c) onChange(addLink(links, c));
            }}
            aria-label="Add customer"
            disabled={available.length === 0}
            className="[@media(pointer:coarse)]:min-h-11 min-w-0 flex-1 rounded-sm border border-outline-variant bg-surface-container-lowest px-3 py-2 text-sm text-on-surface focus-visible:outline-hidden focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-70"
          >
            <option value="">
              {noCustomersExist
                ? "No customers yet. Create one in the Customers tab first"
                : links.length === 0
                  ? "Select customer…"
                  : "Add customer…"}
            </option>
            {available.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      )}
      {links.length > 1 && (
        <p className="mt-1.5 text-meta text-on-surface-variant">
          The primary customer is the one used for the breadcrumb, the public share page and new iTop tickets by default.
        </p>
      )}
      {!canReadCustomers && (
        <p className="mt-1 text-meta text-on-surface-variant">
          You don't have access to customers, so one can't be chosen here. Ask an admin for the "View customers" permission.
        </p>
      )}
      {ownerNotice && (
        <p className="mt-1 text-meta text-on-surface-variant">
          Only the project's TAM or the owner of one of its customers can change its customers.
        </p>
      )}
    </fieldset>
  );
}
