import { DLQ_QUEUE_NAME, JOB_REGISTRY, JOB_TYPES, type DlqJobData, type JobData } from "@ats/shared";
import { closeQueues, createDlqQueue, createJobQueues, createRedisConnection } from "../index";

const STATES = ["waiting", "active", "delayed", "failed", "completed"] as const;

async function main(): Promise<void> {
  console.log("Job type registry");
  console.table(Object.values(JOB_REGISTRY));

  const connection = createRedisConnection({ failFast: true });
  const queues = createJobQueues(connection);
  const dlq = createDlqQueue(connection);
  const added: Array<{ remove(): Promise<void> }> = [];
  const runId = Date.now();

  try {
    // 1. One job per type queue. No worker exists, so they must just sit in "waiting".
    for (const type of JOB_TYPES) {
      const data: JobData = { jobId: `smoke_${runId}_${type}`, type, payload: { smoke: true } };
      added.push(await queues[type].add(type, data, { jobId: data.jobId }));
    }

    // 2. A backlog in ONE queue: 3 extra video jobs.
    for (let i = 1; i <= 3; i++) {
      const data: JobData = {
        jobId: `smoke_${runId}_video_extra_${i}`,
        type: "video-transcode",
        payload: { smoke: true },
      };
      added.push(await queues["video-transcode"].add("video-transcode", data, { jobId: data.jobId }));
    }

    // 3. One dead-lettered job, with the evidence operators need.
    const now = new Date().toISOString();
    const dead: DlqJobData = {
      jobId: `smoke_${runId}_dead`,
      type: "email-send",
      payload: { smoke: true },
      attemptCount: 5,
      error: "simulated permanent failure",
      firstFailedAt: now,
      lastFailedAt: now,
    };
    added.push(await dlq.add("dead-letter", dead, { jobId: `dlq_${dead.jobId}` }));

    // 4. Queue depths: independent per queue.
    console.log("\nQueue depths (no workers are running, so nothing is consumed)");
    const rows: Array<Record<string, string | number>> = [];
    for (const type of JOB_TYPES) {
      rows.push({ queue: type, ...(await queues[type].getJobCounts(...STATES)) });
    }
    rows.push({ queue: DLQ_QUEUE_NAME, ...(await dlq.getJobCounts(...STATES)) });
    console.table(rows);

    // 5. Which BullMQ queues exist in Redis?
    const names = new Set<string>();
    for await (const batch of connection.scanStream({ match: "bull:*", count: 200 })) {
      for (const key of batch as string[]) {
        const name = key.split(":")[1];
        if (name) names.add(name);
      }
    }
    console.log("\nQueues found in Redis:", [...names].sort().join(", "));
  } finally {
    // Clean up only what this script created.
    for (const job of added) await job.remove();
    await closeQueues(...Object.values(queues), dlq);
    await connection.quit();
  }
}

main().catch((err) => {
  console.error("smoke test failed:", err);
  process.exit(1);
});