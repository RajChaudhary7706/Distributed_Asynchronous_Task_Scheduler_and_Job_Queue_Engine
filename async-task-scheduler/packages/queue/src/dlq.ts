import type { Queue } from "bullmq";
import type { DlqJobData } from "@ats/shared";

/** BullMQ id of the dlq entry for a job. Deterministic, so publishing is idempotent. */
export function dlqEntryId(jobId: string): string {
    return `dlq_${jobId}`;
}

/**
 * Writes the dead-letter evidence into the `dlq` queue. Safe to call repeatedly, from any process.
 *
 * If an entry already exists (the job was dead-lettered before, manually retried, and failed again)
 * we replace it, so the evidence always describes the LATEST failure. BullMQ ignores add() for an
 * existing id, so without the remove the old data would silently win.
 * Nothing ever consumes the dlq queue, so removing an entry can't race with a worker.
 */
export async function publishDlqEntry(dlq: Queue<DlqJobData>, data: DlqJobData): Promise<void> {
    const entryId = dlqEntryId(data.jobId);
    const existing = await dlq.getJob(entryId);
    if (existing) await existing.remove();
    await dlq.add("dead-letter", data, { jobId: entryId });
}