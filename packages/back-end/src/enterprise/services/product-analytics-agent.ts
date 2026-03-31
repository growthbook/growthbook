import { z } from "zod";
import {
  tryParseToolResultJson,
  toolResultSnapshotId,
  type AIChatToolResultPart,
} from "shared/ai-chat";
import {
  ExplorationConfig,
  explorationConfigValidator,
  ProductAnalyticsResultRow,
} from "shared/validators";
import { FactMetricInterface } from "shared/types/fact-table";
import type { ReqContext } from "back-end/types/request";
import { runProductAnalyticsExploration } from "back-end/src/enterprise/services/product-analytics";
import { aiTool } from "back-end/src/enterprise/services/ai";
import {
  getConversation,
  getLatestToolResult,
} from "back-end/src/enterprise/services/conversation-store";
import {
  createAgentHandler,
  type AgentConfig,
} from "back-end/src/enterprise/services/agent-handler";

// =============================================================================
// Constants & system prompt
// =============================================================================

const METRICS_PREVIEW_COUNT = 5;
const MAX_RESULT_ROWS = 200;

const PA_SYSTEM_INSTRUCTIONS =
  "Answer questions about metrics, the current configuration, and result data clearly and concisely.\n" +
  "When discussing data, reference specific numbers from the results.\n" +
  "When the user asks you to build or change a chart, use the runExploration tool with the full valid config.\n" +
  "Chart mode vs time dimension: line, area, and timeseries-table charts are always timeseries — include a date dimension. " +
  "Bar charts (bar, stackedBar, horizontalBar, stackedHorizontalBar), the plain table chart, and bigNumber are cumulative — do not use a date dimension. " +
  "When switching between timeseries and cumulative chart types, add or remove the date dimension accordingly.\n" +
  "When the user does not specify a chart style, default to chartType line for timeseries and chartType bar for cumulative.\n" +
  "The runExploration tool will execute the query and automatically display the chart to the user — you do not need to embed config in your text response.\n" +
  "runExploration returns the full exploration payload (including structured result data) plus resultCsv: use that return value for analysis, insights, and answering questions about the run you just executed.\n" +
  'Never use dateRange.predefined="last14Days". For 2 weeks use predefined="customLookback" with lookbackValue=14 and lookbackUnit="day".\n' +
  "Use getSnapshot only when you need rows or CSV for a snapshot whose tool result is no longer fully available in the conversation — e.g. older runs after prior tool outputs were compacted, or when the user references a specific snapshotId from history.\n" +
  "When selecting metrics, prefer using the searchMetrics tool instead of guessing metric IDs.\n" +
  "Use getCurrentConfig and getConfigSchema when you need to reason about valid config edits.\n" +
  "If asked about metrics that don't exist, let the user know.\n" +
  "Keep responses brief and actionable.";

async function buildProductAnalyticsSystemPrompt(
  ctx: ReqContext,
  datasourceId: string,
): Promise<string> {
  const allMetrics = await ctx.models.factMetrics.getAll();
  const metrics = datasourceId
    ? allMetrics.filter((m) => m.datasource === datasourceId)
    : allMetrics;
  const metricsPreview = buildMetricsPreview(metrics);

  return (
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
    PA_SYSTEM_INSTRUCTIONS
  );
}

// =============================================================================
// Helpers & tool implementations
// =============================================================================

export function findSnapshot(
  conversationId: string,
  snapshotId: string,
): AIChatToolResultPart | undefined {
  const messages = getConversation(conversationId);
  for (const m of messages) {
    if (m.role !== "tool") continue;
    for (const part of m.content) {
      if (toolResultSnapshotId(part.result) === snapshotId) {
        return part;
      }
    }
  }
  return undefined;
}

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

function nextSnapshotId(conversationId: string): string {
  const msgs = getConversation(conversationId);
  let count = 0;
  for (const m of msgs) {
    if (m.role !== "tool") continue;
    for (const part of m.content) {
      if (part.toolName === "runExploration") count++;
    }
  }
  return `snap_${conversationId.slice(0, 8)}_${count + 1}`;
}

function explorationConfigFromLatestRun(
  part: AIChatToolResultPart | undefined,
): ExplorationConfig | null {
  if (!part || part.toolName !== "runExploration") {
    return null;
  }
  const r = tryParseToolResultJson(part.result);
  if (!r || typeof r !== "object" || Array.isArray(r)) {
    return null;
  }
  const data = r as Record<string, unknown>;
  const ex = data.exploration;
  if (ex && typeof ex === "object" && ex !== null && "config" in ex) {
    const c = (ex as { config: unknown }).config;
    if (c && typeof c === "object") return c as ExplorationConfig;
  }
  const legacy = data.config;
  if (legacy && typeof legacy === "object") return legacy as ExplorationConfig;
  return null;
}

async function executeSearchMetrics(
  getMetrics: () => Promise<FactMetricInterface[]>,
  input: { query: string; limit: number },
): Promise<string> {
  const { query, limit } = input;
  const metrics = await getMetrics();
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
    .sort(
      (a, b) => b.score - a.score || a.metric.name.localeCompare(b.metric.name),
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
}

async function executeGetCurrentConfig(
  conversationId: string,
): Promise<string> {
  const latest = getLatestToolResult(conversationId, "runExploration");
  const cfg = explorationConfigFromLatestRun(latest);
  return cfg
    ? JSON.stringify(cfg, null, 2)
    : "No current exploration config is available yet.";
}

async function executeGetConfigSchema(): Promise<string> {
  return buildConfigSchemaSummary();
}

type RunExplorationToolResult =
  | {
      summary: string;
      status: "success";
      snapshotId: string;
      rowCount: number;
      exploration: Awaited<
        ReturnType<typeof runProductAnalyticsExploration>
      > | null;
      resultCsv: string | null;
    }
  | { status: "error"; message: string };

async function executeRunExploration(
  ctx: ReqContext,
  conversationId: string,
  config: ExplorationConfig,
): Promise<RunExplorationToolResult> {
  try {
    const exploration = await runProductAnalyticsExploration(ctx, config, {
      cache: "preferred",
    });

    const prevConfig = explorationConfigFromLatestRun(
      getLatestToolResult(conversationId, "runExploration"),
    );
    const summary = buildSnapshotSummary(prevConfig, config);
    const resultCsv = buildResultCsv(exploration?.result?.rows ?? [], config);

    const snapshotId = nextSnapshotId(conversationId);

    return {
      summary,
      status: "success",
      snapshotId,
      rowCount: exploration?.result?.rows?.length ?? 0,
      exploration: exploration ?? null,
      resultCsv,
    };
  } catch (err) {
    return {
      status: "error",
      message: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

function snapshotSummaryLineFromResult(r: unknown): string {
  if (typeof r === "object" && r !== null && "summary" in r) {
    const s = (r as { summary: unknown }).summary;
    if (typeof s === "string") return s;
  }
  try {
    return JSON.stringify(r);
  } catch {
    return String(r);
  }
}

async function executeGetSnapshot(
  conversationId: string,
  snapshotId: string,
): Promise<string> {
  const part = findSnapshot(conversationId, snapshotId);
  if (!part) {
    return `Snapshot "${snapshotId}" not found.`;
  }

  const r = tryParseToolResultJson(part.result);
  const rec =
    r && typeof r === "object" && !Array.isArray(r)
      ? (r as Record<string, unknown>)
      : {};
  const cfg = explorationConfigFromLatestRun(part) ?? undefined;
  const csv = typeof rec.resultCsv === "string" ? rec.resultCsv : null;
  const summaryLine = snapshotSummaryLineFromResult(r);

  return (
    `Snapshot ${snapshotId}:\n` +
    `Summary: ${summaryLine}\n` +
    `Config: ${JSON.stringify(cfg ?? {}, null, 2)}\n` +
    (csv ? `Result data (CSV):\n${csv}` : "No result data.")
  );
}

// =============================================================================
// Tool schemas & wiring
// =============================================================================

const searchMetricsInputSchema = z.object({
  query: z.string().min(1).describe("Search term, e.g. 'average order value'"),
  limit: z.number().int().min(1).max(20).default(8),
});

const emptyInputSchema = z.object({});

const runExplorationInputSchema = z.object({
  config: explorationConfigValidator,
});

const getSnapshotInputSchema = z.object({
  snapshotId: z
    .string()
    .describe(
      "The snapshot ID returned by runExploration, e.g. 'snap_abc123_1'",
    ),
});

const SEARCH_METRICS_DESCRIPTION =
  "Search available metrics by name, description, owner, tags, or ID. " +
  "Use this to discover the right metrics before editing config.";

const GET_CURRENT_CONFIG_DESCRIPTION =
  "Get the current exploration config as JSON. Returns the latest executed config, or null if no exploration has been run yet.";

const GET_CONFIG_SCHEMA_DESCRIPTION =
  "Get a concise schema reference for valid exploration config objects.";

const RUN_EXPLORATION_DESCRIPTION =
  "Execute a product analytics exploration with the given config. " +
  "Use this when the user asks to build, change, or rerun a chart. " +
  "The chart will be automatically displayed to the user after execution. " +
  "Returns exploration (full result rows and config), resultCsv for tabular analysis, rowCount, snapshotId, and summary — use this return value for insights on the current run; call getSnapshot only for older or compacted snapshots.";

const GET_SNAPSHOT_DESCRIPTION =
  "Retrieve configuration and result CSV for a snapshot by snapshotId from conversation history. " +
  "Prefer using the runExploration return value (especially resultCsv) for the run you just executed. " +
  "Use getSnapshot when tool results for that snapshot are compacted or missing from the visible conversation, or when the user points to an older snapshotId.";

interface PAParams {
  datasourceId: string;
}

const productAnalyticsAgentConfig: AgentConfig<PAParams> = {
  promptType: "product-analytics-chat",

  parseParams: (body) => ({
    datasourceId: (body.datasourceId as string) ?? "",
  }),

  buildSystemPrompt: (ctx, { datasourceId }) =>
    buildProductAnalyticsSystemPrompt(ctx, datasourceId),

  buildTools: (ctx, conversationId, { datasourceId }) => {
    let metricsCache: FactMetricInterface[] | null = null;
    const getMetrics = async (): Promise<FactMetricInterface[]> => {
      if (metricsCache) return metricsCache;
      const all = await ctx.models.factMetrics.getAll();
      metricsCache = datasourceId
        ? all.filter((m) => m.datasource === datasourceId)
        : all;
      return metricsCache;
    };

    return {
      searchMetrics: aiTool({
        description: SEARCH_METRICS_DESCRIPTION,
        inputSchema: searchMetricsInputSchema,
        execute: (input) => executeSearchMetrics(getMetrics, input),
      }),

      getCurrentConfig: aiTool({
        description: GET_CURRENT_CONFIG_DESCRIPTION,
        inputSchema: emptyInputSchema,
        execute: () => executeGetCurrentConfig(conversationId),
      }),

      getConfigSchema: aiTool({
        description: GET_CONFIG_SCHEMA_DESCRIPTION,
        inputSchema: emptyInputSchema,
        execute: () => executeGetConfigSchema(),
      }),

      runExploration: aiTool({
        description: RUN_EXPLORATION_DESCRIPTION,
        inputSchema: runExplorationInputSchema,
        execute: ({ config }) =>
          executeRunExploration(ctx, conversationId, config),
      }),

      getSnapshot: aiTool({
        description: GET_SNAPSHOT_DESCRIPTION,
        inputSchema: getSnapshotInputSchema,
        execute: ({ snapshotId }) =>
          executeGetSnapshot(conversationId, snapshotId),
      }),
    };
  },

  temperature: 0.3,
  maxSteps: 10,
};

export const postChat = createAgentHandler(productAnalyticsAgentConfig);
