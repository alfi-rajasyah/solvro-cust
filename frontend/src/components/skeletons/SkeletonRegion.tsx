import type { ReactNode } from "react";
import { useDelayedFlag } from "./useDelayedFlag";

/**
 * Shared shell for every loading skeleton: one live region per loading
 * area (`role="status"` + `aria-busy`), an sr-only "Loading…", and a body
 * that only paints after `delayMs` so fast loads never flash. Skeletons
 * mount only while loading, so the delay clock starts at mount.
 * `announce={false}` drops the region semantics for a skeleton nested in
 * another skeleton's region.
 */
export function SkeletonRegion({
  className,
  delayMs = 150,
  announce = true,
  children,
}: {
  className?: string;
  delayMs?: number;
  announce?: boolean;
  children: ReactNode;
}) {
  const visible = useDelayedFlag(true, delayMs);
  const a11y = announce ? { role: "status", "aria-busy": true } : { "aria-hidden": true };
  return (
    <div className={className} {...a11y}>
      {announce && <span className="sr-only">Loading…</span>}
      {visible && children}
    </div>
  );
}
