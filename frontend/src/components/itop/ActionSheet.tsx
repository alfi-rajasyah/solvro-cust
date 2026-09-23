// Small modal for the two ticket actions that need iTop's mandatory fields
// before they'll go through (Task 5.4, docs/archive/plans/
// itop-integration.md): Resolve (resolution code + solution) and, when
// `assign_to_me` comes back with a 409 `itop_team_required`, a team picker.
// Built on the shared Modal.tsx shell (same footer/close conventions as
// ConfirmModal.tsx) rather than a bespoke overlay.
import { useState } from "react";
import { Modal } from "@/components/Modal";
import type { ItopTicketTeamOption } from "@/lib/queries";
import { RESOLUTION_CODES } from "./ticketActions";

export type ActionSheetMode = "resolve" | "team";

const LABEL_CLASS = "mb-1 block text-[12px] font-bold uppercase tracking-wider text-on-surface-variant";
const FIELD_CLASS =
  "w-full rounded-sm border border-outline-variant bg-surface-container-lowest px-2 py-1.5 text-sm text-on-surface focus:border-primary focus:outline-hidden";

export function ActionSheet({
  open,
  onClose,
  mode,
  ticketRef,
  ticketTitle,
  personName,
  teams,
  busy,
  error,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  mode: ActionSheetMode;
  ticketRef: string;
  ticketTitle: string;
  personName: string | null;
  teams?: ItopTicketTeamOption[];
  busy: boolean;
  error: string | null;
  onConfirm: (fields: Record<string, string | number>) => void;
}) {
  const [resolutionCode, setResolutionCode] = useState(RESOLUTION_CODES[0]!.value);
  const [solution, setSolution] = useState("");
  const [teamId, setTeamId] = useState<number | "">(teams?.[0]?.id ?? "");

  const title =
    mode === "resolve"
      ? `Resolve ${ticketRef} · iTop asks for 2 fields on this step.`
      : `Assign ${ticketRef} · iTop needs a team for this step.`;

  const canConfirm = mode === "resolve" ? solution.trim().length > 0 : teamId !== "";

  function handleConfirm() {
    if (!canConfirm) return;
    if (mode === "resolve") {
      onConfirm({ resolution_code: resolutionCode, solution: solution.trim() });
    } else {
      onConfirm({ team_id: teamId as number });
    }
  }

  return (
    <Modal
      open={open}
      onClose={busy ? () => {} : onClose}
      title={title}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-lg border border-outline-variant px-4 py-1.5 text-xs font-semibold text-on-surface-variant hover:bg-surface-container disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={busy || !canConfirm}
            className="rounded-lg bg-primary px-4 py-1.5 text-xs font-bold text-on-primary hover:bg-primary/90 disabled:opacity-60"
          >
            {busy ? "Working…" : mode === "resolve" ? "Resolve in iTop" : "Assign in iTop"}
          </button>
        </>
      }
    >
      <p className="mb-3 truncate text-sm text-on-surface-variant" title={ticketTitle}>
        {ticketTitle}
      </p>

      {mode === "resolve" ? (
        <div className="space-y-3">
          <label className="block">
            <span className={LABEL_CLASS}>
              Resolution code required by iTop <span className="text-error">*</span>
            </span>
            <select
              value={resolutionCode}
              onChange={(e) => setResolutionCode(e.target.value)}
              className={FIELD_CLASS}
            >
              {RESOLUTION_CODES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className={LABEL_CLASS}>
              Solution required by iTop <span className="text-error">*</span>
            </span>
            <textarea
              value={solution}
              onChange={(e) => setSolution(e.target.value)}
              rows={4}
              required
              maxLength={5000}
              className={FIELD_CLASS}
            />
          </label>
        </div>
      ) : (
        <label className="block">
          <span className={LABEL_CLASS}>
            Team required by iTop <span className="text-error">*</span>
          </span>
          <select
            value={teamId}
            onChange={(e) => setTeamId(e.target.value === "" ? "" : Number(e.target.value))}
            className={FIELD_CLASS}
          >
            <option value="">Choose a team…</option>
            {(teams ?? []).map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
      )}

      {error && <p className="mt-3 text-sm text-error">{error}</p>}

      {personName && (
        <p className="mt-3 text-[12px] text-on-surface-variant">
          Written to iTop as {personName}
        </p>
      )}
    </Modal>
  );
}
