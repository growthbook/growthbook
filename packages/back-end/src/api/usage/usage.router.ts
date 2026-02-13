import { Router } from "express";
import { getMetricUsage } from "./getMetricUsage.js";

const router = Router();

// Metric Usage Endpoints
// Mounted at /api/v1/usage
router.get("/metrics", getMetricUsage);

export default router;
