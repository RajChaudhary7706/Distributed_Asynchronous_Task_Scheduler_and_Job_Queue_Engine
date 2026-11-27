import type { Request, Response } from "express";
import { listDlqQuerySchema } from "../schemas/job-schemas";
import type { JobService } from "../services/job-service";

export function createDlqController(service: JobService) {
    return {
        async list(req: Request, res: Response): Promise<void> {
            const query = listDlqQuerySchema.parse(req.query);
            res.json(await service.listDeadLetters(query));
        },
    };
}