import { z } from "zod";
import { config } from "@ats/config";
import { JOB_TYPES } from "@ats/shared";

const shortString = z.string().trim().min(1).max(200);

// Chaos testing (Phase 18): "fail the first N attempts". Rejected unless explicitly enabled.
const failTimes = z
  .number()
  .int()
  .min(0)
  .max(20)
  .optional()
  .refine((value) => value === undefined || config.CHAOS_ENABLED, {
    message: "failTimes is only accepted when CHAOS_ENABLED=true",
  });

// .strict() rejects unknown keys instead of silently dropping them: clients learn about typos.
// Every string has a max length, so the payload size is bounded by the schema itself.
const pdfExportPayload = z
  .object({ userId: shortString, documentId: shortString, failTimes })
  .strict();

const emailSendPayload = z
  .object({
    email: z.string().trim().email().max(254),
    subject: shortString.optional(),
    failTimes,
  })
  .strict();

const videoTranscodePayload = z
  .object({
    videoId: shortString,
    targetFormat: z.enum(["mp4", "webm", "hls"]).optional(),
    failTimes,
  })
  .strict();

/** Discriminated on `type`: the payload shape depends on the job type. */
export const createJobSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("pdf-export"), payload: pdfExportPayload }).strict(),
  z.object({ type: z.literal("email-send"), payload: emailSendPayload }).strict(),
  z.object({ type: z.literal("video-transcode"), payload: videoTranscodePayload }).strict(),
]);

export const idParamSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/, "invalid job id"),
});

export const listJobsQuerySchema = z.object({
  state: z.enum(["QUEUED", "PROCESSING", "COMPLETED", "FAILED", "DLQ"]).optional(),
  type: z.enum(JOB_TYPES).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().min(1).max(100).optional(),
});