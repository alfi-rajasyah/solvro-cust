import { useState } from "react";
import {
  Link,
  NavLink,
  Outlet,
  useNavigate,
  useOutletContext,
  useParams,
  useSearchParams,
  useLocation,
} from "react-router-dom";
import { ConfirmModal } from "@/components/ConfirmModal";
import { CopyLinkButton } from "@/components/CopyLinkButton";
import { RightSidebar } from "@/components/layout/RightSidebar";
import { ProjectFormModal } from "@/components/ProjectFormModal";
import { ProjectHeaderFacts } from "@/components/ProjectHeaderFacts";
import { TaskFormModal } from "@/components/TaskFormModal";
import { Alert, AlertDescription } from "@/components/reui/alert";
import { ProjectPageSkeleton } from "@/components/skeletons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TaskPanel } from "@/components/TaskPanel";
import { ApiError } from "@/lib/api";
import { useNewParam } from "@/hooks/useNewParam";
import { hasPermission, useAuth } from "@/lib/auth";
import { GanttExportProvider } from "@/lib/gantt/exportContext";
import {
  type ProjectDetail as ProjectDetailType,
  useDeleteProject,
  useProject,
} from "@/lib/queries";

const TABS = [
  { to: "overview", label: "Overview" },
  { to: "list", label: "List" },
  { to: "kanban", label: "Kanban" },
  { to: "gantt", label: "Gantt" },
  { to: "epics", label: "Epics" },
  { to: "timeline", label: "Timeline" },
  { to: "risks", label: "Risks" },
  { to: "services", label: "Services" },
];

export interface ProjectOutletContext {
  project: ProjectDetailType;
  /** Opens the Context panel (RightSidebar) — e.g. the Overview's "Lock baseline" shortcut. */
  openContext: () => void;
}

export function ProjectDetail() {
  const { id } = useParams<{ id: string }>();
  const projectId = id ? Number(id) : null;
  const { user } = useAuth();
  const [editOpen, setEditOpen] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const [newTaskOpen, setNewTaskOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const deleteProject = useDeleteProject();

  const { data: project, isLoading, isError, error } = useProject(projectId);

  // Task side panel is deep-linked via ?task=<id> so it works the same way
  // from the Kanban and List views (and survives a page refresh / share).
  const taskParam = searchParams.get("task");
  const parsedTaskId = taskParam ? Number(taskParam) : NaN;
  const openTaskId = Number.isFinite(parsedTaskId) ? parsedTaskId : null;
  // The Epics tab's detail panel (EpicPanel.tsx) uses ?epic=<id> the same way
  // and occupies the same 380px rail, so the content shifts for it too. Same
  // parse as ProjectEpics.tsx (empty string = no panel), and only on the Epics
  // route — EpicPanel mounts nowhere else.
  const epicParam = searchParams.get("epic");
  const epicPanelOpen =
    location.pathname.endsWith("/epics") && !!epicParam && Number.isFinite(Number(epicParam));

  function closeTaskPanel() {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete("task");
        return next;
      },
      { replace: true },
    );
  }

  // Re-targets the panel at another task in the same project — the panel's
  // subtask rows and its parent breadcrumb both route through here. `replace`
  // matches closeTaskPanel: walking parent → subtask → parent shouldn't stack
  // history entries the browser Back button then has to unwind one by one.
  function openTaskPanel(taskId: number) {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set("task", String(taskId));
        return next;
      },
      { replace: true },
    );
  }

  const canEdit = hasPermission(user, "project:write");
  // ⌘K palette "Add task": opens the create form on whichever tab is showing.
  useNewParam("task", hasPermission(user, "task:write"), () => setNewTaskOpen(true));

  if (isLoading) {
    return <ProjectPageSkeleton />;
  }

  if (isError || !project) {
    return (
      <Alert variant="destructive">
        <AlertDescription>
          {error instanceof Error
            ? error.message
            : "Project not found or you don't have access."}{" "}
          <Link to="/projects" className="ml-2 font-bold underline">
            Back to Projects
          </Link>
        </AlertDescription>
      </Alert>
    );
  }

  async function handleDelete() {
    if (!project) return;
    setConfirmDeleteOpen(false);
    setActionError(null);
    try {
      await deleteProject.mutateAsync(project.id);
      navigate("/projects", { replace: true });
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Delete failed.");
    }
  }

  return (
    <GanttExportProvider>
    <div
      className={[
        "flex h-full min-w-0 flex-col transition-[margin] duration-200 ease-out",
        contextOpen ? "md:mr-80" : openTaskId !== null || epicPanelOpen ? "md:mr-[380px]" : "mr-0",
      ].join(" ")}
    >
      {/* Project name, status and the customer crumb live in the TopBar
          (TopBar.tsx); the description lives in the Context sidebar
          (RightSidebar.tsx). This row keeps the project's facts and its
          actions next to the tabs. */}
      <div className="mb-3 flex items-start justify-between gap-3 md:gap-4">
        <ProjectHeaderFacts project={project} />

        {/* Copy link shows at every width. Below md the other actions live in
            the ⋯ menu; Edit and the Context toggle render as buttons from md up. The two copies never share a
            viewport (display:none leaves the accessibility tree), so the
            Context toggle's aria-labels stay unique. */}
        <div className="flex shrink-0 items-center gap-2">
          <CopyLinkButton
            label="Copy link"
            className="h-8 w-8 rounded-lg border border-outline-variant bg-surface-container-lowest hover:bg-surface-container"
          />
          {canEdit && (
            <button
              type="button"
              onClick={() => setEditOpen(true)}
              className="hidden items-center gap-2 rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-1.5 font-display text-xs font-bold text-on-surface hover:bg-surface-container md:inline-flex"
            >
              <span className="material-symbols-outlined text-base">edit</span>
              Edit
            </button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <button
                  type="button"
                  aria-label="More project actions"
                  title="More project actions"
                  className={[
                    "h-8 w-8 items-center justify-center rounded-lg border border-outline-variant bg-surface-container-lowest text-on-surface-variant outline-hidden transition-colors hover:bg-surface-container hover:text-on-surface focus-visible:ring-2 focus-visible:ring-primary/30",
                    canEdit ? "inline-flex" : "inline-flex md:hidden",
                  ].join(" ")}
                >
                  <span className="material-symbols-outlined text-base" aria-hidden="true">
                    more_horiz
                  </span>
                </button>
              }
            />
            {/* z-50 on the Positioner (frontend/CLAUDE.md "Popover
                z-index"): the menu never opens inside Modal.tsx's z-100
                layer. Lock baseline and Export stay in the Context panel
                (RightSidebar.tsx) — their state and the Gantt export
                handlers live there. */}
            <DropdownMenuContent
              align="end"
              className="w-52 bg-surface-container-lowest shadow-overlay!"
              positionerClassName="z-50"
            >
              {canEdit && (
                <DropdownMenuItem onClick={() => setEditOpen(true)} className="text-xs md:hidden">
                  <span className="material-symbols-outlined text-base" aria-hidden="true">
                    edit
                  </span>
                  Edit project
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                onClick={() => setContextOpen((v) => !v)}
                className="text-xs md:hidden"
              >
                <span className="material-symbols-outlined text-base" aria-hidden="true">
                  {contextOpen ? "right_panel_close" : "right_panel_open"}
                </span>
                {contextOpen ? "Hide project context" : "Show project context"}
              </DropdownMenuItem>
              {canEdit && (
                <DropdownMenuItem
                  variant="destructive"
                  disabled={deleteProject.isPending}
                  onClick={() => setConfirmDeleteOpen(true)}
                  className="text-xs"
                >
                  <span className="material-symbols-outlined text-base" aria-hidden="true">
                    delete
                  </span>
                  Delete project
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          <button
            type="button"
            onClick={() => setContextOpen((v) => !v)}
            aria-pressed={contextOpen}
            aria-label={contextOpen ? "Hide project context" : "Show project context"}
            title={contextOpen ? "Hide project context" : "Show project context"}
            className={[
              "hidden h-8 w-8 items-center justify-center rounded-lg border transition-colors md:inline-flex",
              contextOpen
                ? "border-primary bg-primary/10 text-primary"
                : "border-outline-variant bg-surface-container-lowest text-on-surface-variant hover:bg-surface-container hover:text-on-surface",
            ].join(" ")}
          >
            <span className="material-symbols-outlined text-base" aria-hidden="true">
              {contextOpen ? "right_panel_close" : "right_panel_open"}
            </span>
          </button>
        </div>
      </div>

      {actionError && (
        <Alert variant="destructive" className="mb-3">
          <AlertDescription>{actionError}</AlertDescription>
        </Alert>
      )}

      {/* Below md the tab row scrolls sideways; the right-edge fade hints at
          the tabs off-screen. */}
      <div className="relative mb-6">
        <nav className="flex gap-6 overflow-x-auto overflow-y-clip whitespace-nowrap border-b border-outline-variant">
          {TABS.map((tab) => (
            <NavLink
              key={tab.to}
              to={tab.to}
              className={({ isActive }) =>
                [
                  "-mb-px border-b-2 px-1 pb-3 font-display text-sm transition-colors",
                  isActive
                    ? "border-primary text-primary"
                    : "border-transparent text-on-surface-variant hover:text-on-surface",
                  tab.to === "gantt" ? "hidden md:inline-block" : "",
                ].join(" ")
              }
            >
              {tab.label}
            </NavLink>
          ))}
        </nav>
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-linear-to-l from-background to-transparent md:hidden"
        />
      </div>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <Outlet
          context={
            { project, openContext: () => setContextOpen(true) } satisfies ProjectOutletContext
          }
        />
      </div>

      <ProjectFormModal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        project={project}
      />

      <ConfirmModal
        open={confirmDeleteOpen}
        onClose={() => setConfirmDeleteOpen(false)}
        onConfirm={() => void handleDelete()}
        title="Delete project"
        body={`Delete project "${project.name}"? This permanently removes its ${project._count.tasks} ${
          project._count.tasks === 1 ? "task" : "tasks"
        }, sections, labels, notes, risks and reviews. There is no undo.`}
        confirmLabel="Delete"
        confirmTone="danger"
        busy={deleteProject.isPending}
      />

      {newTaskOpen && (
        <TaskFormModal
          mode="create"
          open={newTaskOpen}
          onClose={() => setNewTaskOpen(false)}
          projectId={project.id}
        />
      )}

      <RightSidebar
        project={project}
        open={contextOpen}
        onClose={() => setContextOpen(false)}
      />

      {openTaskId !== null && (
        <TaskPanel
          key={openTaskId}
          projectId={project.id}
          taskId={openTaskId}
          onOpenTask={openTaskPanel}
          onClose={closeTaskPanel}
        />
      )}
    </div>
    </GanttExportProvider>
  );
}

export function useProjectContext(): ProjectOutletContext {
  return useOutletContext<ProjectOutletContext>();
}
