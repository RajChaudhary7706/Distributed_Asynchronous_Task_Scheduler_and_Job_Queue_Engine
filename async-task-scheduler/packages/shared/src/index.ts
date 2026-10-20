import pino, { type Logger } from "pino";
import { config } from "@ats/config";

/**
 * Structured (JSON) logger. In development we pretty-print for humans;
 * in production we emit one JSON object per line, which log systems
 * (Loki, Datadog, ELK, CloudWatch) can index and query by field.
 */
export function createLogger(name: string): Logger {
  return pino({
    name,
    level: config.LOG_LEVEL,
    timestamp: pino.stdTimeFunctions.isoTime,
    transport:
      config.NODE_ENV === "development"
        ? {
            target: "pino-pretty",
            options: { colorize: true, translateTime: "SYS:HH:MM:ss.l" },
          }
        : undefined,
  });
}

export type { Logger };

export * from "./job-types";