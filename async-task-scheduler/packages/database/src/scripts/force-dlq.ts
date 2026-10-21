import { closeDatabase, getJobById, transitionJob } from "../index";

async function main(): Promise<void> {
  const jobId = process.argv[2];
  if (!jobId) {
    console.error("usage: npm run db:force-dlq -- <jobId>");
    process.exitCode = 1;
    return;
  }
  if (!(await getJobById(jobId))) {
    console.error(`job not found: ${jobId}`);
    process.exitCode = 1;
    return;
  }

  // Goes through the real state machine: QUEUED -> PROCESSING -> FAILED -> DLQ
  const actor = { workerId: "dev-force-dlq" };
  await transitionJob(jobId, "PROCESSING", actor);
  await transitionJob(jobId, "FAILED", { ...actor, error: "forced failure (dev helper)" });
  const dead = await transitionJob(jobId, "DLQ", actor);
  console.log(`job ${dead.id} is now ${dead.state}`);
}

main()
  .catch((err) => {
    console.error("force-dlq failed:", err);
    process.exitCode = 1;
  })
  .finally(() => closeDatabase());