import express from "express";
import { z } from "zod";
import { createPopulationDataPropsValidator } from "shared/validators";
import { wrapController } from "back-end/src/routers/wrapController";
import { validateRequestMiddleware } from "back-end/src/routers/utils/validateRequestMiddleware";
import * as rawPopulationDataController from "./population-data.controller";

const router = express.Router();

const populationDataController = wrapController(rawPopulationDataController);

router.post(
  "/population-data",
  validateRequestMiddleware({
    body: createPopulationDataPropsValidator,
  }),
  populationDataController.postPopulationData,
);

router.post(
  "/population-data/:id/cancel",
  validateRequestMiddleware({
    params: z.object({ id: z.string() }).strict(),
  }),
  populationDataController.cancelPopulationData,
);

router.get(
  "/population-data/:id",
  validateRequestMiddleware({
    params: z.object({ id: z.string() }).strict(),
  }),
  populationDataController.getPopulationData,
);

export { router as populationDataRouter };
