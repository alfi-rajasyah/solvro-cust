// SolvroKanban — kanban-v2 container mounted at /projects/:id/kanban (T11
// cutover; see docs/archive/plans/kanban-reui-swap/plan.md T6, Architecture Decision 1).
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
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useQueryClient } from "@tanstack/react-query";
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
  type TaskStatusDef,
  queryKeys,
  useProjectEpics,
  useProjectTasks,
  useTaskStatuses,
  useUpdateTask,
  useUsers,
} from "@/lib/queries";
import { priorityOptions, TASK_CATEGORY_GROUP_LABEL } from "@/lib/labels";
import { STATUS_CATEGORY_ICON } from "@/lib/taskStatuses";
import { STATUS_TONE_DOT_CLASS } from "@/components/StatusChip";
import { BoardSkeleton } from "@/components/skeletons";
import { TOOLBAR_BOX, TOOLBAR_BUTTON_PRIMARY } from "@/lib/utils";
import { buildBoardAnnouncements } from "@/lib/dragAnnouncements";
import { columnIdOf, projectToColumns, sortStatusDefsForBoard, sortTasksCanonical } from "./adapter";
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
 * arithmetic here, only a hand-rolled commit *shape*. `meta.appendToColumn`
 * (M2 fix, Phase 2 review) is set to the same target column the drag path
 * derives from `meta.event.over?.id` — the move sheet has no dnd-kit event
 * to read it from, but the semantics are identical: this IS a column-append,
 * so the mapper must anchor on the column's TRUE unfiltered last member, not
 * infer from `committedValue`'s (possibly filtered) visible neighbors.
 */
function buildColumnAppendCommit(
  columns: Record<string, Task[]>,
  task: Task,
  targetColumnId: string,
): { committedValue: Record<string, Task[]>; meta: KanbanCommitMetaLike } {
  const sourceColumnId = columnIdOf({ id: task.statusId });
  const sourceColumn = columns[sourceColumnId] ?? [];
  const activeIndex = sourceColumn.findIndex((t) => t.id === task.id);
  const targetColumn = columns[targetColumnId] ?? [];

  const committedValue: Record<string, Task[]> = {
    ...columns,
    [targetColumnId]: [...targetColumn, task],
  };
  // The source column may be a collapsed one that isn't on the board at all.
  if (sourceColumnId in columns) {
    committedValue[sourceColumnId] = sourceColumn.filter((t) => t.id !== task.id);
  }

  const meta: KanbanCommitMetaLike = {
    kind: "item",
    activeContainer: sourceColumnId,
    activeIndex: activeIndex === -1 ? 0 : activeIndex,
    overContainer: targetColumnId,
    overIndex: targetColumn.length,
    previousValue: columns,
    appendToColumn: targetColumnId,
  };

  return { committedValue, meta };
}

const COLLAPSED_KEY = "solvro.kanban.collapsedStatuses";

// Per-viewer convenience only (docs/archive/plans/custom-task-statuses.md §3 B3):
// the board must render the same with storage empty or blocked.
function readCollapsedIds(): number[] {
  try {
    const raw = window.localStorage.getItem(COLLAPSED_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((v): v is number => Number.isInteger(v)) : [];
  } catch {
    return [];
  }
}

function writeCollapsedIds(ids: number[]): void {
  try {
    window.localStorage.setItem(COLLAPSED_KEY, JSON.stringify(ids));
  } catch {
    // storage unavailable — the fold just doesn't persist
  }
}

/** Per-column "..." menu — copied from ProjectKanban.tsx's `Column` (lines
 * 769-796). Its own component (rather than inline JSX in the column
 * map below) so `menuOpen` can be a real `useState` call, not one made from
 * inside an array-map callback. */
function ColumnMenu({ onAdd }: { onAdd: () => void }) {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setMenuOpen((v) => !v)}
        className="material-symbols-outlined cursor-pointer rounded [@media(pointer:coarse)]:p-3 text-base text-on-surface-variant hover:text-on-surface outline-hidden focus-visible:ring-2 focus-visible:ring-primary"
        aria-label="Column options"
      >
        more_horiz
      </button>
      {menuOpen && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
          <div className="absolute right-0 z-20 mt-1 w-40 rounded-sm border border-outline-variant bg-surface-container-lowest py-1 shadow-overlay">
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                onAdd();
              }}
              className="[@media(pointer:coarse)]:min-h-11 flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-on-surface hover:bg-surface-container"
            >
              <span aria-hidden="true" className="material-symbols-outlined text-sm">add</span>
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
  // One board column per workspace status; WIP limits are keyed by status id.
  const { data: statusDefs, isLoading: defsLoading, isError: defsError } = useTaskStatuses();
  const allDefs = useMemo(() => sortStatusDefsForBoard(statusDefs ?? []), [statusDefs]);
  const updateTask = useUpdateTask(project.id);
  const [, setSearchParams] = useSearchParams();
  const [createDef, setCreateDef] = useState<TaskStatusDef | null>(null);
  // Done-category columns can be folded away (per viewer, not per project:
  // the status list is workspace-wide). Stored as def ids.
  const [collapsedIds, setCollapsedIds] = useState<number[]>(readCollapsedIds);
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
    const clamped = Math.max(0, Math.min(visibleDefs.length - 1, idx));
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
  const [liveColumns, setLiveColumns] = useState<Record<string, Task[]> | null>(null);
  // B1 fix (Phase 2 review, blocker): true only for the duration of a real
  // drag gesture (set in handleDragStart, cleared in handleDragEnd AND
  // handleDragCancel). A ref, not state, so the write is synchronous within
  // the same call stack — see handleValueChange below for why that matters.
  const isDraggingRef = useRef(false);
  // Pauses the project queries' 30 s refresh for the gesture's lifetime and
  // releases it on unmount mid-drag (docs/archive/plans/collaboration-and-sharing.md).
  const dragActivity = useDragActivityGuard();

  // Collapsed columns leave the board; only Done-category ones can be collapsed.
  const collapsedDefs = useMemo(
    () => allDefs.filter((d) => d.category === "DONE" && collapsedIds.includes(d.id)),
    [allDefs, collapsedIds],
  );
  const visibleDefs = useMemo(
    () => allDefs.filter((d) => !collapsedDefs.includes(d)),
    [allDefs, collapsedDefs],
  );
  function setCollapsed(defId: number, collapsed: boolean) {
    setCollapsedIds((prev) => {
      const next = collapsed ? [...new Set([...prev, defId])] : prev.filter((id) => id !== defId);
      writeCollapsedIds(next);
      return next;
    });
  }

  const topLevelAll = useMemo(() => (tasks ?? []).filter((t) => t.parentTaskId === null), [tasks]);

  // The status list is cached for minutes, so a status an admin added meanwhile
  // can already be on a task here; its card would have no column and vanish.
  // Refetch the list once per distinct set of unknown ids (no refetch loop if
  // the id stays unknown).
  const qc = useQueryClient();
  const requestedUnknown = useRef("");
  useEffect(() => {
    if (!statusDefs) return;
    const known = new Set(statusDefs.map((d) => d.id));
    const unknown = [...new Set(topLevelAll.filter((t) => !known.has(t.statusId)).map((t) => t.statusId))].sort();
    const sig = unknown.join(",");
    if (!sig || sig === requestedUnknown.current) return;
    requestedUnknown.current = sig;
    void qc.invalidateQueries({ queryKey: queryKeys.taskStatuses });
  }, [statusDefs, topLevelAll, qc]);
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
    () => projectToColumns(topLevelAll, visibleDefs, isTaskVisible),
    [topLevelAll, visibleDefs, isTaskVisible],
  );
  // Cards parked in collapsed columns (shown in the "(hidden)" notes).
  const collapsedCounts = useMemo(() => {
    const counts = new Map<number, number>();
    for (const t of topLevelAll) {
      if (isTaskVisible(t)) counts.set(t.statusId, (counts.get(t.statusId) ?? 0) + 1);
    }
    return counts;
  }, [topLevelAll, isTaskVisible]);
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
    if (isLoading || isError || defsLoading || defsError) return;
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
  }, [isLoading, isError, defsLoading, defsError, visibleDefs.map((d) => d.id).join(",")]);

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
  function handleValueChange(next: Record<string, Task[]>) {
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
  // review — via the explicit `appendToColumn` signal.
  function handleValueCommit(committedValue: Record<string, Task[]>, meta: KanbanCommitMeta<Task>) {
    const unfilteredGlobalOrder = sortTasksCanonical(topLevelAll);
    // M2 fix: a column-body drop (pointer released on the column's own
    // droppable, not on a card) is only distinguishable from a card-to-card
    // drop by inspecting the raw dnd-kit event — `meta.event.over?.id`
    // resolves to the column's own id (a key of `committedValue`) rather than
    // an item id in that case. Passing that through as an explicit
    // `appendToColumn` signal lets the mapper anchor on the column's TRUE
    // unfiltered last member instead of inferring (possibly wrongly, under a
    // filter) from the committed arrangement's visible neighbors — see
    // commitMapper.ts's `KanbanCommitMetaLike.appendToColumn` doc.
    const overId = meta.event.over?.id;
    const appendToColumn =
      overId !== undefined && Object.prototype.hasOwnProperty.call(committedValue, String(overId))
        ? String(overId)
        : undefined;
    const result = mapCommitToPatch(unfilteredGlobalOrder, committedValue, { ...meta, appendToColumn });
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
  function handleMobileMove(task: Task, target: TaskStatusDef) {
    if (target.id !== task.statusId) {
      const { committedValue, meta } = buildColumnAppendCommit(columns, task, columnIdOf(target));
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

  // Keyboard-drag announcements: card titles and column names, not raw ids.
  const announcements = useMemo(() => {
    const titleById = new Map<string, string>();
    const colOfCard = new Map<string, string>();
    for (const [colId, list] of Object.entries(columns)) {
      for (const t of list) {
        titleById.set(String(t.id), t.title);
        colOfCard.set(String(t.id), colId);
      }
    }
    const nameOfColumn = new Map(allDefs.map((d) => [columnIdOf(d), d.name]));
    return buildBoardAnnouncements({
      cardLabel: (id) => titleById.get(String(id)) ?? null,
      columnLabelOf: (id) => {
        const key = String(id);
        return nameOfColumn.get(key) ?? nameOfColumn.get(colOfCard.get(key) ?? "") ?? null;
      },
    });
  }, [columns, allDefs]);

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

  if (isLoading || defsLoading) {
    return <BoardSkeleton columns={visibleDefs.length || 3} />;
  }

  if (isError || defsError) {
    return (
      <Alert variant="destructive">
        <AlertDescription>
          Could not load tasks: {isError ? (error as Error).message : "the status list is unavailable."}
        </AlertDescription>
      </Alert>
    );
  }

  // Category band above the columns: consecutive visible columns of one
  // category share a cell spanning them.
  const bandCells: { category: TaskStatus; span: number; count: number }[] = [];
  for (const def of visibleDefs) {
    const count = columns[columnIdOf(def)]?.length ?? 0;
    const last = bandCells[bandCells.length - 1];
    if (last && last.category === def.category) {
      last.span += 1;
      last.count += count;
    } else {
      bandCells.push({ category: def.category, span: 1, count });
    }
  }
  const colCount = visibleDefs.length;
  const gridCols = `repeat(${colCount}, minmax(${colCount > 3 ? "13rem" : "0"}, 1fr))`;
  const defaultTodoDef = allDefs.find((d) => d.category === "TODO" && d.isDefault) ?? allDefs[0];
  const activeDef = visibleDefs[Math.min(activeColIdx, colCount - 1)];

  return (
    <>
      {actionError && (
        <Alert variant="destructive" className="mb-3" data-testid="kanban-action-error">
          <AlertDescription>Could not save the change: {actionError}</AlertDescription>
        </Alert>
      )}
      {/* Toolbar row: filter + add task (ProjectKanban.tsx:479-565) */}
      <div className="mb-3 flex items-center justify-end gap-2 [@media(pointer:coarse)]:gap-3">
        {collapsedDefs.length > 0 && (
          <div className="mr-auto flex min-w-0 flex-wrap items-center gap-2">
            {collapsedDefs.map((def) => (
              <button
                key={def.id}
                type="button"
                onClick={() => setCollapsed(def.id, false)}
                aria-label={`Show ${def.name} column`}
                className="inline-flex items-center gap-1 rounded-sm px-2 py-1 [@media(pointer:coarse)]:py-3 text-xs font-semibold text-on-surface-variant transition-colors hover:bg-surface-container outline-hidden focus-visible:ring-2 focus-visible:ring-primary"
              >
                <span aria-hidden="true" className="material-symbols-outlined text-sm">unfold_more</span>
                {def.name} · {collapsedCounts.get(def.id) ?? 0} (hidden)
              </button>
            ))}
          </div>
        )}
        <div className="relative">
          <button
            type="button"
            onClick={() => setFilterOpen((v) => !v)}
            className={[
              `${TOOLBAR_BOX} [@media(pointer:coarse)]:h-11 border font-semibold transition-colors`,
              filterActive
                ? "border-primary bg-primary/10 text-primary"
                : "border-outline-variant bg-surface-container-lowest text-on-surface-variant hover:bg-surface-container",
            ].join(" ")}
          >
            <span aria-hidden="true" className="material-symbols-outlined text-base">filter_alt</span>
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
              <div className="absolute right-0 z-20 mt-2 w-64 rounded-sm border border-outline-variant bg-surface-container-lowest p-3 shadow-overlay">
                <div className="mb-3">
                  <label className="mb-1 block text-label-caps uppercase text-on-surface-variant">
                    Assignee
                  </label>
                  <select
                    value={filterAssigneeId === "" ? "" : String(filterAssigneeId)}
                    onChange={(e) =>
                      setFilterAssigneeId(e.target.value === "" ? "" : Number(e.target.value))
                    }
                    className="[@media(pointer:coarse)]:min-h-11 w-full rounded-sm border border-outline-variant bg-surface-container px-2 py-1.5 text-sm text-on-surface focus:border-primary focus:outline-hidden focus-visible:ring-2 focus-visible:ring-primary/30"
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
                    className="[@media(pointer:coarse)]:min-h-11 w-full rounded-sm border border-outline-variant bg-surface-container px-2 py-1.5 text-sm text-on-surface focus:border-primary focus:outline-hidden focus-visible:ring-2 focus-visible:ring-primary/30"
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
                    className="[@media(pointer:coarse)]:min-h-11 w-full rounded-sm border border-outline-variant bg-surface-container px-2 py-1.5 text-sm text-on-surface focus:border-primary focus:outline-hidden focus-visible:ring-2 focus-visible:ring-primary/30"
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
                    className="tap-target text-xs font-semibold text-primary hover:underline"
                  >
                    Clear filters
                  </button>
                )}
              </div>
            </>
          )}
        </div>
        {dragEnabled && defaultTodoDef && (
          <button
            type="button"
            onClick={() => setCreateDef(defaultTodoDef)}
            className={TOOLBAR_BUTTON_PRIMARY}
          >
            <span aria-hidden="true" className="material-symbols-outlined text-base">add</span>
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
          className="tap-target material-symbols-outlined text-on-surface-variant disabled:opacity-30"
        >
          chevron_left
        </button>
        <span className="text-sm font-semibold text-on-surface">{activeDef?.name}</span>
        <span className="rounded-full bg-surface-container-high px-2 py-0.5 text-meta font-medium text-on-surface-variant">
          {activeDef ? (columns[columnIdOf(activeDef)]?.length ?? 0) : 0}
        </span>
        <button
          type="button"
          onClick={() => scrollToColumn(activeColIdx + 1)}
          disabled={activeColIdx >= colCount - 1}
          aria-label="Next column"
          className="tap-target material-symbols-outlined text-on-surface-variant disabled:opacity-30"
        >
          chevron_right
        </button>
      </div>
      <div className="mb-3 flex items-center justify-center gap-1.5 md:hidden">
        {visibleDefs.map((def, idx) => (
          <button
            key={def.id}
            type="button"
            onClick={() => scrollToColumn(idx)}
            aria-label={`Go to ${def.name} column`}
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
        accessibility={{ announcements }}
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
          style={{ "--kanban-grid-cols": gridCols } as CSSProperties}
          className={[
            "flex h-full snap-x snap-mandatory gap-4 overflow-x-auto md:grid md:min-h-0 md:flex-1 md:snap-none",
            "md:[grid-template-columns:var(--kanban-grid-cols)] md:grid-rows-[auto_minmax(0,1fr)]",
            // 4+ columns keep a readable minimum width and scroll sideways.
            colCount > 3 ? "md:overflow-x-auto" : "md:overflow-visible",
          ].join(" ")}
        >
          {/* Category band (md:+ only; below md the pager header names the column). */}
          {bandCells.map((cell, i) => (
            <div
              key={`${cell.category}-${i}`}
              data-testid="kanban-category-band"
              data-category={cell.category}
              style={{ gridColumn: `span ${cell.span}`, gridRow: 1 }}
              className="mb-2 hidden items-center gap-1.5 border-b border-outline-variant px-1 pb-1.5 text-label-caps uppercase text-on-surface-variant md:flex"
            >
              <span aria-hidden="true" className="material-symbols-outlined text-base">
                {STATUS_CATEGORY_ICON[cell.category]}
              </span>
              {TASK_CATEGORY_GROUP_LABEL[cell.category]} · {cell.count}
            </div>
          ))}
          <KanbanBoard className="contents">
            {visibleDefs.map((def, idx) => {
              const columnId = columnIdOf(def);
              const columnTasks = columns[columnId] ?? [];
              const wipLimit = project.wipLimits?.[String(def.id)] ?? null;
              // Design: amber when the column is at or over its limit.
              const overLimit = wipLimit !== null && columnTasks.length >= wipLimit;

              return (
                <div
                  key={def.id}
                  ref={(el) => {
                    columnRefs.current[idx] = el;
                  }}
                  className="w-full shrink-0 snap-center md:row-start-2 md:w-auto md:shrink md:min-h-0 md:snap-align-none"
                >
                  <KanbanColumn
                    value={columnId}
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
                      <span
                        aria-hidden="true"
                        className={`h-2 w-2 shrink-0 rounded-full ${STATUS_TONE_DOT_CLASS[def.color]}`}
                      />
                      <h3 className="min-w-0 truncate text-sm font-bold text-on-surface">{def.name}</h3>
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
                      {def.category === "DONE" && (
                        <button
                          type="button"
                          onClick={() => setCollapsed(def.id, true)}
                          aria-label={`Collapse ${def.name} column`}
                          className="material-symbols-outlined cursor-pointer rounded [@media(pointer:coarse)]:p-3 text-base text-on-surface-variant hover:text-on-surface outline-hidden focus-visible:ring-2 focus-visible:ring-primary"
                        >
                          unfold_less
                        </button>
                      )}
                      <ColumnMenu onAdd={() => setCreateDef(def)} />
                    </div>

                    <KanbanColumnContent
                      value={columnId}
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
                          // Keyboard: the card's grip is a focusable button (the
                          // engine puts dnd-kit's attributes and key listener
                          // on it); the title button opens the task.
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
                        <div className="rounded-sm border border-dashed border-outline-variant px-3 py-8 text-center text-meta text-on-surface-variant">
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

      {createDef && (
        <TaskFormModal
          mode="create"
          open={createDef !== null}
          onClose={() => setCreateDef(null)}
          projectId={project.id}
          initialStatus={createDef.category}
          initialStatusId={createDef.id}
        />
      )}

      {mobileSheetTask && (
        <MobileMoveSheet
          task={mobileSheetTask}
          defs={allDefs}
          onClose={() => setMobileSheetTask(null)}
          onMove={(def) => handleMobileMove(mobileSheetTask, def)}
        />
      )}
    </>
  );
}
