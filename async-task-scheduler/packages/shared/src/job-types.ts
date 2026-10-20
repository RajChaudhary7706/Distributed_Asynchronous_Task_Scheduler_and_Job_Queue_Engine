import { config } from "@ats/config";

/** The job types this system knows about. Add a new type here and in JOB_REGISTRY. */
export const JOB_TYPES = ["pdf-export", "email-send", "video-transcode"] as const;
export type JobType = (typeof JOB_TYPES)[number];

/** Dead letter queue: holds jobs that exhausted their attempts. NO worker ever consumes it. */
export const DLQ_QUEUE_NAME = "dlq";

export interface JobTypeDefinition {
  type: JobType;
  /** BullMQ queue name. Same as the type for now, but kept separate so they can diverge. */
  queueName: string;
  /** Total attempts allowed (1 initial run + retries) before the job moves to the DLQ. */
  maxAttempts: number;
  /** Jobs one worker process runs in parallel. */
  concurrency: number;
}

export const JOB_REGISTRY: Readonly<Record<JobType, JobTypeDefinition>> = {
  "pdf-export": {
    type: "pdf-export",
    queueName: "pdf-export",
    maxAttempts: config.PDF_MAX_ATTEMPTS,
    concurrency: config.PDF_CONCURRENCY,
  },
  "email-send": {
    type: "email-send",
    queueName: "email-send",
    maxAttempts: config.EMAIL_MAX_ATTEMPTS,
    concurrency: config.EMAIL_CONCURRENCY,
  },
  "video-transcode": {
    type: "video-transcode",
    queueName: "video-transcode",
    maxAttempts: config.VIDEO_MAX_ATTEMPTS,
    concurrency: config.VIDEO_CONCURRENCY,
  },
};

export function isJobType(value: string): value is JobType {
  return (JOB_TYPES as readonly string[]).includes(value);
}

export function getJobDefinition(type: JobType): JobTypeDefinition {
  return JOB_REGISTRY[type];
}

/** Arbitrary JSON object supplied by the client. Validated per type in Phase 4. */
export type JobPayload = Record<string, unknown>;

/**
 * What travels through BullMQ for a normal job.
 * Deliberately small: the authoritative state lives in Postgres.
 */
export interface JobData {
  /** Postgres job id; also used as the BullMQ job id. */
  jobId: string;
  type: JobType;
  payload: JobPayload;
}

/** What we preserve for operators when a job is dead-lettered. */
export interface DlqJobData {
  jobId: string;
  type: JobType;
  payload: JobPayload;
  attemptCount: number;
  error: string;
  /** ISO timestamps. */
  firstFailedAt: string;
  lastFailedAt: string;
}