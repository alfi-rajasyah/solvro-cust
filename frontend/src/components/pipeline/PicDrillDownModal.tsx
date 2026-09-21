// PIC drill-down modal — opened from a leaderboard row or workload-heatmap
// lane on the Executive "Pipeline analytics" fold-in (PRD §2.7 point 4;
// dispatch: "mirroring the reference's `pic-detail-modal` content"). Ports
// VeloraApp's `pic-detail-modal.tsx` (../VeloraApp/components/dashboard/,
// read-only reference) as a compact deal list — no server round trip (that
// reference fetches `/api/dashboard/pic-summary/:id/opportunities`; this
// version filters the already-fetched `useOpportunities()` list client-side
// via `dealsForPic`, since PRD §2.7's fold-ins are client-side-only) — with
// a click-through to `/pipeline/:id` per deal instead of the reference's
// read-only table.
import { Link } from "react-router-dom";
import { dealsForPic } from "@/components/pipeline/analytics";
import { EmptyState } from "@/components/EmptyState";
import { Modal } from "@/components/Modal";
import { StageChip } from "@/components/StageChip";
import { formatIDRCompact } from "@/lib/pipelineFormat";
import type { Opportunity } from "@/lib/queries";

export interface PicDrillDownModalProps {
  /** `null` closes the modal — same "value carries open state" convention as `Modal`'s own `open` prop callers. */
  picId: number | null;
  picName: string;
  deals: Opportunity[];
  onClose: () => void;
}

export function PicDrillDownModal({ picId, picName, deals, onClose }: PicDrillDownModalProps) {
  const picDeals = picId === null ? [] : dealsForPic(deals, picId);
  const totalValue = picDeals.reduce((sum, d) => sum + d.dealValue, 0);

  return (
    <Modal
      open={picId !== null}
      onClose={onClose}
      title={picName}
      widthClass="max-w-xl"
    >
      <p className="mb-3 text-xs text-on-surface-variant">
        {picDeals.length} deal{picDeals.length === 1 ? "" : "s"} · {formatIDRCompact(totalValue)} total
      </p>

      {picDeals.length === 0 ? (
        <EmptyState icon="person_search" message="No deals assigned to this PIC." />
      ) : (
        <ul className="divide-y divide-outline-variant">
          {picDeals.map((deal) => (
            <li key={deal.id}>
              <Link
                to={`/pipeline/${deal.id}`}
                onClick={onClose}
                className="flex items-center justify-between gap-3 rounded-sm px-1 py-2.5 hover:bg-surface-container"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-on-surface">{deal.title}</p>
                  <p className="truncate text-xs text-on-surface-variant">{deal.customerName}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <StageChip stage={deal.stage} />
                  <span className="font-mono text-xs font-semibold text-on-surface">
                    {formatIDRCompact(deal.dealValue)}
                  </span>
                  <span className="material-symbols-outlined text-base text-on-surface-variant">
                    chevron_right
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
