import { findExhaustedFailedJobs, findUnpublishedDeadLetters } from "@ats/database";
import type { Logger } from "@ats/shared";
import type { DeadLetterService } from "./dead-letter";

export interface DlqSweeperOptions {
    intervalMs: number;
    graceMs: number;
    batchSize: number;
    workerId: string;
}

/**
 * Repairs the two crash gaps in dead-lettering:
 *   A. exhausted jobs still FAILED in Postgres  -> deadLetter()
 *   B. DLQ rows whose evidence never reached Redis -> publish()
 * Every worker process runs one. That is safe: both repairs are idempotent, and the grace
 * period just avoids pointless duplicate work.
 */
export class DlqSweeper {
    private timer: NodeJS.Timeout | undefined;
    private stopped = false;
    private current: Promise<unknown> = Promise.resolve();

    constructor(
        private readonly service: DeadLetterService,
        private readonly options: DlqSweeperOptions,
        private readonly log: Logger,
    ) { }

    start(): void {
        this.log.info(
            { event: "dlq_sweeper_started", intervalMs: this.options.intervalMs, graceMs: this.options.graceMs },
            "dlq sweeper started",
        );
        this.schedule();
    }

    async stop(): Promise<void> {
        this.stopped = true;
        if (this.timer) clearTimeout(this.timer);
        await this.current;
    }

    private schedule(): void {
        if (this.stopped) return;
        this.timer = setTimeout(() => {
            this.current = this.runOnce().finally(() => this.schedule());
        }, this.options.intervalMs);
    }

    async runOnce(): Promise<void> {
        try {
            const cutoff = new Date(Date.now() - this.options.graceMs);
            let moved = 0;
            let published = 0;

            for (const jobId of await findExhaustedFailedJobs(cutoff, this.options.batchSize)) {
                try {
                    await this.service.deadLetter(jobId, this.options.workerId);
                    moved++;
                } catch (err) {
                    this.log.error({ event: "dlq_sweep_job_failed", jobId, err: String(err) }, "could not dead-letter job");
                }
            }

            for (const job of await findUnpublishedDeadLetters(cutoff, this.options.batchSize)) {
                try {
                    if (await this.service.publish(job.id)) published++;
                } catch (err) {
                    this.log.error({ event: "dlq_sweep_job_failed", jobId: job.id, err: String(err) }, "could not publish DLQ entry");
                }
            }

            if (moved > 0 || published > 0) {
                this.log.info({ event: "dlq_sweep_completed", moved, published }, "dlq sweep repaired jobs");
            }
        } catch (err) {
            // Postgres down, etc. Never crash the worker for this; try again next tick.
            this.log.error({ event: "dlq_sweep_failed", err: String(err) }, "dlq sweep failed");
        }
    }
}