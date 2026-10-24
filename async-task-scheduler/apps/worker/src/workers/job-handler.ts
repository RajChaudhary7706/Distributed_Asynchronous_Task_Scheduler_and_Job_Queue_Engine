import { setTimeout as sleep } from "node:timers/promises";
import {
  InvalidTransitionError,
  JobNotFoundError,
  StaleTransitionError,
  getJobById,
  transitionJob,
} from "@ats/database";
import { UnrecoverableError, type JobProcessor } from "@ats/queue";
import type { JobType, Logger } from "@ats/shared";
import { getProcessor } from "../processors";

const MAX_CLAIM_TRIES = 3;
const MAX_PERSIST_TRIES = 3;
const MAX_ERROR_LENGTH = 2000;
const INTERRUPTED_MESSAGE = "previous attempt was interrupted (worker crashed or lost its lock)";

type ClaimResult = { claimed: true; attempt: number } | { claimed: false; reason: string };

function errorMessage(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return message.slice(0, MAX_ERROR_LENGTH);
}

/**
 * Decides whether this delivery should actually run, and if so moves the job to PROCESSING.
 * BullMQ delivers AT LEAST ONCE, so the same job can reach us twice. Postgres is the referee.
 */
async function claimJob(jobId: string, workerId: string, log: Logger): Promise<ClaimResult> {
  for (let attempt = 1; attempt <= MAX_CLAIM_TRIES; attempt++) {
    const current = await getJobById(jobId);
    if (!current) {
      // Not retryable: a retry would find the same empty result.
      throw new UnrecoverableError(`Job ${jobId} has no record in Postgres`);
    }

    // Already finished (or parked for operators): a duplicate delivery. Acknowledge and move on.
    if (current.state === "COMPLETED" || current.state === "DLQ") {
      return { claimed: false, reason: `already ${current.state}` };
    }

    try {
      if (current.state === "PROCESSING") {
        // Nobody can legitimately be running it (BullMQ gave it to us), so the previous worker died.
        // Record that attempt as failed first; the state machine then allows FAILED -> PROCESSING.
        log.warn({ event: "job_recovered", state: current.state }, "recovering interrupted job");
        await transitionJob(jobId, "FAILED", { workerId, error: INTERRUPTED_MESSAGE });
      }
      const job = await transitionJob(jobId, "PROCESSING", { workerId });
      return { claimed: true, attempt: job.attemptCount };
    } catch (err) {
      // Someone changed the row between our read and our write. Re-read and decide again.
      if (err instanceof StaleTransitionError || err instanceof InvalidTransitionError) {
        log.debug({ event: "claim_conflict", try: attempt, err: err.message }, "claim conflict, re-reading");
        continue;
      }
      throw err;
    }
  }
  throw new Error(`Could not claim job ${jobId}: it kept changing under us`);
}

/** Terminal state writes matter too much to drop on one transient database error. */
async function persist(label: string, write: () => Promise<unknown>, log: Logger): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await write();
      return;
    } catch (err) {
      const hopeless = err instanceof InvalidTransitionError || err instanceof JobNotFoundError;
      if (hopeless || attempt >= MAX_PERSIST_TRIES) throw err;
      log.warn({ event: "persist_retry", label, try: attempt, err: String(err) }, "state write failed, retrying");
      await sleep(250 * attempt);
    }
  }
}

export interface JobHandlerOptions {
  type: JobType;
  workerId: string;
  log: Logger;
}

/** Builds the function BullMQ calls for each job. This is the heart of the worker. */
export function createJobHandler(options: JobHandlerOptions): JobProcessor {
  const { type: queueType, workerId } = options;
  const execute = getProcessor(queueType);

  return async (job) => {
    const { jobId, type, payload } = job.data;
    const log = options.log.child({ jobId, jobType: type });

    if (type !== queueType) {
      throw new UnrecoverableError(`Job ${jobId} is type ${type} but arrived on the ${queueType} queue`);
    }

    // 1. QUEUED -> PROCESSING, persisted BEFORE any work starts.
    const claim = await claimJob(jobId, workerId, log);
    if (!claim.claimed) {
      log.info({ event: "job_skipped", reason: claim.reason }, "duplicate delivery ignored");
      return;
    }

    const { attempt } = claim;
    const startedAt = Date.now();
    log.info({ event: "job_processing", attempt, state: "PROCESSING" }, "job processing");

    // 2. Run the task.
    try {
      await execute({ jobId, type, payload, attempt, log: log.child({ attempt }) });
    } catch (err) {
      const message = errorMessage(err);
      log.warn(
        { event: "job_failed", attempt, state: "FAILED", error: message, durationMs: Date.now() - startedAt },
        "job attempt failed",
      );
      // 3a. PROCESSING -> FAILED, with the reason. Never lets a bookkeeping error hide the real error.
      try {
        await persist("record failure", () => transitionJob(jobId, "FAILED", { workerId, error: message }), log);
      } catch (persistErr) {
        log.error({ event: "job_state_write_failed", target: "FAILED", err: String(persistErr) }, "could not record failure");
      }
      // Re-throw so BullMQ also knows this attempt failed (Phase 7 hooks retries in here).
      throw err;
    }

    // 3b. PROCESSING -> COMPLETED.
    await persist("record completion", () => transitionJob(jobId, "COMPLETED", { workerId }), log);
    log.info(
      { event: "job_completed", attempt, state: "COMPLETED", durationMs: Date.now() - startedAt },
      "job completed",
    );
  };
}
