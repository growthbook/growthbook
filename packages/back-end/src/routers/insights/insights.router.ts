import express from "express";
import { z } from "zod";
import { wrapController } from "back-end/src/routers/wrapController";
import { validateRequestMiddleware } from "back-end/src/routers/utils/validateRequestMiddleware";
import * as rawInsightsController from "./insights.controller";

const router = express.Router();

const InsightsController = wrapController(rawInsightsController);

const idParams = z.object({ id: z.string() }).strict();

router.get(
  "/",
  validateRequestMiddleware({
    query: z.object({ project: z.string().optional() }).strict(),
  }),
  InsightsController.getInsights,
);

router.get(
  "/:id",
  validateRequestMiddleware({ params: idParams }),
  InsightsController.getInsight,
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
        contraryEvidence: z.array(z.string()).optional(),
        projects: z.array(z.string()).optional(),
        status: z.string().optional(),
        source: z.enum(["ai", "manual"]).optional(),
      })
      .strict(),
  }),
  InsightsController.postInsight,
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
        contraryEvidence: z.array(z.string()).optional(),
        projects: z.array(z.string()).optional(),
        status: z.string().optional(),
      })
      .strict(),
  }),
  InsightsController.putInsight,
);

router.delete(
  "/:id",
  validateRequestMiddleware({ params: idParams }),
  InsightsController.deleteInsight,
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
  InsightsController.postFindInsights,
);

export { router as insightsRouter };
