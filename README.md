# Distributed Asynchronous Task Scheduler & Job Queue Engine

A production-grade, distributed asynchronous task scheduling and job queue engine built with **Node.js**, **TypeScript**, **BullMQ**, **Redis**, and **PostgreSQL**.

Designed around **at-least-once delivery semantics**, **durable state persistence**, and **fault-tolerant worker recovery**, the system guarantees that jobs are never lost, retry storms are prevented via jittered exponential backoff, and crashed or stalled workers are reliably recovered without operator intervention.

---

## 🏛️ System Architecture

```mermaid
flowchart TD
    Client["Client / HTTP Caller"] -->|"POST /jobs"| API["Express REST API (@ats/api)"]
    API -->|"1. Durable write (QUEUED)"| PG[("PostgreSQL (Durable Source of Truth)")]
    API -->|"2. Enqueue job"| Redis[("Redis (BullMQ Broker)")]
    API -.->|"Polls orphaned QUEUED jobs"| Sweeper["Enqueue Sweeper"]
    Sweeper -.->|"Re-enqueues missing jobs"| Redis

    Redis -->|"Dispatches job"| Worker["Worker Process (@ats/worker)"]
    Worker -->|"Optimistic claim (PROCESSING)"| PG
    Worker -->|"Renews execution lock (heartbeat)"| Redis
    Worker -->|"Executes Processor (PDF / Email / Video)"| Processor["Job Processor"]

    Processor -->|"Success"| Complete["COMPLETED (State write)"]
    Complete --> PG

    Processor -->|"Transient Failure"| Retry["FAILED (Backoff & Jitter Schedule)"]
    Retry -->|"Re-enqueued for delay"| Redis
    Retry --> PG

    Processor -->|"Exhausted Retries or Permanent Error"| DLQ["DLQ Queue & DB State"]
    DLQ --> PG
```

### Key Architectural Tenets
- **PostgreSQL is the Ultimate Source of Truth**: State is persisted durably before acknowledgement to clients and before execution starts. Redis acts strictly as a high-throughput, low-latency execution and messaging broker.
- **Strict Finite State Machine**: State transitions (`QUEUED`, `PROCESSING`, `COMPLETED`, `FAILED`, `DLQ`) are enforced with optimistic locking against a versioned `updatedAt` timestamp and recorded in an append-only audit log (`job_events`).
- **Resilience to Network Drops & Broker Outages**: The API implements an outbox-style background **Enqueue Sweeper** that detects and recovers jobs recorded in PostgreSQL that failed to reach Redis during brief network hiccups.
- **Retry Storm Prevention**: Transient failures are backed off exponentially with additive uniform jitter (`[0, RETRY_JITTER_MAX_MS]`), flattening peak redispatch loads across worker pools.
- **Zero-Downtime Worker Crash Recovery**: Active workers renew locks periodically. If a worker is hard-killed or hangs, BullMQ's stalled job detection and worker reconciliation logic safely transitions and reclaims the job.

---

## 🔄 Job Lifecycle & State Machine

Every job transitions through a strictly validated state machine:

```mermaid
stateDiagram-v2
    [*] --> QUEUED: Job Created & Persisted
    QUEUED --> PROCESSING: Worker Claims Job
    PROCESSING --> COMPLETED: Success
    PROCESSING --> FAILED: Failure (Attempts Remain)
    FAILED --> PROCESSING: Retry Backoff Timer Expires
    FAILED --> DLQ: Retries Exhausted or PermanentError
    DLQ --> QUEUED: Operator Manual Retry (POST /jobs/:id/retry)
    COMPLETED --> [*]
```

| State | Description |
|---|---|
| `QUEUED` | Job is safely written to PostgreSQL and dispatched to Redis waiting for worker pickup. |
| `PROCESSING` | Worker has acquired the lock, incremented `attemptCount`, and is actively executing the processor. |
| `COMPLETED` | Processor completed successfully; terminal state. |
| `FAILED` | Attempt encountered an error. If attempts remain, it is delayed by BullMQ according to the backoff schedule. |
| `DLQ` | Job exhausted its `maxAttempts` or threw a `PermanentError`. Parked for operator review or manual replay. |

---

## 📦 Monorepo Workspace Structure

The project is structured as an npm workspaces monorepo:

```text
├── apps/
│   ├── api/             # Express HTTP API: job submission, pagination, manual retries, health, sweeper
│   └── worker/          # BullMQ worker runtime: concurrency handlers, backoff, stalled reconcilers
├── packages/
│   ├── config/          # Centralized Zod-validated configuration loaded from root .env
│   ├── database/        # Prisma schema, migrations, repository, and state machine transition rules
│   ├── queue/           # BullMQ & IORedis connection abstractions, worker & queue wrappers
│   └── shared/          # Shared interfaces, job registry, constants, and structured Pino logger
├── docker/              # Docker Compose infrastructure & SQL diagnostics
└── package.json         # Monorepo root scripts & configuration
```

### Supported Job Types

Each job type has dedicated queue routing and concurrency controls configured in `@ats/shared`:

| Job Type | Queue Name | Default Max Attempts | Concurrency | Simulates |
|---|---|:---:|:---:|---|
| `pdf-export` | `pdf-export` | 3 | 2 | CPU/IO document rendering |
| `email-send` | `email-send` | 5 | 10 | Third-party API calls, rate limits, bounce handling |
| `video-transcode` | `video-transcode` | 3 | 1 | Heavy CPU compute, single-threaded throughput |

---

## 🚀 Quick Start Guide

### Prerequisites
- **Node.js** `>= 20.0.0`
- **npm** `>= 10.0.0`
- **Docker & Docker Compose** (for PostgreSQL and Redis)

### 1. Clone & Setup Environment
```bash
# Navigate to the workspace directory
cd async-task-scheduler

# Create local environment file
cp .env.example .env

# Install dependencies across all packages
npm install
```

### 2. Start Infrastructure
Start PostgreSQL (port 5432) and Redis (port 6379) in detached mode:
```bash
npm run infra:up
```

### 3. Initialize Database
Generate Prisma client and execute migrations:
```bash
npm run db:generate
npm run db:migrate -- --name init
```

### 4. Start Services
Open two terminal windows:

**Terminal 1 (REST API)**:
```bash
npm run dev:api
```

**Terminal 2 (Job Worker Pool)**:
```bash
# Runs workers for all queues
npm run dev:worker

# Or run workers dedicated to specific queues:
npm run dev:worker:pdf
npm run dev:worker:email
npm run dev:worker:video
```

---

## 📡 REST API Reference

The API listens on port `3000` by default.

### Health Check
Evaluates readiness of PostgreSQL and Redis connections.
- **Endpoint**: `GET /health`
- **Response** (`200 OK` or `503 Service Unavailable`):
```json
{
  "status": "ok",
  "service": "api",
  "uptimeSeconds": 42,
  "dependencies": {
    "postgres": "up",
    "redis": "up"
  }
}
```

### Submit Job
Dispatches a new job. Persists immediately into PostgreSQL and enqueues to Redis.
- **Endpoint**: `POST /jobs`
- **Status**: `202 Accepted`
- **Payload Examples**:

**PDF Export**:
```bash
curl -X POST http://localhost:3000/jobs \
  -H "Content-Type: application/json" \
  -d '{"type":"pdf-export","payload":{"userId":"user_123","documentId":"doc_456"}}'
```

**Email Send**:
```bash
curl -X POST http://localhost:3000/jobs \
  -H "Content-Type: application/json" \
  -d '{"type":"email-send","payload":{"email":"test@example.com","subject":"Welcome!"}}'
```

**Video Transcode**:
```bash
curl -X POST http://localhost:3000/jobs \
  -H "Content-Type: application/json" \
  -d '{"type":"video-transcode","payload":{"videoId":"vid_789","targetFormat":"mp4"}}'
```

### Inspect Job Details
- **Endpoint**: `GET /jobs/:id`
```bash
curl http://localhost:3000/jobs/<jobId>
```
- **Response**:
```json
{
  "id": "cm...abc123",
  "type": "pdf-export",
  "state": "COMPLETED",
  "attemptCount": 1,
  "maxAttempts": 3,
  "createdAt": "2026-11-21T01:00:00.000Z",
  "updatedAt": "2026-11-21T01:00:05.000Z",
  "startedAt": "2026-11-21T01:00:01.000Z",
  "completedAt": "2026-11-21T01:00:05.000Z",
  "failedAt": null,
  "error": null
}
```

### List & Filter Jobs (Cursor Pagination)
- **Endpoint**: `GET /jobs?state=FAILED&type=email-send&limit=20&cursor=<cursor>`
```bash
curl "http://localhost:3000/jobs?state=DLQ&limit=10"
```

### Replay / Retry Dead-Lettered Job
Re-queues a failed or dead-lettered (`DLQ`) job for execution.
- **Endpoint**: `POST /jobs/:id/retry`
- **Status**: `202 Accepted`
```bash
curl -X POST http://localhost:3000/jobs/<jobId>/retry
```

---

## 🛡️ Reliability & Fault Tolerance Scenarios

### 1. Worker Crash Recovery (Stalled Lock Detection)
Demonstrates BullMQ lock expiration and database state reconciliation when a worker abruptly terminates.

1. Start API and infrastructure (`npm run infra:up`, `npm run dev:api`).
2. In PowerShell, start a worker with an extended processing delay:
   ```powershell
   $env:PLACEHOLDER_PROCESSING_MS = "120000"
   npm run dev:worker:pdf
   ```
3. In a second terminal, enqueue a test job:
   ```powershell
   $created = Invoke-RestMethod -Method Post -Uri "http://localhost:3000/jobs" -ContentType "application/json" -Body '{"type":"pdf-export","payload":{"userId":"1","documentId":"crash-test"}}'
   $jobId = $created.jobId
   $jobId
   ```
4. Once the worker logs `job processing`, open **Task Manager** and forcibly kill the worker node process (simulating an unexpected crash or OOM kill). Do not use Ctrl+C, which triggers graceful shutdown.
5. Verify the job row remains in `PROCESSING` in PostgreSQL:
   ```powershell
   Invoke-RestMethod -Uri "http://localhost:3000/jobs/$jobId"
   ```
6. Start a clean worker:
   ```powershell
   $env:PLACEHOLDER_PROCESSING_MS = "3000"
   npm run dev:worker
   ```
7. BullMQ's lock expires (`stalledInterval: 30000`). The new worker picks up the stalled job, notes the interruption, transitions `PROCESSING -> FAILED -> PROCESSING`, and completes the job with `attemptCount = 2`.
8. Inspect the audit log in PostgreSQL:
   ```powershell
   docker compose exec postgres psql -U postgres -d task_scheduler -c "SELECT `"fromState`", `"toState`", attempt, `"workerId`", `"createdAt`" FROM job_events WHERE `"jobId`"='$jobId' ORDER BY id;"
   ```

### 2. Retry Storm Mitigation (Exponential Backoff + Jitter)
Review backoff intervals and preview how additive jitter breaks up clustered retries:
```bash
npm run retry:preview
```
*Outputs the exponential backoff matrix and demonstrates how 1,000 simultaneous job failures are dispersed across windows instead of hitting downstreams concurrently.*

### 3. Layer Agreement & Attempt Verification
Validates that configuration, the shared registry, PostgreSQL constraints, and BullMQ queue options are 100% in sync:
```bash
npm run attempts:verify
```

### 4. Backoff Interval SQL Report
Inspect the exact time elapsed between failed and retried attempts for any specific job:
```bash
docker compose exec -T postgres psql -U postgres -d task_scheduler -v job=<jobId> < docker/backoff-report.sql
```

---

## ⚙️ Configuration Reference

All settings can be customized in `.env` (managed with type-safe schema checks in `packages/config`):

| Variable | Type | Default | Description |
|---|---|:---:|---|
| `NODE_ENV` | `string` | `development` | Runtime environment (`development`, `test`, `production`) |
| `API_PORT` | `number` | `3000` | HTTP port for the Express API |
| `DATABASE_URL` | `string` | `postgresql://postgres:postgres@localhost:5432/task_scheduler` | PostgreSQL connection string |
| `REDIS_URL` | `string` | `redis://localhost:6379` | Redis connection URL |
| `WORKER_ID` | `string` | `worker-<pid>` | Unique worker identifier used in event auditing |
| `WORKER_QUEUE` | `string` | `all` | Queues to process: `all` or comma-separated list |
| `RETRY_BASE_DELAY_MS` | `number` | `1000` | Base exponential delay factor |
| `RETRY_MAX_DELAY_MS` | `number` | `300000` | Maximum cap on exponential retry backoff |
| `RETRY_JITTER_MAX_MS` | `number` | `500` | Maximum uniform random jitter added to delay |
| `SWEEP_INTERVAL_MS` | `number` | `10000` | Sweeper check frequency for orphaned jobs |
| `SWEEP_GRACE_MS` | `number` | `15000` | Minimum age of `QUEUED` jobs before sweeper recovers |
| `CHAOS_ENABLED` | `boolean` | `false` | Enables simulation flags like `failTimes` and provider bounces |

---

## 🛠️ CLI & NPM Scripts

Run from the root or within workspace packages:

| Command | Target / Workspace | Description |
|---|---|---|
| `npm run infra:up` | Root / Docker | Starts PostgreSQL and Redis containers |
| `npm run infra:down` | Root / Docker | Stops and removes infrastructure containers |
| `npm run infra:logs` | Root / Docker | Streams container logs |
| `npm run dev:api` | `@ats/api` | Starts API server with auto-reloading (`tsx watch`) |
| `npm run dev:worker` | `@ats/worker` | Starts workers for all queues |
| `npm run dev:worker:pdf` | `@ats/worker` | Starts dedicated worker for `pdf-export` queue |
| `npm run dev:worker:email` | `@ats/worker` | Starts dedicated worker for `email-send` queue |
| `npm run dev:worker:video` | `@ats/worker` | Starts dedicated worker for `video-transcode` queue |
| `npm run typecheck` | All workspaces | Runs TypeScript typechecks (`tsc --noEmit`) |
| `npm run retry:preview` | `@ats/worker` | Runs backoff schedule and retry storm simulation |
| `npm run attempts:verify` | `@ats/api` | Tests configuration agreement across all layers |
| `npm run db:generate` | `@ats/database` | Regenerates Prisma Client |
| `npm run db:migrate` | `@ats/database` | Runs Prisma development migrations |
| `npm run db:smoke` | `@ats/database` | Runs database client and migration smoke tests |
| `npm run queue:smoke` | `@ats/queue` | Runs Redis & BullMQ connectivity smoke tests |
| `npm run db:studio` | `@ats/database` | Launches Prisma Studio GUI |
