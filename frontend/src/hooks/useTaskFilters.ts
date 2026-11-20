import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { parseTaskFilters, writeTaskFilters, type TaskFilters } from "@/lib/taskFilters";

/**
 * The project's task filters, held in the URL (`?epicFilter=`, `?labels=`,
 * `?assignee=`, `?priority=`) so they survive a tab switch, a refresh and a
 * shared link. Writes replace the history entry, like the `?task=` panel.
 */
export function useTaskFilters() {
  const [searchParams, setSearchParams] = useSearchParams();
  const search = searchParams.toString();
  const filters = useMemo(() => parseTaskFilters(new URLSearchParams(search)), [search]);

  const setFilters = useCallback(
    (patch: Partial<TaskFilters>) => {
      setSearchParams(
        (prev) => writeTaskFilters(prev, { ...parseTaskFilters(prev), ...patch }),
        { replace: true },
      );
    },
    [setSearchParams],
  );

  return { filters, setFilters };
}
