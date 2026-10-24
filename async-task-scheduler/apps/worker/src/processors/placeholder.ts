import { setTimeout as sleep } from "node:timers/promises";
import { config } from "@ats/config";
import { maybeFail } from "./chaos";
import type { ProcessorFn } from "./types";

/** Stand-in for real work. Phase 6 replaces it with PDF, email and video processors. */
export const placeholderProcessor: ProcessorFn = async (ctx) => {
  ctx.log.info({ event: "placeholder_work_started" }, "doing (fake) work");
  // A timer does not block the event loop, so BullMQ can keep renewing the job lock meanwhile.
  await sleep(config.PLACEHOLDER_PROCESSING_MS);
  maybeFail(ctx.payload, ctx.attempt);
  ctx.log.info({ event: "placeholder_work_finished" }, "fake work finished");
};