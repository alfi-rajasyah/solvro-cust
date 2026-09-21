interface AssigneeLike {
  id: number;
  username: string;
  email?: string;
}

export function AssigneeAvatar({
  user,
  size = "sm",
}: {
  user: AssigneeLike | null;
  size?: "xs" | "sm" | "md";
}) {
  const dimensions =
    size === "xs" ? "h-5 w-5 text-[10px]" : size === "md" ? "h-8 w-8 text-xs" : "h-6 w-6 text-[11px]";

  if (!user) {
    return (
      <span
        className={`inline-flex items-center justify-center rounded-full border border-dashed border-outline-variant text-on-surface-variant ${dimensions}`}
        title="Unassigned"
      >
        ?
      </span>
    );
  }

  const initials = user.username
    .split(/[.\s_-]/)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("")
    .slice(0, 2) || user.username.slice(0, 2).toUpperCase();

  return (
    <span
      className={`inline-flex items-center justify-center rounded-full bg-primary font-bold text-white ${dimensions}`}
      title={`${user.username}${user.email ? ` (${user.email})` : ""}`}
    >
      {initials}
    </span>
  );
}
