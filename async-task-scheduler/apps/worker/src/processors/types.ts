import type { JobPayload, JobType, Logger } from "@ats/shared";

/** Everything a processor needs. Processors know nothing about BullMQ or Postgres. */
export interface ProcessorContext {
  jobId: string;
  type: JobType;
  payload: JobPayload;
  /** 1 for the first run, 2 for the first retry, ... */
  attempt: number;
  log: Logger;
  /**
   * Reports progress (0-100). Best effort: it never throws, and a failed
   * update never fails the job. Progress lives in Redis only.
   */
  reportProgress: (percent: number) => Promise<void>;
}

/** Resolve = success. Throw = this attempt failed. */
export type ProcessorFn = (ctx: ProcessorContext) => Promise<void>;