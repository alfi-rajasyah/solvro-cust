import { Chip, type Tone } from "@/components/StatusChip";
import { riskLevelFromScore, type RiskLevel } from "@/lib/labels";

const LEVEL_TONE: Record<RiskLevel, Tone> = { Low: "emerald", Medium: "amber", High: "rose" };

/**
 * A risk's score as a standard chip: "4 · Low", toned by level. `levelOnly`
 * drops the number where the row is too tight for it. The tooltip shows the
 * sum. One component so every screen that lists risks shows the same chip.
 */
export function RiskScoreChip({
  probability,
  impact,
  levelOnly,
}: {
  probability: number;
  impact: number;
  levelOnly?: boolean;
}) {
  const score = probability * impact;
  const level = riskLevelFromScore(score);
  return (
    <span title={`${probability} × ${impact} = ${score}`} className="inline-flex shrink-0">
      <Chip tone={LEVEL_TONE[level]}>
        {!levelOnly && (
          <>
            <span className="tabular-nums">{score}</span>
            <span aria-hidden="true">·</span>
          </>
        )}
        {level}
      </Chip>
    </span>
  );
}
