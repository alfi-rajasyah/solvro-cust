import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { AuthLoading } from "@/components/AuthGuard";
import { hasPermission, useAuth } from "@/lib/auth";

export function ExecutiveGuard({ children }: { children: ReactNode }) {
  const { user, userVerified } = useAuth();
  if (!hasPermission(user, "report:executive")) {
    // Same rule as AdminGuard: don't redirect on a cached user that may be
    // missing or stale — wait for the server's answer first.
    if (!userVerified) return <AuthLoading />;
    return <Navigate to="/overview" replace />;
  }
  return <>{children}</>;
}
