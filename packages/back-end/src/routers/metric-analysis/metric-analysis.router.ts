import express from "express";
import { wrapController } from "../wrapController";
import { validateRequestMiddleware } from "../utils/validateRequestMiddleware";
import { createMetricAnalysisPropsValidator } from "./metric-analysis.validators";
import * as rawMetricAnalysisController from "./metric-analysis.controller";
import { z } from "zod";

const router = express.Router();

const metricAnalysisController = wrapController(rawMetricAnalysisController);

router.post(
  "/metric-analysis",
  validateRequestMiddleware({
    body: createMetricAnalysisPropsValidator,
  }),
  metricAnalysisController.postMetricAnalysis
);

router.post(
  "/metric-analysis/:id/cancel",
  validateRequestMiddleware({
    params: z.object({ id: z.string() }).strict(),
  }),
  metricAnalysisController.cancelMetricAnalysis
)


router.get(
  "/metric-analysis/metric/:metricid/",
  validateRequestMiddleware({
    params: z.object({ metricid: z.string() }).strict(),
  }),
  metricAnalysisController.getLatestMetricAnalysis
)

export { router as metricAnalysisRouter };
