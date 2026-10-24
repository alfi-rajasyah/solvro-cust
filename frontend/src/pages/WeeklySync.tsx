import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { MidweekSyncModal } from "@/components/daily-review/MidweekSyncModal";
import { ReflectionSyncModal } from "@/components/daily-review/ReflectionSyncModal";
import { HEALTH_CLASS, WEEKLY_STATUS_BADGE } from "@/components/daily-review/SyncField";
import { Alert, AlertDescription } from "@/components/reui/alert";
import { Badge } from "@/components/reui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { hasPermission, useAuth } from "@/lib/auth";
import { weekNumberLabel } from "@/lib/dailyReviewStats";
import { dateToDay } from "@/lib/dateField";
import { fmtDateTime } from "@/lib/formatDate";
import { formatWeekRange, parseWeekKey, shiftWeek, weekKeyOf } from "@/lib/isoWeek";
import { WEEKLY_HEALTH_LABEL } from "@/lib/labels";
import {
  type DailyReviewCustomer,
  type WeeklyAchievement,
  type WeeklyHighlight,
  useDailyReview,
} from "@/lib/queries";
import {
  buildSyncTable,
  hasManagerDecision,
  hasTabUpdate,
  orderForTab,
  toHtmlTable,
  toTsv,
  type WeeklySyncTab,
} from "@/lib/weeklySyncTable";

const MIDWEEK_GRID_COLS =
  "grid-cols-[180px_88px_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_140px]";
const REFLECTION_GRID_COLS =
  "grid-cols-[180px_88px_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.2fr)_110px]";

const MIDWEEK_HEADER = ["Customer", "Health", "Highlight", "Risk", "Action", "Status"];
const REFLECTION_HEADER = [
  "Customer",
  "Health",
  "Weekly achievement",
  "Outstanding issue",
  "Lesson learned",
  "Next week focus",
  "Need manager decision",
  "Status",
];

/**
 * Default week/tab (docs/archive/plans/weekly-sync-tables.md §4 "Weekly Sync page",
 * D8), computed from today's LOCAL calendar day: Monday opens on last week's
 * Reflection tab (the VP sync reads it); Tuesday–Thursday opens on the
 * current week's Mid-week tab; Friday–Sunday opens on the current week's
 * Reflection tab. `?week=`/`?tab=` in the URL always win over this — see
 * the resolution in `WeeklySync` below.
 */
function computeDefaults(): { week: string; tab: WeeklySyncTab } {
  const today = dateToDay(new Date())!;
  const currentWeek = weekKeyOf(today);
  const weekday = new Date().getDay(); // 0=Sun..6=Sat, local clock — matches `today` above
  if (weekday === 1) {
    return { week: shiftWeek(currentWeek, -1), tab: "reflection" };
  }
  if (weekday >= 2 && weekday <= 4) {
    return { week: currentWeek, tab: "midweek" };
  }
  return { week: currentWeek, tab: "reflection" };
}

// Weekly Sync page (docs/archive/plans/weekly-sync-highlight-rows.md §4, T6, and
// docs/archive/plans/weekly-sync-achievement-rows.md §4, T6): a read-on-Monday table
// view of the same `useDailyReview(week)` payload the Daily Review page
// uses. Both tabs render a customer as one block of grid rows now (D1): a
// customer renders one row per `weeklyUpdate.highlights` entry on Mid-week,
// or one row per `weeklyUpdate.achievements` entry on Reflection (or a
// single dash row when there are none either way), with Customer/Health/
// Status filled on the first row only. A "Copy as table" action (D13) writes
// both an HTML `<table>` and a tab-separated fallback to the clipboard. The
// page owns layout, URL week/tab state, and the click-to-open-modal wiring;
// the two sync modals (T5) are reused as-is.
//
// Each tab lists only the customers with an update for that tab this week
// (`hasTabUpdate`). The rest are counted in a line under the table with a
// "Show them" / "Hide them" toggle — clicking a row is how a sync form opens
// from this page, so a customer without an update must stay reachable.
// "Copy as table" copies the rows on screen.
export function WeeklySync() {
  const { user } = useAuth();
  const canWrite = hasPermission(user, "project:write");
  const [searchParams, setSearchParams] = useSearchParams();

  const defaults = useMemo(() => computeDefaults(), []);

  const weekParam = searchParams.get("week");
  const week = weekParam && parseWeekKey(weekParam) ? weekParam : defaults.week;

  const tabParam = searchParams.get("tab");
  const tab: WeeklySyncTab = tabParam === "midweek" || tabParam === "reflection" ? tabParam : defaults.tab;

  // Missing/invalid `?week=`/`?tab=` resolve to the defaults above for
  // rendering, but the URL is normalized to the resolved values too
  // (replace, so it doesn't add a spurious history entry) — same pattern as
  // DailyReview.tsx's week normalization, extended to `tab`.
  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    let changed = false;
    if (weekParam !== week) {
      next.set("week", week);
      changed = true;
    }
    if (tabParam !== tab) {
      next.set("tab", tab);
      changed = true;
    }
    if (changed) setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [week, tab, weekParam, tabParam]);

  const { data, isLoading, isError, error } = useDailyReview(week);

  const [openRow, setOpenRow] = useState<{ customerId: number; tab: WeeklySyncTab } | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [copyMessage, setCopyMessage] = useState<string | null>(null);
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
    };
  }, []);

  // Prev/Next week and tab clicks push a history entry — same as
  // DailyReview.tsx's Prev/Next — so Back walks through the weeks/tabs the
  // user actually visited. Only the initial normalization effect above
  // (a missing/invalid `?week=`/`?tab=`) uses `replace`.
  function goToWeek(next: string) {
    const params = new URLSearchParams(searchParams);
    params.set("week", next);
    setSearchParams(params);
  }

  function goToTab(next: WeeklySyncTab) {
    const params = new URLSearchParams(searchParams);
    params.set("tab", next);
    setSearchParams(params);
  }

  function showCopyMessage(message: string) {
    if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
    setCopyMessage(message);
    copyTimeoutRef.current = setTimeout(() => setCopyMessage(null), 2000);
  }

  const customers = data?.customers ?? [];
  // Rows without an update for the active tab are hidden unless `showAll`.
  // Pinned rows always carry a managerDecision, so the filter never changes
  // the decision count.
  const withUpdate = useMemo(() => customers.filter((c) => hasTabUpdate(tab, c)), [customers, tab]);
  const noUpdateCount = customers.length - withUpdate.length;
  const shown = showAll ? customers : withUpdate;
  const pinned = useMemo(() => shown.filter(hasManagerDecision), [shown]);
  const rest = useMemo(() => shown.filter((c) => !hasManagerDecision(c)), [shown]);
  const decisionCount = pinned.length;

  async function handleCopy() {
    if (!data) return;
    const ordered = orderForTab(tab, shown);
    const table = buildSyncTable(tab, ordered);
    const html = toHtmlTable(table);
    const tsv = toTsv(table);
    try {
      if (typeof ClipboardItem !== "undefined") {
        await navigator.clipboard.write([
          new ClipboardItem({
            "text/html": new Blob([html], { type: "text/html" }),
            "text/plain": new Blob([tsv], { type: "text/plain" }),
          }),
        ]);
      } else {
        await navigator.clipboard.writeText(tsv);
      }
      showCopyMessage(`Copied ${table.rows.length} ${table.rows.length === 1 ? "row" : "rows"}`);
    } catch {
      showCopyMessage("Copy failed");
    }
  }

  const openCustomer = openRow ? (customers.find((c) => c.id === openRow.customerId) ?? null) : null;

  const gridColsClass = tab === "midweek" ? MIDWEEK_GRID_COLS : REFLECTION_GRID_COLS;
  const tabLabel = tab === "midweek" ? "Mid-week" : "Reflection";
  const isEmpty = data ? data.customers.length === 0 : false;

  function openModalFor(customer: DailyReviewCustomer) {
    setOpenRow({ customerId: customer.id, tab });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-on-surface">Weekly Sync</h1>
          <p className="text-sm text-on-surface-variant">
            One row per highlight and per achievement. Wednesday and Friday tables, read on Monday.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => goToWeek(shiftWeek(week, -1))}
              aria-label="Previous week"
              className="flex h-8 w-8 items-center justify-center rounded-sm border border-outline-variant text-on-surface-variant hover:bg-surface-container focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
            >
              <span aria-hidden="true" className="material-symbols-outlined text-lg">chevron_left</span>
            </button>
            <div className="text-center">
              <div className="text-label-caps uppercase text-on-surface-variant">
                Week {weekNumberLabel(week)}
              </div>
              <div className="text-xs tabular-nums text-on-surface">{formatWeekRange(week)}</div>
            </div>
            <button
              type="button"
              onClick={() => goToWeek(shiftWeek(week, 1))}
              aria-label="Next week"
              className="flex h-8 w-8 items-center justify-center rounded-sm border border-outline-variant text-on-surface-variant hover:bg-surface-container focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
            >
              <span aria-hidden="true" className="material-symbols-outlined text-lg">chevron_right</span>
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleCopy}
              disabled={!data}
              data-testid="weekly-sync-copy"
              className="inline-flex items-center gap-2 rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-1.5 font-display text-xs font-bold text-on-surface hover:bg-surface-container disabled:opacity-50"
            >
              <span aria-hidden="true" className="material-symbols-outlined text-base">content_copy</span>
              Copy as table
            </button>
            <span
              role="status"
              data-testid="weekly-sync-copied"
              className="text-[12px] font-semibold text-on-surface-variant"
            >
              {copyMessage ?? ""}
            </span>
          </div>
        </div>
      </div>

      <nav className="flex gap-6 border-b border-outline-variant">
        <button
          type="button"
          data-testid="weekly-sync-tab-midweek"
          onClick={() => goToTab("midweek")}
          className={[
            "-mb-px border-b-2 px-1 pb-3 font-display text-sm transition-colors",
            tab === "midweek"
              ? "border-primary text-primary"
              : "border-transparent text-on-surface-variant hover:text-on-surface",
          ].join(" ")}
        >
          Mid-week
        </button>
        <button
          type="button"
          data-testid="weekly-sync-tab-reflection"
          onClick={() => goToTab("reflection")}
          className={[
            "-mb-px border-b-2 px-1 pb-3 font-display text-sm transition-colors",
            tab === "reflection"
              ? "border-primary text-primary"
              : "border-transparent text-on-surface-variant hover:text-on-surface",
          ].join(" ")}
        >
          Reflection{decisionCount > 0 ? ` · ${decisionCount} ${decisionCount === 1 ? "decision" : "decisions"}` : ""}
        </button>
      </nav>

      {isLoading && (
        <div className="space-y-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-12 w-full rounded-sm" />
          ))}
        </div>
      )}

      {isError && (
        <Alert variant="destructive">
          <AlertDescription>Could not load the weekly sync: {(error as Error).message}</AlertDescription>
        </Alert>
      )}

      {data && isEmpty && (
        <div className="rounded-sm border border-outline-variant bg-surface-container px-6 py-10 text-center text-sm text-on-surface-variant">
          No customers in your scope this week.
        </div>
      )}

      {data && !isEmpty && (
        <>
          {shown.length > 0 ? (
            <div className="overflow-x-auto rounded-sm border border-outline-variant bg-surface-container-lowest">
              <div className="min-w-[960px]">
                <HeaderRow tab={tab} gridColsClass={gridColsClass} />
                {tab === "midweek"
                  ? shown.map((c) => (
                      <MidweekBlock
                        key={c.id}
                        customer={c}
                        gridColsClass={gridColsClass}
                        clickable={canWrite}
                        onOpen={openModalFor}
                      />
                    ))
                  : (
                      <>
                        {pinned.length > 0 && (
                          <GroupHeader label={`Needs a manager decision · ${pinned.length}`} amber />
                        )}
                        {pinned.map((c) => (
                          <ReflectionBlock
                            key={c.id}
                            customer={c}
                            gridColsClass={gridColsClass}
                            clickable={canWrite}
                            onOpen={openModalFor}
                          />
                        ))}
                        {rest.length > 0 && <GroupHeader label={`Other customers · ${rest.length}`} />}
                        {rest.map((c) => (
                          <ReflectionBlock
                            key={c.id}
                            customer={c}
                            gridColsClass={gridColsClass}
                            clickable={canWrite}
                            onOpen={openModalFor}
                          />
                        ))}
                      </>
                    )}
              </div>
            </div>
          ) : (
            <div
              data-testid="weekly-sync-no-updates"
              className="rounded-sm border border-outline-variant bg-surface-container px-6 py-10 text-center text-sm text-on-surface-variant"
            >
              No {tabLabel} updates this week.
            </div>
          )}

          {noUpdateCount > 0 && (
            <p data-testid="weekly-sync-hidden" className="text-[13px] text-on-surface-variant">
              {noUpdateCount} {noUpdateCount === 1 ? "customer has" : "customers have"} no {tabLabel} update this
              week.{" "}
              <button
                type="button"
                onClick={() => setShowAll((v) => !v)}
                data-testid="weekly-sync-hidden-toggle"
                className="text-[12px] font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
              >
                {showAll ? "Hide them" : "Show them"}
              </button>
            </p>
          )}

          <p className="text-[13px] text-on-surface-variant">
            Click a row to open its {tabLabel} sync form. Copy as table pastes into Google Docs as a real table.
          </p>
        </>
      )}

      {openCustomer && data && openRow?.tab === "midweek" && (
        <MidweekSyncModal customer={openCustomer} week={data.week} onClose={() => setOpenRow(null)} />
      )}
      {openCustomer && data && openRow?.tab === "reflection" && (
        <ReflectionSyncModal customer={openCustomer} week={data.week} onClose={() => setOpenRow(null)} />
      )}
    </div>
  );
}

function HeaderCell({ children }: { children: ReactNode }) {
  return (
    <div className="bg-surface-container px-3 py-2 font-display text-label-caps uppercase text-on-surface-variant">
      {children}
    </div>
  );
}

function HeaderRow({ tab, gridColsClass }: { tab: WeeklySyncTab; gridColsClass: string }) {
  const labels = tab === "midweek" ? MIDWEEK_HEADER : REFLECTION_HEADER;
  return (
    <div className={`grid ${gridColsClass}`}>
      {labels.map((label) => (
        <HeaderCell key={label}>{label}</HeaderCell>
      ))}
    </div>
  );
}

function GroupHeader({ label, amber }: { label: string; amber?: boolean }) {
  return (
    <div
      className={[
        "border-t border-outline-variant bg-surface-container-low px-3 py-1.5 text-label-caps uppercase",
        amber ? "text-chip-amber-text" : "text-on-surface-variant",
      ].join(" ")}
    >
      {label}
    </div>
  );
}

// Border treatment for a table cell: "outline" is the standard 1px divider
// between customer blocks (unchanged), "faint" is the fainter divider used
// between a customer's own highlight rows (surface-container, not
// outline-variant — plan D1/§4), and "none" drops the top border entirely
// for a continuation row's blank Customer/Health/Status cells.
type CellBorder = "outline" | "faint" | "none";

const CELL_BORDER_CLASS: Record<CellBorder, string> = {
  outline: "border-t border-outline-variant",
  faint: "border-t border-surface-container",
  none: "border-t-0",
};

function Cell({ children, border = "outline" }: { children: ReactNode; border?: CellBorder }) {
  return (
    <div
      className={`whitespace-pre-wrap wrap-break-word ${CELL_BORDER_CLASS[border]} px-3 py-2.5 text-sm text-on-surface`}
    >
      {children}
    </div>
  );
}

function TextCell({ value, border }: { value: string | null | undefined; border?: CellBorder }) {
  const trimmed = value?.trim();
  return <Cell border={border}>{trimmed ? value : <span className="text-on-surface-variant">—</span>}</Cell>;
}

/** The Highlight cell: the title, plus a small "has detail" note glyph (native title tooltip) when `detail` is non-empty (plan D3/§4). No highlight → the same "—" fallback as any other text cell. */
function HighlightCell({ highlight, border }: { highlight: WeeklyHighlight | null; border: CellBorder }) {
  if (!highlight) return <TextCell value={undefined} border={border} />;
  const hasDetail = Boolean(highlight.detail?.trim());
  return (
    <Cell border={border}>
      {highlight.title}
      {hasDetail && (
        <span
          role="img"
          className="material-symbols-outlined ml-1.5 align-[-2px] text-[14px] text-on-surface-variant"
          title={highlight.detail ?? undefined}
          aria-label="Has detail"
        >
          notes
        </span>
      )}
    </Cell>
  );
}

interface BlockWrapperProps {
  role: "button" | undefined;
  tabIndex: number | undefined;
  onClick: (() => void) | undefined;
  onKeyDown: ((e: KeyboardEvent<HTMLDivElement>) => void) | undefined;
  className: string | undefined;
  "data-testid": string;
}

/**
 * Shared click/keyboard wrapper props for a customer block on either tab
 * (Mid-week's `MidweekBlock`, Reflection's `ReflectionBlock`) — same
 * `role="button"`/`tabIndex`/Enter-Space contract and `data-testid`
 * convention (plan D1/§4), spread onto each block's outer `div` so it stays
 * a single direct child of the table container the e2e `groupContainingRow`
 * walk relies on.
 */
function blockWrapperProps(
  customer: DailyReviewCustomer,
  clickable: boolean,
  onOpen: (customer: DailyReviewCustomer) => void,
): BlockWrapperProps {
  function handleClick() {
    onOpen(customer);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onOpen(customer);
    }
  }

  return {
    role: clickable ? "button" : undefined,
    tabIndex: clickable ? 0 : undefined,
    onClick: clickable ? handleClick : undefined,
    onKeyDown: clickable ? handleKeyDown : undefined,
    className: clickable
      ? "cursor-pointer hover:bg-surface-container-low focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
      : undefined,
    "data-testid": `weekly-sync-row-${customer.id}`,
  };
}

interface MidweekBlockProps {
  customer: DailyReviewCustomer;
  gridColsClass: string;
  clickable: boolean;
  onOpen: (customer: DailyReviewCustomer) => void;
}

/**
 * A Mid-week customer block (plan D1/§4): one wrapper `div` — click/keyboard
 * target and `data-testid` live here, via `blockWrapperProps` — containing
 * one `grid ${gridColsClass}` row per highlight (or a single row when there
 * are none, matching the old dash-row behavior). Customer/Health/Status
 * render on the first row only; continuation rows leave those three cells
 * blank with no top border, while the Highlight/Risk/Action cells keep a
 * (fainter) divider between highlights.
 */
function MidweekBlock({ customer, gridColsClass, clickable, onOpen }: MidweekBlockProps) {
  const update = customer.weeklyUpdate;
  const health = update?.health ?? null;
  const category = update?.category?.trim() ? update.category : null;
  const highlights = update?.highlights ?? [];
  const rows: Array<WeeklyHighlight | null> = highlights.length > 0 ? highlights : [null];

  return (
    <div {...blockWrapperProps(customer, clickable, onOpen)}>
      {rows.map((highlight, index) => {
        const isFirst = index === 0;
        const rowBorder: CellBorder = isFirst ? "outline" : "faint";
        return (
          <div key={highlight?.id ?? `dash-${index}`} className={`grid ${gridColsClass}`}>
            <Cell border={isFirst ? "outline" : "none"}>
              {isFirst && (
                <>
                  <div className="font-semibold text-on-surface">{customer.name}</div>
                  <div className="mt-0.5 text-[12px] text-on-surface-variant">{category ?? "—"}</div>
                </>
              )}
            </Cell>
            <Cell border={isFirst ? "outline" : "none"}>
              {isFirst &&
                (health ? (
                  <span className={`rounded-full px-2 py-0.5 text-meta font-semibold ${HEALTH_CLASS[health]}`}>
                    {WEEKLY_HEALTH_LABEL[health]}
                  </span>
                ) : (
                  <span className="text-on-surface-variant">—</span>
                ))}
            </Cell>
            <HighlightCell highlight={highlight} border={rowBorder} />
            <TextCell value={highlight?.risk} border={rowBorder} />
            <TextCell value={highlight?.action} border={rowBorder} />
            <Cell border={isFirst ? "outline" : "none"}>
              {isFirst &&
                (update?.midweekSavedAt ? (
                  `Saved ${fmtDateTime(update.midweekSavedAt)}`
                ) : (
                  <span className="text-on-surface-variant">Not filled</span>
                ))}
            </Cell>
          </div>
        );
      })}
    </div>
  );
}

/** The achievement title cell: the title, plus the same "has detail" note glyph as `HighlightCell` (native title tooltip), shown when `detail` is non-empty after trim (plan D3/§4). No achievement → the same "—" fallback as any other text cell. */
function AchievementTitleCell({
  achievement,
  border,
}: {
  achievement: WeeklyAchievement | null;
  border: CellBorder;
}) {
  if (!achievement) return <TextCell value={undefined} border={border} />;
  const hasDetail = Boolean(achievement.detail?.trim());
  return (
    <Cell border={border}>
      {achievement.title}
      {hasDetail && (
        <span
          role="img"
          className="material-symbols-outlined ml-1.5 align-[-2px] text-[14px] text-on-surface-variant"
          title={achievement.detail ?? undefined}
          aria-label="Has detail"
        >
          notes
        </span>
      )}
    </Cell>
  );
}

interface ReflectionBlockProps {
  customer: DailyReviewCustomer;
  gridColsClass: string;
  clickable: boolean;
  onOpen: (customer: DailyReviewCustomer) => void;
}

/**
 * A Reflection customer block (plan D1/D2/§4, mirrors `MidweekBlock`): one
 * wrapper `div` — click/keyboard target and `data-testid`, via
 * `blockWrapperProps` — containing one `grid ${gridColsClass}` row per
 * achievement (or a single dash row when there are none). Customer/Health/
 * Status render on the first row only; continuation rows leave those three
 * cells blank with no top border, while the five text cells keep a
 * (fainter) divider between achievements. Pinning (D10) is decided by the
 * caller via `hasManagerDecision`, which reads these same achievement rows.
 */
function ReflectionBlock({ customer, gridColsClass, clickable, onOpen }: ReflectionBlockProps) {
  const update = customer.weeklyUpdate;
  const health = update?.health ?? null;
  const category = update?.category?.trim() ? update.category : null;
  const achievements = update?.achievements ?? [];
  const rows: Array<WeeklyAchievement | null> = achievements.length > 0 ? achievements : [null];

  return (
    <div {...blockWrapperProps(customer, clickable, onOpen)}>
      {rows.map((achievement, index) => {
        const isFirst = index === 0;
        const rowBorder: CellBorder = isFirst ? "outline" : "faint";
        return (
          <div key={achievement?.id ?? `dash-${index}`} className={`grid ${gridColsClass}`}>
            <Cell border={isFirst ? "outline" : "none"}>
              {isFirst && (
                <>
                  <div className="font-semibold text-on-surface">{customer.name}</div>
                  <div className="mt-0.5 text-[12px] text-on-surface-variant">{category ?? "—"}</div>
                </>
              )}
            </Cell>
            <Cell border={isFirst ? "outline" : "none"}>
              {isFirst &&
                (health ? (
                  <span className={`rounded-full px-2 py-0.5 text-meta font-semibold ${HEALTH_CLASS[health]}`}>
                    {WEEKLY_HEALTH_LABEL[health]}
                  </span>
                ) : (
                  <span className="text-on-surface-variant">—</span>
                ))}
            </Cell>
            <AchievementTitleCell achievement={achievement} border={rowBorder} />
            <TextCell value={achievement?.outstandingIssue} border={rowBorder} />
            <TextCell value={achievement?.lessonLearned} border={rowBorder} />
            <TextCell value={achievement?.nextWeekFocus} border={rowBorder} />
            <TextCell value={achievement?.managerDecision} border={rowBorder} />
            <Cell border={isFirst ? "outline" : "none"}>
              {isFirst &&
                (() => {
                  const badge = WEEKLY_STATUS_BADGE[update?.status ?? "NOT_STARTED"];
                  return <Badge variant={badge.variant}>{badge.label}</Badge>;
                })()}
            </Cell>
          </div>
        );
      })}
    </div>
  );
}
