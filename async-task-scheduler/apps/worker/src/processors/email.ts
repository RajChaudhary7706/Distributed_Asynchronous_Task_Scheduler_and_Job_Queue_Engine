import { config } from "@ats/config";
import { maybeFail } from "./chaos";
import type { ProcessorFn } from "./types";
import { maskEmail, pause } from "./util";

/** Simulated email send. Real version: call an email provider API (SES, SendGrid, ...). */
export const emailProcessor: ProcessorFn = async (ctx) => {
  const total = config.EMAIL_PROCESSING_TIME;
  const to = maskEmail(ctx.payload.email);

  ctx.log.info({ event: "email_connecting", to }, "Connecting to email provider...");
  await pause(total * 0.3);

  // The downstream call: the part that fails in real life (provider outage, rate limit, timeout).
  maybeFail(ctx.payload, ctx.attempt);

  ctx.log.info({ event: "email_sending", to }, "Sending email...");
  await pause(total * 0.7);

  await ctx.reportProgress(100);
  ctx.log.info({ event: "email_sent", to }, "Email sent.");
};