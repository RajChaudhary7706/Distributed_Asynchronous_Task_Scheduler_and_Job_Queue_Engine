import path from "node:path";
import dotenv from "dotenv";
import { z } from "zod";

// Load the .env that lives at the repo root, no matter which workspace we run from.
// In Docker/production there is no .env file; real environment variables are used instead.
// dotenv never overrides variables that are already set, so real env always wins.
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),

  API_PORT: z.coerce.number().int().positive().default(3000),
  WORKER_ID: z.string().min(1).default(`worker-${process.pid}`),

  DATABASE_URL: z.string().startsWith("postgres", "DATABASE_URL must be a postgres URL"),
  REDIS_URL: z.string().startsWith("redis", "REDIS_URL must be a redis URL"),
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