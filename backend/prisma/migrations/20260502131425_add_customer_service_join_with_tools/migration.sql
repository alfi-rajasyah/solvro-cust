-- Promote the implicit Customer ↔ Service M2M into an explicit join table
-- so we can attach a list of tools (e.g. "Acronis", "Crowdstrike") per assignment.
-- Existing assignments are preserved with empty tools arrays.

CREATE TABLE "customer_services" (
    "id"          SERIAL NOT NULL,
    "customer_id" INTEGER NOT NULL,
    "service_id"  INTEGER NOT NULL,
    "tools"       TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_services_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "customer_services_customer_id_service_id_key"
    ON "customer_services"("customer_id", "service_id");

CREATE INDEX "customer_services_customer_id_idx" ON "customer_services"("customer_id");
CREATE INDEX "customer_services_service_id_idx"  ON "customer_services"("service_id");

ALTER TABLE "customer_services" ADD CONSTRAINT "customer_services_customer_id_fkey"
    FOREIGN KEY ("customer_id") REFERENCES "customers"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "customer_services" ADD CONSTRAINT "customer_services_service_id_fkey"
    FOREIGN KEY ("service_id") REFERENCES "services"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill existing assignments from the implicit join table.
INSERT INTO "customer_services" ("customer_id", "service_id", "tools")
SELECT "A", "B", ARRAY[]::TEXT[] FROM "_CustomerServices";

-- Drop the implicit M2M table now that data is migrated.
DROP TABLE "_CustomerServices";
