import { config } from "@ats/config";
import { closeDatabase } from "@ats/database";
import { closeQueues, createJobQueues, createRedisConnection } from "@ats/queue";
import { createLogger } from "@ats/shared";
import { createApp } from "./app";
import { EnqueueSweeper } from "./services/enqueue-sweeper";
import { JobService } from "./services/job-service";

const log = createLogger("api");

// Composition root: the only place where concrete dependencies are created and wired together.
// failFast: if Redis is down, enqueue calls fail immediately instead of hanging HTTP requests.
const redis = createRedisConnection({ failFast: true });
const queues = createJobQueues(redis);

const jobService = new JobService({ queues, log: log.child({ component: "job-service" }) });
const sweeper = new EnqueueSweeper(
  jobService,
  {
    intervalMs: config.SWEEP_INTERVAL_MS,
    graceMs: config.SWEEP_GRACE_MS,
    batchSize: config.SWEEP_BATCH_SIZE,
  },
  log.child({ component: "sweeper" }),
);

const app = createApp({ redis, jobService, log });

const server = app.listen(config.API_PORT, () => {
  log.info({ port: config.API_PORT }, "api listening");
  sweeper.start();
});

// Minimal shutdown for now so Ctrl+C is clean. Phase 15 builds the full version.
async function shutdown(signal: string): Promise<void> {
  log.info({ signal }, "shutting down api");
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await sweeper.stop();
  await closeQueues(...Object.values(queues));
  await redis.quit();
  await closeDatabase();
  process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));