import type { RequestHandler } from "express";
import jwt, { type SignOptions } from "jsonwebtoken";
import { env } from "../env.js";
import { prisma } from "../prisma.js";
import { HttpError } from "./errors.js";

/**
 * The acting user as every route sees it (`req.user`). Since the 2026-10
 * security hardening (docs/archive/plans/internal-sync.md) `role` and
 * `permissions` come from the database on every request, not from the
 * token — a role change or a permission edit applies to live sessions at once.
 */
export interface JwtPayload {
  sub: number;
  role: string;
  permissions: string[];
}

/**
 * What the signed token actually carries: the user id and the user's
 * `tokenVersion` at issue time. A password change or an admin reset bumps
 * the version (routes/auth.ts, routes/admin.ts; so does a deactivation) and
 * every older token stops verifying.
 */
export interface TokenClaims {
  sub: number;
  ver: number;
}

/**
 * True if the user's role grants the given permission. Wildcard "*" in the
 * user's permissions grants everything (built-in ADMIN and any custom role
 * the deployer set up with full access).
 */
export function hasPermission(payload: JwtPayload, permission: string): boolean {
  return payload.permissions.includes("*") || payload.permissions.includes(permission);
}

/** A Role's JSON `permissions` column as a clean string array. */
export function permissionsOf(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((p): p is string => typeof p === "string") : [];
}

declare module "express-serve-static-core" {
  interface Request {
    user?: JwtPayload;
  }
}

/**
 * Hard ceiling on a session: refreshing (POST /auth/refresh) can extend it,
 * but never past this long after the original sign-in. A fixed constant, not
 * an env var — env.ts has no per-feature lifetime knobs to extend.
 */
export const SESSION_MAX_AGE_SECONDS = 24 * 60 * 60;

/**
 * Issues a session token: the user id, the user's current `tokenVersion` and
 * `auth_time` (epoch seconds of the ORIGINAL sign-in; a refresh passes the
 * old value through). Nothing else is embedded — role and permissions are
 * read from the database on every request. `maxExp` (epoch seconds) caps the
 * expiry below the usual lifetime.
 */
export function signToken(
  claims: TokenClaims,
  opts: { authTime?: number; maxExp?: number } = {},
): string {
  const authTime = opts.authTime ?? Math.floor(Date.now() / 1000);
  const payload = { ...claims, auth_time: authTime };
  const signOpts: SignOptions = {
    expiresIn: env.JWT_EXPIRES_IN as SignOptions["expiresIn"],
    algorithm: "HS256",
  };
  const token = jwt.sign(payload, env.JWT_SECRET, signOpts);
  if (opts.maxExp === undefined) return token;
  const exp = (jwt.decode(token) as { exp: number }).exp;
  if (exp <= opts.maxExp) return token;
  return jwt.sign({ ...payload, exp: opts.maxExp }, env.JWT_SECRET, { algorithm: "HS256" });
}

export function verifyToken(token: string): TokenClaims {
  const decoded = jwt.verify(token, env.JWT_SECRET, { algorithms: ["HS256"] });
  if (typeof decoded === "string") {
    throw new HttpError(401, "invalid_token", "Invalid token");
  }
  const sub = decoded.sub;
  const ver = (decoded as { ver?: unknown }).ver;
  if (typeof sub !== "number") {
    throw new HttpError(401, "invalid_token", "Invalid token payload");
  }
  // Tokens issued before the version claim existed embedded a role and a
  // permission list that can no longer be trusted — reject them so every
  // pre-upgrade session ends at deploy and signs in again.
  if (typeof ver !== "number") {
    throw new HttpError(401, "token_revoked", "Your session has expired. Please sign in again.");
  }
  return { sub, ver };
}

/**
 * The per-request account check: the user must still exist, be active, and
 * hold the token's version. Two cheap primary-key queries per request (the
 * user, then its role — Prisma resolves the nested select that way). 401
 * (not 403) on every failure so the frontend signs the session out.
 */
async function resolveUser(claims: TokenClaims): Promise<JwtPayload> {
  const user = await prisma.user.findUnique({
    where: { id: claims.sub },
    select: {
      active: true,
      tokenVersion: true,
      role: { select: { roleName: true, permissions: true } },
    },
  });
  if (!user) {
    throw new HttpError(401, "unauthenticated", "This account no longer exists");
  }
  if (!user.active) {
    throw new HttpError(401, "account_disabled", "Account has been deactivated");
  }
  if (user.tokenVersion !== claims.ver) {
    throw new HttpError(401, "token_revoked", "Your session has expired. Please sign in again.");
  }
  return {
    sub: claims.sub,
    role: user.role.roleName,
    permissions: permissionsOf(user.role.permissions),
  };
}

export const requireAuth: RequestHandler = (req, _res, next) => {
  // Several routers share a mount path (`/projects` carries several — app.ts),
  // and each one runs its own `router.use(requireAuth)`. The first pass
  // resolved the account; the later passes must not repeat the lookup.
  // Only this middleware ever sets `req.user`.
  if (req.user) return next();
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return next(new HttpError(401, "unauthenticated", "Missing bearer token"));
  }
  let claims: TokenClaims;
  try {
    claims = verifyToken(header.slice("Bearer ".length).trim());
  } catch (err) {
    if (err instanceof HttpError) return next(err);
    return next(new HttpError(401, "unauthenticated", "Invalid or expired token"));
  }
  // Express 4 does not catch a rejected promise from a handler — route both
  // outcomes through `next` explicitly.
  resolveUser(claims).then(
    (user) => {
      req.user = user;
      next();
    },
    (err: unknown) => next(err),
  );
};

export function requireRole(...roles: string[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.user) return next(new HttpError(401, "unauthenticated", "Not authenticated"));
    if (!roles.includes(req.user.role)) {
      return next(new HttpError(403, "forbidden", "Insufficient role"));
    }
    next();
  };
}

/**
 * Permission-based gate. Use this for action authorization (project:write,
 * task:write, etc.) so custom roles created by admin can be granted access
 * by listing the right permissions, rather than hardcoded role names.
 */
export function requirePermission(permission: string): RequestHandler {
  return (req, _res, next) => {
    if (!req.user) return next(new HttpError(401, "unauthenticated", "Not authenticated"));
    if (!hasPermission(req.user, permission)) {
      return next(new HttpError(403, "forbidden", `Missing permission: ${permission}`));
    }
    next();
  };
}

// Admin gate — must run AFTER requireAuth. Admin access is permission-based,
// not role-name based: any role whose permissions include the "*" wildcard
// is an admin (the built-in ADMIN role, plus any custom role the deployer
// grants full access). Use as a router-level middleware for the entire
// /admin tree, not per-route.
export const requireAdmin: RequestHandler = (req, _res, next) => {
  if (!req.user) return next(new HttpError(401, "unauthenticated", "Not authenticated"));
  if (!hasPermission(req.user, "*")) {
    return next(new HttpError(403, "forbidden", "Admin access required"));
  }
  next();
};
