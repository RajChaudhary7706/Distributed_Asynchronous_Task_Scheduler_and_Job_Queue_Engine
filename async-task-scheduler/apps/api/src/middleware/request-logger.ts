import type { RequestHandler } from "express";
import type { Logger } from "@ats/shared";

export function requestLogger(log: Logger): RequestHandler {
  return (req, res, next) => {
    const start = process.hrtime.bigint();
    res.on("finish", () => {
      if (req.path === "/health") return; // probes would drown everything else
      const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
      log.info(
        {
          event: "http_request",
          method: req.method,
          path: req.path,
          status: res.statusCode,
          durationMs: Math.round(durationMs * 10) / 10,
        },
        "request completed",
      );
    });
    next();
  };
}