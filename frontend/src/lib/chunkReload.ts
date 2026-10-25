/**
 * Pages load in their own chunks (App.tsx). After a deploy, a tab that is not
 * controlled by the service worker (plain http on a LAN host, some framed
 * embeds) still runs the old entry script, and asking for a chunk the deploy
 * removed fails with a 404. React.lazy caches that failure, so the page error
 * screen's "Try again" cannot recover it — only a reload, which fetches the
 * current build, can. Vite reports the failed import as a cancelable
 * `vite:preloadError` event: reload once, and if the reload itself happened
 * less than `windowMs` ago, let the error screen show instead of looping.
 */
const KEY = "solvro.chunkReloadAt";

export function handleChunkLoadError(
  event: Event,
  storage: Pick<Storage, "getItem" | "setItem">,
  reload: () => void,
  now = Date.now(),
  windowMs = 10_000,
): void {
  try {
    const last = Number(storage.getItem(KEY) ?? 0);
    if (now - last < windowMs) return;
    storage.setItem(KEY, String(now));
  } catch {
    // Storage blocked (a partitioned iframe): no loop guard, so no reload.
    return;
  }
  event.preventDefault();
  reload();
}

export function installChunkReload(): void {
  window.addEventListener("vite:preloadError", (event) =>
    handleChunkLoadError(event, window.sessionStorage, () => window.location.reload()),
  );
}
