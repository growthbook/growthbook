import { Router } from "express";
import { getMetric } from "./getMetric.js";
import { listMetrics } from "./listMetrics.js";
import { postMetric } from "./postMetric.js";
import { putMetric } from "./putMetric.js";
import { deleteMetricHandler as deleteMetric } from "./deleteMetric.js";

const router = Router();

// Metric Endpoints
// Mounted at /api/v1/metrics
router.get("/", listMetrics);
router.post("/", postMetric);

router.get("/:id", getMetric);
router.put("/:id", putMetric);
router.delete("/:id", deleteMetric);

export default router;
