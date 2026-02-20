import type { Response } from "express";
import {
  getAISettingsForOrg,
  getContextFromReq,
} from "back-end/src/services/organizations";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import { orgHasPremiumFeature } from "back-end/src/enterprise";
import {
  createConversation,
  getConversationsByUser,
  getConversationById,
  deleteConversation,
  getMessages,
} from "back-end/src/models/AIChatModel";
import {
  streamChatResponse,
  executeConfirmedAction,
} from "back-end/src/enterprise/services/aiChat";

function assertAIChatEnabled(req: AuthRequest) {
  const context = getContextFromReq(req);
  const { aiEnabled } = getAISettingsForOrg(context);

  if (!aiEnabled) {
    throw new Error("AI is not enabled for this organization");
  }

  if (!orgHasPremiumFeature(req.organization!, "ai-suggestions")) {
    throw new Error("Your organization's plan does not support AI features");
  }

  return context;
}

export async function getConversations(req: AuthRequest, res: Response) {
  const context = assertAIChatEnabled(req);

  const conversations = await getConversationsByUser(
    context.org.id,
    req.userId!,
  );

  return res.status(200).json({
    status: 200,
    conversations,
  });
}

export async function postConversation(
  req: AuthRequest<{ title?: string }>,
  res: Response,
) {
  const context = assertAIChatEnabled(req);

  const conversation = await createConversation(
    context.org.id,
    req.userId!,
    req.body.title || "New Chat",
  );

  return res.status(200).json({
    status: 200,
    conversation,
  });
}

export async function getConversation(
  req: AuthRequest<null, { id: string }>,
  res: Response,
) {
  const context = assertAIChatEnabled(req);

  const conversation = await getConversationById(context.org.id, req.params.id);

  if (!conversation) {
    return res.status(404).json({
      status: 404,
      message: "Conversation not found",
    });
  }

  if (conversation.userId !== req.userId) {
    return res.status(403).json({
      status: 403,
      message: "Access denied",
    });
  }

  const messages = await getMessages(conversation.id);

  return res.status(200).json({
    status: 200,
    conversation,
    messages,
  });
}

export async function deleteConversationHandler(
  req: AuthRequest<null, { id: string }>,
  res: Response,
) {
  const context = assertAIChatEnabled(req);

  const conversation = await getConversationById(context.org.id, req.params.id);

  if (!conversation) {
    return res.status(404).json({
      status: 404,
      message: "Conversation not found",
    });
  }

  if (conversation.userId !== req.userId) {
    return res.status(403).json({
      status: 403,
      message: "Access denied",
    });
  }

  await deleteConversation(context.org.id, req.params.id);

  return res.status(200).json({
    status: 200,
  });
}

export async function postMessage(
  req: AuthRequest<{ message: string; currentPage?: string }, { id: string }>,
  res: Response,
) {
  const context = assertAIChatEnabled(req);

  const conversation = await getConversationById(context.org.id, req.params.id);

  if (!conversation) {
    return res.status(404).json({
      status: 404,
      message: "Conversation not found",
    });
  }

  if (conversation.userId !== req.userId) {
    return res.status(403).json({
      status: 403,
      message: "Access denied",
    });
  }

  // Set up SSE
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  try {
    await streamChatResponse({
      context,
      conversationId: conversation.id,
      userMessage: req.body.message,
      currentPage: req.body.currentPage,
      onChunk: (chunk) => {
        res.write(
          `data: ${JSON.stringify({ type: "text-delta", content: chunk })}\n\n`,
        );
      },
      onToolCall: (toolCall) => {
        res.write(
          `data: ${JSON.stringify({ type: "tool-call", ...toolCall })}\n\n`,
        );
      },
      onFinish: (fullText) => {
        res.write(
          `data: ${JSON.stringify({ type: "done", content: fullText })}\n\n`,
        );
        res.end();
      },
    });
  } catch (error) {
    res.write(
      `data: ${JSON.stringify({
        type: "error",
        content: error instanceof Error ? error.message : "An error occurred",
      })}\n\n`,
    );
    res.end();
  }
}

export async function postConfirmAction(
  req: AuthRequest<
    {
      toolCallId: string;
      action: string;
      args: Record<string, unknown>;
      confirmed: boolean;
    },
    { id: string }
  >,
  res: Response,
) {
  const context = assertAIChatEnabled(req);

  const conversation = await getConversationById(context.org.id, req.params.id);

  if (!conversation) {
    return res.status(404).json({
      status: 404,
      message: "Conversation not found",
    });
  }

  if (conversation.userId !== req.userId) {
    return res.status(403).json({
      status: 403,
      message: "Access denied",
    });
  }

  const { action, args, confirmed } = req.body;

  if (!confirmed) {
    return res.status(200).json({
      status: 200,
      result: "Action rejected by user",
    });
  }

  const result = await executeConfirmedAction(context, action, args);

  return res.status(200).json({
    status: 200,
    result,
  });
}
