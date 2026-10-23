import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { AdminGuard } from "@/components/AdminGuard";
import { AuthGuard } from "@/components/AuthGuard";
import { ExecutiveGuard } from "@/components/ExecutiveGuard";
import { PermissionGuard } from "@/components/PermissionGuard";
import { Shell } from "@/components/layout/Shell";
import { Admin } from "@/pages/Admin";
import { CustomerDetail } from "@/pages/CustomerDetail";
import { Customers } from "@/pages/Customers";
import { DailyReview } from "@/pages/DailyReview";
import { EmbedInvalidLink } from "@/components/embed/EmbedInvalidLink";
import { EmbedStatus } from "@/pages/embed/EmbedStatus";
import { EmbedTasks } from "@/pages/embed/EmbedTasks";
import { EmbedTimeline } from "@/pages/embed/EmbedTimeline";
import { Executive } from "@/pages/Executive";
import { Help } from "@/pages/Help";
import { Login } from "@/pages/Login";
import { Overview } from "@/pages/Overview";
import { ProjectDetail } from "@/pages/ProjectDetail";
import { Projects } from "@/pages/Projects";
import { PublicShare } from "@/pages/PublicShare";
import { Settings } from "@/pages/Settings";
import { Tasks } from "@/pages/Tasks";
import { Utilization } from "@/pages/Utilization";
import { WeeklySync } from "@/pages/WeeklySync";
import { ProjectEpics } from "@/pages/views/ProjectEpics";
import { ProjectGantt } from "@/pages/views/ProjectGantt";
import { ProjectKanban } from "@/pages/views/ProjectKanban";
import { ProjectList } from "@/pages/views/ProjectList";
import { ProjectOverview } from "@/pages/views/ProjectOverview";
import { ProjectRisks } from "@/pages/views/ProjectRisks";
import { ProjectServices } from "@/pages/views/ProjectServices";
import { ProjectDocs } from "@/pages/views/ProjectDocs";
import { ProjectTimeline } from "@/pages/views/ProjectTimeline";

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
  );
}
