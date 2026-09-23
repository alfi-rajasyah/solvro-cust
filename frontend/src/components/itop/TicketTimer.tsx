// Ticket panel's "Time" block (Task 7.1, docs/archive/plans/
// itop-integration.md's mockup "6 · A ticket panel": `01:12:34 Stop · 2.5 h
// this week on this ticket`). Rendered by `TicketPanel.tsx` below the log
// block. All state/mutation logic lives in `useTicketTimer` — this
// component is presentation plus the two inline confirms the dispatch calls
// for: a sub-minute Stop ("Less than a minute — discard instead?") and
// starting here while another ticket's timer runs ("Stop the timer on
// R-004512 first?").
import { useState } from "react";
import { Link } from "react-router-dom";
import { formatElapsed, useTicketTimer, type TimerTicketRef } from "./useTicketTimer";

const BUTTON_CLASS =
  "rounded-sm border border-outline-variant px-3 py-1 font-display text-[12px] font-bold uppercase tracking-wider text-on-surface hover:border-primary hover:text-primary disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30";

const LINK_BUTTON_CLASS =
  "font-display text-[11px] font-bold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30";

const LABEL_CLASS =
  "mb-1.5 font-display text-[10px] font-bold uppercase tracking-wider text-on-surface-variant";

// `myMinutesThisWeek` is legitimately `undefined` for a beat after an
// action/log write (see `ItopTicketDetail`'s own doc comment in
// lib/queries.ts) and defensively guarded against non-finite values beyond
// that (a stale cache entry, an e2e mock lagging the field) — either way
// this reads "0.0 h", never "NaN h" or "undefined h".
function hoursThisWeekLabel(minutes: number | undefined): string {
  const safe = Number.isFinite(minutes) ? (minutes as number) : 0;
  return `${(safe / 60).toFixed(1)} h this week on this ticket`;
}

export function TicketTimer({
  ticket,
  myMinutesThisWeek,
  canAct,
}: {
  ticket: TimerTicketRef;
  /** `ItopTicketDetail.myMinutesThisWeek` is optional (fix round, phase
   * review) — only the plain GET computes it, not the write endpoints'
   * `core/get` echo — so this can legitimately be `undefined` for a beat;
   * `hoursThisWeekLabel`'s own `Number.isFinite` guard already treats that
   * the same as 0. */
  myMinutesThisWeek: number | undefined;
  /** `TicketPanel.tsx`'s own `actionsEnabled && tokenSet` gate — a viewer
   * who can't act still sees the "this week" figure, just no Start/Stop. */
  canAct: boolean;
}) {
  const timer = useTicketTimer(ticket);
  // Local-only UI state for the two inline confirms — neither survives past
  // the action it confirms, so there's no need to route them through the
  // hook itself.
  const [confirmingShortStop, setConfirmingShortStop] = useState(false);
  const [confirmingSwitch, setConfirmingSwitch] = useState(false);

  const weekLabel = hoursThisWeekLabel(myMinutesThisWeek);

  if (!canAct) {
    return (
      <div>
        <p className={LABEL_CLASS}>Time</p>
        <p className="text-[13px] text-on-surface-variant">{weekLabel}</p>
      </div>
    );
  }

  function handleStopClick() {
    if (timer.elapsedSeconds < 60) {
      setConfirmingShortStop(true);
      return;
    }
    timer.stop();
  }

  return (
    <div>
      <p className={LABEL_CLASS}>Time</p>

      {timer.status === "idle" && (
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={timer.start} className={BUTTON_CLASS}>
            Start timer
          </button>
          <span className="text-[13px] text-on-surface-variant">{weekLabel}</span>
        </div>
      )}

      {timer.status === "running-here" && (
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-3">
            <span
              data-testid="itop-timer-elapsed"
              className="font-mono text-lg tabular-nums text-on-surface"
            >
              {formatElapsed(timer.elapsedSeconds)}
            </span>
            {timer.expired ? (
              // Past the backend's 24h ceiling on a loggable entry (fix
              // round, phase review) — Stop would only 400, so it isn't
              // offered at all here, only Discard.
              <div className="flex flex-wrap items-center gap-2 text-[12px] text-error">
                <span>Timer expired — discard</span>
                <button type="button" onClick={timer.discard} className={LINK_BUTTON_CLASS}>
                  Discard
                </button>
              </div>
            ) : !confirmingShortStop ? (
              <>
                <button
                  type="button"
                  onClick={handleStopClick}
                  disabled={timer.isStopping}
                  className={BUTTON_CLASS}
                >
                  Stop
                </button>
                <button
                  type="button"
                  onClick={timer.discard}
                  disabled={timer.isStopping}
                  className={LINK_BUTTON_CLASS}
                >
                  Discard
                </button>
              </>
            ) : (
              // Under the backend's 1-minute floor (fix round, phase
              // review): the API rejects a sub-minute entry outright, so
              // this offers Discard or backing out — never a "log it
              // anyway" path that would just 400.
              <div className="flex flex-wrap items-center gap-2 text-[12px] text-on-surface-variant">
                <span>Less than a minute — discard instead?</span>
                <button
                  type="button"
                  onClick={() => {
                    setConfirmingShortStop(false);
                    timer.discard();
                  }}
                  className={LINK_BUTTON_CLASS}
                >
                  Discard
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingShortStop(false)}
                  className="text-on-surface-variant underline hover:text-on-surface"
                >
                  Keep running
                </button>
              </div>
            )}
            <span className="text-[13px] text-on-surface-variant">{weekLabel}</span>
          </div>
        </div>
      )}

      {timer.status === "running-elsewhere" && timer.other && (
        <div className="space-y-1.5 text-[13px] text-on-surface-variant">
          <div className="flex flex-wrap items-center gap-2">
            <span>
              Timer running on{" "}
              <Link
                to={`/customers/${timer.other.customerId}?tab=tickets&ticket=${timer.other.ticketId}`}
                className="font-semibold text-primary hover:underline"
              >
                {timer.other.ref}
              </Link>
            </span>
            {!confirmingSwitch && (
              <button
                type="button"
                onClick={() => setConfirmingSwitch(true)}
                className={LINK_BUTTON_CLASS}
              >
                Start timer
              </button>
            )}
          </div>
          {confirmingSwitch && (
            <div className="flex flex-wrap items-center gap-2 text-[12px]">
              <span>Stop the timer on {timer.other.ref} first?</span>
              <button
                type="button"
                onClick={() => {
                  setConfirmingSwitch(false);
                  timer.stopOtherAndStart();
                }}
                disabled={timer.isStopping}
                className={LINK_BUTTON_CLASS}
              >
                Stop and start here
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirmingSwitch(false);
                  timer.discardOtherAndStart();
                }}
                className={LINK_BUTTON_CLASS}
              >
                Discard and start here
              </button>
              <button
                type="button"
                onClick={() => setConfirmingSwitch(false)}
                className="text-on-surface-variant underline hover:text-on-surface"
              >
                Cancel
              </button>
            </div>
          )}
          <p>{weekLabel}</p>
        </div>
      )}

      {timer.stopError && <p className="mt-1.5 text-[12px] text-error">{timer.stopError}</p>}
      {timer.staleNotice && (
        <p className="mt-1.5 text-[12px] text-on-surface-variant">{timer.staleNotice}</p>
      )}
    </div>
  );
}
