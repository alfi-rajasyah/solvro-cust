import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import type { Filter } from "@/components/reui/filters";
import { TASK_CATEGORY_GROUP_LABEL } from "@/lib/labels";
import { useCustomers, useLabelNames, useTaskStatuses, useUsers } from "@/lib/queries";
import { statusFilterOptions } from "@/lib/taskStatuses";
import {
  chipValuesKey,
  chipValuesOfChips,
  chipsFromValues,
  parseChipValues,
  pruneChipValues,
  writeChipValues,
  type KnownChipOptions,
} from "@/lib/tasksPageFilters";

/**
 * The /tasks Filter chips (Status, Priority, Assignee, Customer, Label), held
 * in the URL so they survive a refresh and a shared link (param names in
 * lib/tasksPageFilters.ts). The chip list the Filters component edits is local
 * state kept in step with the URL: a pick writes the URL (replace navigation,
 * like hooks/useTaskFilters.ts), and a URL change from outside the chips
 * (Back/Forward, Reset, the prune below) rebuilds the chips from it.
 *
 * Once an option list has loaded and is fresh, a URL value that list no longer
 * offers (deleted user or customer, unknown status, a label name no project
 * has) is dropped, so an old link cannot leave the list empty behind a hidden
 * filter. A list that is loading, refetching, failed or not permitted never
 * prunes. Returns the option lists too, so the page reads each query once.
 */
export function useTasksChipFilters({ canRead, canReadCustomers }: { canRead: boolean; canReadCustomers: boolean }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const search = searchParams.toString();
  const urlValues = useMemo(() => parseChipValues(new URLSearchParams(search)), [search]);
  // Without customer:read the Customer field is not offered, so no chip shows
  // `?customer=` and the customers list never loads to prune it. Treat it as
  // absent (and drop it from the URL below) rather than filter invisibly.
  const customerHidden = !canReadCustomers && urlValues.customerId.length > 0;
  const values = useMemo(
    () => (customerHidden ? { ...urlValues, customerId: [] } : urlValues),
    [urlValues, customerHidden],
  );
  const key = chipValuesKey(values);

  const [chips, setChips] = useState<Filter<string>[]>(() => chipsFromValues(values, []));
  // The URL changed from outside the chips: rebuild them from it. A change the
  // chips themselves made records its key in `onChange`, so it is not echoed.
  const [seenKey, setSeenKey] = useState(key);
  if (seenKey !== key) {
    setSeenKey(key);
    setChips((prev) => chipsFromValues(values, prev));
  }

  const onChange = (next: Filter<string>[]) => {
    setChips(next);
    const nextValues = chipValuesOfChips(next);
    const nextKey = chipValuesKey(nextValues);
    if (nextKey !== key) {
      setSeenKey(nextKey);
      setSearchParams((prev) => writeChipValues(prev, nextValues), { replace: true });
    }
  };

  /** Drops every chip, including empty ones; the caller clears the URL. */
  const clearChips = useCallback(() => setChips([]), []);

  const users = useUsers(canRead);
  const customers = useCustomers(canRead && canReadCustomers);
  const statuses = useTaskStatuses();
  const labelNames = useLabelNames(canRead);

  const fresh = (q: { isSuccess: boolean; isFetching: boolean }) => q.isSuccess && !q.isFetching;
  const known: KnownChipOptions = {};
  if (users.data && fresh(users)) known.assignedToId = users.data.map((u) => String(u.id));
  if (customers.data && fresh(customers)) known.customerId = customers.data.map((c) => String(c.id));
  if (statuses.data && fresh(statuses)) {
    known.status = statusFilterOptions(statuses.data, TASK_CATEGORY_GROUP_LABEL).map((o) => o.value);
  }
  if (labelNames.data && fresh(labelNames)) known.label = labelNames.data.map((l) => l.name);
  const knownKey = JSON.stringify(known);

  useEffect(() => {
    const kept = pruneChipValues(values, known) ?? (customerHidden ? values : null);
    if (kept) setSearchParams((prev) => writeChipValues(prev, kept), { replace: true });
    // `known` is rebuilt each render; its key carries the content.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, knownKey, customerHidden, setSearchParams]);

  return {
    values,
    chips,
    onChange,
    clearChips,
    users: users.data,
    customers: customers.data,
    statusDefs: statuses.data,
    labelNames: labelNames.data,
  };
}
