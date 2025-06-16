import { Router } from "express";
import { getMetric } from "./getMetric";
import { listMetrics } from "./listMetrics";
import { postMetric } from "./postMetric";
import { putMetric } from "./putMetric";
import { deleteMetricHandler as deleteMetric } from "./deleteMetric";
import { deleteMetricsHandler as deleteMetrics } from "./deleteMetrics";

const router = Router();

// Metric Endpoints
// Mounted at /api/v1/metrics
router.get("/", listMetrics);
router.post("/", postMetric);
router.delete("/", deleteMetrics);

router.get("/:id", getMetric);
router.put("/:id", putMetric);
router.delete("/:id", deleteMetric);

export default router;
