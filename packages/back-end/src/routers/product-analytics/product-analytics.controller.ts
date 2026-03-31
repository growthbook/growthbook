import type { Response } from "express";
import { type AIChatMessage } from "shared/ai-chat";
import {
  ExplorationConfig,
  ProductAnalyticsExploration,
} from "shared/validators";
import { QueryInterface } from "shared/types/query";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import { getContextFromReq } from "back-end/src/services/organizations";
import { NotFoundError } from "back-end/src/util/errors";
import { runProductAnalyticsExploration } from "back-end/src/enterprise/services/product-analytics";
import { getQueryById } from "back-end/src/models/QueryModel";
import {
  getConversationStatus,
  listConversations,
  type ConversationSummary,
} from "back-end/src/enterprise/services/conversation-store";

export { postChat } from "back-end/src/enterprise/services/product-analytics-agent";

export const postProductAnalyticsRun = async (
  req: AuthRequest<
    { config: ExplorationConfig },
    unknown,
    { cache?: "preferred" | "required" | "never" }
  >,
  res: Response<{
    status: 200;
    exploration: ProductAnalyticsExploration | null;
    query: QueryInterface | null;
  }>,
) => {
  const context = getContextFromReq(req);

  const exploration = await runProductAnalyticsExploration(
    context,
    req.body.config,
    { cache: req.query.cache },
  );

  const queryId = exploration?.queries?.[0]?.query;
  const query = queryId ? await getQueryById(context, queryId) : null;

  return res.status(200).json({
    status: 200,
    exploration,
    query,
  });
};

export const getChat = async (
  req: AuthRequest<never, { conversationId: string }, never>,
  res: Response<{
    status: 200;
    isStreaming: boolean;
    lastStreamedAt: number;
    messages: AIChatMessage[];
  }>,
) => {
  const { conversationId } = req.params;
  const statusData = getConversationStatus(conversationId);

  if (!statusData) {
    return res.status(200).json({
      status: 200,
      isStreaming: false,
      lastStreamedAt: 0,
      messages: [],
    });
  }

  return res.status(200).json({
    status: 200,
    isStreaming: statusData.isStreaming,
    lastStreamedAt: statusData.lastStreamedAt,
    messages: statusData.messages,
  });
};

export const listChats = async (
  req: AuthRequest,
  res: Response<{
    status: 200;
    conversations: ConversationSummary[];
  }>,
) => {
  const context = getContextFromReq(req);
  const conversations = listConversations(context.userId, context.org.id);
  return res.status(200).json({ status: 200, conversations });
};

export const getExplorationById = async (
  req: AuthRequest<never, { id: string }, never>,
  res: Response<{
    status: 200;
    exploration: ProductAnalyticsExploration;
  }>,
) => {
  const context = getContextFromReq(req);
  const { id } = req.params;

  const exploration = await context.models.analyticsExplorations.getById(id);
  if (!exploration) {
    throw new NotFoundError("Exploration not found");
  }

  return res.status(200).json({
    status: 200,
    exploration,
  });
};
