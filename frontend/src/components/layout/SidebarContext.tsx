import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

interface SidebarContextValue {
  /**
   * Desktop (md+) expanded state — persisted, and what the layout margins
   * (Shell, TopBar) follow. Below md the sidebar is an overlay drawer that
   * this value does not affect.
   */
  open: boolean;
  /**
   * Whether the rail currently renders expanded (labels visible) at the live
   * viewport: the persisted desktop state at md+, the drawer state below.
   */
  expanded: boolean;
  /** True at md (768px) and up. */
  isDesktop: boolean;
  /** Toggles the desktop rail at md+ (persisted), the mobile drawer below. */
  toggle: () => void;
  /**
   * Closes the mobile drawer. A no-op for the desktop rail: navigating never
   * collapses it (the choice is the user's, persisted).
   */
  close: () => void;
}

const SidebarContext = createContext<SidebarContextValue | null>(null);

const STORAGE_KEY = "solvro.sidebar";
// Below this viewport width the rail defaults collapsed; at or above it,
// expanded. Applies only until the user makes a choice.
const EXPAND_DEFAULT_MIN_WIDTH = 1280;
const DESKTOP_QUERY = "(min-width: 768px)";

function readStored(): boolean | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "open") return true;
    if (v === "closed") return false;
  } catch {
    // Storage blocked (private window, site data cleared) — fall back to the default.
  }
  return null;
}

function writeStored(open: boolean) {
  try {
    localStorage.setItem(STORAGE_KEY, open ? "open" : "closed");
  } catch {
    // Non-fatal: the choice just doesn't survive a reload.
  }
}

function initialDesktopOpen(): boolean {
  return readStored() ?? window.innerWidth >= EXPAND_DEFAULT_MIN_WIDTH;
}

function subscribeDesktop(cb: () => void) {
  const mql = window.matchMedia(DESKTOP_QUERY);
  mql.addEventListener("change", cb);
  return () => mql.removeEventListener("change", cb);
}

function useIsDesktop(): boolean {
  return useSyncExternalStore(
    subscribeDesktop,
    () => window.matchMedia(DESKTOP_QUERY).matches,
    () => false,
  );
}

export function SidebarProvider({ children }: { children: ReactNode }) {
  const [desktopOpen, setDesktopOpen] = useState(initialDesktopOpen);
  const [mobileOpen, setMobileOpen] = useState(false);
  const isDesktop = useIsDesktop();

  const toggle = useCallback(() => {
    if (isDesktop) {
      writeStored(!desktopOpen);
      setDesktopOpen(!desktopOpen);
    } else {
      setMobileOpen((v) => !v);
    }
  }, [isDesktop, desktopOpen]);

  const close = useCallback(() => setMobileOpen(false), []);

  const value = useMemo<SidebarContextValue>(
    () => ({
      open: desktopOpen,
      expanded: isDesktop ? desktopOpen : mobileOpen,
      isDesktop,
      toggle,
      close,
    }),
    [desktopOpen, mobileOpen, isDesktop, toggle, close],
  );
  return <SidebarContext.Provider value={value}>{children}</SidebarContext.Provider>;
}

export function useSidebar() {
  const ctx = useContext(SidebarContext);
  if (!ctx) throw new Error("useSidebar must be used inside SidebarProvider");
  return ctx;
}
