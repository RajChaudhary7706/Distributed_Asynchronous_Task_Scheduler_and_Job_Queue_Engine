import type { ErrorRequestHandler, RequestHandler, Response } from "express";
import { ZodError } from "zod";
import { InvalidTransitionError, JobNotFoundError, StaleTransitionError } from "@ats/database";
import { createLogger } from "@ats/shared";
import { HttpError } from "../errors";

const log = createLogger("api");

/** Every error response has this shape: { "error": { "code", "message", "details"? } } */
function send(res: Response, status: number, code: string, message: string, details?: unknown): void {
  res.status(status).json({ error: { code, message, ...(details !== undefined ? { details } : {}) } });
}

export const notFoundHandler: RequestHandler = (req, res) => {
  send(res, 404, "ROUTE_NOT_FOUND", `${req.method} ${req.path} does not exist`);
};

/** Errors thrown by express.json() carry a `type` and `status`. */
function asBodyParserError(err: unknown): { type: string; status: number; message: string } | null {
  if (typeof err !== "object" || err === null) return null;
  const { type, status, message } = err as Record<string, unknown>;
  if (typeof type === "string" && typeof status === "number" && typeof message === "string") {
    return { type, status, message };
  }
  return null;
}

// Express recognizes error middleware by its 4 parameters. Keep all four.
export const errorHandler: ErrorRequestHandler = (err: unknown, req, res, next) => {
  if (res.headersSent) {
    next(err);
    return;
  }

  if (err instanceof HttpError) {
    send(res, err.status, err.code, err.message, err.details);
    return;
  }

  if (err instanceof ZodError) {
    const details = err.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message }));
    send(res, 400, "VALIDATION_ERROR", "Request validation failed", details);
    return;
  }

  if (err instanceof JobNotFoundError) {
    send(res, 404, "JOB_NOT_FOUND", err.message);
    return;
  }

  if (err instanceof InvalidTransitionError) {
    send(res, 409, "INVALID_STATE", err.message);
    return;
  }

  if (err instanceof StaleTransitionError) {
    send(res, 409, "CONFLICT", "The job was modified concurrently; please retry");
    return;
  }

  const bodyError = asBodyParserError(err);
  if (bodyError?.type === "entity.too.large") {
    send(res, 413, "PAYLOAD_TOO_LARGE", "Request body is too large");
    return;
  }
  if (bodyError?.type === "entity.parse.failed") {
    send(res, 400, "INVALID_JSON", "Request body is not valid JSON");
    return;
  }
  if (bodyError && bodyError.status >= 400 && bodyError.status < 500) {
    send(res, bodyError.status, "BAD_REQUEST", bodyError.message);
    return;
  }

  // Postgres unreachable: the service is unavailable, not broken.
  if (err instanceof Error && err.name === "PrismaClientInitializationError") {
    log.error({ err: err.message, method: req.method, path: req.path }, "database unavailable");
    send(res, 503, "SERVICE_UNAVAILABLE", "Database is temporarily unavailable");
    return;
  }

  // Anything else is a bug. Log everything, tell the client nothing internal.
  log.error({ err, method: req.method, path: req.path }, "unhandled error");
  send(res, 500, "INTERNAL_ERROR", "Something went wrong");
};