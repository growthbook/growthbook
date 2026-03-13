import express from "express";
import { z } from "zod";
import { explorationConfigValidator } from "shared/validators";
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

const chatMessageValidator = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string(),
});

const chatSnapshotValidator = z.object({
  id: z.string(),
  timestamp: z.string(),
  summary: z.string(),
  config: z.string(),
  resultData: z.string().nullable(),
});

router.post(
  "/chat",
  validateRequestMiddleware({
    body: z
      .object({
        messages: z.array(chatMessageValidator).min(1),
        datasourceId: z.string(),
        currentConfig: explorationConfigValidator.optional(),
        resultData: z.string().max(100000).optional(),
        snapshots: z.array(chatSnapshotValidator).max(20).optional(),
      })
      .strict(),
  }),
  productAnalyticsController.postChat,
);

export { router as productAnalyticsRouter };
