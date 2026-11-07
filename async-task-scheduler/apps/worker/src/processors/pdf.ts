import { config } from "@ats/config";
import { maybeFail } from "./chaos";
import type { ProcessorFn } from "./types";
import { pause } from "./util";

/** Simulated PDF generation. Real version: fetch document, render with a headless browser, upload to storage. */
export const pdfProcessor: ProcessorFn = async (ctx) => {
  const total = config.PDF_PROCESSING_TIME;
  const { userId, documentId } = ctx.payload;

  ctx.log.info({ event: "pdf_generating", userId, documentId }, "Generating PDF...");
  await pause(total * 0.2);
  await ctx.reportProgress(25);

  ctx.log.info({ event: "pdf_processing" }, "Processing...");
  await pause(total * 0.5);
  await ctx.reportProgress(75);

  // The "downstream" step: where real code would call a storage API.
  maybeFail(ctx.payload, ctx.attempt);
  await pause(total * 0.3);

  await ctx.reportProgress(100);
  ctx.log.info({ event: "pdf_generated", documentId }, "PDF generated.");
};