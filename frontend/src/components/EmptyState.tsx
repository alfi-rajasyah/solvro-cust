import type { ReactNode } from "react";

import { Frame } from "@/components/reui/frame";
import { IconTile } from "@/components/reui/icon-tile";

interface EmptyStateProps {
  icon?: string;
  title?: string;
  message: ReactNode;
  action?: ReactNode;
}

export function EmptyState({
  icon = "inbox",
  title,
  message,
  action,
}: EmptyStateProps) {
  return (
    <Frame
      className="[--frame-radius:var(--radius-sm)] [--frame-gap:0px] [--frame-px:--spacing(12)] [--frame-py:--spacing(12)] items-center border-dashed border-outline-variant bg-surface-container-lowest text-center"
    >
      <IconTile
        aria-hidden="true"
        variant="outline"
        size="lg"
        className="mb-2"
      >
        <span aria-hidden="true" className="material-symbols-outlined text-2xl text-on-surface-variant">
          {icon}
        </span>
      </IconTile>
      {title && (
        <p className="mb-1 font-display text-sm font-semibold text-on-surface">
          {title}
        </p>
      )}
      <p className="mb-4 text-sm text-on-surface-variant">{message}</p>
      {action}
    </Frame>
  );
}
