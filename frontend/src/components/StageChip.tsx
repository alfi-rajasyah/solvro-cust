import { Chip, type Tone } from "@/components/StatusChip";
import { STAGE_LABELS, type PipelineStage } from "@/lib/pipelineFormat";

// PRD §2.2 "Stage chip tones" table: `poc` and `technical_clarification`
// share `rfp`'s "in-motion" blue tone row; `hold` gets its own amber row
// plus a `pause_circle` glyph (same icon PRD §2.2's Icons list and §2.3's
// held-card treatment use) to disambiguate it from `deliver_proposal`,
// which is also amber.
const STAGE_TONE: Record<PipelineStage, Tone> = {
  ASSESSMENT: "gray",
  RFP: "blue",
  POC: "blue",
  TECHNICAL_CLARIFICATION: "blue",
  DELIVER_PROPOSAL: "amber",
  WAITING_RESPONSE: "violet",
  WON: "emerald",
  DROP: "rose",
  HOLD: "amber",
};

// Humanized stage text for non-chip surfaces that want the same mapping
// without rendering a full colored chip (mirrors StatusChip's
// projectStatusLabel export).
export function pipelineStageLabel(stage: PipelineStage): string {
  return STAGE_LABELS[stage];
}

export function StageChip({ stage }: { stage: PipelineStage }) {
  return (
    <Chip tone={STAGE_TONE[stage]}>
      {stage === "HOLD" ? (
        <span className="material-symbols-outlined text-[13px]" aria-hidden="true">
          pause_circle
        </span>
      ) : null}
      {STAGE_LABELS[stage]}
    </Chip>
  );
}
