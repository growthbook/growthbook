import type { Response } from "express";
import { z } from "zod";
import {
  ExplorationConfig,
  ProductAnalyticsExploration,
} from "shared/validators";
import { QueryInterface } from "shared/types/query";
import { FactMetricInterface } from "shared/types/fact-table";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import {
  getContextFromReq,
  getAISettingsForOrg,
} from "back-end/src/services/organizations";
import { NotFoundError } from "back-end/src/util/errors";
import { orgHasPremiumFeature } from "back-end/src/enterprise";
import { runProductAnalyticsExploration } from "back-end/src/enterprise/services/product-analytics";
import { getQueryById } from "back-end/src/models/QueryModel";
import {
  streamingCompletion,
  secondsUntilAICanBeUsedAgain,
  aiTool,
} from "back-end/src/enterprise/services/ai";

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

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface ChatSnapshot {
  id: string;
  timestamp: string;
  summary: string;
  config: string;
  resultData: string | null;
}

type FlushableResponse = Response & {
  flush?: () => void;
};

function buildConfigSchemaSummary(): string {
  return [
    "Exploration config schema:",
    '- Top-level fields: type, datasource, chartType, dateRange, dimensions, dataset',
    '- type: "metric" | "fact_table" | "data_source"',
    '- chartType: "line" | "area" | "timeseries-table" | "table" | "bar" | "stackedBar" | "horizontalBar" | "stackedHorizontalBar" | "bigNumber"',
    '- dateRange.predefined: "today" | "last7Days" | "last30Days" | "last90Days" | "customLookback" | "customDateRange"',
    '- IMPORTANT: "last14Days" is not valid. For 14 days use { predefined: "customLookback", lookbackValue: 14, lookbackUnit: "day" }',
    '- dimensions[] supports:',
    "  - date: { dimensionType: 'date', column: string|null, dateGranularity: 'auto'|'hour'|'day'|'week'|'month'|'year' }",
    "  - dynamic: { dimensionType: 'dynamic', column: string|null, maxValues: number }",
    "  - static: { dimensionType: 'static', column: string, values: string[] }",
    "  - slice: { dimensionType: 'slice', slices: { name: string, filters: RowFilter[] }[] }",
    '- dataset for type="metric": { type: "metric", values: [{ type: "metric", name, metricId, unit, denominatorUnit, rowFilters[] }] }',
    '- dataset for type="fact_table": { type: "fact_table", factTableId, values: [{ type: "fact_table", name, valueType, valueColumn, unit, rowFilters[] }] }',
    '- dataset for type="data_source": { type: "data_source", table, path, timestampColumn, columnTypes, values: [{ type: "data_source", name, valueType, valueColumn, unit, rowFilters[] }] }',
    "Always return a complete config object when proposing updates.",
  ].join("\n");
}

function buildMetricsContext(metrics: FactMetricInterface[]): string {
  if (!metrics.length) return "No metrics are configured for this datasource.";

  return metrics
    .map((m) => {
      const parts = [
        `- "${m.name}" (id: ${m.id}, type: ${m.metricType})`,
      ];
      if (m.description) parts.push(`  Description: ${m.description}`);
      if (m.tags.length) parts.push(`  Tags: ${m.tags.join(", ")}`);
      if (m.owner) parts.push(`  Owner: ${m.owner}`);
      return parts.join("\n");
    })
    .join("\n");
}

function buildSnapshotTimeline(snapshots: ChatSnapshot[]): string {
  if (!snapshots.length) return "";
  const lines = snapshots.map(
    (s) =>
      `  [${s.id}] ${s.timestamp} - ${s.summary}${s.resultData ? " (has result data)" : ""}`,
  );
  return "\n\nSnapshot timeline (use the getSnapshot tool to retrieve full details for any snapshot):\n" + lines.join("\n");
}

export const postChat = async (
  req: AuthRequest<{
    messages: ChatMessage[];
    datasourceId: string;
    currentConfig?: ExplorationConfig;
    resultData?: string;
    snapshots?: ChatSnapshot[];
  }>,
  res: Response,
) => {
  const flushableRes = res as FlushableResponse;
  const { messages, datasourceId, currentConfig, resultData, snapshots } =
    req.body;
  const context = getContextFromReq(req);

  if (!orgHasPremiumFeature(context.org, "ai-suggestions")) {
    return res.status(403).json({
      status: 403,
      message: "Your plan does not support AI features.",
    });
  }

  const { aiEnabled } = getAISettingsForOrg(context);
  if (!aiEnabled) {
    return res.status(404).json({
      status: 404,
      message: "AI configuration not set or enabled",
    });
  }

  const secondsUntilReset = await secondsUntilAICanBeUsedAgain(context.org);
  if (secondsUntilReset > 0) {
    return res.status(429).json({
      status: 429,
      message: "Over AI usage limits",
      retryAfter: secondsUntilReset,
    });
  }

  const allMetrics = await context.models.factMetrics.getAll();
  const metrics = datasourceId
    ? allMetrics.filter((m) => m.datasource === datasourceId)
    : allMetrics;

  const metricsContext = buildMetricsContext(metrics);

  const configContext = currentConfig
    ? "\n\nCurrent exploration configuration:\n" + JSON.stringify(currentConfig, null, 2)
    : "";

  const resultContext = resultData
    ? "\n\nCurrent chart/table result data (CSV):\n" + resultData
    : "";

  const snapshotTimeline = buildSnapshotTimeline(snapshots ?? []);

  const conversationHistory = messages
    .map(
      (m: ChatMessage) =>
        `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`,
    )
    .join("\n\n");

  const instructions =
    "You are an expert product analytics assistant for GrowthBook.\n" +
    "You help users understand and work with their metrics and exploration configuration.\n" +
    "You have access to the following fact metrics:\n\n" +
    metricsContext +
    configContext +
    resultContext +
    snapshotTimeline +
    "\n\n" +
    "Answer questions about these metrics, the current configuration, and the result data clearly and concisely.\n" +
    "When discussing data, reference specific numbers from the results.\n" +
    "If the user asks you to build or change the explorer view, include a full valid config in a fenced code block exactly like:\n" +
    "```exploration-config\n{...json...}\n```\n" +
    "Only include this block when you want the app to update and rerun the explorer.\n" +
    'Never use dateRange.predefined="last14Days". For 2 weeks use predefined="customLookback" with lookbackValue=14 and lookbackUnit="day".\n' +
    "If the user asks about previous configurations or why data changed, use the getSnapshot tool to retrieve historical details.\n" +
    "When selecting metrics, prefer using the searchMetrics tool instead of guessing metric IDs.\n" +
    "Use getCurrentConfig and getConfigSchema when you need to reason about valid config edits.\n" +
    "If asked about metrics that don't exist, let the user know.\n" +
    "Keep responses brief and actionable.";

  const lastMessage = messages[messages.length - 1];
  const prompt =
    messages.length > 1
      ? `Previous conversation:\n${conversationHistory}\n\nRespond to the latest user message.`
      : lastMessage.content;

  const { prompt: userAdditionalPrompt, overrideModel } =
    await context.models.aiPrompts.getAIPrompt("product-analytics-chat");

  const fullInstructions = userAdditionalPrompt
    ? instructions + "\n" + userAdditionalPrompt
    : instructions;

  const snapshotMap = new Map<string, ChatSnapshot>(
    (snapshots ?? []).map((s: ChatSnapshot) => [s.id, s]),
  );

  const baseTools = {
    searchMetrics: aiTool({
      description:
        "Search available metrics by name, description, owner, tags, or ID. " +
        "Use this to discover the right metrics before editing config.",
      inputSchema: z.object({
        query: z.string().min(1).describe("Search term, e.g. 'average order value'"),
        limit: z.number().int().min(1).max(20).default(8),
      }),
      execute: async ({ query, limit }: { query: string; limit: number }) => {
        const q = query.trim().toLowerCase();
        const scored = metrics
          .map((m) => {
            const haystack = [
              m.id,
              m.name,
              m.description ?? "",
              m.owner ?? "",
              ...(m.tags ?? []),
            ]
              .join(" ")
              .toLowerCase();
            const exact = m.name.toLowerCase() === q || m.id.toLowerCase() === q;
            const includes = haystack.includes(q);
            const score = exact ? 3 : includes ? 1 : 0;
            return { metric: m, score };
          })
          .filter((x) => x.score > 0)
          .sort((a, b) => b.score - a.score || a.metric.name.localeCompare(b.metric.name))
          .slice(0, limit)
          .map(({ metric }) => ({
            id: metric.id,
            name: metric.name,
            type: metric.metricType,
            description: metric.description ?? null,
            owner: metric.owner ?? null,
            tags: metric.tags ?? [],
          }));

        if (!scored.length) {
          return `No metrics found for "${query}".`;
        }
        return JSON.stringify({ matches: scored }, null, 2);
      },
    }),
    getCurrentConfig: aiTool({
      description: "Get the current exploration config as JSON.",
      inputSchema: z.object({}),
      execute: async () => {
        return currentConfig
          ? JSON.stringify(currentConfig, null, 2)
          : "No current exploration config is available yet.";
      },
    }),
    getConfigSchema: aiTool({
      description:
        "Get a concise schema reference for valid exploration config objects.",
      inputSchema: z.object({}),
      execute: async () => buildConfigSchemaSummary(),
    }),
  };

  const tools = snapshots?.length
    ? {
        ...baseTools,
        getSnapshot: aiTool({
          description:
            "Retrieve the full configuration and result data for a historical snapshot. " +
            "Use this when the user asks about previous chart states, why data changed, or wants to compare configurations.",
          inputSchema: z.object({
            snapshotId: z
              .string()
              .describe("The snapshot ID from the timeline, e.g. 'snap_1'"),
          }),
          execute: async ({ snapshotId }: { snapshotId: string }) => {
            console.log("Executing getSnapshot tool with snapshotId:", snapshotId);
            const snap = snapshotMap.get(snapshotId);
            if (!snap) return `Snapshot "${snapshotId}" not found.`;
            return (
              `Snapshot ${snap.id} (${snap.timestamp}):\n` +
              `Summary: ${snap.summary}\n` +
              `Config: ${snap.config}\n` +
              (snap.resultData
                ? `Result data (CSV):\n${snap.resultData}`
                : "No result data.")
            );
          },
        }),
      }
    : baseTools;

  const stream = await streamingCompletion({
    context,
    instructions: fullInstructions,
    prompt,
    temperature: 0.3,
    type: "product-analytics-chat",
    isDefaultPrompt: !userAdditionalPrompt,
    overrideModel,
    tools,
    maxSteps: 3,
  });

  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  flushableRes.flushHeaders();

  for await (const chunk of stream.textStream) {
    flushableRes.write(chunk);
    flushableRes.flush?.();
  }

  flushableRes.end();
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
