import express from "express";
import { z } from "zod";
import { stringRowFilterValidator } from "shared/validators";
import { MULTIPLE_EXPOSURES_ROW_FILTER_ID } from "shared/constants";
import { wrapController } from "back-end/src/routers/wrapController";
import { validateRequestMiddleware } from "back-end/src/routers/utils/validateRequestMiddleware";
import * as rawController from "./experiment-exposures.controller";

const multipleExposuresFilter = z.object({
  operator: z.literal("saved_filter"),
  values: z.tuple([z.literal(MULTIPLE_EXPOSURES_ROW_FILTER_ID)]),
});

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
        rollingWindow: z.boolean().optional(),
        rowFilters: z
          .array(z.union([stringRowFilterValidator, multipleExposuresFilter]))
          .optional(),
        phase: z.number().int().min(0).optional(),
        cache: z.enum(["preferred", "required", "never"]).optional(),
      })
      .strict(),
  }),
  controller.postExposures,
);

export { router as experimentExposuresRouter };
