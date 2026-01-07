import express from "express";
import { z } from "zod";
import {
  createDashboardBlockInterface,
  dashboardBlockInterface,
  displaySettings,
  legacyDashboardBlockInterface,
  dashboardEditLevel,
  dashboardShareLevel,
  dashboardUpdateSchedule,
} from "shared/enterprise";
import { wrapController } from "back-end/src/routers/wrapController";
import { validateRequestMiddleware } from "back-end/src/routers/utils/validateRequestMiddleware";
import * as rawDashboardsController from "./dashboards.controller";

const router = express.Router();
const dashboardsController = wrapController(rawDashboardsController);

const dashboardParams = z.object({ id: z.string() }).strict();
export const createDashboardBody = z
  .object({
    experimentId: z.string().optional(),
    title: z.string(),
    editLevel: dashboardEditLevel,
    shareLevel: dashboardShareLevel,
    enableAutoUpdates: z.boolean(),
    updateSchedule: dashboardUpdateSchedule.optional(),
    blocks: z.array(createDashboardBlockInterface),
    projects: z.array(z.string()).optional(),
    userId: z.string().optional(),
    seriesDisplaySettings: z
      .record(z.string(), z.record(z.string(), displaySettings))
      .optional(),
  })
  .strict();

export const updateDashboardBody = z
  .object({
    title: z.string().optional(),
    editLevel: dashboardEditLevel.optional(),
    userId: z.string().optional(),
    shareLevel: dashboardShareLevel.optional(),
    enableAutoUpdates: z.boolean().optional(),
    updateSchedule: dashboardUpdateSchedule.optional(),
    projects: z.array(z.string()).optional(),
    seriesDisplaySettings: z
      .record(z.string(), z.record(z.string(), displaySettings))
      .optional(),
    blocks: z
      .array(
        z.union([
          createDashboardBlockInterface,
          dashboardBlockInterface,
          legacyDashboardBlockInterface,
        ]),
      )
      .optional(),
  })
  .strict();

router.get(
  "/",
  validateRequestMiddleware({
    query: z
      .object({ includeExperimentDashboards: z.string().optional() })
      .strict(),
  }),
  dashboardsController.getAllDashboards,
);

router.get(
  "/by-experiment/:experimentId",
  validateRequestMiddleware({
    params: z.object({ experimentId: z.string() }).strict(),
  }),
  dashboardsController.getDashboardsForExperiment,
);

router.post(
  "/",
  validateRequestMiddleware({ body: createDashboardBody }),
  dashboardsController.createDashboard,
);

router.get(
  "/:id",
  validateRequestMiddleware({ params: dashboardParams }),
  dashboardsController.getDashboard,
);
router.put(
  "/:id",
  validateRequestMiddleware({
    body: updateDashboardBody,
    params: dashboardParams,
  }),
  dashboardsController.updateDashboard,
);

router.delete(
  "/:id",
  validateRequestMiddleware({ params: dashboardParams }),
  dashboardsController.deleteDashboard,
);

router.post(
  "/:id/refresh",
  validateRequestMiddleware({ params: dashboardParams }),
  dashboardsController.refreshDashboardData,
);

router.get(
  "/:id/snapshots",
  validateRequestMiddleware({ params: dashboardParams }),
  dashboardsController.getDashboardSnapshots,
);

export { router as dashboardsRouter };
