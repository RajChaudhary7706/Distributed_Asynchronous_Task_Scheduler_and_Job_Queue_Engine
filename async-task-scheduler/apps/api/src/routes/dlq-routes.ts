import { Router } from "express";
import type { createDlqController } from "../controllers/dlq-controller";

export function createDlqRoutes(controller: ReturnType<typeof createDlqController>): Router {
    const router = Router();
    router.get("/", controller.list);
    // POST /dlq/:jobId/retry arrives in Phase 10.
    return router;
}