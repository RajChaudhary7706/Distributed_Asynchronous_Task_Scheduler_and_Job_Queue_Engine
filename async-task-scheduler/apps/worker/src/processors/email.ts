import { config } from "@ats/config";
import { maybeFail } from "./chaos";
import { PermanentError } from "./error";
import type { ProcessorFn } from "./types";
import { maskEmail, pause } from "./util";

// Chaos testing: this domain behaves like a provider that rejects the address for good.
const REJECTED_DOMAIN = "@bounce.example.com";

/** Simulated email send. Real version: call an email provider API (SES, SendGrid, ...). */
export const emailProcessor: ProcessorFn = async (ctx) => {
  const total = config.EMAIL_PROCESSING_TIME;
  const email = ctx.payload.email;
  const to = maskEmail(email);

  ctx.log.info({ event: "email_connecting", to }, "Connecting to email provider...");
  await pause(total * 0.3);

  // A 4xx-style answer from the provider: retrying will never change it.
  if (config.CHAOS_ENABLED && typeof email === "string" && email.endsWith(REJECTED_DOMAIN)) {
    throw new PermanentError("recipient address rejected by provider (permanent failure)");
  }

  // The downstream call: the part that fails in real life (provider outage, rate limit, timeout).
  // These failures are transient, so the handler retries them.
  maybeFail(ctx.payload, ctx.attempt);

  ctx.log.info({ event: "email_sending", to }, "Sending email...");
  await pause(total * 0.7);

  await ctx.reportProgress(100);
  ctx.log.info({ event: "email_sent", to }, "Email sent.");
};