// Opportunity detail — `/pipeline/:id` (PRD §2.5, docs/plans/velora-integration-prd.md).
// Full page, not a side panel (the PRD is explicit: Velora's detail has too
// much content for a `TaskPanel`-style overlay) — structured like
// `ProjectDetail.tsx`/`CustomerDetail.tsx`: params -> query hook ->
// loading/404 gate -> content, back affordance to the list route.
//
// Edit affordance (M3 integration): opens `OpportunityFormModal` in edit
// mode, gated on `canEditDeal` (same `canDragDeal` gate the board's drag
// handle and the StageChip menu below already use) — see the header's Edit
// button and the modal mount near the bottom of this component.
//
// Assign PIC affordance (claim-unassigned-deals plan, D1/D2): an unassigned
// deal is locked for `pipeline:edit_own` holders — no drag, edit, stage
// change, link or delete — until it has a PIC. This button, gated on
// `canAssignThisDeal`, is the one exception; it opens `AssignPicModal`.
// Once assigned, the deal's normal own-rules (canEditDeal/canDeleteThisDeal
// above) take over — an `edit_all` holder reassigns an already-assigned
// deal through Edit, not through this button.
import { useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { AssigneeAvatar } from "@/components/AssigneeAvatar";
import { AssignPicModal } from "@/components/AssignPicModal";
import { ConfirmModal } from "@/components/ConfirmModal";
import { HandoffProjectModal } from "@/components/DealCard";
import { OpportunityFormModal } from "@/components/OpportunityFormModal";
import {
  canAssignDeal,
  canDeleteDeal,
  canDragDeal,
  needsTerminalConfirm,
} from "@/components/pipeline/boardLogic";
import { probabilityTone } from "@/components/pipeline/kpi";
import { Alert, AlertAction, AlertDescription } from "@/components/reui/alert";
import {
  Timeline,
  TimelineIndicator,
  TimelineItem,
  TimelineSeparator,
} from "@/components/reui/timeline";
import { StageChip } from "@/components/StageChip";
import { Chip } from "@/components/StatusChip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ApiError } from "@/lib/api";
import { hasPermission, useAuth } from "@/lib/auth";
import {
  formatIDR,
  formatPipelineDate,
  formatWinProbability,
  STAGE_LABELS,
  STAGE_ORDER,
  type PipelineStage,
} from "@/lib/pipelineFormat";
import {
  useAddOpportunityActivity,
  useAddOpportunityLink,
  useDeleteOpportunity,
  useDeleteOpportunityLink,
  useMoveOpportunity,
  useOpportunity,
  useOpportunityActivities,
  useOpportunityLinks,
  useUpdateOpportunityLink,
  type Opportunity,
  type OpportunityActivity,
  type OpportunityLink,
} from "@/lib/queries";

// `insertAtStage` (backend/src/routes/opportunities.ts:138-152) clamps any
// requestedPosition to [0, siblings.length] inside a transaction — this
// constant is deliberately far larger than any realistic stage sibling
// count so a stage-menu selection always lands at the bottom of the target
// stage (the board's own drop-at-end default for a non-drag stage change).
const APPEND_TO_STAGE = 1_000_000;

// Mirrors Velora's `getDocIcon` (../VeloraApp
// app/opportunities/[id]/detail-content.tsx) — same URL-substring
// detection, remapped from emoji onto material-symbols glyphs per house
// icon convention (frontend/CLAUDE.md: app chrome uses the
// material-symbols-outlined font).
function linkIcon(url: string): string {
  if (url.includes("docs.google.com/spreadsheets")) return "table_chart";
  if (url.includes("docs.google.com/presentation")) return "slideshow";
  if (url.includes("docs.google.com/document")) return "description";
  if (url.includes("drive.google.com")) return "folder";
  return "link";
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

// Duplicated from TaskPanel.tsx's private `relativeTime` helper (same
// house convention for comment/activity timestamps) — not exported there,
// so re-implemented verbatim rather than reaching into that file.
function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const diffMs = Date.now() - then;
  const diffMin = Math.round(diffMs / 60_000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.round(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function OpportunityDetail() {
  const { id } = useParams<{ id: string }>();
  const dealId = id ?? null;
  const navigate = useNavigate();
  const { user } = useAuth();

  const { data: deal, isLoading, isError, error } = useOpportunity(dealId);
  const activities = useOpportunityActivities(dealId);
  const links = useOpportunityLinks(dealId);

  const moveOpportunity = useMoveOpportunity();
  const deleteOpportunity = useDeleteOpportunity();
  // Constructed with `id ?? ""` — these mutation hooks take a plain string
  // (no `enabled` gate like the query hooks above), but every path that can
  // actually call `.mutate()`/`.mutateAsync()` on them is only reachable
  // after the loading/404 gate below has already confirmed `deal` (and thus
  // a real `id`) loaded successfully.
  const addActivity = useAddOpportunityActivity(id ?? "");
  const addLink = useAddOpportunityLink(id ?? "");
  const updateLink = useUpdateOpportunityLink(id ?? "");
  const deleteLink = useDeleteOpportunityLink(id ?? "");

  const [pendingStage, setPendingStage] = useState<PipelineStage | null>(null);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  // Post-won handoff offer (PRD §2.10, M5.24): a transient nudge shown
  // right after THIS SESSION's own move into WON succeeds — separate from
  // the persistent "Create project" button below, which covers the case
  // where this banner was dismissed or the deal was already WON on load
  // (see that button's own `stage === "WON" && !projectId` gate — the offer
  // must not evaporate just because this one-shot banner was closed).
  const [justWonOffer, setJustWonOffer] = useState(false);
  const [handoffOpen, setHandoffOpen] = useState(false);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="h-6 w-32 animate-pulse rounded-sm bg-surface-container-low" />
        <div className="h-20 animate-pulse rounded-xl bg-surface-container-low" />
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="h-64 animate-pulse rounded-xl bg-surface-container-low lg:col-span-2" />
          <div className="h-64 animate-pulse rounded-xl bg-surface-container-low" />
        </div>
      </div>
    );
  }

  if (isError || !deal) {
    return (
      <Alert variant="destructive">
        <AlertDescription>
          {error instanceof Error
            ? error.message
            : "Opportunity not found or you don't have access."}{" "}
          <Link to="/pipeline" className="ml-2 font-bold underline">
            Back to Pipeline
          </Link>
        </AlertDescription>
      </Alert>
    );
  }

  const canEditDeal = canDragDeal(user, deal);
  const canDeleteThisDeal = canDeleteDeal(user, deal);
  // Shows only on an unassigned deal — an `edit_all` holder reassigns an
  // already-assigned deal through Edit, not through this button (D4).
  const canAssignThisDeal = deal.picId === null && canAssignDeal(user, deal);

  function handleSelectStage(stage: PipelineStage) {
    if (!deal || stage === deal.stage) return;
    if (needsTerminalConfirm(stage, deal.stage)) {
      setPendingStage(stage);
      return;
    }
    moveOpportunity.mutate({ id: deal.id, stage, stageOrder: APPEND_TO_STAGE });
  }

  // Mirrors SolvroPipelineKanban.tsx's handleConfirmMove: async
  // mutateAsync, stays "busy" until it settles, closes the modal either
  // way — a failed move surfaces via the isError Alert below (the
  // mutation's own onError already rolled back any optimistic write).
  async function handleConfirmStage() {
    if (!deal || !pendingStage) return;
    const targetStage = pendingStage;
    try {
      await moveOpportunity.mutateAsync({
        id: deal.id,
        stage: targetStage,
        stageOrder: APPEND_TO_STAGE,
      });
      // Only a REAL entry into WON offers the handoff — reordering an
      // already-WON deal never reaches here (handleSelectStage's own
      // `stage === deal.stage` guard above short-circuits a same-stage
      // pick before pendingStage is ever set). Same two-part gate as the
      // persistent button below: project:write AND deal-edit rights
      // (`canEditDeal`) — the backend's POST /:id/handoff checks
      // `assertCanWriteOpportunity(user, "edit", deal)` in addition to
      // project:write, so a project:write holder who isn't this deal's own
      // PIC and lacks pipeline:edit_all would 403 on submit; no point
      // nudging toward a form that's guaranteed to fail.
      if (targetStage === "WON" && hasPermission(user, "project:write") && canEditDeal) {
        setJustWonOffer(true);
      }
    } catch {
      // Surfaced via the isError Alert below.
    } finally {
      setPendingStage(null);
    }
  }

  async function handleDelete() {
    if (!deal) return;
    try {
      await deleteOpportunity.mutateAsync(deal.id);
      navigate("/pipeline");
    } catch {
      // Surfaced via the isError Alert below; modal closes either way,
      // same pattern as the stage-change confirm above.
    } finally {
      setConfirmDeleteOpen(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <Link
          to="/pipeline"
          className="inline-flex items-center gap-1 font-display text-[12px] font-bold uppercase tracking-wider text-on-surface-variant hover:text-primary"
        >
          <span className="material-symbols-outlined text-[17px]">chevron_left</span>
          Pipeline
        </Link>

        <div className="mt-2 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0">
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <h1 className="truncate font-display text-h2 text-on-surface">{deal.title}</h1>
              <StageMenu stage={deal.stage} canEdit={canEditDeal} onSelect={handleSelectStage} />
            </div>
            <p className="text-sm text-on-surface-variant">{deal.customerName}</p>
          </div>

          <div className="flex shrink-0 items-center gap-3">
            {/* `font-mono`, not `text-data-mono` (N4): `text-data-mono`
                carries its own fixed 13px font-size token, which conflicts
                with `text-lg` here — `font-mono` applies only the
                monospace font family. */}
            <span className="font-mono text-lg text-primary">{formatIDR(deal.dealValue)}</span>
            {/* Persistent handoff affordance (PRD §2.10) — deliberately NOT
                gated on the transient `justWonOffer` banner below: it must
                stay available for as long as `stage === "WON" && !projectId`
                holds, including a fresh page load on an already-WON deal or
                after the banner's own Dismiss. Already-linked WON deals get
                a plain link to the project instead — no permission gate on
                that one, since following a link isn't a write. Gated on
                `project:write` AND `canEditDeal` — see handleConfirmStage's
                matching gate above for why both are needed (the backend's
                POST /:id/handoff enforces both). */}
            {deal.stage === "WON" && deal.projectId && (
              <Link
                to={`/projects/${deal.projectId}`}
                className="inline-flex items-center gap-1 rounded-sm border border-outline-variant px-2.5 py-1.5 font-display text-label-caps uppercase tracking-wider text-on-surface-variant hover:border-primary hover:text-primary"
              >
                <span className="material-symbols-outlined text-base">business_center</span>
                View project
              </Link>
            )}
            {deal.stage === "WON" &&
              !deal.projectId &&
              hasPermission(user, "project:write") &&
              canEditDeal && (
              <button
                type="button"
                onClick={() => setHandoffOpen(true)}
                className="inline-flex items-center gap-1 rounded-sm border border-primary px-2.5 py-1.5 font-display text-label-caps uppercase tracking-wider text-primary hover:bg-primary/10"
              >
                <span className="material-symbols-outlined text-base">rocket_launch</span>
                Create project
              </button>
            )}
            {canAssignThisDeal && (
              <button
                type="button"
                onClick={() => setAssignOpen(true)}
                className="inline-flex items-center gap-1 rounded-sm border border-primary px-2.5 py-1.5 font-display text-label-caps uppercase tracking-wider text-primary hover:bg-primary/10"
              >
                <span className="material-symbols-outlined text-base">person_add</span>
                Assign PIC
              </button>
            )}
            {canEditDeal && (
              <button
                type="button"
                onClick={() => setEditOpen(true)}
                className="inline-flex items-center gap-1 rounded-sm border border-outline-variant px-2.5 py-1.5 font-display text-label-caps uppercase tracking-wider text-on-surface-variant hover:border-primary hover:text-primary"
              >
                <span className="material-symbols-outlined text-base">edit</span>
                Edit
              </button>
            )}
            {canDeleteThisDeal && (
              <button
                type="button"
                onClick={() => setConfirmDeleteOpen(true)}
                className="inline-flex items-center gap-1 rounded-sm border border-outline-variant px-2.5 py-1.5 font-display text-label-caps uppercase tracking-wider text-on-surface-variant hover:border-error hover:text-error"
              >
                <span className="material-symbols-outlined text-base">delete</span>
                Delete
              </button>
            )}
          </div>
        </div>
      </div>

      {moveOpportunity.isError && (
        <Alert variant="destructive">
          <AlertDescription>
            Could not change stage: {(moveOpportunity.error as Error).message}
          </AlertDescription>
        </Alert>
      )}
      {deleteOpportunity.isError && (
        <Alert variant="destructive">
          <AlertDescription>
            Could not delete this opportunity: {(deleteOpportunity.error as Error).message}
          </AlertDescription>
        </Alert>
      )}

      {/* Non-blocking inline offer, not a modal ambush (PRD §2.10) — only
          for as long as this deal has no linked project yet; a second stage
          change on an already-linked deal (extremely unlikely — WON is
          terminal, see STAGE_MENU) wouldn't re-show a stale offer. */}
      {justWonOffer && !deal.projectId && (
        <Alert variant="success">
          <AlertDescription>Deal won — create the delivery project?</AlertDescription>
          <AlertAction>
            <button
              type="button"
              onClick={() => {
                setHandoffOpen(true);
                setJustWonOffer(false);
              }}
              className="rounded-sm bg-primary px-3 py-1 font-display text-[12px] font-bold text-on-primary hover:bg-primary-container"
            >
              Create project
            </button>
            <button
              type="button"
              onClick={() => setJustWonOffer(false)}
              className="rounded-sm px-2.5 py-1 text-[12px] font-semibold text-on-surface-variant hover:bg-surface-container"
            >
              Dismiss
            </button>
          </AlertAction>
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <MetaGrid deal={deal} />
          <ActivitySection
            activities={activities.data}
            isLoading={activities.isLoading}
            isError={activities.isError}
            error={activities.error}
            addActivity={addActivity}
          />
        </div>

        <div className="space-y-6">
          <LinksSection
            canEdit={canEditDeal}
            links={links.data}
            isLoading={links.isLoading}
            isError={links.isError}
            error={links.error}
            addLink={addLink}
            updateLink={updateLink}
            deleteLink={deleteLink}
          />
        </div>
      </div>

      {pendingStage && (
        <ConfirmModal
          open
          onClose={() => setPendingStage(null)}
          onConfirm={handleConfirmStage}
          title={pendingStage === "WON" ? "Mark opportunity as Won?" : "Drop this opportunity?"}
          body={
            <>
              Move <strong>{deal.title}</strong> to <strong>{STAGE_LABELS[pendingStage]}</strong>?
              This records a stage change on the deal's activity log.
            </>
          }
          confirmLabel={pendingStage === "WON" ? "Mark as Won" : "Move to Drop"}
          confirmTone={pendingStage === "WON" ? "primary" : "warning"}
          busy={moveOpportunity.isPending}
        />
      )}

      <ConfirmModal
        open={confirmDeleteOpen}
        onClose={() => setConfirmDeleteOpen(false)}
        onConfirm={handleDelete}
        title="Delete opportunity"
        body={
          <>
            Delete <strong>{deal.title}</strong>? This cannot be undone.
          </>
        }
        confirmLabel="Delete"
        confirmTone="warning"
        busy={deleteOpportunity.isPending}
      />

      <OpportunityFormModal open={editOpen} onClose={() => setEditOpen(false)} opportunity={deal} />

      <AssignPicModal open={assignOpen} onClose={() => setAssignOpen(false)} opportunity={deal} />

      <HandoffProjectModal open={handoffOpen} onClose={() => setHandoffOpen(false)} deal={deal} />
    </div>
  );
}

function StageMenu({
  stage,
  canEdit,
  onSelect,
}: {
  stage: PipelineStage;
  canEdit: boolean;
  onSelect: (stage: PipelineStage) => void;
}) {
  // View-only callers (no pipeline:edit_own/edit_all on this deal, mirrors
  // canDragDeal's board gate) get the plain chip, no dropdown affordance.
  if (!canEdit) return <StageChip stage={stage} />;

  return (
    <DropdownMenu>
      {/* All visual content lives INSIDE the `render` element (house
          pattern — see reui/gantt/gantt-nav.tsx, reui/filters.tsx: every
          DropdownMenuTrigger usage in this codebase composes this way, not
          via separate `children` on the trigger itself). */}
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            aria-label="Change stage"
            className="inline-flex items-center gap-1 rounded-full outline-hidden hover:opacity-80 focus-visible:ring-2 focus-visible:ring-primary/30"
          >
            <StageChip stage={stage} />
            <span className="material-symbols-outlined text-[16px] text-on-surface-variant">
              expand_more
            </span>
          </button>
        }
      />
      <DropdownMenuContent align="start">
        {STAGE_ORDER.map((s) => (
          <DropdownMenuItem key={s} disabled={s === stage} onClick={() => onSelect(s)}>
            {STAGE_LABELS[s]}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function MetaItem({
  icon,
  label,
  children,
}: {
  icon: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-2">
      <span className="material-symbols-outlined mt-0.5 text-[17px] text-on-surface-variant">
        {icon}
      </span>
      <div className="min-w-0">
        <p className="text-[11px] uppercase tracking-wider text-on-surface-variant">{label}</p>
        <div className="text-sm text-on-surface">{children}</div>
      </div>
    </div>
  );
}

function MetaGrid({ deal }: { deal: Opportunity }) {
  return (
    <div className="space-y-3 rounded-sm border border-outline-variant bg-surface-container-lowest p-4">
      <h2 className="font-display text-[13px] font-bold uppercase tracking-wider text-on-surface-variant">
        Details
      </h2>

      {/* Held-from cue — PRD §2.3/§2.5, same treatment as OpportunityCard's
          board-card cue. No auto-restore hint here: v1 dropped the auto-hold
          cron entirely (docs/plans/pipeline-native-port-plan.md, resolved
          question 4) — HOLD is a manual stage like any other now, so there
          is no "adding activity restores this deal" mechanism to advertise. */}
      {deal.stage === "HOLD" && deal.preHoldStage && (
        <div className="flex items-center gap-1.5 rounded-sm bg-chip-amber-bg px-3 py-2 text-[12px] font-semibold text-chip-amber-text">
          <span className="material-symbols-outlined text-[16px]">pause_circle</span>
          Held from {STAGE_LABELS[deal.preHoldStage]}
        </div>
      )}

      <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
        <MetaItem icon="person" label="PIC">
          <span className="flex items-center gap-2">
            <AssigneeAvatar user={deal.pic} size="xs" />
            {deal.pic?.username ?? "Unassigned"}
          </span>
        </MetaItem>
        <MetaItem icon="show_chart" label="Win probability">
          <Chip tone={probabilityTone(deal.winProbability)}>
            {formatWinProbability(deal.winProbability)}
          </Chip>
        </MetaItem>
        <MetaItem icon="today" label="Request date">
          {deal.requestDate ? formatPipelineDate(deal.requestDate) : "—"}
        </MetaItem>
        <MetaItem icon="event" label="Deadline">
          {deal.deadline ? formatPipelineDate(deal.deadline) : "—"}
        </MetaItem>
        <MetaItem icon="public" label="Lead source">
          {deal.leadSource || "—"}
        </MetaItem>
        <MetaItem icon="inventory_2" label="Product / Solution">
          {deal.productSolution || "—"}
        </MetaItem>
      </div>

      {deal.description && (
        <div className="border-t border-outline-variant pt-3">
          <p className="whitespace-pre-wrap wrap-break-word text-sm text-on-surface-variant">
            {deal.description}
          </p>
        </div>
      )}
    </div>
  );
}

function ActivitySection({
  activities,
  isLoading,
  isError,
  error,
  addActivity,
}: {
  activities: OpportunityActivity[] | undefined;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  addActivity: ReturnType<typeof useAddOpportunityActivity>;
}) {
  const [note, setNote] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = note.trim();
    if (!trimmed || addActivity.isPending) return;
    try {
      await addActivity.mutateAsync(trimmed);
      setNote("");
    } catch {
      // Surfaced via addActivity.error below.
    }
  }

  return (
    <div className="space-y-3 rounded-sm border border-outline-variant bg-surface-container-lowest p-4">
      <h2 className="font-display text-[13px] font-bold uppercase tracking-wider text-on-surface-variant">
        Activity {activities && activities.length > 0 && `· ${activities.length}`}
      </h2>

      {isLoading && (
        <div className="h-16 animate-pulse rounded-sm bg-surface-container-low" />
      )}
      {isError && (
        <Alert variant="destructive">
          <AlertDescription>
            Could not load activity: {(error as Error).message}
          </AlertDescription>
        </Alert>
      )}
      {activities && activities.length === 0 && (
        <p className="text-sm text-on-surface-variant">No activity yet.</p>
      )}

      {/* `value={-1}` neutralizes reui Timeline's step/active-state concept
          (SOLVRO PATCH convention from ProjectTimeline.tsx) — this is a
          newest-first activity feed, not a progress tracker; no item should
          receive the vendored "completed" styling. */}
      {activities && activities.length > 0 && (
        <Timeline value={-1} role="list">
          {activities.map((a, index) => (
            <TimelineItem
              key={a.id}
              step={index}
              role="listitem"
              className="group-data-[orientation=vertical]/timeline:not-last:pb-4"
            >
              <TimelineSeparator className="bg-outline-variant" />
              <TimelineIndicator className="border-surface-container-lowest bg-primary" />
              <div className="flex gap-2.5">
                <AssigneeAvatar user={a.user} size="xs" />
                <div className="min-w-0 flex-1 rounded-sm border border-outline-variant bg-surface-container-lowest px-3 py-2">
                  <div className="mb-0.5 flex items-center justify-between gap-2 text-[12px]">
                    <span className="min-w-0 truncate font-medium text-on-surface">
                      {a.user?.username ?? "Unknown"}
                    </span>
                    <span className="shrink-0 text-on-surface-variant">
                      {relativeTime(a.createdAt)}
                    </span>
                  </div>
                  <p className="whitespace-pre-wrap wrap-break-word text-xs text-on-surface">
                    {a.note}
                  </p>
                </div>
              </div>
            </TimelineItem>
          ))}
        </Timeline>
      )}

      <form onSubmit={handleSubmit} className="space-y-2 border-t border-outline-variant pt-3">
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          maxLength={2000}
          placeholder="Add a note…"
          className="w-full rounded-sm border border-outline-variant bg-surface-container-lowest px-3 py-2 text-sm text-on-surface placeholder:text-on-surface-variant focus:border-primary focus:outline-hidden focus:ring-2 focus:ring-primary/30"
        />
        <div className="flex items-center justify-between gap-2">
          {addActivity.isError ? (
            <p className="text-[12px] text-error">{(addActivity.error as Error).message}</p>
          ) : (
            <span />
          )}
          <button
            type="submit"
            disabled={addActivity.isPending || !note.trim()}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-sm bg-primary px-3 py-1.5 font-display text-xs font-bold text-on-primary hover:bg-primary-container disabled:opacity-50"
          >
            <span className="material-symbols-outlined text-base">send</span>
            {addActivity.isPending ? "Adding…" : "Add note"}
          </button>
        </div>
      </form>
    </div>
  );
}

function LinksSection({
  canEdit,
  links,
  isLoading,
  isError,
  error,
  addLink,
  updateLink,
  deleteLink,
}: {
  canEdit: boolean;
  links: OpportunityLink[] | undefined;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  addLink: ReturnType<typeof useAddOpportunityLink>;
  updateLink: ReturnType<typeof useUpdateOpportunityLink>;
  deleteLink: ReturnType<typeof useDeleteOpportunityLink>;
}) {
  const [formOpen, setFormOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmDeleteLink, setConfirmDeleteLink] = useState<OpportunityLink | null>(null);

  async function handleAdd() {
    setFormError(null);
    if (!label.trim()) {
      setFormError("Label is required.");
      return;
    }
    if (!isHttpUrl(url.trim())) {
      setFormError("URL must start with http:// or https://");
      return;
    }
    try {
      await addLink.mutateAsync({ label: label.trim(), url: url.trim() });
      setLabel("");
      setUrl("");
      setFormOpen(false);
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Could not add link.");
    }
  }

  return (
    <div className="space-y-3 rounded-sm border border-outline-variant bg-surface-container-lowest p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-display text-[13px] font-bold uppercase tracking-wider text-on-surface-variant">
          Links {links && links.length > 0 && `· ${links.length}`}
        </h2>
        {canEdit && (
          <button
            type="button"
            onClick={() => {
              setFormOpen((v) => !v);
              setFormError(null);
            }}
            className="inline-flex items-center gap-1 rounded-sm border border-outline-variant px-2 py-1 font-display text-label-caps uppercase tracking-wider text-on-surface-variant hover:border-primary hover:text-primary"
          >
            <span className="material-symbols-outlined text-base">add</span>
            Add link
          </button>
        )}
      </div>

      {isLoading && <div className="h-10 animate-pulse rounded-sm bg-surface-container-low" />}
      {isError && (
        <Alert variant="destructive">
          <AlertDescription>Could not load links: {(error as Error).message}</AlertDescription>
        </Alert>
      )}

      {formOpen && (
        <div className="space-y-2 rounded-sm border border-outline-variant bg-surface-container-low p-3">
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Label (e.g. Proposal)"
            className="w-full rounded-sm border border-outline-variant bg-surface-container-lowest px-2.5 py-1.5 text-sm text-on-surface placeholder:text-on-surface-variant focus:border-primary focus:outline-hidden focus:ring-2 focus:ring-primary/30"
          />
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://…"
            className="w-full rounded-sm border border-outline-variant bg-surface-container-lowest px-2.5 py-1.5 text-sm text-on-surface placeholder:text-on-surface-variant focus:border-primary focus:outline-hidden focus:ring-2 focus:ring-primary/30"
          />
          {formError && <p className="text-[12px] text-error">{formError}</p>}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setFormOpen(false);
                setFormError(null);
              }}
              className="rounded-sm px-2.5 py-1 text-[12px] font-semibold text-on-surface-variant hover:bg-surface-container"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleAdd}
              disabled={addLink.isPending}
              className="rounded-sm bg-primary px-3 py-1 font-display text-[12px] font-bold text-on-primary hover:bg-primary-container disabled:opacity-50"
            >
              {addLink.isPending ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      )}

      {links && links.length === 0 && !formOpen && (
        <p className="text-sm text-on-surface-variant">No links yet.</p>
      )}

      {links && links.length > 0 && (
        <ul className="divide-y divide-outline-variant/60">
          {links.map((link) => (
            <LinkRow
              key={link.id}
              link={link}
              canEdit={canEdit}
              updateLink={updateLink}
              onDelete={() => setConfirmDeleteLink(link)}
            />
          ))}
        </ul>
      )}

      <ConfirmModal
        open={confirmDeleteLink !== null}
        onClose={() => setConfirmDeleteLink(null)}
        onConfirm={() => {
          if (confirmDeleteLink) {
            deleteLink.mutate(confirmDeleteLink.id, {
              onSuccess: () => setConfirmDeleteLink(null),
            });
          }
        }}
        title="Delete link"
        body={
          confirmDeleteLink ? (
            <>
              Delete the link <strong>{confirmDeleteLink.label}</strong>?
            </>
          ) : null
        }
        confirmLabel="Delete"
        confirmTone="warning"
        busy={deleteLink.isPending}
      />
    </div>
  );
}

function LinkRow({
  link,
  canEdit,
  updateLink,
  onDelete,
}: {
  link: OpportunityLink;
  canEdit: boolean;
  updateLink: ReturnType<typeof useUpdateOpportunityLink>;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(link.label);
  const [url, setUrl] = useState(link.url);
  const [error, setError] = useState<string | null>(null);

  // `updateLink` is one shared mutation instance passed down to every
  // `LinkRow` (LinksSection creates it once) — its own `.isPending` is
  // global across every row's Save button, so saving link A would
  // incorrectly disable link B's Save button too while A is in flight
  // (both rows can independently be in `editing` state at once). Scope
  // "is THIS row's save in flight" by also checking the mutation's own
  // `.variables` — the acting link id from the most recent `.mutate()`
  // call — against this row's `link.id`.
  const isSaving = updateLink.isPending && updateLink.variables?.id === link.id;

  function startEdit() {
    setLabel(link.label);
    setUrl(link.url);
    setError(null);
    setEditing(true);
  }

  async function handleSave() {
    setError(null);
    if (!label.trim()) {
      setError("Label is required.");
      return;
    }
    if (!isHttpUrl(url.trim())) {
      setError("URL must start with http:// or https://");
      return;
    }
    try {
      await updateLink.mutateAsync({ id: link.id, patch: { label: label.trim(), url: url.trim() } });
      setEditing(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not update link.");
    }
  }

  if (editing) {
    return (
      <li className="space-y-2 py-2">
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          className="w-full rounded-sm border border-outline-variant bg-surface-container-lowest px-2.5 py-1.5 text-sm text-on-surface focus:border-primary focus:outline-hidden focus:ring-2 focus:ring-primary/30"
        />
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          className="w-full rounded-sm border border-outline-variant bg-surface-container-lowest px-2.5 py-1.5 text-sm text-on-surface focus:border-primary focus:outline-hidden focus:ring-2 focus:ring-primary/30"
        />
        {error && <p className="text-[12px] text-error">{error}</p>}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="rounded-sm px-2.5 py-1 text-[12px] font-semibold text-on-surface-variant hover:bg-surface-container"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={isSaving}
            className="rounded-sm bg-primary px-3 py-1 font-display text-[12px] font-bold text-on-primary hover:bg-primary-container disabled:opacity-50"
          >
            {isSaving ? "Saving…" : "Save"}
          </button>
        </div>
      </li>
    );
  }

  return (
    <li className="flex items-center gap-2 py-2">
      <span className="material-symbols-outlined shrink-0 text-[17px] text-primary">
        {linkIcon(link.url)}
      </span>
      <a
        href={link.url}
        target="_blank"
        rel="noopener noreferrer"
        className="min-w-0 flex-1 truncate text-sm font-medium text-primary hover:underline"
      >
        {link.label}
      </a>
      {/* Always visible (not hover-gated) — hover-only actions are
          unreachable on the 375px touch-device floor (frontend/CLAUDE.md
          Mobile convention). */}
      {canEdit && (
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={startEdit}
            aria-label="Edit link"
            className="rounded-sm p-1 text-on-surface-variant hover:bg-surface-container hover:text-primary"
          >
            <span className="material-symbols-outlined text-[16px]">edit</span>
          </button>
          <button
            type="button"
            onClick={onDelete}
            aria-label="Delete link"
            className="rounded-sm p-1 text-on-surface-variant hover:bg-surface-container hover:text-error"
          >
            <span className="material-symbols-outlined text-[16px]">delete</span>
          </button>
        </div>
      )}
    </li>
  );
}
