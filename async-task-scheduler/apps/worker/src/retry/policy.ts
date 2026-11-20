import { getJobDefinition, type JobType } from "@ats/shared";
import { backoffOptionsFromConfig, calculateBackoff, type BackoffOptions } from "./backoff";

export interface RetryPolicySummary {
    type: JobType;
    /** Total runs allowed, including the first. */
    maxAttempts: number;
    /** maxAttempts - 1 */
    retries: number;
    /** Time spent WAITING between attempts if every attempt fails (processing time excluded). */
    minTotalBackoffMs: number;
    maxTotalBackoffMs: number;
}

/**
 * What a job type's limit really means in time. Reuses calculateBackoff with a pinned
 * `random` to get the lowest and highest possible jitter, so it can never drift from the real math.
 */
export function summarizeRetryPolicy(
    type: JobType,
    options: BackoffOptions = backoffOptionsFromConfig(),
): RetryPolicySummary {
    const { maxAttempts } = getJobDefinition(type);

    let minTotalBackoffMs = 0;
    let maxTotalBackoffMs = 0;
    // A wait happens after each failed attempt except the last one.
    for (let failed = 1; failed < maxAttempts; failed++) {
        minTotalBackoffMs += calculateBackoff(failed, options, () => 0).delayMs;
        maxTotalBackoffMs += calculateBackoff(failed, options, () => 0.999999).delayMs;
    }

    return { type, maxAttempts, retries: maxAttempts - 1, minTotalBackoffMs, maxTotalBackoffMs };
}