# Async Task Scheduler

Distributed asynchronous task scheduler and job queue engine (Node.js, TypeScript, BullMQ, Redis, PostgreSQL).

## Quick start

    cp .env.example .env
    npm install
    npm run infra:up
    npm run db:generate
    npm run db:migrate -- --name init
    npm run dev:api      # terminal 1
    npm run dev:worker   # terminal 2
    Invoke-RestMethod -Uri http://localhost:3000/health  # PowerShell
    curl.exe -i http://localhost:3000/health             # Windows curl
    # In Bash: curl -i http://localhost:3000/health

To run a worker for only one queue, use `npm run dev:worker:pdf`,
`npm run dev:worker:email`, or `npm run dev:worker:video`.

`db:generate` runs Prisma Client generation from the database workspace.
`db:migrate` runs Prisma's development migration command from the database workspace.
`db:smoke` runs the database smoke test from the database workspace.
`db:studio` opens Prisma Studio from the database workspace.

## Test worker crash recovery (Windows PowerShell)

Start the API and infrastructure as described above. In a separate PowerShell
terminal, allow extra processing time so there is time to stop the worker after
it claims the test job:

    $env:PLACEHOLDER_PROCESSING_MS = "120000"
    npm run dev:worker:pdf

In another terminal, submit a job and save its ID:

    $body = '{"type":"pdf-export","payload":{"userId":"1","documentId":"crash-recovery-test"}}'
    $created = Invoke-RestMethod -Method Post -Uri "http://localhost:3000/jobs" -ContentType "application/json" -Body $body
    $jobId = $created.jobId
    $jobId

Wait until the worker logs `job processing` for this ID. In Task Manager, end
the worker's process tree (not the API process) to simulate a hard crash. Do not
use Ctrl+C, which shuts the worker down gracefully. Verify the job remains
`PROCESSING` while no worker is running:

    Invoke-RestMethod -Uri "http://localhost:3000/jobs/$jobId"

Restart the worker. Reset the processing delay first so the recovered attempt
finishes quickly:

    $env:PLACEHOLDER_PROCESSING_MS = "3000"
    npm run dev:worker

BullMQ detects the expired lock and redelivers the job. With the current
30-second lock and stalled check intervals, allow up to about 60 seconds for
recovery. The job should reach `COMPLETED` with `attemptCount` 2:

    Invoke-RestMethod -Uri "http://localhost:3000/jobs/$jobId"

Inspect the state-transition history in Postgres:

    docker compose exec postgres psql -U postgres -d task_scheduler -c "SELECT `"fromState`", `"toState`", attempt, `"workerId`", `"createdAt`" FROM job_events WHERE `"jobId`"='$jobId' ORDER BY id;"

The expected transitions are `QUEUED` → `PROCESSING` → `FAILED` → `PROCESSING`
→ `COMPLETED`. The `FAILED` event records that the previous attempt was
interrupted.

Full documentation will be added in the final phase.
