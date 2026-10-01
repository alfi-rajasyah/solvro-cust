import { env } from "./env.js";
import { logger } from "./logger.js";
import { prisma } from "./prisma.js";
import { createApp } from "./app.js";
import { startItopScheduler, stopItopScheduler } from "./lib/itop/scheduler.js";
import { startActivityCleanup, stopActivityCleanup } from "./lib/activityCleanup.js";

const app = createApp();

const server = app.listen(env.PORT, () => {
  logger.info(`Solvro API listening on http://0.0.0.0:${env.PORT}`);
  startItopScheduler();
  startActivityCleanup();
});

async function shutdown(signal: string) {
  logger.info(`Received ${signal}, shutting down…`);
  stopItopScheduler();
  stopActivityCleanup();
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
