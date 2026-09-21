import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { apiRequest, getToken, setToken } from "./api";

// Built-in role names referenced structurally by backend (project visibility,
// requireAdmin gate). Custom roles created via Admin > Roles tab use other
// strings; the type is `string` to allow them.
export type Role = string;
export const BUILTIN_ROLES = ["SA", "TAM", "ADMIN", "STAKEHOLDER", "PENDING"] as const;
export type BuiltinRole = (typeof BUILTIN_ROLES)[number];

export interface AuthUser {
  id: number;
  username: string;
  email: string;
  role: Role;
  permissions: string[];
}

// The permission vocabulary the app actually understands, for the Admin >
// Roles tick-box editor. The backend stores permissions as a free-form
// string array, so this is a curated catalogue (not enforced server-side) —
// keep it in sync with the `requirePermission(...)` / `hasPermission(...)`
// strings used across backend + frontend. "*" is full access (admin).
export interface PermissionDef {
  value: string;
  label: string;
  hint: string;
}
export const PERMISSION_CATALOG: PermissionDef[] = [
  { value: "*", label: "Full access (admin)", hint: "Every permission, including the Admin area. Grant sparingly." },
  { value: "project:view-all", label: "See all projects", hint: "Visibility: see every project, not just the ones you're assigned to as SA/TAM." },
  { value: "project:read", label: "View projects", hint: "See projects, risks, sections, notes." },
  { value: "project:write", label: "Manage projects", hint: "Create/edit projects, risks, sections, baselines." },
  { value: "task:read", label: "View tasks", hint: "See tasks and subtasks." },
  { value: "task:write", label: "Manage tasks", hint: "Create, edit, move, and delete tasks." },
  { value: "pipeline:view", label: "View pipeline", hint: "See the Pipeline board, opportunity details, and Pipeline analytics." },
  { value: "pipeline:create", label: "Create opportunities", hint: "Add new opportunities to the Pipeline board." },
  { value: "pipeline:edit_own", label: "Edit own opportunities", hint: "Edit and change the stage of opportunities you're the PIC for, and assign a PIC to an unassigned opportunity." },
  { value: "pipeline:edit_all", label: "Edit all opportunities", hint: "Edit and change the stage of any opportunity, not just your own." },
  { value: "pipeline:delete_own", label: "Delete own opportunities", hint: "Delete opportunities you're the PIC for." },
  { value: "pipeline:delete_all", label: "Delete all opportunities", hint: "Delete any opportunity, not just your own." },
  { value: "report:executive", label: "Executive dashboard", hint: "See the org-wide Executive portfolio dashboard (all projects across all TAMs) and overdue-projects monitoring. Read-only." },
];

/**
 * Permission check used by UI gates. Wildcard "*" grants everything; a
 * specific permission grants just that one. Custom roles created in
 * Admin > Roles can list any permission strings; the built-in roles'
 * exact grants live in backend/prisma/seed.ts.
 */
export function hasPermission(
  user: AuthUser | null | undefined,
  permission: string,
): boolean {
  if (!user) return false;
  // Defensive: a user object cached in localStorage from before the
  // permissions field was introduced won't have it. Treat missing as empty
  // so callers don't crash; the user gets fresh permissions on next login.
  const perms = user.permissions ?? [];
  return perms.includes("*") || perms.includes(permission);
}

interface LoginResponse {
  token: string;
  user: AuthUser;
}

interface AuthContextValue {
  user: AuthUser | null;
  token: string | null;
  status: "loading" | "authenticated" | "unauthenticated";
  login: (email: string, password: string) => Promise<void>;
  loginWithGoogle: (idToken: string) => Promise<void>;
  logout: () => void;
}

const USER_STORAGE_KEY = "solvro.user";

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setTokenState] = useState<string | null>(() => getToken());
  const [user, setUser] = useState<AuthUser | null>(() => {
    const raw = localStorage.getItem(USER_STORAGE_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as AuthUser;
    } catch {
      return null;
    }
  });
  const [status, setStatus] = useState<AuthContextValue["status"]>(
    token ? "authenticated" : "unauthenticated",
  );

  useEffect(() => {
    if (user) localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(user));
    else localStorage.removeItem(USER_STORAGE_KEY);
  }, [user]);

  // Rehydrate from /auth/me on boot when we have a token. This refreshes the
  // cached user (notably the `permissions` array, which may be missing or
  // stale on bundles upgraded from before that field existed). If the token
  // is invalid/expired the call 401s and we log the user out cleanly.
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    apiRequest<AuthUser>("/auth/me")
      .then((fresh) => {
        if (cancelled) return;
        setUser(fresh);
        setStatus("authenticated");
      })
      .catch(() => {
        if (cancelled) return;
        setToken(null);
        setTokenState(null);
        setUser(null);
        setStatus("unauthenticated");
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const login = useCallback(async (email: string, password: string) => {
    setStatus("loading");
    try {
      const res = await apiRequest<LoginResponse>("/auth/login", {
        method: "POST",
        body: { email, password },
        auth: false,
      });
      setToken(res.token);
      setTokenState(res.token);
      setUser(res.user);
      setStatus("authenticated");
    } catch (err) {
      setStatus("unauthenticated");
      throw err;
    }
  }, []);

  const loginWithGoogle = useCallback(async (idToken: string) => {
    setStatus("loading");
    try {
      const res = await apiRequest<LoginResponse>("/auth/google", {
        method: "POST",
        body: { idToken },
        auth: false,
      });
      setToken(res.token);
      setTokenState(res.token);
      setUser(res.user);
      setStatus("authenticated");
    } catch (err) {
      setStatus("unauthenticated");
      throw err;
    }
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    setTokenState(null);
    setUser(null);
    setStatus("unauthenticated");
  }, []);

  const value = useMemo(
    () => ({ user, token, status, login, loginWithGoogle, logout }),
    [user, token, status, login, loginWithGoogle, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
