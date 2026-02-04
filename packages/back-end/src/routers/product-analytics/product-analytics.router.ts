import express from "express";
import { wrapController } from "back-end/src/routers/wrapController";
import * as rawProductAnalyticsController from "./product-analytics.controller";

const router = express.Router();

const productAnalyticsController = wrapController(
  rawProductAnalyticsController,
);

router.post("/run", productAnalyticsController.postProductAnalyticsRun);

export { router as productAnalyticsRouter };
