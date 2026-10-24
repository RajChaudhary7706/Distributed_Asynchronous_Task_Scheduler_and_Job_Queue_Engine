-- AlterTable
ALTER TABLE "jobs" ADD COLUMN     "enqueuedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "jobs_state_enqueuedAt_idx" ON "jobs"("state", "enqueuedAt");
