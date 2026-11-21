import { useCallback, useEffect, useMemo } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { useProjectEpics, useProjectLabels } from "@/lib/queries";
import { parseTaskFilters, stalePrunePatch, writeTaskFilters, type TaskFilters } from "@/lib/taskFilters";

/**
 * The project's task filters, held in the URL (`?epicFilter=`, `?labels=`,
 * `?assignee=`, `?priority=`) so they survive a tab switch, a refresh and a
 * shared link. Writes replace the history entry, like the `?task=` panel.
 *
 * Once the project's epics and labels have loaded, an epic or label id in the
 * URL that no longer exists is dropped (replace navigation), so a deleted epic
 * or an old shared link cannot leave the views empty behind a hidden filter.
 */
export function useTaskFilters() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { id } = useParams<{ id: string }>();
  const projectId = id && /^\d+$/.test(id) ? Number(id) : null;
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

  // Only a settled, fresh list counts: not while loading, refetching or failed.
  const epicsQuery = useProjectEpics(projectId);
  const labelsQuery = useProjectLabels(projectId);
  const epicIds =
    epicsQuery.isSuccess && !epicsQuery.isFetching ? epicsQuery.data.map((e) => e.id) : undefined;
  const labelIds =
    labelsQuery.isSuccess && !labelsQuery.isFetching ? labelsQuery.data.map((l) => l.id) : undefined;
  const epicKey = epicIds?.join(",");
  const labelKey = labelIds?.join(",");

  useEffect(() => {
    const patch = stalePrunePatch(filters, { epicIds, labelIds });
    if (patch) setFilters(patch);
    // epicIds/labelIds are rebuilt each render; their keys carry the content.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, epicKey, labelKey, setFilters]);

  return { filters, setFilters };
}
