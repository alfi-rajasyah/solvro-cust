import type { RequestHandler } from "express";
import jwt, { type SignOptions } from "jsonwebtoken";
import { env } from "../env.js";
import { HttpError } from "./errors.js";

export interface JwtPayload {
  sub: number;
  role: string;
  permissions: string[];
}

/**
 * True if the user's role grants the given permission. Wildcard "*" in the
 * user's permissions grants everything (built-in ADMIN and any custom role
 * the deployer set up with full access).
 */
export function hasPermission(payload: JwtPayload, permission: string): boolean {
  return payload.permissions.includes("*") || payload.permissions.includes(permission);
}

declare module "express-serve-static-core" {
  interface Request {
    user?: JwtPayload;
  }
}

export function signToken(payload: JwtPayload): string {
  const opts: SignOptions = { expiresIn: env.JWT_EXPIRES_IN as SignOptions["expiresIn"] };
  return jwt.sign(payload, env.JWT_SECRET, opts);
}

export function verifyToken(token: string): JwtPayload {
  const decoded = jwt.verify(token, env.JWT_SECRET);
  if (typeof decoded === "string") {
    throw new HttpError(401, "invalid_token", "Invalid token");
  }
  const sub = decoded.sub;
  const role = (decoded as { role?: unknown }).role;
  const perms = (decoded as { permissions?: unknown }).permissions;
  if (typeof sub !== "number" || typeof role !== "string" || role.length === 0) {
    throw new HttpError(401, "invalid_token", "Invalid token payload");
  }
  // Old tokens (issued before permissions were embedded) carry no permissions
  // claim — treat them as empty so they can't accidentally inherit access.
  // Users will get fresh permissions on next login.
  const permissions = Array.isArray(perms)
    ? perms.filter((p): p is string => typeof p === "string")
    : [];
  return { sub, role, permissions };
}

export const requireAuth: RequestHandler = (req, _res, next) => {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return next(new HttpError(401, "unauthenticated", "Missing bearer token"));
  }
  try {
    req.user = verifyToken(header.slice("Bearer ".length).trim());
    next();
  } catch (err) {
    if (err instanceof HttpError) return next(err);
    next(new HttpError(401, "unauthenticated", "Invalid or expired token"));
  }
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
