import { useState } from "react";

interface AssigneeLike {
  id: number;
  username: string;
  email?: string;
  /** Profile picture (Google sign-in); initials show when absent or broken. */
  avatarUrl?: string | null;
}

export function AssigneeAvatar({
  user,
  size = "sm",
}: {
  user: AssigneeLike | null;
  size?: "xs" | "sm" | "md";
}) {
  // Declared before the early return below (rules of hooks).
  // Tracks which URL failed, so a new avatarUrl gets a fresh attempt.
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const dimensions =
    size === "xs" ? "h-5 w-5 text-meta" : size === "md" ? "h-8 w-8 text-xs" : "h-6 w-6 text-meta";

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

  const title = `${user.username}${user.email ? ` (${user.email})` : ""}`;

  if (user.avatarUrl && failedUrl !== user.avatarUrl) {
    const url = user.avatarUrl;
    return (
      <img
        src={url}
        alt={user.username}
        title={title}
        referrerPolicy="no-referrer"
        onError={() => setFailedUrl(url)}
        className={`inline-block shrink-0 rounded-full object-cover ${dimensions}`}
      />
    );
  }

  return (
    <span
      className={`inline-flex items-center justify-center rounded-full bg-primary font-bold text-white ${dimensions}`}
      title={title}
    >
      {initials}
    </span>
  );
}
