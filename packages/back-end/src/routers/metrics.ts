import express from "express";
import * as metricsController from "../controllers/metrics";
import { wrapController } from "../services/routers";

wrapController(metricsController);

const router = express.Router();

router.get("/metrics", metricsController.getMetrics);
router.post("/metrics", metricsController.postMetrics);
router.get("/metric/:id", metricsController.getMetric);
router.put("/metric/:id", metricsController.putMetric);
router.delete("/metric/:id", metricsController.deleteMetric);
router.get("/metric/:id/usage", metricsController.getMetricUsage);
router.post("/metric/:id/analysis", metricsController.postMetricAnalysis);
router.get(
  "/metric/:id/analysis/status",
  metricsController.getMetricAnalysisStatus
);
router.post(
  "/metric/:id/analysis/cancel",
  metricsController.cancelMetricAnalysis
);

export { router as metricsRouter };
