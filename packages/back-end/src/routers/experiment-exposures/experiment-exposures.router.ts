import express from "express";
import { z } from "zod";
import { stringRowFilterValidator } from "shared/validators";
import { wrapController } from "back-end/src/routers/wrapController";
import { validateRequestMiddleware } from "back-end/src/routers/utils/validateRequestMiddleware";
import * as rawController from "./experiment-exposures.controller";

const router = express.Router();
const controller = wrapController(rawController);
router.post(
  "/experiment/:id/exposures",
  validateRequestMiddleware({
    params: z.object({ id: z.string() }),
    body: z
      .object({
        startDate: z.string().datetime(),
        endDate: z.string().datetime(),
        rowFilters: z.array(stringRowFilterValidator).optional(),
      })
      .strict(),
  }),
  controller.postExposures,
);

export { router as experimentExposuresRouter };
