-- AlterTable
ALTER TABLE "jobs" ADD COLUMN     "dlqPublishedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "jobs_state_dlqPublishedAt_idx" ON "jobs"("state", "dlqPublishedAt");
