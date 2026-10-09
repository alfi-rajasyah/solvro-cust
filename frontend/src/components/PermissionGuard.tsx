import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { AuthLoading } from "@/components/AuthGuard";
import { hasPermission, useAuth } from "@/lib/auth";

/**
 * Route guard for a single permission string — the generic form of
 * ExecutiveGuard/AdminGuard for pages whose nav entry carries `requires`
 * (frontend/src/lib/navCommands.ts). Keeps the sidebar rule and the route
 * rule in one place: a page hidden from the catalogue is also unreachable
 * by URL. Redirects to /overview like the other guards.
 */
export function PermissionGuard({ permission, children }: { permission: string; children: ReactNode }) {
  const { user, userVerified } = useAuth();
  if (!hasPermission(user, permission)) {
    // Same rule as AdminGuard: don't redirect on a cached user that may be
    // missing or stale — wait for the server's answer first.
    if (!userVerified) return <AuthLoading />;
    return <Navigate to="/overview" replace />;
  }
  return <>{children}</>;
}
