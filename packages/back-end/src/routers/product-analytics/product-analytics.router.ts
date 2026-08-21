import express from "express";
import { z } from "zod";
import {
  productAnalyticsRunRequestBodyValidator,
  aiChatFeedbackRatingValidator,
  aiChatMentionValidator,
  aiChatSkillsValidator,
} from "shared/validators";
import { aiModelValidator } from "back-end/src/routers/ai/ai.validators";
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
    body: productAnalyticsRunRequestBodyValidator,
    query: z
      .object({ cache: z.enum(["preferred", "required", "never"]) })
      .optional(),
  }),
  productAnalyticsController.postProductAnalyticsRun,
);

router.post(
  "/chat",
  validateRequestMiddleware({
    body: z
      .object({
        message: z.string().min(1),
        conversationId: z.string().min(1),
        datasourceId: z.string(),
        model: aiModelValidator,
        mentions: aiChatMentionValidator.array().optional(),
        // Skills picked from the composer's `/` menu. Scoped server-side to the
        // dashboard domain (see PRODUCT_ANALYTICS_CHAT_SKILL_DOMAIN); anything
        // else resolves to nothing.
        skills: aiChatSkillsValidator.optional(),
        // Deterministic mutation-confirmation gate: when the user responds to
        // a parked mutation, the UI sends the action id and their decision so
        // the harness can replay or discard the exact stored call. Reachable
        // here because the dashboard skills write via `callApi`.
        confirmActionId: z.string().min(1).optional(),
        confirmDecision: z.enum(["confirm", "cancel"]).optional(),
      })
      .strict(),
  }),
  productAnalyticsController.postChat,
);

router.get("/chat", productAnalyticsController.listChats);

router.get(
  "/chat/:conversationId",
  validateRequestMiddleware({
    params: z.object({ conversationId: z.string().min(1) }).strict(),
  }),
  productAnalyticsController.getChat,
);

router.post(
  "/chat/:conversationId/cancel",
  validateRequestMiddleware({
    params: z.object({ conversationId: z.string().min(1) }).strict(),
  }),
  productAnalyticsController.cancelChat,
);

router.post(
  "/chat/:conversationId/feedback",
  validateRequestMiddleware({
    params: z.object({ conversationId: z.string().min(1) }).strict(),
    body: z
      .object({
        messageId: z.string().min(1),
        rating: aiChatFeedbackRatingValidator.nullable(),
        comment: z.string().optional(),
      })
      .strict(),
  }),
  productAnalyticsController.postChatFeedback,
);

router.delete(
  "/chat/:conversationId",
  validateRequestMiddleware({
    params: z.object({ conversationId: z.string().min(1) }).strict(),
  }),
  productAnalyticsController.deleteChat,
);

export { router as productAnalyticsRouter };
