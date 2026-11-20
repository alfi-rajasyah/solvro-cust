import { assigneeAddsMember } from "@/lib/projectMembers";
import { useProject, useProjectMembers, useProjectTeamAccess, useUsers } from "@/lib/queries";

/**
 * Answers "would assigning this user add them to the project?" for the
 * assignee pickers (C2). Reads the caches the project header already fills.
 */
export function useAssigneeMembership(projectId: number | null) {
  const { data: project } = useProject(projectId);
  const { data: members } = useProjectMembers(projectId);
  const { data: teamAccess } = useProjectTeamAccess(projectId);
  const tamId = project?.tam.id;
  const { data: users } = useUsers();
  // Silent until the team-access list has loaded: showing the notice for a
  // moment and then dropping it would be wrong in the other direction.
  return (assigneeId: number | null | undefined) =>
    teamAccess !== undefined &&
    assigneeAddsMember(
      assigneeId,
      tamId,
      members,
      users?.find((u) => u.id === assigneeId)?.active ?? true,
      teamAccess?.teamAccessUserIds,
    );
}
