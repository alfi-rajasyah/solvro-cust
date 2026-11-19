import { Suspense, useEffect, useRef, useState } from "react";
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
import { DeleteProjectDialog } from "@/components/DeleteProjectDialog";
import { CopyLinkStatus, useCopyLinkFeedback } from "@/components/CopyLinkButton";
import { RightSidebar } from "@/components/layout/RightSidebar";
import { OutlineLinkButton } from "@/components/OutlineLinkButton";
import { ProjectFormModal } from "@/components/ProjectFormModal";
import { ProjectHeaderFacts } from "@/components/ProjectHeaderFacts";
import { ProjectMembersButton } from "@/components/ProjectMembers";
import { EmbedInOutlineDialog } from "@/components/EmbedInOutline";
import { ProjectShareButton } from "@/components/ProjectShare";
import { TaskFormModal } from "@/components/TaskFormModal";
import { Alert, AlertDescription } from "@/components/reui/alert";
import { QueryErrorAlert } from "@/components/QueryErrorAlert";
import { PageLoading, ProjectPageSkeleton } from "@/components/skeletons";
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
import { canOwnProject, saveErrorMessage } from "@/lib/ownerAccess";
import { safeOutlineHref } from "@/lib/outlineUrl";
import {
  type ProjectDetail as ProjectDetailType,
  useDeleteProject,
  useOutlineConfig,
  useProject,
} from "@/lib/queries";

// The backend answers 404 both for a missing project and for one the caller
// can't see, so the message covers both (link sharing, C1/L1).
const PROJECT_BLOCKED_MESSAGE =
  "This project doesn't exist or isn't shared with you. Ask the project's TAM to add you as a member.";

const TABS = [
  { to: "overview", label: "Overview" },
  { to: "list", label: "List" },
  { to: "kanban", label: "Kanban" },
  { to: "gantt", label: "Gantt" },
  { to: "epics", label: "Epics" },
  { to: "timeline", label: "Timeline" },
  { to: "risks", label: "Risks" },
  { to: "services", label: "Services" },
  // Outline pages under the project's link; only offered once an Outline address is set.
  { to: "docs", label: "Docs" },
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
  const { data: outlineConfig } = useOutlineConfig();
  // Outline features exist only once an administrator has set an Outline address.
  const embedAvailable = Boolean(outlineConfig?.baseUrl);
  const [editOpen, setEditOpen] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [embedOpen, setEmbedOpen] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const [newTaskOpen, setNewTaskOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const deleteProject = useDeleteProject();
  // "Copy link" lives in the ⋯ menu, which closes on click, so the result is
  // announced from a status next to the trigger.
  const { feedback: copyFeedback, copy: copyLink } = useCopyLinkFeedback();

  const { data: project, isLoading, isError, error, refetch } = useProject(projectId);

  // On a narrow phone the tab strip scrolls sideways; bring the active tab into
  // view after navigation. Sets scrollLeft only (scrollIntoView would also scroll
  // the page's <main> vertically and runs where nothing overflows), and aims 32px
  // short of the right edge to clear the fade. Never touches focus.
  const tabNavRef = useRef<HTMLElement>(null);
  const tabsMounted = !!project;
  useEffect(() => {
    const nav = tabNavRef.current;
    if (!nav || nav.scrollWidth <= nav.clientWidth) return;
    const tab = nav.querySelector<HTMLElement>('[aria-current="page"]');
    if (!tab) return;
    const FADE = 32;
    const left = tab.offsetLeft;
    const right = left + tab.offsetWidth + FADE;
    if (left < nav.scrollLeft) nav.scrollLeft = left;
    else if (right > nav.scrollLeft + nav.clientWidth) nav.scrollLeft = right - nav.clientWidth;
  }, [location.pathname, tabsMounted, embedAvailable]);

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
  // Members (access via membership alone) can edit but not hand the project
  // to another TAM/customer or delete it — the server answers 403 owner_only.
  // Owner of ANY linked customer counts (docs/archive/plans/multi-customer-projects.md).
  const customerOwnerIds = (project?.customers ?? []).map((c) => c.tamId);
  const isOwner = project ? canOwnProject(user, project, customerOwnerIds) : false;
  const canDelete = canEdit && isOwner;
  const outlineHref = safeOutlineHref(project?.outlineUrl);
  // ⌘K palette "Add task": opens the create form on whichever tab is showing.
  useNewParam("task", hasPermission(user, "task:write"), () => setNewTaskOpen(true));

  if (isLoading) {
    return <ProjectPageSkeleton />;
  }

  if (isError || !project) {
    return (
      <QueryErrorAlert
        title={
          error instanceof ApiError && error.status === 404
            ? PROJECT_BLOCKED_MESSAGE
            : error instanceof Error
              ? error.message
              : PROJECT_BLOCKED_MESSAGE
        }
        // A 404 is a permanent answer (gone or no access) — retrying cannot change it.
        onRetry={error instanceof ApiError && error.status === 404 ? undefined : refetch}
      >
        <Link to="/projects" className="font-bold underline">
          Back to Projects
        </Link>
      </QueryErrorAlert>
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
      setActionError(saveErrorMessage(err, "Delete failed."));
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
        <h1 className="sr-only">{project.name}</h1>
        <ProjectHeaderFacts project={project} />

        {/* Edit and Copy link are the ⋯ menu's first items at every width.
            Below md the Outline link and the Context toggle join the menu; from
            md up they render as buttons. The two copies never share a viewport
            (display:none leaves the accessibility tree), so the Context
            toggle's aria-labels stay unique. Every control here is one 32px
            outlined square or pill. */}
        <div className="flex shrink-0 items-center gap-2 [@media(pointer:coarse)]:gap-3">
          <ProjectMembersButton project={project} canManage={canEdit} />
          {/* Guest links: owners only (TAM, customer owner, view-all) with
              project:write — the server answers 403 to anyone else. */}
          {canEdit && isOwner && <ProjectShareButton project={project} />}
          {/* Outline link: a button from md up, an item in the ⋯ menu below. */}
          <OutlineLinkButton url={project.outlineUrl} className="hidden md:inline-flex" />
          <div className="relative">
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <button
                    type="button"
                    aria-label="More project actions"
                    title="More project actions"
                    className="tap-target inline-flex h-8 w-8 items-center justify-center rounded-sm border border-outline-variant bg-surface-container-lowest text-on-surface-variant outline-hidden transition-colors hover:bg-surface-container hover:text-on-surface focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/30"
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
                  <DropdownMenuItem onClick={() => setEditOpen(true)} className="text-xs">
                    <span className="material-symbols-outlined text-base" aria-hidden="true">
                      edit
                    </span>
                    Edit project
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={() => void copyLink(window.location.href)} className="text-xs">
                  <span className="material-symbols-outlined text-base" aria-hidden="true">
                    link
                  </span>
                  Copy link
                </DropdownMenuItem>
                {outlineHref && (
                  <DropdownMenuItem
                    className="text-xs md:hidden"
                    render={<a href={outlineHref} target="_blank" rel="noopener noreferrer" />}
                  >
                    <span className="material-symbols-outlined text-base" aria-hidden="true">
                      menu_book
                    </span>
                    Open in Outline
                    <span className="sr-only">(opens in a new tab)</span>
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
                {embedAvailable && (
                  <DropdownMenuItem onClick={() => setEmbedOpen(true)} className="text-xs">
                    <span className="material-symbols-outlined text-base" aria-hidden="true">
                      integration_instructions
                    </span>
                    Embed in Outline
                  </DropdownMenuItem>
                )}
                {canDelete && (
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
            <CopyLinkStatus feedback={copyFeedback} />
          </div>
          <button
            type="button"
            onClick={() => setContextOpen((v) => !v)}
            aria-pressed={contextOpen}
            aria-label={contextOpen ? "Hide project context" : "Show project context"}
            title={contextOpen ? "Hide project context" : "Show project context"}
            className={[
              "tap-target hidden h-8 w-8 items-center justify-center rounded-sm border transition-colors md:inline-flex",
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
        <nav ref={tabNavRef} className="flex gap-6 overflow-x-auto overflow-y-clip whitespace-nowrap border-b border-outline-variant">
          {TABS.filter((tab) => tab.to !== "docs" || embedAvailable).map((tab) => (
            <NavLink
              key={tab.to}
              to={tab.to}
              className={({ isActive }) =>
                [
                  "-mb-px border-b-2 px-1 pb-3 font-display text-sm transition-colors [@media(pointer:coarse)]:min-w-11 [@media(pointer:coarse)]:text-center [@media(pointer:coarse)]:pt-2.5",
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
        {/* Tabs load lazily (App.tsx); the project header stays while one arrives. */}
        <Suspense fallback={<PageLoading />}>
          <Outlet
            context={
              { project, openContext: () => setContextOpen(true) } satisfies ProjectOutletContext
            }
          />
        </Suspense>
      </div>

      <ProjectFormModal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        project={project}
        canChangeOwnership={isOwner}
      />

      {embedAvailable && (
        <EmbedInOutlineDialog
          project={project}
          open={embedOpen}
          onClose={() => setEmbedOpen(false)}
          canCreateGuestLink={canEdit && isOwner}
        />
      )}
      <DeleteProjectDialog
        open={confirmDeleteOpen}
        project={project}
        onClose={() => setConfirmDeleteOpen(false)}
        onConfirm={() => void handleDelete()}
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
