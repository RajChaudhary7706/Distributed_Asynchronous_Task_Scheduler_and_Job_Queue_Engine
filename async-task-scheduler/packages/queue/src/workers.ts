import { Worker, type Job } from "bullmq";
import type IORedis from "ioredis";
import { getJobDefinition, type JobData, type JobType } from "@ats/shared";

/** What a worker app provides: the function that handles one job. Throwing means "this attempt failed". */
export type JobProcessor = (job: Job<JobData, void>) => Promise<void>;
export type JobWorker = Worker<JobData, void>;

/**
 * Creates the BullMQ worker for one job type.
 * Queue name and concurrency come from the registry, so they are defined in exactly one place.
 *
 * `connection` must have maxRetriesPerRequest: null (createRedisConnection does this).
 * BullMQ duplicates it internally for its blocking "wait for next job" connection.
 * We keep ownership of the connection we pass in: worker.close() does not quit it.
 */
export function createJobWorker(
  connection: IORedis,
  type: JobType,
  processor: JobProcessor,
): JobWorker {
  const { queueName, concurrency } = getJobDefinition(type);

  return new Worker<JobData, void>(queueName, processor, {
    connection,
    concurrency,
    // While a job runs, the worker renews a lock in Redis every lockDuration/2.
    // If renewal stops (crash, frozen event loop) the lock expires, the job is declared
    // "stalled", and BullMQ hands it to another worker. This is how crashed workers are recovered.
    lockDuration: 30_000,
    stalledInterval: 30_000,
    // A job may stall once and be re-delivered; stalling twice fails it (guards against jobs that crash workers).
    maxStalledCount: 1,
  });
}