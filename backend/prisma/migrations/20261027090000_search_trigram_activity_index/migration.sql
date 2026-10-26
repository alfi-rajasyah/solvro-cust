-- Search runs `ILIKE '%term%'` on project names, task titles and customer
-- names; a leading wildcard cannot use a btree index, so these GIN trigram
-- indexes serve it instead. pg_trgm ships with the standard PostgreSQL
-- contrib modules (the official postgres image includes it); creating the
-- extension needs a role allowed to create trusted extensions (the database
-- owner is enough on PostgreSQL 13+).
--
-- The three *_trgm_idx indexes are declared in schema.prisma with
-- `type: Gin` and `ops: raw("gin_trgm_ops")`; do not drop them by hand.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX "projects_name_trgm_idx" ON "projects" USING GIN ("name" gin_trgm_ops);
CREATE INDEX "tasks_title_trgm_idx" ON "tasks" USING GIN ("title" gin_trgm_ops);
CREATE INDEX "customers_name_trgm_idx" ON "customers" USING GIN ("name" gin_trgm_ops);

-- The project activity feed filters on project_id and orders by id DESC
-- (keyset pagination on id), which the (project_id, created_at) index cannot
-- serve.
-- CreateIndex
CREATE INDEX "activity_events_project_id_id_idx" ON "activity_events"("project_id", "id" DESC);
