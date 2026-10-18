import {
  InvalidTransitionError,
  closeDatabase,
  createJob,
  getJobById,
  getJobEvents,
  transitionJob,
} from "../index";

async function main(): Promise<void> {
  // 1. Happy path with one failed attempt in the middle.
  const job = await createJob({
    type: "email-send",
    payload: { email: "test@example.com" },
    maxAttempts: 3,
  });
  console.log(`created   ${job.id}  state=${job.state}`);

  await transitionJob(job.id, "PROCESSING", { workerId: "smoke" });
  await transitionJob(job.id, "FAILED", { workerId: "smoke", error: "simulated failure" });
  await transitionJob(job.id, "PROCESSING", { workerId: "smoke" });
  const done = await transitionJob(job.id, "COMPLETED", { workerId: "smoke" });
  console.log(`finished  state=${done.state}  attemptCount=${done.attemptCount}`);

  // 2. The state machine must reject illegal moves.
  try {
    await transitionJob(job.id, "PROCESSING");
    console.error("✘ BUG: COMPLETED -> PROCESSING was allowed");
    process.exitCode = 1;
  } catch (err) {
    if (!(err instanceof InvalidTransitionError)) throw err;
    console.log(`✔ rejected illegal transition: ${err.message}`);
  }

  // 3. Two workers race to claim the same job: exactly one may win.
  const raced = await createJob({ type: "pdf-export", payload: { documentId: "1" }, maxAttempts: 3 });
  const results = await Promise.allSettled([
    transitionJob(raced.id, "PROCESSING", { workerId: "racer-A" }),
    transitionJob(raced.id, "PROCESSING", { workerId: "racer-B" }),
  ]);
  const won = results.filter((r) => r.status === "fulfilled").length;
  const lost = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
  console.log(
    `${won === 1 ? "✔" : "✘"} concurrent claim: ${won} won, ${lost.length} rejected` +
      ` (${lost.map((r) => (r.reason as Error).name).join(", ")})`,
  );
  if (won !== 1) process.exitCode = 1;
  const racedFinal = await getJobById(raced.id);
  console.log(`          attemptCount=${racedFinal?.attemptCount} (must be 1)`);

  // 4. Show the audit trail.
  console.log("\nEvent timeline for", job.id);
  const events = await getJobEvents(job.id);
  console.table(
    events.map((e) => ({
      from: e.fromState ?? "-",
      to: e.toState,
      attempt: e.attempt,
      error: e.error ?? "",
      worker: e.workerId ?? "",
      at: e.createdAt.toISOString(),
    })),
  );
}

main()
  .catch((err) => {
    console.error("smoke test failed:", err);
    process.exitCode = 1;
  })
  .finally(() => closeDatabase());