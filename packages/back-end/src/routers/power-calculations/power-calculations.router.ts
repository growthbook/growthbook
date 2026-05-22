import express from "express";
import { z } from "zod";
import {
  createPowerCalculationBodySchema,
  updatePowerCalculationBodySchema,
} from "shared/validators";
import { wrapController } from "back-end/src/routers/wrapController";
import { validateRequestMiddleware } from "back-end/src/routers/utils/validateRequestMiddleware";
import * as rawPowerCalculationsController from "./power-calculations.controller";

const router = express.Router();

const PowerCalculationsController = wrapController(
  rawPowerCalculationsController,
);

router.get(
  "/:id",
  validateRequestMiddleware({
    params: z.object({ id: z.string() }).strict(),
  }),
  PowerCalculationsController.getPowerCalculation,
);

router.post(
  "/",
  validateRequestMiddleware({
    body: createPowerCalculationBodySchema,
  }),
  PowerCalculationsController.postPowerCalculation,
);

router.put(
  "/:id",
  validateRequestMiddleware({
    params: z.object({ id: z.string() }).strict(),
    body: updatePowerCalculationBodySchema,
  }),
  PowerCalculationsController.putPowerCalculation,
);

router.delete(
  "/:id",
  validateRequestMiddleware({
    params: z.object({ id: z.string() }).strict(),
  }),
  PowerCalculationsController.deletePowerCalculation,
);

export { router as powerCalculationsRouter };
