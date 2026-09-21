import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ProjectStatusChip } from "@/components/StatusChip";
import { useAuth } from "@/lib/auth";
import { useProject } from "@/lib/queries";
import { useTheme } from "@/lib/theme";
import { useSidebar } from "./SidebarContext";

const PAGE_TITLES: Record<string, string> = {
  overview: "Overview",
  projects: "My Projects",
  customers: "Customers",
  tasks: "Tasks",
};

export function TopBar({ onOpenSearch }: { onOpenSearch: () => void }) {
  const { user, logout } = useAuth();
  const { resolved, toggle } = useTheme();
  const { open, toggle: toggleSidebar } = useSidebar();
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  const segments = location.pathname.split("/").filter(Boolean);
  const projectId =
    segments[0] === "projects" && segments[1] && /^\d+$/.test(segments[1])
      ? Number(segments[1])
      : null;
  const { data: project } = useProject(projectId);

  const segment = segments[0] ?? "overview";
  const title = PAGE_TITLES[segment] ?? "Solvro";

  const initials = user
    ? user.username
        .split(/[.\s_-]/)
        .map((p) => p[0]?.toUpperCase() ?? "")
        .join("")
        .slice(0, 2)
    : "?";

  function handleLogout() {
    logout();
    navigate("/login", { replace: true });
  }

  return (
    <header
      className={`sticky top-0 z-40 flex h-14 items-center gap-3 border-b border-outline-variant bg-surface-container-lowest px-4 font-display transition-[margin] duration-200 ease-out md:gap-4 md:px-6 ${
        open ? "md:ml-sidebar" : "md:ml-sidebar-collapsed"
      }`}
    >
      <button
        type="button"
        onClick={toggleSidebar}
        aria-label="Open navigation"
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-sm text-on-surface-variant hover:bg-surface-container hover:text-on-surface md:hidden"
      >
        <span className="material-symbols-outlined">menu</span>
      </button>

      {projectId && project ? (
        <div className="flex min-w-0 items-center gap-2">
          <Link
            to="/projects"
            className="shrink-0 text-[13px] text-on-surface-variant hover:text-on-surface"
          >
            Projects
          </Link>
          <span className="text-on-surface-variant">/</span>
          <span className="truncate text-[15px] font-semibold text-on-surface">
            {project.name}
          </span>
          <ProjectStatusChip status={project.status} />
        </div>
      ) : (
        <span className="truncate text-[15px] font-semibold text-on-surface">{title}</span>
      )}

      <div className="ml-auto flex items-center gap-3">
        <button
          type="button"
          onClick={onOpenSearch}
          aria-label="Open search"
          className="hidden min-w-[260px] cursor-text items-center gap-2 rounded-sm bg-surface-container px-3 py-1.5 md:flex"
        >
          <span className="material-symbols-outlined text-base text-on-surface-variant">
            search
          </span>
          <span className="flex-1 text-left text-[13px] text-on-surface-variant">
            Search projects, tasks, customers…
          </span>
          <span className="rounded-sm border border-outline-variant bg-surface-container-low px-1.5 py-0.5 font-mono text-[10px] text-on-surface-variant">
            ⌘K
          </span>
        </button>

        <button
          type="button"
          onClick={onOpenSearch}
          aria-label="Open search"
          className="flex h-8 w-8 items-center justify-center rounded-sm text-on-surface-variant hover:bg-surface-container hover:text-on-surface md:hidden"
        >
          <span className="material-symbols-outlined text-[20px]">search</span>
        </button>

        <button
          type="button"
          onClick={toggle}
          aria-label={resolved === "dark" ? "Switch to light theme" : "Switch to dark theme"}
          title={resolved === "dark" ? "Light mode" : "Dark mode"}
          className="flex h-8 w-8 items-center justify-center rounded-sm text-on-surface-variant hover:bg-surface-container hover:text-on-surface"
        >
          <span className="material-symbols-outlined text-[20px]">
            {resolved === "dark" ? "light_mode" : "dark_mode"}
          </span>
        </button>

        <div className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            className="flex items-center gap-2 rounded-sm border-l border-outline-variant pl-3 text-left hover:opacity-90"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-[12px] font-bold text-white">
              {initials}
            </span>
            <div className="hidden flex-col items-start sm:flex">
              <span className="text-[12px] font-semibold leading-tight text-on-surface">
                {user?.username ?? "Guest"}
              </span>
              <span className="text-[10px] font-bold uppercase leading-tight tracking-wider text-on-surface-variant">
                {user?.role ?? ""}
              </span>
            </div>
            <span className="material-symbols-outlined text-base text-on-surface-variant">
              expand_more
            </span>
          </button>
          {menuOpen && (
            <>
              <button
                type="button"
                aria-label="Close menu"
                onClick={() => setMenuOpen(false)}
                className="fixed inset-0 z-40 cursor-default"
              />
              <div className="absolute right-0 top-full z-50 mt-1 w-48 rounded-sm border border-outline-variant bg-surface-container-lowest py-1 shadow-overlay">
                <div className="border-b border-outline-variant px-3 py-2 text-[12px] text-on-surface-variant">
                  <div className="font-medium text-on-surface">{user?.email}</div>
                  <div className="text-[10px] font-bold uppercase tracking-wider">
                    {user?.role}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    navigate("/settings");
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-on-surface hover:bg-surface-container"
                >
                  <span className="material-symbols-outlined text-base">settings</span>
                  Settings
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    handleLogout();
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-on-surface hover:bg-surface-container"
                >
                  <span className="material-symbols-outlined text-base">logout</span>
                  Sign out
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
