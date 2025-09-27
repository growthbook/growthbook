import { Router } from "express";
import { getFactMetric } from "./getFactMetric";
import { listFactMetrics } from "./listFactMetrics";
import { postFactMetric } from "./postFactMetric";
import { updateFactMetric } from "./updateFactMetric";
import { deleteFactMetric } from "./deleteFactMetric";
import { postFactMetricAnalysis } from "./postFactMetricAnalysis";

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
