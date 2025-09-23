import express from "express";
import z from "zod";
import { wrapController } from "back-end/src/routers/wrapController";
import { validateRequestMiddleware } from "back-end/src/routers/utils/validateRequestMiddleware";
import { metricExplorerConfigValidator } from "./metric-explorer.validators";
import * as rawMetricExplorerController from "./metric-explorer.controller";

const router = express.Router();

const metricExplorerController = wrapController(rawMetricExplorerController);

router.post(
  "/metric-explorer/get-cached-result",
  validateRequestMiddleware({
    body: z.object({ config: metricExplorerConfigValidator }),
  }),
  metricExplorerController.postGetCachedResult,
);

router.post(
  "/metric-explorer/run-query",
  validateRequestMiddleware({
    body: z.object({ config: metricExplorerConfigValidator }),
  }),
  metricExplorerController.postRunQuery,
);

export { router as metricExplorerRouter };
