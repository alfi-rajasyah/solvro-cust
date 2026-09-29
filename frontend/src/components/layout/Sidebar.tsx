import { Fragment } from "react";
import { NavLink } from "react-router-dom";
import { hasPermission, useAuth } from "@/lib/auth";
import { NAV_COMMANDS, NAV_GROUPS, type NavCommand } from "@/lib/navCommands";
import { useNavBadges } from "@/lib/queries";
import { useSidebar } from "./SidebarContext";
import { BrandMark } from "@/components/BrandMark";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

// DESIGN.md: sidebar is charcoal #232321 in both themes (stays dark in light
// mode). Token lives in index.css's `@theme inline` block — no theme-flipping
// `dark:` variant.
const SIDEBAR_BG = "bg-sidebar";

// Collapsed rail: w-sidebar-collapsed (64px) with px-2 around a w-10 link leaves
// 16px between the link's right edge and the rail's edge. The tooltip anchors to
// the link, so the offset is that 16px plus a 10px visual gap — a smaller value
// puts the tooltip's left edge under the rail (z-50) and clips its first letter.
const RAIL_TOOLTIP_OFFSET = 26;

function pendingText(n: number) {
  return `${n} ${n === 1 ? "customer" : "customers"} to review`;
}

function NavItem({
  item,
  expanded,
  badge,
  onNavigate,
}: {
  item: NavCommand;
  expanded: boolean;
  /** Pending count shown on the item; hidden at 0. */
  badge: number;
  onNavigate: () => void;
}) {
  const linkClass = ({ isActive }: { isActive: boolean }) =>
    [
      "group relative flex items-center rounded-sm transition-colors duration-150",
      expanded ? "gap-2.5 px-3 py-2 text-[13px]" : "h-10 w-10 justify-center",
      isActive ? "bg-primary/20 text-white" : "text-slate-400 hover:bg-white/5 hover:text-slate-100",
    ].join(" ");

  const content = ({ isActive }: { isActive: boolean }) => (
    <>
      <span
        aria-hidden
        className={["material-symbols-outlined text-[20px]", isActive ? "text-primary" : ""].join(
          " ",
        )}
      >
        {item.icon}
      </span>
      {expanded ? <span>{item.label}</span> : <span className="sr-only">{item.label}</span>}
      {badge > 0 &&
        (expanded ? (
          <span
            aria-hidden
            className="ml-auto min-w-5 rounded-full bg-primary px-1.5 py-0.5 text-center text-meta font-bold leading-none text-on-primary"
          >
            {badge}
          </span>
        ) : (
          <span
            aria-hidden
            className="absolute right-0.5 top-0.5 size-2.5 rounded-full bg-primary ring-2 ring-sidebar"
          />
        ))}
      {badge > 0 && <span className="sr-only">{pendingText(badge)}</span>}
    </>
  );

  if (expanded) {
    return (
      <NavLink to={item.to} onClick={onNavigate} className={linkClass}>
        {content}
      </NavLink>
    );
  }

  // Collapsed rail: a styled, zero-delay tooltip replaces the native `title`.
  return (
    <Tooltip>
      <TooltipTrigger
        render={(props) => (
          <NavLink
            {...props}
            to={item.to}
            onClick={(e) => {
              props.onClick?.(e);
              onNavigate();
            }}
            className={linkClass}
          >
            {content}
          </NavLink>
        )}
      />
      <TooltipContent side="right" sideOffset={RAIL_TOOLTIP_OFFSET} positionerClassName="z-60">
        {item.label}
        {badge > 0 && ` · ${pendingText(badge)}`}
      </TooltipContent>
    </Tooltip>
  );
}

export function Sidebar() {
  const { expanded, toggle, close } = useSidebar();
  const { user } = useAuth();
  const { data: badges } = useNavBadges();
  const visible = NAV_COMMANDS.filter((i) => !i.requires || hasPermission(user, i.requires));
  const groups = NAV_GROUPS.map((group) => ({
    group,
    items: visible.filter((i) => i.group === group),
  })).filter((g) => g.items.length > 0);

  return (
    <>
      {expanded && (
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
          expanded ? "flex w-sidebar" : "hidden w-sidebar-collapsed md:flex",
        ].join(" ")}
      >
        <div
          className={[
            "flex items-center",
            expanded ? "justify-between gap-3 px-4 py-5" : "justify-center px-2 py-5",
          ].join(" ")}
        >
          {expanded && (
            <div className="flex min-w-0 items-center gap-3">
              <BrandMark className="h-8 w-8 shrink-0" />
              <span className="truncate text-lg font-extrabold tracking-tight text-white">
                Solvro
              </span>
            </div>
          )}
          <button
            type="button"
            onClick={toggle}
            aria-label={expanded ? "Collapse sidebar" : "Expand sidebar"}
            className="flex h-8 w-8 items-center justify-center rounded-sm text-slate-400 hover:bg-white/5 hover:text-slate-100"
          >
            <span className="material-symbols-outlined text-lg">
              {expanded ? "menu_open" : "menu"}
            </span>
          </button>
        </div>

        <TooltipProvider delay={0} closeDelay={0}>
          <nav
            className={["mt-2 flex-1 overflow-y-auto pb-4", expanded ? "px-3" : "px-2"].join(" ")}
          >
            {groups.map(({ group, items }, gi) => (
              <Fragment key={group}>
                {/* Expanded: caps label above each group. Collapsed: a thin
                    divider between groups (none above the first). */}
                {expanded ? (
                  <div
                    className={[
                      "px-3 pb-1.5 text-label-caps uppercase text-on-surface-variant",
                      gi === 0 ? "pt-1" : "pt-5",
                    ].join(" ")}
                  >
                    {group}
                  </div>
                ) : (
                  gi > 0 && <div role="separator" className="mx-2 my-2 h-px bg-outline-variant" />
                )}
                <div role="group" aria-label={group} className="space-y-1">
                  {items.map((item) => (
                    <NavItem
                      key={item.to}
                      item={item}
                      expanded={expanded}
                      badge={item.to === "/daily-review" ? (badges?.dailyReviewPending ?? 0) : 0}
                      onNavigate={close}
                    />
                  ))}
                </div>
              </Fragment>
            ))}
          </nav>
        </TooltipProvider>
      </aside>
    </>
  );
}
