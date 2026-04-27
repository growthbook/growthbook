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

const MAX_RESULT_ROWS = 200;

const PA_SYSTEM_INSTRUCTIONS = `
<workflow>
Standard workflow for building a chart:
1. search — find the metric or fact table by name (or browse with an empty query).
2. getAvailableColumns — discover valid columns, userIdTypes, and unit requirements.
3. getColumnValues — (if filters or specific values needed) look up actual column values. NEVER guess.
4. runExploration — execute with a complete config. The chart is displayed automatically.

For follow-up modifications ("break down by country", "change to last 90 days", etc.), start from the config returned by the previous runExploration and apply the requested changes — do not rebuild from scratch.
</workflow>

<chart_rules>
Timeseries charts (line, area, timeseries-table): always include a date dimension.
Cumulative charts (bar, stackedBar, horizontalBar, stackedHorizontalBar, table, bigNumber): never include a date dimension.
When switching between timeseries and cumulative, add or remove the date dimension accordingly.
Default chartType: line for timeseries, bar for cumulative (when user doesn't specify).
NEVER use bigNumber unless the user explicitly asks for a big number or single-stat display. Always prefer bar chart for cumulative data.

CRITICAL — only 1 successful chart per response. NEVER produce more than one chart per turn.
If runExploration returns an error or 0 rows, you may retry with a corrected config — but once you get a successful non-empty result, that's the chart for this turn.
Combine multiple values into a single chart using dataset.values when possible.
If the user asks for data that spans both a fact table and a metric (different exploration types), pick the one that best answers the core question and tell the user the other cannot be plotted on the same chart.
</chart_rules>

<dimension_rules>
Only use dimensionType 'dynamic'. Never use 'static' or 'slice'.
'dynamic' shows the top N values for a column — set maxValues (1–20, default 5).
Use dateGranularity 'auto' by default for date dimensions; only use a specific granularity (hour/day/week/month/year) when the user requests it.
Maximum 2 total dimensions (including the date dimension for timeseries). If dataset has more than 1 value, max 1 dimension.
bigNumber charts (only when explicitly requested): 0 dimensions and exactly 1 value.

IMPORTANT: Do NOT add breakdown dimensions unless the user explicitly asks to "break down by", "split by", "group by", or similar.
For timeseries charts, include only the date dimension by default.
For cumulative charts, include 0 dimensions by default — just show the total.
</dimension_rules>

<unit_rules>
Always follow the unitNote returned by getAvailableColumns:
- fact_table valueType "unit_count": set unit to userIdTypes[0] (e.g. "user_id") unless user specifies otherwise.
- fact_table valueType "count" or "sum": unit must be null.
- metric: set unit for proportion, retention, dailyParticipation, and ratio-distinct metrics using userIdTypes[0]; null for all others.
- denominatorUnit: always null.
</unit_rules>

<value_column_rules>
For fact_table values:
- valueType "count": valueColumn must be null.
- valueType "unit_count": valueColumn must be null.
- valueType "sum": valueColumn must be a numeric column from getAvailableColumns.
</value_column_rules>

<row_filter_rules>
rowFilters shape: { operator, column, values }
Common operators: "=", "!=", "in", "not_in", "contains", "not_contains", "starts_with", "ends_with", "is_null", "not_null".
CRITICAL — never guess column values for filters. Always call getColumnValues first. Pass a searchTerm for partial matches (e.g. 'US' to find 'United States').
getColumnValues only works on string-typed columns.
</row_filter_rules>

<date_range_rules>
"last14Days" is NOT a valid predefined value. For 14 days use: { predefined: "customLookback", lookbackValue: 14, lookbackUnit: "day" }.
Valid predefined values: "today", "last7Days", "last30Days", "last90Days", "customLookback", "customDateRange".
</date_range_rules>

<search_rules>
Always use the search tool to discover metrics and fact tables.
Pass an empty query to browse all items, or a search term to filter. Use skip and limit to paginate through large result sets.
Each result includes an 'explorerType' field ('metric' or 'fact_table') indicating which exploration type to use, and a 'kind' field with the specific result type.
Prefer metrics over fact tables when both could satisfy the user's request — metrics are pre-defined with curated logic and are more reliable.
Results include an 'official' field: prefer official resources (official: true) over non-official ones, as they are vetted and authoritative.

CRITICAL search strategy:
- Keep search terms short and focused (1-3 words). Multi-word queries will match if ANY individual word hits, so "features experiments" will find items matching "features" OR "experiments". Exact and substring matches rank higher.
- If a specific search yields no results or only loosely related results, broaden your search. Try single generic keywords like "event", "count", "pageview", etc.
- Think creatively about which metric or fact table can answer the question. A generic metric (e.g. "count of events") with the right rowFilters applied can often answer questions that no specifically-named metric covers. Don't just settle for the first result — consider whether a more general resource + filters would be a better fit.
</search_rules>

<tool_notes>
runExploration returns resultCsv, config, snapshotId, and rowCount. Use resultCsv for analysis and insights. The chart is displayed automatically — do not embed config JSON in your text.
getSnapshot retrieves config and CSV for older/compacted snapshots by snapshotId. Prefer the runExploration return value for the current run.
</tool_notes>

<response_style>
Keep responses brief and actionable. When discussing data, reference specific numbers.
After running an exploration, respond with 1–2 sentences highlighting the key insight. Do not repeat the config or enumerate all data points.
If asked about metrics, fact tables, or tables that don't exist, let the user know.
</response_style>

<error_handling>
If a tool call returns an error, analyze the error, fix the config, and retry.
If you get the same or very similar error 3 times in a row, stop retrying — explain briefly what went wrong and suggest what the user can do differently.
If runExploration returns 0 rows, do NOT present this as a final answer. Treat it as a likely problem:
- Check that the date range covers a period with data (try widening it).
- Check that row filters aren't too restrictive (verify column values with getColumnValues).
- Consider whether you picked the wrong metric or fact table and search for alternatives.
Only after at least one retry should you tell the user no data was found.
</error_handling>
`.trim();

async function buildProductAnalyticsSystemPrompt(
  ctx: ReqContext,
  datasourceId: string,
): Promise<string> {
  const allMetrics = await ctx.models.factMetrics.getAll();
  const metrics = datasourceId
    ? allMetrics.filter((m) => m.datasource === datasourceId)
    : allMetrics;

  const allFactTables = datasourceId
    ? await getFactTablesForDatasource(ctx, datasourceId)
    : await getAllFactTablesForOrganization(ctx);

  return (
    "You are an expert product analytics assistant for GrowthBook.\n" +
    "You help users understand and work with their metrics, fact tables, and exploration configuration.\n\n" +
    (datasourceId
      ? `Datasource ID for this session: ${datasourceId}\n` +
        "Always use this datasource ID in the config.datasource field when calling runExploration.\n\n"
      : "") +
    `There are ${metrics.length} metrics and ${allFactTables.length} fact tables available. ` +
    "Use the search tool to discover them — pass an empty query to browse, or a search term to filter.\n\n" +
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
    "<config_schema>",
    "Top-level: { type, datasource, chartType, dateRange, dimensions, dataset }",
    'type: "metric" | "fact_table"',
    'chartType: "line" | "area" | "timeseries-table" | "table" | "bar" | "stackedBar" | "horizontalBar" | "stackedHorizontalBar" | "bigNumber"',
    "dateRange: { predefined, lookbackValue?, lookbackUnit?, startDate?, endDate? }",
    '  lookbackUnit: "hour" | "day" | "week" | "month"',
    "dimensions: array of dimension objects:",
    "  date: { dimensionType: 'date', column: null, dateGranularity: 'auto'|'hour'|'day'|'week'|'month'|'year' }",
    "  dynamic: { dimensionType: 'dynamic', column: string, maxValues: number (1-20) }",
    'dataset for type="metric": { type: "metric", values: [{ type: "metric", name, metricId, unit, denominatorUnit, rowFilters }] }',
    'dataset for type="fact_table": { type: "fact_table", factTableId, values: [{ type: "fact_table", name, valueType: "unit_count"|"count"|"sum", valueColumn, unit, rowFilters }] }',
    'rowFilters: [{ operator: "="|"!="|"in"|"not_in"|"contains"|"not_contains"|"starts_with"|"ends_with"|"is_null"|"not_null", column: string, values: string[] }]',
    "Always pass a complete config object to runExploration.",
    "</config_schema>",
  ].join("\n");
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

/**
 * Light singularization so queries like "page views" still match metrics
 * named "Page View" (and vice versa). Deliberately simple — this is a
 * heuristic, not a full stemmer.
 */
function singularizeWord(word: string): string {
  if (word.length <= 3) return word;
  if (word.endsWith("ies") && word.length > 4) {
    return word.slice(0, -3) + "y";
  }
  if (/(sses|shes|ches|xes|zes)$/.test(word)) {
    return word.slice(0, -2);
  }
  if (
    word.endsWith("s") &&
    !word.endsWith("ss") &&
    !word.endsWith("us") &&
    !word.endsWith("is")
  ) {
    return word.slice(0, -1);
  }
  return word;
}

function normalizeForSearch(text: string): string {
  return text
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map(singularizeWord)
    .join(" ");
}

/**
 * Score a search query against a haystack string.
 * - Exact name/id match with the full query: 10
 * - Full query found as substring in haystack: 5
 * - Per-token: each token found in haystack adds 1 point
 * Matching is also performed on a singularized form of both the query and
 * the haystack so plural/singular differences don't hide results.
 * Returns 0 if no tokens match.
 */
function scoreSearch(
  q: string,
  qNorm: string,
  tokens: string[],
  tokensNorm: string[],
  haystack: string,
  haystackNorm: string,
  name: string,
  id: string,
): number {
  const nameLower = name.toLowerCase();
  const idLower = id.toLowerCase();
  const exactMatch =
    nameLower === q || idLower === q || normalizeForSearch(nameLower) === qNorm;
  if (exactMatch) return 10;

  const fullSubstring = haystack.includes(q) || haystackNorm.includes(qNorm);
  let score = fullSubstring ? 5 : 0;

  if (tokens.length > 1) {
    for (let i = 0; i < tokens.length; i++) {
      if (
        haystack.includes(tokens[i]) ||
        haystackNorm.includes(tokensNorm[i])
      ) {
        score += 1;
      }
    }
  }

  return score;
}

async function executeSearch(
  getMetrics: () => Promise<FactMetricInterface[]>,
  getFactTables: () => Promise<FactTableInterface[]>,
  input: { query: string; limit: number; skip: number },
): Promise<string> {
  const { query, limit, skip } = input;
  const q = query.trim().toLowerCase();
  const isBlank = q.length === 0;
  const tokens = q.split(/\s+/).filter(Boolean);
  const qNorm = normalizeForSearch(q);
  const tokensNorm = tokens.map(singularizeWord);

  type ScoredResult = { score: number; name: string; result: unknown };
  const all: ScoredResult[] = [];

  const metrics = await getMetrics();
  for (const m of metrics) {
    const metricResult = {
      kind: "metric" as const,
      explorerType: "metric" as const,
      id: m.id,
      name: m.name,
      type: m.metricType,
      official: m.managedBy === "admin",
      description: m.description ?? null,
      owner: m.owner ?? null,
      tags: m.tags ?? [],
    };
    if (isBlank) {
      all.push({ score: 0, name: m.name, result: metricResult });
      continue;
    }
    const haystack = [
      m.id,
      m.name,
      m.description ?? "",
      m.owner ?? "",
      ...(m.tags ?? []),
    ]
      .join(" ")
      .toLowerCase();
    const haystackNorm = normalizeForSearch(haystack);
    const score = scoreSearch(
      q,
      qNorm,
      tokens,
      tokensNorm,
      haystack,
      haystackNorm,
      m.name,
      m.id,
    );
    if (score > 0) {
      all.push({ score, name: m.name, result: metricResult });
    }
  }

  const factTables = await getFactTables();
  for (const ft of factTables) {
    const ftResult = {
      kind: "fact_table" as const,
      explorerType: "fact_table" as const,
      id: ft.id,
      name: ft.name,
      official: ft.managedBy === "admin",
      eventName: ft.eventName ?? null,
      columnCount: (ft.columns ?? []).filter((c) => !c.deleted).length,
    };
    if (isBlank) {
      all.push({ score: 0, name: ft.name, result: ftResult });
      continue;
    }
    const haystack = [ft.id, ft.name, ft.eventName ?? ""]
      .join(" ")
      .toLowerCase();
    const haystackNorm = normalizeForSearch(haystack);
    const score = scoreSearch(
      q,
      qNorm,
      tokens,
      tokensNorm,
      haystack,
      haystackNorm,
      ft.name,
      ft.id,
    );
    if (score > 0) {
      all.push({ score, name: ft.name, result: ftResult });
    }
  }

  const sorted = isBlank
    ? all.sort((a, b) => a.name.localeCompare(b.name))
    : all.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));

  const totalMatches = sorted.length;
  const matches = sorted.slice(skip, skip + limit).map((x) => x.result);

  if (!matches.length) {
    if (isBlank) {
      return JSON.stringify(
        {
          matches: [],
          totalMetrics: metrics.length,
          totalFactTables: factTables.length,
          totalMatches: 0,
        },
        null,
        2,
      );
    }
    return JSON.stringify(
      {
        matches: [],
        totalMetrics: metrics.length,
        totalFactTables: factTables.length,
        totalMatches: 0,
        message: `No results found for "${query}".`,
      },
      null,
      2,
    );
  }
  return JSON.stringify(
    {
      matches,
      totalMetrics: metrics.length,
      totalFactTables: factTables.length,
      totalMatches,
      skip,
      limit,
    },
    null,
    2,
  );
}

type RunExplorationToolResult =
  | {
      summary: string;
      configNormalized?: string[];
      noDataWarning?: string;
      status: "success";
      snapshotId: string;
      rowCount: number;
      config: ExplorationConfig;
      resultCsv: string | null;
      exploration: Awaited<
        ReturnType<typeof runProductAnalyticsExploration>
      > | null;
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

  const dateIdx = dims.findIndex((d) => d.dimensionType === "date");
  if (dateIdx > 0) {
    const dateDim = dims[dateIdx];
    dims = [dateDim, ...dims.filter((_, i) => i !== dateIdx)];
    warnings.push(
      "Moved date dimension to the first position. Date dimensions must come before breakdown dimensions.",
    );
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
    const rowCount = exploration?.result?.rows?.length ?? 0;

    return {
      summary,
      ...(warnings.length > 0 && {
        configNormalized: warnings,
      }),
      ...(rowCount === 0 && {
        noDataWarning:
          "The query returned 0 rows. This likely means the filters, date range, or selected metric/fact table are wrong. " +
          "Do NOT present this as a final answer. Try widening the date range, verifying filters with getColumnValues, " +
          "or searching for a different metric/fact table before giving up.",
      }),
      status: "success",
      snapshotId,
      rowCount,
      config,
      resultCsv,
      exploration: exploration ?? null,
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

      const ftIds = [
        ...new Set(
          metrics
            .map((m) => m.numerator.factTableId)
            .filter((id): id is string => !!id),
        ),
      ];
      const factTables = await Promise.all(
        ftIds.map((id) => getFactTable(ctx, id)),
      );
      const ftMap = new Map(ftIds.map((id, i) => [id, factTables[i]] as const));

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
        const ft = ftMap.get(m.numerator.factTableId) ?? null;
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
    .default("")
    .describe(
      "Search term to match against metrics and fact tables, e.g. 'revenue' or 'pageviews'. " +
        "Pass an empty string to browse all available metrics and fact tables.",
    ),
  limit: z.number().int().min(1).max(20).default(10),
  skip: z
    .number()
    .int()
    .min(0)
    .default(0)
    .describe(
      "Number of results to skip for pagination. Use with limit to page through results.",
    ),
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
  "Pass an empty query to browse all available items. Use skip and limit to paginate through results. " +
  "Returns totalMetrics, totalFactTables, and totalMatches counts for pagination. " +
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

const RUN_EXPLORATION_DESCRIPTION =
  "Execute a product analytics exploration with the given config. " +
  "Use this when the user asks to build, change, or rerun a chart. " +
  "The chart will be automatically displayed to the user after execution. " +
  "Returns config (the normalized config used), resultCsv (CSV of the results for analysis), rowCount, snapshotId, and summary. " +
  "Use config and resultCsv for analysis and follow-up modifications. Ignore the exploration field (internal use). " +
  "Call getSnapshot only for older or compacted snapshots.";

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

  temperature: 0.1,
  maxSteps: 20,
  maxConsecutiveToolErrors: 5,
};

export const postChat = createAgentHandler(productAnalyticsAgentConfig);
