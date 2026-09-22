// Manual dev-stack check: runs the seeded fake iTop double (fakeItop.ts) as a
// standalone HTTP server so `src/lib/itop/client.ts` (and, later, the real
// admin/sync code) can be pointed at it without a real iTop install.
// Lives under test/, not scripts/, because scripts/ is copied into the
// production image (backend/Dockerfile) while test/ is not — this runner
// has no business shipping.
// Usage: npx tsx test/itop/run-fake-itop.ts
import { createFakeItop, seedFakeItop } from "./fakeItop.js";

async function main() {
  const port = Number(process.env.FAKE_ITOP_PORT ?? 8484);
  const state = seedFakeItop();
  const { listen } = createFakeItop(state);
  const { baseUrl } = await listen(port);

  console.log(`Fake iTop listening at ${baseUrl}`);
  console.log(`REST endpoint: ${baseUrl}/webservices/rest.php?version=1.3`);
  console.log("Seeded Auth-Tokens:");
  for (const [token, info] of state.tokens) {
    console.log(`  ${token}  (canWrite=${info.canWrite}, personId=${info.personId ?? "-"})`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
