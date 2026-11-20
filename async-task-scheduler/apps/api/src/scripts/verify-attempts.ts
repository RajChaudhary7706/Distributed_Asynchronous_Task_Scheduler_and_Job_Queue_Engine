import { config } from "@ats/config";
import { closeDatabase, getJobById } from "@ats/database";
import { closeQueues, createJobQueues, createRedisConnection } from "@ats/queue";
import { JOB_TYPES, getJobDefinition, type JobType } from "@ats/shared";

// Talks to the RUNNING API, so it tests what is really deployed, not just this script's own config.
const API_URL = process.env.API_URL ?? `http://localhost:${config.API_PORT}`;

const PAYLOADS: Record<JobType, Record<string, unknown>> = {
    "pdf-export": { userId: "verify", documentId: "verify-attempts" },
    "email-send": { email: "verify@example.com" },
    "video-transcode": { videoId: "verify-attempts" },
};

async function submit(type: JobType): Promise<string> {
    const res = await fetch(`${API_URL}/jobs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, payload: PAYLOADS[type] }),
    });
    if (res.status !== 202) throw new Error(`POST /jobs (${type}) returned ${res.status}: ${await res.text()}`);
    return ((await res.json()) as { jobId: string }).jobId;
}

async function main(): Promise<void> {
    const connection = createRedisConnection({ failFast: true });
    const queues = createJobQueues(connection);
    const rows: Array<Record<string, string | number>> = [];
    let mismatch = false;

    try {
        for (const type of JOB_TYPES) {
            const jobId = await submit(type);

            const expected = getJobDefinition(type).maxAttempts; // this process: env -> registry
            const row = await getJobById(jobId); // Postgres: what the API stored
            const bull = await queues[type].getJob(jobId); // Redis: what BullMQ will enforce

            const inPostgres = row?.maxAttempts ?? -1;
            const inBullmq = bull?.opts.attempts ?? -1;
            const ok = inPostgres === expected && inBullmq === expected;
            if (!ok) mismatch = true;

            rows.push({ type, "env/registry": expected, postgres: inPostgres, bullmq: inBullmq, result: ok ? "✔" : "✘" });
        }
    } finally {
        await closeQueues(...Object.values(queues));
        await connection.quit();
        await closeDatabase();
    }

    console.table(rows);
    if (mismatch) {
        console.error("✘ Layers disagree: the API is probably running with different env than this script.");
        process.exitCode = 1;
    } else {
        console.log("✔ env, registry, Postgres and BullMQ all agree");
    }
}

main().catch((err) => {
    console.error("verify-attempts failed:", err);
    process.exit(1);
});