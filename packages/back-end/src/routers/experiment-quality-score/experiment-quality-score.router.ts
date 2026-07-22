import express from "express";
import { z } from "zod";
import { wrapController } from "back-end/src/routers/wrapController";
import { validateRequestMiddleware } from "back-end/src/routers/utils/validateRequestMiddleware";
import * as rawController from "./experiment-quality-score.controller";

const router = express.Router();

const controller = wrapController(rawController);

router.post(
  "/experiment/:id/refresh",
  validateRequestMiddleware({
    params: z.object({ id: z.string() }).strict(),
  }),
  controller.postRefreshExperimentQualityScore,
);

router.post(
  "/recalculate",
  validateRequestMiddleware({}),
  controller.postRecalculateExperimentQualityScores,
);

export { router as experimentQualityScoreRouter };
