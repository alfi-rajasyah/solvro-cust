import { assigneeAddsMember } from "@/lib/projectMembers";
import { useProject, useProjectMembers, useUsers } from "@/lib/queries";

/**
 * Answers "would assigning this user add them to the project?" for the
 * assignee pickers (C2). Reads the caches the project header already fills.
 */
export function useAssigneeMembership(projectId: number | null) {
  const { data: project } = useProject(projectId);
  const { data: members } = useProjectMembers(projectId);
  const tamId = project?.tam.id;
  const { data: users } = useUsers();
  return (assigneeId: number | null | undefined) =>
    assigneeAddsMember(
      assigneeId,
      tamId,
      members,
      users?.find((u) => u.id === assigneeId)?.active ?? true,
    );
}
