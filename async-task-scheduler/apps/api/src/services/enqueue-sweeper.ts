import { findUnenqueuedJobs } from "@ats/database";
import type { Logger } from "@ats/shared";
import type { JobService } from "./job-service";

export interface SweeperOptions {
  intervalMs: number;
  /** Ignore jobs younger than this: their request handler is probably still enqueueing them. */
  graceMs: number;
  batchSize: number;
}

/**
 * Safety net for the Postgres -> Redis gap: finds QUEUED jobs that never reached Redis
 * (API crash, Redis outage) and enqueues them.
 *
 * Safe to run in every API instance at once. Enqueueing is idempotent, so two sweepers
 * picking the same row is harmless. The grace period only avoids wasted work; correctness
 * never depends on it.
 */
export class EnqueueSweeper {
  private timer: NodeJS.Timeout | undefined;
  private stopped = false;
  private current: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly service: JobService,
    private readonly options: SweeperOptions,
    private readonly log: Logger,
  ) {}

  start(): void {
    this.log.info({ ...this.options }, "enqueue sweeper started");
    this.schedule();
  }

  /** Stops scheduling and waits for a sweep that is already running. */
  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    await this.current;
  }

  // setTimeout chain (not setInterval): the next sweep is scheduled only after the
  // previous one finishes, so sweeps never overlap.
  private schedule(): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      this.current = this.runOnce().finally(() => this.schedule());
    }, this.options.intervalMs);
  }

  async runOnce(): Promise<void> {
    try {
      const cutoff = new Date(Date.now() - this.options.graceMs);
      const stale = await findUnenqueuedJobs(cutoff, this.options.batchSize);
      if (stale.length === 0) return;

      let recovered = 0;
      for (const job of stale) {
        if (await this.service.enqueue(job)) recovered++;
      }
      this.log.info({ event: "sweep_completed", found: stale.length, recovered }, "sweep recovered jobs");
    } catch (err) {
      // Postgres down, etc. Log and try again next tick. Never crash the API for this.
      this.log.error({ event: "sweep_failed", err: String(err) }, "sweep failed");
    }
  }
}