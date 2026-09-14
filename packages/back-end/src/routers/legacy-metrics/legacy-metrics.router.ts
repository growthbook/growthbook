import express from "express";
import { wrapController } from "back-end/src/routers/wrapController";
import { validateRequestMiddleware } from "back-end/src/routers/utils/validateRequestMiddleware";
import * as rawController from "./legacy-metrics.controller";
import { migrateLegacyMetricsValidator } from "./legacy-metrics.validators";

const router = express.Router();

const controller = wrapController(rawController);

router.post(
  "/legacy-metrics/migrate",
  validateRequestMiddleware({ body: migrateLegacyMetricsValidator }),
  controller.postMigrateLegacyMetrics,
);

export { router as legacyMetricsRouter };
