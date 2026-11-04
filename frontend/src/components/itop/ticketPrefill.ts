// Prefill for "Create iTop ticket…" from a task or subtask row. A subtask's
// ticket carries a context line so the iTop agent can tell which project the
// work belongs to (docs/archive/plans/subtask-itop-tickets.md Task 4); the title is
// always the row's own title. Dependency-free for unit testing.
export function buildTicketPrefill(input: {
  title: string;
  description: string | null;
  projectName: string;
  /** The parent task's title; set for a subtask, null for a top-level task. */
  parentTitle?: string | null;
}): { title: string; description: string } {
  const description = (input.description ?? "").trim();
  const path = [input.projectName, ...(input.parentTitle ? [input.parentTitle] : []), input.title];
  const context = `Solvro: ${path.join(" › ")}`;
  return { title: input.title, description: description ? `${description}\n\n${context}` : context };
}
