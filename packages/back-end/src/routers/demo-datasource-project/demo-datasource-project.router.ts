import express from "express";
import z from "zod";
import { wrapController } from "../wrapController";
import { validateRequestMiddleware } from "../utils/validateRequestMiddleware";
import * as rawDemoDatasourceProjectController from "./demo-datasource-project.controller";

const router = express.Router();

const demoDatasourceProjectController = wrapController(
  rawDemoDatasourceProjectController
);

router.post(
  "/",
  validateRequestMiddleware({
    body: z.object({}).strict(),
  }),
  demoDatasourceProjectController.postDemoDatasourceProject
);

export { router as demoDatasourceProjectRouter };
