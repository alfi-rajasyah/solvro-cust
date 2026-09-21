import { useState } from "react";
import { SolvroGantt } from "@/components/gantt-v2/SolvroGantt";
import { TaskFormModal } from "@/components/TaskFormModal";
import type { Task } from "@/lib/queries";
import { useProjectContext } from "../ProjectDetail";
import { ProjectList } from "./ProjectList";

export function ProjectGantt() {
  const { project } = useProjectContext();
  const [editTask, setEditTask] = useState<Task | null>(null);
  // T5 (gantt visual refresh) — `parentTaskId` is new: the row menu's "Add
  // subtask" action threads the row's task id through SolvroGantt's
  // `onCreateTaskOpen(sectionId, parentTaskId)` (widened for this task) so
  // the modal opens pre-parented, same as `initialSectionId` already does
  // for the "+ Task" toolbar button (which omits the second argument, so
  // `parentTaskId` stays `null` there).
  const [createState, setCreateState] = useState<{
    open: boolean;
    sectionId: number | null;
    parentTaskId: number | null;
  }>({ open: false, sectionId: null, parentTaskId: null });

  return (
    <>
      <div className="hidden min-h-0 min-w-0 flex-1 md:block">
        <SolvroGantt
          projectId={project.id}
          projectName={project.name}
          baselineLockedAt={project.baselineLockedAt}
          baselineLockedBy={project.baselineLockedBy}
          onEditTask={setEditTask}
          onCreateTaskOpen={(sectionId, parentTaskId) =>
            setCreateState({ open: true, sectionId, parentTaskId: parentTaskId ?? null })
          }
        />
      </div>
      <div className="md:hidden">
        <ProjectList />
      </div>

      {editTask && (
        <TaskFormModal
          mode="edit"
          open={editTask !== null}
          onClose={() => setEditTask(null)}
          projectId={project.id}
          task={editTask}
        />
      )}

      {createState.open && (
        <TaskFormModal
          mode="create"
          open={createState.open}
          onClose={() => setCreateState({ open: false, sectionId: null, parentTaskId: null })}
          projectId={project.id}
          initialSectionId={createState.sectionId}
          initialParentTaskId={createState.parentTaskId}
        />
      )}
    </>
  );
}
