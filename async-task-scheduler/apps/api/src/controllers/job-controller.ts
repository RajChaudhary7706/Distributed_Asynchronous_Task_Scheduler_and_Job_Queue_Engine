import type { Request, Response } from "express";
import type { Job } from "@ats/database";
import type { JobService } from "../services/job-service";
import { createJobSchema, idParamSchema, listJobsQuerySchema } from "../schemas/job-schemas";

/** The public shape of a job. We choose fields explicitly instead of leaking the DB row. */
function toJobResponse(job: Job) {
  return {
    id: job.id,
    type: job.type,
    state: job.state,
    attemptCount: job.attemptCount,
    maxAttempts: job.maxAttempts,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    failedAt: job.failedAt,
    error: job.error,
  };
}

export function createJobController(service: JobService) {
  return {
    // Controllers translate HTTP <-> service calls. No business logic here.
    // Validation errors thrown by zod are turned into 400s by the error middleware.
    async create(req: Request, res: Response): Promise<void> {
      const body = createJobSchema.parse(req.body);
      const job = await service.submit(body);
      // 202 Accepted: "received and recorded; processing happens later".
      res.status(202).location(`/jobs/${job.id}`).json({ jobId: job.id, state: job.state });
    },

    async get(req: Request, res: Response): Promise<void> {
      const { id } = idParamSchema.parse(req.params);
      res.json(toJobResponse(await service.get(id)));
    },

    async list(req: Request, res: Response): Promise<void> {
      const query = listJobsQuerySchema.parse(req.query);
      const page = await service.list(query);
      res.json({ items: page.items.map(toJobResponse), nextCursor: page.nextCursor });
    },

    async retry(req: Request, res: Response): Promise<void> {
      const { id } = idParamSchema.parse(req.params);
      const job = await service.retry(id);
      res.status(202).json({ jobId: job.id, state: job.state });
    },
  };
}