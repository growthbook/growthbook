import express from "express";
import { z } from "zod";
import { wrapController } from "back-end/src/routers/wrapController";
import { validateRequestMiddleware } from "back-end/src/routers/utils/validateRequestMiddleware";
import * as rawDemoDatasourceProjectController from "./demo-datasource-project.controller.js";

const router = express.Router();

const demoDatasourceProjectController = wrapController(
  rawDemoDatasourceProjectController,
);

router.post(
  "/",
  validateRequestMiddleware({
    body: z.object({}).strict(),
  }),
  demoDatasourceProjectController.postDemoDatasourceProject,
);

export { router as demoDatasourceProjectRouter };
