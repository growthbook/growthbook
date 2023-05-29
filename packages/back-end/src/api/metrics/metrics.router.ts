import { Router } from "express";
import { getMetric } from "./getMetric";
import { listMetrics } from "./listMetrics";
import { postMetric } from "./postMetric";
import { deleteMetric } from "./deleteMetric";

const router = Router();

// Metric Endpoints
// Mounted at /api/v1/metrics
router.get("/", listMetrics);
router.get("/:id", getMetric);
router.delete("/:id", deleteMetric);
router.post("/", postMetric);

export default router;
