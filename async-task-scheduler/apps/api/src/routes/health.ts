import { Router } from "express";
import { checkDatabase } from "@ats/database";
import { checkRedis, type createRedisConnection } from "@ats/queue";
import type { Logger } from "@ats/shared";

export function createHealthRouter(
  redis: ReturnType<typeof createRedisConnection>,
  log: Logger,
): Router {
  const router = Router();

  // Load balancers, Docker, and Kubernetes call this to decide whether to send traffic here.
  router.get("/health", async (_req, res) => {
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

  return router;
}