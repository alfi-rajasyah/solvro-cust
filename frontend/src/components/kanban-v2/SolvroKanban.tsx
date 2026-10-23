// SolvroKanban — kanban-v2 container mounted at /projects/:id/kanban (T11
// cutover; see docs/plans/kanban-reui-swap/plan.md T6, Architecture Decision 1).
// Renders the vendored ReUI Kanban engine (frontend/src/components/reui/
// kanban.tsx) over the pure adapter.ts projection. T7 wires
// value/onValueChange/onValueCommit: a live local projection is authoritative
// during a drag (query-derived updates frozen — Architecture Decision 5), and
// onValueCommit routes through commitMapper.ts into the single useUpdateTask
// write path (Architecture Decision 3/5). T8 adds the assignee/priority
// filter popover (render-only — see `isTaskVisible` below), the subtask
// checklist toggle, the mobile move sheet, and the per-column "..." menu.
// T9 ports the old board's swipeable-columns mobile pager (chevrons/dots +
// IntersectionObserver, ProjectKanban.tsx lines 150-243/576-616/624-634) —
// below `md:` this FIXES a real overlap bug: `KanbanBoard`'s vendor default
// className (`grid auto-rows-fr gap-4 sm:grid-cols-3`) has no mobile layout
// of its own, so below `sm:` it collapsed to an implicit single-column grid
// whose `auto-rows-fr` squeezed all three columns into equal-height rows —
// each column's actual content overflowed its row's bounds, visually
// bleeding into the next column and intercepting its clicks (T8 finding).
// `KanbanBoard` itself is reduced to `className="contents"` (its own box
// removed from the layout so its children bubble up to be direct flex/grid
// items of the new plain scroll-container div below it — `SortableContext`
// is a React-context wrapper, unaffected by its DOM box disappearing); the
// per-column wrapper div (matching the old board's own pattern) carries the
// scroll-snap sizing AND the ref IntersectionObserver needs, sidestepping
// `@base-ui/react/merge-props`'s documented "ref is not merged" contract
// (passing `ref` straight to `<KanbanColumn>` would silently drop dnd-kit's
// own `setNodeRef`, breaking that column as a drop target) and React 18's
// lack of ref-as-prop for non-forwardRef function components (rules out
// refing `<KanbanBoard>` directly too).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Kanban,
  KanbanBoard,
  KanbanColumn,
  type KanbanCommitMeta,
  KanbanColumnContent,
  KanbanItem,
  KanbanOverlay,
} from "@/components/reui/kanban";
import { Alert, AlertDescription } from "@/components/reui/alert";
import { ApiError } from "@/lib/api";
import { TaskFormModal } from "@/components/TaskFormModal";
import { hasPermission, useAuth } from "@/lib/auth";
import { useDragActivityGuard } from "@/lib/dragActivity";
import {
  type Epic,
  type Priority,
  type ProjectDetail,
  type Task,
  type TaskStatus,
  useProjectEpics,
  useProjectTasks,
  useUpdateTask,
  useUsers,
} from "@/lib/queries";
import { priorityOptions, TASK_STATUS_LABEL } from "@/lib/labels";
import { BoardSkeleton } from "@/components/skeletons";
import { KANBAN_STATUSES, projectToColumns, sortTasksCanonical } from "./adapter";
import { TaskCard } from "./cards";
import { mapCommitToPatch, type KanbanCommitMetaLike } from "./commitMapper";
import { MobileMoveSheet } from "./MobileMoveSheet";

/**
 * Synthesizes the same "append to target column" commit shape a column-body
 * drag produces (`reui/kanban.tsx`'s cross-column `handleDragOver`: the moved
 * item is spliced onto the end of the target column, `overIndex =
 * <target column's pre-append length>`) — used by the mobile move sheet (T8,
 * item 3), which has no real drag gesture to derive a vendor commit from.
 * Both `committedValue` and `meta` are fed into the SAME `mapCommitToPatch`
 * the drag path calls (below), so MS-1..MS-3 (scenarios.md section 5) share
 * their position math with CC-2/CC-3 exactly — no hand-rolled position
 * arithmetic here, only a hand-rolled commit *shape*. `meta.appendToStatus`
 * (M2 fix, Phase 2 review) is set to the same `targetStatus` the drag path
 * derives from `meta.event.over?.id` — the move sheet has no dnd-kit event
 * to read it from, but the semantics are identical: this IS a column-append,
 * so the mapper must anchor on the column's TRUE unfiltered last member, not
 * infer from `committedValue`'s (possibly filtered) visible neighbors.
 */
function buildColumnAppendCommit(
  columns: Record<TaskStatus, Task[]>,
  task: Task,
  targetStatus: TaskStatus,
): { committedValue: Record<TaskStatus, Task[]>; meta: KanbanCommitMetaLike } {
  const sourceStatus = task.status;
  const sourceColumn = columns[sourceStatus] ?? [];
  const activeIndex = sourceColumn.findIndex((t) => t.id === task.id);
  const targetColumn = columns[targetStatus] ?? [];

  const committedValue: Record<TaskStatus, Task[]> = {
    ...columns,
    [sourceStatus]: sourceColumn.filter((t) => t.id !== task.id),
    [targetStatus]: [...targetColumn, task],
  };

  const meta: KanbanCommitMetaLike = {
    kind: "item",
    activeContainer: sourceStatus,
    activeIndex: activeIndex === -1 ? 0 : activeIndex,
    overContainer: targetStatus,
    overIndex: targetColumn.length,
    previousValue: columns,
    appendToStatus: targetStatus,
  };

  return { committedValue, meta };
}

/** Per-column "..." menu — copied from ProjectKanban.tsx's `Column` (lines
 * 769-796). Its own component (rather than inline JSX in the KANBAN_STATUSES
 * map below) so `menuOpen` can be a real `useState` call, not one made from
 * inside an array-map callback. */
function ColumnMenu({ onAdd }: { onAdd: () => void }) {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setMenuOpen((v) => !v)}
        className="material-symbols-outlined cursor-pointer text-base text-on-surface-variant hover:text-on-surface"
        aria-label="Column options"
      >
        more_horiz
      </button>
      {menuOpen && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
          <div className="absolute right-0 z-20 mt-1 w-40 rounded-lg border border-outline-variant bg-surface-container-lowest py-1 shadow-overlay">
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                onAdd();
              }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-on-surface hover:bg-surface-container"
            >
              <span className="material-symbols-outlined text-sm">add</span>
              Add task here
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// SolvroKanban takes `project` as an explicit prop rather than calling
// useProjectContext() itself (Phase 2 review m2) — matching the
// ProjectGantt -> SolvroGantt precedent, where the thin `pages/views/`
// wrapper owns the context read. The wrapper for this component is
// `pages/views/ProjectKanban.tsx`.
export interface SolvroKanbanProps {
  project: ProjectDetail;
}

export function SolvroKanban({ project }: SolvroKanbanProps) {
  const { user } = useAuth();
  const { data: tasks, isLoading, isError, error } = useProjectTasks(project.id);
  const { data: users } = useUsers();
  const { data: epics } = useProjectEpics(project.id);
  const updateTask = useUpdateTask(project.id);
  const [, setSearchParams] = useSearchParams();
  const [createStatus, setCreateStatus] = useState<TaskStatus | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [filterAssigneeId, setFilterAssigneeId] = useState<number | "">("");
  const [filterPriority, setFilterPriority] = useState<Priority | "">("");
  // Epic filter (docs/archive/plans/epics-spec.md §6/§7 T5): "" = All (inactive),
  // `null` = "No epic" (task.epicId === null), a number = one project epic.
  const [filterEpicId, setFilterEpicId] = useState<number | null | "">("");
  const [mobileSheetTask, setMobileSheetTask] = useState<Task | null>(null);
  // A failed inline edit (drag, subtask toggle, mobile move) is rolled back by
  // useUpdateTask; without this the card just snapped back with no message.
  const [actionError, setActionError] = useState<string | null>(null);
  const onActionError = (err: unknown) =>
    setActionError(err instanceof ApiError ? err.message : "Could not update task.");

  // Built once from useProjectEpics, keyed by Epic.id — passed down to
  // TaskCard the same way subtaskMapAll is, so cards never call a per-card
  // hook to look up their epic.
  const epicMap = useMemo(() => {
    const map = new Map<number, Epic>();
    for (const e of epics ?? []) map.set(e.id, e);
    return map;
  }, [epics]);

  // Mobile swipeable-columns pager (<md), ported from ProjectKanban.tsx
  // lines 150-161/225-243 — tracks which column page is centered in the
  // scroll-snap container so the pager header/dots below can reflect it.
  // Desktop is unaffected: the same `<Kanban>` value/columns render, only
  // the wrapping DOM/CSS below `md:` differs (see the file-header comment).
  const [activeColIdx, setActiveColIdx] = useState(0);
  const boardScrollRef = useRef<HTMLDivElement | null>(null);
  const columnRefs = useRef<(HTMLDivElement | null)[]>([]);

  function scrollToColumn(idx: number) {
    const clamped = Math.max(0, Math.min(KANBAN_STATUSES.length - 1, idx));
    columnRefs.current[clamped]?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  }

  // Permission-correct write gate — single const (Phase 2 review n1: this
  // used to be two identically-computed consts, `canMove` and `dragEnabled`,
  // one for the "Add task"/move-sheet affordances and one for the two call
  // sites that actually gate drag mechanics: KanbanItem `disabled`, TaskCard
  // `canDrag` -> the KanbanItemHandle activator in cards.tsx). Kept under
  // the `dragEnabled` name since that's the greppable term the drag call
  // sites already used.
  const dragEnabled = hasPermission(user, "task:write");

  // Drag-live local projection (Architecture Decision 5): `null` when not
  // dragging (columns derive from query data below); during a live drag this
  // holds the vendor's own live-preview arrangement, set by onValueChange,
  // and query-derived updates are ignored until the drag settles.
  const [liveColumns, setLiveColumns] = useState<Record<TaskStatus, Task[]> | null>(null);
  // B1 fix (Phase 2 review, blocker): true only for the duration of a real
  // drag gesture (set in handleDragStart, cleared in handleDragEnd AND
  // handleDragCancel). A ref, not state, so the write is synchronous within
  // the same call stack — see handleValueChange below for why that matters.
  const isDraggingRef = useRef(false);
  // Pauses the project queries' 30 s refresh for the gesture's lifetime and
  // releases it on unmount mid-drag (docs/archive/plans/collaboration-and-sharing.md).
  const dragActivity = useDragActivityGuard();

  const topLevelAll = useMemo(() => (tasks ?? []).filter((t) => t.parentTaskId === null), [tasks]);
  const subtaskMapAll = useMemo(() => {
    const map = new Map<number, Task[]>();
    for (const t of tasks ?? []) {
      if (t.parentTaskId !== null) {
        const arr = map.get(t.parentTaskId) ?? [];
        arr.push(t);
        map.set(t.parentTaskId, arr);
      }
    }
    for (const arr of map.values()) arr.sort((a, b) => a.position - b.position || a.id - b.id);
    return map;
  }, [tasks]);

  // Client-side filter — assignee + priority. Filtering only ever hides
  // top-level cards from view (render-only); it never touches the mapper's
  // input (`unfilteredGlobalOrder` in handleValueCommit/handleMobileMove
  // below always derives from `topLevelAll`, never from this filtered
  // projection) — mirrors ProjectKanban.tsx's `topLevel`/`grouped` (filtered,
  // rendering-only) vs `topLevelAll`/`groupedAll` (unfiltered, drop-math
  // source of truth) split (lines 183-203).
  const isTaskVisible = useCallback(
    (task: Task) => {
      if (filterAssigneeId !== "" && task.assignedToId !== filterAssigneeId) return false;
      if (filterPriority !== "" && task.priority !== filterPriority) return false;
      if (filterEpicId !== "") {
        if (filterEpicId === null) {
          if (task.epicId !== null) return false;
        } else if (task.epicId !== filterEpicId) {
          return false;
        }
      }
      return true;
    },
    [filterAssigneeId, filterPriority, filterEpicId],
  );
  const filterActive = filterAssigneeId !== "" || filterPriority !== "" || filterEpicId !== "";

  const derivedColumns = useMemo(
    () => projectToColumns(topLevelAll, isTaskVisible),
    [topLevelAll, isTaskVisible],
  );
  // Authoritative board value: the live projection while dragging, else the
  // query-derived projection (Architecture Decision 5 — "sync resumes at
  // rest" once `liveColumns` is cleared on drag end/cancel below).
  const columns = liveColumns ?? derivedColumns;

  // Scoped to the scroll container itself (`root`), so it only observes
  // intersections within the pager, not the whole viewport — ported from
  // ProjectKanban.tsx lines 225-243. Deps are `[isLoading, isError]` rather
  // than `[]` (the old file's deps): the loading/error branches below return
  // an entirely different subtree with no `boardScrollRef`/`columnRefs`
  // nodes at all, so a `[]`-only effect could fire once against `null` refs
  // before the real board ever mounts and never re-attach. Re-running once
  // more when the loading gate clears guarantees the DOM nodes exist by the
  // time this body runs (state changes in an effect's deps always follow the
  // render+commit that produced them).
  useEffect(() => {
    if (isLoading || isError) return;
    const root = boardScrollRef.current;
    if (!root) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const mostVisible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (!mostVisible) return;
        const idx = columnRefs.current.findIndex((el) => el === mostVisible.target);
        if (idx !== -1) setActiveColIdx(idx);
      },
      { root, threshold: [0.5, 0.75, 1] },
    );
    for (const el of columnRefs.current) {
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [isLoading, isError]);

  // Vendor's live-preview reshuffles during a drag (dragOver) call this —
  // authoritative while `liveColumns` is non-null.
  //
  // B1 fix (Phase 2 review, blocker): `reui/kanban.tsx`'s own handleDragEnd
  // (kanban.tsx:437-552) calls the container's `onDragEnd` prop (our
  // handleDragEnd below, which clears `liveColumns`) BEFORE it calls
  // `setColumns`/`onValueChange` (this function) for a same-container
  // arrayMove commit — which is exactly the shape a column-body drop takes
  // once the item has already been spliced into the target column during a
  // prior dragOver (over.id resolves to the column's own id, not an item id,
  // so `overIndex` is -1 and the vendor takes the "same container" arrayMove
  // branch, not the cross-column branch). Both calls happen synchronously
  // within the same handleDragEnd invocation, so without a guard here this
  // function re-arms `liveColumns` with a non-null value immediately AFTER
  // handleDragEnd nulled it — the drag-live projection then never resumes
  // deriving from query data (a permanent freeze; the board never reflects
  // later query updates again). Guarding on `isDraggingRef` (a ref, so the
  // write in handleDragEnd is synchronously visible here even though
  // `liveColumns` state itself hasn't re-rendered yet) fixes it: this
  // function only ever writes `liveColumns` for as long as a gesture is
  // actually live.
  function handleValueChange(next: Record<TaskStatus, Task[]>) {
    if (!isDraggingRef.current) return;
    setLiveColumns(next);
  }

  function handleDragStart() {
    isDraggingRef.current = true;
    dragActivity.begin();
    // Freeze: snapshot the current (query-derived) arrangement as the drag's
    // starting point. From here, onValueChange owns `liveColumns` until the
    // drag settles.
    setLiveColumns(derivedColumns);
  }

  function handleDragEnd() {
    isDraggingRef.current = false;
    dragActivity.end();
    // Committed (or dropped over nothing, in which case onValueCommit never
    // fires) — resume deriving from query data. onValueCommit already fired
    // the single PATCH for this gesture; the optimistic update + onSettled
    // invalidation bring query data back in sync with what was previewed.
    setLiveColumns(null);
  }

  function handleDragCancel() {
    isDraggingRef.current = false;
    dragActivity.end();
    // Escape/cancel: restoreOnCancel already reset the vendor's own `value`
    // to the pre-drag snapshot (via onValueChange), so resume deriving from
    // query data — identical arrangement, since nothing was ever committed.
    setLiveColumns(null);
  }

  // Commit -> mapper -> single write path (Architecture Decision 3/5): one
  // PATCH per gesture via the existing optimistic useUpdateTask mutation.
  // `null` from the mapper (no-op guards: drop-in-place, cancelled drag,
  // unchanged arrangement) means no request at all.
  //
  // T8 item 5 (plan Phase 1 Review Addendum 8) — guard-1/filtered no-op
  // re-check: `committedValue`/`meta.previousValue` here are always the
  // FILTERED `columns` (the vendor's own `value`/live-preview state, which
  // is `derivedColumns`/`liveColumns` above — i.e. `projectToColumns(...,
  // isTaskVisible)`), never `topLevelAll`. The worry was whether guard 1
  // (`arrangementsEqual` in commitMapper.ts, comparing that same filtered
  // arrangement) could swallow a gesture that LOOKS unchanged under the
  // filter but should still fire a real PATCH. Traced through
  // `resolvePosition`'s neighbor-anchoring: the moved card is always visible
  // (it had to be dragged/tapped), so if guard 1 finds every column's
  // visible id-sequence unchanged, the moved card's visible predecessor/
  // successor context is *also* unchanged — and that visible neighbor
  // context (falling back to the unfiltered global order only when NO
  // visible neighbor exists, e.g. FA-3) is the only input `resolvePosition`
  // reads. Same neighbor context in -> same resolved position out, which by
  // construction already equals the card's current position. So a
  // guard-1-swallowed real move is unreachable for both this drag path and
  // the mobile move sheet's synthesized commit below (buildColumnAppendCommit)
  // — confirmed empirically by T8's temporary scratch e2e spec (filtered
  // card-to-card drop with a hidden card in between; captured PATCH position
  // matched the FA-row math), deleted per plan after the run; see the T8
  // implementor report for the captured payload. The separately-flagged
  // wrong-POSITION bug T8 found but left unfixed (a partially-filtered
  // TARGET column whose true last member is hidden anchoring a column-body
  // append on the wrong, visible predecessor) is FIXED below — M2, Phase 2
  // review — via the explicit `appendToStatus` signal.
  function handleValueCommit(committedValue: Record<string, Task[]>, meta: KanbanCommitMeta<Task>) {
    const unfilteredGlobalOrder = sortTasksCanonical(topLevelAll);
    // M2 fix: a column-body drop (pointer released on the column's own
    // droppable, not on a card) is only distinguishable from a card-to-card
    // drop by inspecting the raw dnd-kit event — `meta.event.over?.id`
    // resolves to the column's own id (a KANBAN_STATUSES member) rather than
    // an item id in that case. Passing that through as an explicit
    // `appendToStatus` signal lets the mapper anchor on the column's TRUE
    // unfiltered last member instead of inferring (possibly wrongly, under a
    // filter) from the committed arrangement's visible neighbors — see
    // commitMapper.ts's `KanbanCommitMetaLike.appendToStatus` doc.
    const overId = meta.event.over?.id;
    const appendToStatus =
      overId !== undefined && (KANBAN_STATUSES as readonly string[]).includes(String(overId))
        ? (String(overId) as TaskStatus)
        : undefined;
    const result = mapCommitToPatch(unfilteredGlobalOrder, committedValue, { ...meta, appendToStatus });
    if (!result) return;
    setActionError(null);
    updateTask.mutate({ id: result.taskId, patch: result.patch }, { onError: onActionError });
  }

  // Subtask checklist toggle (ProjectKanban.tsx:451-454) — DONE<->TODO,
  // permission-gated the same way drag is (`dragEnabled`, passed as
  // `canToggleSubtasks` below).
  function toggleSubtaskStatus(sub: Task) {
    const next: TaskStatus = sub.status === "DONE" ? "TODO" : "DONE";
    setActionError(null);
    updateTask.mutate({ id: sub.id, patch: { status: next } }, { onError: onActionError });
  }

  // Mobile move sheet (T8 item 3) — same column-append rule as a column-body
  // drop, routed through the SAME mapper call the drag path uses above
  // (buildColumnAppendCommit only builds the commit *shape*; mapCommitToPatch
  // still does all the position math), so MS-1..MS-3 match CC-2/CC-3 exactly.
  function handleMobileMove(task: Task, targetStatus: TaskStatus) {
    if (targetStatus !== task.status) {
      const { committedValue, meta } = buildColumnAppendCommit(columns, task, targetStatus);
      const unfilteredGlobalOrder = sortTasksCanonical(topLevelAll);
      const result = mapCommitToPatch(unfilteredGlobalOrder, committedValue, meta);
      if (result) {
        setActionError(null);
        updateTask.mutate({ id: result.taskId, patch: result.patch }, { onError: onActionError });
      }
    }
    setMobileSheetTask(null);
  }

  // n4 (Phase 2 review): stable identity via useCallback — the vendored
  // `Kanban` root derives `columnIds` (useMemo, deps include `getItemValue`)
  // and `findContainer` (useCallback, same dep) from this prop, so a new
  // function reference on every SolvroKanban render (e.g. from an unrelated
  // filter-popover toggle) was defeating both memos every render even when
  // `columns` itself hadn't changed.
  const getItemValue = useCallback((task: Task): string => String(task.id), []);

  function openTask(taskId: number) {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set("task", String(taskId));
        return next;
      },
      { replace: true },
    );
  }

  if (isLoading) {
    return <BoardSkeleton columns={KANBAN_STATUSES.length} />;
  }

  if (isError) {
    return (
      <Alert variant="destructive">
        <AlertDescription>Could not load tasks: {(error as Error).message}</AlertDescription>
      </Alert>
    );
  }

  return (
    <>
      {actionError && (
        <Alert variant="destructive" className="mb-3" data-testid="kanban-action-error">
          <AlertDescription>Could not save the change: {actionError}</AlertDescription>
        </Alert>
      )}
      {/* Toolbar row: filter + add task (ProjectKanban.tsx:479-565) */}
      <div className="mb-3 flex items-center justify-end gap-2">
        <div className="relative">
          <button
            type="button"
            onClick={() => setFilterOpen((v) => !v)}
            className={[
              "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 font-display text-xs font-semibold transition-colors",
              filterActive
                ? "border-primary bg-primary/10 text-primary"
                : "border-outline-variant bg-surface-container-lowest text-on-surface-variant hover:bg-surface-container",
            ].join(" ")}
          >
            <span className="material-symbols-outlined text-base">filter_alt</span>
            Filter
            {filterActive && (
              <span className="flex h-4 w-4 items-center justify-center rounded-full bg-primary text-meta leading-none font-bold text-on-primary">
                {(filterAssigneeId !== "" ? 1 : 0) +
                  (filterPriority !== "" ? 1 : 0) +
                  (filterEpicId !== "" ? 1 : 0)}
              </span>
            )}
          </button>
          {filterOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setFilterOpen(false)} />
              <div className="absolute right-0 z-20 mt-2 w-64 rounded-lg border border-outline-variant bg-surface-container-lowest p-3 shadow-overlay">
                <div className="mb-3">
                  <label className="mb-1 block text-label-caps uppercase text-on-surface-variant">
                    Assignee
                  </label>
                  <select
                    value={filterAssigneeId === "" ? "" : String(filterAssigneeId)}
                    onChange={(e) =>
                      setFilterAssigneeId(e.target.value === "" ? "" : Number(e.target.value))
                    }
                    className="w-full rounded-lg border border-outline-variant bg-surface-container px-2 py-1.5 text-sm text-on-surface focus:border-primary focus:outline-hidden"
                  >
                    <option value="">Everyone</option>
                    {(users ?? []).map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.username}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="mb-3">
                  <label className="mb-1 block text-label-caps uppercase text-on-surface-variant">
                    Priority
                  </label>
                  <select
                    value={filterPriority}
                    onChange={(e) => setFilterPriority(e.target.value as Priority | "")}
                    className="w-full rounded-lg border border-outline-variant bg-surface-container px-2 py-1.5 text-sm text-on-surface focus:border-primary focus:outline-hidden"
                  >
                    <option value="">Any priority</option>
                    {priorityOptions.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="mb-3">
                  <label className="mb-1 block text-label-caps uppercase text-on-surface-variant">
                    Epic
                  </label>
                  <select
                    value={filterEpicId === "" ? "" : filterEpicId === null ? "none" : String(filterEpicId)}
                    onChange={(e) => {
                      const v = e.target.value;
                      setFilterEpicId(v === "" ? "" : v === "none" ? null : Number(v));
                    }}
                    className="w-full rounded-lg border border-outline-variant bg-surface-container px-2 py-1.5 text-sm text-on-surface focus:border-primary focus:outline-hidden"
                  >
                    <option value="">All</option>
                    <option value="none">No epic</option>
                    {(epics ?? []).map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.title}
                      </option>
                    ))}
                  </select>
                </div>
                {filterActive && (
                  <button
                    type="button"
                    onClick={() => {
                      setFilterAssigneeId("");
                      setFilterPriority("");
                      setFilterEpicId("");
                    }}
                    className="text-xs font-semibold text-primary hover:underline"
                  >
                    Clear filters
                  </button>
                )}
              </div>
            </>
          )}
        </div>
        {dragEnabled && (
          <button
            type="button"
            onClick={() => setCreateStatus("TODO")}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 font-display text-xs font-bold text-on-primary hover:bg-primary/90"
          >
            <span className="material-symbols-outlined text-base">add</span>
            Add task
          </button>
        )}
      </div>

      {/* Mobile pager header: chevrons step to the prev/next column page,
          center label shows the currently-centered column + its count.
          Desktop (md+) doesn't render this — the 3-column grid is always
          fully visible there. Ported from ProjectKanban.tsx lines 576-616. */}
      <div className="mb-1 flex items-center justify-center gap-2 md:hidden">
        <button
          type="button"
          onClick={() => scrollToColumn(activeColIdx - 1)}
          disabled={activeColIdx === 0}
          aria-label="Previous column"
          className="material-symbols-outlined text-on-surface-variant disabled:opacity-30"
        >
          chevron_left
        </button>
        <span className="text-sm font-semibold text-on-surface">{TASK_STATUS_LABEL[KANBAN_STATUSES[activeColIdx]]}</span>
        <span className="rounded-full bg-surface-container-high px-2 py-0.5 text-meta font-medium text-on-surface-variant">
          {columns[KANBAN_STATUSES[activeColIdx]].length}
        </span>
        <button
          type="button"
          onClick={() => scrollToColumn(activeColIdx + 1)}
          disabled={activeColIdx === KANBAN_STATUSES.length - 1}
          aria-label="Next column"
          className="material-symbols-outlined text-on-surface-variant disabled:opacity-30"
        >
          chevron_right
        </button>
      </div>
      <div className="mb-3 flex items-center justify-center gap-1.5 md:hidden">
        {KANBAN_STATUSES.map((status, idx) => (
          <button
            key={status}
            type="button"
            onClick={() => scrollToColumn(idx)}
            aria-label={`Go to ${TASK_STATUS_LABEL[status]} column`}
            className={`h-1.5 w-1.5 rounded-full transition-colors ${
              idx === activeColIdx ? "bg-primary" : "bg-outline-variant"
            }`}
          />
        ))}
      </div>

      <Kanban
        value={columns}
        onValueChange={handleValueChange}
        onValueCommit={handleValueCommit}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
        restoreOnCancel
        getItemValue={getItemValue}
        className="flex h-full flex-col md:min-h-0 md:flex-1"
      >
        {/* Scroll-snap pager container (<md) / grid container (md:+) — real
            plain div (not a vendor component) so `boardScrollRef` is a
            trivial, always-attachable React ref, unlike `<KanbanBoard>`
            itself (see the file-header comment). `KanbanBoard` is reduced to
            `className="contents"` immediately below so its children (the
            per-column wrapper divs) become this div's direct flex/grid
            items — dnd-kit autoscroll still picks up the actual overflow
            ancestor automatically. Ported from ProjectKanban.tsx lines
            624-634. */}
        <div
          ref={boardScrollRef}
          className="flex h-full snap-x snap-mandatory gap-4 overflow-x-auto md:grid md:min-h-0 md:flex-1 md:grid-cols-3 md:overflow-visible md:snap-none"
        >
          <KanbanBoard className="contents">
            {KANBAN_STATUSES.map((status, idx) => {
              const columnTasks = columns[status];
              const wipLimit = project.wipLimits?.[status] ?? null;
              const overLimit = wipLimit !== null && columnTasks.length > wipLimit;

              return (
                <div
                  key={status}
                  ref={(el) => {
                    columnRefs.current[idx] = el;
                  }}
                  className="w-full shrink-0 snap-center md:w-auto md:shrink md:min-h-0 md:snap-align-none"
                >
                  <KanbanColumn
                    value={status}
                    // m3 (Phase 2 review): the old board's drop-target ring
                    // highlight had no `transition-all` counterpart to
                    // restore it onto — investigated whether the vendored
                    // KanbanColumn/KanbanColumnContent expose an is-over
                    // signal (context field or data attribute) usable from
                    // here without patching `reui/kanban.tsx`: they don't —
                    // KanbanContext only tracks `activeId` (what's being
                    // dragged), never an over/hover target, and
                    // KanbanColumn's own `data-dragging` reflects the COLUMN
                    // being dragged for column reordering, not an item
                    // hovering over it. `transition-all` was dead (nothing
                    // ever toggled a class it would have animated); removed.
                    // The live-preview reshuffle (columns re-render the
                    // drag's provisional arrangement as the pointer moves,
                    // Architecture Decision 5) is the replacement affordance
                    // — the user sees the card land in-place rather than a
                    // separate column-level highlight.
                    className="flex flex-col gap-2.5 rounded-xl bg-surface-container p-2 md:h-full md:min-h-0"
                  >
                    {/* Column header — stays pinned; the card list below scrolls on its own (md:+) */}
                    <div className="flex items-center gap-2 px-1 pb-1">
                      <h3 className="text-sm font-bold text-on-surface">{TASK_STATUS_LABEL[status]}</h3>
                      <span
                        className={[
                          "rounded-full px-2 py-0.5 text-meta font-medium",
                          overLimit
                            ? "bg-chip-amber-bg text-chip-amber-text"
                            : "bg-surface-container-high text-on-surface-variant",
                        ].join(" ")}
                        title={wipLimit !== null ? `WIP limit: ${wipLimit}` : undefined}
                      >
                        {overLimit ? `${columnTasks.length} / ${wipLimit}` : columnTasks.length}
                      </span>
                      <span className="flex-1" />
                      <ColumnMenu onAdd={() => setCreateStatus(status)} />
                    </div>

                    <KanbanColumnContent
                      value={status}
                      className="flex flex-col gap-2.5 md:min-h-0 md:flex-1 md:overflow-y-auto"
                    >
                      {columnTasks.map((task) => (
                        <KanbanItem
                          key={task.id}
                          value={getItemValue(task)}
                          disabled={!dragEnabled}
                          // Fade fix (orchestrator screenshot finding on T6):
                          // KanbanItem bakes `disabled && "opacity-50"` into its
                          // own className (reui/kanban.tsx:798) regardless of
                          // *why* it's disabled. Non-writers must see
                          // normal-looking, non-draggable cards, not dimmed
                          // ones — so override back to full opacity from the
                          // container via the className prop, which cn()/
                          // twMerge composes AFTER (and so wins over) the
                          // vendor's own opacity-50 for the same utility group.
                          // No vendor file touched.
                          className={dragEnabled ? undefined : "opacity-100"}
                        >
                          <TaskCard
                            task={task}
                            subtaskMap={subtaskMapAll}
                            epicMap={epicMap}
                            canDrag={dragEnabled}
                            canToggleSubtasks={dragEnabled}
                            onClick={() => openTask(task.id)}
                            // m6 (Phase 2 review): gate the card menu (opens
                            // MobileMoveSheet) on dragEnabled, matching
                            // canDrag — non-writers get no move affordance at
                            // all, not just a disabled drag handle.
                            onMenuClick={dragEnabled ? () => setMobileSheetTask(task) : undefined}
                            onToggleSubtask={toggleSubtaskStatus}
                          />
                        </KanbanItem>
                      ))}

                      {columnTasks.length === 0 && (
                        <div className="rounded-lg border border-dashed border-outline-variant px-3 py-8 text-center text-[12px] text-on-surface-variant">
                          Drop tasks here
                        </div>
                      )}
                    </KanbanColumnContent>
                  </KanbanColumn>
                </div>
              );
            })}
          </KanbanBoard>
        </div>

        <KanbanOverlay>
          {({ value }) => {
            const task = topLevelAll.find((t) => String(t.id) === String(value));
            if (!task) return null;
            // M4 (Phase 2 review): the ghost must visually match the source
            // card it's standing in for — grip visible (canDrag) plus the
            // old board's `dragging` treatment (rotate/primary ring/shadow,
            // ProjectKanban.tsx:917) — wrapped in a real `<KanbanItem>` so
            // `KanbanItemHandle` (inside TaskCard) resolves its context from
            // the actual overlay (`IsOverlayContext`), which hardcodes
            // `listeners: undefined` — inert, since the overlay is a
            // read-only ghost, not a second live drag surface — and
            // `isDragging: true` for the grabbing cursor.
            return (
              <KanbanItem value={getItemValue(task)}>
                <TaskCard task={task} subtaskMap={subtaskMapAll} epicMap={epicMap} canDrag dragging />
              </KanbanItem>
            );
          }}
        </KanbanOverlay>
      </Kanban>

      {createStatus && (
        <TaskFormModal
          mode="create"
          open={createStatus !== null}
          onClose={() => setCreateStatus(null)}
          projectId={project.id}
          initialStatus={createStatus}
        />
      )}

      {mobileSheetTask && (
        <MobileMoveSheet
          task={mobileSheetTask}
          onClose={() => setMobileSheetTask(null)}
          onMove={(status) => handleMobileMove(mobileSheetTask, status)}
        />
      )}
    </>
  );
}
