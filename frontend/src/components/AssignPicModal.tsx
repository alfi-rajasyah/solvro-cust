// Dialog for assigning a PIC to an unassigned opportunity (claim-unassigned-
// deals plan, D1/D2). An unassigned deal is locked for `pipeline:edit_own`
// holders — no drag, edit, stage change, link or delete — until it has a
// PIC; this dialog, opened from OpportunityDetail's "Assign PIC" button, is
// the one exception. Reassigning a deal that already has a PIC is Edit's
// job (OpportunityFormModal's PIC field), not this one — see canAssignDeal
// (frontend/src/components/pipeline/boardLogic.ts) and D4.
import { useEffect, useState, type FormEvent } from "react";
import { Modal } from "./Modal";
import { Alert, AlertDescription } from "@/components/reui/alert";
import { ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { type Opportunity, useAssignOpportunity, useUsers } from "@/lib/queries";

interface Props {
  open: boolean;
  onClose: () => void;
  opportunity: Opportunity;
}

export function AssignPicModal({ open, onClose, opportunity }: Props) {
  const { user } = useAuth();
  const { data: users } = useUsers();
  const assign = useAssignOpportunity();

  const [picId, setPicId] = useState<number | "">("");
  const [error, setError] = useState<string | null>(null);

  // Reset to the caller on the OPEN TRANSITION only — deliberately `[open]`
  // in the deps (this repo has no exhaustive-deps lint to satisfy), reading
  // the current `user`/`users` directly rather than listing them: `useUsers`
  // can refetch in the background (window focus, an unrelated invalidation)
  // and hand back a new array reference while the dialog is already open,
  // and this effect must NOT fire on that — it would stomp a selection the
  // user already made in the open dialog back to the caller. Falls back to
  // the first user in the list on the off chance the current user isn't in
  // it (same pattern as OpportunityFormModal's reset effect, minus the
  // users/user deps for the reason above).
  useEffect(() => {
    if (!open) return;
    setError(null);
    const list = users ?? [];
    const callerIsListed = user != null && list.some((u) => u.id === user.id);
    setPicId(callerIsListed ? user.id : (list[0]?.id ?? ""));
  }, [open]);

  // `useUsers()` can still be loading (or mid-refetch) at the moment the
  // effect above runs, in which case `list` was empty and `picId` was left
  // at `""`. Once the list actually arrives, fill that still-empty selection
  // — but only while empty, so a real in-dialog pick from the effect above
  // is never overridden by a later background refetch of the same list.
  useEffect(() => {
    if (!open || picId !== "" || !users || users.length === 0) return;
    const callerIsListed = user != null && users.some((u) => u.id === user.id);
    setPicId(callerIsListed ? user.id : users[0].id);
  }, [open, users, user, picId]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (picId === "") return;
    setError(null);
    try {
      await assign.mutateAsync({ id: opportunity.id, picId });
      onClose();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.status === 403
            ? "Someone else already assigned this deal. Reload to see the current PIC."
            : err.message
          : "Could not assign the PIC.",
      );
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Assign PIC"
      widthClass="max-w-md"
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            disabled={assign.isPending}
            className="rounded-lg border border-outline-variant px-4 py-1.5 text-xs font-semibold text-on-surface-variant hover:bg-surface-container disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            form="assign-pic-form"
            disabled={assign.isPending || picId === ""}
            className="rounded-lg bg-primary px-4 py-1.5 text-xs font-bold text-on-primary hover:bg-primary/90 disabled:opacity-60"
          >
            {assign.isPending ? "Assigning…" : "Assign"}
          </button>
        </>
      }
    >
      <form id="assign-pic-form" onSubmit={handleSubmit} className="space-y-3">
        <p className="text-sm text-on-surface-variant">
          {opportunity.title} has no PIC yet. Pick one to unlock the deal.
        </p>

        <label className="block">
          <span className="mb-1 block text-[12px] font-bold uppercase tracking-wider text-on-surface-variant">
            PIC
            <span className="ml-1 text-error">*</span>
          </span>
          <select
            value={picId === "" ? "" : String(picId)}
            onChange={(e) => setPicId(e.target.value === "" ? "" : Number(e.target.value))}
            aria-label="PIC"
            required
            className="w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-2 text-sm text-on-surface focus:border-primary focus:outline-hidden focus:ring-2 focus:ring-primary/30"
          >
            {(users ?? []).map((u) => (
              <option key={u.id} value={u.id}>
                {u.username}
              </option>
            ))}
          </select>
        </label>

        <p className="text-[13px] text-on-surface-variant">
          Only the PIC and pipeline managers can edit, move, link or delete this deal. Other SAs
          can read it and add notes.
        </p>

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
      </form>
    </Modal>
  );
}
