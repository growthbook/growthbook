import express from "express";
import { z } from "zod";
import { wrapController } from "back-end/src/routers/wrapController";
import { validateRequestMiddleware } from "back-end/src/routers/utils/validateRequestMiddleware";
import * as rawLearningsController from "./learnings.controller";

const router = express.Router();

const LearningsController = wrapController(rawLearningsController);

const idParams = z.object({ id: z.string() }).strict();

router.get(
  "/",
  validateRequestMiddleware({
    query: z.object({ project: z.string().optional() }).strict(),
  }),
  LearningsController.getLearnings,
);

router.get(
  "/:id",
  validateRequestMiddleware({ params: idParams }),
  LearningsController.getLearning,
);

router.post(
  "/",
  validateRequestMiddleware({
    body: z
      .object({
        title: z.string(),
        text: z.string(),
        tags: z.array(z.string()).optional(),
        supportingExperimentIds: z.array(z.string()),
        contradictingExperimentIds: z.array(z.string()).optional(),
        projects: z.array(z.string()).optional(),
        status: z.string().optional(),
        source: z.enum(["ai", "manual"]).optional(),
      })
      .strict(),
  }),
  LearningsController.postLearning,
);

router.put(
  "/:id",
  validateRequestMiddleware({
    params: idParams,
    body: z
      .object({
        title: z.string().optional(),
        text: z.string().optional(),
        tags: z.array(z.string()).optional(),
        supportingExperimentIds: z.array(z.string()).optional(),
        contradictingExperimentIds: z.array(z.string()).optional(),
        projects: z.array(z.string()).optional(),
        status: z.string().optional(),
      })
      .strict(),
  }),
  LearningsController.putLearning,
);

router.delete(
  "/:id",
  validateRequestMiddleware({ params: idParams }),
  LearningsController.deleteLearning,
);

router.post(
  "/find",
  validateRequestMiddleware({
    body: z
      .object({
        experimentIds: z.array(z.string()).min(2),
      })
      .strict(),
  }),
  LearningsController.postFindLearnings,
);

router.post(
  "/refresh",
  validateRequestMiddleware({
    body: z
      .object({
        learningId: z.string(),
      })
      .strict(),
  }),
  LearningsController.postRefreshLearnings,
);

router.post(
  "/:id/apply-refresh",
  validateRequestMiddleware({
    params: idParams,
    body: z
      .object({
        text: z.string().optional(),
        addSupportingExperimentIds: z.array(z.string()).optional(),
        addContradictingExperimentIds: z.array(z.string()).optional(),
      })
      .strict(),
  }),
  LearningsController.postApplyLearningRefresh,
);

export { router as learningsRouter };
