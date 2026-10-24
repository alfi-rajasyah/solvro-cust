import { useEffect, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  Autocomplete,
  AutocompleteCollection,
  AutocompleteEmpty,
  AutocompleteGroup,
  AutocompleteGroupLabel,
  AutocompleteInput,
  AutocompleteItem,
  AutocompleteList,
  AutocompleteStatus,
} from "@/components/reui/autocomplete";
import { hasPermission, useAuth } from "@/lib/auth";
import { useBodyScrollLock } from "@/hooks/useBodyScrollLock";
import { projectStatusLabel } from "@/components/StatusChip";
import { filterNavCommands } from "@/lib/navCommands";
import { buildPaletteActions } from "@/lib/paletteActions";
import { OutlineSnippet } from "@/components/OutlineSnippet";
import { ApiError } from "@/lib/api";
import { safeOutlineHref } from "@/lib/outlineUrl";
import type { OutlineSnippetSegment } from "@/lib/outlineSnippet";
import { useOutlineConfig, useOutlineMe, useOutlineSearch, useSearch } from "@/lib/queries";

interface PaletteItem {
  value: string; // unique: "page:/overview", "action:new-project", "project:3", "task:17", "customer:2"
  label: string;
  group: "Pages" | "Actions" | "Projects" | "Tasks" | "Customers" | "Outline";
  to: string; // empty for an Outline page (it opens in a new tab instead)
  hint?: string; // secondary text: customer/project name or status
  icon?: string; // material symbol name (pages and actions)
  // An Outline page found by search: opened in a new tab, snippet shown under the title.
  outline?: { url: string; snippet: OutlineSnippetSegment[] };
}

interface PaletteGroup {
  value: PaletteItem["group"];
  items: PaletteItem[];
}

function useDebounced(value: string, ms: number): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

const GROUP_ORDER: PaletteItem["group"][] = [
  "Pages",
  "Actions",
  "Projects",
  "Tasks",
  "Customers",
  "Outline",
];

// Outline's rate limits are shared by every Solvro user (one client IP), so its
// search waits longer than Solvro's own (docs/archive/plans/outline-integration.md, F11).
const OUTLINE_DEBOUNCE_MS = 350;

function apiErrorCode(error: unknown): string | null {
  if (!(error instanceof ApiError) || typeof error.body !== "object" || error.body === null) return null;
  const code = (error.body as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { pathname, search } = useLocation();
  const [query, setQuery] = useState("");
  const debounced = useDebounced(query, 200);
  // GET /search needs project:read; an account without it just gets the pages.
  const canSearch = hasPermission(user, "project:read");
  const { data, error, isFetching } = useSearch(debounced, canSearch);
  // Same predicate that gates the request (queries.ts's `enabled`) must also
  // gate consumption of `data` — placeholderData resolves against React
  // Query's #lastQueryWithDefinedData, which never clears on its own, so
  // without this a disabled query (< 2 chars, or right after reopen) still
  // renders the previous successful search's rows with isPlaceholder=true.
  // Gated on the LIVE `query` too, not just the debounced one: `query` resets
  // synchronously to "" on close (effect below), but `debounced` lags behind
  // by up to the 200ms debounce window — without this, a reopen inside that
  // window could still read the prior session's now-stale `debounced` value
  // as a valid query and flash its rows before the debounce catches up.
  const hasQuery = canSearch && query.trim().length >= 2 && debounced.trim().length >= 2;

  // Outline: its OWN query, started only for a connected user once the Outline
  // address is set, so Solvro's results above never wait on it.
  const debouncedOutline = useDebounced(query, OUTLINE_DEBOUNCE_MS);
  const { data: outlineConfig } = useOutlineConfig();
  const outlineAddressSet = Boolean(outlineConfig?.baseUrl);
  // No Outline address, no request; and only while the palette is open.
  const { data: outlineMe } = useOutlineMe(open && outlineAddressSet);
  const outlineConfigured = outlineAddressSet && outlineMe?.configured === true;
  const outlineConnected = outlineConfigured && outlineMe?.connected === true;
  // Gated on the live AND the debounced query for the same stale-reopen reason as hasQuery.
  const wantsOutline =
    open && query.trim().length >= 2 && debouncedOutline.trim().length >= 2;
  const outlineSearch = useOutlineSearch(debouncedOutline.trim(), wantsOutline && outlineConnected);
  const outlineErrorCode = apiErrorCode(outlineSearch.error);
  const outlineNeedsConnect =
    outlineConfigured &&
    query.trim().length >= 2 &&
    (outlineMe?.connected === false ||
      outlineErrorCode === "outline_not_connected" ||
      outlineErrorCode === "outline_reconnect_required");
  const outlinePending =
    outlineConnected &&
    wantsOutline &&
    !outlineSearch.isError &&
    (debouncedOutline !== query || outlineSearch.isFetching);

  // Fresh palette every open — stale queries are disorienting on reopen.
  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  useBodyScrollLock(open);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const items = useMemo<PaletteItem[]>(() => {
    const pages: PaletteItem[] = filterNavCommands(
      (p) => hasPermission(user, p),
      query,
    ).map((c) => ({
      value: `page:${c.to}`,
      label: c.label,
      group: "Pages",
      to: c.to,
      icon: c.icon,
    }));
    const actions: PaletteItem[] = buildPaletteActions(
      (p) => hasPermission(user, p),
      pathname,
      query,
      search,
    ).map((a) => ({
      value: `action:${a.id}`,
      label: a.label,
      group: "Actions",
      to: a.to,
      icon: a.icon,
    }));
    const remote: PaletteItem[] = !hasQuery || !data
      ? []
      : [
          ...data.projects.map((p) => ({
            value: `project:${p.id}`,
            label: p.name,
            group: "Projects" as const,
            to: `/projects/${p.id}`,
            hint: p.customerName ?? projectStatusLabel(p.status),
          })),
          ...data.tasks.map((t) => ({
            value: `task:${t.id}`,
            label: t.title,
            group: "Tasks" as const,
            // ProjectDetail.tsx already reads ?task= to open the TaskPanel.
            to: `/projects/${t.projectId}/list?task=${t.id}`,
            hint: t.projectName,
          })),
          ...data.customers.map((c) => ({
            value: `customer:${c.id}`,
            label: c.name,
            group: "Customers" as const,
            to: `/customers/${c.id}`,
          })),
        ];
    const outlinePages: PaletteItem[] =
      !wantsOutline || !outlineConnected || !outlineSearch.data
        ? []
        : outlineSearch.data.flatMap((r) =>
            safeOutlineHref(r.url)
              ? [
                  {
                    value: `outline:${r.id}`,
                    label: r.title || "Untitled",
                    group: "Outline" as const,
                    to: "",
                    outline: { url: r.url, snippet: r.snippet },
                  },
                ]
              : [],
          );
    return [...pages, ...actions, ...remote, ...outlinePages];
  }, [user, pathname, search, query, data, hasQuery, wantsOutline, outlineConnected, outlineSearch.data]);

  // Base UI's Autocomplete groups by nesting: `items` is an array of
  // { value, items } buckets rather than a flat list with a `group` field.
  // Empty buckets are dropped so AutocompleteGroupLabel never renders for a
  // group with nothing in it.
  const groups = useMemo<PaletteGroup[]>(
    () =>
      GROUP_ORDER.map((group) => ({
        value: group,
        items: items.filter((i) => i.group === group),
      })).filter((g) => g.items.length > 0),
    [items],
  );

  function handleSelect(item: PaletteItem) {
    if (item.outline) {
      // An Outline page opens in a new tab (the URL is re-checked: http/https only).
      const href = safeOutlineHref(item.outline.url);
      if (href) window.open(href, "_blank", "noopener,noreferrer");
      onClose();
      return;
    }
    onClose();
    navigate(item.to);
  }

  // One quiet status line under the list for the Outline group's non-result
  // states; a normal result list needs none.
  let outlineStatus: { icon: string; node: ReactNode } | null = null;
  if (outlineNeedsConnect) {
    outlineStatus = {
      icon: "link",
      node: (
        <>
          <Link
            to="/settings"
            onClick={onClose}
            className="font-semibold text-primary hover:underline"
          >
            Connect Outline
          </Link>{" "}
          to search your pages
        </>
      ),
    };
  } else if (outlinePending) {
    outlineStatus = { icon: "hourglass_empty", node: "Searching Outline…" };
  } else if (outlineSearch.isError) {
    outlineStatus = {
      icon: "cloud_off",
      node:
        outlineErrorCode === "outline_rate_limited"
          ? "Outline is busy — try again in a moment."
          : "Outline results are unavailable right now.",
    };
  }

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-100 flex items-stretch justify-center bg-inverse-surface/40 p-0 backdrop-blur-sm md:items-start md:p-4 md:pt-[15vh]"
      onMouseDown={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Global search"
        className="flex max-h-screen w-full flex-col rounded-none border-outline-variant bg-surface-container-lowest font-display shadow-overlay md:max-h-[60vh] md:max-w-xl md:rounded-sm md:border"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/*
          `inline` + `open` (unconditional) is Base UI's own documented pattern
          for a command palette that lives inside a caller-owned dialog shell
          (see @base-ui/react/docs/react/components/autocomplete.md, "Command
          palette" demo) — it skips the primitive's own anchored Portal/
          Positioner/Popup, which is built for a dropdown anchored under an
          input and fights this centered, Modal-convention overlay. `filter={null}`
          disables Base UI's client-side matching since `items` above is
          already server- and permission-filtered. `value`/`onValueChange` on
          the Root (not on AutocompleteInput) is the pattern both official
          examples use for a controlled search string.
        */}
        <Autocomplete
          items={groups}
          value={query}
          onValueChange={setQuery}
          filter={null}
          open
          inline
          autoHighlight="always"
          keepHighlight
        >
          <div className="flex items-center gap-2 border-b border-outline-variant px-4 py-3">
            <span aria-hidden="true" className="material-symbols-outlined text-base text-on-surface-variant">
              search
            </span>
            <AutocompleteInput
              autoFocus
              placeholder="Search projects, tasks, customers…"
              className="flex-1 border-none bg-transparent text-[13px] text-on-surface outline-hidden placeholder:text-on-surface-variant dark:bg-transparent rounded-none h-auto px-0 focus-visible:ring-0 focus-visible:border-transparent"
            />
            <span className="rounded-sm border border-outline-variant bg-surface-container-low px-1.5 py-0.5 font-mono text-meta text-on-surface-variant">
              esc
            </span>
          </div>
          <AutocompleteStatus className="px-4 text-xs text-on-surface-variant">
            {isFetching && hasQuery ? "Searching…" : null}
          </AutocompleteStatus>
          <div className="flex min-h-0 flex-1 flex-col">
            {/*
              AutocompleteEmpty must stay mounted unconditionally — Base UI's
              docs warn against hiding/unmounting it (it announces changes to
              screen readers) and instead say to conditionally render its
              children. The >=2-char gate below avoids a premature "no
              results" flash before the palette has a real query to report on.
            */}
            <AutocompleteEmpty className="px-4 py-6 text-center text-[13px] text-on-surface-variant">
              {hasQuery && !outlinePending
                ? error
                  ? "Could not load results. Try again."
                  : `No results for "${debounced}"`
                : null}
            </AutocompleteEmpty>
            {/*
              The dialog only has a max-height (auto height), so the viewport's
              `h-full` cannot resolve and the list would grow past the popup
              border. On desktop cap the root AND the viewport explicitly so
              the list scrolls inside the popup and the popup fits its content
              up to the cap; phones keep the full-height flex fill.
            */}
            <AutocompleteList
              className="p-1"
              scrollAreaClassName="min-h-0 flex-1 md:max-h-[min(50vh,28rem)] md:**:data-[slot=scroll-area-viewport]:max-h-[min(50vh,28rem)]"
            >
              {(group: PaletteGroup) => (
                <AutocompleteGroup key={group.value} items={group.items}>
                  <AutocompleteGroupLabel className="px-3 pb-1 pt-2 text-label-caps uppercase text-on-surface-variant">
                    {group.value}
                  </AutocompleteGroupLabel>
                  <AutocompleteCollection>
                    {(item: PaletteItem) => (
                      <AutocompleteItem
                        key={item.value}
                        value={item}
                        onClick={() => handleSelect(item)}
                        className="flex cursor-pointer items-center gap-2 rounded-sm px-3 py-2 text-[13px] text-on-surface data-highlighted:bg-surface-container"
                      >
                        {item.outline ? (
                          <span
                            className="material-symbols-outlined text-base text-on-surface-variant"
                            aria-hidden="true"
                          >
                            description
                          </span>
                        ) : (
                          item.icon && (
                            <span aria-hidden="true" className="material-symbols-outlined text-base text-on-surface-variant">
                              {item.icon}
                            </span>
                          )
                        )}
                        {item.outline ? (
                          <span className="min-w-0 flex-1" data-testid="outline-result">
                            <span className="block truncate">{item.label}</span>
                            <OutlineSnippet
                              segments={item.outline.snippet}
                              className="line-clamp-2 block wrap-break-word text-meta text-on-surface-variant"
                            />
                          </span>
                        ) : (
                          <span className="min-w-0 flex-1 truncate">{item.label}</span>
                        )}
                        {item.outline && (
                          <>
                            <span
                              className="material-symbols-outlined shrink-0 text-base text-on-surface-variant"
                              aria-hidden="true"
                            >
                              open_in_new
                            </span>
                            <span className="sr-only">(opens in a new tab)</span>
                          </>
                        )}
                        {item.hint && (
                          <span className="shrink-0 text-meta text-on-surface-variant">
                            {item.hint}
                          </span>
                        )}
                      </AutocompleteItem>
                    )}
                  </AutocompleteCollection>
                </AutocompleteGroup>
              )}
            </AutocompleteList>
            {/*
              Always mounted: a live region has to exist BEFORE its text changes for
              screen readers to announce it. Only the content swaps; with nothing to
              say it collapses to no visible box.
            */}
            <div
              role="status"
              data-testid="outline-palette-status"
              className={
                outlineStatus
                  ? "flex items-center gap-2 border-t border-outline-variant px-4 py-2 text-xs text-on-surface-variant"
                  : "sr-only"
              }
            >
              {outlineStatus && (
                <>
                  <span className="material-symbols-outlined text-base" aria-hidden="true">
                    {outlineStatus.icon}
                  </span>
                  <span>{outlineStatus.node}</span>
                </>
              )}
            </div>
          </div>
        </Autocomplete>
      </div>
    </div>,
    document.body,
  );
}
