import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { hasPermission, useAuth } from "@/lib/auth";

export function ExecutiveGuard({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  if (!hasPermission(user, "report:executive")) {
    return <Navigate to="/overview" replace />;
  }
  return <>{children}</>;
}
