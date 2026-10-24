import { config } from "@ats/config";
import type { JobPayload } from "@ats/shared";

/**
 * Chaos testing hook: if payload.failTimes = N, attempts 1..N throw and attempt N+1 succeeds.
 * Ignored unless CHAOS_ENABLED=true (the API also refuses the field in that case).
 */
export function maybeFail(payload: JobPayload, attempt: number): void {
  if (!config.CHAOS_ENABLED) return;
  const failTimes = payload.failTimes;
  if (typeof failTimes === "number" && attempt <= failTimes) {
    throw new Error(`chaos: simulated failure on attempt ${attempt} of ${failTimes}`);
  }
}