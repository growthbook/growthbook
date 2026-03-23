import type { Response } from "express";
import { z } from "zod";
import type { ModelMessage, ToolResultPart } from "ai";
import {
  ExplorationConfig,
  ProductAnalyticsExploration,
  explorationConfigValidator,
  ProductAnalyticsResultRow,
} from "shared/validators";
import { QueryInterface } from "shared/types/query";
import { FactMetricInterface } from "shared/types/fact-table";
import { logger } from "back-end/src/util/logger";
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
  streamingChatCompletion,
  secondsUntilAICanBeUsedAgain,
  aiTool,
} from "back-end/src/enterprise/services/ai";
import {
  addSnapshot,
  getSnapshot,
  getSessionSnapshots,
} from "back-end/src/enterprise/services/snapshot-store";
import {
  getConversation,
  appendMessages,
} from "back-end/src/enterprise/services/conversation-store";

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

type FlushableResponse = Response & {
  flush?: () => void;
};

const METRICS_PREVIEW_COUNT = 5;

function buildConfigSchemaSummary(): string {
  return [
    "Exploration config schema:",
    "- Top-level fields: type, datasource, chartType, dateRange, dimensions, dataset",
    '- type: "metric" | "fact_table" | "data_source"',
    '- chartType: "line" | "area" | "timeseries-table" | "table" | "bar" | "stackedBar" | "horizontalBar" | "stackedHorizontalBar" | "bigNumber"',
    '- dateRange.predefined: "today" | "last7Days" | "last30Days" | "last90Days" | "customLookback" | "customDateRange"',
    '- IMPORTANT: "last14Days" is not valid. For 14 days use { predefined: "customLookback", lookbackValue: 14, lookbackUnit: "day" }',
    "- dimensions[] supports:",
    "  - date: { dimensionType: 'date', column: string|null, dateGranularity: 'auto'|'hour'|'day'|'week'|'month'|'year' }",
    "  - dynamic: { dimensionType: 'dynamic', column: string|null, maxValues: number }",
    "  - static: { dimensionType: 'static', column: string, values: string[] }",
    "  - slice: { dimensionType: 'slice', slices: { name: string, filters: RowFilter[] }[] }",
    '- dataset for type="metric": { type: "metric", values: [{ type: "metric", name, metricId, unit, denominatorUnit, rowFilters[] }] }',
    '- dataset for type="fact_table": { type: "fact_table", factTableId, values: [{ type: "fact_table", name, valueType, valueColumn, unit, rowFilters[] }] }',
    '- dataset for type="data_source": { type: "data_source", table, path, timestampColumn, columnTypes, values: [{ type: "data_source", name, valueType, valueColumn, unit, rowFilters[] }] }',
    "Always return a complete config object when calling runExploration.",
  ].join("\n");
}

function buildMetricsPreview(metrics: FactMetricInterface[]): string {
  if (!metrics.length) return "No metrics are configured for this datasource.";

  const preview = metrics.slice(0, METRICS_PREVIEW_COUNT);
  const lines = preview.map((m) => {
    const parts = [`- "${m.name}" (id: ${m.id}, type: ${m.metricType})`];
    if (m.description) parts.push(`  Description: ${m.description}`);
    if (m.tags.length) parts.push(`  Tags: ${m.tags.join(", ")}`);
    return parts.join("\n");
  });

  if (metrics.length > METRICS_PREVIEW_COUNT) {
    lines.push(
      `... and ${metrics.length - METRICS_PREVIEW_COUNT} more. Use the searchMetrics tool to discover additional metrics.`,
    );
  }

  return lines.join("\n");
}

function buildSnapshotSummary(
  prev: ExplorationConfig | null,
  curr: ExplorationConfig,
): string {
  const parts: string[] = [];

  if (!prev) {
    parts.push(
      `Initial: ${curr.chartType} chart, ${curr.type} dataset, date range ${curr.dateRange.predefined}`,
    );
    const valueNames = curr.dataset?.values?.map((v) => v.name).filter(Boolean);
    if (valueNames?.length) {
      parts.push(`values: ${valueNames.join(", ")}`);
    }
    return parts.join(", ");
  }

  if (prev.chartType !== curr.chartType) {
    parts.push(`chart type: ${prev.chartType} → ${curr.chartType}`);
  }
  if (prev.dateRange.predefined !== curr.dateRange.predefined) {
    parts.push(
      `date range: ${prev.dateRange.predefined} → ${curr.dateRange.predefined}`,
    );
  }

  const prevNames = prev.dataset?.values?.map((v) => v.name) ?? [];
  const currNames = curr.dataset?.values?.map((v) => v.name) ?? [];
  const added = currNames.filter((n) => !prevNames.includes(n));
  const removed = prevNames.filter((n) => !currNames.includes(n));
  if (added.length) parts.push(`added: ${added.join(", ")}`);
  if (removed.length) parts.push(`removed: ${removed.join(", ")}`);

  const prevDims = prev.dimensions?.length ?? 0;
  const currDims = curr.dimensions?.length ?? 0;
  if (prevDims !== currDims) {
    parts.push(`dimensions: ${prevDims} → ${currDims}`);
  }

  if (prev.datasource !== curr.datasource) {
    parts.push("datasource changed");
  }

  return parts.length ? parts.join(", ") : "minor config update";
}

const MAX_RESULT_ROWS = 200;

function buildResultCsv(
  rows: ProductAnalyticsResultRow[],
  config: ExplorationConfig | null,
): string | null {
  if (!rows.length || !config) return null;

  const dimHeaders: string[] = (config.dimensions ?? []).map((d) => {
    if (d.dimensionType === "date") return "Date";
    if (d.dimensionType === "dynamic") return d.column ?? "Dimension";
    if (d.dimensionType === "static") return d.column;
    if (d.dimensionType === "slice") return "Slice";
    return "Dimension";
  });
  if (!dimHeaders.length) dimHeaders.push("Total");

  const valueNames = config.dataset?.values?.map((v) => v.name) ?? [];
  const hasDenom = valueNames.map((_, i) =>
    rows.some((r) => r.values[i]?.denominator != null),
  );

  const metricHeaders: string[] = [];
  for (let i = 0; i < valueNames.length; i++) {
    if (hasDenom[i]) {
      metricHeaders.push(
        `${valueNames[i]} Numerator`,
        `${valueNames[i]} Denominator`,
        `${valueNames[i]} Value`,
      );
    } else {
      metricHeaders.push(valueNames[i]);
    }
  }

  const header = [...dimHeaders, ...metricHeaders].join(",");

  const truncated = rows.slice(0, MAX_RESULT_ROWS);
  const dataLines = truncated.map((row) => {
    const dimCells =
      dimHeaders.length === 1 && dimHeaders[0] === "Total"
        ? ["Total"]
        : row.dimensions.map((d) => d ?? "");

    const metricCells: string[] = [];
    for (let i = 0; i < valueNames.length; i++) {
      const v = row.values[i];
      if (hasDenom[i]) {
        metricCells.push(
          v?.numerator != null ? String(v.numerator) : "",
          v?.denominator != null ? String(v.denominator) : "",
          v?.numerator != null && v?.denominator != null
            ? (v.numerator / v.denominator).toFixed(4)
            : "",
        );
      } else {
        const val =
          v?.numerator != null
            ? v.denominator
              ? (v.numerator / v.denominator).toFixed(4)
              : String(v.numerator)
            : "";
        metricCells.push(val);
      }
    }

    return [...dimCells, ...metricCells]
      .map((c) => (c.includes(",") ? `"${c}"` : c))
      .join(",");
  });

  let csv = [header, ...dataLines].join("\n");
  if (rows.length > MAX_RESULT_ROWS) {
    csv += `\n... (${rows.length - MAX_RESULT_ROWS} more rows truncated)`;
  }
  return csv;
}

/**
 * Replaces the content of tool result messages from older turns with compact
 * snapshot stub references. The most recent assistant+tool pair is left
 * untouched so the LLM has full context for its last action.
 *
 * Only the copy sent to the LLM is compacted — the conversation store always
 * holds the full uncompacted messages.
 */
function compactMessages(messages: ModelMessage[]): ModelMessage[] {
  // Find the index of the last assistant message in the array
  let lastAssistantIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "assistant") {
      lastAssistantIdx = i;
      break;
    }
  }

  return messages.map((msg, idx) => {
    // Leave the most recent assistant turn and everything after it untouched
    if (idx >= lastAssistantIdx) return msg;

    if (msg.role === "tool") {
      const compactedContent = msg.content.map((part) => {
        if (part.type !== "tool-result") return part;

        // Extract snapshotId from runExploration results if available
        let snapshotHint = "";
        if (part.toolName === "runExploration") {
          try {
            const rawOutput = part.output;
            const parsed =
              rawOutput &&
              typeof rawOutput === "object" &&
              "type" in rawOutput &&
              rawOutput.type === "text" &&
              "value" in rawOutput
                ? JSON.parse(rawOutput.value as string)
                : null;
            if (parsed?.snapshotId) {
              snapshotHint = ` (snapshotId: ${parsed.snapshotId})`;
            }
          } catch {
            // ignore parse errors
          }
        }

        const stub = `[Result compacted${snapshotHint} — use getSnapshot to retrieve full data]`;
        return {
          ...part,
          output: { type: "text" as const, value: stub },
        } satisfies ToolResultPart;
      });

      return { ...msg, content: compactedContent };
    }

    return msg;
  });
}

export const postChat = async (
  req: AuthRequest<{
    message: string;
    sessionId: string;
    datasourceId: string;
  }>,
  res: Response,
) => {
  const flushableRes = res as FlushableResponse;
  const { message, sessionId, datasourceId } = req.body;
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

  const metricsPreview = buildMetricsPreview(metrics);

  // Load existing conversation history from the store
  const history = getConversation(sessionId);

  // Append the new user message
  const userMessage: ModelMessage = {
    role: "user",
    content: message,
  };
  const fullMessages: ModelMessage[] = [...history, userMessage];

  const { prompt: userAdditionalPrompt, overrideModel } =
    await context.models.aiPrompts.getAIPrompt("product-analytics-chat");

  const staticInstructions =
    "You are an expert product analytics assistant for GrowthBook.\n" +
    "You help users understand and work with their metrics and exploration configuration.\n\n" +
    (datasourceId
      ? `Datasource ID for this session: ${datasourceId}\n` +
        "Always use this datasource ID in the config.datasource field when calling runExploration.\n\n"
      : "") +
    "Available metrics (sample):\n" +
    metricsPreview +
    "\n\n" +
    buildConfigSchemaSummary() +
    "\n\n" +
    "Answer questions about metrics, the current configuration, and result data clearly and concisely.\n" +
    "When discussing data, reference specific numbers from the results.\n" +
    "When the user asks you to build or change a chart, use the runExploration tool with the full valid config.\n" +
    "The runExploration tool will execute the query and automatically display the chart to the user — you do not need to embed config in your text response.\n" +
    'Never use dateRange.predefined="last14Days". For 2 weeks use predefined="customLookback" with lookbackValue=14 and lookbackUnit="day".\n' +
    "Use the getSnapshot tool whenever you need to analyze result data — including right after calling runExploration if the user wants insights or questions answered about the data.\n" +
    "When selecting metrics, prefer using the searchMetrics tool instead of guessing metric IDs.\n" +
    "Use getCurrentConfig and getConfigSchema when you need to reason about valid config edits.\n" +
    "If asked about metrics that don't exist, let the user know.\n" +
    "Keep responses brief and actionable.";

  const system = userAdditionalPrompt
    ? staticInstructions + "\n" + userAdditionalPrompt
    : staticInstructions;

  // Maps toolCallId → snapshotId for chart results generated during this request
  const pendingChartSnapshots = new Map<string, string>();

  // const sessionSnapshots = getSessionSnapshots(sessionId);

  const baseTools = {
    searchMetrics: aiTool({
      description:
        "Search available metrics by name, description, owner, tags, or ID. " +
        "Use this to discover the right metrics before editing config.",
      inputSchema: z.object({
        query: z
          .string()
          .min(1)
          .describe("Search term, e.g. 'average order value'"),
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
            const exact =
              m.name.toLowerCase() === q || m.id.toLowerCase() === q;
            const includes = haystack.includes(q);
            const score = exact ? 3 : includes ? 1 : 0;
            return { metric: m, score };
          })
          .filter((x) => x.score > 0)
          .sort(
            (a, b) =>
              b.score - a.score || a.metric.name.localeCompare(b.metric.name),
          )
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
      description:
        "Get the current exploration config as JSON. Returns the latest executed config, or null if no exploration has been run yet.",
      inputSchema: z.object({}),
      execute: async () => {
        const snaps = getSessionSnapshots(sessionId);
        const latest = snaps.length > 0 ? snaps[snaps.length - 1] : null;
        return latest?.config
          ? JSON.stringify(latest.config, null, 2)
          : "No current exploration config is available yet.";
      },
    }),
    getConfigSchema: aiTool({
      description:
        "Get a concise schema reference for valid exploration config objects.",
      inputSchema: z.object({}),
      execute: async () => buildConfigSchemaSummary(),
    }),
    runExploration: aiTool({
      description:
        "Execute a product analytics exploration with the given config. " +
        "Use this when the user asks to build, change, or rerun a chart. " +
        "The chart will be automatically displayed to the user after execution. " +
        "The result includes a snapshotId — call getSnapshot with that ID if you need to analyze the data or provide insights.",
      inputSchema: z.object({
        config: explorationConfigValidator,
      }),
      execute: async (
        { config }: { config: ExplorationConfig },
        options: { toolCallId: string },
      ) => {
        try {
          const exploration = await runProductAnalyticsExploration(
            context,
            config,
            { cache: "preferred" },
          );

          const snaps = getSessionSnapshots(sessionId);
          const prevConfig =
            snaps.length > 0 ? snaps[snaps.length - 1].config : null;
          const summary = buildSnapshotSummary(prevConfig, config);
          const resultCsv = buildResultCsv(
            exploration?.result?.rows ?? [],
            config,
          );

          const snap = addSnapshot(sessionId, {
            summary,
            config,
            exploration: exploration ?? null,
            resultCsv,
          });

          pendingChartSnapshots.set(options.toolCallId, snap.id);

          return JSON.stringify({
            status: "success",
            snapshotId: snap.id,
            rowCount: exploration?.result?.rows?.length ?? 0,
            summary,
          });
        } catch (err) {
          return JSON.stringify({
            status: "error",
            message: err instanceof Error ? err.message : "Unknown error",
          });
        }
      },
    }),
  };

  const tools = {
    ...baseTools,
    getSnapshot: aiTool({
      description:
        "Retrieve the full configuration and result data for any snapshot, including one just created by runExploration. " +
        "Use this whenever you need to analyze result data — e.g. to provide insights, answer questions about values, compare configurations, or explain why data changed. " +
        "Pass the snapshotId returned by runExploration to access data from the most recent chart run.",
      inputSchema: z.object({
        snapshotId: z
          .string()
          .describe(
            "The snapshot ID returned by runExploration, e.g. 'snap_abc123_1'",
          ),
      }),
      execute: async ({ snapshotId }: { snapshotId: string }) => {
        const snap = getSnapshot(sessionId, snapshotId);
        if (!snap) return `Snapshot "${snapshotId}" not found.`;
        return (
          `Snapshot ${snap.id} (${snap.timestamp}):\n` +
          `Summary: ${snap.summary}\n` +
          `Config: ${JSON.stringify(snap.config, null, 2)}\n` +
          (snap.resultCsv
            ? `Result data (CSV):\n${snap.resultCsv}`
            : "No result data.")
        );
      },
    }),
  };

  // Compact older turns before sending to the LLM
  const messagesForLLM = compactMessages(fullMessages);

  const stream = await streamingChatCompletion({
    context,
    system,
    messages: messagesForLLM,
    temperature: 0.3,
    type: "product-analytics-chat",
    isDefaultPrompt: !userAdditionalPrompt,
    overrideModel,
    tools,
    maxSteps: 10,
  });

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  flushableRes.flushHeaders?.();

  const sendSSE = (event: string, data: unknown) => {
    flushableRes.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    (flushableRes as FlushableResponse).flush?.();
  };

  try {
    for await (const part of stream.fullStream) {
      // Log every raw stream part so we can see exactly what the AI SDK emits,
      // including inter-step events (finish-step, start, etc.) that are not
      // forwarded to the client. Useful for diagnosing latency between steps.
      if (part.type !== "text-delta" && part.type !== "reasoning-delta") {
        // Skip high-frequency deltas to keep logs readable; log everything else.
        logger.debug(`[AI chat stream] part.type=${part.type}`, {
          sessionId,
          part: JSON.stringify(part),
        });
      }

      switch (part.type) {
        case "text-delta":
          sendSSE("text-delta", { content: part.text });
          break;
        case "tool-input-start":
          sendSSE("tool-call-start", {
            toolName: part.toolName,
            toolCallId: part.id,
          });
          break;
        case "tool-result": {
          if (part.toolName === "runExploration") {
            const snapshotId = pendingChartSnapshots.get(part.toolCallId);
            if (snapshotId) {
              const snap = getSnapshot(sessionId, snapshotId);
              if (snap) {
                sendSSE("chart-result", {
                  toolCallId: part.toolCallId,
                  snapshotId: snap.id,
                  config: snap.config,
                  exploration: snap.exploration,
                });
              }
              pendingChartSnapshots.delete(part.toolCallId);
            }
          } else {
            sendSSE("tool-call-end", {
              toolName: part.toolName,
              toolCallId: part.toolCallId,
            });
          }
          break;
        }
        case "reasoning-delta":
          sendSSE("reasoning-delta", { text: part.text });
          break;
        case "error":
          sendSSE("error", {
            message:
              part.error instanceof Error
                ? part.error.message
                : "An error occurred",
          });
          break;
        default:
          break;
      }
    }
  } catch (err) {
    sendSSE("error", {
      message: err instanceof Error ? err.message : "An error occurred",
    });
  }

  // Save the user message and all LLM response messages (assistant + tool results)
  // to the conversation store after the stream completes.
  try {
    const response = await stream.response;
    appendMessages(sessionId, [userMessage, ...response.messages]);
  } catch {
    // Non-fatal: if we can't persist the messages, the next turn will just
    // lose this turn's history.
  }

  sendSSE("done", {});
  flushableRes.end();
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
