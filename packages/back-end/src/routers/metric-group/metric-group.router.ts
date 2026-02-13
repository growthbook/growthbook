import express from "express";
import { z } from "zod";
import { wrapController } from "back-end/src/routers/wrapController";
import { validateRequestMiddleware } from "back-end/src/routers/utils/validateRequestMiddleware";
import {
  createMetricGroupPropsValidator,
  updateMetricGroupPropsValidator,
  updateOrderValidator,
} from "./metric-group.validators.js";
import * as rawMetricGroupController from "./metric-group.controller.js";

const router = express.Router();

const metricGroupController = wrapController(rawMetricGroupController);

router.get(
  "/metric-groups",
  validateRequestMiddleware({
    params: z.object({ orgId: z.string() }).strict(),
  }),
  metricGroupController.getMetricGroups,
);

router.post(
  "/metric-group",
  validateRequestMiddleware({
    body: createMetricGroupPropsValidator,
  }),
  metricGroupController.postMetricGroup,
);

router.put(
  "/metric-group/:id",
  validateRequestMiddleware({
    params: z.object({ id: z.string() }),
    body: updateMetricGroupPropsValidator,
  }),
  metricGroupController.putMetricGroup,
);

router.delete(
  "/metric-group/:id",
  validateRequestMiddleware({
    params: z.object({ id: z.string() }),
  }),
  metricGroupController.deleteMetricGroup,
);

router.put(
  "/metric-group/:id/reorder",
  validateRequestMiddleware({
    params: z.object({ id: z.string() }),
    body: updateOrderValidator,
  }),
  metricGroupController.putMetricGroupReorder,
);

router.delete(
  "/metric-group/:id/remove/:metricId",
  validateRequestMiddleware({
    params: z.object({ id: z.string(), metricId: z.string() }).strict(),
  }),
  metricGroupController.removeMetricFromGroup,
);

export { router as metricGroupRouter };
