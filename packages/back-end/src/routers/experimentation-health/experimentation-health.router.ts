import express from "express";
import { z } from "zod";
import {
  experimentationHealthGradeWeightsValidator,
  experimentationHealthQualitySettingsValidator,
  experimentationHealthTargetsValidator,
} from "shared/validators";
import { wrapController } from "back-end/src/routers/wrapController";
import { validateRequestMiddleware } from "back-end/src/routers/utils/validateRequestMiddleware";
import * as rawController from "./experimentation-health.controller";

const router = express.Router();

const controller = wrapController(rawController);

router.put(
  "/settings",
  validateRequestMiddleware({
    body: z
      .object({
        project: z.string(),
        quality: experimentationHealthQualitySettingsValidator,
        targets: experimentationHealthTargetsValidator.optional(),
        gradeWeights: experimentationHealthGradeWeightsValidator.optional(),
      })
      .strict(),
  }),
  controller.putExperimentationHealthSettings,
);

router.delete(
  "/settings",
  validateRequestMiddleware({
    // Only Project records can be reset; the organization default can't
    query: z.object({ project: z.string().min(1) }).strict(),
  }),
  controller.deleteExperimentationHealthSettings,
);

router.get(
  "/summary",
  validateRequestMiddleware({
    query: z.object({ project: z.string().optional() }).strict(),
  }),
  controller.getExperimentationHealthSummaryHandler,
);

export { router as experimentationHealthRouter };
