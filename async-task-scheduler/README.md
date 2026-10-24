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

Full documentation will be added in the final phase.
