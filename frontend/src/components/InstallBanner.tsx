import { useEffect, useState } from "react";

const DISMISS_KEY = "solvro:install-banner-dismissed";
const IOS_HINT_DISMISS_KEY = "solvro:ios-install-hint-dismissed";

// Chrome/Android fire `beforeinstallprompt` with a `prompt()` method we can
// trigger from our own UI instead of the native mini-infobar. Not in lib.dom
// yet, so declared locally.
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    // iOS Safari's legacy standalone flag.
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function isIosSafari(): boolean {
  const ua = window.navigator.userAgent;
  const isIos = /iPad|iPhone|iPod/.test(ua);
  const isWebkit = /WebKit/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
  return isIos && isWebkit;
}

/**
 * Slim mobile-only install banner, per the "Mobile + PWA" mockup:
 * - Chrome/Android: listens for `beforeinstallprompt`, shows a green banner
 *   with a download icon, tapping it triggers the deferred native prompt.
 * - iOS Safari (no `beforeinstallprompt` support): shows a one-time hint to
 *   use the share-sheet "Add to Home Screen" action instead.
 * Both variants respect a localStorage dismiss flag and never reappear once
 * dismissed, and never render at all once the app is already installed.
 */
export function InstallBanner() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showIosHint, setShowIosHint] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (isStandalone()) return;

    function onBeforeInstallPrompt(e: Event) {
      e.preventDefault();
      if (localStorage.getItem(DISMISS_KEY) === "1") return;
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    }
    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);

    if (isIosSafari() && localStorage.getItem(IOS_HINT_DISMISS_KEY) !== "1") {
      setShowIosHint(true);
    }

    return () => window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
  }, []);

  if (dismissed || isStandalone()) return null;

  async function handleInstallTap() {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    localStorage.setItem(DISMISS_KEY, "1");
    setDeferredPrompt(null);
  }

  function handleDismiss(e: React.MouseEvent) {
    e.stopPropagation();
    localStorage.setItem(deferredPrompt ? DISMISS_KEY : IOS_HINT_DISMISS_KEY, "1");
    setDismissed(true);
  }

  if (deferredPrompt) {
    return (
      <button
        type="button"
        onClick={handleInstallTap}
        className="flex w-full items-center gap-1.5 bg-primary px-3 py-1.5 text-left text-meta font-semibold text-on-primary md:hidden"
      >
        <span className="material-symbols-outlined text-[14px]">download</span>
        <span className="flex-1">Install Solvro — add to home screen</span>
        <span
          role="button"
          aria-label="Dismiss install banner"
          onClick={handleDismiss}
          className="material-symbols-outlined text-[16px]"
        >
          close
        </span>
      </button>
    );
  }

  if (showIosHint) {
    return (
      <div className="flex w-full items-center gap-1.5 bg-primary px-3 py-1.5 text-meta font-semibold text-on-primary md:hidden">
        <span className="material-symbols-outlined text-[14px]">ios_share</span>
        <span className="flex-1">Add to Home Screen from the share menu</span>
        <button
          type="button"
          aria-label="Dismiss install hint"
          onClick={handleDismiss}
          className="material-symbols-outlined text-[16px]"
        >
          close
        </button>
      </div>
    );
  }

  return null;
}
