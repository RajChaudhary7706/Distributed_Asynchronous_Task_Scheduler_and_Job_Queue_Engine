import { randomUUID } from "node:crypto";
import { Prisma, type Job, type JobEvent, type JobState } from "@prisma/client";
import { prisma } from "./client";
import { assertTransition } from "./job-state-machine";

export class JobNotFoundError extends Error {
  constructor(public readonly jobId: string) {
    super(`Job not found: ${jobId}`);
    this.name = "JobNotFoundError";
  }
}

/** Someone else modified the job between our read and our write. Safe to re-read and decide again. */
export class StaleTransitionError extends Error {
  constructor(
    public readonly jobId: string,
    public readonly expectedState: JobState,
  ) {
    super(`Job ${jobId} was modified concurrently (expected state ${expectedState})`);
    this.name = "StaleTransitionError";
  }
}

export interface CreateJobInput {
  type: string;
  payload: Prisma.InputJsonValue;
  maxAttempts: number;
  /** Optional: lets the caller choose the id. Defaults to "job_<uuid>". */
  id?: string;
}

export interface TransitionMeta {
  /** Required when moving to FAILED. */
  error?: string;
  workerId?: string;
}

/** Creates the job row (state = QUEUED) and its first event atomically. */
export async function createJob(input: CreateJobInput): Promise<Job> {
  return prisma.job.create({
    data: {
      id: input.id ?? `job_${randomUUID()}`,
      type: input.type,
      payload: input.payload,
      maxAttempts: input.maxAttempts,
      state: "QUEUED",
      events: { create: { fromState: null, toState: "QUEUED", attempt: 0 } },
    },
  });
}

export async function getJobById(id: string): Promise<Job | null> {
  return prisma.job.findUnique({ where: { id } });
}

export async function getJobEvents(jobId: string): Promise<JobEvent[]> {
  return prisma.jobEvent.findMany({
    where: { jobId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
}

/**
 * The ONLY way job state changes. In one database transaction it:
 *   1. reads the job,
 *   2. checks the move is legal (state machine),
 *   3. applies it with an optimistic lock (WHERE state AND updatedAt match),
 *   4. appends a job_events row.
 *
 * Optimistic locking: if two processes race to change the same job, exactly one
 * UPDATE matches and the other affects 0 rows, so we throw StaleTransitionError
 * instead of silently overwriting. No row locks are held while we "think".
 */
export async function transitionJob(
  jobId: string,
  to: JobState,
  meta: TransitionMeta = {},
): Promise<Job> {
  return prisma.$transaction(async (tx) => {
    const current = await tx.job.findUnique({ where: { id: jobId } });
    if (!current) throw new JobNotFoundError(jobId);

    assertTransition(current.state, to);

    const now = new Date();
    const { data, attempt } = buildTransition(current, to, now, meta);

    const { count } = await tx.job.updateMany({
      where: { id: jobId, state: current.state, updatedAt: current.updatedAt },
      data,
    });
    if (count === 0) throw new StaleTransitionError(jobId, current.state);

    await tx.jobEvent.create({
      data: {
        jobId,
        fromState: current.state,
        toState: to,
        attempt,
        error: meta.error ?? null,
        workerId: meta.workerId ?? null,
      },
    });

    return tx.job.findUniqueOrThrow({ where: { id: jobId } });
  });
}

/** Decides which columns change for each target state. */
function buildTransition(
  current: Job,
  to: JobState,
  now: Date,
  meta: TransitionMeta,
): { data: Prisma.JobUpdateManyMutationInput; attempt: number } {
  switch (to) {
    case "PROCESSING": {
      const attempt = current.attemptCount + 1;
      return { data: { state: to, attemptCount: attempt, startedAt: now }, attempt };
    }
    case "COMPLETED":
      return {
        data: { state: to, completedAt: now, error: null },
        attempt: current.attemptCount,
      };
    case "FAILED":
      if (!meta.error) {
        // Never record a failure without a reason.
        throw new Error("Transition to FAILED requires meta.error");
      }
      return {
        data: { state: to, failedAt: now, error: meta.error },
        attempt: current.attemptCount,
      };
    case "DLQ":
      // Keep error/failedAt/attemptCount as they are: that's the evidence for operators.
      return { data: { state: to }, attempt: current.attemptCount };
    case "QUEUED":
      // Only reachable from DLQ (manual retry): start fresh.
      return {
        data: {
          state: to,
          attemptCount: 0,
          error: null,
          startedAt: null,
          failedAt: null,
          completedAt: null,
        },
        attempt: 0,
      };
    default:
      throw new Error(`Unhandled target state: ${String(to)}`);
  }
}