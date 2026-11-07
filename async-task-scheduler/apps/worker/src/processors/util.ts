import { setTimeout as sleep } from "node:timers/promises";

/**
 * Waits for `ms` milliseconds WITHOUT blocking the event loop.
 * While we wait, Node keeps running other jobs and BullMQ keeps renewing this job's lock.
 * Never replace this with a busy loop (`while (Date.now() < end) {}`): that freezes the
 * whole process, the lock expires, and the job is wrongly declared stalled.
 */
export function pause(ms: number): Promise<void> {
  return sleep(Math.max(0, Math.round(ms)));
}

/** "test@example.com" -> "t***@example.com". Logs travel far; keep personal data out of them. */
export function maskEmail(email: unknown): string {
  if (typeof email !== "string") return "unknown";
  const at = email.indexOf("@");
  if (at < 1) return "***";
  return `${email.slice(0, 1)}***${email.slice(at)}`;
}