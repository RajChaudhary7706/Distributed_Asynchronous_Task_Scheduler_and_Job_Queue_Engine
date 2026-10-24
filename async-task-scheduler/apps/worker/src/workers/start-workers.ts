import { createJobWorker, type JobWorker, type RedisConnection } from "@ats/queue";
import { getJobDefinition, type JobType, type Logger } from "@ats/shared";
import { createJobHandler } from "./job-handler";

export function startWorkers(
  types: JobType[],
  connection: RedisConnection,
  baseLog: Logger,
  workerId: string,
): JobWorker[] {
  return types.map((type) => {
    const { queueName, concurrency } = getJobDefinition(type);
    const log = baseLog.child({ queue: queueName });

    const worker = createJobWorker(connection, type, createJobHandler({ type, workerId, log }));

    // Like Queue, a Worker that emits 'error' with no listener crashes the process.
    worker.on("error", (err) => log.error({ event: "worker_error", err: err.message }, "worker error"));
    worker.on("stalled", (jobId) =>
      log.warn({ event: "job_stalled", jobId }, "job lost its lock; BullMQ will re-deliver it"),
    );

    log.info({ event: "worker_started", concurrency }, "worker started");
    return worker;
  });
}