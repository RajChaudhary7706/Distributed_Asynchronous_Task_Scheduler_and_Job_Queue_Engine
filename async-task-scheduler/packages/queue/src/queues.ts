import { Queue, type JobsOptions } from "bullmq";
import type IORedis from "ioredis";
import {
  DLQ_QUEUE_NAME,
  JOB_TYPES,
  getJobDefinition,
  type DlqJobData,
  type JobData,
  type JobType,
} from "@ats/shared";

const HOUR = 3600; // BullMQ ages are in seconds
const DAY = 24 * HOUR;

/**
 * Redis is not our ledger (Postgres is), so finished jobs are pruned.
 * Whichever limit is hit first (age or count) triggers removal.
 * Retry attempts and backoff are added per job in Phase 7.
 */
export const DEFAULT_JOB_OPTIONS: JobsOptions = {
  removeOnComplete: { age: DAY, count: 1000 },
  removeOnFail: { age: 7 * DAY, count: 5000 },
};

export type JobQueues = Record<JobType, Queue<JobData>>;

/** One BullMQ queue per job type. Used by the API to enqueue. */
export function createJobQueues(connection: IORedis): JobQueues {
  const queues = {} as JobQueues;
  for (const type of JOB_TYPES) {
    queues[type] = new Queue<JobData>(getJobDefinition(type).queueName, {
      connection,
      defaultJobOptions: DEFAULT_JOB_OPTIONS,
    });
  }
  return queues;
}

/**
 * The dead letter queue. Jobs here are NEVER auto-removed and NEVER processed:
 * they wait for a human to inspect them and (maybe) retry them.
 * Do not create a Worker for this queue.
 */
export function createDlqQueue(connection: IORedis): Queue<DlqJobData> {
  return new Queue<DlqJobData>(DLQ_QUEUE_NAME, {
    connection,
    defaultJobOptions: { removeOnComplete: false, removeOnFail: false },
  });
}

export async function closeQueues(...queues: Array<{ close(): Promise<void> }>): Promise<void> {
  await Promise.all(queues.map((queue) => queue.close()));
}