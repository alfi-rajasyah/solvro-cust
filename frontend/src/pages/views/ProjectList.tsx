import { useCallback, useMemo, useState, type FormEvent } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useSearchParams } from "react-router-dom";
import { useProjectContext } from "../ProjectDetail";
import { AssigneeAvatar } from "@/components/AssigneeAvatar";
import { ConfirmModal } from "@/components/ConfirmModal";
import { CriticalPathMark } from "@/components/CriticalPathMark";
import { DateField } from "@/components/DateField";
import { EpicChip } from "@/components/EpicChip";
import { Alert, AlertDescription } from "@/components/reui/alert";
import { SectionReorderModal } from "@/components/SectionReorderModal";
import { TASK_STATUS_TONE_CLASS } from "@/components/StatusChip";
import { TaskFormModal } from "@/components/TaskFormModal";
import { ApiError } from "@/lib/api";
import { hasPermission, useAuth } from "@/lib/auth";
import { commitDraft, dayFromIso } from "@/lib/dateField";
import { useDragActivityGuard } from "@/lib/dragActivity";
import { fmtDay, fmtDue } from "@/lib/formatDate";
import { TASK_STATUS_LABEL } from "@/lib/labels";
import { ASSIGN_ADDS_MEMBER_NOTICE } from "@/lib/projectMembers";
import { useAssigneeMembership } from "@/lib/useAssigneeMembership";
import {
  type Epic,
  type Priority,
  type Section,
  type Task,
  type TaskStatus,
  useCreateSection,
  useDeleteSection,
  useDuplicateSection,
  useProjectEpics,
  useProjectSections,
  useProjectTasks,
  useUpdateSection,
  useUpdateTask,
  useUsers,
} from "@/lib/queries";

const PRIORITY_ORDER: Priority[] = ["LOW", "MEDIUM", "HIGH"];
const PRIORITY_ICON_CLASS: Record<Priority, string> = {
  LOW: "text-on-surface-variant",
  MEDIUM: "text-chip-amber-text",
  HIGH: "text-error",
  URGENT: "text-error",
};

function nextPriority(p: Priority): Priority {
  const idx = PRIORITY_ORDER.indexOf(p);
  if (idx === -1) return "LOW";
  return PRIORITY_ORDER[(idx + 1) % PRIORITY_ORDER.length];
}

const STATUSES: TaskStatus[] = ["TODO", "IN_PROGRESS", "DONE"];

interface TaskNode {
  task: Task;
  subtasks: Task[];
}

type GroupKey = number | "none";

function groupKeyOf(sectionId: number | null): GroupKey {
  return sectionId ?? "none";
}

function rowId(taskId: number): string {
  return `row:${taskId}`;
}
function subId(taskId: number): string {
  return `sub:${taskId}`;
}
function groupId(key: GroupKey): string {
  return `group:${key}`;
}
function isRowId(id: string): boolean {
  return id.startsWith("row:");
}
function isSubId(id: string): boolean {
  return id.startsWith("sub:");
}
function isGroupId(id: string): boolean {
  return id.startsWith("group:");
}
function numFromRowId(id: string): number {
  return Number(id.slice(4));
}
function numFromSubId(id: string): number {
  return Number(id.slice(4));
}
function keyFromGroupId(id: string): GroupKey {
  const raw = id.slice(6);
  return raw === "none" ? "none" : Number(raw);
}

export function ProjectList() {
  const { project } = useProjectContext();
  const { user } = useAuth();
  const canEdit = hasPermission(user, "task:write");
  const [, setSearchParams] = useSearchParams();

  const { data: tasks, isLoading: tasksLoading, isError, error } = useProjectTasks(project.id);
  const { data: sections, isLoading: sectionsLoading } = useProjectSections(project.id);
  const { data: users } = useUsers();
  const { data: epics } = useProjectEpics(project.id);
  const updateTask = useUpdateTask(project.id);
  const createSection = useCreateSection(project.id);
  const updateSection = useUpdateSection(project.id);
  const deleteSection = useDeleteSection(project.id);
  const duplicateSection = useDuplicateSection(project.id);

  // Built once from useProjectEpics, keyed by Epic.id — passed down to
  // TaskRow the same way `users` is, so rows never call a per-row hook to
  // look up their epic (docs/archive/plans/epics-spec.md §6/§7 T6, mirrors
  // SolvroKanban.tsx's epicMap).
  const epicMap = useMemo(() => {
    const map = new Map<number, Epic>();
    for (const e of epics ?? []) map.set(e.id, e);
    return map;
  }, [epics]);

  const [collapsed, setCollapsed] = useState<Set<GroupKey>>(new Set());
  const [createTaskCtx, setCreateTaskCtx] = useState<{
    sectionId: number | null;
    parentTaskId: number | null;
  } | null>(null);
  const [addingSection, setAddingSection] = useState(false);
  const [newSectionName, setNewSectionName] = useState("");
  const [reorderingSections, setReorderingSections] = useState(false);
  const [renamingSectionKey, setRenamingSectionKey] = useState<GroupKey | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [deletingSection, setDeletingSection] = useState<Section | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  // Epic filter (docs/archive/plans/epics-spec.md §6/§7 T6): "" = All (inactive),
  // `null` = "No epic" (task.epicId === null), a number = one project epic —
  // same three-state shape as SolvroKanban.tsx's filterEpicId.
  const [filterEpicId, setFilterEpicId] = useState<number | null | "">("");

  // Pauses the project queries' 30 s refresh while a row/section drag is live
  // (docs/archive/plans/collaboration-and-sharing.md).
  const dragActivity = useDragActivityGuard();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // Canonical ordering: the backend orders top-level siblings by `position`
  // alone within (parentTaskId) — ONE dense list per project, status does
  // not partition it. The List view groups that list by *section* purely
  // for display; within a rendered section group, sorting by (position, id)
  // is not a stand-in for the real order, it *is* the canonical order
  // projected onto that section (position is globally unique per project).
  //
  // `grouped` itself stays unfiltered — it's built straight from `tasks`
  // (also the unfiltered source `handleDragEnd` below reads directly for its
  // reorder math, via its own `topLevelOrdered`/siblings derivations, never
  // through `grouped`). Epic filtering only ever hides rows from the
  // rendered `visibleGrouped` projection below — mirrors SolvroKanban.tsx's
  // `topLevelAll` (unfiltered, drop-math source) vs `derivedColumns`
  // (filtered, render-only) split.
  const grouped = useMemo(() => groupBySection(tasks ?? [], sections ?? []), [tasks, sections]);

  const isTaskVisible = useCallback(
    (task: Task) => {
      if (filterEpicId !== "") {
        if (filterEpicId === null) {
          if (task.epicId !== null) return false;
        } else if (task.epicId !== filterEpicId) {
          return false;
        }
      }
      return true;
    },
    [filterEpicId],
  );
  const filterActive = filterEpicId !== "";

  const visibleGrouped = useMemo(
    () => grouped.map((g) => ({ ...g, tasks: g.tasks.filter((n) => isTaskVisible(n.task)) })),
    [grouped, isTaskVisible],
  );

  function openTask(id: number) {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set("task", String(id));
        return next;
      },
      { replace: true },
    );
  }

  function toggleGroup(key: GroupKey) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function handleAddSection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!newSectionName.trim()) return;
    setActionError(null);
    try {
      await createSection.mutateAsync({ name: newSectionName.trim() });
      setNewSectionName("");
      setAddingSection(false);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Could not create section.");
    }
  }

  async function handleRename(key: GroupKey, event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = renameValue.trim();
    if (!name) {
      setRenamingSectionKey(null);
      return;
    }
    setActionError(null);
    try {
      if (key === "none") {
        const created = await createSection.mutateAsync({ name });
        const orphans = (tasks ?? []).filter((t) => t.sectionId === null);
        await Promise.all(
          orphans.map((t) =>
            updateTask.mutateAsync({ id: t.id, patch: { sectionId: created.id } }),
          ),
        );
      } else {
        await updateSection.mutateAsync({ id: key, patch: { name } });
      }
      setRenamingSectionKey(null);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Could not rename section.");
    }
  }

  async function handleDeleteSection(s: Section) {
    setDeletingSection(null);
    setActionError(null);
    try {
      await deleteSection.mutateAsync(s.id);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Could not delete section.");
    }
  }

  // One click, no confirm dialog (Decision 7, docs/plans/duplicate-tasks-sections.md) —
  // same error-surfacing pattern as handleDeleteSection above.
  async function handleDuplicateSection(s: Section) {
    setActionError(null);
    try {
      await duplicateSection.mutateAsync(s.id);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Could not duplicate section.");
    }
  }

  function toggleTaskDone(task: Task) {
    updateTask.mutate({
      id: task.id,
      patch: { status: task.status === "DONE" ? "TODO" : "DONE" },
    });
  }

  function cyclePriority(task: Task) {
    updateTask.mutate({ id: task.id, patch: { priority: nextPriority(task.priority) } });
  }

  function setStatus(task: Task, status: TaskStatus) {
    if (status === task.status) return;
    updateTask.mutate({ id: task.id, patch: { status } });
  }

  function setAssignee(task: Task, assignedToId: number | null) {
    if (assignedToId === task.assignedToId) return;
    updateTask.mutate({ id: task.id, patch: { assignedToId } });
  }

  function setDates(task: Task, startDate: string | null, dueDate: string | null) {
    if (startDate === task.startDate && dueDate === task.dueDate) return;
    updateTask.mutate({ id: task.id, patch: { startDate, dueDate } });
  }

  function handleDragEnd(event: DragEndEvent) {
    dragActivity.end();
    const { active, over } = event;
    if (!over) return;
    const activeId = String(active.id);
    let overId = String(over.id);
    if (activeId === overId) return;

    // Subtask drag: reorder WITHIN the parent only (no re-parent/promote in
    // the List view). Sibling list = the parent's subtasks — status doesn't
    // partition subtask ordering (mirrors Kanban's handleSubtaskDrop and
    // queries.ts siblingListId).
    if (isSubId(activeId)) {
      if (!isSubId(overId)) return;
      const moved = (tasks ?? []).find((t) => t.id === numFromSubId(activeId));
      const overSub = (tasks ?? []).find((t) => t.id === numFromSubId(overId));
      if (!moved || !overSub || moved.parentTaskId === null) return;
      if (overSub.parentTaskId !== moved.parentTaskId) return;
      const siblings = (tasks ?? [])
        .filter((t) => t.parentTaskId === moved.parentTaskId && t.id !== moved.id)
        .sort((a, b) => a.position - b.position || a.id - b.id);
      const idx = siblings.findIndex((t) => t.id === overSub.id);
      const position = idx === -1 ? siblings.length : idx;
      if (position === moved.position) return;
      updateTask.mutate({ id: moved.id, patch: { position } });
      return;
    }

    if (!isRowId(activeId)) return;

    // A task row dropped over a subtask row means "dropped on that row's
    // parent card area" — resolve to the parent so the drop isn't a silent
    // no-op.
    if (isSubId(overId)) {
      const overSub = (tasks ?? []).find((t) => t.id === numFromSubId(overId));
      if (!overSub || overSub.parentTaskId === null) return;
      overId = rowId(overSub.parentTaskId);
      if (activeId === overId) return;
    }

    const movedId = numFromRowId(activeId);
    const moved = (tasks ?? []).find((t) => t.id === movedId);
    if (!moved) return;

    // One global top-level order per project — `position` indexes into it.
    // Views group it by section for display; relative order is preserved.
    const topLevelOrdered = (tasks ?? [])
      .filter((t) => t.parentTaskId === null)
      .sort((a, b) => a.position - b.position || a.id - b.id);

    if (isGroupId(overId)) {
      // Dropped on a section header / empty group -> append at the end of
      // that section's block in the global order (empty section: keep slot,
      // section move only).
      const targetKey = keyFromGroupId(overId);
      const targetSectionId = targetKey === "none" ? null : targetKey;
      if (targetSectionId === moved.sectionId) return;
      // Backend insertAt indexes into the sibling list EXCLUDING the moved
      // row (see taskOrdering.ts) — so `last`'s append-after index must be
      // found in that same moved-excluded list, or it overshoots by one
      // slot whenever moved's old position precedes the target section.
      // (The row-drop branch below deliberately does NOT exclude moved from
      // its index lookup — that's correct arrayMove "insert before/after"
      // semantics for a same-list reorder. The two branches differ on
      // purpose: this one computes an absolute append point into a
      // *different* section's block, that one computes a relative
      // over-row index within the *same* single global list.)
      const others = topLevelOrdered.filter((t) => t.id !== moved.id);
      const block = others.filter((t) => t.sectionId === targetSectionId);
      const last = block[block.length - 1];
      updateTask.mutate({
        id: moved.id,
        patch: last
          ? {
              sectionId: targetSectionId,
              position: others.findIndex((t) => t.id === last.id) + 1,
            }
          : { sectionId: targetSectionId },
      });
      return;
    }

    if (!isRowId(overId)) return;
    const overTaskId = numFromRowId(overId);
    const overTask = (tasks ?? []).find((t) => t.id === overTaskId);
    if (!overTask) return;

    // Insert relative to the over row — arrayMove semantics (the over row's
    // pre-move global index: downward drags land after it, upward before
    // it; backend insertAt excludes the moved row first).
    const idx = topLevelOrdered.findIndex((t) => t.id === overTask.id);
    const position = idx === -1 ? topLevelOrdered.length : idx;
    const crossSection = overTask.sectionId !== moved.sectionId;
    if (!crossSection && position === moved.position) return;
    updateTask.mutate({
      id: moved.id,
      patch: crossSection ? { sectionId: overTask.sectionId, position } : { position },
    });
  }

  if (tasksLoading || sectionsLoading) {
    return (
      <div className="h-64 animate-pulse rounded-sm border border-outline-variant bg-surface-container-low" />
    );
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
                1
              </span>
            )}
          </button>
          {filterOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setFilterOpen(false)} />
              <div className="absolute right-0 z-20 mt-2 w-64 rounded-lg border border-outline-variant bg-surface-container-lowest p-3 shadow-overlay">
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
                    onClick={() => setFilterEpicId("")}
                    className="text-xs font-semibold text-primary hover:underline"
                  >
                    Clear filters
                  </button>
                )}
              </div>
            </>
          )}
        </div>
        {canEdit && (sections?.length ?? 0) >= 2 && (
          <button
            type="button"
            onClick={() => setReorderingSections(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-1.5 font-display text-xs font-semibold text-on-surface-variant hover:border-primary hover:text-primary"
          >
            <span className="material-symbols-outlined text-base">reorder</span>
            Reorder sections
          </button>
        )}
        {canEdit && (
          <button
            type="button"
            onClick={() => setAddingSection(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-1.5 font-display text-xs font-semibold text-on-surface-variant hover:border-primary hover:text-primary"
          >
            <span className="material-symbols-outlined text-base">add</span>
            Add section
          </button>
        )}
        {canEdit && (
          <button
            type="button"
            onClick={() => setCreateTaskCtx({ sectionId: null, parentTaskId: null })}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 font-display text-xs font-bold text-on-primary hover:bg-primary/90"
          >
            <span className="material-symbols-outlined text-base">add</span>
            Add task
          </button>
        )}
      </div>

      {actionError && (
        <Alert variant="destructive" className="mb-3">
          <AlertDescription className="text-xs">{actionError}</AlertDescription>
        </Alert>
      )}

      <div className="overflow-x-auto rounded-sm border border-outline-variant bg-surface-container-lowest md:min-h-0 md:flex-1 md:overflow-y-auto">
        {/* Column headers */}
        <div className="hidden grid-cols-[28px_minmax(200px,1fr)_60px_70px_50px_100px] items-center gap-2 border-b border-outline-variant px-3 py-2 font-display text-label-caps uppercase text-on-surface-variant md:grid">
          <span></span>
          <span>Name</span>
          <span>Owner</span>
          <span>Due</span>
          <span>Prio</span>
          <span>Status</span>
        </div>

        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={dragActivity.begin}
          onDragEnd={handleDragEnd}
          onDragCancel={dragActivity.end}
        >
          {visibleGrouped.map((g) => (
            <SectionGroup
              key={g.section?.id ?? "none"}
              section={g.section}
              nodes={g.tasks}
              collapsed={collapsed.has(groupKeyOf(g.section?.id ?? null))}
              canEdit={canEdit}
              users={users ?? []}
              epicMap={epicMap}
              onToggle={() => toggleGroup(groupKeyOf(g.section?.id ?? null))}
              onAddTask={() =>
                setCreateTaskCtx({ sectionId: g.section?.id ?? null, parentTaskId: null })
              }
              onAddSubtask={(parentId) =>
                setCreateTaskCtx({ sectionId: g.section?.id ?? null, parentTaskId: parentId })
              }
              onOpenTask={openTask}
              onToggleDone={toggleTaskDone}
              onCyclePriority={cyclePriority}
              onSetStatus={setStatus}
              onSetAssignee={setAssignee}
              onSetDates={setDates}
              onRename={(s) => {
                setRenamingSectionKey(s ? s.id : "none");
                setRenameValue(s ? s.name : "");
              }}
              onDelete={setDeletingSection}
              onDuplicate={handleDuplicateSection}
              duplicatingSectionId={
                duplicateSection.isPending ? (duplicateSection.variables ?? null) : null
              }
              renamingKey={renamingSectionKey}
              renameValue={renameValue}
              onRenameChange={setRenameValue}
              onRenameSubmit={handleRename}
              onRenameCancel={() => setRenamingSectionKey(null)}
            />
          ))}
        </DndContext>

        {addingSection && (
          <form
            onSubmit={handleAddSection}
            className="flex items-center gap-2 border-t border-outline-variant bg-surface-container-low px-3 py-2"
          >
            <input
              autoFocus
              type="text"
              value={newSectionName}
              onChange={(e) => setNewSectionName(e.target.value)}
              placeholder="Section name"
              maxLength={100}
              className="w-64 rounded-sm border border-outline-variant bg-surface-container-lowest px-2 py-1 text-xs focus:border-primary focus:outline-hidden"
            />
            <button
              type="submit"
              disabled={createSection.isPending || !newSectionName.trim()}
              className="rounded-sm bg-primary px-2 py-1 font-display text-xs text-on-primary hover:bg-primary-container disabled:opacity-50 font-semibold"
            >
              Add
            </button>
            <button
              type="button"
              onClick={() => {
                setAddingSection(false);
                setNewSectionName("");
              }}
              className="rounded-sm px-2 py-1 text-xs font-semibold text-on-surface-variant hover:bg-surface-container"
            >
              Cancel
            </button>
          </form>
        )}
      </div>

      {createTaskCtx && (
        <TaskFormModal
          mode="create"
          open={createTaskCtx !== null}
          onClose={() => setCreateTaskCtx(null)}
          projectId={project.id}
          initialSectionId={createTaskCtx.sectionId}
          initialParentTaskId={createTaskCtx.parentTaskId}
        />
      )}

      <SectionReorderModal
        projectId={project.id}
        open={reorderingSections}
        onClose={() => setReorderingSections(false)}
      />

      <ConfirmModal
        open={deletingSection !== null}
        onClose={() => setDeletingSection(null)}
        onConfirm={() => deletingSection && void handleDeleteSection(deletingSection)}
        title="Delete section"
        body={`Delete section "${deletingSection?.name ?? ""}"? Tasks in this section keep their data but lose the section link.`}
        confirmLabel="Delete"
        confirmTone="danger"
        busy={deleteSection.isPending}
      />
    </>
  );
}

interface SectionGroupProps {
  section: Section | null;
  nodes: TaskNode[];
  collapsed: boolean;
  canEdit: boolean;
  users: { id: number; username: string }[];
  epicMap: Map<number, Epic>;
  onToggle: () => void;
  onAddTask: () => void;
  onAddSubtask: (parentId: number) => void;
  onOpenTask: (id: number) => void;
  onToggleDone: (t: Task) => void;
  onCyclePriority: (t: Task) => void;
  onSetStatus: (t: Task, status: TaskStatus) => void;
  onSetAssignee: (t: Task, assignedToId: number | null) => void;
  onSetDates: (t: Task, start: string | null, due: string | null) => void;
  onRename: (s: Section | null) => void;
  onDelete: (s: Section) => void;
  onDuplicate: (s: Section) => void;
  duplicatingSectionId: number | null;
  renamingKey: GroupKey | null;
  renameValue: string;
  onRenameChange: (v: string) => void;
  onRenameSubmit: (key: GroupKey, e: FormEvent<HTMLFormElement>) => void;
  onRenameCancel: () => void;
}

function SectionGroup({
  section,
  nodes,
  collapsed,
  canEdit,
  users,
  epicMap,
  onToggle,
  onAddTask,
  onAddSubtask,
  onOpenTask,
  onToggleDone,
  onCyclePriority,
  onSetStatus,
  onSetAssignee,
  onSetDates,
  onRename,
  onDelete,
  onDuplicate,
  duplicatingSectionId,
  renamingKey,
  renameValue,
  onRenameChange,
  onRenameSubmit,
  onRenameCancel,
}: SectionGroupProps) {
  const key = groupKeyOf(section?.id ?? null);
  const isRenaming = renamingKey === key;
  const { setNodeRef, isOver } = useDroppable({ id: groupId(key) });
  const sortableIds = nodes.map((n) => rowId(n.task.id));

  return (
    <div className="border-b border-outline-variant last:border-b-0">
      <div
        ref={setNodeRef}
        className={[
          "flex items-center gap-2 bg-surface-container-low px-3 py-1.5",
          isOver ? "ring-2 ring-inset ring-primary/40" : "",
        ].join(" ")}
      >
        <button
          type="button"
          onClick={onToggle}
          className="text-on-surface-variant hover:text-on-surface"
          aria-label={collapsed ? "Expand section" : "Collapse section"}
        >
          <span className="material-symbols-outlined text-base">
            {collapsed ? "chevron_right" : "expand_more"}
          </span>
        </button>
        {section && <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: section.color }} />}
        {isRenaming ? (
          <form onSubmit={(e) => onRenameSubmit(key, e)} className="flex items-center gap-2">
            <input
              autoFocus
              type="text"
              value={renameValue}
              onChange={(e) => onRenameChange(e.target.value)}
              maxLength={100}
              placeholder={section ? section.name : "Name this section to promote it"}
              className="w-64 rounded-sm border border-outline-variant bg-surface-container-lowest px-2 py-0.5 text-sm font-semibold focus:border-primary focus:outline-hidden"
            />
            <button
              type="submit"
              className="rounded-sm bg-primary px-2 py-0.5 font-display text-xs text-on-primary font-semibold"
            >
              {section ? "Save" : "Create"}
            </button>
            <button type="button" onClick={onRenameCancel} className="text-xs font-semibold text-on-surface-variant">
              Cancel
            </button>
          </form>
        ) : (
          <h3
            className={[
              "font-display text-sm font-semibold",
              section ? "text-on-surface" : "italic text-on-surface-variant",
            ].join(" ")}
          >
            {section?.name ?? "No section"}
          </h3>
        )}
        <span className="rounded-full bg-surface-container-high px-1.5 py-0 font-mono text-meta text-on-surface-variant">
          {nodes.length}
        </span>
        {canEdit && !isRenaming && (
          <div className="ml-auto flex items-center gap-1">
            <button
              type="button"
              onClick={() => onRename(section)}
              className="rounded-sm p-1 text-on-surface-variant hover:bg-surface-container hover:text-on-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
              title={section ? "Rename section" : "Promote into a real section"}
            >
              <span className="material-symbols-outlined text-[17px]">edit</span>
            </button>
            {section && (
              <button
                type="button"
                onClick={() => onDuplicate(section)}
                disabled={duplicatingSectionId === section.id}
                className="rounded-sm p-1 text-on-surface-variant hover:bg-surface-container hover:text-on-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:cursor-default disabled:opacity-50"
                title="Duplicate section"
                aria-label="Duplicate section"
              >
                <span className="material-symbols-outlined text-[17px]">content_copy</span>
              </button>
            )}
            {section && (
              <button
                type="button"
                onClick={() => onDelete(section)}
                className="rounded-sm p-1 text-on-surface-variant hover:bg-error-container hover:text-on-error-container focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                title="Delete section"
              >
                <span className="material-symbols-outlined text-[17px]">delete</span>
              </button>
            )}
          </div>
        )}
      </div>

      {!collapsed && (
        <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
          {nodes.map((node) => (
            <TaskRow
              key={node.task.id}
              node={node}
              canEdit={canEdit}
              users={users}
              epicMap={epicMap}
              onAddSubtask={onAddSubtask}
              onOpenTask={onOpenTask}
              onToggleDone={onToggleDone}
              onCyclePriority={onCyclePriority}
              onSetStatus={onSetStatus}
              onSetAssignee={onSetAssignee}
              onSetDates={onSetDates}
            />
          ))}

          {nodes.length === 0 && (
            <div className="px-10 py-2 text-[12px] text-on-surface-variant">No tasks in this section.</div>
          )}

          {canEdit && (
            <button
              type="button"
              onClick={onAddTask}
              className="flex w-full items-center gap-2 px-10 py-1 text-left text-[12px] text-on-surface-variant hover:bg-surface-container-low hover:text-primary"
            >
              <span className="material-symbols-outlined text-[15px]">add</span>
              Add task…
            </button>
          )}
        </SortableContext>
      )}
    </div>
  );
}

function TaskRow({
  node,
  canEdit,
  users,
  epicMap,
  onAddSubtask,
  onOpenTask,
  onToggleDone,
  onCyclePriority,
  onSetStatus,
  onSetAssignee,
  onSetDates,
}: {
  node: TaskNode;
  canEdit: boolean;
  users: { id: number; username: string }[];
  epicMap: Map<number, Epic>;
  onAddSubtask: (parentId: number) => void;
  onOpenTask: (id: number) => void;
  onToggleDone: (t: Task) => void;
  onCyclePriority: (t: Task) => void;
  onSetStatus: (t: Task, status: TaskStatus) => void;
  onSetAssignee: (t: Task, assignedToId: number | null) => void;
  onSetDates: (t: Task, start: string | null, due: string | null) => void;
}) {
  const { task, subtasks } = node;
  const epic = task.epicId !== null ? epicMap.get(task.epicId) : undefined;
  const [expanded, setExpanded] = useState(subtasks.length > 0);
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id: rowId(task.id), disabled: !canEdit });

  const style = { transform: CSS.Transform.toString(transform), transition };

  return (
    <>
      <div
        ref={setNodeRef}
        style={style}
        onClick={() => onOpenTask(task.id)}
        className={[
          "hidden cursor-pointer grid-cols-[28px_minmax(200px,1fr)_60px_70px_50px_100px] items-center gap-2 border-t border-outline-variant px-3 py-1.5 hover:bg-surface-container-low md:grid",
          isDragging ? "opacity-40" : "",
        ].join(" ")}
      >
        <span
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          onClick={(e) => e.stopPropagation()}
          className={[
            "material-symbols-outlined text-[16px] text-on-surface-variant/50",
            canEdit ? "cursor-grab touch-none active:cursor-grabbing" : "cursor-default",
          ].join(" ")}
          aria-label="Drag to reorder"
        >
          drag_indicator
        </span>

        <span className="flex min-w-0 items-center gap-1.5">
          {subtasks.length > 0 && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setExpanded((v) => !v);
              }}
              className="text-on-surface-variant hover:text-on-surface"
            >
              <span className="material-symbols-outlined text-[15px]">
                {expanded ? "expand_more" : "chevron_right"}
              </span>
            </button>
          )}
          <span
            className={[
              "truncate text-sm",
              task.status === "DONE" ? "text-on-surface-variant line-through" : "text-on-surface",
            ].join(" ")}
          >
            {task.title}
          </span>
          {epic && <EpicChip epic={epic} compact className="shrink-0" />}
        </span>

        <span onClick={(e) => e.stopPropagation()}>
          <AssigneeSelect
            canEdit={canEdit}
            users={users}
            projectId={task.projectId}
            value={task.assignedToId}
            onChange={(id) => onSetAssignee(task, id)}
          />
        </span>

        <span onClick={(e) => e.stopPropagation()}>
          <DueDateEditor
            canEdit={canEdit}
            startISO={task.startDate}
            dueISO={task.dueDate}
            done={task.status === "DONE"}
            onSave={(s, d) => onSetDates(task, s, d)}
          />
        </span>

        <span className="flex items-center gap-0.5">
          <button
            type="button"
            disabled={!canEdit}
            onClick={(e) => {
              e.stopPropagation();
              onCyclePriority(task);
            }}
            className="flex grow items-center justify-start disabled:cursor-default"
            title={canEdit ? "Click to cycle priority" : undefined}
          >
            <span className={`material-symbols-outlined text-[15px] ${PRIORITY_ICON_CLASS[task.priority]}`}>
              flag
            </span>
          </button>
          {task.isCriticalPath && <CriticalPathMark variant="glyph" />}
        </span>

        <span onClick={(e) => e.stopPropagation()}>
          <StatusSelect canEdit={canEdit} value={task.status} onChange={(s) => onSetStatus(task, s)} />
        </span>
      </div>

      {/* Mobile card */}
      <div
        onClick={() => onOpenTask(task.id)}
        className="flex cursor-pointer flex-col gap-1.5 border-t border-outline-variant px-3 py-2 md:hidden"
      >
        <div className="flex items-center gap-2">
          {subtasks.length > 0 && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setExpanded((v) => !v);
              }}
              className="shrink-0 text-on-surface-variant"
            >
              <span className="material-symbols-outlined text-[17px]">
                {expanded ? "expand_more" : "chevron_right"}
              </span>
            </button>
          )}
          <span
            className={[
              "min-w-0 flex-1 truncate text-sm",
              task.status === "DONE" ? "text-on-surface-variant line-through" : "text-on-surface",
            ].join(" ")}
          >
            {task.title}
          </span>
          <span className={`material-symbols-outlined text-[15px] ${PRIORITY_ICON_CLASS[task.priority]}`}>
            flag
          </span>
          {task.isCriticalPath && <CriticalPathMark variant="glyph" />}
        </div>
        {epic && (
          <div className="flex items-center gap-1.5 pl-0">
            <EpicChip epic={epic} compact />
          </div>
        )}
        <div className="flex items-center justify-between gap-2 pl-0">
          <span className="flex items-center gap-1.5">
            <AssigneeAvatar user={task.assignedTo} size="xs" />
            <span className="text-meta text-on-surface-variant">{fmt(task.dueDate, task.status === "DONE")}</span>
          </span>
          <span
            className={[
              "rounded-full px-2 py-0.5 font-display text-meta font-semibold",
              TASK_STATUS_TONE_CLASS[task.status],
            ].join(" ")}
          >
            {TASK_STATUS_LABEL[task.status]}
          </span>
        </div>
      </div>

      {expanded && (
        <SortableContext
          items={subtasks.map((s) => subId(s.id))}
          strategy={verticalListSortingStrategy}
        >
          {subtasks.map((s) => (
            <SubtaskRow
              key={s.id}
              task={s}
              canEdit={canEdit}
              onOpenTask={onOpenTask}
              onToggleDone={onToggleDone}
            />
          ))}
        </SortableContext>
      )}
      {expanded && canEdit && (
        <button
          type="button"
          onClick={() => onAddSubtask(task.id)}
          className="flex w-full items-center gap-1.5 border-t border-outline-variant py-1 pl-[52px] text-left text-[12px] text-on-surface-variant hover:bg-surface-container-low hover:text-primary"
        >
          <span className="material-symbols-outlined text-[14px]">add</span>
          Add subtask…
        </button>
      )}
    </>
  );
}

function SubtaskRow({
  task,
  canEdit,
  onOpenTask,
  onToggleDone,
}: {
  task: Task;
  canEdit: boolean;
  onOpenTask: (id: number) => void;
  onToggleDone: (t: Task) => void;
}) {
  const done = task.status === "DONE";
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id: subId(task.id), disabled: !canEdit });
  const style = { transform: CSS.Transform.toString(transform), transition };
  return (
    <div
      ref={setNodeRef}
      style={style}
      onClick={() => onOpenTask(task.id)}
      className={[
        "flex cursor-pointer items-center gap-2 border-t border-outline-variant bg-surface-container-low/40 py-1 pl-[34px] pr-3 text-[12.5px] hover:bg-surface-container-low",
        isDragging ? "opacity-40" : "",
      ].join(" ")}
    >
      <span
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        onClick={(e) => e.stopPropagation()}
        className={[
          "material-symbols-outlined text-[14px] text-on-surface-variant/40",
          canEdit ? "cursor-grab touch-none active:cursor-grabbing" : "cursor-default",
        ].join(" ")}
        aria-label="Drag to reorder subtask"
      >
        drag_indicator
      </span>
      <button
        type="button"
        disabled={!canEdit}
        onClick={(e) => {
          e.stopPropagation();
          onToggleDone(task);
        }}
        aria-label={done ? "Mark not done" : "Mark done"}
        className={[
          "flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border transition-colors",
          done ? "border-emerald-500 bg-emerald-500 text-white" : "border-outline-variant hover:border-primary",
          canEdit ? "cursor-pointer" : "cursor-default",
        ].join(" ")}
      >
        {done && <span className="material-symbols-outlined text-meta leading-none">check</span>}
      </button>
      <span className="flex min-w-0 items-center gap-1">
        <span className={["truncate", done ? "text-on-surface-variant line-through" : "text-on-surface"].join(" ")}>
          {task.title}
        </span>
        {task.isCriticalPath && <CriticalPathMark variant="glyph" className="shrink-0" />}
      </span>
    </div>
  );
}

function AssigneeSelect({
  canEdit,
  users,
  projectId,
  value,
  onChange,
}: {
  canEdit: boolean;
  users: { id: number; username: string }[];
  projectId: number;
  value: number | null;
  onChange: (id: number | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const user = users.find((u) => u.id === value) ?? null;

  if (!canEdit) {
    return <AssigneeAvatar user={user} size="xs" />;
  }

  return (
    <span className="relative inline-block">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-label="Change assignee">
        <AssigneeAvatar user={user} size="xs" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <AssigneeOptions
            users={users}
            projectId={projectId}
            value={value}
            onPick={(id) => {
              onChange(id);
              setOpen(false);
            }}
          />
        </>
      )}
    </span>
  );
}

// Split out so the membership queries are only observed while a picker is
// actually open, not once per list row.
function AssigneeOptions({
  users,
  projectId,
  value,
  onPick,
}: {
  users: { id: number; username: string }[];
  projectId: number;
  value: number | null;
  onPick: (id: number | null) => void;
}) {
  const addsMember = useAssigneeMembership(projectId);
  return (
    <div className="absolute left-0 top-full z-20 mt-1 max-h-56 w-56 overflow-y-auto rounded-lg border border-outline-variant bg-surface-container-lowest py-1 shadow-overlay">
      <button
        type="button"
        onClick={() => onPick(null)}
        className="flex w-full items-center px-3 py-1.5 text-left text-xs text-on-surface-variant hover:bg-surface-container"
      >
        Unassigned
      </button>
      {users.map((u) => (
        <button
          key={u.id}
          type="button"
          onClick={() => onPick(u.id)}
          className={[
            "flex w-full flex-col items-start px-3 py-1.5 text-left text-xs hover:bg-surface-container",
            u.id === value ? "font-bold text-primary" : "text-on-surface",
          ].join(" ")}
        >
          {u.username}
          {addsMember(u.id) && (
            <span className="text-meta font-normal text-on-surface-variant">
              {ASSIGN_ADDS_MEMBER_NOTICE}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

function DueDateEditor({
  canEdit,
  startISO,
  dueISO,
  done,
  onSave,
}: {
  canEdit: boolean;
  startISO: string | null;
  dueISO: string | null;
  /** Finished tasks show the plain date, never "Nd late". */
  done: boolean;
  onSave: (start: string | null, due: string | null) => void;
}) {
  if (!canEdit) {
    return <span className="text-[12px] text-on-surface-variant">{fmt(dueISO, done)}</span>;
  }

  const day = dayFromIso(dueISO);

  return (
    <DateField
      variant="bare"
      className="text-[12px] font-[450] text-on-surface-variant hover:text-primary"
      value={day}
      onChange={(next) => onSave(startISO, commitDraft(next, dueISO))}
      clearable
      triggerLabel={fmt(dueISO, done)}
      aria-label={day ? `Due date, currently ${fmt(dueISO, done)}` : "Due date"}
    />
  );
}

function StatusSelect({
  canEdit,
  value,
  onChange,
}: {
  canEdit: boolean;
  value: TaskStatus;
  onChange: (s: TaskStatus) => void;
}) {
  const [open, setOpen] = useState(false);

  const chip = (
    <span
      className={[
        "inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 font-display text-meta font-semibold",
        TASK_STATUS_TONE_CLASS[value],
        canEdit ? "cursor-pointer" : "",
      ].join(" ")}
    >
      {TASK_STATUS_LABEL[value]}
      {canEdit && <span className="material-symbols-outlined text-meta">expand_more</span>}
    </span>
  );

  if (!canEdit) return chip;

  return (
    <span className="relative inline-block">
      <button type="button" onClick={() => setOpen((v) => !v)}>
        {chip}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full z-20 mt-1 w-28 rounded-lg border border-outline-variant bg-surface-container-lowest py-1 shadow-overlay">
            {STATUSES.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => {
                  onChange(s);
                  setOpen(false);
                }}
                className={[
                  "flex w-full items-center px-3 py-1.5 text-left text-xs hover:bg-surface-container",
                  s === value ? "font-bold text-primary" : "text-on-surface",
                ].join(" ")}
              >
                {TASK_STATUS_LABEL[s]}
              </button>
            ))}
          </div>
        </>
      )}
    </span>
  );
}

function groupBySection(
  tasks: Task[],
  sections: Section[],
): { section: Section | null; tasks: TaskNode[] }[] {
  const topLevel = tasks.filter((t) => t.parentTaskId === null);
  const subtasksByParent = new Map<number, Task[]>();
  for (const t of tasks) {
    if (t.parentTaskId !== null) {
      const arr = subtasksByParent.get(t.parentTaskId) ?? [];
      arr.push(t);
      subtasksByParent.set(t.parentTaskId, arr);
    }
  }
  for (const arr of subtasksByParent.values()) {
    arr.sort((a, b) => a.position - b.position || a.id - b.id);
  }

  const bySection = new Map<number, TaskNode[]>();
  const noSection: TaskNode[] = [];
  for (const t of topLevel) {
    const node: TaskNode = { task: t, subtasks: subtasksByParent.get(t.id) ?? [] };
    if (t.sectionId === null) noSection.push(node);
    else {
      const arr = bySection.get(t.sectionId) ?? [];
      arr.push(node);
      bySection.set(t.sectionId, arr);
    }
  }
  // Within a section group, sort by (position, id) — see the comment on
  // `grouped` above: this projects the canonical global order onto the
  // section, it isn't a separate per-section ordering.
  for (const arr of bySection.values()) {
    arr.sort((a, b) => a.task.position - b.task.position || a.task.id - b.task.id);
  }
  noSection.sort((a, b) => a.task.position - b.task.position || a.task.id - b.task.id);

  const groups: { section: Section | null; tasks: TaskNode[] }[] = sections
    .slice()
    .sort((a, b) => a.position - b.position || a.id - b.id)
    .map((s) => ({ section: s, tasks: bySection.get(s.id) ?? [] }));

  if (noSection.length > 0 || sections.length === 0) {
    groups.push({ section: null, tasks: noSection });
  }

  return groups;
}

function fmt(iso: string | null, done: boolean): string {
  // The formatters read the UTC date part of the ISO instant, so this label's
  // day stays consistent with the tree cell, picker seed, and Gantt bar. A
  // finished task shows the plain date — "Nd late" would misreport it.
  return (done ? fmtDay(iso) : fmtDue(iso)) || "—";
}
