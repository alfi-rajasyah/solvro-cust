import "dotenv/config";
import { z } from "zod";
import { parseTrustProxy } from "./http/trustProxy.js";
import { resolveAppUrl } from "./lib/outline/appUrl.js";

const schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().url(),
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),
  JWT_EXPIRES_IN: z.string().default("8h"),
  SECRETS_KEY: z
    .string()
    .min(1, "SECRETS_KEY is required")
    .refine(
      (value) =>
        /^[A-Za-z0-9+/]{43}=$/.test(value) && Buffer.from(value, "base64").length === 32,
      {
        message:
          "SECRETS_KEY must be a base64 string that decodes to exactly 32 bytes (generate with: openssl rand -base64 32)",
      },
    ),
  CORS_ORIGIN: z.string().default("http://localhost:5173"),
  // The public origin of this Solvro deployment (e.g. https://solvro.acme.com):
  // the Outline OAuth redirect URI / webhook URL are derived from it and Solvro
  // links in Outline pages are recognised against it. CORS_ORIGIN cannot serve
  // (comma list or `*`). A bare http(s) origin - no path, query or login.
  // Defaults to the dev address outside production; in production an unset
  // value stays null and the Outline features answer 409 outline_app_url_unset
  // (requireAppUrl) rather than building localhost links.
  // docs/archive/plans/outline-integration.md (F13).
  APP_URL: z
    .string()
    .optional()
    .transform((value, ctx) => {
      const resolved = resolveAppUrl(value, process.env.NODE_ENV ?? "development");
      if (resolved === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "APP_URL must be the public Solvro origin: an http(s) address with no path, query string, fragment or login (e.g. https://solvro.acme.com)",
        });
        return z.NEVER;
      }
      return resolved;
    }),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  // How many reverse-proxy hops (or which subnets) `req.ip` may trust, i.e.
  // read from X-Forwarded-For — a hop count ("1" = nginx only, "2" = a tunnel or
  // CDN in front of nginx) or an Express list ("loopback, uniquelocal"). Feeds
  // the per-IP rate limit on the public share route.
  TRUST_PROXY: z
    .string()
    .default("1")
    .transform((value, ctx) => {
      const parsed = parseTrustProxy(value);
      if (parsed === null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            'TRUST_PROXY must be a hop count (0-10) or a comma-separated list of loopback, linklocal, uniquelocal, IP addresses or CIDR subnets (e.g. "1" or "loopback, uniquelocal")',
        });
        return z.NEVER;
      }
      return parsed;
    }),
  // Kill switch for the in-process iTop sync scheduler (lib/itop/scheduler.ts)
  // — e.g. a dev stack with no iTop admin config yet, or a maintenance window.
  // Accepts the common boolean-ish spellings (case-insensitive) since
  // docs/CONFIGURATION.md and deploy scripts write "1"/"0" for booleans
  // elsewhere — "true"/"false" alone would silently ignore ITOP_SYNC_DISABLED=1.
  ITOP_SYNC_DISABLED: z
    .string()
    .default("false")
    .transform((value) => value.trim().toLowerCase())
    .pipe(z.enum(["true", "false", "1", "0", "yes", "no"]))
    .transform((value) => value === "true" || value === "1" || value === "yes"),
  // Whether an admin may store an iTop address on a private, loopback or local
  // host (lib/itop/validateBaseUrl.ts). Default true (user decision
  // 2026-10-22): Solvro and iTop are deployed together on a LAN, so the iTop
  // address is normally a `.local` name or an RFC1918 address. Set "false" on
  // an internet-facing deployment whose iTop is public, so an admin session
  // cannot use the backend to probe the internal network. The https-only and
  // no-userinfo rules apply either way.
  ITOP_ALLOW_PRIVATE_HOSTS: z
    .string()
    .default("true")
    .transform((value) => value.trim().toLowerCase())
    .pipe(z.enum(["true", "false", "1", "0", "yes", "no"]))
    .transform((value) => value === "true" || value === "1" || value === "yes"),
  // A personal iTop token is saved only when Solvro can confirm it is the
  // user's own (routes/itopUser.ts): the token must read the iTop User of the
  // Person with the user's email and that user's own PersonalToken. Some iTop
  // profiles may read neither class; set "true" to accept such a token on the
  // email match alone (the behaviour before 2026-10-25). Default "false".
  ITOP_ALLOW_UNVERIFIED_PERSONAL_TOKENS: z
    .string()
    .default("false")
    .transform((value) => value.trim().toLowerCase())
    .pipe(z.enum(["true", "false", "1", "0", "yes", "no"]))
    .transform((value) => value === "true" || value === "1" || value === "yes"),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid environment configuration:");
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
