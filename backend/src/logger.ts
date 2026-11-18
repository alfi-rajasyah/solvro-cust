import { pino } from "pino";
import { env } from "./env.js";

// Secret-shaped fields are masked wherever they appear in a logged object, so
// a future `logger.info({ appToken })` or a logged request/response cannot
// leak one. http/requestLogger.ts still scrubs headers and URLs on its own.
const SECRET_FIELDS = [
  "authorization",
  "token",
  "appToken",
  "auth_token",
  "accessToken",
  "refreshToken",
  "access_token",
  "refresh_token",
  "password",
  "passwordHash",
  "secret",
  "clientSecret",
  "client_secret",
  "webhookSecret",
];

// Paths are case-sensitive, so the capitalised header spellings are listed too.
// Hyphenated names need bracket notation.
const HYPHENATED_FIELDS = ["auth-token", "Auth-Token", "Authorization"];

// Each field at the top level, one level down and two levels down.
const LOG_REDACT_PATHS = [
  ...SECRET_FIELDS,
  ...SECRET_FIELDS.map((f) => `*.${f}`),
  ...SECRET_FIELDS.map((f) => `*.*.${f}`),
  ...HYPHENATED_FIELDS.flatMap((f) => [`["${f}"]`, `*["${f}"]`, `*.*["${f}"]`]),
];

export const LOG_REDACT_OPTIONS = { paths: LOG_REDACT_PATHS, censor: "[Redacted]" };

export const logger = pino({
  level: env.LOG_LEVEL,
  redact: LOG_REDACT_OPTIONS,
  ...(env.NODE_ENV === "development"
    ? {
        transport: {
          target: "pino/file",
          options: { destination: 1 },
        },
      }
    : {}),
});
