import { config } from "@ats/config";
import type { BackoffStrategy } from "@ats/queue";
import type { Logger } from "@ats/shared";

export interface BackoffOptions {
    baseDelayMs: number;
    /** Upper bound for the exponential part (jitter is added on top). */
    maxDelayMs: number;
    /** Jitter is a random integer in [0, jitterMaxMs]. */
    jitterMaxMs: number;
}

export interface BackoffResult {
    exponentialMs: number;
    jitterMs: number;
    /** exponentialMs + jitterMs: what we actually wait. */
    delayMs: number;
}

export function backoffOptionsFromConfig(): BackoffOptions {
    return {
        baseDelayMs: config.RETRY_BASE_DELAY_MS,
        maxDelayMs: config.RETRY_MAX_DELAY_MS,
        jitterMaxMs: config.RETRY_JITTER_MAX_MS,
    };
}

/**
 * delay = baseDelay × 2^(attempt - 1), capped.
 *   attempt 1 -> 1s, attempt 2 -> 2s, attempt 3 -> 4s, attempt 4 -> 8s  (with base = 1000ms)
 * `attempt` is the attempt that JUST FAILED.
 */
export function exponentialDelay(attempt: number, baseDelayMs: number, maxDelayMs: number): number {
    const exponent = Math.min(Math.max(attempt, 1) - 1, 30); // 2^30 is plenty; avoids absurd numbers
    return Math.min(baseDelayMs * 2 ** exponent, maxDelayMs);
}

/**
 * Pure function: no I/O, no globals except the injectable `random`, so tests can pin it down.
 * `random` must return a number in [0, 1) like Math.random.
 */
export function calculateBackoff(
    attempt: number,
    options: BackoffOptions,
    random: () => number = Math.random,
): BackoffResult {
    const exponentialMs = exponentialDelay(attempt, options.baseDelayMs, options.maxDelayMs);
    const jitterMs = Math.floor(random() * (options.jitterMaxMs + 1)); // 0..jitterMaxMs inclusive
    return { exponentialMs, jitterMs, delayMs: exponentialMs + jitterMs };
}

/** Adapts the pure function to BullMQ's backoffStrategy hook, and logs every scheduled retry. */
export function createBackoffStrategy(
    log: Logger,
    options: BackoffOptions = backoffOptionsFromConfig(),
    random: () => number = Math.random,
): BackoffStrategy {
    return (attemptsMade, _type, _err, job) => {
        const result = calculateBackoff(attemptsMade, options, random);
        const jobId = (job?.data as { jobId?: string } | undefined)?.jobId;

        log.info(
            {
                event: "retry_scheduled",
                jobId,
                attempt: attemptsMade,
                nextAttempt: attemptsMade + 1,
                ...result,
                retryAt: new Date(Date.now() + result.delayMs).toISOString(),
            },
            "retry scheduled",
        );
        return result.delayMs;
    };
}