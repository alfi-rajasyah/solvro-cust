-- Data-only migration: no schema change.
--
-- Customer permissions now mirror project permissions: `customer:read` gates
-- customer reads and `customer:write` gates customer writes (they replace the
-- `project:read` / `project:write` gates on customer routes).
-- To keep every existing role working exactly as before, each role holding
-- `project:read` gains `customer:read`, and each role holding `project:write`
-- gains `customer:write`. Idempotent (never duplicates), and "*" roles are
-- left alone (the wildcard already satisfies both).
UPDATE "roles"
SET "permissions" = "permissions" || '["customer:read"]'::jsonb
WHERE jsonb_typeof("permissions") = 'array'
  AND "permissions" ? 'project:read'
  AND NOT ("permissions" ? 'customer:read')
  AND NOT ("permissions" ? '*');

UPDATE "roles"
SET "permissions" = "permissions" || '["customer:write"]'::jsonb
WHERE jsonb_typeof("permissions") = 'array'
  AND "permissions" ? 'project:write'
  AND NOT ("permissions" ? 'customer:write')
  AND NOT ("permissions" ? '*');
