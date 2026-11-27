import {
    InvalidTransitionError,
    StaleTransitionError,
    getJobById,
    transitionJob,
} from "@ats/database";
import type { Logger } from "@ats/shared";
import type { DeadLetterService } from "../dlq/dead-letter";

// The message BullMQ uses when a job stalls more often than maxStalledCount allows.
const STALLED_LIMIT_MESSAGE = "job stalled more than allowable limit";

/**
 * BullMQ can fail a job on its own when it stalls too many times (a worker crashed repeatedly
 * while running it). Our handler never runs for that failure, so Postgres would say
 * PROCESSING forever. This repairs the row: PROCESSING -> FAILED -> DLQ.
 * BullMQ has given up on the job, so nothing will ever retry it: the DLQ is the right place.
 *
 * Deliberately narrow: it only acts on the stalled-limit failure. For ordinary failures our
 * handler has already written FAILED, and a retried job may legitimately be PROCESSING again
 * by the time this event fires.
 */
export async function reconcileStalledFailure(
    jobId: string | undefined,
    message: string,
    workerId: string,
    deadLetter: DeadLetterService,
    log: Logger,
): Promise<void> {
    if (!jobId || !message.includes(STALLED_LIMIT_MESSAGE)) return;

    try {
        const current = await getJobById(jobId);
        if (!current || current.state !== "PROCESSING") return;

        await transitionJob(jobId, "FAILED", {
            workerId,
            error: `${message} (recorded by reconciliation: the worker crashed repeatedly while running this job)`,
        });
        log.error({ event: "job_reconciled", jobId, state: "FAILED" }, "stalled job marked FAILED in Postgres");

        await deadLetter.deadLetter(jobId, workerId);
    } catch (err) {
        // Someone else already moved it: nothing left to repair.
        if (err instanceof StaleTransitionError || err instanceof InvalidTransitionError) return;
        log.error({ event: "job_reconcile_failed", jobId, err: String(err) }, "could not reconcile stalled job");
    }
}