import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/lib/auth";

export function AuthGuard({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const location = useLocation();

  if (status === "loading") return <AuthLoading />;

  if (status !== "authenticated") {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return <>{children}</>;
}

/** Placeholder while the signed-in user is still being confirmed. */
export function AuthLoading() {
  return (
    <div className="flex h-full items-center justify-center text-on-surface-variant">
      Loading…
    </div>
  );
}
