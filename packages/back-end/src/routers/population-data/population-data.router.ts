import express from "express";
import { z } from "zod";
import { wrapController } from "back-end/src/routers/wrapController";
import { validateRequestMiddleware } from "back-end/src/routers/utils/validateRequestMiddleware";
import { createPopulationDataPropsValidator } from "./population-data.validators";
import * as rawPopulationDataController from "./population-data.controller";

const router = express.Router();

const populationDataController = wrapController(rawPopulationDataController);

router.post(
  "/population-data",
  validateRequestMiddleware({
    body: createPopulationDataPropsValidator,
  }),
  populationDataController.postPopulationData
);

router.post(
  "/metric-analysis/:id/cancel",
  validateRequestMiddleware({
    params: z.object({ id: z.string() }).strict(),
  }),
  populationDataController.cancelPopulationData
);

export { router as populationDataRouter };
