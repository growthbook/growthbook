import express from "express";
import { z } from "zod";
import { wrapController } from "back-end/src/routers/wrapController";
import { validateRequestMiddleware } from "back-end/src/routers/utils/validateRequestMiddleware";
import { dashboardSettingsStringDates } from "back-end/src/enterprise/validators/dashboard-instance";
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
    description: z.string(),
    blocks: z.array(createDashboardBlockInterface),
    settings: dashboardSettingsStringDates,
  })
  .strict();

export const updateDashboardBody = z
  .object({
    title: z.string().optional(),
    description: z.string().optional(),
    blocks: z
      .array(z.union([createDashboardBlockInterface, dashboardBlockInterface]))
      .optional(),
    settings: dashboardSettingsStringDates.optional(),
  })
  .strict();

router.get(
  "/:id/snapshots",
  validateRequestMiddleware({ params: dashboardParams }),
  dashboardsController.getSnapshotsForDashboard
);

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

export { router as dashboardsRouter };
