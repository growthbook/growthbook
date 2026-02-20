import express from "express";
import { z } from "zod";
import { wrapController } from "back-end/src/routers/wrapController";
import { validateRequestMiddleware } from "back-end/src/routers/utils/validateRequestMiddleware";
import * as rawProductAnalyticsController from "./product-analytics.controller";

const router = express.Router();

const productAnalyticsController = wrapController(
  rawProductAnalyticsController,
);

const explorerAnalysisIdParams = z
  .object({ explorerAnalysisId: z.string() })
  .strict();

router.get(
  "/explorer-analysis/:explorerAnalysisId",
  validateRequestMiddleware({ params: explorerAnalysisIdParams }),
  productAnalyticsController.getExplorerAnalysis,
);

router.post("/run", productAnalyticsController.postProductAnalyticsRun);

export { router as productAnalyticsRouter };
