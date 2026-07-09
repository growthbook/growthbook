import type { Response } from "express";
import { type AIChatMessage } from "shared/ai-chat";
import {
  ExplorationConfig,
  ProductAnalyticsExploration,
  ExplorationCacheQuery,
  ProductAnalyticsRunRequestBody,
  ProductAnalyticsRunComparisonPayload,
  type AIChatFeedbackEntry,
  type AIChatFeedbackRating,
} from "shared/validators";
import { computeExplorationComparisonPayload } from "shared/enterprise";
import { QueryInterface } from "shared/types/query";
import type { FactMetricInterface } from "shared/types/fact-table";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import { getContextFromReq } from "back-end/src/services/organizations";
import { NotFoundError } from "back-end/src/util/errors";
import { logger } from "back-end/src/util/logger";
import { runProductAnalyticsExploration } from "back-end/src/enterprise/services/product-analytics";
import { getQueryById } from "back-end/src/models/QueryModel";
import {
  getConversationStatus,
  listConversations,
  type ConversationSummary,
} from "back-end/src/enterprise/services/conversation-buffer";
import { cancelAgentStream } from "back-end/src/enterprise/services/agent-handler";

export { postChat } from "back-end/src/enterprise/services/product-analytics-agent";

export const cancelChat = async (
  req: AuthRequest<never, { conversationId: string }, never>,
  res: Response<{ status: 200; cancelled: boolean }>,
) => {
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
) => {
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

export const postProductAnalyticsRun = async (
  req: AuthRequest<
    ProductAnalyticsRunRequestBody,
    unknown,
    ExplorationCacheQuery
  >,
  res: Response<{
    status: 200;
    exploration: ProductAnalyticsExploration | null;
    query: QueryInterface | null;
    comparison?: ProductAnalyticsRunComparisonPayload & {
      query: QueryInterface | null;
    };
  }>,
) => {
  const context = getContextFromReq(req);
  const cacheOpts = { cache: req.query.cache };
  const { config, previousTimeFrame } = req.body;

  async function resolveQuery(
    exploration: ProductAnalyticsExploration | null,
  ): Promise<QueryInterface | null> {
    const queryId = exploration?.queries?.[0]?.query;
    return queryId ? await getQueryById(context, queryId) : null;
  }

  if (!previousTimeFrame) {
    const exploration = await runProductAnalyticsExploration(
      context,
      config,
      cacheOpts,
    );
    const query = await resolveQuery(exploration);
    return res.status(200).json({
      status: 200,
      exploration,
      query,
    });
  }

  const comparisonConfig: ExplorationConfig = {
    ...config,
    dateRange: previousTimeFrame,
  };

  // allSettled (not all): a comparison failure (timeout, upstream schema
  // change, transient warehouse issue) must not fail the whole request and
  // cost the user their primary result. Return the primary unconditionally and
  // only attach the comparison when its leg succeeded.
  const [primaryResult, comparisonResult] = await Promise.allSettled([
    runProductAnalyticsExploration(context, config, cacheOpts),
    runProductAnalyticsExploration(context, comparisonConfig, cacheOpts),
  ]);
  if (primaryResult.status === "rejected") {
    throw primaryResult.reason;
  }
  const exploration = primaryResult.value;
  if (comparisonResult.status === "rejected") {
    logger.warn(
      { err: comparisonResult.reason },
      "Failed to run product analytics comparison query; returning primary only",
    );
  }
  const comparisonExploration =
    comparisonResult.status === "fulfilled" ? comparisonResult.value : null;

  const query = await resolveQuery(exploration);
  const comparisonQuery = await resolveQuery(comparisonExploration);

  const metricIds =
    config.dataset.type === "metric"
      ? config.dataset.values
          .map((v) => v.metricId)
          .filter((id): id is string => Boolean(id))
      : [];
  const metrics = metricIds.length
    ? await context.models.factMetrics.getByIds(metricIds)
    : [];
  const metricsById = new Map(metrics.map((m) => [m.id, m]));
  const getFactMetricById = (id: string): FactMetricInterface | null =>
    metricsById.get(id) ?? null;

  const comparisonPayload = computeExplorationComparisonPayload(
    exploration,
    comparisonExploration,
    config,
    previousTimeFrame,
    getFactMetricById,
  );

  return res.status(200).json({
    status: 200,
    exploration,
    query,
    comparison: {
      exploration: comparisonPayload.exploration,
      query: comparisonQuery,
      previousPeriod: comparisonPayload.previousPeriod,
      bigNumberTrends: comparisonPayload.bigNumberTrends,
      tableTrendsByRow: comparisonPayload.tableTrendsByRow,
    },
  });
};

export const getChat = async (
  req: AuthRequest<never, { conversationId: string }, never>,
  res: Response<{
    status: 200;
    isStreaming: boolean;
    lastStreamedAt: number;
    messages: AIChatMessage[];
    feedback: AIChatFeedbackEntry[];
  }>,
) => {
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
    });
  }

  return res.status(200).json({
    status: 200,
    isStreaming: statusData.isStreaming,
    lastStreamedAt: statusData.lastStreamedAt,
    messages: statusData.messages,
    feedback: statusData.feedback,
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
  const conversations = await listConversations(
    context.models.aiConversations,
    "product-analytics",
  );
  return res.status(200).json({ status: 200, conversations });
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
) => {
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

export const getExplorationById = async (
  req: AuthRequest<never, { id: string }, never>,
  res: Response<{
    status: 200;
    exploration: ProductAnalyticsExploration;
    query: QueryInterface | null;
  }>,
) => {
  const context = getContextFromReq(req);
  const { id } = req.params;

  const exploration = await context.models.analyticsExplorations.getById(id);
  if (!exploration) {
    throw new NotFoundError("Exploration not found");
  }

  const queryId = exploration?.queries?.[0]?.query;
  const query = queryId ? await getQueryById(context, queryId) : null;

  return res.status(200).json({
    status: 200,
    exploration,
    query,
  });
};
