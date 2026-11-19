import { backoffOptionsFromConfig, calculateBackoff, type BackoffOptions } from "../retry/backoff";

const options = backoffOptionsFromConfig();

console.log(
    `Backoff schedule (base ${options.baseDelayMs}ms, cap ${options.maxDelayMs}ms, jitter 0-${options.jitterMaxMs}ms)`,
);
console.table(
    Array.from({ length: 8 }, (_, i) => {
        const attempt = i + 1;
        const lowest = calculateBackoff(attempt, options, () => 0);
        const highest = calculateBackoff(attempt, options, () => 0.999999);
        return {
            afterFailedAttempt: attempt,
            exponentialMs: lowest.exponentialMs,
            minDelayMs: lowest.delayMs,
            maxDelayMs: highest.delayMs,
        };
    }),
);

// Retry storm demo: 1000 jobs all fail at the same instant (their first attempt).
// How many of them hit the downstream service within the same 100ms window?
function burst(opts: BackoffOptions, jobs = 1000): { peak: number; windows: number } {
    const windows = new Map<number, number>();
    for (let i = 0; i < jobs; i++) {
        const window = Math.floor(calculateBackoff(1, opts).delayMs / 100) * 100;
        windows.set(window, (windows.get(window) ?? 0) + 1);
    }
    return { peak: Math.max(...windows.values()), windows: windows.size };
}

const without = burst({ ...options, jitterMaxMs: 0 });
const withJitter = burst(options);

console.log("\n1000 jobs fail at the same instant. Their first retries land like this:");
console.table([
    { strategy: "no jitter", "peak jobs in one 100ms window": without.peak, "windows used": without.windows },
    { strategy: "with jitter", "peak jobs in one 100ms window": withJitter.peak, "windows used": withJitter.windows },
]);