import { createJobWorker, type JobWorker, type RedisConnection } from "@ats/queue";
import { getJobDefinition, type JobType, type Logger } from "@ats/shared";
import type { DeadLetterService } from "../dlq/dead-letter";
import { createBackoffStrategy } from "../retry/backoff";
import { createJobHandler } from "./job-handler";
import { reconcileStalledFailure } from "./reconcile";

export function startWorkers(
  types: JobType[],
  connection: RedisConnection,
  baseLog: Logger,
  workerId: string,
  deadLetter: DeadLetterService,
): JobWorker[] {
  return types.map((type) => {
    const { queueName, concurrency } = getJobDefinition(type);
    const log = baseLog.child({ queue: queueName });

    const worker = createJobWorker(
      connection,
      type,
      createJobHandler({ type, workerId, log, deadLetter }),
      { backoffStrategy: createBackoffStrategy(log) },
    );

    // Like Queue, a Worker that emits 'error' with no listener crashes the process.
    worker.on("error", (err) => log.error({ event: "worker_error", err: err.message }, "worker error"));
    worker.on("stalled", (jobId) =>
      log.warn({ event: "job_stalled", jobId }, "job lost its lock; BullMQ will re-deliver it"),
    );
    // BullMQ failed a job without running our handler (stalled too often): repair Postgres, then DLQ.
    worker.on("failed", (job, err) => {
      void reconcileStalledFailure(job?.data.jobId, err.message, workerId, deadLetter, log);
    });

    log.info({ event: "worker_started", concurrency }, "worker started");
    return worker;
  });
}