import { Router } from "express";
import { postMetricUsage } from "./postMetricUsage";

const router = Router();

// Metric Usage Endpoints
// Mounted at /api/v1/metric-usage
router.post("/", postMetricUsage);

export default router;
