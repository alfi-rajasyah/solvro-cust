import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { hasPermission, useAuth } from "@/lib/auth";

export function PipelineGuard({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  if (!hasPermission(user, "pipeline:view")) {
    return <Navigate to="/overview" replace />;
  }
  return <>{children}</>;
}
