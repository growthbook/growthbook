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
import {
  ColumnInterface,
  FactMetricInterface,
  FactTableInterface,
} from "shared/types/fact-table";
import type { ReqContext } from "back-end/types/request";
import { runProductAnalyticsExploration } from "back-end/src/enterprise/services/product-analytics";
import { aiTool } from "back-end/src/enterprise/services/ai";
import type { ConversationBuffer } from "back-end/src/enterprise/services/conversation-buffer";
import {
  createAgentHandler,
  type AgentConfig,
} from "back-end/src/enterprise/services/agent-handler";
import {
  getFactTable,
  getFactTablesForDatasource,
  getAllFactTablesForOrganization,
} from "back-end/src/models/FactTableModel";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import { runColumnsTopValuesQuery } from "back-end/src/jobs/refreshFactTableColumns";

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
  "Use the search tool to discover metrics and fact tables. " +
  "Each result includes an 'explorerType' field ('metric' or 'fact_table') indicating which exploration type to use, and a 'kind' field with the specific result type.\n" +
  "For fact_table explorations: use search to find a fact table, then getAvailableColumns({ source: 'fact_table', factTableId }) to discover valid columns and userIdTypes before building the config.\n" +
  "For metric explorations with filters, group-by dimensions, or before setting unit: use getAvailableColumns({ source: 'metric', metricIds }) to discover valid columns and which metrics need a unit.\n" +
  "Unit field rules — always follow the unitNote returned by getAvailableColumns:\n" +
  '  - fact_table valueType "unit_count": set unit to userIdTypes[0] (e.g. "user_id") unless the user specifies otherwise.\n' +
  '  - fact_table valueType "count" or "sum": unit must be null.\n' +
  "  - metric: set unit for proportion, retention, dailyParticipation, and ratio-distinct metrics using userIdTypes[0]; null for all others.\n" +
  "Dimension rules for breakdowns / group-by:\n" +
  "  - Only use dimensionType 'dynamic'. Never use 'static' or 'slice'.\n" +
  "  - 'dynamic' shows the top N values for a column — set maxValues (1-20, default 5).\n" +
  "  - Maximum 2 total dimensions (including the date dimension for timeseries). If the dataset has more than 1 value, max is 1 dimension.\n" +
  "  - bigNumber charts: no dimensions at all and only 1 value.\n" +
  "CRITICAL — never guess column values. Whenever you need a specific column value — for row filters or any other purpose — " +
  "you MUST call getColumnValues first to discover the actual values stored in that column. " +
  "Pass a searchTerm when you have a partial guess (e.g. searchTerm='US' to find 'United States'). " +
  "getColumnValues only works on string-typed columns. " +
  "Do not fabricate or assume values like country codes, browser names, or status strings.\n" +
  "Use getCurrentConfig and getConfigSchema when you need to reason about valid config edits.\n" +
  "If asked about metrics, fact tables, or tables that don't exist, let the user know.\n" +
  "If a tool call returns an error, analyze the error, fix the config, and retry. " +
  "If you get the same or a very similar error 2 times in a row, stop retrying — explain briefly what went wrong and suggest what the user can do differently.\n" +
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

  const allFactTables = datasourceId
    ? await getFactTablesForDatasource(ctx, datasourceId)
    : await getAllFactTablesForOrganization(ctx);
  const factTablesPreview = buildFactTablesPreview(allFactTables);

  return (
    "You are an expert product analytics assistant for GrowthBook.\n" +
    "You help users understand and work with their metrics, fact tables, and exploration configuration.\n\n" +
    (datasourceId
      ? `Datasource ID for this session: ${datasourceId}\n` +
        "Always use this datasource ID in the config.datasource field when calling runExploration.\n\n"
      : "") +
    "Available metrics (sample):\n" +
    metricsPreview +
    "\n\n" +
    "Available fact tables (sample):\n" +
    factTablesPreview +
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
  buffer: ConversationBuffer,
  snapshotId: string,
): AIChatToolResultPart | undefined {
  const messages = buffer.getMessages();
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
    '- type: "metric" | "fact_table"',
    '- chartType: "line" | "area" | "timeseries-table" | "table" | "bar" | "stackedBar" | "horizontalBar" | "stackedHorizontalBar" | "bigNumber"',
    '- dateRange.predefined: "today" | "last7Days" | "last30Days" | "last90Days" | "customLookback" | "customDateRange"',
    '- IMPORTANT: "last14Days" is not valid. For 14 days use { predefined: "customLookback", lookbackValue: 14, lookbackUnit: "day" }',
    "- dimensions[]: use column values returned by getAvailableColumns for dimension columns and rowFilter columns",
    "  - date: { dimensionType: 'date', column: null, dateGranularity: 'auto'|'hour'|'day'|'week'|'month'|'year' } — only for timeseries charts (line, area, timeseries-table)",
    "  - dynamic: { dimensionType: 'dynamic', column: string, maxValues: number (1-20) } — use for all breakdowns / group-by",
    "  - Never use dimensionType 'static' or 'slice'.",
    "  - Max 2 total dimensions (including date). Max 1 if dataset has multiple values. bigNumber: 0 dimensions.",
    '- dataset for type="metric": { type: "metric", values: [{ type: "metric", name, metricId, unit, denominatorUnit, rowFilters[] }] }',
    "  Use search to find metricId. Use getAvailableColumns({ source: 'metric', metricIds }) to discover valid columns and unit options.",
    "  unit: one of userIdTypes for proportion/retention/dailyParticipation/ratio-distinct metrics; null for all others.",
    '- dataset for type="fact_table": { type: "fact_table", factTableId, values: [{ type: "fact_table", name, valueType: "unit_count"|"count"|"sum", valueColumn, unit, rowFilters[] }] }',
    "  Use search to find factTableId (result kind=\"fact_table\"). Use getAvailableColumns({ source: 'fact_table', factTableId }) to discover valid columns and unit options.",
    '  unit: one of userIdTypes (e.g. "user_id") when valueType is "unit_count"; null for "count" or "sum".',
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
      `... and ${metrics.length - METRICS_PREVIEW_COUNT} more. Use the search tool to discover additional metrics.`,
    );
  }

  return lines.join("\n");
}

function buildFactTablesPreview(factTables: FactTableInterface[]): string {
  if (!factTables.length)
    return "No fact tables are configured for this datasource.";

  const preview = factTables.slice(0, METRICS_PREVIEW_COUNT);
  const lines = preview.map((ft) => {
    const colCount = (ft.columns ?? []).filter((c) => !c.deleted).length;
    return `- "${ft.name}" (id: ${ft.id}, columns: ${colCount})`;
  });

  if (factTables.length > METRICS_PREVIEW_COUNT) {
    lines.push(
      `... and ${factTables.length - METRICS_PREVIEW_COUNT} more. Use the search tool to discover additional fact tables.`,
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
      .map((c) => {
        if (c.includes('"') || c.includes(",") || c.includes("\n")) {
          return `"${c.replace(/"/g, '""')}"`;
        }
        return c;
      })
      .join(",");
  });

  let csv = [header, ...dataLines].join("\n");
  if (rows.length > MAX_RESULT_ROWS) {
    csv += `\n... (${rows.length - MAX_RESULT_ROWS} more rows truncated)`;
  }
  return csv;
}

function nextSnapshotId(buffer: ConversationBuffer): string {
  const msgs = buffer.getMessages();
  let count = 0;
  for (const m of msgs) {
    if (m.role !== "tool") continue;
    for (const part of m.content) {
      if (part.toolName === "runExploration") count++;
    }
  }
  return `snap_${buffer.conversationId.slice(0, 8)}_${count + 1}`;
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

async function executeSearch(
  getMetrics: () => Promise<FactMetricInterface[]>,
  getFactTables: () => Promise<FactTableInterface[]>,
  input: { query: string; limit: number },
): Promise<string> {
  const { query, limit } = input;
  const q = query.trim().toLowerCase();

  type ScoredResult = { score: number; name: string; result: unknown };
  const all: ScoredResult[] = [];

  // Search metrics
  const metrics = await getMetrics();
  for (const m of metrics) {
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
    if (score > 0) {
      all.push({
        score,
        name: m.name,
        result: {
          kind: "metric",
          explorerType: "metric",
          id: m.id,
          name: m.name,
          type: m.metricType,
          description: m.description ?? null,
          owner: m.owner ?? null,
          tags: m.tags ?? [],
        },
      });
    }
  }

  // Search fact tables
  const factTables = await getFactTables();
  for (const ft of factTables) {
    const haystack = [ft.id, ft.name, ft.eventName ?? ""]
      .join(" ")
      .toLowerCase();
    const exact = ft.name.toLowerCase() === q || ft.id.toLowerCase() === q;
    const includes = haystack.includes(q);
    const score = exact ? 3 : includes ? 1 : 0;
    if (score > 0) {
      all.push({
        score,
        name: ft.name,
        result: {
          kind: "fact_table",
          explorerType: "fact_table",
          id: ft.id,
          name: ft.name,
          eventName: ft.eventName ?? null,
          columnCount: (ft.columns ?? []).filter((c) => !c.deleted).length,
        },
      });
    }
  }

  const matches = all
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, limit)
    .map((x) => x.result);

  if (!matches.length) {
    return `No results found for "${query}".`;
  }
  return JSON.stringify({ matches }, null, 2);
}

async function executeGetCurrentConfig(
  buffer: ConversationBuffer,
): Promise<string> {
  const latest = buffer.getLatestToolResult("runExploration");
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
      configNormalized?: string[];
      status: "success";
      snapshotId: string;
      rowCount: number;
      exploration: Awaited<
        ReturnType<typeof runProductAnalyticsExploration>
      > | null;
      resultCsv: string | null;
    }
  | { status: "error"; message: string };

const TIMESERIES_CHART_TYPES = new Set(["line", "area", "timeseries-table"]);

interface NormalizeResult {
  config: ExplorationConfig;
  warnings: string[];
}

function normalizeConfigForExplorer(
  config: ExplorationConfig,
): NormalizeResult {
  const warnings: string[] = [];
  let dims = config.dimensions;
  let dataset = config.dataset;

  // Convert static → dynamic; drop slice
  const hadStatic = dims.some((d) => d.dimensionType === "static");
  const hadSlice = dims.some((d) => d.dimensionType === "slice");
  dims = dims
    .map((d) => {
      if (d.dimensionType === "static") {
        return {
          dimensionType: "dynamic" as const,
          column: d.column,
          maxValues: Math.min(d.values.length || 5, 20),
        };
      }
      return d;
    })
    .filter((d) => d.dimensionType !== "slice");
  if (hadStatic) {
    warnings.push(
      "Static dimensions are not supported — converted to dynamic. Only use dimensionType 'dynamic'.",
    );
  }
  if (hadSlice) {
    warnings.push(
      "Slice dimensions are not supported and were removed. Only use dimensionType 'dynamic'.",
    );
  }

  const isTimeseries = TIMESERIES_CHART_TYPES.has(config.chartType);

  if (isTimeseries) {
    if (!dims.some((d) => d.dimensionType === "date")) {
      dims = [
        { dimensionType: "date", column: null, dateGranularity: "day" },
        ...dims,
      ];
      warnings.push(
        "Added missing date dimension for timeseries chart. Timeseries charts (line, area, timeseries-table) always need a date dimension.",
      );
    }
  } else {
    const hadDate = dims.some((d) => d.dimensionType === "date");
    dims = dims.filter((d) => d.dimensionType !== "date");
    if (hadDate) {
      warnings.push(
        `Removed date dimension — cumulative chart type '${config.chartType}' does not use date dimensions.`,
      );
    }
  }

  // bigNumber: no dimensions, single value
  if (config.chartType === "bigNumber") {
    if (dims.length > 0) {
      dims = [];
      warnings.push(
        "Removed all dimensions — bigNumber charts do not support dimensions.",
      );
    }
    if (dataset.values.length > 1) {
      dataset = {
        ...dataset,
        values: dataset.values.slice(0, 1),
      } as typeof dataset;
      warnings.push(
        "Trimmed to 1 value — bigNumber charts only support a single value.",
      );
    }
  }

  // Enforce max dimensions (2, or 1 if multiple values)
  const maxDims = dataset.values.length > 1 ? 1 : 2;
  if (dims.length > maxDims) {
    const removed = dims.length - maxDims;
    dims = dims.slice(0, maxDims);
    warnings.push(
      `Removed ${removed} dimension(s) to stay within the limit of ${maxDims} (max 2, or 1 when multiple values).`,
    );
  }

  return {
    config: { ...config, dimensions: dims, dataset } as ExplorationConfig,
    warnings,
  };
}

async function executeRunExploration(
  ctx: ReqContext,
  buffer: ConversationBuffer,
  rawConfig: ExplorationConfig,
): Promise<RunExplorationToolResult> {
  try {
    const { config, warnings } = normalizeConfigForExplorer(rawConfig);
    const exploration = await runProductAnalyticsExploration(ctx, config, {
      cache: "preferred",
    });

    if (exploration?.status === "error") {
      return {
        status: "error",
        message: exploration.error ?? "The query failed with an unknown error",
      };
    }

    const prevConfig = explorationConfigFromLatestRun(
      buffer.getLatestToolResult("runExploration"),
    );
    const summary = buildSnapshotSummary(prevConfig, config);
    const resultCsv = buildResultCsv(exploration?.result?.rows ?? [], config);

    const snapshotId = nextSnapshotId(buffer);

    return {
      summary,
      ...(warnings.length > 0 && {
        configNormalized: warnings,
      }),
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
  buffer: ConversationBuffer,
  snapshotId: string,
): Promise<string> {
  const part = findSnapshot(buffer, snapshotId);
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

async function executeGetAvailableColumns(
  ctx: ReqContext,
  input: z.infer<typeof getAvailableColumnsInputSchema>,
): Promise<string> {
  switch (input.source) {
    case "fact_table": {
      const { factTableId } = input;
      if (!factTableId) return "factTableId is required for fact_table source.";
      const ft = await getFactTable(ctx, factTableId);
      if (!ft) return `Fact table "${factTableId}" not found.`;
      const columns = (ft.columns ?? [])
        .filter((c) => !c.deleted)
        .sort((a, b) => (a.name || a.column).localeCompare(b.name || b.column))
        .map((c) => ({ column: c.column, name: c.name, datatype: c.datatype }));
      return JSON.stringify(
        {
          columns,
          userIdTypes: ft.userIdTypes ?? [],
          unitNote: ft.userIdTypes?.length
            ? `For valueType "unit_count", set unit to one of userIdTypes (default: "${ft.userIdTypes[0]}"). For "count" or "sum", set unit to null.`
            : 'No userIdTypes configured — use valueType "count" or "sum" only; set unit to null.',
        },
        null,
        2,
      );
    }

    case "metric": {
      const { metricIds } = input;
      if (!metricIds?.length) return "metricIds is required for metric source.";
      const metrics = await ctx.models.factMetrics.getByIds(metricIds);
      let columns: FactTableInterface["columns"] | null = null;
      let userIdTypes: string[] = [];
      const metricUnitInfo: {
        metricId: string;
        metricType: string;
        needsUnit: boolean;
      }[] = [];

      for (const m of metrics) {
        const needsUnit =
          m.metricType === "proportion" ||
          m.metricType === "retention" ||
          m.metricType === "dailyParticipation" ||
          (m.metricType === "ratio" &&
            m.numerator.column === "$$distinctUsers");

        metricUnitInfo.push({
          metricId: m.id,
          metricType: m.metricType,
          needsUnit,
        });

        if (!m.numerator.factTableId) continue;
        const ft = await getFactTable(ctx, m.numerator.factTableId);
        if (!userIdTypes.length && ft?.userIdTypes?.length) {
          userIdTypes = ft.userIdTypes;
        }
        const ftCols = (ft?.columns ?? []).filter((c) => !c.deleted);
        if (columns === null) {
          columns = ftCols;
        } else {
          const nameSet = new Set(ftCols.map((c) => c.column));
          columns = columns.filter((c) => nameSet.has(c.column));
        }
      }

      const result = (columns ?? [])
        .sort((a, b) => (a.name || a.column).localeCompare(b.name || b.column))
        .map((c) => ({ column: c.column, name: c.name, datatype: c.datatype }));

      const unitNote = userIdTypes.length
        ? `For metrics where needsUnit=true, set unit to one of userIdTypes (default: "${userIdTypes[0]}"). For others, set unit to null.`
        : "No userIdTypes found — set unit to null for all metrics.";

      return JSON.stringify(
        { columns: result, userIdTypes, metrics: metricUnitInfo, unitNote },
        null,
        2,
      );
    }
  }
}

async function executeGetColumnValues(
  ctx: ReqContext,
  input: z.infer<typeof getColumnValuesInputSchema>,
): Promise<string> {
  const { columns: requestedColumns, searchTerm, limit } = input;

  type RawCol = { column: string; datatype: string };
  let factTableSql: string;
  let factTableEventName: string;
  let datasourceId: string;
  let availableColumns: RawCol[];

  switch (input.source) {
    case "fact_table": {
      const { factTableId } = input;
      if (!factTableId) return "factTableId is required for fact_table source.";
      const ft = await getFactTable(ctx, factTableId);
      if (!ft) return `Fact table "${factTableId}" not found.`;
      factTableSql = ft.sql;
      factTableEventName = ft.eventName ?? "";
      datasourceId = ft.datasource;
      availableColumns = (ft.columns ?? [])
        .filter((c) => !c.deleted)
        .map((c) => ({ column: c.column, datatype: c.datatype }));
      break;
    }

    case "metric": {
      const { metricIds } = input;
      if (!metricIds?.length) return "metricIds is required for metric source.";
      const metrics = await ctx.models.factMetrics.getByIds(metricIds);
      const firstWithFt = metrics.find((m) => m.numerator.factTableId);
      if (!firstWithFt?.numerator.factTableId) {
        return "Could not resolve a fact table from the provided metric IDs.";
      }
      const ft = await getFactTable(ctx, firstWithFt.numerator.factTableId);
      if (!ft) return `Fact table not found.`;
      factTableSql = ft.sql;
      factTableEventName = ft.eventName ?? "";
      datasourceId = ft.datasource;
      availableColumns = (ft.columns ?? [])
        .filter((c) => !c.deleted)
        .map((c) => ({ column: c.column, datatype: c.datatype }));
      break;
    }
  }

  const datasource = await getDataSourceById(ctx, datasourceId);
  if (!datasource) return `Datasource not found.`;

  // Separate requested columns into queryable (string-typed), skipped (wrong type), not-found
  const colsToQuery: ColumnInterface[] = [];
  const nonStringCols: string[] = [];
  const notFoundCols: string[] = [];

  for (const name of requestedColumns) {
    const found = availableColumns.find((c) => c.column === name);
    if (!found) {
      notFoundCols.push(name);
    } else if (found.datatype !== "string") {
      nonStringCols.push(name);
    } else {
      colsToQuery.push({
        column: name,
        name,
        datatype: "string",
        numberFormat: "",
        description: "",
        deleted: false,
        dateCreated: new Date(0),
        dateUpdated: new Date(0),
      });
    }
  }

  const warnings: string[] = [];
  if (nonStringCols.length)
    warnings.push(`Skipped (non-string type): ${nonStringCols.join(", ")}`);
  if (notFoundCols.length)
    warnings.push(`Columns not found: ${notFoundCols.join(", ")}`);

  if (colsToQuery.length === 0) {
    return JSON.stringify(
      { values: {}, warnings: warnings.length ? warnings : undefined },
      null,
      2,
    );
  }

  let rawValues: Record<string, string[]>;
  try {
    rawValues = await runColumnsTopValuesQuery(
      ctx,
      datasource,
      { sql: factTableSql, eventName: factTableEventName },
      colsToQuery,
    );
  } catch (err) {
    return `Failed to query column values: ${
      err instanceof Error ? err.message : "Unknown error"
    }`;
  }

  // Apply searchTerm filter and respect limit
  const values: Record<string, string[]> = {};
  for (const col of Object.keys(rawValues)) {
    let vals = rawValues[col];
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      vals = vals.filter((v) => v.toLowerCase().includes(term));
    }
    values[col] = vals.slice(0, limit);
  }

  return JSON.stringify(
    { values, warnings: warnings.length ? warnings : undefined },
    null,
    2,
  );
}

// =============================================================================
// Tool schemas & wiring
// =============================================================================

const searchInputSchema = z.object({
  query: z
    .string()
    .min(1)
    .describe(
      "Search term to match against metrics and fact tables, e.g. 'revenue' or 'pageviews'",
    ),
  limit: z.number().int().min(1).max(20).default(10),
});

const columnSourceValues = ["fact_table", "metric"] as const;

const columnSourceFields = {
  source: z
    .enum(columnSourceValues)
    .describe("The exploration type — determines which ID field is required"),
  factTableId: z
    .string()
    .optional()
    .describe("Fact table ID — required when source is 'fact_table'"),
  metricIds: z
    .array(z.string())
    .optional()
    .describe(
      "Metric IDs — required when source is 'metric'. Returns the intersection of columns across all selected metrics' underlying fact tables",
    ),
};

function validateColumnSource(v: {
  source: string;
  factTableId?: string;
  metricIds?: string[];
}): boolean {
  switch (v.source) {
    case "fact_table":
      return !!v.factTableId;
    case "metric":
      return !!v.metricIds?.length;
    default:
      return false;
  }
}

const getAvailableColumnsInputSchema = z
  .object(columnSourceFields)
  .refine(validateColumnSource, {
    message: "Provide the ID field matching the selected source",
  });

const getColumnValuesInputSchema = z
  .object({
    ...columnSourceFields,
    columns: z
      .array(z.string())
      .min(1)
      .max(5)
      .describe(
        "Column names to fetch values for — must be string-typed columns",
      ),
    searchTerm: z
      .string()
      .optional()
      .describe(
        "Optional substring filter — only return values containing this string (case-insensitive). Use when you have a partial guess of the value, e.g. 'US' to find 'United States'.",
      ),
    limit: z.number().int().min(1).max(50).default(20),
  })
  .refine(validateColumnSource, {
    message: "Provide the ID field matching the selected source",
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

const SEARCH_DESCRIPTION =
  "Search across metrics and fact tables by name, description, or ID. " +
  "Each result includes a 'kind' field ('metric' or 'fact_table') and an 'explorerType' field " +
  "('metric' or 'fact_table') indicating which exploration type to use. " +
  "Use the 'id' field from results as metricId or factTableId.";

const GET_AVAILABLE_COLUMNS_DESCRIPTION =
  "Get the columns available for dimensions and filters based on the current selection. " +
  "Also returns userIdTypes and a unitNote that tells you exactly how to set the unit field for each value. " +
  "Set source to 'fact_table' and pass factTableId for fact table explorations. " +
  "Set source to 'metric' and pass metricIds for metric explorations — returns the intersection of columns across selected metrics, plus per-metric needsUnit flags.";

const GET_COLUMN_VALUES_DESCRIPTION =
  "Fetch the actual values stored in one or more string columns by running a lightweight GROUP BY query against the warehouse. " +
  "You MUST call this tool before using any specific column value — for row filters, static dimension values, or any other purpose. Never guess or assume what values a column contains. " +
  "Pass an optional searchTerm to narrow results when you have a partial guess (e.g. searchTerm='US' to find 'United States'). " +
  "Set source to match the exploration type ('fact_table' or 'metric') and provide the corresponding ID field, same as getAvailableColumns.";

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
  agentType: "product-analytics",
  promptType: "product-analytics-chat",

  parseParams: (body) => ({
    datasourceId: (body.datasourceId as string) ?? "",
  }),

  buildSystemPrompt: (ctx, { datasourceId }) =>
    buildProductAnalyticsSystemPrompt(ctx, datasourceId),

  buildTools: (ctx, buffer, { datasourceId }) => {
    let metricsCache: FactMetricInterface[] | null = null;
    const getMetrics = async (): Promise<FactMetricInterface[]> => {
      if (metricsCache) return metricsCache;
      const all = await ctx.models.factMetrics.getAll();
      metricsCache = datasourceId
        ? all.filter((m) => m.datasource === datasourceId)
        : all;
      return metricsCache;
    };

    let factTablesCache: FactTableInterface[] | null = null;
    const getFactTables = async (): Promise<FactTableInterface[]> => {
      if (factTablesCache) return factTablesCache;
      factTablesCache = datasourceId
        ? await getFactTablesForDatasource(ctx, datasourceId)
        : await getAllFactTablesForOrganization(ctx);
      return factTablesCache;
    };

    return {
      search: aiTool({
        description: SEARCH_DESCRIPTION,
        inputSchema: searchInputSchema,
        execute: (input) => executeSearch(getMetrics, getFactTables, input),
      }),

      getAvailableColumns: aiTool({
        description: GET_AVAILABLE_COLUMNS_DESCRIPTION,
        inputSchema: getAvailableColumnsInputSchema,
        execute: (input) => executeGetAvailableColumns(ctx, input),
      }),

      getColumnValues: aiTool({
        description: GET_COLUMN_VALUES_DESCRIPTION,
        inputSchema: getColumnValuesInputSchema,
        execute: (input) => executeGetColumnValues(ctx, input),
      }),

      getCurrentConfig: aiTool({
        description: GET_CURRENT_CONFIG_DESCRIPTION,
        inputSchema: emptyInputSchema,
        execute: () => executeGetCurrentConfig(buffer),
      }),

      getConfigSchema: aiTool({
        description: GET_CONFIG_SCHEMA_DESCRIPTION,
        inputSchema: emptyInputSchema,
        execute: () => executeGetConfigSchema(),
      }),

      runExploration: aiTool({
        description: RUN_EXPLORATION_DESCRIPTION,
        inputSchema: runExplorationInputSchema,
        execute: ({ config }) => executeRunExploration(ctx, buffer, config),
      }),

      getSnapshot: aiTool({
        description: GET_SNAPSHOT_DESCRIPTION,
        inputSchema: getSnapshotInputSchema,
        execute: ({ snapshotId }) => executeGetSnapshot(buffer, snapshotId),
      }),
    };
  },

  temperature: 0.3,
  maxSteps: 15,
};

export const postChat = createAgentHandler(productAnalyticsAgentConfig);
