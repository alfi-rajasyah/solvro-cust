import { useEffect, useState, type FormEvent } from "react";
import { DateField } from "./DateField";
import { Modal } from "./Modal";
import { Alert, AlertDescription } from "@/components/reui/alert";
import { ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { STAGE_LABELS, STAGE_ORDER, type PipelineStage } from "@/lib/pipelineFormat";
import { type Opportunity, useCreateOpportunity, useUpdateOpportunity, useUsers } from "@/lib/queries";

interface Props {
  open: boolean;
  onClose: () => void;
  /** When supplied, the form opens in edit mode for this opportunity. */
  opportunity?: Opportunity;
  /**
   * Create-mode-only prefill for `stage` — wired by the future per-column
   * "+" affordance on the board (PRD §2.3/§2.6, Velora's `defaultStage`).
   * Ignored in edit mode, same as the `stage` field itself.
   */
  initialStage?: PipelineStage;
}

export function OpportunityFormModal({ open, onClose, opportunity, initialStage }: Props) {
  const isEdit = Boolean(opportunity);
  const { data: users } = useUsers();
  const { user } = useAuth();

  const create = useCreateOpportunity();
  const update = useUpdateOpportunity();

  const [title, setTitle] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [dealValue, setDealValue] = useState("");
  const [stage, setStage] = useState<PipelineStage>("ASSESSMENT");
  const [picId, setPicId] = useState<number | "">("");
  const [requestDate, setRequestDate] = useState<string | null>(null);
  const [deadline, setDeadline] = useState<string | null>(null);
  const [winProbability, setWinProbability] = useState("50");
  const [leadSource, setLeadSource] = useState("");
  const [productSolution, setProductSolution] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    if (opportunity) {
      setTitle(opportunity.title);
      setCustomerName(opportunity.customerName);
      setDealValue(String(opportunity.dealValue));
      setStage(opportunity.stage);
      setPicId(opportunity.picId ?? "");
      setRequestDate(opportunity.requestDate);
      setDeadline(opportunity.deadline);
      setWinProbability(String(opportunity.winProbability));
      setLeadSource(opportunity.leadSource ?? "");
      setProductSolution(opportunity.productSolution);
      setDescription(opportunity.description ?? "");
    } else {
      setTitle("");
      setCustomerName("");
      setDealValue("");
      setStage(initialStage ?? "ASSESSMENT");
      // D5: a deal that starts unassigned is locked for its own creator
      // (canAssignDeal/assertCanAssignOpportunity) until someone gives it a
      // PIC, so the create form defaults to the creator; "No PIC" stays
      // selectable for the rare deliberate unassigned create.
      setPicId(user?.id ?? "");
      setRequestDate(null);
      setDeadline(null);
      setWinProbability("50");
      setLeadSource("");
      setProductSolution("");
      setDescription("");
    }
    // `user?.id`, not `user` — AuthProvider replaces the whole user object on
    // the boot /auth/me rehydrate (frontend/src/lib/auth.tsx:116-121), which
    // can happen while this modal is already open; depending on the object
    // would re-run this reset (wiping whatever the user had typed) on that
    // rehydrate even though the id, and thus the correct default, didn't
    // change.
  }, [open, opportunity, initialStage, user?.id]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (!title.trim()) {
      setError("Title is required.");
      return;
    }
    if (!customerName.trim()) {
      setError("Customer name is required.");
      return;
    }

    // Client-side mirror of the backend Zod bounds (createOpportunitySchema /
    // updateOpportunitySchema in backend/src/routes/opportunities.ts): an
    // empty numeric field means "don't send it" (backend default / unchanged
    // on PATCH), a filled one must satisfy the same range the server checks.
    const dealValueNum = dealValue.trim() === "" ? undefined : Number(dealValue);
    if (dealValueNum !== undefined && (!Number.isFinite(dealValueNum) || dealValueNum < 0)) {
      setError("Deal value must be zero or greater.");
      return;
    }
    const winProbabilityNum = winProbability.trim() === "" ? undefined : Number(winProbability);
    if (
      winProbabilityNum !== undefined &&
      (!Number.isInteger(winProbabilityNum) || winProbabilityNum < 0 || winProbabilityNum > 100)
    ) {
      setError("Win probability must be a whole number between 0 and 100.");
      return;
    }

    try {
      if (isEdit && opportunity) {
        await update.mutateAsync({
          id: opportunity.id,
          patch: {
            title: title.trim(),
            customerName: customerName.trim(),
            // Edit mode: an emptied field means "clear it", not "leave
            // unchanged" — the PATCH must send the explicit zero/empty
            // value (both accepted by updateOpportunitySchema, backend/src/
            // routes/opportunities.ts) rather than `undefined`, which the
            // route treats as "key not present, keep the existing value"
            // (`if (body.dealValue !== undefined) …` etc.). Create mode has
            // no existing value to accidentally clear, so it keeps sending
            // `undefined` for an empty field below (falls back to the
            // schema's create-time default) — see the `else` branch.
            dealValue: dealValueNum ?? 0,
            picId: picId === "" ? null : Number(picId),
            requestDate,
            deadline,
            description: description.trim() || null,
            productSolution: productSolution.trim(),
            leadSource: leadSource.trim() || null,
            // S6: an emptied field must still send an explicit value (see
            // the comment above), but `?? 0` was the wrong one to reach for
            // here — 0 is dealValue's create-path default (N3, mirrored by
            // the import parser's own blank-Deal-Value-is-0 rule), NOT
            // winProbability's. winProbability's create-path/schema default
            // is 50 (this form's own initial `useState("50")`, and
            // importParse.ts's blank-cell default) — so clearing the field
            // in edit mode must fall back to 50, matching create parity,
            // rather than silently zeroing out a deal's win probability.
            winProbability: winProbabilityNum ?? 50,
            // No `stage` here by design — updateOpportunitySchema is
            // `.strict()` and rejects it with a 400; stage changes go
            // through the board's move flow (POST /:id/move), not this
            // form. See the stage field's own comment below.
          },
        });
      } else {
        await create.mutateAsync({
          title: title.trim(),
          customerName: customerName.trim(),
          dealValue: dealValueNum,
          stage,
          picId: picId === "" ? undefined : Number(picId),
          requestDate,
          deadline,
          description: description.trim() || undefined,
          productSolution: productSolution.trim() || undefined,
          leadSource: leadSource.trim() || undefined,
          winProbability: winProbabilityNum,
        });
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
      title={isEdit ? "Edit opportunity" : "New opportunity"}
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
            form="opportunity-form"
            disabled={submitting}
            className="rounded-lg bg-primary px-4 py-1.5 text-xs font-bold text-on-primary hover:bg-primary/90 disabled:opacity-60"
          >
            {submitting ? "Saving…" : isEdit ? "Save changes" : "Create opportunity"}
          </button>
        </>
      }
    >
      <form id="opportunity-form" onSubmit={handleSubmit} className="space-y-4">
        <Field label="Title" required>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={200}
            autoFocus
            className="w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-2 text-sm text-on-surface focus:border-primary focus:outline-hidden focus:ring-2 focus:ring-primary/30"
          />
        </Field>

        <Field label="Customer" required>
          <input
            type="text"
            value={customerName}
            onChange={(e) => setCustomerName(e.target.value)}
            maxLength={200}
            className="w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-2 text-sm text-on-surface focus:border-primary focus:outline-hidden focus:ring-2 focus:ring-primary/30"
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Deal value (IDR)">
            <input
              type="number"
              min={0}
              step={1}
              inputMode="numeric"
              value={dealValue}
              onChange={(e) => setDealValue(e.target.value)}
              placeholder="0"
              className="w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-2 text-data-mono text-on-surface focus:border-primary focus:outline-hidden focus:ring-2 focus:ring-primary/30"
            />
          </Field>

          <Field label="Win probability (%)">
            <input
              type="number"
              min={0}
              max={100}
              step={1}
              inputMode="numeric"
              value={winProbability}
              onChange={(e) => setWinProbability(e.target.value)}
              className="w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-2 text-sm text-on-surface focus:border-primary focus:outline-hidden focus:ring-2 focus:ring-primary/30"
            />
          </Field>
        </div>

        {/*
          Stage is create-mode ONLY. updateOpportunitySchema is `.strict()`
          and 400s if `stage` appears in a PATCH body — the board's move flow
          (POST /:id/move, drag-and-drop or the detail page's StageChip menu)
          is the sole writer of stage changes once a deal exists, so an edit
          form must never render or submit this field.
        */}
        {!isEdit && (
          <Field label="Stage">
            <select
              value={stage}
              onChange={(e) => setStage(e.target.value as PipelineStage)}
              className="w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-2 text-sm text-on-surface focus:border-primary focus:outline-hidden focus:ring-2 focus:ring-primary/30"
            >
              {STAGE_ORDER.map((s) => (
                <option key={s} value={s}>
                  {STAGE_LABELS[s]}
                </option>
              ))}
            </select>
          </Field>
        )}

        <Field label="PIC">
          <select
            value={picId === "" ? "" : String(picId)}
            onChange={(e) => setPicId(e.target.value === "" ? "" : Number(e.target.value))}
            className="w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-2 text-sm text-on-surface focus:border-primary focus:outline-hidden focus:ring-2 focus:ring-primary/30"
          >
            <option value="">No PIC</option>
            {(users ?? []).map((u) => (
              <option key={u.id} value={u.id}>
                {u.username}
              </option>
            ))}
          </select>
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Request date">
            <DateField value={requestDate} onChange={setRequestDate} clearable />
          </Field>

          <Field label="Deadline">
            <DateField value={deadline} onChange={setDeadline} clearable />
          </Field>
        </div>

        <Field label="Product / solution">
          <input
            type="text"
            value={productSolution}
            onChange={(e) => setProductSolution(e.target.value)}
            maxLength={500}
            className="w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-2 text-sm text-on-surface focus:border-primary focus:outline-hidden focus:ring-2 focus:ring-primary/30"
          />
        </Field>

        <Field label="Lead source">
          <input
            type="text"
            value={leadSource}
            onChange={(e) => setLeadSource(e.target.value)}
            maxLength={200}
            className="w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-2 text-sm text-on-surface focus:border-primary focus:outline-hidden focus:ring-2 focus:ring-primary/30"
          />
        </Field>

        <Field label="Description">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            maxLength={5000}
            className="w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-2 text-sm text-on-surface focus:border-primary focus:outline-hidden focus:ring-2 focus:ring-primary/30"
          />
        </Field>

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
