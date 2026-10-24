import type { JobPayload, JobType, Logger } from "@ats/shared";

/** Everything a processor needs. Processors know nothing about BullMQ or Postgres. */
export interface ProcessorContext {
  jobId: string;
  type: JobType;
  payload: JobPayload;
  /** 1 for the first run, 2 for the first retry, ... */
  attempt: number;
  log: Logger;
}

/** Resolve = success. Throw = this attempt failed. */
export type ProcessorFn = (ctx: ProcessorContext) => Promise<void>;