import os from "node:os";
import path from "node:path";
// Must be imported before anything that touches src/env.ts (which parses
// process.env at import time). The DEFAULT, sanctioned way to run this
// suite is against the isolated `solvro_test` database inside the existing
// postgres container (per backend/CLAUDE.md) — never the dev DB:
//   TEST_URL=$(docker compose exec backend printenv DATABASE_URL | tr -d '\r\n' | sed 's|/solvro?|/solvro_test?|') \
//     && docker compose exec -e DATABASE_URL="$TEST_URL" backend npm test
// globalSetup.ts truncates every table before the run and hard-fails if
// DATABASE_URL doesn't resolve to a database name ending in "_test". The
// fallback URL below (bare "solvro" db on a local, non-compose Postgres) is
// only for ad hoc host-side runs outside Docker.
process.env.NODE_ENV = "test";
process.env.DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://solvro:test@localhost:5433/solvro?schema=public";
process.env.JWT_SECRET = process.env.JWT_SECRET ?? "test-jwt-secret-at-least-32-characters-long";
process.env.JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN ?? "8h";
// Fixed 32-byte test key (base64 of the literal "solvro-test-secrets-key-32-bytes").
// Only for the isolated test DB — never reuse outside this suite.
process.env.SECRETS_KEY =
  process.env.SECRETS_KEY ?? "c29sdnJvLXRlc3Qtc2VjcmV0cy1rZXktMzItYnl0ZXM=";
process.env.CORS_ORIGIN = process.env.CORS_ORIGIN ?? "*";
process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? "error";
// Pinned so URL expectations never depend on the host environment.
process.env.APP_URL = "http://localhost:5173";
// Attachments: always the local driver on a throwaway folder (never the dev
// bucket, even when the container has S3 settings), with tiny limits so the
// limit tests stay small: 1 KiB per file, 3 files and 2 KiB per task.
process.env.ATTACHMENTS_DRIVER = "local";
// The folder test/globalSetup.ts empties before the run and removes after it.
process.env.ATTACHMENTS_DIR = path.join(os.tmpdir(), "solvro-test-uploads");
process.env.ATTACHMENT_MAX_FILE_MB = String(1024 / (1024 * 1024));
process.env.ATTACHMENT_MAX_FILES_PER_TASK = "3";
process.env.ATTACHMENT_MAX_TASK_MB = String(2048 / (1024 * 1024));
process.env.ATTACHMENT_ALLOWED_EXTENSIONS = "png,pdf,txt";
