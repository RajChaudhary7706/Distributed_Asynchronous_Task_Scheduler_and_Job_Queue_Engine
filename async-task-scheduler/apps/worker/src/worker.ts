import { config } from "@ats/config";
import { checkDatabase, closeDatabase } from "@ats/database";
import { checkRedis, createRedisConnection } from "@ats/queue";
import { createLogger } from "@ats/shared";

const log = createLogger("worker").child({ workerId: config.WORKER_ID });

async function main(): Promise<void> {
  log.info("worker booting");

  const redis = createRedisConnection();

  const [postgresUp, redisUp] = await Promise.all([checkDatabase(), checkRedis(redis)]);
  log.info({ postgresUp, redisUp }, "dependencies reachable");
  log.info("worker idle: no queues attached yet (added in Phase 5)");

  // Minimal shutdown for now. Phase 15 builds the full version.
  const shutdown = async (signal: string): Promise<void> => {
    log.info({ signal }, "shutting down worker");
    await redis.quit();
    await closeDatabase();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  log.fatal({ err: String(err) }, "worker failed to start");
  process.exit(1);
});