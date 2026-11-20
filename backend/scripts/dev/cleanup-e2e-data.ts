// Removes the rows Playwright runs leave behind in a dev database, so the
// demo data stays readable for manual QA. Run it after any local e2e run
// against the dev stack (gates.sh does it after its Playwright step).
//
// It deletes only rows that carry an e2e marker:
// - customers whose description starts with "e2e" AND whose name ends in a
//   fixture stamp (every e2e fixture customer has both);
// - projects linked to such a customer, or whose name ends in a fixture stamp
//   (a space, then "m" and 11 base-36 characters with at least one digit:
//   `Date.now()` in base 36 plus 4 random characters, as e2e/fixtures/seed.ts
//   builds it);
// - users with an @solvro.test email, except the e2e sign-in account
//   (E2E_ADMIN_EMAIL, default qa@solvro.test), which the suite needs.
// Deleting a project cascades to its tasks, sections, labels, risks, notes and
// activity log (schema.prisma). A user that other rows still reference is
// deactivated instead of deleted.
//
// Dry run by default (prints the counts). To delete:
//   docker compose exec -T -e E2E_CLEANUP_CONFIRM=delete backend npx tsx scripts/dev/cleanup-e2e-data.ts
// Dev stack only: no production image layer holds scripts/dev/ (backend/Dockerfile
// deletes it in the build stage and copies scripts/ into runtime from there;
// gates.sh checks that), and
// the script refuses to run unless NODE_ENV is exactly "development", which only
// the dev compose service sets (the production image bakes NODE_ENV=production).

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/** A fixture stamp at the end of a name: " m" plus 11 base-36 characters, one a digit. */
const FIXTURE_STAMP = / m(?=[a-z0-9]*\d)[a-z0-9]{11}$/;
const E2E_LOGIN_EMAIL = process.env.E2E_ADMIN_EMAIL || "qa@solvro.test";

async function main() {
  if (process.env.NODE_ENV !== "development") {
    throw new Error(
      `Refusing to run: NODE_ENV is "${process.env.NODE_ENV ?? ""}", not "development". This script is for the dev stack only.`,
    );
  }
  const confirm = process.env.E2E_CLEANUP_CONFIRM === "delete";

  const customers = await prisma.customer.findMany({
    where: { description: { startsWith: "e2e" } },
    select: { id: true, name: true },
  });
  const customerIds = customers.filter((c) => FIXTURE_STAMP.test(c.name)).map((c) => c.id);

  const projects = await prisma.project.findMany({
    select: { id: true, name: true, customers: { select: { customerId: true } } },
  });
  const projectIds = projects
    .filter(
      (p) => FIXTURE_STAMP.test(p.name) || p.customers.some((c) => customerIds.includes(c.customerId)),
    )
    .map((p) => p.id);

  const users = await prisma.user.findMany({
    where: { email: { endsWith: "@solvro.test" }, NOT: { email: E2E_LOGIN_EMAIL } },
    select: { id: true },
  });

  console.log(
    `e2e rows: ${projectIds.length} projects, ${customerIds.length} customers, ${users.length} users` +
      (confirm ? "" : " (dry run; set E2E_CLEANUP_CONFIRM=delete to remove them)"),
  );
  if (!confirm) return;

  await prisma.project.deleteMany({ where: { id: { in: projectIds } } });
  await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });

  let deleted = 0;
  let deactivated = 0;
  for (const { id } of users) {
    try {
      await prisma.user.delete({ where: { id } });
      deleted++;
    } catch {
      // Still referenced (a comment author on a kept project, for example).
      await prisma.user.update({ where: { id }, data: { active: false } });
      deactivated++;
    }
  }
  console.log(
    `removed ${projectIds.length} projects, ${customerIds.length} customers, ${deleted} users; deactivated ${deactivated} users`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
