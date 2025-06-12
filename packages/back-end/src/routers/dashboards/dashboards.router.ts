import express from "express";
import { z } from "zod";
import { wrapController } from "back-end/src/routers/wrapController";
import { validateRequestMiddleware } from "back-end/src/routers/utils/validateRequestMiddleware";
import * as rawDashboardsController from "./dashboards.controller";

const router = express.Router();
const dashboardsController = wrapController(rawDashboardsController);

const dashboardParams = z.object({ id: z.string() }).strict();

router.get(
  "/:id/snapshots",
  validateRequestMiddleware({ params: dashboardParams }),
  dashboardsController.getSnapshotsForDashboard
);

export { router as dashboardsRouter };
