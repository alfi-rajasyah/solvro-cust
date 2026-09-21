// Pure, React-free gating logic for the Pipeline board — split out of
// SolvroPipelineKanban.tsx so both are unit-testable without a DOM (this
// repo has no @testing-library/react; every kanban-adjacent test file is a
// plain vitest .test.ts over extracted pure functions — see
// kanban-v2/adapter.test.ts, pipeline/commitMapper.test.ts, etc.).
import { hasPermission, type AuthUser } from "@/lib/auth";
import { TERMINAL_STAGES, type PipelineStage } from "@/lib/pipelineFormat";
import type { PipelineBoardDeal } from "./adapter";

/**
 * Drag-permission gate for a single deal — mirrors the backend's
 * `assertCanWriteOpportunity` (backend/src/lib/pipelineAccess.ts) exactly:
 * `pipeline:edit_all` (or the `"*"` wildcard, handled inside
 * `hasPermission`) always allows; otherwise the caller needs
 * `pipeline:edit_own` AND to be the deal's own PIC. This is a proactive UI
 * gate only (disables the drag handle so a non-owner never sees a card they
 * can't move as draggable) — the server remains the authority; a 403 here
 * would just be a race (someone else re-assigned the PIC mid-session).
 */
export function canDragDeal(
  user: AuthUser | null | undefined,
  deal: Pick<PipelineBoardDeal, "picId">,
): boolean {
  return (
    hasPermission(user, "pipeline:edit_all") ||
    (hasPermission(user, "pipeline:edit_own") && deal.picId === user?.id)
  );
}

/**
 * Does landing a card on `targetStage` need the WON/DROP confirmation (PRD
 * §2.3 point 4)? True only for a REAL transition INTO a terminal stage —
 * `sourceContainer` (the commit meta's `activeContainer`, i.e. where the
 * drag started) must differ from `targetStage`. Reordering cards that are
 * already resting in WON or DROP (a same-stage drag, `sourceContainer ===
 * targetStage`) is a harmless list reorder with no business consequence and
 * must not re-prompt on every such drag.
 */
export function needsTerminalConfirm(targetStage: PipelineStage, sourceContainer: string): boolean {
  return TERMINAL_STAGES.includes(targetStage) && sourceContainer !== targetStage;
}

/**
 * Delete-permission gate for a single deal — mirrors the backend's
 * `assertCanWriteOpportunity(user, "delete", ...)`
 * (backend/src/lib/pipelineAccess.ts): `pipeline:delete_all` (or the `"*"`
 * wildcard, handled inside `hasPermission`) always allows; otherwise the
 * caller needs `pipeline:delete_own` AND to be the deal's own PIC. Same
 * proactive-UI-gate caveat as `canDragDeal` above (server remains the
 * authority). Colocated with `canDragDeal` (finding S10) rather than
 * OpportunityDetail.tsx's own private copy — both are pure permission
 * gates over the same `Pick<PipelineBoardDeal, "picId">` shape.
 */
export function canDeleteDeal(
  user: AuthUser | null | undefined,
  deal: Pick<PipelineBoardDeal, "picId">,
): boolean {
  return (
    hasPermission(user, "pipeline:delete_all") ||
    (hasPermission(user, "pipeline:delete_own") && deal.picId === user?.id)
  );
}

/**
 * Assign-permission gate for a single deal — mirrors the backend's new
 * `assertCanAssignOpportunity` (backend/src/lib/pipelineAccess.ts):
 * `pipeline:edit_all` (or the `"*"` wildcard, handled inside
 * `hasPermission`) always allows; otherwise the caller needs
 * `pipeline:edit_own` AND the deal must have no PIC yet (D1: an unassigned
 * deal stays locked for everything but this one action, for everyone but
 * `_all` holders — an `_own` holder can never reassign an already-assigned
 * deal through this gate, foreign or their own, per D4). Same
 * proactive-UI-gate caveat as `canDragDeal`/`canDeleteDeal` above — the
 * server remains the authority; a 403 here would just be a race.
 */
export function canAssignDeal(
  user: AuthUser | null | undefined,
  deal: Pick<PipelineBoardDeal, "picId">,
): boolean {
  return (
    hasPermission(user, "pipeline:edit_all") ||
    (hasPermission(user, "pipeline:edit_own") && deal.picId === null)
  );
}
