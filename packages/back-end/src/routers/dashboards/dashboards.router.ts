import express from "express";
import { z } from "zod";
import { wrapController } from "back-end/src/routers/wrapController";
import { validateRequestMiddleware } from "back-end/src/routers/utils/validateRequestMiddleware";
import {
  createDashboardBlockInterface,
  dashboardBlockInterface,
} from "back-end/src/enterprise/validators/dashboard-block";
import * as rawDashboardsController from "./dashboards.controller";

const router = express.Router();
const dashboardsController = wrapController(rawDashboardsController);

const dashboardParams = z.object({ id: z.string() }).strict();
export const createDashboardBody = z
  .object({
    experimentId: z.string(),
    title: z.string(),
    editLevel: z.enum(["organization", "private"]),
    enableAutoUpdates: z.boolean(),
    blocks: z.array(createDashboardBlockInterface),
  })
  .strict();

export const updateDashboardBody = z
  .object({
    title: z.string().optional(),
    editLevel: z.enum(["organization", "private"]).optional(),
    enableAutoUpdates: z.boolean().optional(),
    blocks: z
      .array(z.union([createDashboardBlockInterface, dashboardBlockInterface]))
      .optional(),
  })
  .strict();

router.post(
  "/",
  validateRequestMiddleware({ body: createDashboardBody }),
  dashboardsController.createDashboard
);
router.put(
  "/:id",
  validateRequestMiddleware({
    body: updateDashboardBody,
    params: dashboardParams,
  }),
  dashboardsController.updateDashboard
);

router.delete(
  "/:id",
  validateRequestMiddleware({ params: dashboardParams }),
  dashboardsController.deleteDashboard
);

router.post(
  "/:id/refresh",
  validateRequestMiddleware({ params: dashboardParams }),
  dashboardsController.refreshDashboardData
);

export { router as dashboardsRouter };
