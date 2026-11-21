/**
 * Assignee and owner pickers: an inactive user cannot take new work, so it is
 * hidden, except the one currently selected, who stays so the field does not
 * go blank. One rule for every picker (task panel, subtasks, task form, list
 * row, epic owner).
 */
export function assignableUsers<U extends { id: number; active?: boolean }>(
  users: readonly U[],
  currentId: number | null | undefined,
): U[] {
  return users.filter((u) => u.active !== false || u.id === currentId);
}

/** Option text: the username, marked when a still-selected user is inactive. */
export function assigneeOptionLabel(u: { username: string; active?: boolean }): string {
  return u.active === false ? `${u.username} (inactive)` : u.username;
}
