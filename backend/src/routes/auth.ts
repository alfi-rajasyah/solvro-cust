import { Router } from "express";
import bcrypt from "bcrypt";
import { type TokenPayload } from "google-auth-library";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { requireAuth, signToken } from "../http/auth.js";
import { HttpError } from "../http/errors.js";
import { validate } from "../http/validate.js";
import { getAuthConfigCached } from "../authConfig.js";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const googleLoginSchema = z.object({
  idToken: z.string().min(1),
});

export const authRouter = Router();

authRouter.post("/login", validate("body", loginSchema), async (req, res) => {
  const { email, password } = req.body as z.infer<typeof loginSchema>;

  const user = await prisma.user.findUnique({
    where: { email },
    include: { role: true },
  });

  // Google-provisioned users have no password hash. Reject explicitly so
  // the frontend can point them at the Google button instead of letting
  // them keep retrying credentials that don't exist.
  if (user && user.passwordHash === null) {
    throw new HttpError(
      401,
      "google_only",
      "This account uses Google sign-in. Please use the Google button.",
    );
  }

  const ok =
    user && user.passwordHash
      ? await bcrypt.compare(password, user.passwordHash)
      : false;
  if (!user || !ok) {
    throw new HttpError(401, "invalid_credentials", "Invalid email or password");
  }
  if (!user.active) {
    throw new HttpError(403, "account_disabled", "Account has been deactivated");
  }

  const permissions = Array.isArray(user.role.permissions)
    ? (user.role.permissions as unknown[]).filter(
        (p): p is string => typeof p === "string",
      )
    : [];
  const token = signToken({
    sub: user.id,
    role: user.role.roleName,
    permissions,
  });
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
// create the user, mint the same {sub, role, permissions} JWT that
// /auth/login mints, and return an identical response shape.
authRouter.post("/google", validate("body", googleLoginSchema), async (req, res) => {
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
    throw new HttpError(401, "invalid_token", "Google ID token verification failed");
  }
  if (!payload || !payload.email) {
    throw new HttpError(401, "invalid_token", "Google ID token missing email");
  }
  if (payload.email_verified !== true) {
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

    const baseUsername = email.split("@")[0] || `user-${googleSub.slice(0, 8)}`;
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

  const permissions = Array.isArray(user.role.permissions)
    ? (user.role.permissions as unknown[]).filter(
        (p): p is string => typeof p === "string",
      )
    : [];
  const token = signToken({
    sub: user.id,
    role: user.role.roleName,
    permissions,
  });
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
    const username = attempt === 0 ? baseUsername : `${baseUsername}-${attempt + 1}`;
    try {
      return await prisma.user.create({
        data: { ...data, username },
        include: { role: true },
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002" &&
        Array.isArray(err.meta?.target) &&
        (err.meta?.target as string[]).includes("username")
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
  const permissions = Array.isArray(user.role.permissions)
    ? (user.role.permissions as unknown[]).filter(
        (p): p is string => typeof p === "string",
      )
    : [];
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
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash },
    });
    res.status(204).end();
  },
);
