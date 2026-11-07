import { config } from "@ats/config";
import { maybeFail } from "./chaos";
import type { ProcessorFn } from "./types";
import { pause } from "./util";

const SEGMENTS = 10;

/**
 * Simulated video transcoding: ten segments, progress after each one.
 *
 * Real version: spawn ffmpeg as a CHILD PROCESS, await its exit, parse its progress output.
 * The heavy CPU work then happens outside this Node process, so the event loop (and
 * BullMQ's lock renewal) stays healthy. The control flow below stays the same.
 */
export const videoProcessor: ProcessorFn = async (ctx) => {
  const perSegmentMs = config.VIDEO_PROCESSING_TIME / SEGMENTS;
  const { videoId, targetFormat = "mp4" } = ctx.payload;

  ctx.log.info({ event: "video_transcoding", videoId, targetFormat }, "Transcoding video...");

  for (let segment = 1; segment <= SEGMENTS; segment++) {
    await pause(perSegmentMs);
    await ctx.reportProgress(Math.round((segment / SEGMENTS) * 100));
    ctx.log.debug({ event: "video_segment_done", segment, of: SEGMENTS }, "segment transcoded");

    // Fail halfway through, like a real crash would: some work done, nothing delivered.
    if (segment === SEGMENTS / 2) maybeFail(ctx.payload, ctx.attempt);
  }

  ctx.log.info({ event: "video_transcoded", videoId, targetFormat }, "Video transcoded.");
};