import {
    InvalidTransitionError,
    StaleTransitionError,
    getFirstFailedAtByJob,
    getJobById,
    markDlqPublished,
    transitionJob,
} from "@ats/database";
import { publishDlqEntry, type Queue } from "@ats/queue";
import { isJobType, type DlqJobData, type JobPayload, type Logger } from "@ats/shared";

const MAX_TRIES = 3;

export interface DeadLetterService {
    /**
     * The ONE exit door for jobs that gave up. Postgres FAILED -> DLQ, then the evidence into Redis.
     * Safe to call repeatedly and concurrently. Throws only on infrastructure errors
     * (callers log them; the DLQ sweeper repairs whatever was left half-done).
     */
    deadLetter(jobId: string, workerId: string): Promise<void>;
    /** Writes the evidence for a job that is already DLQ in Postgres. Returns false if nothing to publish. */
    publish(jobId: string): Promise<boolean>;
}

export function createDeadLetterService(dlq: Queue<DlqJobData>, log: Logger): DeadLetterService {
    async function publish(jobId: string): Promise<boolean> {
        const job = await getJobById(jobId);
        if (!job || job.state !== "DLQ") return false;
        if (!isJobType(job.type)) {
            log.error({ event: "dlq_publish_skipped", jobId, jobType: job.type }, "unknown job type, cannot publish");
            return false;
        }

        const firstFailed = (await getFirstFailedAtByJob([jobId])).get(jobId);
        const lastFailedAt = job.failedAt ?? job.updatedAt;

        const data: DlqJobData = {
            jobId: job.id,
            type: job.type,
            payload: job.payload as JobPayload,
            attemptCount: job.attemptCount,
            error: job.error ?? "unknown error",
            firstFailedAt: (firstFailed ?? lastFailedAt).toISOString(),
            lastFailedAt: lastFailedAt.toISOString(),
        };

        await publishDlqEntry(dlq, data);
        await markDlqPublished(jobId);

        log.warn(
            {
                event: "job_dead_lettered",
                jobId,
                jobType: job.type,
                attempt: job.attemptCount,
                state: "DLQ",
                error: data.error,
            },
            "job dead-lettered",
        );
        return true;
    }

    async function deadLetter(jobId: string, workerId: string): Promise<void> {
        for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
            const job = await getJobById(jobId);
            if (!job) return;
            if (job.state === "DLQ") break; // someone already did step 1: just make sure step 2 happened
            if (job.state !== "FAILED") {
                log.warn({ event: "dead_letter_skipped", jobId, state: job.state }, "job is not FAILED, not dead-lettering");
                return;
            }
            try {
                await transitionJob(jobId, "DLQ", { workerId });
                break;
            } catch (err) {
                if (err instanceof StaleTransitionError || err instanceof InvalidTransitionError) continue;
                throw err;
            }
        }
        await publish(jobId);
    }

    return { deadLetter, publish };
}