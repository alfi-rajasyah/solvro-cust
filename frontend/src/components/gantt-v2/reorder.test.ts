import { describe, expect, it } from "vitest";
import { sectionNodeId } from "./adapter";
import { sectionReorderPatches, topLevelTaskMove } from "./reorder";
import type { Section, Task } from "@/lib/queries";

const section = (id: number, position: number) => ({ id, position }) as Section;
const task = (id: number, position: number, sectionId: number | null, parentTaskId: number | null = null) =>
  ({ id, position, sectionId, parentTaskId }) as Task;

describe("sectionReorderPatches", () => {
  const sections = [section(1, 0), section(2, 1), section(3, 2)];
  const all = [sectionNodeId(1), sectionNodeId(2), sectionNodeId(3), sectionNodeId(null)];

  it("patches every section whose position changes", () => {
    expect(sectionReorderPatches(all, all, sectionNodeId(3), 0, sections)).toEqual([
      { id: 3, position: 0 },
      { id: 1, position: 1 },
      { id: 2, position: 2 },
    ]);
  });

  it("returns nothing when the drop leaves the order as it was", () => {
    expect(sectionReorderPatches(all, all, sectionNodeId(2), 1, sections)).toEqual([]);
  });

  it("anchors on the visible neighbour, not the full-list index", () => {
    const visible = [sectionNodeId(1), sectionNodeId(3), sectionNodeId(null)];
    // Section 1 dropped after section 3 on screen. A plain splice on the full
    // list at index 1 would give 2, 1, 3; anchoring on section 3 gives 2, 3, 1.
    expect(sectionReorderPatches(all, visible, sectionNodeId(1), 1, sections)).toEqual([
      { id: 2, position: 0 },
      { id: 3, position: 1 },
      { id: 1, position: 2 },
    ]);
  });

  it("keeps a section hidden by a filter in its place", () => {
    const visible = [sectionNodeId(1), sectionNodeId(3), sectionNodeId(null)];
    // Section 3 dropped before section 1 on screen; hidden section 2 stays after 1.
    expect(sectionReorderPatches(all, visible, sectionNodeId(3), 0, sections)).toEqual([
      { id: 3, position: 0 },
      { id: 1, position: 1 },
      { id: 2, position: 2 },
    ]);
  });
});

describe("topLevelTaskMove", () => {
  // Section 10: tasks 1, 2. Section 20: task 3. No section: task 4.
  const tasks = [task(1, 0, 10), task(2, 1, 10), task(3, 2, 20), task(4, 3, null), task(5, 0, 10, 1)];
  const allVisible = new Set([1, 2, 3, 4, 5]);

  it("moves within a section to the slot before a sibling", () => {
    expect(topLevelTaskMove(tasks, allVisible, tasks[1], 10, 0)).toEqual({ position: 0 });
  });

  it("returns null when dropped back where it was", () => {
    expect(topLevelTaskMove(tasks, allVisible, tasks[0], 10, 0)).toBeNull();
  });

  it("moves to another section and sets its section", () => {
    expect(topLevelTaskMove(tasks, allVisible, tasks[0], 20, 1)).toEqual({ sectionId: 20, position: 2 });
  });

  it("moves into the no-section group", () => {
    expect(topLevelTaskMove(tasks, allVisible, tasks[2], null, 0)).toEqual({ sectionId: null, position: 2 });
  });

  it("omits the position when the target section has no other task", () => {
    expect(topLevelTaskMove(tasks, allVisible, tasks[2], 30, 0)).toEqual({ sectionId: 30 });
  });

  it("does not count hidden siblings in the drop index", () => {
    const hidden2 = new Set([1, 3, 4, 5]);
    // Task 3 dropped after task 1 (the only visible task in section 10).
    expect(topLevelTaskMove(tasks, hidden2, tasks[2], 10, 1)).toEqual({ sectionId: 10, position: 1 });
  });
});
