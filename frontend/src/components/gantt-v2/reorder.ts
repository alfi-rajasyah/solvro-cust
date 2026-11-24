// Pure drop calculations for the Gantt tree-row reorder (SolvroGantt's
// handleResourceReorder). They mirror GanttFrame.tsx:420-569's `handleDragEnd`
// drop semantics (the old engine's constraints are the spec) on ReUI's single
// `{resourceId, parentId, index}` proposal. Each returns what to save, or
// nothing when the drop changes nothing on screen.
import { sectionNodeId, parseSectionId } from "@/components/gantt-v2/adapter";
import type { Section, Task } from "@/lib/queries";
import { reorderAmongVisible, visibleOrderUnchanged } from "@/lib/taskFilters";

export interface SectionPositionPatch {
  id: number;
  position: number;
}

/**
 * Section-group reorder at the root. Re-derives the root order from the
 * current (pre-drag) list, splices the move in at `index`, and returns a
 * position patch for every real section whose position changed (empty when
 * nothing moved). Mirrors GanttFrame.tsx:544-559's ordered/filtered/splice and
 * diffed useUpdateSection calls.
 *
 * `index` counts the rows the user sees (`visibleRootIds`); the new order is
 * computed on the full list (`allRootIds`), anchored on the visible neighbour
 * the section was dropped next to, so sections hidden by the epic filter keep
 * their place.
 */
export function sectionReorderPatches(
  allRootIds: string[],
  visibleRootIds: string[],
  movedId: string,
  index: number,
  sections: Section[],
): SectionPositionPatch[] {
  const nextRootOrder = reorderAmongVisible(allRootIds, visibleRootIds, movedId, index);
  // Nothing moved on screen (or no other visible section): save nothing.
  if (!nextRootOrder) return [];
  return nextRootOrder
    .filter((id) => id !== sectionNodeId(null))
    .map((id, i) => ({ id: parseSectionId(id), position: i }))
    .filter((p): p is SectionPositionPatch => typeof p.id === "number")
    .filter(({ id, position }) => sections.find((s) => s.id === id)?.position !== position);
}

export interface TaskMovePatch {
  sectionId?: number | null;
  position?: number;
}

/**
 * Top-level task dropped under a section group (`targetSectionId`, `null` for
 * the "(No section)" group) at `index` among that group's visible tasks.
 * Returns the task patch, or `null` for a no-op.
 *
 * `position` is one global dense index across every top-level task in the
 * project (the backend's sibling key for parentTaskId === null is project-wide,
 * not per section: taskOrdering.ts). This unifies GanttFrame's two old drop
 * paths, the row-target case (:431-471, any same- or cross-section slot via a
 * target row) and the section-target case (:500-536, append at the section's
 * block end), into one index-based computation, since ReUI's `index` gives the
 * precise slot in either case.
 */
export function topLevelTaskMove(
  tasks: Task[],
  visibleTaskIds: ReadonlySet<number>,
  moved: Task,
  targetSectionId: number | null,
  index: number,
): TaskMovePatch | null {
  const topLevelOrdered = tasks
    .filter((t) => t.parentTaskId === null)
    .sort((a, b) => a.position - b.position || a.id - b.id);
  const others = topLevelOrdered.filter((t) => t.id !== moved.id);
  // `index` counts the siblings the user sees; `others` stays the full order.
  const targetSiblings = others.filter(
    (t) => t.sectionId === targetSectionId && visibleTaskIds.has(t.id),
  );
  const crossSection = targetSectionId !== moved.sectionId;

  let position: number | undefined;
  if (targetSiblings.length === 0) {
    // No other task in the target section — GanttFrame.tsx:529's `last`
    // undefined branch: omit position entirely (appends at the global end;
    // harmless, since display groups by section anyway).
    position = undefined;
  } else if (index >= targetSiblings.length) {
    const last = targetSiblings[targetSiblings.length - 1];
    position = others.findIndex((t) => t.id === last.id) + 1;
  } else {
    const before = targetSiblings[index];
    position = others.findIndex((t) => t.id === before.id);
  }

  if (!crossSection) {
    // Dropped back where it was on screen: hidden siblings must not shift.
    const visibleInSection = topLevelOrdered
      .filter((t) => t.sectionId === targetSectionId && visibleTaskIds.has(t.id))
      .map((t) => t.id);
    if (visibleOrderUnchanged(visibleInSection, moved.id, index)) return null;
    // Same section, same slot (or nothing to reorder against).
    if (position === undefined || position === moved.position) return null;
  }

  const patch: TaskMovePatch = {};
  if (crossSection) patch.sectionId = targetSectionId;
  if (position !== undefined) patch.position = position;
  return patch;
}
