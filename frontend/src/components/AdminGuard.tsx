import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { hasPermission, useAuth } from "@/lib/auth";

export function AdminGuard({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  // Admin access is permission-based: any role with the "*" wildcard.
  if (!hasPermission(user, "*")) {
    return <Navigate to="/overview" replace />;
  }
  return <>{children}</>;
}
