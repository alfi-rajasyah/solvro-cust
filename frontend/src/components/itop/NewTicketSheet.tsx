// "New ticket" sheet (Task 6.2, docs/archive/plans/itop-integration.md):
// creates a ticket in iTop under the customer's organisation, using the
// acting TAM's own personal token (same write-identity rule as every other
// ticket write since Phase 5). Built on the shared `Modal.tsx` shell, same
// footer/close conventions as `ActionSheet.tsx` and `ConfirmModal.tsx`.
import { useState } from "react";
import { Modal } from "@/components/Modal";
import { ApiError } from "@/lib/api";
import {
  isStaleTicketCreate,
  useCreateTicket,
  useItopContacts,
  useItopServices,
  useMyItopToken,
  type ItopTicketClass,
} from "@/lib/queries";

const LABEL_CLASS = "mb-1.5 block text-label-caps uppercase text-on-surface-variant";
const FIELD_CLASS =
  "[@media(pointer:coarse)]:min-h-11 w-full rounded-sm border border-outline-variant bg-surface-container-lowest px-2 py-1.5 text-sm text-on-surface focus:border-primary focus:outline-hidden focus:ring-2 focus:ring-primary/30";

const CLASS_OPTIONS: ReadonlyArray<{ value: ItopTicketClass; label: string }> = [
  { value: "UserRequest", label: "User request" },
  { value: "Incident", label: "Incident" },
];

export function NewTicketSheet({
  open,
  onClose,
  customerId,
  onCreated,
  initialTitle,
  initialDescription,
  pinTarget = false,
  organisations = [],
  organisationLabel = null,
}: {
  open: boolean;
  onClose: () => void;
  customerId: number;
  /** Opens the ticket panel on the newly created ticket's id — 201 only; a
   * 202 stale create has nothing to open yet (see the stale notice below).
   * `ref` (Task 7.2, docs/archive/plans/itop-integration.md) lets
   * `TaskTicketField.tsx` pin the new ticket to the task in the same round
   * trip, without a second lookup by id. */
  onCreated: (ticket: { id: number; ref: string }) => void;
  /** Prefill for "Create ticket from a task" (Task 7.2) — the task's own
   * title/description. Each caller mounts a fresh `NewTicketSheet` instance
   * per open (see `TicketsTab.tsx`'s/`TaskTicketField.tsx`'s own
   * `{open && <NewTicketSheet .../>}` guards), so these only need to seed
   * `useState`'s initial value, not a `useEffect` sync. */
  initialTitle?: string;
  initialDescription?: string;
  /** True when the caller pins the new ref to a task/row, so the stale-create notice tells the user to pin it after the next sync. */
  pinTarget?: boolean;
  /**
   * A project linked to several iTop-mapped customers: the organisations the
   * ticket can be created under. `customerId` is the default pick; with fewer
   * than two entries no picker is shown and the sheet behaves as before
   * (docs/archive/plans/multi-customer-projects.md, 7.3).
   */
  organisations?: ReadonlyArray<{ id: number; name: string }>;
  /** Read-only "Organisation: X" line when the default org is not the primary and no picker is shown. */
  organisationLabel?: string | null;
}) {
  // Fresh instance per open (see the prop notes above), so `customerId` only seeds the pick.
  const [orgId, setOrgId] = useState(customerId);
  const { data: myToken } = useMyItopToken();
  const { data: contacts, isLoading: contactsLoading } = useItopContacts(orgId);
  const { data: services } = useItopServices();
  const createTicket = useCreateTicket(orgId);

  const [ticketClass, setTicketClass] = useState<ItopTicketClass>("UserRequest");
  const [title, setTitle] = useState(initialTitle ?? "");
  const [callerId, setCallerId] = useState<number | "">("");
  const [serviceId, setServiceId] = useState<number | "">("");
  const [description, setDescription] = useState(initialDescription ?? "");
  const [error, setError] = useState<string | null>(null);
  const [staleNotice, setStaleNotice] = useState<string | null>(null);

  const canSubmit = title.trim().length > 0 && callerId !== "" && description.trim().length > 0;

  function reset() {
    setTicketClass("UserRequest");
    setTitle(initialTitle ?? "");
    setOrgId(customerId);
    setCallerId("");
    setServiceId("");
    setDescription(initialDescription ?? "");
    setError(null);
    setStaleNotice(null);
  }

  function handleClose() {
    if (createTicket.isPending) return;
    reset();
    onClose();
  }

  function handleSubmit() {
    // `canSubmit`'s own definition includes `callerId !== ""` — TS's aliased-
    // condition narrowing carries that through this early return, so
    // `callerId` reads as `number` (not `number | ""`) for the rest of this
    // function, including the mutate body below.
    if (!canSubmit) return;
    setError(null);
    setStaleNotice(null);
    createTicket.mutate(
      {
        customerId: orgId,
        class: ticketClass,
        title: title.trim(),
        description: description.trim(),
        callerId,
        ...(serviceId !== "" ? { serviceId } : {}),
      },
      {
        onSuccess: (result) => {
          if (isStaleTicketCreate(result)) {
            setStaleNotice(pinTarget
              ? `Created in iTop as #${result.id}, pin it after the next sync.`
              : `Created in iTop as #${result.id}. It appears after the next sync.`);
            return;
          }
          const created = { id: result.id, ref: result.ref };
          reset();
          onClose();
          onCreated(created);
        },
        onError: (err) => {
          setError(err instanceof ApiError ? err.message : "Could not create the ticket.");
        },
      },
    );
  }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="New ticket"
      footer={
        <>
          <button
            type="button"
            onClick={handleClose}
            disabled={createTicket.isPending}
            className="[@media(pointer:coarse)]:inline-flex [@media(pointer:coarse)]:items-center [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11 [@media(pointer:coarse)]:justify-center rounded-sm border border-outline-variant px-4 py-1.5 text-xs font-semibold text-on-surface-variant hover:bg-surface-container disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            // `staleNotice !== null` (fix round, item 8): a 202 stale create
            // already went through in iTop — disable Create so a second
            // click can't fire a duplicate `POST /itop/tickets` while the
            // sheet still shows the notice (the sheet stays open rather
            // than auto-closing, since there's no id yet to open a panel
            // on).
            disabled={!canSubmit || createTicket.isPending || staleNotice !== null}
            className="[@media(pointer:coarse)]:inline-flex [@media(pointer:coarse)]:items-center [@media(pointer:coarse)]:min-h-11 rounded-sm bg-primary px-4 py-1.5 text-xs font-bold text-on-primary hover:bg-primary/90 disabled:opacity-60"
          >
            {createTicket.isPending ? "Creating…" : "Create in iTop"}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        {myToken?.personName && (
          <p className="text-meta text-on-surface-variant">
            Created as {myToken.personName} with your personal iTop token
          </p>
        )}
        {organisations.length > 1 && (
          <label className="block">
            <span className={LABEL_CLASS}>Organisation</span>
            <select
              value={orgId}
              onChange={(e) => {
                setOrgId(Number(e.target.value));
                // Contacts belong to the organisation: the old caller is not valid for the new one.
                setCallerId("");
              }}
              className={FIELD_CLASS}
            >
              {organisations.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </label>
        )}

        {organisations.length <= 1 && organisationLabel && (
          <p className="text-meta text-on-surface-variant">
            Organisation: <span className="font-semibold text-on-surface">{organisationLabel}</span>
          </p>
        )}

        <label className="block">
          <span className={LABEL_CLASS}>Type</span>
          <select
            value={ticketClass}
            onChange={(e) => setTicketClass(e.target.value as ItopTicketClass)}
            className={FIELD_CLASS}
          >
            {CLASS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className={LABEL_CLASS}>
            Title <span className="text-error">*</span>
          </span>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={255}
            className={FIELD_CLASS}
          />
        </label>

        <label className="block">
          <span className={LABEL_CLASS}>
            Caller <span className="text-error">*</span>
          </span>
          <select
            value={callerId}
            onChange={(e) => setCallerId(e.target.value === "" ? "" : Number(e.target.value))}
            className={FIELD_CLASS}
          >
            <option value="">{contactsLoading ? "Loading contacts…" : "Choose a caller…"}</option>
            {(contacts ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} · {c.email}
              </option>
            ))}
          </select>
          {!contactsLoading && (contacts ?? []).length === 0 && (
            <p className="mt-1 text-xs text-on-surface-variant">
              No contacts mapped for this customer yet.
            </p>
          )}
        </label>

        <label className="block">
          <span className={LABEL_CLASS}>Service</span>
          <select
            value={serviceId}
            onChange={(e) => setServiceId(e.target.value === "" ? "" : Number(e.target.value))}
            className={FIELD_CLASS}
          >
            <option value="">No service</option>
            {(services ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {s.providerName ? ` · ${s.providerName}` : ""}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className={LABEL_CLASS}>
            Description <span className="text-error">*</span>
          </span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={5}
            maxLength={4000}
            className={FIELD_CLASS}
          />
        </label>
      </div>

      {error && (
        <p role="alert" className="mt-3 text-sm text-error">
          {error}
        </p>
      )}
      {staleNotice && (
        <p role="alert" className="mt-3 text-sm text-on-surface-variant">
          {staleNotice}
        </p>
      )}

    </Modal>
  );
}
