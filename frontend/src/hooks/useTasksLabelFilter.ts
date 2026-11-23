import { useCallback, useEffect, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { useLabelNames } from "@/lib/queries";
import { parseLabelNames, pruneLabelNames, writeLabelNames } from "@/lib/tasksPageFilters";

/**
 * The /tasks Label filter, held in the URL as repeated `?label=` names so it
 * survives a refresh and a shared link. Writes replace the history entry, like
 * the project list filters (hooks/useTaskFilters.ts).
 *
 * Once the label-name list has loaded and is fresh, a name in the URL with no
 * case-insensitive match is dropped (replace navigation), so an old link or a
 * label deleted everywhere cannot leave the list empty behind a hidden filter.
 * `options` is the list the picker offers.
 */
export function useTasksLabelFilter(enabled: boolean) {
  const [searchParams, setSearchParams] = useSearchParams();
  const search = searchParams.toString();
  const names = useMemo(() => parseLabelNames(new URLSearchParams(search)), [search]);

  const setNames = useCallback(
    (next: string[]) => {
      setSearchParams((prev) => writeLabelNames(prev, next), { replace: true });
    },
    [setSearchParams],
  );

  // Only a settled, fresh list counts: not while loading, refetching or failed.
  const query = useLabelNames(enabled);
  const known =
    query.isSuccess && !query.isFetching ? query.data.map((l) => l.name) : undefined;
  const knownKey = known?.join("\u0000");

  useEffect(() => {
    if (!known) return;
    const kept = pruneLabelNames(names, known);
    if (kept) setNames(kept);
    // `known` is rebuilt each render; its key carries the content.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [names, knownKey, setNames]);

  return { names, setNames, options: query.data };
}
