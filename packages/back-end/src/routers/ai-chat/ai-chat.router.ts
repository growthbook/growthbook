import express from "express";
import { z } from "zod";
import { wrapController } from "back-end/src/routers/wrapController";
import { validateRequestMiddleware } from "back-end/src/routers/utils/validateRequestMiddleware";
import * as rawAIChatController from "./ai-chat.controller";
import {
  createConversationValidator,
  sendMessageValidator,
  confirmActionValidator,
} from "./ai-chat.validators";

const router = express.Router();

const AIChatController = wrapController(rawAIChatController);

// List conversations
router.get(
  "/conversations",
  validateRequestMiddleware({}),
  AIChatController.getConversations,
);

// Create conversation
router.post(
  "/conversations",
  validateRequestMiddleware({
    body: createConversationValidator,
  }),
  AIChatController.postConversation,
);

// Get conversation with messages
router.get(
  "/conversations/:id",
  validateRequestMiddleware({
    params: z.object({ id: z.string() }),
  }),
  AIChatController.getConversation,
);

// Delete conversation
router.delete(
  "/conversations/:id",
  validateRequestMiddleware({
    params: z.object({ id: z.string() }),
  }),
  AIChatController.deleteConversationHandler,
);

// Send message (SSE stream)
router.post(
  "/conversations/:id/messages",
  validateRequestMiddleware({
    params: z.object({ id: z.string() }),
    body: sendMessageValidator,
  }),
  AIChatController.postMessage,
);

// Confirm/reject action
router.post(
  "/conversations/:id/confirm",
  validateRequestMiddleware({
    params: z.object({ id: z.string() }),
    body: confirmActionValidator,
  }),
  AIChatController.postConfirmAction,
);

export { router as aiChatRouter };
