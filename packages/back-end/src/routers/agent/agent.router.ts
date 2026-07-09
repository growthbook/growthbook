import express from "express";
import { z } from "zod";
import { aiChatFeedbackRatingValidator } from "shared/validators";
import { aiModelValidator } from "back-end/src/routers/ai/ai.validators";
import { wrapController } from "back-end/src/routers/wrapController";
import { validateRequestMiddleware } from "back-end/src/routers/utils/validateRequestMiddleware";
import * as rawAgentController from "./agent.controller";

const router = express.Router();

const agentController = wrapController(rawAgentController);

router.post(
  "/chat",
  validateRequestMiddleware({
    body: z
      .object({
        message: z.string().min(1),
        conversationId: z.string().min(1),
        model: aiModelValidator.optional(),
        // URL the user was on when sending — captured client-side from
        // `router.asPath`. Persisted on the user message and surfaced to
        // the LLM as a `[Page context: …]` prefix; not displayed in the
        // chat UI. Skills document the URL → entity mapping.
        currentPage: z.string().max(2048).optional(),
        // Optional preselected product analytics datasource. The eval runner
        // uses this to keep generic-agent PA cases deterministic.
        datasourceId: z.string().min(1).optional(),
        // Deterministic mutation-confirmation gate: when the user responds to
        // a parked mutation, the UI sends the action id and their decision so
        // the harness can replay or discard the exact stored call.
        confirmActionId: z.string().min(1).optional(),
        confirmDecision: z.enum(["confirm", "cancel"]).optional(),
      })
      .strict(),
  }),
  agentController.postChat,
);

router.get("/chat", agentController.listChats);

router.get(
  "/chat/:conversationId",
  validateRequestMiddleware({
    params: z.object({ conversationId: z.string().min(1) }).strict(),
  }),
  agentController.getChat,
);

router.post(
  "/chat/:conversationId/cancel",
  validateRequestMiddleware({
    params: z.object({ conversationId: z.string().min(1) }).strict(),
  }),
  agentController.cancelChat,
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
  agentController.postChatFeedback,
);

router.delete(
  "/chat/:conversationId",
  validateRequestMiddleware({
    params: z.object({ conversationId: z.string().min(1) }).strict(),
  }),
  agentController.deleteChat,
);

export { router as agentRouter };
