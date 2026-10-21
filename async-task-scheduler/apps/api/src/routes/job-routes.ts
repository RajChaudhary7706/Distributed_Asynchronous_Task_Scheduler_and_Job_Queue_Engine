import { Router } from "express";
import type { createJobController } from "../controllers/job-controller";

export function createJobRoutes(controller: ReturnType<typeof createJobController>): Router {
  const router = Router();
  router.post("/", controller.create);
  router.get("/", controller.list);
  router.get("/:id", controller.get);
  router.post("/:id/retry", controller.retry);
  return router;
}