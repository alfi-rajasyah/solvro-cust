// The "Docs" tab of a project / customer: the Outline page tree under the link
// stored in `outlineUrl` (docs/archive/plans/outline-integration.md, B6). The
// server resolves it with the VIEWER's own Outline token, so the tree only holds
// pages that user can open; no page text ever reaches the client (D4). Every
// link goes through safeOutlineHref and opens Outline in a new tab.
import { useId, useMemo, useState, type ReactNode } from "react";
import { EmptyState } from "@/components/EmptyState";
import { NewOutlineDocDialog } from "@/components/outline/NewOutlineDocDialog";
import { SkeletonRegion } from "@/components/skeletons/SkeletonRegion";
import { Skeleton } from "@/components/ui/skeleton";
import { useConnectOutline } from "@/hooks/useConnectOutline";
import { ApiError } from "@/lib/api";
import { retryAfterText } from "@/lib/outlineDocs";
import { safeOutlineHref } from "@/lib/outlineUrl";
import {
  useOutlineDocs,
  type OutlineDocNode,
  type OutlineDocsResponse,
  type OutlineDocsScope,
} from "@/lib/queries";

const ACTION_BUTTON =
  "inline-flex items-center gap-1.5 rounded-sm bg-primary px-4 py-1.5 font-display text-xs font-semibold text-on-primary hover:bg-primary-container disabled:opacity-60";
const GHOST_BUTTON =
  "inline-flex h-8 items-center gap-1.5 rounded-lg border border-outline-variant bg-surface-container-lowest px-3 font-display text-xs font-bold text-on-surface outline-hidden hover:bg-surface-container focus-visible:ring-2 focus-visible:ring-primary/30";

export function OutlineDocsTab({
  scope,
  id,
  outlineUrl,
  canWrite,
}: {
  scope: OutlineDocsScope;
  id: number;
  /** The entity's stored link (for "Open in Outline" when the tree cannot be shown). */
  outlineUrl: string | null;
  /** Whether the user may create pages (the entity's write permission). */
  canWrite: boolean;
}) {
  const { data, isLoading, error, refetch, isFetching } = useOutlineDocs(scope, id);
  const connect = useConnectOutline();
  const entity = scope === "projects" ? "project" : "customer";
  const linkHref = safeOutlineHref(outlineUrl);

  if (isLoading) {
    return (
      <SkeletonRegion className="space-y-2" data-testid="outline-docs-loading">
        <Skeleton className="h-8 w-full max-w-md" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-3/4" />
      </SkeletonRegion>
    );
  }

  if (error) {
    const apiError = error instanceof ApiError ? error : null;
    const code = (apiError?.body as { code?: string } | null)?.code;
    if (code === "outline_not_connected" || code === "outline_reconnect_required") {
      return (
        <EmptyState
          icon="link_off"
          title={
            code === "outline_reconnect_required"
              ? "Your Outline connection expired"
              : "Connect your Outline account"
          }
          message="Solvro lists the pages you can open in Outline using your own Outline account. Opens Outline, you approve access once, and you come back to Settings."
          action={
            <div className="flex flex-col items-center gap-2">
              <button
                type="button"
                onClick={() => void connect.connect()}
                disabled={connect.pending}
                data-testid="outline-docs-connect"
                className={ACTION_BUTTON}
              >
                {connect.pending ? "Opening Outline…" : "Connect Outline"}
                <span className="material-symbols-outlined text-base" aria-hidden="true">
                  open_in_new
                </span>
              </button>
              {connect.error && <p className="text-xs text-error">{connect.error}</p>}
            </div>
          }
        />
      );
    }
    if (code === "outline_not_configured" || code === "outline_app_url_unset") {
      return (
        <EmptyState
          icon="settings"
          title="Outline isn't set up yet"
          message="An administrator needs to finish the Outline settings before Docs can load."
        />
      );
    }
    if (apiError?.status === 429) {
      const retry = (apiError.body as { details?: { retryAfter?: number | null } } | null)?.details
        ?.retryAfter;
      return (
        <EmptyState
          icon="hourglass_top"
          title="Outline is busy"
          message={`Outline is rate limiting requests right now. ${retryAfterText(retry)}`}
          action={
            <button type="button" onClick={() => void refetch()} className={ACTION_BUTTON}>
              Try again
            </button>
          }
        />
      );
    }
    return (
      <EmptyState
        icon="error"
        title="Could not load Outline pages"
        message={
          code === "outline_unavailable"
            ? "Solvro could not reach Outline. Check that it is running, then try again."
            : "Something went wrong while loading the pages."
        }
        action={
          <button type="button" onClick={() => void refetch()} className={ACTION_BUTTON}>
            Try again
          </button>
        }
      />
    );
  }

  const anchor = data?.anchor ?? null;
  if (anchor === null) {
    return (
      <EmptyState
        icon="menu_book"
        title="No Outline link yet"
        message={`Add the address of this ${entity}'s Outline page or collection in Edit ${entity}, and its pages show up here.`}
      />
    );
  }
  if ("outside" in anchor) {
    return (
      <EmptyState
        icon="link_off"
        title="This link points outside your Outline"
        message={`The Outline link on this ${entity} is not on your Outline address, so Solvro will not open it with your account. Update the link in Edit ${entity}.`}
        action={<OpenLink href={linkHref} label="Open the link" />}
      />
    );
  }
  if ("unsupported" in anchor) {
    return (
      <EmptyState
        icon="link_off"
        title="This link isn't an Outline page or collection"
        message={`Open the page or collection in Outline, copy its address, and paste it in Edit ${entity}.`}
        action={<OpenLink href={linkHref} label="Open the link" />}
      />
    );
  }
  if ("hidden" in anchor) {
    return (
      <EmptyState
        icon="lock"
        title="You can't open this page in Outline"
        message="It may be private, moved, archived or deleted. Ask for access in Outline, or point this link at another page."
        action={<OpenLink href={linkHref} label="Try in Outline" />}
      />
    );
  }

  return (
    <DocsTree
      scope={scope}
      id={id}
      data={data as OutlineDocsResponse & { anchor: { kind: "doc" | "collection"; title: string; url: string } }}
      canWrite={canWrite}
      refreshing={isFetching}
      onRefresh={() => void refetch()}
    />
  );
}

function OpenLink({ href, label }: { href: string | null; label: string }) {
  if (!href) return null;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={GHOST_BUTTON}>
      {label}
      <span className="material-symbols-outlined text-base text-on-surface-variant" aria-hidden="true">
        open_in_new
      </span>
      <span className="sr-only">(opens in a new tab)</span>
    </a>
  );
}

function DocsTree({
  scope,
  id,
  data,
  canWrite,
  refreshing,
  onRefresh,
}: {
  scope: OutlineDocsScope;
  id: number;
  data: OutlineDocsResponse & { anchor: { kind: "doc" | "collection"; title: string; url: string } };
  canWrite: boolean;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const { anchor } = data;
  const tree = useMemo(() => data.tree ?? [], [data.tree]);
  // A page anchor is the single root of its tree: open it by default.
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(anchor.kind === "doc" && tree[0] ? [tree[0].id] : []),
  );
  const [newDocOpen, setNewDocOpen] = useState(false);
  const anchorHref = safeOutlineHref(anchor.url);

  function toggle(nodeId: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  }

  return (
    <div className="flex min-w-0 flex-col gap-3" data-testid="outline-docs-tree">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="material-symbols-outlined text-lg text-on-surface-variant" aria-hidden="true">
            menu_book
          </span>
          <span className="text-xs text-on-surface-variant">From Outline ·</span>
          <span className="truncate text-xs font-semibold text-on-surface" data-testid="outline-docs-anchor">
            {anchor.title}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onRefresh}
            disabled={refreshing}
            aria-label="Refresh pages"
            title="Refresh pages"
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-outline-variant text-on-surface-variant hover:bg-surface-container disabled:opacity-50"
          >
            <span className="material-symbols-outlined text-base" aria-hidden="true">
              refresh
            </span>
          </button>
          <OpenLink href={anchorHref} label="Open in Outline" />
          {canWrite && (
            <button
              type="button"
              onClick={() => setNewDocOpen(true)}
              data-testid="new-outline-doc"
              className={`${ACTION_BUTTON} h-8`}
            >
              <span className="material-symbols-outlined text-base" aria-hidden="true">
                add
              </span>
              New doc
            </button>
          )}
        </div>
      </div>

      {tree.length === 0 ? (
        <EmptyState
          icon="description"
          title="No pages here yet"
          message={canWrite ? "Create the first page from a template or a blank page." : "Nothing has been written in this Outline page or collection yet."}
        />
      ) : (
        <ul
          aria-label="Outline pages"
          className="overflow-hidden rounded-sm border border-outline-variant bg-surface-container-lowest"
        >
          {tree.map((node) => (
            <TreeRow key={node.id} node={node} depth={0} expanded={expanded} onToggle={toggle} />
          ))}
        </ul>
      )}

      <p className="text-xs text-on-surface-variant">
        Shows only the pages your Outline account can open. Pages open in Outline in a new tab.
      </p>

      {canWrite && (
        <NewOutlineDocDialog
          open={newDocOpen}
          onClose={() => setNewDocOpen(false)}
          scope={scope}
          id={id}
          anchor={anchor}
          tree={tree}
        />
      )}
    </div>
  );
}

function TreeRow({
  node,
  depth,
  expanded,
  onToggle,
}: {
  node: OutlineDocNode;
  depth: number;
  expanded: Set<string>;
  onToggle: (id: string) => void;
}): ReactNode {
  const hasChildren = node.children.length > 0;
  const isOpen = expanded.has(node.id);
  const href = safeOutlineHref(node.url);
  const childrenId = useId();
  // A disclosure list, not an ARIA tree: nested ul/li, and the button that opens
  // a branch says so (aria-expanded) and what it controls (aria-controls).
  return (
    <li>
      <div
        data-testid="outline-doc-row"
        className="flex min-w-0 items-center gap-1 border-t border-outline-variant px-3 py-2 first:border-t-0 hover:bg-surface-container-low"
        style={{ paddingLeft: `${12 + depth * 20}px` }}
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={() => onToggle(node.id)}
            aria-expanded={isOpen}
            aria-controls={childrenId}
            aria-label={`${isOpen ? "Collapse" : "Expand"} ${node.title}`}
            className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-sm text-on-surface-variant hover:bg-surface-container-high"
          >
            <span className="material-symbols-outlined text-base" aria-hidden="true">
              {isOpen ? "expand_more" : "chevron_right"}
            </span>
          </button>
        ) : (
          <span className="inline-block h-6 w-6 shrink-0" aria-hidden="true" />
        )}
        <span className="material-symbols-outlined shrink-0 text-lg text-on-surface-variant" aria-hidden="true">
          {hasChildren ? "folder" : "description"}
        </span>
        {href ? (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="min-w-0 flex-1 truncate rounded-sm text-sm text-on-surface outline-hidden hover:text-primary hover:underline focus-visible:ring-2 focus-visible:ring-primary/30"
          >
            {node.title}
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        ) : (
          <span className="min-w-0 flex-1 truncate text-sm text-on-surface">{node.title}</span>
        )}
        {hasChildren && (
          <span className="shrink-0 text-meta text-on-surface-variant">
            {node.children.length} {node.children.length === 1 ? "page" : "pages"}
          </span>
        )}
      </div>
      {hasChildren && isOpen && (
        <ul id={childrenId}>
          {node.children.map((child) => (
            <TreeRow key={child.id} node={child} depth={depth + 1} expanded={expanded} onToggle={onToggle} />
          ))}
        </ul>
      )}
    </li>
  );
}
