import { Suspense, useEffect, useRef, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { AppErrorBoundary } from "@/components/AppErrorBoundary";
import { PageLoading } from "@/components/skeletons";
import { CommandPalette } from "@/components/CommandPalette";
import { InstallBanner } from "@/components/InstallBanner";
import { Sidebar } from "./Sidebar";
import { SidebarProvider, useSidebar } from "./SidebarContext";
import { TopBar } from "./TopBar";

function ShellLayout() {
  const { open } = useSidebar();
  const { pathname } = useLocation();
  const queryClient = useQueryClient();
  const [paletteOpen, setPaletteOpen] = useState(false);
  // Mirror of `paletteOpen` for the listener below, which stays mounted once
  // ([] deps) instead of re-attaching on every open/close — a passive
  // `[paletteOpen]`-deps effect leaves a brief stale-closure window (a
  // key-repeat ⌘K can fire before React tears down and re-attaches the old
  // closure) where the guard reads a stale value. The ref is updated inline,
  // synchronously, at the exact point the listener itself decides to
  // open/close (no waiting on a render+effect round-trip to catch up), and
  // mirrored by the effect below for opens/closes that originate elsewhere
  // (TopBar's search icon, CommandPalette's own Escape/backdrop close).
  const paletteOpenRef = useRef(paletteOpen);
  useEffect(() => {
    paletteOpenRef.current = paletteOpen;
  }, [paletteOpen]);

  // Single app-wide ⌘K/Ctrl+K listener. The editable-target guard only
  // applies to the OPEN direction (typing "k" with modifiers inside an
  // input/textarea never hijacks focus, per spec); the CLOSE direction
  // checks `paletteOpenRef` directly instead, since the palette autofocuses
  // its own input the instant it opens (CommandPalette.tsx) — inferring
  // "closing" from `document.activeElement`'s tag made a second ⌘K press
  // no-op almost every time, because focus was already sitting inside that
  // same input.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "k") return;
      if (paletteOpenRef.current) {
        e.preventDefault();
        paletteOpenRef.current = false;
        setPaletteOpen(false);
        return;
      }
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      e.preventDefault();
      paletteOpenRef.current = true;
      setPaletteOpen(true);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // The sidebar is `position: fixed` (out of flow), so the main canvas must
  // carry a left margin equal to the *live* sidebar width — otherwise an
  // expanded sidebar overlays the content instead of pushing it. Desktop only:
  // open → 260px (ml-sidebar), collapsed → 64px (ml-16). On mobile the sidebar
  // is an overlay drawer, so no shift (base has no margin).
  const shift = open ? "md:ml-sidebar" : "md:ml-sidebar-collapsed";
  return (
    <div className="flex h-screen w-full flex-col overflow-hidden bg-background text-on-surface">
      {/* In normal flow (unlike Sidebar/TopBar, which are fixed/sticky) so it
          takes its own row at the very top; main below is flex-1 so it fills
          whatever's left rather than assuming a fixed TopBar height. */}
      <InstallBanner />
      <Sidebar />
      <TopBar onOpenSearch={() => setPaletteOpen(true)} />
      <main
        className={`min-h-0 flex-1 overflow-y-auto overflow-x-hidden bg-background p-4 transition-[margin] duration-200 ease-out md:p-6 ${shift}`}
      >
        {/* A render error in a page keeps the sidebar and top bar usable.
            Try again and a navigation both reset the query cache first, so
            the page renders from fresh data: the top bar shares the project
            and customer queries with their pages, so dropping only unused
            queries would keep the value that broke the page. */}
        <AppErrorBoundary
          variant="page"
          resetKey={pathname}
          onReset={() => void queryClient.resetQueries()}
        >
          <Suspense fallback={<PageLoading />}>
            <Outlet />
          </Suspense>
        </AppErrorBoundary>
      </main>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  );
}

export function Shell() {
  return (
    <SidebarProvider>
      <ShellLayout />
    </SidebarProvider>
  );
}
