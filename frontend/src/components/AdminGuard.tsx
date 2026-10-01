import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { AuthLoading } from "@/components/AuthGuard";
import { hasPermission, useAuth } from "@/lib/auth";

export function AdminGuard({ children }: { children: ReactNode }) {
  const { user, userVerified } = useAuth();
  // Admin access is permission-based: any role with the "*" wildcard.
  if (!hasPermission(user, "*")) {
    // The cached user can be missing or stale on a fresh page load; only
    // redirect once the server has confirmed who this is.
    if (!userVerified) return <AuthLoading />;
    return <Navigate to="/overview" replace />;
  }
  return <>{children}</>;
}
