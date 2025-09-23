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

export { router as metricExplorerRouter };
