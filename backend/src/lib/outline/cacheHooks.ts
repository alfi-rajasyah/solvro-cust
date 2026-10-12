// Outline-derived caches (the Docs tree, mention-visibility verdicts) hold data that
// was fetched under a user's token. When that token goes away - disconnect, a
// refused refresh, a new connection, or the admin changing the Outline address or
// client (which disconnects everyone) - those entries must go too, or a user could
// keep seeing titles they can no longer open. Each cache registers itself here;
// tokens.ts and the admin route only notify (docs/archive/plans/outline-integration.md).
type Listener = (userId: number | null) => void;

const listeners: Listener[] = [];

/** Registers a cache's invalidator; `null` means "every user". */
export function onOutlineAuthChanged(fn: Listener): void {
  listeners.push(fn);
}

/** A user's Outline connection changed (`userId`), or everyone's was dropped (`null`). */
export function notifyOutlineAuthChanged(userId: number | null): void {
  for (const fn of listeners) {
    try {
      fn(userId);
    } catch {
      // a cache invalidator must never break the auth flow
    }
  }
}
