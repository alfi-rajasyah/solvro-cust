import type { ReactNode } from "react";
import { BrandMark } from "@/components/BrandMark";

// Building blocks of the Outline embed views (docs/archive/plans/
// outline-integration.md, Phase C): a compact read-only panel that sits inside
// someone else's page. Nothing here edits; every way out is a link that opens
// Solvro in a new top-level tab.

const BUTTON =
  "inline-flex h-8 items-center justify-center gap-1.5 rounded-lg px-3 font-display text-xs font-bold outline-hidden focus-visible:ring-2 focus-visible:ring-primary/30";
export const EMBED_BUTTON_PRIMARY = `${BUTTON} bg-primary text-on-primary hover:opacity-90`;
export const EMBED_BUTTON_SECONDARY = `${BUTTON} border border-outline-variant bg-surface-container-lowest text-on-surface hover:bg-surface-container`;

/** A link into Solvro: always a new tab, always announced as such. */
export function EmbedExternalLink({
  href,
  className,
  testId,
  children,
}: {
  href: string;
  className?: string;
  testId?: string;
  children: ReactNode;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      data-testid={testId}
      className={className}
    >
      {children}
      <span className="sr-only">(opens in a new tab)</span>
    </a>
  );
}

/** Outer frame: compact padding, theme tokens, no page chrome. */
export function EmbedFrame({ children }: { children: ReactNode }) {
  return (
    <div className="bg-background p-2 text-on-surface sm:p-3" data-testid="embed-root">
      <div className="mx-auto w-full max-w-4xl overflow-hidden rounded-sm border border-outline-variant bg-surface-container-lowest">
        {children}
      </div>
    </div>
  );
}

/** Mark + title on the left, counts and the live marker on the right. */
export function EmbedHeader({
  title,
  subtitle,
  meta,
  live = true,
}: {
  title: string;
  subtitle?: string | null;
  meta?: ReactNode;
  /** The signed-in views poll every 30 s; the guest view is a snapshot. */
  live?: boolean;
}) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-outline-variant bg-surface-container-low px-3 py-2">
      <div className="flex min-w-0 items-center gap-2">
        <BrandMark className="h-5 w-5 shrink-0" />
        <h1 className="min-w-0 truncate font-display text-sm font-semibold text-on-surface">
          <span data-testid="embed-title">{title}</span>
          {subtitle && (
            <>
              <span aria-hidden="true" className="px-1.5 text-on-surface-variant">
                ·
              </span>
              <span data-testid="embed-subtitle" className="font-medium text-on-surface-variant">
                {subtitle}
              </span>
            </>
          )}
        </h1>
      </div>
      <p className="flex items-center gap-1.5 text-meta text-on-surface-variant">
        {meta}
        {meta && live && <span aria-hidden="true">·</span>}
        {live && (
          <span className="inline-flex items-center gap-1">
            <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-primary" />
            live
          </span>
        )}
      </p>
    </header>
  );
}

export function EmbedFooter({ children }: { children: ReactNode }) {
  return (
    <footer className="border-t border-outline-variant bg-surface-container-low px-3 py-2 text-meta text-on-surface-variant">
      {children}
    </footer>
  );
}

/** Compact centred message: sign-in, no access, errors, empty views. */
export function EmbedMessage({
  icon,
  title,
  hint,
  testId,
  role,
  children,
}: {
  icon: string;
  title: string;
  hint?: string;
  testId?: string;
  role?: "alert" | "status";
  children?: ReactNode;
}) {
  return (
    <div
      role={role}
      data-testid={testId}
      className="flex flex-col items-center gap-1.5 px-4 py-8 text-center"
    >
      <span className="material-symbols-outlined text-2xl text-on-surface-variant" aria-hidden="true">
        {icon}
      </span>
      <h1 className="font-display text-sm font-semibold text-on-surface">{title}</h1>
      {hint && <p className="max-w-sm text-meta text-on-surface-variant">{hint}</p>}
      {children && <div className="mt-2 flex flex-wrap items-center justify-center gap-2">{children}</div>}
    </div>
  );
}
