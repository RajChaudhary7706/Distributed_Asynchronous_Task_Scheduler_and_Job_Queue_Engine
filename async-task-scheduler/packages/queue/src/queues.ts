import { Queue, type JobsOptions } from "bullmq";
import type IORedis from "ioredis";
import {
  DLQ_QUEUE_NAME,
  JOB_TYPES,
  createLogger,
  getJobDefinition,
  type DlqJobData,
  type JobData,
  type JobType,
} from "@ats/shared";

const log = createLogger("queues");

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
    const queue = new Queue<JobData>(getJobDefinition(type).queueName, {
      connection,
      defaultJobOptions: DEFAULT_JOB_OPTIONS,
    });
    // A Node EventEmitter that emits 'error' with no listener THROWS and crashes the process.
    // Without this, a Redis outage would kill the API.
    queue.on("error", (err) => log.warn({ queue: queue.name, err: err.message }, "queue error"));
    queues[type] = queue;
  }
  return queues;
}

/**
 * The dead letter queue. Jobs here are NEVER auto-removed and NEVER processed:
 * they wait for a human to inspect them and (maybe) retry them.
 * Do not create a Worker for this queue.
 */
export function createDlqQueue(connection: IORedis): Queue<DlqJobData> {
  const queue = new Queue<DlqJobData>(DLQ_QUEUE_NAME, {
    connection,
    defaultJobOptions: { removeOnComplete: false, removeOnFail: false },
  });
  queue.on("error", (err) => log.warn({ queue: queue.name, err: err.message }, "queue error"));
  return queue;
}

export async function closeQueues(...queues: Array<{ close(): Promise<void> }>): Promise<void> {
  await Promise.all(queues.map((queue) => queue.close()));
}