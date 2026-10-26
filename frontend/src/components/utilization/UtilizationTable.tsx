// The Utilization page's hours matrix (Task 3.3): Customer/TAM × Mon..Sun +
// Total + Tickets, one grid-templated row per entry plus a bold Total
// footer row — same "container `min-w-[...]`, one `grid ${cols}` div per
// row" structure as WeeklySync.tsx's own table (no shared component exists
// for it; both are small enough to stay self-contained). No cell here is
// ever editable — see the footer note in Utilization.tsx.
//
// Below md the same markup reflows into one card per row: name and Total on
// the first line, the seven days as a labelled strip, tickets underneath
// (the header row is hidden and each day cell carries its own short label).
import type { ReactNode } from "react";
import type { UtilizationResponse, UtilizationRow, UtilizationScope } from "@/lib/queries";
import { dayHeaders, formatHours, isOutsideSyncWindow } from "./utilizationPresentation";

const MATRIX_GRID_COLS =
  "grid-cols-7 md:grid-cols-[180px_repeat(7,60px)_72px_minmax(160px,1fr)]";

// The mockup's row ("R-004512 · R-004530 · +2") shows 2 refs before folding
// the rest into a "+N" overflow — the backend already caps `ticketRefs` at
// 6 distinct refs, most-hours-first, so this is a second, tighter cap for
// what actually fits a table cell.
const MAX_VISIBLE_REFS = 2;

function HeaderCell({ children, align = "left" }: { children: ReactNode; align?: "left" | "right" }) {
  return (
    <div
      className={`bg-surface-container px-3 py-2 font-display text-label-caps uppercase text-on-surface-variant ${
        align === "right" ? "text-right" : ""
      }`}
    >
      {children}
    </div>
  );
}

function Cell({
  children,
  align = "left",
  bold = false,
  label,
  className = "",
}: {
  children: ReactNode;
  align?: "left" | "right";
  bold?: boolean;
  /** Short column name shown above the value below md, where the header row is hidden. */
  label?: string;
  className?: string;
}) {
  return (
    <div
      className={[
        "border-outline-variant px-1 py-1.5 text-sm text-on-surface md:border-t md:px-3 md:py-2.5",
        align === "right" ? "text-center font-mono tabular-nums md:text-right" : "",
        bold ? "font-bold" : "",
        className,
      ].join(" ")}
    >
      {label && (
        <span className="block font-display text-label-caps font-normal uppercase text-on-surface-variant md:hidden">
          {label}
        </span>
      )}
      {children}
    </div>
  );
}

// Phone card layout: the first cell (name) and Total share the top line, the
// tickets cell spans the bottom; md and up ignore all of it.
const NAME_CELL = "max-md:order-1 max-md:col-span-5 max-md:px-3 max-md:pt-3 max-md:text-left";
const TOTAL_CELL = "max-md:order-2 max-md:col-span-2 max-md:pt-3 max-md:pr-3";
const TICKETS_CELL = "max-md:order-4 max-md:col-span-7 max-md:px-3 max-md:pb-3";
const ROW_CARD = "max-md:border-t max-md:border-outline-variant";

function TicketRefs({ refs }: { refs: string[] }) {
  if (refs.length === 0) {
    return <span className="text-on-surface-variant">–</span>;
  }
  const visible = refs.slice(0, MAX_VISIBLE_REFS);
  const overflow = refs.length - visible.length;
  return (
    <span className="font-mono text-[12px] text-on-surface-variant">
      {visible.join(" · ")}
      {overflow > 0 ? ` · +${overflow}` : ""}
    </span>
  );
}

function DataRow({
  row,
  gridCols,
  headers,
}: {
  row: UtilizationRow;
  gridCols: string;
  headers: string[];
}) {
  return (
    <div
      className={`grid ${gridCols} ${ROW_CARD}`}
      data-testid="utilization-row"
      data-row-kind={row.kind}
    >
      <Cell className={NAME_CELL}>
        <span className={row.kind === "none" ? "text-on-surface-variant" : "font-medium"}>{row.label}</span>
      </Cell>
      {row.hours.map((h, i) => (
        <Cell key={i} align="right" label={headers[i]} className="max-md:order-3">
          {formatHours(h)}
        </Cell>
      ))}
      <Cell align="right" bold label="Total" className={TOTAL_CELL}>
        {formatHours(row.total)}
      </Cell>
      <Cell className={TICKETS_CELL}>
        <TicketRefs refs={row.ticketRefs} />
      </Cell>
    </div>
  );
}

export function UtilizationTable({
  data,
  scope,
}: {
  data: UtilizationResponse;
  scope: UtilizationScope;
}) {
  const labelHeader = scope === "tam" ? "TAM" : "Customer";
  const headers = dayHeaders(data.week.days);
  // The sync only pulls the last 8 weeks (Task 3.1) — an empty matrix for a
  // week older than that means "never synced", not "nobody logged time",
  // so it gets its own note rather than the ambiguous "No time logged".
  const outsideSyncWindow = isOutsideSyncWindow(data.week.start, new Date());

  return (
    <div>
      <div className="overflow-x-auto rounded-sm border border-outline-variant bg-surface-container-lowest">
        <div className="md:min-w-[820px]">
          <div className={`grid ${MATRIX_GRID_COLS} max-md:hidden`}>
            <HeaderCell>{labelHeader}</HeaderCell>
            {headers.map((h) => (
              <HeaderCell key={h} align="right">
                {h}
              </HeaderCell>
            ))}
            <HeaderCell align="right">Total</HeaderCell>
            <HeaderCell>Tickets</HeaderCell>
          </div>

          {data.rows.length === 0 ? (
            <div
              data-testid="utilization-no-rows"
              className="border-t border-outline-variant px-6 py-10 text-center text-sm text-on-surface-variant"
            >
              {outsideSyncWindow
                ? "This week is outside the synced window (last 8 weeks)."
                : "No time logged this week."}
            </div>
          ) : (
            <>
              {data.rows.map((row) => (
                <DataRow key={row.key} row={row} gridCols={MATRIX_GRID_COLS} headers={headers} />
              ))}
              <div className={`grid ${MATRIX_GRID_COLS} ${ROW_CARD}`} data-testid="utilization-total-row">
                <Cell bold className={NAME_CELL}>
                  Total
                </Cell>
                {data.totals.hours.map((h, i) => (
                  <Cell key={i} align="right" bold label={headers[i]} className="max-md:order-3">
                    {formatHours(h)}
                  </Cell>
                ))}
                <Cell align="right" bold label="Total" className={TOTAL_CELL}>
                  {formatHours(data.totals.total)}
                </Cell>
                <Cell className="max-md:hidden"> </Cell>
              </div>
            </>
          )}
        </div>
      </div>

      {data.truncated && (
        <p data-testid="utilization-truncated" className="mt-1.5 text-[12px] text-on-surface-variant">
          Showing the first 10 000 entries of this week.
        </p>
      )}
    </div>
  );
}
