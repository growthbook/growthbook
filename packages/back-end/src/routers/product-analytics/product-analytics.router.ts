import express from "express";
import { z } from "zod";
import {
  explorationConfigValidator,
  userJourneyConfigValidator,
} from "shared/validators";
import { wrapController } from "back-end/src/routers/wrapController";
import { validateRequestMiddleware } from "back-end/src/routers/utils/validateRequestMiddleware";
import * as rawProductAnalyticsController from "./product-analytics.controller";

const router = express.Router();

const productAnalyticsController = wrapController(
  rawProductAnalyticsController,
);

router.get(
  "/exploration/:id",
  validateRequestMiddleware({ params: z.object({ id: z.string() }).strict() }),
  productAnalyticsController.getExplorationById,
);

router.post(
  "/run",
  validateRequestMiddleware({
    body: z.object({ config: explorationConfigValidator }).strict(),
    query: z
      .object({ cache: z.enum(["preferred", "required", "never"]) })
      .optional(),
  }),
  productAnalyticsController.postProductAnalyticsRun,
);

router.get(
  "/user-journey/:id",
  validateRequestMiddleware({ params: z.object({ id: z.string() }).strict() }),
  productAnalyticsController.getUserJourneyById,
);

router.post(
  "/user-journey/run",
  validateRequestMiddleware({
    body: z.object({ config: userJourneyConfigValidator }).strict(),
    query: z
      .object({ cache: z.enum(["preferred", "required", "never"]) })
      .optional(),
  }),
  productAnalyticsController.postUserJourneyRun,
);

router.post(
  "/user-journey/:id/extend",
  validateRequestMiddleware({
    body: z
      .object({
        config: userJourneyConfigValidator,
        pathToExtend: z.array(z.string()),
        stepToExtend: z.number().int().min(0).max(4),
      })
      .strict(),
    query: z
      .object({ cache: z.enum(["preferred", "required", "never"]) })
      .optional(),
  }),
  productAnalyticsController.extendUserJourney,
);

export { router as productAnalyticsRouter };
