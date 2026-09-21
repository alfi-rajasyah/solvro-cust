-- Service catalogue + Customer ↔ Service many-to-many.

CREATE TABLE "services" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "services_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "services_name_key" ON "services"("name");

-- Implicit M2M join table per Prisma's _ModelAToModelB convention (alphabetical).
CREATE TABLE "_CustomerServices" (
    "A" INTEGER NOT NULL,
    "B" INTEGER NOT NULL,

    CONSTRAINT "_CustomerServices_AB_pkey" PRIMARY KEY ("A","B")
);

CREATE INDEX "_CustomerServices_B_index" ON "_CustomerServices"("B");

ALTER TABLE "_CustomerServices" ADD CONSTRAINT "_CustomerServices_A_fkey"
    FOREIGN KEY ("A") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "_CustomerServices" ADD CONSTRAINT "_CustomerServices_B_fkey"
    FOREIGN KEY ("B") REFERENCES "services"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Seed a starter catalogue. Admins can add more via POST /services.
INSERT INTO "services" ("name", "description") VALUES
    ('Firewall',          'Perimeter and segmentation firewall management.'),
    ('VPN',               'Site-to-site and remote-access VPN tunnels.'),
    ('Cloud Storage',     'S3-compatible object storage with retention policies.'),
    ('Load Balancing',    'L4/L7 traffic distribution.'),
    ('DDoS Protection',   'Edge-based volumetric and L7 attack mitigation.'),
    ('Backup & Restore',  'Automated nightly backups with off-site replication.'),
    ('Monitoring',        '24/7 infrastructure monitoring and alerting.');
