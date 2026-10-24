import type { JobType } from "@ats/shared";
import { placeholderProcessor } from "./placeholder";
import type { ProcessorFn } from "./types";

const processors: Readonly<Record<JobType, ProcessorFn>> = {
  "pdf-export": placeholderProcessor,
  "email-send": placeholderProcessor,
  "video-transcode": placeholderProcessor,
};

export function getProcessor(type: JobType): ProcessorFn {
  return processors[type];
}
