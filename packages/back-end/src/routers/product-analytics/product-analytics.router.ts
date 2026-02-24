import express from "express";
import { z } from "zod";
import { productAnalyticsConfigValidator } from "shared/validators";
import { wrapController } from "back-end/src/routers/wrapController";
import { validateRequestMiddleware } from "back-end/src/routers/utils/validateRequestMiddleware";
import * as rawProductAnalyticsController from "./product-analytics.controller";

const router = express.Router();

const productAnalyticsController = wrapController(
  rawProductAnalyticsController,
);

router.get(
  "/exploration/:id",
  validateRequestMiddleware({ params: z.object({ id: z.string() }).strict() }),
  productAnalyticsController.getExplorationById,
);

router.post(
  "/run",
  validateRequestMiddleware({
    body: z.object({ config: productAnalyticsConfigValidator }).strict(),
    query: z.object({ skipCache: z.string().optional() }).strict(),
  }),
  productAnalyticsController.postProductAnalyticsRun,
);

export { router as productAnalyticsRouter };
