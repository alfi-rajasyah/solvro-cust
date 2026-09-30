// Pure helpers for project membership
// (docs/archive/plans/collaboration-and-sharing.md, C1/C2). Members have the
// same access as the project's TAM; the TAM is never part of the members list.

export const ASSIGN_ADDS_MEMBER_NOTICE = "Assigning this person also adds them to the project.";

interface MemberLike {
  userId: number;
}

interface CandidateUser {
  id: number;
  username: string;
  active: boolean;
}

/**
 * True when picking `assigneeId` would add them to the project: someone is
 * picked, and they are neither the TAM nor an existing member. `members` is
 * `undefined` while the list is still loading — membership is unknown then,
 * so no notice (better silent for a moment than wrong).
 */
export function assigneeAddsMember(
  assigneeId: number | null | undefined,
  tamId: number | undefined,
  members: readonly MemberLike[] | undefined,
  /** The picked user's `active` flag; the server never adds an inactive user. */
  active: boolean = true,
): boolean {
  if (assigneeId === null || assigneeId === undefined) return false;
  if (!active) return false;
  if (tamId === undefined || members === undefined) return false;
  if (assigneeId === tamId) return false;
  return !members.some((m) => m.userId === assigneeId);
}

/** Active users who can still be added: not the TAM, not already a member. */
export function memberCandidates<U extends CandidateUser>(
  users: readonly U[] | undefined,
  tamId: number,
  members: readonly MemberLike[],
): U[] {
  const taken = new Set<number>([tamId, ...members.map((m) => m.userId)]);
  return (users ?? [])
    .filter((u) => u.active && !taken.has(u.id))
    .sort((a, b) => a.username.localeCompare(b.username));
}

/** Splits members into the avatars shown in the header and the "+N" remainder. */
export function splitMemberOverflow<T>(
  members: readonly T[],
  maxVisible: number,
): { visible: T[]; overflow: number } {
  const visible = members.slice(0, Math.max(0, maxVisible));
  return { visible, overflow: members.length - visible.length };
}

/** Warning shown before removing a member who still has assigned tasks. */
export function removalWarning(assignedTaskCount: number): string {
  return `They are assigned to ${assignedTaskCount} ${
    assignedTaskCount === 1 ? "task" : "tasks"
  }. Removing them unassigns those tasks.`;
}
