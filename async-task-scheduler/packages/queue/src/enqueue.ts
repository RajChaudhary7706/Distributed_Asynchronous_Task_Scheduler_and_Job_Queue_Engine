import type { JobData } from "@ats/shared";
import type { JobQueues } from "./queues";

export type EnqueueResult = "added" | "already_in_redis";

export interface EnqueueOptions {
  /**
   * Total attempts BullMQ may make (1 initial run + retries). Comes from the Postgres row,
   * which got it from the job registry, so every layer agrees.
   */
  maxAttempts: number;
}

/**
 * Puts a job into its BullMQ queue. Safe to call any number of times, from any process.
 *
 * - BullMQ ignores add() when a job with the same id already exists, so duplicates are impossible.
 * - A job that is waiting/active/delayed in Redis is already "live": nothing to do.
 * - A leftover FAILED/COMPLETED copy (kept for a while by removeOnFail/removeOnComplete) would make
 *   add() a silent no-op, so we remove it first. This only happens on manual retries.
 */
export async function enqueueJob(
  queues: JobQueues,
  data: JobData,
  options: EnqueueOptions,
): Promise<EnqueueResult> {
  const queue = queues[data.type];

  const existing = await queue.getJob(data.jobId);
  if (existing) {
    const state = await existing.getState();
    if (state !== "failed" && state !== "completed") return "already_in_redis";
    await existing.remove();
  }

  await queue.add(data.type, data, {
    jobId: data.jobId,
    attempts: options.maxAttempts,
    // "custom" means: ask the Worker's backoffStrategy how long to wait (see apps/worker/src/retry).
    backoff: { type: "custom" },
  });
  return "added";
}