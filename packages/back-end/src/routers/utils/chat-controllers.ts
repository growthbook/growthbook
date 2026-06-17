import type { Response } from "express";
import { type AIChatMessage } from "shared/ai-chat";
import {
  type AIChatFeedbackEntry,
  type AIChatFeedbackRating,
  type AIAgentPendingAction,
} from "shared/validators";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import { getContextFromReq } from "back-end/src/services/organizations";
import { NotFoundError } from "back-end/src/util/errors";
import {
  getConversationStatus,
  listConversations,
  type ConversationSummary,
} from "back-end/src/enterprise/services/conversation-buffer";
import { cancelAgentStream } from "back-end/src/enterprise/services/agent-handler";

/**
 * Shared chat controller handlers used by all chat-style agent routers
 * (PA agent, generic agent, future skill-based agents). The "list chats"
 * endpoint scopes by agentType — everything else operates on a specific
 * conversationId and is agent-agnostic.
 */

// ---------------------------------------------------------------------------
// Agent-agnostic handlers (look up by conversationId, type doesn't matter)
// ---------------------------------------------------------------------------

export const cancelChat = async (
  req: AuthRequest<never, { conversationId: string }, never>,
  res: Response<{ status: 200; cancelled: boolean }>,
): Promise<Response> => {
  const context = getContextFromReq(req);
  const { conversationId } = req.params;

  const doc = await context.models.aiConversations.getById(conversationId);
  if (!doc) {
    throw new NotFoundError("Conversation not found");
  }

  const cancelled = cancelAgentStream(conversationId);

  await context.models.aiConversations.updateById(conversationId, {
    isStreaming: false,
  });

  return res.status(200).json({ status: 200, cancelled });
};

export const deleteChat = async (
  req: AuthRequest<never, { conversationId: string }, never>,
  res: Response<{ status: 200 } | { status: 404; message: string }>,
): Promise<Response> => {
  const context = getContextFromReq(req);
  const { conversationId } = req.params;

  const doc = await context.models.aiConversations.getById(conversationId);
  if (!doc) {
    return res
      .status(404)
      .json({ status: 404, message: "Conversation not found" });
  }

  await context.models.aiConversations.deleteById(conversationId);
  return res.status(200).json({ status: 200 });
};

export const getChat = async (
  req: AuthRequest<never, { conversationId: string }, never>,
  res: Response<{
    status: 200;
    isStreaming: boolean;
    lastStreamedAt: number;
    messages: AIChatMessage[];
    feedback: AIChatFeedbackEntry[];
    pendingAction: AIAgentPendingAction | null;
  }>,
): Promise<Response> => {
  const context = getContextFromReq(req);
  const { conversationId } = req.params;
  const statusData = await getConversationStatus(
    context.models.aiConversations,
    conversationId,
  );

  if (!statusData) {
    return res.status(200).json({
      status: 200,
      isStreaming: false,
      lastStreamedAt: 0,
      messages: [],
      feedback: [],
      pendingAction: null,
    });
  }

  return res.status(200).json({
    status: 200,
    isStreaming: statusData.isStreaming,
    lastStreamedAt: statusData.lastStreamedAt,
    messages: statusData.messages,
    feedback: statusData.feedback,
    pendingAction: statusData.pendingAction,
  });
};

export const postChatFeedback = async (
  req: AuthRequest<
    {
      messageId: string;
      rating: AIChatFeedbackRating | null;
      comment?: string;
    },
    { conversationId: string }
  >,
  res: Response<{ status: 200; feedback: AIChatFeedbackEntry[] }>,
): Promise<Response> => {
  const context = getContextFromReq(req);
  const { conversationId } = req.params;
  const { messageId, rating, comment } = req.body;

  const doc = await context.models.aiConversations.getById(conversationId);
  if (!doc) {
    throw new NotFoundError("Conversation not found");
  }

  const now = new Date();
  const existingFeedback = (doc.feedback ?? []) as AIChatFeedbackEntry[];
  const existingIdx = existingFeedback.findIndex(
    (f) => f.messageId === messageId,
  );

  let updatedFeedback: AIChatFeedbackEntry[];

  if (rating === null) {
    updatedFeedback = existingFeedback.filter((f) => f.messageId !== messageId);
  } else if (existingIdx >= 0) {
    updatedFeedback = existingFeedback.map((f, i) =>
      i === existingIdx
        ? { ...f, rating, comment: comment ?? "", updatedAt: now }
        : f,
    );
  } else {
    updatedFeedback = [
      ...existingFeedback,
      {
        messageId,
        rating,
        comment: comment ?? "",
        userId: context.userId,
        createdAt: now,
        updatedAt: now,
      },
    ];
  }

  await context.models.aiConversations.updateById(conversationId, {
    feedback: updatedFeedback,
  });

  return res.status(200).json({ status: 200, feedback: updatedFeedback });
};

// ---------------------------------------------------------------------------
// Per-agent factory for listChats (filters conversations by agentType)
// ---------------------------------------------------------------------------

export function makeListChats(
  agentType: string,
): (
  req: AuthRequest,
  res: Response<{ status: 200; conversations: ConversationSummary[] }>,
) => Promise<Response> {
  return async (req, res) => {
    const context = getContextFromReq(req);
    const conversations = await listConversations(
      context.models.aiConversations,
      agentType,
    );
    return res.status(200).json({ status: 200, conversations });
  };
}
