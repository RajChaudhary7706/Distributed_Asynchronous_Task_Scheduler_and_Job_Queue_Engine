import { config } from "@ats/config";
import { checkDatabase, closeDatabase } from "@ats/database";
import { checkRedis, createRedisConnection } from "@ats/queue";
import { JOB_TYPES, createLogger, isJobType, type JobType } from "@ats/shared";
import { startWorkers } from "./workers/start-workers";

const log = createLogger("worker").child({ workerId: config.WORKER_ID });

/** "all" | "pdf-export" | "pdf-export,email-send"  ->  JobType[] (or exit with a clear message). */
function resolveQueues(value: string): JobType[] {
  if (value === "all") return [...JOB_TYPES];

  const names = [...new Set(value.split(",").map((name) => name.trim()).filter(Boolean))];
  const invalid = names.filter((name) => !isJobType(name));
  if (invalid.length > 0 || names.length === 0) {
    log.fatal(
      { WORKER_QUEUE: value, valid: ["all", ...JOB_TYPES] },
      `invalid WORKER_QUEUE: ${invalid.join(", ") || "(empty)"}`,
    );
    process.exit(1);
  }
  return names as JobType[];
}

async function main(): Promise<void> {
  const types = resolveQueues(config.WORKER_QUEUE);
  log.info({ queues: types }, "worker booting");

  // Workers keep the default (patient) connection: during a Redis outage they wait, not crash.
  const redis = createRedisConnection();

  const [postgresUp, redisUp] = await Promise.all([checkDatabase(), checkRedis(redis)]);
  log.info({ postgresUp, redisUp }, "dependencies reachable");

  const workers = startWorkers(types, redis, log, config.WORKER_ID);
  await Promise.all(workers.map((worker) => worker.waitUntilReady()));
  log.info({ queues: types }, "worker ready, waiting for jobs");

  // Basic shutdown. Phase 15 builds the full version.
  // worker.close() stops taking new jobs and WAITS for running ones to finish.
  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info({ signal }, "shutting down: finishing active jobs");
    try {
      await Promise.all(workers.map((worker) => worker.close()));
      await redis.quit();
      await closeDatabase();
      process.exit(0);
    } catch (err) {
      log.error({ err: String(err) }, "error during shutdown");
      process.exit(1);
    }
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  log.fatal({ err: String(err) }, "worker failed to start");
  process.exit(1);
});