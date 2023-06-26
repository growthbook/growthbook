import { Router } from "express";
import { getMetric } from "./getMetric";
import { listMetrics } from "./listMetrics";
import { postMetric } from "./postMetric";
import { putMetric } from "./putMetric";

const router = Router();

// Metric Endpoints
// Mounted at /api/v1/metrics
router.get("/", listMetrics);
router.post("/", postMetric);

router.get("/:id", getMetric);
router.put("/:id", putMetric);

export default router;
