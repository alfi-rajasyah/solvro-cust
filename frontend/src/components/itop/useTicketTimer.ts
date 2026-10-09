// Ticket timer (Task 7.1, docs/archive/plans/itop-integration.md): one
// running timer per user, persisted in `localStorage["solvro.itopTimer.
// <userId>"]` so it survives a reload/navigation. User-scoped (fix round,
// phase review) — a shared browser/profile must never let one TAM's running
// timer bleed into another TAM's session; `readStoredTimer` rejects a
// payload whose `userId` doesn't match the caller's, and `logout()`
// (lib/auth.tsx) clears every `solvro.itopTimer.*` key so the next login on
// this browser starts clean regardless of who it is.
//
// `TicketTimer.tsx` (the ticket panel's "Time" block) and `TopBar.tsx` (the
// compact header pill) are the two consumers — the panel needs the full
// start/stop/discard surface for whichever ticket it currently has open, the
// header only needs a read-only "is a timer running anywhere, for how long"
// glance, so they get two different hooks off the same underlying storage
// helpers.
//
// No optimistic writes for the ticket's OWN fields (plan decision, same as
// every other iTop write in this app): `stop()`/`stopOtherAndStart()` only
// clear the stored timer once `useLogTicketTimeFor`'s mutation actually
// succeeds — a refusal leaves the clock running and surfaces iTop's message,
// exactly like `TicketPanel.tsx`'s own action/log mutations.
import { useEffect, useState } from "react";
import { ApiError } from "@/lib/api";
import { hasPermission, useAuth } from "@/lib/auth";
import { isStaleTimeLog, useLogTicketTimeFor } from "@/lib/queries";

const STORAGE_PREFIX = "solvro.itopTimer";

/** The backend rejects a `TimeSpent` entry longer than this (routes/itop.ts's
 * `MAX_TIME_ENTRY_MS`) — a stored timer older than this is unloggable, not
 * just long-running, so the UI must offer only Discard, never Stop. */
const MAX_ENTRY_SECONDS = 24 * 60 * 60;

function storageKey(userId: number): string {
  return `${STORAGE_PREFIX}.${userId}`;
}

export interface StoredTicketTimer {
  /** The Solvro user this timer belongs to — see the module comment above
   * for why every read checks this against the CURRENT user. */
  userId: number;
  ticketId: number;
  customerId: number;
  ref: string;
  /** ISO instant the timer was started. */
  startedAt: string;
}

export interface TimerTicketRef {
  id: number;
  customerId: number;
  ref: string;
}

export type TicketTimerStatus = "idle" | "running-here" | "running-elsewhere";

function safeReadRaw(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    // Storage blocked (private mode, hardened browser settings) — treat as
    // "no timer stored" rather than throwing out of a render.
    return null;
  }
}

function safeWrite(key: string, timer: StoredTicketTimer | null): void {
  if (typeof window === "undefined") return;
  try {
    if (timer) window.localStorage.setItem(key, JSON.stringify(timer));
    else window.localStorage.removeItem(key);
  } catch {
    // Same rationale as safeReadRaw: the timer just won't persist across a
    // reload for this browser — nothing to surface mid-flow over it.
  }
  notifyTimerChanged();
}

/** Same-tab change notification: `storage` only fires in OTHER tabs, so every
 * write dispatches this too, and every reader listens to both. */
const TIMER_CHANGED_EVENT = "solvro:itop-timer";

function notifyTimerChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(TIMER_CHANGED_EVENT));
}

/** The timer a Stop/Stop-other is closing — identified by ticket + start instant. */
export interface ClosingTimer {
  ticketId: number;
  startedAt: string;
}

/**
 * Compare-and-clear: a Stop (or Stop-other) request resolves arbitrarily
 * later, possibly after the panel unmounted and a newer timer was started.
 * Only when the stored timer is still the very one that was closed may the
 * resolution clear/replace it — otherwise it would wipe a newer timer, or
 * resurrect state a Discard/other tab already settled. Pure, so it is
 * unit-testable without a DOM.
 */
export function shouldApplyAfterClose(current: StoredTicketTimer | null, closed: ClosingTimer): boolean {
  return current !== null && current.ticketId === closed.ticketId && current.startedAt === closed.startedAt;
}

/** Module-level (survives a panel unmount and remount): `${userId}:${startedAt}` of every Stop whose request is still in flight. */
const IN_FLIGHT_STOPS = new Set<string>();

export function inFlightStopKey(userId: number, startedAt: string): string {
  return `${userId}:${startedAt}`;
}

/** Marks `key` as in flight; false (a no-op for the caller) when it already is — a second Stop on the same timer must not log it twice. Takes the set so tests can use their own. */
export function claimInFlightStop(key: string, inFlight: Set<string> = IN_FLIGHT_STOPS): boolean {
  if (inFlight.has(key)) return false;
  inFlight.add(key);
  return true;
}

function releaseInFlightStop(key: string): void {
  IN_FLIGHT_STOPS.delete(key);
  // Mounted readers re-render off this (isStopping) — including after a failure, when no write happened.
  notifyTimerChanged();
}

/**
 * Pure validation for the persisted shape — no localStorage access, so this
 * is unit-testable without a DOM/jsdom `localStorage` shim. `null` for
 * anything malformed: unparsable JSON, missing/mistyped fields, an empty
 * ref, an unparsable `startedAt`, a `startedAt` far enough in the future to
 * be corrupt data (clock skew) rather than a real timer, OR a `userId` that
 * doesn't match `expectedUserId` — a payload left behind by a different
 * account on a shared browser is never adopted as "this user's timer".
 */
export function readStoredTimer(raw: string | null, expectedUserId: number): StoredTicketTimer | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const { userId, ticketId, customerId, ref, startedAt } = parsed as Record<string, unknown>;
  if (typeof userId !== "number" || !Number.isFinite(userId)) return null;
  if (userId !== expectedUserId) return null;
  if (typeof ticketId !== "number" || !Number.isFinite(ticketId)) return null;
  if (typeof customerId !== "number" || !Number.isFinite(customerId)) return null;
  if (typeof ref !== "string" || ref.trim() === "") return null;
  if (typeof startedAt !== "string") return null;
  const startedMs = new Date(startedAt).getTime();
  if (Number.isNaN(startedMs)) return null;
  if (startedMs > Date.now() + 5_000) return null;
  return { userId, ticketId, customerId, ref, startedAt };
}

/**
 * "01:12:34" — always two digits per unit; hours grow past two digits
 * rather than wrapping (a timer left running 100+ hours is a bug report,
 * not a display bug). Negative/NaN/non-finite input clamps to "00:00:00".
 */
export function formatElapsed(totalSeconds: number): string {
  const s = Number.isFinite(totalSeconds) ? Math.max(0, Math.floor(totalSeconds)) : 0;
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

/**
 * Polls localStorage once a second (plus the cross-tab `storage` event) so
 * a consumer that isn't the one that wrote the timer — chiefly the header's
 * compact indicator — converges within a second of a start/stop/discard
 * fired from elsewhere, without a bespoke same-tab pub/sub channel. The 1s
 * poll only runs while something is actually stored (fix round, phase
 * review) — the `storage` listener alone (registered unconditionally, and
 * essentially free) is what notices a timer STARTING from idle.
 */
function useStoredTimerPoll(userId: number | null): StoredTicketTimer | null {
  const key = userId !== null ? storageKey(userId) : null;
  const [stored, setStored] = useState<StoredTicketTimer | null>(() =>
    key !== null && userId !== null ? readStoredTimer(safeReadRaw(key), userId) : null,
  );

  useEffect(() => {
    if (key === null || userId === null) {
      setStored(null);
      return;
    }
    function refresh() {
      setStored(readStoredTimer(safeReadRaw(key!), userId!));
    }
    refresh(); // pick up a userId/key change (e.g. a different login) right away
    window.addEventListener("storage", refresh);
    window.addEventListener(TIMER_CHANGED_EVENT, refresh);
    return () => {
      window.removeEventListener("storage", refresh);
      window.removeEventListener(TIMER_CHANGED_EVENT, refresh);
    };
  }, [key, userId]);

  const isRunning = stored !== null;
  useEffect(() => {
    if (!isRunning || key === null || userId === null) return;
    const activeKey = key;
    const activeUserId = userId;
    const interval = setInterval(() => {
      setStored(readStoredTimer(safeReadRaw(activeKey), activeUserId));
    }, 1000);
    return () => clearInterval(interval);
  }, [isRunning, key, userId]);

  return stored;
}

/**
 * Read-only global indicator — `TopBar.tsx`'s header pill. No mutation, no
 * per-ticket comparison: just "is a timer running anywhere, and for how
 * long" so the pill can link to it and tick.
 */
export function useRunningItopTimer(): { timer: StoredTicketTimer; elapsedSeconds: number } | null {
  const { user } = useAuth();
  const stored = useStoredTimerPoll(user?.id ?? null);
  // The timer logs time to iTop (POST /itop/tickets/:id/time), a task:write
  // action — a user without it never sees the global pill.
  if (!stored || !hasPermission(user, "task:write")) return null;
  const elapsedSeconds = Math.max(
    0,
    Math.floor((Date.now() - new Date(stored.startedAt).getTime()) / 1000),
  );
  return { timer: stored, elapsedSeconds };
}

export interface UseTicketTimerResult {
  status: TicketTimerStatus;
  /** Only meaningful when `status === "running-here"`. */
  elapsedSeconds: number;
  /** True once `elapsedSeconds` has passed the backend's 24h ceiling on a
   * loggable entry — `stop()` becomes a no-op and the UI must offer only
   * Discard. Only meaningful when `status === "running-here"`. */
  expired: boolean;
  /** Set only when `status === "running-elsewhere"`. */
  other: StoredTicketTimer | null;
  /** No-ops (beyond the guard) unless `status === "idle"`. */
  start: () => void;
  /** No-op unless `status === "running-here"` and not `expired`. */
  stop: () => void;
  /** No-op unless `status === "running-here"`. */
  discard: () => void;
  /** No-op unless `status === "running-elsewhere"` — logs the OTHER
   * ticket's time first, then starts on this one only once that write
   * succeeds. */
  stopOtherAndStart: () => void;
  /** No-op unless `status === "running-elsewhere"` — drops the other
   * ticket's timer with no write, then starts on this one. */
  discardOtherAndStart: () => void;
  isStopping: boolean;
  stopError: string | null;
  staleNotice: string | null;
}

/**
 * `ticket` is whichever ticket the calling panel currently has open —
 * `status` compares it against whatever's stored, so opening a DIFFERENT
 * ticket's panel while a timer runs elsewhere reads `"running-elsewhere"`
 * rather than silently adopting that ticket as "here". Without a signed-in
 * user (shouldn't happen behind `AuthGuard`, but defensive) the timer is
 * inert: always idle, every action a no-op.
 */
export function useTicketTimer(ticket: TimerTicketRef): UseTicketTimerResult {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const key = userId !== null ? storageKey(userId) : null;

  const [stored, setStored] = useState<StoredTicketTimer | null>(() =>
    key !== null && userId !== null ? readStoredTimer(safeReadRaw(key), userId) : null,
  );
  const [, bumpTick] = useState(0);
  const [stopError, setStopError] = useState<string | null>(null);
  const [staleNotice, setStaleNotice] = useState<string | null>(null);

  // One mutation for both Stop (this ticket) and Stop-other-and-start (whichever
  // ticket is currently stored as "elsewhere"): the ticket is a per-call
  // argument, and `mutateAsync` is used below so the follow-up runs even if
  // this component has unmounted by the time the request finishes.
  const logTime = useLogTicketTimeFor();

  useEffect(() => {
    if (key === null || userId === null) {
      setStored(null);
      return;
    }
    function refreshFromStorage() {
      setStored(readStoredTimer(safeReadRaw(key!), userId!));
    }
    refreshFromStorage();
    // Cross-tab writes land via `storage`; same-tab writes (including a Stop
    // that resolved after its panel unmounted) via the custom event, which
    // every `safeWrite` dispatches.
    window.addEventListener("storage", refreshFromStorage);
    window.addEventListener(TIMER_CHANGED_EVENT, refreshFromStorage);
    return () => {
      window.removeEventListener("storage", refreshFromStorage);
      window.removeEventListener(TIMER_CHANGED_EVENT, refreshFromStorage);
    };
  }, [key, userId]);

  const isRunning = stored !== null;
  useEffect(() => {
    // No interval while nothing is stored (fix round, phase review) — ticks
    // the displayed clock only while there's something to tick.
    // `elapsedSeconds` is recomputed from `stored.startedAt` on every
    // render, so a once-a-second state bump is all that's needed to keep it
    // moving.
    if (!isRunning) return;
    const interval = setInterval(() => bumpTick((n) => n + 1), 1000);
    return () => clearInterval(interval);
  }, [isRunning]);

  function persist(next: StoredTicketTimer | null) {
    if (key === null) return;
    safeWrite(key, next);
    setStored(next);
  }

  const status: TicketTimerStatus = !stored
    ? "idle"
    : stored.ticketId === ticket.id
      ? "running-here"
      : "running-elsewhere";

  const elapsedSeconds =
    status === "running-here" && stored
      ? Math.max(0, Math.floor((Date.now() - new Date(stored.startedAt).getTime()) / 1000))
      : 0;

  const expired = status === "running-here" && elapsedSeconds >= MAX_ENTRY_SECONDS;

  const other = status === "running-elsewhere" ? stored : null;

  function start() {
    if (stored || userId === null) return;
    setStopError(null);
    setStaleNotice(null);
    persist({
      userId,
      ticketId: ticket.id,
      customerId: ticket.customerId,
      ref: ticket.ref,
      startedAt: new Date().toISOString(),
    });
  }

  function discard() {
    if (status !== "running-here") return;
    setStopError(null);
    setStaleNotice(null);
    persist(null);
  }

  function stop() {
    if (status !== "running-here" || !stored || expired || userId === null || key === null) return;
    const closing: ClosingTimer = { ticketId: stored.ticketId, startedAt: stored.startedAt };
    const flightKey = inFlightStopKey(userId, stored.startedAt);
    // A remounted panel (or a double click) must not log the same timer twice.
    if (!claimInFlightStop(flightKey)) return;
    setStopError(null);
    // mutateAsync().then rather than a per-call onSuccess: React Query drops
    // per-call callbacks once the component unmounts, and a Stop whose
    // request finishes after the panel closed must still clear the stored
    // timer — otherwise the next Stop would log an overlapping duplicate.
    logTime
      .mutateAsync({
        ticketId: ticket.id,
        customerId: ticket.customerId,
        startedAt: stored.startedAt,
        endedAt: new Date().toISOString(),
      })
      .then((result) => {
        // Re-read: this can resolve long after the panel unmounted, with a
        // newer timer stored since — only clear the one that was closed.
        if (shouldApplyAfterClose(readStoredTimer(safeReadRaw(key), userId), closing)) persist(null);
        if (isStaleTimeLog(result)) {
          setStaleNotice("Logged in iTop; it appears after the next sync.");
        }
      })
      .catch((err: unknown) => {
        // Left running deliberately — no queued/optimistic writes, so a
        // refusal must leave the clock exactly where it was.
        setStopError(err instanceof ApiError ? err.message : "Could not log time.");
      })
      .finally(() => releaseInFlightStop(flightKey));
  }

  function stopOtherAndStart() {
    if (status !== "running-elsewhere" || !stored || userId === null || key === null) return;
    const closingOther = stored;
    const flightKey = inFlightStopKey(userId, closingOther.startedAt);
    if (!claimInFlightStop(flightKey)) return;
    setStopError(null);
    setStaleNotice(null);
    // mutateAsync().then for the same reason as stop(): the stored timer
    // must be replaced even if this component unmounts mid-request.
    logTime
      .mutateAsync({
        ticketId: closingOther.ticketId,
        customerId: closingOther.customerId,
        startedAt: closingOther.startedAt,
        endedAt: new Date().toISOString(),
      })
      .then(() => {
        // Replace the closed timer only if it is still the stored one.
        if (shouldApplyAfterClose(readStoredTimer(safeReadRaw(key), userId), closingOther)) {
          persist({
            userId,
            ticketId: ticket.id,
            customerId: ticket.customerId,
            ref: ticket.ref,
            startedAt: new Date().toISOString(),
          });
        }
      })
      .catch((err: unknown) => {
        setStopError(err instanceof ApiError ? err.message : "Could not log time.");
      })
      .finally(() => releaseInFlightStop(flightKey));
  }

  function discardOtherAndStart() {
    if (status !== "running-elsewhere" || userId === null) return;
    persist({
      userId,
      ticketId: ticket.id,
      customerId: ticket.customerId,
      ref: ticket.ref,
      startedAt: new Date().toISOString(),
    });
  }

  return {
    status,
    elapsedSeconds,
    expired,
    other,
    start,
    stop,
    discard,
    stopOtherAndStart,
    discardOtherAndStart,
    isStopping:
      logTime.isPending ||
      (stored !== null && userId !== null && IN_FLIGHT_STOPS.has(inFlightStopKey(userId, stored.startedAt))),
    stopError,
    staleNotice,
  };
}
