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
export const BUILTIN_ROLES = ["TAM", "ADMIN", "STAKEHOLDER", "PENDING"] as const;
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
  { value: "project:view-all", label: "See all projects", hint: "Visibility: see every project, not just the ones where you're the assigned TAM or that belong to a customer you own." },
  { value: "project:read", label: "View projects", hint: "See projects, risks, sections, notes." },
  { value: "project:write", label: "Manage projects", hint: "Create/edit projects, risks, sections, baselines." },
  { value: "task:read", label: "View tasks", hint: "See tasks and subtasks." },
  { value: "task:write", label: "Manage tasks", hint: "Create, edit, move, and delete tasks." },
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
  /**
   * True once `user` came from the server in this page load (a login
   * response or the boot-time `/auth/me`), false while it is only the
   * localStorage copy — which can be missing (a reload right after login) or
   * stale (permissions changed since). Permission guards must not redirect
   * away on a denial until this is true.
   */
  userVerified: boolean;
  login: (email: string, password: string) => Promise<void>;
  loginWithGoogle: (idToken: string) => Promise<void>;
  logout: () => void;
}

const USER_STORAGE_KEY = "solvro.user";

// Written synchronously on login (not only from the effect below), so a
// full page load immediately after login already finds the cached user
// next to the token that `setToken` stored synchronously.
function persistUser(user: AuthUser | null) {
  if (user) localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(user));
  else localStorage.removeItem(USER_STORAGE_KEY);
}

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
  const [userVerified, setUserVerified] = useState(false);

  useEffect(() => {
    persistUser(user);
  }, [user]);

  // Rehydrate from /auth/me on boot when we have a token. This refreshes the
  // cached user (notably the `permissions` array, which may be missing or
  // stale on bundles upgraded from before that field existed). If the token
  // is invalid/expired the call 401s and we log the user out cleanly.
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    // Timed out so a request that never settles ends in the catch below
    // (clean logout → /login) instead of leaving the permission guards on
    // "Loading…" forever.
    apiRequest<AuthUser>("/auth/me", { signal: AbortSignal.timeout(15_000) })
      .then((fresh) => {
        if (cancelled) return;
        setUser(fresh);
        setUserVerified(true);
        setStatus("authenticated");
      })
      .catch(() => {
        if (cancelled) return;
        setToken(null);
        setTokenState(null);
        setUser(null);
        setUserVerified(false);
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
      persistUser(res.user);
      setTokenState(res.token);
      setUser(res.user);
      setUserVerified(true);
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
      persistUser(res.user);
      setTokenState(res.token);
      setUser(res.user);
      setUserVerified(true);
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
    setUserVerified(false);
    setStatus("unauthenticated");
    // A running iTop timer is user-scoped (components/itop/useTicketTimer.ts) and must not leak into the next login on this browser.
    Object.keys(localStorage)
      .filter((k) => k.startsWith("solvro.itopTimer."))
      .forEach((k) => localStorage.removeItem(k));
  }, []);

  const value = useMemo(
    () => ({ user, token, status, userVerified, login, loginWithGoogle, logout }),
    [user, token, status, userVerified, login, loginWithGoogle, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
