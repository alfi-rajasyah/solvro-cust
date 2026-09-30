import { ASSIGN_ADDS_MEMBER_NOTICE } from "@/lib/projectMembers";
import { useAssigneeMembership } from "@/lib/useAssigneeMembership";

/**
 * Sits under an assignee picker that saves on an explicit action (the task
 * form). Deliberately a plain paragraph, not a live region: a role="status"
 * inside the task surfaces breaks the specs that query by role.
 */
export function AssigneeMembershipNotice({
  projectId,
  assigneeId,
  className = "",
}: {
  projectId: number;
  assigneeId: number | null | undefined;
  className?: string;
}) {
  const addsMember = useAssigneeMembership(projectId);
  if (!addsMember(assigneeId)) return null;
  return (
    <p
      data-testid="assignee-membership-notice"
      className={`text-meta text-on-surface-variant ${className}`}
    >
      {ASSIGN_ADDS_MEMBER_NOTICE}
    </p>
  );
}
