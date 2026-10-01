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
import { useAuth } from "@/lib/auth";
import { isStaleTimeLog, useLogTicketTime, useLogTicketTimeFor } from "@/lib/queries";

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
    return () => window.removeEventListener("storage", refresh);
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
  if (!stored) return null;
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

  // Fixed to THIS ticket — the Stop button's own mutation. `stopOtherAndStart`
  // below needs a dynamic ticketId (whichever ticket is currently stored as
  // "elsewhere"), so it goes through the unfixed `useLogTicketTimeFor`
  // directly instead.
  const logOwnTime = useLogTicketTime(ticket.id, ticket.customerId);
  const logOtherTime = useLogTicketTimeFor();

  useEffect(() => {
    if (key === null || userId === null) {
      setStored(null);
      return;
    }
    function refreshFromStorage() {
      setStored(readStoredTimer(safeReadRaw(key!), userId!));
    }
    refreshFromStorage();
    // Cross-tab writes land via `storage`; same-tab, `persist()` below
    // already updates this hook's own state synchronously, so this listener
    // only matters for the multi-tab case.
    window.addEventListener("storage", refreshFromStorage);
    return () => window.removeEventListener("storage", refreshFromStorage);
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
    if (status !== "running-here" || !stored || expired) return;
    setStopError(null);
    logOwnTime.mutate(
      { startedAt: stored.startedAt, endedAt: new Date().toISOString() },
      {
        onSuccess: (result) => {
          persist(null);
          if (isStaleTimeLog(result)) {
            setStaleNotice("Logged in iTop; it appears after the next sync.");
          }
        },
        onError: (err) => {
          // Left running deliberately — no queued/optimistic writes, so a
          // refusal must leave the clock exactly where it was.
          setStopError(err instanceof ApiError ? err.message : "Could not log time.");
        },
      },
    );
  }

  function stopOtherAndStart() {
    if (status !== "running-elsewhere" || !stored || userId === null) return;
    const closingOther = stored;
    setStopError(null);
    setStaleNotice(null);
    logOtherTime.mutate(
      {
        ticketId: closingOther.ticketId,
        customerId: closingOther.customerId,
        startedAt: closingOther.startedAt,
        endedAt: new Date().toISOString(),
      },
      {
        onSuccess: () => {
          persist({
            userId,
            ticketId: ticket.id,
            customerId: ticket.customerId,
            ref: ticket.ref,
            startedAt: new Date().toISOString(),
          });
        },
        onError: (err) => {
          setStopError(err instanceof ApiError ? err.message : "Could not log time.");
        },
      },
    );
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
    isStopping: logOwnTime.isPending || logOtherTime.isPending,
    stopError,
    staleNotice,
  };
}
