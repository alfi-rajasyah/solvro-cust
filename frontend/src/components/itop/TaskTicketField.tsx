// "iTop ticket" row in TaskPanel.tsx's metadata grid (Task 4.2,
// docs/archive/plans/itop-integration.md). Rendered only when
// `useItopStatus().configured` is true — an install with no iTop connection
// never sees this field at all. Owns no mutation of its own: saving goes
// through the caller's `onSave`, which TaskPanel.tsx threads into its
// existing `patch()` helper (useUpdateTask's optimistic-cache pattern
// applies unchanged, same as every other editable row in the panel).
import { useId, useRef, useState } from "react";
import { Chip } from "@/components/StatusChip";
import { ApiError } from "@/lib/api";
import { useItopStatus, useItopTicketByRef } from "@/lib/queries";
import { isItopRef, itopTicketUrl, statusLabel, statusTone } from "./ticketPresentation";

const INPUT_CLASS =
  "w-full rounded-sm border border-outline-variant bg-surface-container-lowest px-1.5 py-1 font-mono text-xs text-on-surface focus:border-primary focus:outline-hidden disabled:opacity-60";

const LINK_CLASS =
  "font-display text-[11px] font-bold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30";

const AFFORDANCE_CLASS =
  "font-display text-[11px] font-semibold text-on-surface-variant underline hover:text-on-surface";

export function TaskTicketField({
  itopTicketRef,
  canEdit,
  onSave,
}: {
  itopTicketRef: string | null;
  canEdit: boolean;
  onSave: (ref: string | null) => void;
}) {
  const { data: status } = useItopStatus();
  const ticketQuery = useItopTicketByRef(itopTicketRef);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const errorId = useId();

  // One edit settles exactly once — same rationale and same risk as
  // TaskPanel.tsx's own `renameSettledRef` (Enter and the blur that follows
  // an unmount can both reach `commit()`; Chromium/React 18.3 doesn't
  // re-fire blur on unmount but other engines do). Reset at the start of
  // every fresh edit session: `startEdit()` for the "Change" flow, and
  // explicitly on "Clear" — the only other path that re-arms the bare
  // (unset) input, since `commit()` itself never nulls the ref.
  const settledRef = useRef(false);

  // Gate on the install, not on this row's own state — a task pinned to a
  // ref before iTop was ever configured (or after it's removed) shouldn't
  // show a dangling field with nothing behind it.
  if (!status?.configured) return null;

  function startEdit() {
    settledRef.current = false;
    setDraft(itopTicketRef ?? "");
    setError(null);
    setEditing(true);
  }

  function commit() {
    if (settledRef.current) return;
    // Uppercased before both the unchanged-value check and validation — a
    // ref typed in lowercase ("r-004512") should save/compare the same as
    // its canonical form, not bounce off the format error.
    const value = draft.trim().toUpperCase();
    if (value === "") {
      // An empty save is a cancel, not a clear — clearing an existing ref is
      // its own explicit "Clear" affordance below, so a stray blur on an
      // emptied box never silently drops the pinned ticket.
      settledRef.current = true;
      setEditing(false);
      setError(null);
      return;
    }
    if (value === (itopTicketRef ?? "")) {
      // Re-saving the same ref (e.g. "Change" then Enter with no edit) is a
      // no-op close, not a PATCH with an unchanged value.
      settledRef.current = true;
      setEditing(false);
      setError(null);
      return;
    }
    if (!isItopRef(value)) {
      setError("Use the iTop ref, e.g. R-004512");
      return;
    }
    settledRef.current = true;
    setError(null);
    setEditing(false);
    onSave(value);
  }

  // Unset (no ref yet) is inherently an input, not a click-to-edit button
  // like the panel's other rows — there's nothing to display until one is
  // saved. `editing` covers the "Change" flow for an already-set ref.
  const showInput = editing || !itopTicketRef;

  if (showInput) {
    return (
      <div className="relative">
        <input
          key={editing ? "editing" : "empty"}
          autoFocus={editing}
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape" && editing) setEditing(false);
          }}
          onBlur={commit}
          disabled={!canEdit}
          placeholder="R-000000"
          spellCheck={false}
          autoComplete="off"
          aria-label="iTop ticket"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          className={INPUT_CLASS}
        />
        {error && (
          <p id={errorId} className="mt-1 text-[11px] text-error">
            {error}
          </p>
        )}
      </div>
    );
  }

  const ticket = ticketQuery.data;
  // Only a 404 (unknown, hidden, or unmapped ref — routes/itop.ts's `GET
  // /tickets/by-ref/:ref`) means "not in snapshot". Any other failure (a
  // network blip, a 5xx) renders no chip at all rather than misreporting a
  // transient error as a steady "not in snapshot" state.
  const notFound = ticketQuery.error instanceof ApiError && ticketQuery.error.status === 404;
  const url = ticket && status.baseUrl ? itopTicketUrl(status.baseUrl, ticket) : null;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="font-mono text-xs text-on-surface">{itopTicketRef}</span>
      {ticket ? (
        <Chip tone={statusTone(ticket)}>{statusLabel(ticket.status)}</Chip>
      ) : notFound ? (
        <Chip tone="gray">not in snapshot</Chip>
      ) : null}
      {url && (
        <a href={url} target="_blank" rel="noopener noreferrer" className={LINK_CLASS}>
          Open in iTop ↗
        </a>
      )}
      {canEdit && (
        <>
          <button
            type="button"
            onClick={startEdit}
            aria-label={`Change iTop ticket ${itopTicketRef}`}
            className={AFFORDANCE_CLASS}
          >
            Change
          </button>
          <button
            type="button"
            onClick={() => {
              settledRef.current = false;
              onSave(null);
            }}
            aria-label={`Clear iTop ticket ${itopTicketRef}`}
            className={AFFORDANCE_CLASS}
          >
            Clear
          </button>
        </>
      )}
    </div>
  );
}
