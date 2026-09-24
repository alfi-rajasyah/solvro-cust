import { Navigate, Route, Routes } from "react-router-dom";
import { AdminGuard } from "@/components/AdminGuard";
import { AuthGuard } from "@/components/AuthGuard";
import { ExecutiveGuard } from "@/components/ExecutiveGuard";
import { Shell } from "@/components/layout/Shell";
import { Admin } from "@/pages/Admin";
import { CustomerDetail } from "@/pages/CustomerDetail";
import { Customers } from "@/pages/Customers";
import { DailyReview } from "@/pages/DailyReview";
import { Executive } from "@/pages/Executive";
import { Help } from "@/pages/Help";
import { Login } from "@/pages/Login";
import { Overview } from "@/pages/Overview";
import { ProjectDetail } from "@/pages/ProjectDetail";
import { Projects } from "@/pages/Projects";
import { Settings } from "@/pages/Settings";
import { Tasks } from "@/pages/Tasks";
import { Utilization } from "@/pages/Utilization";
import { WeeklySync } from "@/pages/WeeklySync";
import { ProjectGantt } from "@/pages/views/ProjectGantt";
import { ProjectKanban } from "@/pages/views/ProjectKanban";
import { ProjectList } from "@/pages/views/ProjectList";
import { ProjectOverview } from "@/pages/views/ProjectOverview";
import { ProjectRisks } from "@/pages/views/ProjectRisks";
import { ProjectServices } from "@/pages/views/ProjectServices";
import { ProjectTimeline } from "@/pages/views/ProjectTimeline";

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />

      <Route
        element={
          <AuthGuard>
            <Shell />
          </AuthGuard>
        }
      >
        <Route index element={<Navigate to="/overview" replace />} />
        <Route path="overview" element={<Overview />} />
        <Route path="projects" element={<Projects />} />
        <Route path="projects/:id" element={<ProjectDetail />}>
          <Route index element={<Navigate to="overview" replace />} />
          <Route path="overview" element={<ProjectOverview />} />
          <Route path="list" element={<ProjectList />} />
          <Route path="kanban" element={<ProjectKanban />} />
          <Route path="gantt" element={<ProjectGantt />} />
          <Route path="timeline" element={<ProjectTimeline />} />
          <Route path="risks" element={<ProjectRisks />} />
          <Route path="services" element={<ProjectServices />} />
        </Route>
        <Route path="customers" element={<Customers />} />
        <Route path="customers/:id" element={<CustomerDetail />} />
        <Route path="daily-review" element={<DailyReview />} />
        <Route path="weekly-sync" element={<WeeklySync />} />
        <Route path="tasks" element={<Tasks />} />
        <Route path="utilization" element={<Utilization />} />
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
