import { Router, type Request, type Response } from "express";
import bcrypt from "bcrypt";
import { type TokenPayload } from "google-auth-library";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { permissionsOf, requireAuth, signToken } from "../http/auth.js";
import { isUsernameConflict, normalizeUsername, USERNAME_MAX } from "../lib/username.js";
import { HttpError } from "../http/errors.js";
import { validate } from "../http/validate.js";
import { getAuthConfigCached } from "../authConfig.js";
import { rateLimitKey } from "../http/rateLimit.js";
import { createFailureThrottle } from "../http/loginThrottle.js";

// Online password guessing is throttled on FAILURES only (http/loginThrottle.ts):
// after LOGIN_FAILURES_PER_EMAIL rejected attempts for one email, or
// LOGIN_FAILURES_PER_IP from one client address, within the window, the
// sign-in routes answer 429 with Retry-After. Successful sign-ins never count,
// so a user (or the browser test suite) who signs in often is not affected. A
// success clears the email counter; the address counter only expires.
export const LOGIN_FAILURES_PER_EMAIL = 10;
export const LOGIN_FAILURES_PER_IP = 50;
export const LOGIN_FAILURE_WINDOW_MS = 15 * 60_000;

export const loginEmailThrottle = createFailureThrottle({
  limit: LOGIN_FAILURES_PER_EMAIL,
  windowMs: LOGIN_FAILURE_WINDOW_MS,
});
export const loginIpThrottle = createFailureThrottle({
  limit: LOGIN_FAILURES_PER_IP,
  windowMs: LOGIN_FAILURE_WINDOW_MS,
});

/** Test-only: forgets every sign-in failure counter. */
export function resetLoginThrottlesForTests(): void {
  loginEmailThrottle.reset();
  loginIpThrottle.reset();
}

// Every rejected password sign-in must cost the same: without this, an unknown
// email or a Google-only account (no hash to compare) answered in ~1 ms while
// a real password account took a bcrypt round, which told a caller which
// emails exist. Comparing against this throw-away hash makes the three cases
// take the same time; its result is never trusted (see the `ok` expression).
const DUMMY_PASSWORD_HASH = bcrypt.hashSync("solvro-timing-equaliser-never-a-real-password", 10);

const tooManyAttempts = () =>
  new HttpError(429, "rate_limited", "Too many failed sign-in attempts. Please try again later.");

/** 429 (with Retry-After) when the client address or the email is currently blocked. */
function assertSignInAllowed(req: Request, res: Response, emailKey?: string): void {
  const now = Date.now();
  const ipWait = loginIpThrottle.blockedFor(rateLimitKey(req.ip), now);
  const emailWait = emailKey ? loginEmailThrottle.blockedFor(emailKey, now) : 0;
  const wait = Math.max(ipWait, emailWait);
  if (wait > 0) {
    res.setHeader("Retry-After", String(wait));
    throw tooManyAttempts();
  }
}

function recordSignInFailure(req: Request, emailKey?: string): void {
  loginIpThrottle.recordFailure(rateLimitKey(req.ip));
  if (emailKey) loginEmailThrottle.recordFailure(emailKey);
}

const loginSchema = z.object({
  // Emails are stored trimmed and lowercase (admin create, Google sign-in).
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
});

const googleLoginSchema = z.object({
  idToken: z.string().min(1),
});

export const authRouter = Router();

authRouter.post("/login", validate("body", loginSchema), async (req, res) => {
  const { email, password } = req.body as z.infer<typeof loginSchema>;
  const emailKey = email;
  assertSignInAllowed(req, res, emailKey);

  const user = await prisma.user.findUnique({
    where: { email },
    include: { role: true },
  });

  // One answer for an unknown email, a Google-only account (no password hash)
  // and a wrong password: anything else tells a caller which emails exist.
  // The login page itself hints at the Google button when Google sign-in is
  // enabled, without a per-account signal.
  const hash = user?.passwordHash ?? DUMMY_PASSWORD_HASH;
  const compared = await bcrypt.compare(password, hash);
  // Only a real stored hash can grant access; the dummy compare exists for timing alone.
  const ok = compared && !!user?.passwordHash;
  if (!user || !ok) {
    recordSignInFailure(req, emailKey);
    throw new HttpError(401, "invalid_credentials", "Invalid email or password");
  }
  if (!user.active) {
    throw new HttpError(403, "account_disabled", "Account has been deactivated");
  }
  loginEmailThrottle.clear(emailKey);

  const permissions = permissionsOf(user.role.permissions);
  const token = signToken({ sub: user.id, ver: user.tokenVersion });
  res.json({
    token,
    user: {
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role.roleName,
      permissions,
    },
  });
});

// Public endpoint so the Login page can fetch the runtime Client ID without
// authenticating. The Client ID is not secret (it's embedded in any Google
// sign-in button anyway); the *secret* is on Google's side.
authRouter.get("/google/config", async (_req, res) => {
  const config = await getAuthConfigCached();
  res.json({
    clientId: config.googleClientId,
    enabled:
      config.googleClientId !== null && config.googleAllowedDomains.length > 0,
  });
});

// Google sign-in. The frontend uses Google Identity Services to obtain an
// ID token, then forwards it here. We verify it server-side (signature,
// audience, expiry), gate on email_verified + domain allowlist, find or
// create the user, mint the same {sub, ver} JWT that
// /auth/login mints, and return an identical response shape.
authRouter.post("/google", validate("body", googleLoginSchema), async (req, res) => {
  // Only the client address is known before the ID token is verified.
  assertSignInAllowed(req, res);
  const config = await getAuthConfigCached();
  if (!config.googleClient || !config.googleClientId) {
    throw new HttpError(
      503,
      "oauth_not_configured",
      "Google sign-in isn't configured yet. Ask your admin to set the Client ID in Admin > Sign-in.",
    );
  }
  if (config.googleAllowedDomains.length === 0) {
    throw new HttpError(
      503,
      "oauth_not_configured",
      "Google sign-in isn't configured yet. Ask your admin to add an allowed domain.",
    );
  }

  const { idToken } = req.body as z.infer<typeof googleLoginSchema>;

  let payload: TokenPayload | undefined;
  try {
    const ticket = await config.googleClient.verifyIdToken({
      idToken,
      audience: config.googleClientId,
    });
    payload = ticket.getPayload();
  } catch {
    recordSignInFailure(req);
    throw new HttpError(401, "invalid_token", "Google ID token verification failed");
  }
  if (!payload || !payload.email) {
    recordSignInFailure(req);
    throw new HttpError(401, "invalid_token", "Google ID token missing email");
  }
  if (payload.email_verified !== true) {
    recordSignInFailure(req);
    throw new HttpError(
      401,
      "email_not_verified",
      "Google email is not verified",
    );
  }

  const email = payload.email.toLowerCase();
  const emailDomain = email.includes("@") ? email.split("@")[1] : "";
  const hd = typeof payload.hd === "string" ? payload.hd.toLowerCase() : "";
  const domainOk = config.googleAllowedDomains.some(
    (d) => d === hd || d === emailDomain,
  );
  if (!domainOk) {
    recordSignInFailure(req);
    throw new HttpError(
      403,
      "domain_not_allowed",
      "Your Google account isn't on the allowed domain list. Contact your admin.",
    );
  }

  const googleSub = payload.sub;
  const avatarUrl = typeof payload.picture === "string" ? payload.picture : null;

  let user = await prisma.user.findUnique({
    where: { googleSub },
    include: { role: true },
  });

  if (!user) {
    // Try linking by email — covers the seeded admin opting in to Google,
    // or an admin pre-creating a placeholder password row before the user
    // signs in for the first time.
    const byEmail = await prisma.user.findUnique({
      where: { email },
      include: { role: true },
    });
    if (byEmail) {
      user = await prisma.user.update({
        where: { id: byEmail.id },
        data: { googleSub, avatarUrl: avatarUrl ?? byEmail.avatarUrl },
        include: { role: true },
      });
    }
  }

  if (!user) {
    // Auto-provision into PENDING. PENDING is upserted by seed by name,
    // so its ID is stable across restarts but we look it up rather than
    // hard-code an integer.
    const pendingRole = await prisma.role.findUnique({
      where: { roleName: "PENDING" },
      select: { id: true },
    });
    if (!pendingRole) {
      throw new HttpError(
        500,
        "pending_role_missing",
        "PENDING role is missing. Re-run the database seed.",
      );
    }

    // Same username rule as POST /admin/users (lib/username.ts); a local
    // part the rule rejects falls back to a neutral generated name.
    const baseUsername =
      normalizeUsername(email.split("@")[0] ?? "") ?? `user-${googleSub.slice(0, 8)}`;
    user = await createWithUniqueUsername({
      baseUsername,
      data: {
        email,
        googleSub,
        avatarUrl,
        passwordHash: null,
        roleId: pendingRole.id,
      },
    });
  }

  if (!user.active) {
    throw new HttpError(
      403,
      "account_disabled",
      "Account has been deactivated",
    );
  }

  const permissions = permissionsOf(user.role.permissions);
  const token = signToken({ sub: user.id, ver: user.tokenVersion });
  res.json({
    token,
    user: {
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role.roleName,
      permissions,
    },
  });
});

// Two Workspace domains can share a local-part (alice@a.com + alice@b.com
// → both want username "alice"). On unique-constraint failure, retry with
// "alice-2", "alice-3", … up to a sane cap.
async function createWithUniqueUsername({
  baseUsername,
  data,
}: {
  baseUsername: string;
  data: {
    email: string;
    googleSub: string;
    avatarUrl: string | null;
    passwordHash: null;
    roleId: number;
  };
}) {
  for (let attempt = 0; attempt < 20; attempt++) {
    // A suffixed name stays within USERNAME_MAX (the base leaves room for "-20").
    const username =
      attempt === 0
        ? baseUsername
        : `${baseUsername.slice(0, USERNAME_MAX - 3).trimEnd()}-${attempt + 1}`;
    // Case-insensitive like POST /admin/users: "Maya.Putri" beside "maya.putri"
    // is the look-alike problem, so a case-variant counts as taken. Raw
    // `lower() = lower()` — Prisma's insensitive mode would read `_` as a wildcard.
    const taken = await prisma.$queryRaw<Array<{ id: number }>>`
      SELECT id FROM users WHERE lower(username) = lower(${username}) LIMIT 1
    `;
    if (taken.length > 0) continue;
    try {
      return await prisma.user.create({
        data: { ...data, username },
        include: { role: true },
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        isUsernameConflict(err)
      ) {
        continue;
      }
      throw err;
    }
  }
  throw new HttpError(
    500,
    "username_exhausted",
    "Could not derive a unique username after 20 attempts.",
  );
}

authRouter.get("/me", requireAuth, async (req, res) => {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: req.user!.sub },
    include: { role: true },
  });
  const permissions = permissionsOf(user.role.permissions);
  res.json({
    id: user.id,
    username: user.username,
    email: user.email,
    role: user.role.roleName,
    permissions,
    createdAt: user.createdAt,
  });
});

const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1),
    newPassword: z.string().min(8).max(200),
  })
  .refine((data) => data.currentPassword !== data.newPassword, {
    message: "New password must differ from the current one",
    path: ["newPassword"],
  });

authRouter.post(
  "/change-password",
  requireAuth,
  validate("body", changePasswordSchema),
  async (req, res) => {
    const { currentPassword, newPassword } = req.body as z.infer<
      typeof changePasswordSchema
    >;
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: req.user!.sub },
    });
    if (user.passwordHash === null) {
      throw new HttpError(
        400,
        "google_only",
        "This account signs in with Google and has no password to change.",
      );
    }
    const ok = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!ok) {
      throw new HttpError(
        400,
        "current_password_wrong",
        "Current password is incorrect",
      );
    }
    const passwordHash = await bcrypt.hash(newPassword, 10);
    // Bumping tokenVersion ends every other session of this account
    // (docs/archive/plans/internal-sync.md). The caller gets a token for the
    // new version so the session that changed the password continues.
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash, tokenVersion: { increment: 1 } },
      select: { tokenVersion: true },
    });
    res.json({ token: signToken({ sub: user.id, ver: updated.tokenVersion }) });
  },
);
