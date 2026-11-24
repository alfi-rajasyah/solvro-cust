import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router";
import { useAuth } from "@/lib/auth";
import { SessionExpiryPrompt } from "@/components/SessionExpiryPrompt";
import { PageLoading } from "@/components/skeletons";

export function AuthGuard({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const location = useLocation();

  if (status === "loading") return <AuthLoading />;

  if (status !== "authenticated") {
    // Keep the query and hash so a deep link such as /projects/6?task=42
    // survives the sign-in round trip.
    const from = location.pathname + location.search + location.hash;
    return <Navigate to="/login" replace state={{ from }} />;
  }

  return (
    <>
      {children}
      <SessionExpiryPrompt />
    </>
  );
}

/** Placeholder while the signed-in user is still being confirmed. */
export function AuthLoading() {
  return <PageLoading className="p-4" />;
}
