import "dotenv/config";
import { z } from "zod";
import { parseTrustProxy } from "./http/trustProxy.js";

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
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid environment configuration:");
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
