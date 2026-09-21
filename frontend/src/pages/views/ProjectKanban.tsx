// Thin view wrapper for the /projects/:id/kanban route, serving the ReUI
// Kanban engine (docs/plans/kanban-reui-swap/plan.md, T11 cutover) — mirrors
// the ProjectGantt -> SolvroGantt precedent: this file owns the
// useProjectContext() call and passes `project` down as an explicit prop, so
// SolvroKanban itself stays context-free (props-only, easier to test/reuse).
// Formerly the trial wrapper for the parallel-route spike; the legacy
// hand-rolled board it replaced (1,182 lines) is gone — git history
// preserves it.
import { SolvroKanban } from "@/components/kanban-v2/SolvroKanban";
import { useProjectContext } from "@/pages/ProjectDetail";

export function ProjectKanban() {
  const { project } = useProjectContext();
  return <SolvroKanban project={project} />;
}
