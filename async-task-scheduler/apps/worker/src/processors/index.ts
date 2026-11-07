import type { JobType } from "@ats/shared";
import { emailProcessor } from "./email";
import { pdfProcessor } from "./pdf";
import type { ProcessorFn } from "./types";
import { videoProcessor } from "./video";

const PROCESSORS: Record<JobType, ProcessorFn> = {
  "pdf-export": pdfProcessor,
  "email-send": emailProcessor,
  "video-transcode": videoProcessor,
};

export function getProcessor(type: JobType): ProcessorFn {
  return PROCESSORS[type];
}

export type { ProcessorContext, ProcessorFn } from "./types";