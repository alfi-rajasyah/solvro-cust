// @vitest-environment jsdom
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import type { AuthUser } from "@/lib/auth";
import { AuthGuard } from "./AuthGuard";
import { AdminGuard } from "./AdminGuard";
import { PermissionGuard } from "./PermissionGuard";
import { ExecutiveGuard } from "./ExecutiveGuard";

// The guards only read useAuth(); hasPermission stays the real implementation
// so the permission rules under test are the app's own.
const auth = {
  status: "authenticated" as "loading" | "authenticated" | "unauthenticated",
  user: null as AuthUser | null,
  userVerified: false,
};
vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return { ...actual, useAuth: () => auth };
});

afterEach(() => {
  cleanup();
  auth.status = "authenticated";
  auth.user = null;
  auth.userVerified = false;
});

function userWith(permissions: string[]): AuthUser {
  return { id: 1, email: "a@solvro.pl", name: "A", role: "TAM", permissions } as unknown as AuthUser;
}

function Where() {
  const loc = useLocation();
  return <p data-testid="where">{loc.pathname}</p>;
}

function renderAt(initial: string, guarded: ReactNode, path = "/secret") {
  return render(
    <MemoryRouter initialEntries={[initial]}>
      <Routes>
        <Route path={path} element={guarded} />
        <Route path="/login" element={<Login />} />
        <Route path="/overview" element={<><p>overview page</p><Where /></>} />
      </Routes>
    </MemoryRouter>,
  );
}

function Login() {
  const loc = useLocation();
  const from = (loc.state as { from?: string } | null)?.from ?? "";
  return <p data-testid="login">{`login from=${from}`}</p>;
}

describe("AuthGuard", () => {
  it("redirects a signed-out visitor to /login and remembers the deep link, query and hash", () => {
    auth.status = "unauthenticated";
    renderAt("/secret?task=42#c", <AuthGuard><p>secret</p></AuthGuard>);
    expect(screen.queryByText("secret")).toBeNull();
    expect(screen.getByTestId("login").textContent).toBe("login from=/secret?task=42#c");
  });

  it("renders its children when authenticated", () => {
    renderAt("/secret", <AuthGuard><p>secret</p></AuthGuard>);
    expect(screen.getByText("secret")).toBeTruthy();
  });

  it("shows a loading placeholder, neither children nor a redirect, while loading", () => {
    auth.status = "loading";
    renderAt("/secret", <AuthGuard><p>secret</p></AuthGuard>);
    expect(screen.getByText(/Loading/)).toBeTruthy();
    expect(screen.queryByText("secret")).toBeNull();
    expect(screen.queryByTestId("login")).toBeNull();
  });
});

describe("AdminGuard", () => {
  it("renders for a user holding the * wildcard", () => {
    auth.user = userWith(["*"]);
    renderAt("/secret", <AdminGuard><p>admin area</p></AdminGuard>);
    expect(screen.getByText("admin area")).toBeTruthy();
  });

  it("redirects a verified non-admin to /overview", () => {
    auth.user = userWith(["task:read"]);
    auth.userVerified = true;
    renderAt("/secret", <AdminGuard><p>admin area</p></AdminGuard>);
    expect(screen.queryByText("admin area")).toBeNull();
    expect(screen.getByText("overview page")).toBeTruthy();
  });

  it("waits (no redirect) while the cached non-admin user is not yet server-verified", () => {
    auth.user = userWith([]);
    auth.userVerified = false;
    renderAt("/secret", <AdminGuard><p>admin area</p></AdminGuard>);
    expect(screen.getByText(/Loading/)).toBeTruthy();
    expect(screen.queryByText("overview page")).toBeNull();
  });

  it("waits when there is no cached user at all and verification is pending", () => {
    renderAt("/secret", <AdminGuard><p>admin area</p></AdminGuard>);
    expect(screen.getByText(/Loading/)).toBeTruthy();
  });
});

describe("PermissionGuard", () => {
  it("renders for a user with exactly that permission", () => {
    auth.user = userWith(["report:executive"]);
    renderAt("/secret", <PermissionGuard permission="report:executive"><p>ok</p></PermissionGuard>);
    expect(screen.getByText("ok")).toBeTruthy();
  });

  it("renders for the * wildcard", () => {
    auth.user = userWith(["*"]);
    renderAt("/secret", <PermissionGuard permission="anything:at-all"><p>ok</p></PermissionGuard>);
    expect(screen.getByText("ok")).toBeTruthy();
  });

  it("redirects a verified user lacking the permission, even if they hold others", () => {
    auth.user = userWith(["task:read"]);
    auth.userVerified = true;
    renderAt("/secret", <PermissionGuard permission="report:executive"><p>ok</p></PermissionGuard>);
    expect(screen.queryByText("ok")).toBeNull();
    expect(screen.getByTestId("where").textContent).toBe("/overview");
  });

  it("does not redirect on an unverified cached user", () => {
    auth.user = userWith([]);
    renderAt("/secret", <PermissionGuard permission="x"><p>ok</p></PermissionGuard>);
    expect(screen.getByText(/Loading/)).toBeTruthy();
    expect(screen.queryByTestId("where")).toBeNull();
  });
});

describe("ExecutiveGuard", () => {
  it("is gated on report:executive", () => {
    auth.user = userWith(["report:executive"]);
    renderAt("/secret", <ExecutiveGuard><p>exec</p></ExecutiveGuard>);
    expect(screen.getByText("exec")).toBeTruthy();
  });

  it("redirects a verified user without report:executive", () => {
    auth.user = userWith(["project:read"]);
    auth.userVerified = true;
    renderAt("/secret", <ExecutiveGuard><p>exec</p></ExecutiveGuard>);
    expect(screen.queryByText("exec")).toBeNull();
    expect(screen.getByText("overview page")).toBeTruthy();
  });
});
