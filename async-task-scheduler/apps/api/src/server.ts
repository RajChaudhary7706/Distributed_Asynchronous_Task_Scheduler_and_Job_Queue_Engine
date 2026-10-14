import express from "express";
import { config } from "@ats/config";
import { checkDatabase, closeDatabase } from "@ats/database";
import { checkRedis, createRedisConnection } from "@ats/queue";
import { createLogger } from "@ats/shared";

const log = createLogger("api");
const redis = createRedisConnection();

const app = express();
app.use(express.json());

// Health endpoint: load balancers, Docker, and Kubernetes call this to decide
// whether this instance should receive traffic.
app.get("/health", async (_req, res) => {
  const [db, cache] = await Promise.allSettled([checkDatabase(), checkRedis(redis)]);

  const postgresUp = db.status === "fulfilled" && db.value === true;
  const redisUp = cache.status === "fulfilled" && cache.value === true;

  if (db.status === "rejected") log.warn({ err: String(db.reason) }, "postgres health check failed");
  if (cache.status === "rejected") log.warn({ err: String(cache.reason) }, "redis health check failed");

  const healthy = postgresUp && redisUp;
  res.status(healthy ? 200 : 503).json({
    status: healthy ? "ok" : "degraded",
    service: "api",
    uptimeSeconds: Math.round(process.uptime()),
    dependencies: {
      postgres: postgresUp ? "up" : "down",
      redis: redisUp ? "up" : "down",
    },
  });
});

const server = app.listen(config.API_PORT, () => {
  log.info({ port: config.API_PORT }, "api listening");
});

// Minimal shutdown for now so Ctrl+C is clean. Phase 15 builds the full version.
async function shutdown(signal: string): Promise<void> {
  log.info({ signal }, "shutting down api");
  server.close();
  await redis.quit();
  await closeDatabase();
  process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));