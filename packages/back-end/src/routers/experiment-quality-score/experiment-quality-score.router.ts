import express from "express";
import { z } from "zod";
import { experimentQualityConfigBodyValidator } from "shared/validators";
import { wrapController } from "back-end/src/routers/wrapController";
import { validateRequestMiddleware } from "back-end/src/routers/utils/validateRequestMiddleware";
import * as rawController from "./experiment-quality-score.controller";

const configWriteBodyValidator = z
  .object({
    name: z.string().min(1).max(100),
    description: z.string().max(500).optional(),
    ...experimentQualityConfigBodyValidator.shape,
  })
  .strict();

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

router.get(
  "/configs",
  validateRequestMiddleware({}),
  controller.getExperimentQualityConfigs,
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
