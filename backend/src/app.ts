import "express-async-errors";
import express, { type Express } from "express";
import cors from "cors";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import { env } from "./env.js";
import { logger } from "./logger.js";
import { errorHandler, notFoundHandler } from "./http/errors.js";
import { healthRouter } from "./routes/health.js";
import { authRouter } from "./routes/auth.js";
import { usersRouter } from "./routes/users.js";
import { projectsRouter } from "./routes/projects.js";
import { projectMembersRouter } from "./routes/projectMembers.js";
import { activityRouter } from "./routes/activity.js";
import { notificationsRouter } from "./routes/notifications.js";
import { tasksRouter } from "./routes/tasks.js";
import { overviewRouter } from "./routes/overview.js";
import { labelsRouter } from "./routes/labels.js";
import { customersRouter } from "./routes/customers.js";
import { sectionsRouter } from "./routes/sections.js";
import { epicsRouter } from "./routes/epics.js";
import { holidaysRouter } from "./routes/holidays.js";
import { servicesRouter } from "./routes/services.js";
import { risksRouter } from "./routes/risks.js";
import { dependenciesRouter } from "./routes/dependencies.js";
import { adminRouter } from "./routes/admin.js";
import { itopAdminRouter } from "./routes/itopAdmin.js";
import { itopRouter } from "./routes/itop.js";
import { itopUserRouter } from "./routes/itopUser.js";
import { utilizationRouter } from "./routes/utilization.js";
import { reportsRouter } from "./routes/reports.js";
import { searchRouter } from "./routes/search.js";
import { dailyReviewRouter } from "./routes/dailyReview.js";
import { notesRouter } from "./routes/notes.js";
import { webhookRouter } from "./routes/webhook.js";

export function createApp(): Express {
  const app = express();

  app.disable("x-powered-by");
  app.use(helmet());
  app.use(
    cors({
      origin:
        env.CORS_ORIGIN.trim() === "*"
          ? true
          : env.CORS_ORIGIN.split(",").map((s) => s.trim()),
      credentials: false,
    }),
  );
  app.use(pinoHttp({ logger }));

  // Mounted BEFORE the global JSON body parser: the iTop webhook (the first
  // unauthenticated non-health route — see routes/webhook.ts) ignores its
  // request body entirely, so a malformed body must never 400 before that
  // route's own secret check runs.
  app.use("/webhook", webhookRouter);

  app.use(express.json({ limit: "1mb" }));

  app.use("/health", healthRouter);
  app.use("/auth", authRouter);
  app.use("/users", usersRouter);
  app.use("/overview", overviewRouter);
  app.use("/customers", customersRouter);
  app.use("/projects", projectsRouter);
  app.use("/projects", projectMembersRouter);
  app.use("/projects", activityRouter);
  app.use("/notifications", notificationsRouter);
  app.use("/daily-review", dailyReviewRouter);
  app.use("/notes", notesRouter);
  app.use("/tasks", tasksRouter);
  app.use("/labels", labelsRouter);
  app.use("/sections", sectionsRouter);
  app.use("/epics", epicsRouter);
  app.use("/holidays", holidaysRouter);
  app.use("/services", servicesRouter);
  app.use("/risks", risksRouter);
  app.use("/dependencies", dependenciesRouter);
  app.use("/admin", adminRouter);
  app.use("/admin/itop", itopAdminRouter);
  app.use("/itop/me", itopUserRouter);
  app.use("/itop", itopRouter);
  app.use("/utilization", utilizationRouter);
  app.use("/reports", reportsRouter);
  app.use("/search", searchRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
