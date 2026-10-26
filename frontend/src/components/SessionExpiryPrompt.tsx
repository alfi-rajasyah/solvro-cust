import { useEffect, useState } from "react";
import { ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { minutesLeft, SESSION_WARNING_LEAD_MS, tokenExpiryMs } from "@/lib/sessionExpiry";

const CHECK_INTERVAL_MS = 15_000;

/**
 * Non-blocking notice shown for the last five minutes of a session, with a
 * "Stay signed in" action that swaps in a fresh token. It never blocks the
 * page (a long note being typed keeps focus). If the session ends anyway the
 * usual sign-out applies. A fresh token — from this tab or another one, via
 * the storage event handled in AuthProvider — moves the expiry and hides it.
 */
export function SessionExpiryPrompt() {
  const { token, extendSession } = useAuth();
  const expiry = tokenExpiryMs(token);
  const [now, setNow] = useState(() => Date.now());
  const [dismissedFor, setDismissedFor] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  // The server refused because the session hit its absolute maximum length:
  // retrying cannot help, so the action goes away.
  const [maxed, setMaxed] = useState(false);

  // A coarse poll against the wall clock rather than one long timeout: it
  // survives a sleeping laptop or a throttled background tab.
  useEffect(() => {
    if (expiry === null) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), CHECK_INTERVAL_MS);
    return () => clearInterval(id);
  }, [expiry]);

  useEffect(() => {
    setFailed(false);
    setMaxed(false);
  }, [expiry]);

  if (expiry === null || dismissedFor === expiry) return null;
  if (now >= expiry || now < expiry - SESSION_WARNING_LEAD_MS) return null;

  const minutes = minutesLeft(expiry, now);

  async function stay() {
    setBusy(true);
    setFailed(false);
    try {
      await extendSession();
    } catch (err) {
      const code = err instanceof ApiError ? (err.body as { code?: unknown } | null)?.code : null;
      if (code === "session_max_age") setMaxed(true);
      else setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      role="status"
      data-testid="session-expiry-prompt"
      className="fixed bottom-4 right-4 left-4 z-90 flex flex-wrap items-center gap-3 rounded-md border border-outline-variant bg-surface-container p-3 text-sm text-on-surface md:left-auto md:max-w-md"
    >
      <span className="material-symbols-outlined text-[18px] text-on-surface-variant" aria-hidden="true">
        timer
      </span>
      <p className="min-w-0 flex-1">
        {maxed
          ? `This session cannot be extended any further. It ends in ${minutes} ${minutes === 1 ? "minute" : "minutes"}; sign in again then.`
          : failed
          ? "Could not extend your session. Try again."
          : `Your session expires in ${minutes} ${minutes === 1 ? "minute" : "minutes"}.`}
      </p>
      {!maxed && (
        <Button size="sm" disabled={busy} onClick={() => void stay()}>
          Stay signed in
        </Button>
      )}
      <Button size="sm" variant="ghost" onClick={() => setDismissedFor(expiry)}>
        Dismiss
      </Button>
    </div>
  );
}
