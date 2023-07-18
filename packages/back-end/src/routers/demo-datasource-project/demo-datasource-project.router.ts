import express from "express";
import z from "zod";
import * as rawDemoDatasourceProjectController from "./demo-datasource-project.controller";
import { wrapController } from "../wrapController";
import { validateRequestMiddleware } from "../utils/validateRequestMiddleware";

const router = express.Router();

const demoDatasourceProjectController = wrapController(rawDemoDatasourceProjectController);

router.post(
  "/", 
  validateRequestMiddleware({
    body: z
      .object({
        // TODO:
      })
      .strict(),
  }),
  demoDatasourceProjectController.postDemoDatasourceProject
);

export { router as demoDatasourceProjectRouter };
