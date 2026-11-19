-- usage: docker compose exec -T postgres psql -U postgres -d task_scheduler -v job=<jobId> < docker/backoff-report.sql
SELECT attempt - 1 AS after_failed_attempt,
       round(extract(epoch FROM ("createdAt" - prev_at))::numeric, 3) AS waited_seconds
FROM (
  SELECT *,
         lag("toState") OVER w AS prev_state,
         lag("createdAt") OVER w AS prev_at
  FROM job_events
  WHERE "jobId" = :'job'
  WINDOW w AS (ORDER BY id)
) t
WHERE prev_state = 'FAILED' AND "toState" = 'PROCESSING'
ORDER BY attempt;