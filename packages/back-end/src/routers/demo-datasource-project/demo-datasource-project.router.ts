import express from "express";
import { z } from "zod";
import { wrapController } from "back-end/src/routers/wrapController";
import { validateRequestMiddleware } from "back-end/src/routers/utils/validateRequestMiddleware";
import * as rawDemoDatasourceProjectController from "./demo-datasource-project.controller";
import * as rawNewDemoDatasourceProjectController from "./new-demo-datasource-project.controller";

const router = express.Router();

const demoDatasourceProjectController = wrapController(
  rawDemoDatasourceProjectController,
);

const newDemoDatasourceProjectController = wrapController(
  rawNewDemoDatasourceProjectController,
);

router.post(
  "/",
  validateRequestMiddleware({
    body: z.object({}).strict(),
  }),
  demoDatasourceProjectController.postDemoDatasourceProject,
);

router.post(
  "/new",
  validateRequestMiddleware({
    body: z.object({}).strict(),
  }),
  newDemoDatasourceProjectController.postDemoDatasourceProject,
);

export { router as demoDatasourceProjectRouter };
