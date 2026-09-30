import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { ConfirmModal } from "./ConfirmModal";
import { Modal } from "./Modal";
import { Alert, AlertDescription } from "@/components/reui/alert";
import { hasPermission, useAuth } from "@/lib/auth";
import { saveErrorMessage } from "@/lib/ownerAccess";
import {
  type CustomerInput,
  type CustomerSummary,
  useCreateCustomer,
  useUpdateCustomer,
  useUsers,
} from "@/lib/queries";

interface Props {
  open: boolean;
  onClose: () => void;
  customer?: CustomerSummary | null;
  /**
   * Edit mode only: false for someone who reaches the customer through a
   * project membership alone. They may not change its owner (server: 403
   * owner_only), so the TAM select is read-only and `tamId` is not sent.
   */
  canChangeOwner?: boolean;
}

export function CustomerFormModal({ open, onClose, customer, canChangeOwner = true }: Props) {
  const isEdit = Boolean(customer);
  const create = useCreateCustomer();
  const update = useUpdateCustomer(customer?.id ?? 0);
  const { data: users } = useUsers();
  const { user } = useAuth();
  // "— none —" (an unassigned TAM) is only offered to view-all users
  // (Decision 4, customer-visibility-spec.md §3) — a non-view-all user can
  // never submit `tamId: null`, since they could never see the customer
  // again afterward.
  const viewAll = hasPermission(user, "project:view-all");

  const [name, setName] = useState("");
  const [accountManager, setAccountManager] = useState("");
  const [solutionArchitect, setSolutionArchitect] = useState("");
  const [tam, setTam] = useState("");
  // Snapshot of `tam` as loaded when the form opened — used to detect a
  // non-view-all user reassigning the TAM away from themselves (Decision 5).
  const [initialTam, setInitialTam] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [confirmReassignOpen, setConfirmReassignOpen] = useState(false);
  const [pendingPayload, setPendingPayload] = useState<CustomerInput | null>(null);

  // Solution Architect dropdown lists all users — role names no longer
  // gate eligibility. Account Manager is a free-text field — AMs may
  // not have user accounts in this system at all (external sales
  // contacts, etc.). TAM shares the same options list (`useUsers()` — no
  // `active` flag on `UserSummary` today, so there's nothing to filter).
  const solutionArchitectOptions = useMemo(
    () => users ?? [],
    [users],
  );

  useEffect(() => {
    if (!open) return;
    setError(null);
    setConfirmReassignOpen(false);
    setPendingPayload(null);
    if (customer) {
      setName(customer.name);
      setAccountManager(customer.accountManager ?? "");
      setSolutionArchitect(customer.solutionArchitect ?? "");
      // Edit keeps the customer's current TAM as-is, including "none" —
      // Decision 4 (a non-view-all user can never submit `tamId: null`) is
      // a create-time rule only. `PATCH /customers/:id` still accepts
      // `tamId: null` from anyone, so an already-unowned customer stays
      // unowned unless someone deliberately picks a TAM. The "— none —"
      // option is rendered below whenever it's the customer's current
      // value, so this is always a selectable initial value.
      const initial = customer.tamId != null ? String(customer.tamId) : "";
      setTam(initial);
      setInitialTam(initial);
      setDescription(customer.description ?? "");
    } else {
      setName("");
      setAccountManager("");
      setSolutionArchitect("");
      // On create, the TAM select pre-selects the current user regardless
      // of role — a view-all user can still change it to "— none —".
      const initial = user ? String(user.id) : "";
      setTam(initial);
      setInitialTam(initial);
      setDescription("");
    }
    // Seed on open / customer switch only — `customer` gets a fresh identity on
    // every 30 s refetch, and re-running this reset wipes in-progress input
    // (docs/archive/plans/collaboration-and-sharing.md). `user?.id` and
    // `viewAll` are the only other inputs (create-mode TAM default).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, customer?.id, user?.id, viewAll]);

  async function performSave(payload: CustomerInput) {
    setError(null);
    try {
      if (isEdit && customer) {
        await update.mutateAsync(payload);
      } else {
        await create.mutateAsync(payload);
      }
      setConfirmReassignOpen(false);
      setPendingPayload(null);
      onClose();
    } catch (err) {
      setConfirmReassignOpen(false);
      setError(saveErrorMessage(err, "Save failed."));
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError("Name is required.");
      return;
    }
    if (!description.trim()) {
      setError("Description is required.");
      return;
    }
    const payload: CustomerInput = {
      name: name.trim(),
      accountManager: accountManager.trim() || undefined,
      solutionArchitect: solutionArchitect.trim() || undefined,
      // Always sent (never omitted) so clearing the select back to
      // "— none —" actually unassigns the TAM instead of being dropped.
      ...(isEdit && !canChangeOwner ? {} : { tamId: tam ? Number(tam) : null }),
      description: description.trim(),
    };
    // Decision 5: a non-view-all user handing the customer to someone else
    // (or off an unowned customer they were just editing) loses access to
    // it unless they're still tied to it via a project — confirm before
    // saving. `initialTam === ""` covers an unowned customer: picking any
    // other TAM there is also a handover away from the caller's reach.
    const reassignsAwayFromSelf =
      isEdit &&
      canChangeOwner &&
      !viewAll &&
      user != null &&
      tam !== "" &&
      tam !== String(user.id) &&
      (initialTam === "" || initialTam === String(user.id));
    if (reassignsAwayFromSelf) {
      setPendingPayload(payload);
      setConfirmReassignOpen(true);
      return;
    }
    await performSave(payload);
  }

  const submitting = create.isPending || update.isPending;
  // Modal.tsx registers one document-level Escape listener per open
  // instance with no stopPropagation, so a single Escape press would
  // otherwise close both the ConfirmModal and this form underneath it,
  // discarding the edit. While the reassign confirm is open, make the
  // form's own Escape/backdrop-close a no-op so only the confirm closes.
  const formOnClose = confirmReassignOpen ? () => {} : onClose;

  return (
    <Modal
      open={open}
      onClose={formOnClose}
      title={isEdit ? "Edit customer" : "New customer"}
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
            form="customer-form"
            disabled={submitting}
            className="rounded-lg bg-primary px-4 py-1.5 text-xs font-bold text-on-primary hover:bg-primary/90 disabled:opacity-60"
          >
            {submitting ? "Saving…" : isEdit ? "Save changes" : "Create customer"}
          </button>
        </>
      }
    >
      <form id="customer-form" onSubmit={handleSubmit} className="space-y-4">
        <Field label="Name" required>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={200}
            autoFocus
            className="w-full rounded-sm border border-outline-variant bg-surface-container-lowest px-3 py-2 text-sm text-on-surface focus:border-primary focus:outline-hidden focus:ring-2 focus:ring-primary/30"
          />
        </Field>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Account Manager">
            <input
              type="text"
              value={accountManager}
              onChange={(e) => setAccountManager(e.target.value)}
              maxLength={200}
              placeholder="Free text — anyone, internal or external"
              className="w-full rounded-sm border border-outline-variant bg-surface-container-lowest px-3 py-2 text-sm text-on-surface focus:border-primary focus:outline-hidden focus:ring-2 focus:ring-primary/30"
            />
          </Field>
          <Field label="Solution Architect">
            <select
              value={solutionArchitect}
              onChange={(e) => setSolutionArchitect(e.target.value)}
              className="w-full rounded-sm border border-outline-variant bg-surface-container-lowest px-3 py-2 text-sm text-on-surface focus:border-primary focus:outline-hidden focus:ring-2 focus:ring-primary/30"
            >
              <option value="">— None —</option>
              {solutionArchitectOptions.map((u) => (
                <option key={u.id} value={u.username}>
                  {u.username} ({u.role})
                </option>
              ))}
              {solutionArchitect &&
                !solutionArchitectOptions.some((u) => u.username === solutionArchitect) && (
                  <option value={solutionArchitect}>{solutionArchitect} (current)</option>
                )}
            </select>
          </Field>
          <Field label="TAM">
            <select
              value={tam}
              onChange={(e) => setTam(e.target.value)}
              disabled={isEdit && !canChangeOwner}
              className="w-full disabled:cursor-not-allowed disabled:opacity-70 rounded-sm border border-outline-variant bg-surface-container-lowest px-3 py-2 text-sm text-on-surface focus:border-primary focus:outline-hidden focus:ring-2 focus:ring-primary/30"
            >
              {/* Always selectable for a view-all user; for a non-view-all
                  user only when it's the customer's current value on edit
                  (an already-unowned customer stays selectable as "none"),
                  never on create (Decision 4). */}
              {(viewAll || (isEdit && customer?.tamId == null)) && (
                <option value="">— none —</option>
              )}
              {solutionArchitectOptions.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.username}
                </option>
              ))}
            </select>
            {isEdit && !canChangeOwner && (
              <p className="mt-1 text-meta text-on-surface-variant">
                Only the customer's owner can change this.
              </p>
            )}
          </Field>
        </div>

        <Field label="Description" required>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={5}
            maxLength={5000}
            className="w-full resize-y rounded-sm border border-outline-variant bg-surface-container-lowest px-3 py-2 text-sm text-on-surface focus:border-primary focus:outline-hidden focus:ring-2 focus:ring-primary/30"
          />
        </Field>

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
      </form>
      <ConfirmModal
        open={confirmReassignOpen}
        onClose={() => {
          setConfirmReassignOpen(false);
          setPendingPayload(null);
        }}
        onConfirm={() => {
          if (pendingPayload) void performSave(pendingPayload);
        }}
        title="Reassign customer?"
        body={`You may lose access to ${customer?.name ?? "this customer"} if none of its projects is yours.`}
        confirmLabel="Reassign"
        confirmTone="warning"
        busy={update.isPending}
      />
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
  children: ReactNode;
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
