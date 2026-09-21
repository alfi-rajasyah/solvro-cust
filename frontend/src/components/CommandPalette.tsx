import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
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
import { useSearch } from "@/lib/queries";

interface PaletteItem {
  value: string; // unique: "page:/overview", "project:3", "task:17", "customer:2"
  label: string;
  group: "Pages" | "Projects" | "Tasks" | "Customers";
  to: string;
  hint?: string; // secondary text: customer/project name or status
  icon?: string; // material symbol name (pages only)
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

const GROUP_ORDER: PaletteItem["group"][] = ["Pages", "Projects", "Tasks", "Customers"];

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const debounced = useDebounced(query, 200);
  const { data, error, isFetching } = useSearch(debounced);
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
  const hasQuery = query.trim().length >= 2 && debounced.trim().length >= 2;

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
    return [...pages, ...remote];
  }, [user, query, data, hasQuery]);

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
    onClose();
    navigate(item.to);
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
            <span className="material-symbols-outlined text-base text-on-surface-variant">
              search
            </span>
            <AutocompleteInput
              autoFocus
              placeholder="Search projects, tasks, customers…"
              className="flex-1 border-none bg-transparent text-[13px] text-on-surface outline-hidden placeholder:text-on-surface-variant dark:bg-transparent rounded-none h-auto px-0 focus-visible:ring-0 focus-visible:border-transparent"
            />
            <span className="rounded-sm border border-outline-variant bg-surface-container-low px-1.5 py-0.5 font-mono text-[10px] text-on-surface-variant">
              esc
            </span>
          </div>
          <AutocompleteStatus className="px-4 text-[11px] text-on-surface-variant">
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
              {hasQuery
                ? error
                  ? "Could not load results. Try again."
                  : `No results for "${debounced}"`
                : null}
            </AutocompleteEmpty>
            <AutocompleteList className="p-1" scrollAreaClassName="min-h-0 flex-1">
              {(group: PaletteGroup) => (
                <AutocompleteGroup key={group.value} items={group.items}>
                  <AutocompleteGroupLabel className="px-3 pb-1 pt-2 text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">
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
                        {item.icon && (
                          <span className="material-symbols-outlined text-base text-on-surface-variant">
                            {item.icon}
                          </span>
                        )}
                        <span className="min-w-0 flex-1 truncate">{item.label}</span>
                        {item.hint && (
                          <span className="shrink-0 text-[11px] text-on-surface-variant">
                            {item.hint}
                          </span>
                        )}
                      </AutocompleteItem>
                    )}
                  </AutocompleteCollection>
                </AutocompleteGroup>
              )}
            </AutocompleteList>
          </div>
        </Autocomplete>
      </div>
    </div>,
    document.body,
  );
}
