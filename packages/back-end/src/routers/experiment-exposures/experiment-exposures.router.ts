import express from "express";
import { z } from "zod";
import { wrapController } from "back-end/src/routers/wrapController";
import { validateRequestMiddleware } from "back-end/src/routers/utils/validateRequestMiddleware";
import * as rawController from "./experiment-exposures.controller";

const router = express.Router();
const controller = wrapController(rawController);
const filterString = z.string().max(255);

// Mounted bare, so the full path lives here. /experiment is not owned by this
// router — app.ts still registers the other /experiment/:id routes directly.
router.get(
  "/experiment/:id/exposures",
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
  controller.getExposures,
);

export { router as experimentExposuresRouter };
