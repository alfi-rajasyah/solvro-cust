-- Data-only migration: no schema change.
--
-- Until this release the seed (prisma/seed.ts, run on every container start)
-- rewrote the permissions of the four built-in roles at each boot, which
-- silently reverted any change an admin made in Admin > Roles. From this
-- release the seed only creates a missing role (prisma/builtInRoles.ts).
--
-- Reset the built-in roles to their defaults one last time, exactly as the
-- old seed would have done on this boot. This is also how an upgraded
-- database drops `project:view-all` from STAKEHOLDER (2026-10 security
-- hardening), which previously only the seed applied. A fresh database has no
-- roles yet at this point, so these statements change nothing there and the
-- seed creates the roles afterwards.
UPDATE "roles" SET "permissions" = '["*"]'::jsonb WHERE "role_name" = 'ADMIN';
UPDATE "roles" SET "permissions" = '["project:read", "project:write", "task:read", "task:write", "task:comment"]'::jsonb WHERE "role_name" = 'TAM';
UPDATE "roles" SET "permissions" = '["project:read", "task:comment"]'::jsonb WHERE "role_name" = 'STAKEHOLDER';
UPDATE "roles" SET "permissions" = '[]'::jsonb WHERE "role_name" = 'PENDING';
