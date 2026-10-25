import { lazy, Suspense, type ComponentType } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { AdminGuard } from "@/components/AdminGuard";
import { AuthGuard } from "@/components/AuthGuard";
import { ExecutiveGuard } from "@/components/ExecutiveGuard";
import { PermissionGuard } from "@/components/PermissionGuard";
import { Shell } from "@/components/layout/Shell";
import { EmbedInvalidLink } from "@/components/embed/EmbedInvalidLink";
import { PageLoading } from "@/components/skeletons";
import { Login } from "@/pages/Login";
import { Overview } from "@/pages/Overview";

/**
 * A page loaded on first visit, in its own chunk, so the first download holds
 * only the shell, the sign-in page and the Overview. Suspense boundaries sit in
 * `Shell` and `ProjectDetail` (around their `<Outlet />`, so the chrome stays)
 * and around `<Routes>` below; a chunk that fails to load reaches the page
 * error boundary, whose Reload fetches the current build.
 */
function lazyPage<K extends string>(load: () => Promise<Record<K, ComponentType>>, name: K) {
  return lazy(() => load().then((m) => ({ default: m[name] })));
}

const Admin = lazyPage(() => import("@/pages/Admin"), "Admin");
const CustomerDetail = lazyPage(() => import("@/pages/CustomerDetail"), "CustomerDetail");
const Customers = lazyPage(() => import("@/pages/Customers"), "Customers");
const DailyReview = lazyPage(() => import("@/pages/DailyReview"), "DailyReview");
const EmbedStatus = lazyPage(() => import("@/pages/embed/EmbedStatus"), "EmbedStatus");
const EmbedTasks = lazyPage(() => import("@/pages/embed/EmbedTasks"), "EmbedTasks");
const EmbedTimeline = lazyPage(() => import("@/pages/embed/EmbedTimeline"), "EmbedTimeline");
const Executive = lazyPage(() => import("@/pages/Executive"), "Executive");
const Help = lazyPage(() => import("@/pages/Help"), "Help");
const ProjectDetail = lazyPage(() => import("@/pages/ProjectDetail"), "ProjectDetail");
const Projects = lazyPage(() => import("@/pages/Projects"), "Projects");
const PublicShare = lazyPage(() => import("@/pages/PublicShare"), "PublicShare");
const Settings = lazyPage(() => import("@/pages/Settings"), "Settings");
const Tasks = lazyPage(() => import("@/pages/Tasks"), "Tasks");
const Utilization = lazyPage(() => import("@/pages/Utilization"), "Utilization");
const WeeklySync = lazyPage(() => import("@/pages/WeeklySync"), "WeeklySync");
const ProjectEpics = lazyPage(() => import("@/pages/views/ProjectEpics"), "ProjectEpics");
const ProjectGantt = lazyPage(() => import("@/pages/views/ProjectGantt"), "ProjectGantt");
const ProjectKanban = lazyPage(() => import("@/pages/views/ProjectKanban"), "ProjectKanban");
const ProjectList = lazyPage(() => import("@/pages/views/ProjectList"), "ProjectList");
const ProjectOverview = lazyPage(() => import("@/pages/views/ProjectOverview"), "ProjectOverview");
const ProjectRisks = lazyPage(() => import("@/pages/views/ProjectRisks"), "ProjectRisks");
const ProjectServices = lazyPage(() => import("@/pages/views/ProjectServices"), "ProjectServices");
const ProjectDocs = lazyPage(() => import("@/pages/views/ProjectDocs"), "ProjectDocs");
const ProjectTimeline = lazyPage(() => import("@/pages/views/ProjectTimeline"), "ProjectTimeline");

/**
 * `/projects/:id` → its Overview tab. Carries `?task=` (and any other query or
 * hash) across the redirect so a shared task link still opens the panel.
 */
function ProjectIndexRedirect() {
  const { search, hash } = useLocation();
  return <Navigate to={{ pathname: "overview", search, hash }} replace />;
}

export function App() {
  return (
    // Covers the pages outside the shell (guest and embed views), which have
    // no padding of their own; Shell and ProjectDetail hold their own boundary.
    <Suspense fallback={<PageLoading className="p-4" />}>
      <Routes>
        <Route path="/login" element={<Login />} />
        {/* Guest link view: outside AuthGuard and the app shell, never redirects. */}
        <Route path="/share/:token" element={<PublicShare />} />
        {/* Unknown paths under the two framable prefixes render in place. The global
            catch-all below redirects to the app, which must never happen inside a
            frame that was allowed by the widened frame-ancestors for these prefixes. */}
        <Route path="share/*" element={<EmbedInvalidLink kind="guest" />} />
        {/* Outline embeds: outside AuthGuard and the app shell (no sidebar, top bar
            or install banner). They settle sign-in themselves and never redirect to
            the login form, which cannot run inside a frame. */}
        <Route path="embed/projects/:id/tasks" element={<EmbedTasks />} />
        <Route path="embed/projects/:id/status" element={<EmbedStatus />} />
        <Route path="embed/projects/:id/timeline" element={<EmbedTimeline />} />
        <Route path="embed/*" element={<EmbedInvalidLink kind="embed" />} />

        <Route
          element={
            <AuthGuard>
              <Shell />
            </AuthGuard>
          }
        >
          <Route index element={<Navigate to="/overview" replace />} />
          <Route path="overview" element={<Overview />} />
          {/* Gated on project:read like the nav entry and GET /projects. */}
          <Route
            path="projects"
            element={
              <PermissionGuard permission="project:read">
                <Projects />
              </PermissionGuard>
            }
          />
          <Route
            path="projects/:id"
            element={
              <PermissionGuard permission="project:read">
                <ProjectDetail />
              </PermissionGuard>
            }
          >
            <Route index element={<ProjectIndexRedirect />} />
            <Route path="overview" element={<ProjectOverview />} />
            <Route path="list" element={<ProjectList />} />
            <Route path="kanban" element={<ProjectKanban />} />
            <Route path="gantt" element={<ProjectGantt />} />
            <Route path="epics" element={<ProjectEpics />} />
            <Route path="timeline" element={<ProjectTimeline />} />
            <Route path="risks" element={<ProjectRisks />} />
            <Route path="services" element={<ProjectServices />} />
            <Route path="docs" element={<ProjectDocs />} />
          </Route>
          {/* Customers and Daily Review are gated on project:read, like their nav
              entries and API routes (docs/archive/plans/internal-sync.md). */}
          <Route
            path="customers"
            element={
              <PermissionGuard permission="project:read">
                <Customers />
              </PermissionGuard>
            }
          />
          <Route
            path="customers/:id"
            element={
              <PermissionGuard permission="project:read">
                <CustomerDetail />
              </PermissionGuard>
            }
          />
          <Route
            path="daily-review"
            element={
              <PermissionGuard permission="project:read">
                <DailyReview />
              </PermissionGuard>
            }
          />
          <Route
            path="weekly-sync"
            element={
              <PermissionGuard permission="project:read">
                <WeeklySync />
              </PermissionGuard>
            }
          />
          <Route path="tasks" element={<Tasks />} />
          {/* Utilization is gated on project:read, like its nav entry — hours mean
              nothing without project access (docs/archive/plans/internal-sync.md). */}
          <Route
            path="utilization"
            element={
              <PermissionGuard permission="project:read">
                <Utilization />
              </PermissionGuard>
            }
          />
          <Route path="work-logs" element={<Navigate to="/utilization" replace />} />
          <Route
            path="executive"
            element={
              <ExecutiveGuard>
                <Executive />
              </ExecutiveGuard>
            }
          />
          <Route path="settings" element={<Settings />} />
          <Route path="help" element={<Help />} />
          <Route
            path="admin"
            element={
              <AdminGuard>
                <Admin />
              </AdminGuard>
            }
          />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
