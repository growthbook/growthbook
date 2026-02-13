import express from "express";
import { z } from "zod";
import {
  createEnvValidator,
  deleteEnvValidator,
  updateEnvOrderValidator,
  updateEnvValidator,
  updateEnvsValidator,
} from "shared/validators";
import { wrapController } from "back-end/src/routers/wrapController";
import { validateRequestMiddleware } from "back-end/src/routers/utils/validateRequestMiddleware";
import * as rawEnvironmentController from "./environment.controller.js";

const router = express.Router();

const environmentController = wrapController(rawEnvironmentController);

router.put(
  "/",
  validateRequestMiddleware({
    body: updateEnvsValidator,
  }),
  environmentController.putEnvironments,
);

router.put(
  "/order",
  validateRequestMiddleware({
    body: updateEnvOrderValidator,
  }),
  environmentController.putEnvironmentOrder,
);

router.post(
  "/",
  validateRequestMiddleware({
    body: createEnvValidator,
  }),
  environmentController.postEnvironment,
);

router.put(
  "/:id",
  validateRequestMiddleware({
    body: updateEnvValidator,
    params: z
      .object({
        id: z.string(),
      })
      .strict(),
  }),
  environmentController.putEnvironment,
);

router.delete(
  "/:id",
  validateRequestMiddleware({
    params: deleteEnvValidator,
  }),
  environmentController.deleteEnvironment,
);

export { router as environmentRouter };
