import express from "express";
import { z } from "zod";
import { wrapController } from "back-end/src/routers/wrapController";
import { validateRequestMiddleware } from "back-end/src/routers/utils/validateRequestMiddleware";
import * as rawController from "./experiment-diagnostics.controller";

const router = express.Router();
const controller = wrapController(rawController);
const filterString = z.string().max(255);

router.get(
  "/:id/diagnostics/summary",
  validateRequestMiddleware({
    params: z.object({ id: z.string() }),
    query: z
      .object({
        startDate: z.string().datetime(),
        endDate: z.string().datetime(),
        dimension: filterString.optional(),
      })
      .strict(),
  }),
  controller.getSummary,
);

router.get(
  "/:id/diagnostics/records",
  validateRequestMiddleware({
    params: z.object({ id: z.string() }),
    query: z
      .object({
        startDate: z.string().datetime(),
        endDate: z.string().datetime(),
        userId: filterString.optional(),
        variationId: filterString.optional(),
        dimensionFilters: z.string().max(1024).optional(),
        page: z.string().regex(/^\d+$/).optional(),
      })
      .strict(),
  }),
  controller.getRecords,
);

export { router as experimentDiagnosticsRouter };
