import IORedis from "ioredis";
import { config } from "@ats/config";
import { createLogger } from "@ats/shared";

const log = createLogger("redis");

export interface RedisConnectionOptions {
  /**
   * Producers (the API) should set this. When Redis is unreachable, commands then
   * fail immediately instead of queueing up in memory and hanging the HTTP request.
   * Workers must NOT set it: they should wait patiently through a Redis outage.
   */
  failFast?: boolean;
}

/**
 * Creates a Redis connection.
 *
 * maxRetriesPerRequest: null is REQUIRED by BullMQ for worker connections.
 * Workers use blocking commands that wait for new jobs; without this setting
 * ioredis would throw errors instead of waiting through a Redis outage.
 */
export function createRedisConnection(options: RedisConnectionOptions = {}): IORedis {
  const connection = new IORedis(config.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableOfflineQueue: !options.failFast,
  });

  // Without an 'error' listener, connection errors would be unhandled.
  connection.on("error", (err) => log.error({ err: err.message }, "redis connection error"));
  connection.on("ready", () => log.info("redis connection ready"));

  return connection;
}

export async function checkRedis(connection: IORedis, timeoutMs = 2000): Promise<boolean> {
  // With maxRetriesPerRequest=null a PING would wait forever if Redis is down,
  // so we race it against a timeout to make health checks fail fast.
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("redis ping timed out")), timeoutMs);
  });

  try {
    const pong = await Promise.race([connection.ping(), timeout]);
    return pong === "PONG";
  } finally {
    clearTimeout(timer);
  }
}