import { NavLink } from "react-router-dom";
import { hasPermission, useAuth } from "@/lib/auth";
import { NAV_COMMANDS } from "@/lib/navCommands";
import { useSidebar } from "./SidebarContext";
import { BrandMark } from "@/components/BrandMark";

// DESIGN.md: sidebar is charcoal #232321 in both themes (stays dark in light
// mode). Token lives in index.css's `@theme inline` block — no theme-flipping
// `dark:` variant.
const SIDEBAR_BG = "bg-sidebar";

export function Sidebar() {
  const { open, toggle, close } = useSidebar();
  const { user } = useAuth();
  const items = NAV_COMMANDS.filter((i) => !i.requires || hasPermission(user, i.requires));

  return (
    <>
      {open && (
        <button
          type="button"
          onClick={close}
          aria-label="Close sidebar"
          className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[1px] md:hidden"
        />
      )}

      <aside
        className={[
          // `dark` is pinned so the rail renders dark in both themes (fixed
          // brand element per DESIGN.md): token-based accents like `bg-primary`
          // resolve to their `.dark` values even when the app is in light mode.
          "dark fixed left-0 top-0 z-50 h-screen flex-col overflow-hidden border-r border-black/30 font-display text-slate-300 transition-[width] duration-200 ease-out",
          SIDEBAR_BG,
          open ? "flex w-sidebar" : "hidden w-sidebar-collapsed md:flex",
        ].join(" ")}
      >
        <div
          className={[
            "flex items-center",
            open ? "justify-between gap-3 px-4 py-5" : "justify-center px-2 py-5",
          ].join(" ")}
        >
          {open && (
            <div className="flex min-w-0 items-center gap-3">
              <BrandMark className="h-8 w-8 shrink-0" />
              <h1 className="truncate text-lg font-extrabold tracking-tight text-white">
                Solvro
              </h1>
            </div>
          )}
          <button
            type="button"
            onClick={toggle}
            aria-label={open ? "Collapse sidebar" : "Expand sidebar"}
            className="flex h-8 w-8 items-center justify-center rounded-sm text-slate-400 hover:bg-white/5 hover:text-slate-100"
          >
            <span className="material-symbols-outlined text-lg">
              {open ? "menu_open" : "menu"}
            </span>
          </button>
        </div>

        <nav
          className={["mt-2 flex-1 space-y-1", open ? "px-3" : "px-2"].join(" ")}
        >
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={close}
              title={open ? undefined : item.label}
              className={({ isActive }) =>
                [
                  "group flex items-center rounded-sm transition-colors duration-150",
                  open ? "gap-2.5 px-3 py-2 text-[13px]" : "h-10 w-10 justify-center",
                  isActive
                    ? "bg-primary/20 text-white"
                    : "text-slate-400 hover:bg-white/5 hover:text-slate-100",
                ].join(" ")
              }
            >
              {({ isActive }) => (
                <>
                  <span
                    className={[
                      "material-symbols-outlined text-[20px]",
                      isActive ? "text-primary" : "",
                    ].join(" ")}
                  >
                    {item.icon}
                  </span>
                  {open && <span>{item.label}</span>}
                </>
              )}
            </NavLink>
          ))}
        </nav>
      </aside>
    </>
  );
}
