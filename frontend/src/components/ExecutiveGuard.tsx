import type { ReactNode } from "react";
import { PermissionGuard } from "@/components/PermissionGuard";

/** The Executive page's route guard — `PermissionGuard` fixed to `report:executive`. */
export function ExecutiveGuard({ children }: { children: ReactNode }) {
  return <PermissionGuard permission="report:executive">{children}</PermissionGuard>;
}
