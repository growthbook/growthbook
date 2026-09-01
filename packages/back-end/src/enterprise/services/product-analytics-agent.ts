import { setTimeout as delay } from "timers/promises";
import { z } from "zod";
import {
  PRODUCT_ANALYTICS_CHAT_SKILL_GROUP,
  tryParseToolResultJson,
  toolResultSnapshotId,
  type AIChatMention,
  type AIChatToolResultPart,
} from "shared/ai-chat";
import {
  dateRangePredefined,
  ExplorationConfig,
  explorationConfigValidator,
  ProductAnalyticsExploration,
  ProductAnalyticsResultRow,
} from "shared/validators";
import {
  blockComparisonValidator,
  dashboardGlobalControlsValidator,
  proposeDashboardBlockValidator,
  clearInapplicableShowAs,
  getEffectiveShowAs,
  getIsRatioByIndex,
  buildExplorationColumns,
  getExplorationCellValue,
} from "shared/enterprise";
import {
  FactMetricInterface,
  FactTableInterface,
} from "shared/types/fact-table";
import {
  buildDashboardDraft,
  type BuildDashboardDraftInput,
} from "back-end/src/enterprise/services/dashboard-proposal";
import type { ReqContext } from "back-end/types/request";
import { runProductAnalyticsExploration } from "back-end/src/enterprise/services/product-analytics";
import {
  createProductAnalyticsSearchLoaders,
  discoveryResultToToolString,
  getProductAnalyticsColumnValues,
  getProductAnalyticsColumns,
  productAnalyticsColumnSources,
  runProductAnalyticsSearch,
} from "back-end/src/enterprise/services/product-analytics-discovery";
import { aiTool } from "back-end/src/enterprise/services/ai";
import type { ConversationBuffer } from "back-end/src/enterprise/services/conversation-buffer";
import {
  createAgentHandler,
  type AgentConfig,
  type SkillLoadResult,
} from "back-end/src/enterprise/services/agent-handler";
import {
  buildAgentApiTools,
  loadSkillResult,
} from "back-end/src/agent/shared-tools";
import { getSkillNamesForGroup, readSkill } from "back-end/src/agent/skills";
import {
  getFactTable,
  getFactTablesForDatasource,
  getAllFactTablesForOrganization,
} from "back-end/src/models/FactTableModel";
import { getMetricById } from "back-end/src/models/MetricModel";

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

<dashboards>
Building or editing a dashboard is a different job from building a chart, and it does NOT use the chart tools above.

1. Settle the brief. You MUST have a name for the dashboard — if the user hasn't given one, call \`askUser\` (or ask in one short sentence) and stop. Everything else has a default: take it, and say what you assumed.
2. \`loadSkill('dashboards')\` — read the router, then the leaf it points to (\`dashboard-create\` or \`dashboard-edit\`).
3. \`proposeDashboard\` — once, with every block. The server runs each query, lays out the grid, and shows the user a live preview with a Save button.

The skill carries the rules. Two that apply before you have read it:
- Do NOT call \`runExploration\` for a dashboard — each call renders its own chart card. Pass the configs to \`proposeDashboard\`.
- After \`proposeDashboard\` returns, stop: one short sentence naming what's on it.

\`loadSkill\` here only resolves the dashboard skills; there is nothing else to load.
</dashboards>

<tools>
Beyond the chart tools, you have:

- \`loadSkill\` — read a dashboard workflow. See <dashboards>.
- \`proposeDashboard\` — build or revise a dashboard. See <dashboards>.
- \`callApi\` — call the GrowthBook REST API: { method, path (full, including version), query?, body?, summary? }. The response is { status, body }; treat 2xx as success. Only call paths documented in a skill you have loaded — never invent one. On a write, pass \`summary\`: one line naming what changes in the user's terms, because it is the only thing they read before approving, and the request body is collapsed. Writes are gated for confirmation automatically — just issue the call; do not ask permission first.
- \`askUser\` — ask a multiple-choice question and stop, when the request is genuinely ambiguous and no sensible default exists. Emit no text after it; the reply arrives as the next message.
</tools>

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
Only use dimensionType 'dynamic' or 'static'. Never use 'slice'.
'dynamic' shows the top N values for a column — set maxValues (1–20, default 5). Use this for an open-ended "break down by X" request.
'static' pins a fixed list of column values (1–20, set via values) — rows whose column value isn't in the list are dropped (no top-N/'other' bucket). Use this when the user names specific values to compare (e.g. "compare US vs UK vs Canada"). Always call getColumnValues first to confirm the real values before setting them — never guess.
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
- metric: always set unit to userIdTypes[0] for standard metric types (mean, proportion, retention, dailyParticipation). The backend requires a unit to emit the denominator needed for per-unit rendering. For ratio and quantile metrics, leave unit null (they handle units internally).
- denominatorUnit: always null.

If you omit unit on a standard metric, the backend will fill in userIdTypes[0] automatically and return a configNormalized warning. Prefer setting it explicitly.
</unit_rules>

<show_as_rules>
showAs is an optional top-level field that toggles how numeric values are rendered: "total" shows the raw numerator, "per_unit" divides by the unit count (e.g. avg per user).

DEFAULT: Omit showAs in almost all cases. The UI infers a sensible default from the selected metrics — totals for most datasets, per-unit only for mean metrics whose aggregation makes totals incoherent (max, count distinct).

SET showAs explicitly ONLY when the user's request clearly asks for one view:
- "per user", "per device", "average per X", "rate" → "per_unit"
- "total X", "sum of X", "how much X did we have" → "total"

showAs has no effect on these dataset types — do not set it:
- fact_table / data_source datasets (always renders as the raw value)
- metric datasets where every value is a proportion, retention, dailyParticipation, ratio, or quantile metric (the toggle is hidden in the UI because per-unit is either degenerate or self-contained)

Set showAs only when at least one value is a mean metric.
</show_as_rules>

<value_column_rules>
For fact_table values:
- valueType "count": valueColumn must be null.
- valueType "unit_count": valueColumn must be null.
- valueType "sum": valueColumn must be a numeric column from getAvailableColumns.
</value_column_rules>

<row_filter_rules>
rowFilters shape: { operator, column, values }
Common operators: "=", "!=", "in", "not_in", "contains", "not_contains", "starts_with", "ends_with", "is_null", "not_null".
For date columns only, "between" and "not_between" take exactly two values (a lower and an upper bound); "!=" and "is_null" are not offered for date columns.
CRITICAL — never guess column values for filters. Always call getColumnValues first. Pass a searchTerm for partial matches (e.g. 'US' to find 'United States').
getColumnValues only works on string-typed columns.
</row_filter_rules>

<date_range_rules>
"last14Days" is NOT a valid predefined value. For 14 days use: { predefined: "customLookback", lookbackValue: 14, lookbackUnit: "day" }.
Valid predefined values: ${dateRangePredefined.map((v) => `"${v}"`).join(", ")}.
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

resultCsv column conventions (so you describe the same numbers the user sees on the chart):
- Standard metric columns: one value column per metric. The header tells you the mode — "<name>" means raw totals, "<name> per <unit>" means per-unit averages (the value is numerator/denominator). Report the numbers in the header's mode.
- Ratio metric columns: three columns — "<name> Numerator", "<name> Denominator", "<name> Value" (= N/D). Ratio metrics always render as N/D.
- The column headers reflect the effective showAs (explicit if you set it, otherwise the UI-inferred default). Never assume a different mode than what the header says.
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
    "A user message may begin with an auto-injected line of the form\n" +
    "  [Referenced by the user: Revenue (factMetric: fact__xyz), Growth KPIs (dashboard: dash_abc)]\n" +
    "The chat UI adds it when the user @-mentioned entities in the composer — it is " +
    "not something they typed, so do not echo it. It maps each `@Name` already in " +
    "their text to the exact id they picked, so use those ids directly rather than " +
    "calling search to re-resolve the name. An entry marked STALE was picked under a " +
    "different datasource and is not usable here — say so, name it, and ask the user " +
    "to re-pick it rather than searching for a replacement.\n" +
    "A `dashboard:` entry is the dashboard the user wants worked on — pass its id as " +
    "`dashboardId` to `proposeDashboard` so saving updates it instead of creating a " +
    "second one, and do not list or search dashboards to find it. Dashboards are not " +
    "scoped to a datasource, so one is never STALE.\n\n" +
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
    "Top-level: { type, datasource, chartType, dateRange, dimensions, dataset, showAs? }",
    'type: "metric" | "fact_table"',
    'chartType: "line" | "area" | "timeseries-table" | "table" | "bar" | "stackedBar" | "horizontalBar" | "stackedHorizontalBar" | "bigNumber"',
    "dateRange: { predefined, lookbackValue?, lookbackUnit?, startDate?, endDate? }",
    '  lookbackUnit: "hour" | "day" | "week" | "month"',
    "dimensions: array of dimension objects:",
    "  date: { dimensionType: 'date', column: null, dateGranularity: 'auto'|'hour'|'day'|'week'|'month'|'year' }",
    "  dynamic: { dimensionType: 'dynamic', column: string, maxValues: number (1-20) }",
    "  static: { dimensionType: 'static', column: string, values: string[] (1-20) }",
    'dataset for type="metric": { type: "metric", values: [{ type: "metric", name, metricId, unit, denominatorUnit, rowFilters }] }',
    'dataset for type="fact_table": { type: "fact_table", factTableId, values: [{ type: "fact_table", name, valueType: "unit_count"|"count"|"sum", valueColumn, unit, rowFilters }] }',
    'rowFilters: [{ operator: "="|"!="|"in"|"not_in"|"contains"|"not_contains"|"starts_with"|"ends_with"|"is_null"|"not_null", column: string, values: string[] }]',
    'showAs (optional): "total" | "per_unit" — chart-level toggle between raw totals and per-unit averages for mean metrics. Omit to use the smart default (see show_as_rules).',
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
    if (curr.dataset?.type === "funnel") {
      const stepNames = curr.dataset.steps?.map((s) => s.name).filter(Boolean);
      if (stepNames?.length) {
        parts.push(`steps: ${stepNames.join(", ")}`);
      }
    } else {
      const valueNames = curr.dataset?.values
        ?.map((v) => v.name)
        .filter(Boolean);
      if (valueNames?.length) {
        parts.push(`values: ${valueNames.join(", ")}`);
      }
    }
    if (curr.showAs) {
      parts.push(`showAs: ${curr.showAs}`);
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

  // Funnels carry "steps"; everything else carries "values". Diff whichever
  // shape applies; treat shape change as a coarse "dataset changed".
  if (prev.dataset?.type === "funnel" && curr.dataset?.type === "funnel") {
    const prevSteps = prev.dataset.steps.map((s) => s.name);
    const currSteps = curr.dataset.steps.map((s) => s.name);
    const added = currSteps.filter((n) => !prevSteps.includes(n));
    const removed = prevSteps.filter((n) => !currSteps.includes(n));
    if (added.length) parts.push(`added steps: ${added.join(", ")}`);
    if (removed.length) parts.push(`removed steps: ${removed.join(", ")}`);
  } else if (
    prev.dataset?.type !== "funnel" &&
    curr.dataset?.type !== "funnel"
  ) {
    const prevNames = prev.dataset?.values?.map((v) => v.name) ?? [];
    const currNames = curr.dataset?.values?.map((v) => v.name) ?? [];
    const added = currNames.filter((n) => !prevNames.includes(n));
    const removed = prevNames.filter((n) => !currNames.includes(n));
    if (added.length) parts.push(`added: ${added.join(", ")}`);
    if (removed.length) parts.push(`removed: ${removed.join(", ")}`);
  } else if (prev.dataset?.type !== curr.dataset?.type) {
    parts.push(`dataset type: ${prev.dataset?.type} → ${curr.dataset?.type}`);
  }

  const prevDims = prev.dimensions?.length ?? 0;
  const currDims = curr.dimensions?.length ?? 0;
  if (prevDims !== currDims) {
    parts.push(`dimensions: ${prevDims} → ${currDims}`);
  }

  if (prev.datasource !== curr.datasource) {
    parts.push("datasource changed");
  }

  if ((prev.showAs ?? null) !== (curr.showAs ?? null)) {
    parts.push(
      `showAs: ${prev.showAs ?? "inferred"} → ${curr.showAs ?? "inferred"}`,
    );
  }

  return parts.length ? parts.join(", ") : "minor config update";
}

/**
 * Serialize exploration result rows into a CSV for the agent. Column schema
 * and per-cell value selection are produced by the shared helpers that also
 * drive the Explorer result table, so the agent always sees the same columns
 * and the same numbers the user sees on screen.
 *
 * Display-layer concerns (number precision, date formatting, the "Total"
 * dimension fallback) are handled here — each surface is free to format how
 * it prefers, but the underlying column set and cell values are identical.
 */
function buildResultCsv(
  rows: ProductAnalyticsResultRow[],
  config: ExplorationConfig | null,
  getFactMetricById: (id: string) => FactMetricInterface | null,
): string | null {
  if (!rows.length || !config) return null;

  const columns = buildExplorationColumns(config, getFactMetricById);
  if (columns.length === 0) return null;

  const renderOpts = {
    showAs: getEffectiveShowAs(config, getFactMetricById),
    isRatioByIndex: getIsRatioByIndex(config, getFactMetricById),
  };

  const hasNoDimensions = !config.dimensions || config.dimensions.length === 0;

  const escape = (c: string): string =>
    c.includes('"') || c.includes(",") || c.includes("\n")
      ? `"${c.replace(/"/g, '""')}"`
      : c;

  const formatCell = (
    raw: string | number | null,
    col: (typeof columns)[number],
  ): string => {
    if (col.kind === "dimension") {
      if (raw == null || raw === "") return hasNoDimensions ? "Total" : "";
      return typeof raw === "number" ? String(raw) : raw;
    }
    if (raw == null) return "";
    if (col.sub === "numerator" || col.sub === "denominator") {
      return typeof raw === "number" ? String(raw) : String(raw);
    }
    // value (ratio) and single: 4dp for ratios/per-unit, integer for totals.
    if (typeof raw === "number") {
      const isRatioOrPerUnit =
        col.sub === "value" ||
        (col.sub === "single" && renderOpts.isRatioByIndex[col.metricIndex]) ||
        (col.sub === "single" && renderOpts.showAs === "per_unit");
      return isRatioOrPerUnit ? raw.toFixed(4) : String(raw);
    }
    return String(raw);
  };

  const header = columns.map((c) => escape(c.label)).join(",");

  const truncated = rows.slice(0, MAX_RESULT_ROWS);
  const dataLines = truncated.map((row) =>
    columns
      .map((col) => {
        const raw = getExplorationCellValue(row, col, renderOpts);
        return escape(formatCell(raw, col));
      })
      .join(","),
  );

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
  /**
   * Metric resolver derived from the metrics already fetched during
   * normalization. Reused by the CSV writer so we don't reload metrics.
   * Returns null for metric IDs not referenced by this config.
   */
  getFactMetricById: (id: string) => FactMetricInterface | null;
}

async function normalizeConfigForExplorer(
  ctx: ReqContext,
  config: ExplorationConfig,
): Promise<NormalizeResult> {
  const warnings: string[] = [];
  let dims = config.dimensions;
  let dataset = config.dataset;

  // Drop slice dimensions — the agent isn't equipped to author them.
  const hadSlice = dims.some((d) => d.dimensionType === "slice");
  dims = dims.filter((d) => d.dimensionType !== "slice");
  if (hadSlice) {
    warnings.push(
      "Slice dimensions are not supported and were removed. Only use dimensionType 'dynamic' or 'static'.",
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

  // Funnel datasets have a different structure (steps instead of values)
  // and the AI agent isn't equipped to produce them. The bigNumber / value
  // count constraints below assume a `values` array, so we skip them for
  // funnels — the front-end already enforces funnel-specific limits.
  if (dataset.type !== "funnel") {
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
  }

  // Load every referenced fact metric once. This map serves both the unit
  // backfill below and the CSV writer downstream — no second round-trip.
  const referencedMetricIds =
    dataset.type === "metric"
      ? Array.from(
          new Set(
            dataset.values
              .map((v) => v.metricId)
              .filter((id): id is string => !!id),
          ),
        )
      : [];
  const referencedMetrics = referencedMetricIds.length
    ? await ctx.models.factMetrics.getByIds(referencedMetricIds)
    : [];
  const metricById = new Map(referencedMetrics.map((m) => [m.id, m]));
  const getFactMetricByIdResolver = (id: string) => metricById.get(id) ?? null;

  // Backfill missing units for metric values so the SQL layer emits a
  // denominator and per_unit rendering works. The agent often omits `unit`
  // even when it should be set; default to the numerator fact table's primary
  // userIdType. Only applies to metric datasets — fact_table/data_source
  // datasets have user-driven unit semantics.
  if (dataset.type === "metric") {
    const needsUnit = dataset.values.some(
      (v) => !v.unit && v.metricId && metricById.has(v.metricId),
    );

    if (needsUnit) {
      const factTableIds = Array.from(
        new Set(
          dataset.values
            .filter((v) => !v.unit && v.metricId)
            .map((v) => metricById.get(v.metricId!)?.numerator?.factTableId)
            .filter((id): id is string => !!id),
        ),
      );
      const factTables = await Promise.all(
        factTableIds.map((id) => getFactTable(ctx, id)),
      );
      const factTableById = new Map(
        factTables
          .filter((ft): ft is FactTableInterface => !!ft)
          .map((ft) => [ft.id, ft]),
      );

      let filledCount = 0;
      const newValues = dataset.values.map((v) => {
        if (v.unit || !v.metricId) return v;
        const metric = metricById.get(v.metricId);
        if (!metric) return v;
        const factTable = factTableById.get(
          metric.numerator?.factTableId ?? "",
        );
        const defaultUnit = factTable?.userIdTypes?.[0];
        if (!defaultUnit) return v;
        filledCount++;
        return { ...v, unit: defaultUnit };
      });

      if (filledCount > 0) {
        dataset = { ...dataset, values: newValues } as typeof dataset;
        warnings.push(
          `Filled in default unit (userIdTypes[0] from the metric's fact table) for ${filledCount} metric value(s) where unit was missing. Set unit explicitly for standard metrics (mean, proportion, retention, dailyParticipation) to avoid this.`,
        );
      }
    }
  }

  let normalized = {
    ...config,
    dimensions: dims,
    dataset,
  } as ExplorationConfig;

  // Strip `showAs` when the current dataset doesn't support it, so we never
  // persist a value that disagrees with what the chart will actually render.
  const beforeShowAs = normalized.showAs;
  normalized = clearInapplicableShowAs(normalized, getFactMetricByIdResolver);
  if (beforeShowAs !== undefined && normalized.showAs === undefined) {
    warnings.push(
      `Dropped showAs="${beforeShowAs}" — it doesn't apply to this dataset (only meaningful for mean metrics). The chart will render totals.`,
    );
  }

  return {
    config: normalized,
    warnings,
    getFactMetricById: getFactMetricByIdResolver,
  };
}

// Match the frontend's polling cadence and ~10-minute cutoff.
function explorationPollDelayMs(elapsedMs: number): number {
  if (elapsedMs < 10_000) return 2_000;
  if (elapsedMs < 30_000) return 3_000;
  if (elapsedMs < 60_000) return 5_000;
  if (elapsedMs < 300_000) return 10_000;
  if (elapsedMs < 600_000) return 20_000;
  return 0;
}

async function pollExplorationUntilFinished(
  ctx: ReqContext,
  exploration: ProductAnalyticsExploration,
  startedAt: number,
  abortSignal?: AbortSignal,
): Promise<ProductAnalyticsExploration> {
  let latest = exploration;
  while (latest.status === "running") {
    const pollDelay = explorationPollDelayMs(Date.now() - startedAt);
    if (pollDelay === 0) break;

    await delay(pollDelay, undefined, {
      signal: abortSignal,
      ref: false,
    });

    const polled = await ctx.models.analyticsExplorations.getById(latest.id);
    if (!polled) {
      throw new Error("Product analytics exploration not found");
    }
    latest = polled;
  }
  return latest;
}

async function executeRunExploration(
  ctx: ReqContext,
  buffer: ConversationBuffer,
  rawConfig: ExplorationConfig,
  abortSignal?: AbortSignal,
): Promise<RunExplorationToolResult> {
  try {
    const { config, warnings, getFactMetricById } =
      await normalizeConfigForExplorer(ctx, rawConfig);

    const startedAt = Date.now();
    const initialExploration = await runProductAnalyticsExploration(
      ctx,
      config,
      {
        cache: "preferred",
      },
    );
    const exploration =
      initialExploration?.status === "running"
        ? await pollExplorationUntilFinished(
            ctx,
            initialExploration,
            startedAt,
            abortSignal,
          )
        : initialExploration;

    if (exploration?.status === "error") {
      return {
        status: "error",
        message: exploration.error ?? "The query failed with an unknown error",
      };
    }

    if (exploration?.status === "running") {
      return {
        status: "error",
        message:
          "The warehouse query is still running after waiting. Do NOT assume there is no data or that the fact table, filters, or date range are wrong. Tell the user the query is taking longer than expected and they can retry shortly.",
      };
    }

    const prevConfig = explorationConfigFromLatestRun(
      buffer.getLatestToolResult("runExploration"),
    );
    const summary = buildSnapshotSummary(prevConfig, config);
    const resultCsv = buildResultCsv(
      exploration?.result?.rows ?? [],
      config,
      getFactMetricById,
    );

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

const columnSourceFields = {
  source: z
    .enum(productAnalyticsColumnSources)
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
  "Waits for the warehouse query to finish before returning. " +
  "The chart will be automatically displayed to the user after execution. " +
  "Returns config (the normalized config used), resultCsv (CSV of the results for analysis), rowCount, snapshotId, and summary. " +
  "Use config and resultCsv for analysis and follow-up modifications. Ignore the exploration field (internal use). " +
  "Call getSnapshot only for older or compacted snapshots.";

const proposeDashboardInputSchema = z.object({
  title: z
    .string()
    .min(1)
    .max(200)
    .optional()
    .describe(
      "The dashboard's name, as the user gave it. Ask for it before calling this if they haven't said. " +
        "Omit only when loading a saved dashboard, which brings its own.",
    ),
  dashboardId: z
    .string()
    .optional()
    .describe(
      "Only when revising a dashboard that is already saved. Omit for a new one — " +
        "a dashboard you proposed but the user has not saved yet does not have an " +
        "id, so revising it means calling again with no dashboardId.",
    ),
  projects: z
    .string()
    .array()
    .optional()
    .describe(
      "Project ids the dashboard belongs to; `[]` means every project. " +
        "Ask the user which project when the organization has more than one, " +
        "since moving a dashboard afterwards means editing it by hand. " +
        "Omit only when you could not establish it.",
    ),
  globalControls: dashboardGlobalControlsValidator
    .optional()
    .describe(
      "Dashboard-wide filter bar: dateRange, dateGranularity, and (for experimentation blocks) projects and experimentSearchString.",
    ),
  comparison: blockComparisonValidator
    .optional()
    .describe(
      'Dashboard-wide compare-to-previous-period, e.g. { enabled: true, mode: "previousPeriod" }. ' +
        "Use this when the user wants the whole dashboard compared against a prior window, " +
        "rather than setting `comparison` on individual blocks.",
    ),
  blocks: proposeDashboardBlockValidator
    .array()
    .min(1)
    .max(20)
    .optional()
    .describe(
      "The blocks, in reading order. Chart blocks carry only their `config` — the server runs each query and wires up the result, so do not run the charts yourself first. " +
        "Omit entirely, with `dashboardId` set, to load a saved dashboard as-is.",
    ),
});

const PROPOSE_DASHBOARD_DESCRIPTION =
  "Propose a dashboard and show it to the user as a live, laid-out preview with " +
  "a Save button. This is the ONLY way to build or revise a dashboard — do not " +
  "run the charts with runExploration first, and do not POST to the dashboards " +
  "API. The server runs every query, arranges the grid, and renders the result. " +
  "The user can rearrange, resize, and delete tiles in the preview, then save. " +
  "To put a dashboard that already exists in front of them unchanged, pass only " +
  "`dashboardId` and no `blocks`: the server loads it exactly as saved, keeping " +
  "its layout, and runs nothing. Do that before any edit you were asked to make " +
  "blind. After calling this, stop and let them look at it.";

const GET_SNAPSHOT_DESCRIPTION =
  "Retrieve configuration and result CSV for a snapshot by snapshotId from conversation history. " +
  "Prefer using the runExploration return value (especially resultCsv) for the run you just executed. " +
  "Use getSnapshot when tool results for that snapshot are compacted or missing from the visible conversation, or when the user points to an older snapshotId.";

interface PAParams {
  datasourceId: string;
}

async function mentionDatasource(
  ctx: ReqContext,
  mention: AIChatMention,
): Promise<string | undefined> {
  // Callers filter these out first; guarded here so a dashboard can never be
  // read as a metric with a missing datasource, which would mark it stale.
  if (mention.type === "dashboard") return undefined;
  if (mention.type === "factMetric") {
    return (await ctx.models.factMetrics.getById(mention.id))?.datasource;
  }
  if (mention.type === "metricGroup") {
    return (await ctx.models.metricGroups.getById(mention.id))?.datasource;
  }
  return (await getMetricById(ctx, mention.id))?.datasource;
}

async function resolveProductAnalyticsMentions(
  ctx: ReqContext,
  mentions: AIChatMention[],
  datasourceId: string,
): Promise<AIChatMention[]> {
  if (!datasourceId) return mentions;

  return Promise.all(
    mentions.map(async (mention) => {
      // A dashboard is not scoped to a datasource, so there is nothing for it
      // to be stale against — it stays usable whichever one the chat is on.
      if (mention.type === "dashboard") return mention;

      const datasource = await mentionDatasource(ctx, mention);
      return datasource === datasourceId
        ? mention
        : { ...mention, stale: true };
    }),
  );
}

// Scoped on the resolver, not just the `/` menu, so the model cannot reach
// another domain's endpoints even if it guesses the skill name.
function productAnalyticsSkillNames(): string[] {
  return getSkillNamesForGroup(PRODUCT_ANALYTICS_CHAT_SKILL_GROUP);
}

function resolveProductAnalyticsSkill(
  name: string,
): SkillLoadResult | undefined {
  // Resolve first, then gate on the group. An exact-name allowlist would reject
  // the bare workflow names the router's table and this prompt both hand out
  // (`dashboard-create`, not `dashboards/references/dashboard-create`).
  const skill = readSkill(name);
  if (skill?.group !== PRODUCT_ANALYTICS_CHAT_SKILL_GROUP) return undefined;
  return loadSkillResult(skill.name);
}

const productAnalyticsAgentConfig: AgentConfig<PAParams> = {
  agentType: "product-analytics",
  promptType: "product-analytics-chat",

  parseParams: (body) => ({
    datasourceId: (body.datasourceId as string) ?? "",
  }),

  buildSystemPrompt: (ctx, { datasourceId }) =>
    buildProductAnalyticsSystemPrompt(ctx, datasourceId),

  resolveMentions: (ctx, mentions, { datasourceId }) =>
    resolveProductAnalyticsMentions(ctx, mentions, datasourceId),

  resolveSkill: resolveProductAnalyticsSkill,

  buildTools: (ctx, buffer, { datasourceId }, emit) => {
    // Memoized for the whole turn: a chat turn searches several times and each
    // miss refetches every metric in the org.
    const searchLoaders = createProductAnalyticsSearchLoaders(
      ctx,
      datasourceId,
    );

    return {
      // What lets this chat go on to save its charts as a dashboard.
      ...buildAgentApiTools(ctx, buffer, emit, {
        resolveSkill: resolveProductAnalyticsSkill,
        availableSkillNames: productAnalyticsSkillNames,
      }),

      search: aiTool({
        description: SEARCH_DESCRIPTION,
        inputSchema: searchInputSchema,
        execute: async (input) =>
          discoveryResultToToolString(
            await runProductAnalyticsSearch(searchLoaders, input),
          ),
      }),

      getAvailableColumns: aiTool({
        description: GET_AVAILABLE_COLUMNS_DESCRIPTION,
        inputSchema: getAvailableColumnsInputSchema,
        execute: async (input) =>
          discoveryResultToToolString(
            await getProductAnalyticsColumns(ctx, input),
          ),
      }),

      getColumnValues: aiTool({
        description: GET_COLUMN_VALUES_DESCRIPTION,
        inputSchema: getColumnValuesInputSchema,
        execute: async (input) =>
          discoveryResultToToolString(
            await getProductAnalyticsColumnValues(ctx, input),
          ),
      }),

      runExploration: aiTool({
        description: RUN_EXPLORATION_DESCRIPTION,
        inputSchema: runExplorationInputSchema,
        execute: ({ config }, { abortSignal }) =>
          executeRunExploration(ctx, buffer, config, abortSignal),
      }),

      proposeDashboard: aiTool({
        description: PROPOSE_DASHBOARD_DESCRIPTION,
        inputSchema: proposeDashboardInputSchema,
        execute: async (input) => {
          const { blocks, dashboardId, title, ...rest } = input;
          const meta = { ...rest, ...(dashboardId ? { dashboardId } : {}) };

          // Checked here, not in the schema, so a wrong call gets a usable sentence.
          let draftInput: BuildDashboardDraftInput;
          if (blocks) {
            if (!title) {
              return {
                status: "error" as const,
                message:
                  "`title` is required when proposing blocks. Ask the user what to " +
                  "call the dashboard, then call again.",
              };
            }
            draftInput = { ...meta, title, blocks };
          } else if (dashboardId) {
            draftInput = { ...meta, dashboardId, title };
          } else {
            return {
              status: "error" as const,
              message:
                "Pass `blocks` to propose a dashboard, or `dashboardId` on its own to " +
                "load one that already exists.",
            };
          }

          const { draft, droppedBlocks, error } = await buildDashboardDraft(
            ctx,
            draftInput,
          );
          if (error || !draft.blocks.length) {
            return {
              status: "error" as const,
              message:
                error ??
                "None of the proposed blocks could be built. Check the metric ids and " +
                  "date range, then try again — do not present this as a finished dashboard.",
              droppedBlocks,
            };
          }
          // The draft rides in the tool result rather than an SSE event so the
          // preview re-renders from the transcript after a reload.
          return {
            status: "shown" as const,
            message:
              "Dashboard preview shown to the user with a Save button. Stop now — " +
              "describe it in one short sentence and let them review it. Do not save it yourself.",
            draft,
            ...(droppedBlocks.length ? { droppedBlocks } : {}),
          };
        },
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
