import express from "express";
import { z } from "zod";
import { createMetricAnalysisPropsValidator } from "shared/validators";
import { wrapController } from "back-end/src/routers/wrapController";
import { validateRequestMiddleware } from "back-end/src/routers/utils/validateRequestMiddleware";
import * as rawMetricAnalysisController from "./metric-analysis.controller";

const router = express.Router();

const metricAnalysisController = wrapController(rawMetricAnalysisController);

router.post(
  "/metric-analysis",
  validateRequestMiddleware({
    body: createMetricAnalysisPropsValidator,
  }),
  metricAnalysisController.postMetricAnalysis,
);

router.post(
  "/metric-analysis/:id/cancel",
  validateRequestMiddleware({
    params: z.object({ id: z.string() }).strict(),
  }),
  metricAnalysisController.cancelMetricAnalysis,
);

router.post(
  "/metric-analysis/:id/refreshStatus",
  validateRequestMiddleware({
    params: z.object({ id: z.string() }).strict(),
  }),
  metricAnalysisController.refreshMetricAnalysisStatus,
);

router.get(
  "/metric-analysis/metric/:metricid/",
  validateRequestMiddleware({
    params: z.object({ metricid: z.string() }).strict(),
    query: z
      .object({
        settings: z.string().optional(),
        withHistogram: z.string().optional(),
      })
      .strict(),
  }),
  metricAnalysisController.getLatestMetricAnalysis,
);

router.get(
  "/metric-analysis/:id",
  validateRequestMiddleware({
    params: z.object({ id: z.string() }).strict(),
  }),
  metricAnalysisController.getMetricAnalysisById,
);

export { router as metricAnalysisRouter };
