import path from "node:path";
import dotenv from "dotenv";
import { z } from "zod";

// Load the .env that lives at the repo root, no matter which workspace we run from.
// In Docker/production there is no .env file; real environment variables are used instead.
// dotenv never overrides variables that are already set, so real env always wins.
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

const positiveInt = (fallback: number) => z.coerce.number().int().min(1).default(fallback);

// z.coerce.boolean() treats the string "false" as true, so we parse booleans explicitly.
const booleanFlag = (fallback: boolean) =>
  z
    .enum(["true", "false"])
    .default(fallback ? "true" : "false")
    .transform((value) => value === "true");

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),

  API_PORT: z.coerce.number().int().positive().default(3000),
  WORKER_ID: z.string().min(1).default(`worker-${process.pid}`),
  // "all", one job type, or a comma-separated list. Validated against the registry in the worker
  // (this package cannot import @ats/shared without creating a dependency cycle).
  WORKER_QUEUE: z.string().min(1).default("all"),

  DATABASE_URL: z.string().startsWith("postgres", "DATABASE_URL must be a postgres URL"),
  REDIS_URL: z.string().startsWith("redis", "REDIS_URL must be a redis URL"),

  // Max times a job may be attempted before it goes to the DLQ.
  PDF_MAX_ATTEMPTS: positiveInt(3),
  EMAIL_MAX_ATTEMPTS: positiveInt(5),
  VIDEO_MAX_ATTEMPTS: positiveInt(3),

  // How many jobs ONE worker process runs in parallel.
  PDF_CONCURRENCY: positiveInt(2),
  EMAIL_CONCURRENCY: positiveInt(10),
  VIDEO_CONCURRENCY: positiveInt(1),

  // Enqueue recovery sweeper (API).
  SWEEP_INTERVAL_MS: positiveInt(10_000),
  SWEEP_GRACE_MS: positiveInt(15_000),
  SWEEP_BATCH_SIZE: positiveInt(100),

  // Lets clients submit `failTimes` to force failures. Never enable in production.
  CHAOS_ENABLED: booleanFlag(false),

  // Temporary (Phase 5 only): how long the placeholder processor takes.
  PLACEHOLDER_PROCESSING_MS: positiveInt(3000),
});

export type AppConfig = z.infer<typeof envSchema>;

function loadConfig(): AppConfig {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    // Fail fast: a service with bad config must not start.
    console.error("❌ Invalid environment configuration:");
    for (const issue of parsed.error.issues) {
      console.error(`  - ${issue.path.join(".")}: ${issue.message}`);
    }
    process.exit(1);
  }
  return parsed.data;
}

export const config: AppConfig = loadConfig();