import express from "express";
import { z } from "zod";
import { wrapController } from "back-end/src/routers/wrapController";
import { validateRequestMiddleware } from "back-end/src/routers/utils/validateRequestMiddleware";
import * as rawController from "./experiment-quality-score.controller";

const router = express.Router();

const controller = wrapController(rawController);

router.post(
  "/recalculate",
  validateRequestMiddleware({
    body: z
      .object({
        // Only this Project's experiments, or with "", only those following
        // the organization default
        project: z.string().optional(),
      })
      .strict(),
  }),
  controller.postRecalculateExperimentQualityScores,
);

router.get(
  "/status",
  validateRequestMiddleware({}),
  controller.getExperimentQualityScoreStatus,
);

router.post(
  "/experiment/:id/override",
  validateRequestMiddleware({
    params: z.object({ id: z.string() }).strict(),
    body: z
      .object({
        score: z.number().min(0).max(100).nullable(),
        reason: z.string().trim().max(1000).optional(),
      })
      .strict(),
  }),
  controller.postExperimentQualityScoreOverride,
);

router.post(
  "/experiment/:id/recheck",
  validateRequestMiddleware({
    params: z.object({ id: z.string() }).strict(),
  }),
  controller.postRecheckExperimentQualityScore,
);

export { router as experimentQualityScoreRouter };
