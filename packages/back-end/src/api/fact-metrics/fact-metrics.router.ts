import { Router } from "express";
import { getFactMetric } from "./getFactMetric.js";
import { listFactMetrics } from "./listFactMetrics.js";
import { postFactMetric } from "./postFactMetric.js";
import { updateFactMetric } from "./updateFactMetric.js";
import { deleteFactMetric } from "./deleteFactMetric.js";
import { postFactMetricAnalysis } from "./postFactMetricAnalysis.js";

const router = Router();

// FactMetric Endpoints
// Mounted at /api/v1/fact-metrics
router.get("/", listFactMetrics);
router.post("/", postFactMetric);
router.get("/:id", getFactMetric);
router.post("/:id", updateFactMetric);
router.delete("/:id", deleteFactMetric);
router.post("/:id/analysis", postFactMetricAnalysis);

export default router;
