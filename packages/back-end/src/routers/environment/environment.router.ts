import express from "express";
import z from "zod";
import { wrapController } from "../wrapController";
import { validateRequestMiddleware } from "../utils/validateRequestMiddleware";
import * as rawEnvironmentController from "./environment.controller";

const router = express.Router();

const environmentController = wrapController(rawEnvironmentController);

router.post(
  "/",
  validateRequestMiddleware({
    body: z
      .object({
        environment: z.object({
          id: z.string(),
          description: z.string(),
          toggleOnList: z.boolean().optional(),
          defaultState: z.any().optional(),
        }),
      })
      .strict(),
  }),
  environmentController.postEnvironment
);

export { router as environmentRouter };
