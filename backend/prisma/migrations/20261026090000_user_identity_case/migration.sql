-- Sign-in identity is case-insensitive: emails are stored trimmed and
-- lowercase, and usernames differing only in case can no longer coexist.
--
-- Both steps refuse to run over existing collisions. Nothing is merged or
-- deleted automatically. The check runs before any change, so a refused run
-- leaves the data as it was, but Prisma records the migration as failed.
-- To recover: merge or rename the listed users by hand, run
-- `npx prisma migrate resolve --rolled-back 20261026090000_user_identity_case`,
-- then run `npx prisma migrate deploy` again.
--
-- Prisma cannot express a functional index in schema.prisma, so the
-- lower(username) index below exists only in this migration. Prisma does not
-- report it as drift; do not drop it by hand.

DO $$
DECLARE
  clash text;
BEGIN
  SELECT string_agg(g.key || ': user ids ' || g.ids, '; ')
    INTO clash
    FROM (
      SELECT lower(trim(email)) AS key,
             string_agg(id::text, ', ' ORDER BY id) AS ids
        FROM users
       GROUP BY lower(trim(email))
      HAVING count(*) > 1
    ) g;
  IF clash IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot lowercase user emails: these users collide once case and whitespace are ignored. Merge or change them by hand, run prisma migrate resolve --rolled-back 20261026090000_user_identity_case, then re-run prisma migrate deploy. %', clash;
  END IF;

  SELECT string_agg(g.key || ': user ids ' || g.ids, '; ')
    INTO clash
    FROM (
      SELECT lower(username) AS key,
             string_agg(id::text, ', ' ORDER BY id) AS ids
        FROM users
       GROUP BY lower(username)
      HAVING count(*) > 1
    ) g;
  IF clash IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot enforce case-insensitive usernames: these users share a username once case is ignored. Rename or merge them by hand, run prisma migrate resolve --rolled-back 20261026090000_user_identity_case, then re-run prisma migrate deploy. %', clash;
  END IF;
END $$;

UPDATE users SET email = lower(trim(email)) WHERE email <> lower(trim(email));

CREATE UNIQUE INDEX "users_username_lower_key" ON "users" (lower("username"));
