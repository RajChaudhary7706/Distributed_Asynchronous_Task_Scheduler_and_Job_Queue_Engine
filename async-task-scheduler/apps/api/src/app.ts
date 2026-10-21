import express, { type Express } from "express";
import type { createRedisConnection } from "@ats/queue";
import type { Logger } from "@ats/shared";
import { createJobController } from "./controllers/job-controller";
import { errorHandler, notFoundHandler } from "./middleware/error-handler";
import { requestLogger } from "./middleware/request-logger";
import { createHealthRouter } from "./routes/health";
import { createJobRoutes } from "./routes/job-routes";
import type { JobService } from "./services/job-service";

export interface AppDeps {
  redis: ReturnType<typeof createRedisConnection>;
  jobService: JobService;
  log: Logger;
}

/** Builds the Express app without starting a server, so integration tests can use it later. */
export function createApp(deps: AppDeps): Express {
  const app = express();
  app.disable("x-powered-by");

  app.use(requestLogger(deps.log));
  // First line of defense against huge payloads. The strict zod schemas are the second.
  app.use(express.json({ limit: "32kb" }));

  app.use(createHealthRouter(deps.redis, deps.log));
  app.use("/jobs", createJobRoutes(createJobController(deps.jobService)));

  // These two MUST be last.
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}