import { useEffect, useState } from "react";
import { Modal } from "./Modal";
import { Alert, AlertDescription } from "@/components/reui/alert";
import {
  riskCategoryOptions,
  riskLevelFromScore,
  riskStatusOptions,
} from "@/lib/labels";
import {
  type Risk,
  type RiskCategory,
  type RiskStatus,
  useCreateRisk,
  useUpdateRisk,
} from "@/lib/queries";

const SCALE = [1, 2, 3, 4, 5];

interface Props {
  open: boolean;
  onClose: () => void;
  projectId: number;
  risk?: Risk | null;
}

export function RiskFormModal({ open, onClose, projectId, risk }: Props) {
  const isEdit = !!risk;
  const create = useCreateRisk(projectId);
  const update = useUpdateRisk(projectId);

  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<RiskCategory>("INTERNAL");
  const [probability, setProbability] = useState(1);
  const [impact, setImpact] = useState(1);
  const [status, setStatus] = useState<RiskStatus>("OPEN");
  const [mitigationPlan, setMitigationPlan] = useState("");
  const [contingencyPlan, setContingencyPlan] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    if (risk) {
      setDescription(risk.description);
      setCategory(risk.category);
      setProbability(risk.probability);
      setImpact(risk.impact);
      setStatus(risk.status);
      setMitigationPlan(risk.mitigationPlan ?? "");
      setContingencyPlan(risk.contingencyPlan ?? "");
    } else {
      setDescription("");
      setCategory("INTERNAL");
      setProbability(1);
      setImpact(1);
      setStatus("OPEN");
      setMitigationPlan("");
      setContingencyPlan("");
    }
    setError(null);
  }, [open, risk]);

  const score = probability * impact;
  const busy = create.isPending || update.isPending;

  async function onSubmit() {
    if (!description.trim()) {
      setError("Description is required.");
      return;
    }
    const payload = {
      description: description.trim(),
      category,
      probability,
      impact,
      status,
      mitigationPlan: mitigationPlan.trim() || null,
      contingencyPlan: contingencyPlan.trim() || null,
    };
    try {
      if (isEdit && risk) {
        await update.mutateAsync({ id: risk.id, patch: payload });
      } else {
        await create.mutateAsync(payload);
      }
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save risk.");
    }
  }

  return (
    <Modal
      open={open}
      onClose={busy ? () => {} : onClose}
      title={isEdit ? "Edit risk" : "Add risk"}
      widthClass="max-w-2xl"
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
            onClick={onSubmit}
            disabled={busy}
            className="rounded-lg bg-primary px-4 py-1.5 text-xs font-bold text-on-primary hover:bg-primary/90 disabled:opacity-60"
          >
            {busy ? "Saving…" : isEdit ? "Save changes" : "Create risk"}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div>
          <label className="mb-1 block font-display text-label-caps uppercase text-on-surface-variant">
            Risk description
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            className="w-full rounded-sm border border-outline-variant bg-surface-container-lowest px-3 py-2 text-sm text-on-surface focus:border-primary focus:outline-hidden"
            placeholder="What could go wrong?"
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block font-display text-label-caps uppercase text-on-surface-variant">
              Category
            </label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as RiskCategory)}
              className="w-full rounded-sm border border-outline-variant bg-surface-container-lowest px-3 py-2 text-sm text-on-surface focus:border-primary focus:outline-hidden"
            >
              {riskCategoryOptions.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block font-display text-label-caps uppercase text-on-surface-variant">
              Status
            </label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as RiskStatus)}
              className="w-full rounded-sm border border-outline-variant bg-surface-container-lowest px-3 py-2 text-sm text-on-surface focus:border-primary focus:outline-hidden"
            >
              {riskStatusOptions.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label className="mb-1 block font-display text-label-caps uppercase text-on-surface-variant">
              Probability (1–5)
            </label>
            <select
              value={probability}
              onChange={(e) => setProbability(Number(e.target.value))}
              className="w-full rounded-sm border border-outline-variant bg-surface-container-lowest px-3 py-2 text-sm text-on-surface focus:border-primary focus:outline-hidden"
            >
              {SCALE.map((n) => (
                <option key={n} value={n}>
                  {n} {scaleLabel(n)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block font-display text-label-caps uppercase text-on-surface-variant">
              Impact (1–5)
            </label>
            <select
              value={impact}
              onChange={(e) => setImpact(Number(e.target.value))}
              className="w-full rounded-sm border border-outline-variant bg-surface-container-lowest px-3 py-2 text-sm text-on-surface focus:border-primary focus:outline-hidden"
            >
              {SCALE.map((n) => (
                <option key={n} value={n}>
                  {n} {scaleLabel(n)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block font-display text-label-caps uppercase text-on-surface-variant">
              Score
            </label>
            <div
              className={[
                "flex h-[38px] items-center justify-center rounded-sm border px-3 text-sm font-bold tabular-nums",
                scoreClass(score),
              ].join(" ")}
            >
              {score}{" "}
              <span className="ml-2 font-display text-label-caps uppercase">
                {riskLevelFromScore(score)}
              </span>
            </div>
          </div>
        </div>

        <div>
          <label className="mb-1 block font-display text-label-caps uppercase text-on-surface-variant">
            Mitigation plan
          </label>
          <textarea
            value={mitigationPlan}
            onChange={(e) => setMitigationPlan(e.target.value)}
            rows={3}
            className="w-full rounded-sm border border-outline-variant bg-surface-container-lowest px-3 py-2 text-sm text-on-surface focus:border-primary focus:outline-hidden"
            placeholder="Steps to reduce probability or impact."
          />
        </div>

        <div>
          <label className="mb-1 block font-display text-label-caps uppercase text-on-surface-variant">
            Contingency plan
          </label>
          <textarea
            value={contingencyPlan}
            onChange={(e) => setContingencyPlan(e.target.value)}
            rows={3}
            className="w-full rounded-sm border border-outline-variant bg-surface-container-lowest px-3 py-2 text-sm text-on-surface focus:border-primary focus:outline-hidden"
            placeholder="What to do if the risk materialises."
          />
        </div>
      </div>
    </Modal>
  );
}

function scaleLabel(n: number): string {
  return ["", "Very Low", "Low", "Medium", "High", "Very High"][n] ?? "";
}

// The level thresholds live in lib/labels.ts (riskLevel); re-exported here so
// existing importers keep working.
export { riskLevelFromScore as scoreLevel };

export function scoreClass(score: number): string {
  if (score <= 8)
    return "border-transparent bg-chip-emerald-bg text-chip-emerald-text";
  if (score <= 15)
    return "border-transparent bg-chip-amber-bg text-chip-amber-text";
  return "border-transparent bg-chip-rose-bg text-chip-rose-text";
}
