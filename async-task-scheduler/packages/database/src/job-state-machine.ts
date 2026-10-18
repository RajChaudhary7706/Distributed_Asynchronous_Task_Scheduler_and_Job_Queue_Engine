import type { JobState } from "@prisma/client";

/**
 * The job lifecycle as data. This is the single source of truth for which
 * moves are legal. Unit-tested in the testing phase.
 *
 *   QUEUED ──► PROCESSING ──► COMPLETED
 *                  │
 *                  ▼
 *               FAILED ──► PROCESSING   (retry: attempts remain)
 *                  │
 *                  └──────► DLQ ──► QUEUED   (manual operator retry)
 *
 * FAILED means "the most recent attempt failed". With attempts remaining the job
 * waits there for its backoff delay; with none remaining it moves on to DLQ.
 */
export const ALLOWED_TRANSITIONS: Readonly<Record<JobState, readonly JobState[]>> = {
  QUEUED: ["PROCESSING"],
  PROCESSING: ["COMPLETED", "FAILED"],
  FAILED: ["PROCESSING", "DLQ"],
  COMPLETED: [], // terminal
  DLQ: ["QUEUED"], // only an operator can bring a job back
};

export class InvalidTransitionError extends Error {
  constructor(
    public readonly from: JobState,
    public readonly to: JobState,
  ) {
    super(`Illegal job state transition: ${from} -> ${to}`);
    this.name = "InvalidTransitionError";
  }
}

export function canTransition(from: JobState, to: JobState): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function assertTransition(from: JobState, to: JobState): void {
  if (!canTransition(from, to)) {
    throw new InvalidTransitionError(from, to);
  }
}