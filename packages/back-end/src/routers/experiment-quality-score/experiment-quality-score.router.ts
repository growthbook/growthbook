import express from "express";
import { z } from "zod";
import { experimentQualityConfigValidator } from "shared/validators";
import { wrapController } from "back-end/src/routers/wrapController";
import { validateRequestMiddleware } from "back-end/src/routers/utils/validateRequestMiddleware";
import * as rawController from "./experiment-quality-score.controller";

const configWriteBodyValidator = experimentQualityConfigValidator.omit({
  id: true,
  organization: true,
  dateCreated: true,
  dateUpdated: true,
});

const router = express.Router();

const controller = wrapController(rawController);

router.post(
  "/recalculate",
  validateRequestMiddleware({}),
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
        reason: z.string().max(1000).optional(),
      })
      .strict(),
  }),
  controller.postExperimentQualityScoreOverride,
);

router.post(
  "/configs",
  validateRequestMiddleware({ body: configWriteBodyValidator }),
  controller.postExperimentQualityConfig,
);

router.put(
  "/configs/:id",
  validateRequestMiddleware({
    params: z.object({ id: z.string() }).strict(),
    body: configWriteBodyValidator.partial(),
  }),
  controller.putExperimentQualityConfig,
);

router.delete(
  "/configs/:id",
  validateRequestMiddleware({
    params: z.object({ id: z.string() }).strict(),
  }),
  controller.deleteExperimentQualityConfig,
);

export { router as experimentQualityScoreRouter };
