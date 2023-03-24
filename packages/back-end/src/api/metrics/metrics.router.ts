import { Router } from "express";
import { getMetric } from "./getMetric";
import { listMetrics } from "./listMetrics";

const router = Router();

// Metric Endpoints
// Mounted at /api/v1/metrics
router.get("/", listMetrics);
router.get("/:id", getMetric);

export default router;
