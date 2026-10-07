# Async Task Scheduler

Distributed asynchronous task scheduler and job queue engine (Node.js, TypeScript, BullMQ, Redis, PostgreSQL).

## Quick start

    cp .env.example .env
    npm install
    npm run infra:up
    npm run dev:api      # terminal 1
    npm run dev:worker   # terminal 2
    curl localhost:3000/health

Full documentation will be added in the final phase.