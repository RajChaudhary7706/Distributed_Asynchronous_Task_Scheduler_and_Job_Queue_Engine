import {
  InvalidTransitionError,
  createJob,
  getJobById,
  JobNotFoundError,
  listJobs,
  markJobEnqueued,
  transitionJob,
  type Job,
  type JobPage,
  type ListJobsInput,
} from "@ats/database";
import { enqueueJob, type JobQueues } from "@ats/queue";
import {
  getJobDefinition,
  isJobType,
  type JobData,
  type JobPayload,
  type JobType,
  type Logger,
} from "@ats/shared";
import { HttpError } from "../errors";

export interface JobServiceDeps {
  queues: JobQueues;
  log: Logger;
}

export class JobService {
  constructor(private readonly deps: JobServiceDeps) {}

  /** Record the job durably, hand it to Redis, return immediately. Never runs the task. */
  async submit(input: { type: JobType; payload: JobPayload }): Promise<Job> {
    const { maxAttempts } = getJobDefinition(input.type);

    // 1. Postgres FIRST. This insert is the commit point: once it succeeds the job exists,
    //    and the sweeper guarantees it reaches Redis even if we crash right now.
    const job = await createJob({ type: input.type, payload: input.payload, maxAttempts });

    // 2. Redis second. Never throws: failure here is recoverable (see enqueue()).
    await this.enqueue(job);

    return job;
  }

  async get(id: string): Promise<Job> {
    const job = await getJobById(id);
    if (!job) throw new JobNotFoundError(id);
    return job;
  }

  list(input: ListJobsInput): Promise<JobPage> {
    return listJobs(input);
  }

  /** Manual retry. Only DLQ jobs may come back (the state machine enforces it). */
  async retry(id: string): Promise<Job> {
    let job: Job;
    try {
      job = await transitionJob(id, "QUEUED");
    } catch (err) {
      if (err instanceof InvalidTransitionError) {
        throw new HttpError(
          409,
          "INVALID_STATE",
          `Only jobs in DLQ can be retried manually; this job is ${err.from}`,
        );
      }
      throw err;
    }
    await this.enqueue(job);
    return job;
  }

  /**
   * Hands one job to Redis and records that fact. Used by the request path AND the sweeper.
   * Returns true on success. On failure it logs and returns false: the row keeps
   * enqueuedAt = NULL, so the sweeper will try again.
   */
  async enqueue(job: Job): Promise<boolean> {
    const { log } = this.deps;

    if (!isJobType(job.type)) {
      log.error({ event: "job_enqueue_skipped", jobId: job.id, jobType: job.type }, "unknown job type");
      return false;
    }

    try {
      const data: JobData = { jobId: job.id, type: job.type, payload: job.payload as JobPayload };
      const result = await enqueueJob(this.deps.queues, data);
      await markJobEnqueued(job.id);
      log.info({ event: "job_enqueued", jobId: job.id, jobType: job.type, result }, "job enqueued");
      return true;
    } catch (err) {
      log.warn(
        { event: "job_enqueue_failed", jobId: job.id, jobType: job.type, err: String(err) },
        "enqueue failed; the sweeper will retry",
      );
      return false;
    }
  }
}