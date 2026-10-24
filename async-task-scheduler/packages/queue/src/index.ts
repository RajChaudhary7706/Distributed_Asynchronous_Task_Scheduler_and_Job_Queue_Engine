export { createRedisConnection, checkRedis } from "./connection";
export type { RedisConnectionOptions } from "./connection";
export type { default as RedisConnection } from "ioredis";
export { createJobQueues, createDlqQueue, closeQueues, DEFAULT_JOB_OPTIONS } from "./queues";
export type { JobQueues } from "./queues";
export { enqueueJob } from "./enqueue";
export type { EnqueueResult } from "./enqueue";
export { createJobWorker } from "./workers";
export type { JobProcessor, JobWorker } from "./workers";
// Throwing this from a processor tells BullMQ "never retry this job" (used from Phase 7 on).
export { UnrecoverableError } from "bullmq";
export type { Job } from "bullmq";