import {
  ColumnInterface,
  FactMetricInterface,
  FactTableInterface,
} from "shared/types/fact-table";
import type { ReqContext } from "back-end/types/request";
import {
  getFactTable,
  getFactTablesForDatasource,
  getAllFactTablesForOrganization,
} from "back-end/src/models/FactTableModel";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import { runColumnsTopValuesQuery } from "back-end/src/services/factTableColumns";

// The three lookups before an exploration.

/** Which selection the columns hang off; the chat tools' enum is built from it. */
export const productAnalyticsColumnSources = ["fact_table", "metric"] as const;
export type ProductAnalyticsColumnSource =
  (typeof productAnalyticsColumnSources)[number];

/** Failure is a value, not a throw: the chat tool wants a sentence, REST wants a 4xx. */
export type ProductAnalyticsDiscoveryResult =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; message: string };

const ok = (
  data: Record<string, unknown>,
): ProductAnalyticsDiscoveryResult => ({
  ok: true,
  data,
});
const fail = (message: string): ProductAnalyticsDiscoveryResult => ({
  ok: false,
  message,
});

export interface ProductAnalyticsSearchInput {
  query: string;
  limit: number;
  skip: number;
}

export interface ProductAnalyticsColumnsInput {
  source: ProductAnalyticsColumnSource;
  factTableId?: string;
  metricIds?: string[];
}

export interface ProductAnalyticsColumnValuesInput
  extends ProductAnalyticsColumnsInput {
  columns: string[];
  searchTerm?: string;
  limit: number;
}

// =============================================================================
// search
// =============================================================================

/** Light singularization so "page views" matches "Page View". A heuristic, not a stemmer. */
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

/** The query, normalized once per search rather than once per candidate. */
interface SearchQuery {
  q: string;
  qNorm: string;
  tokens: string[];
  tokensNorm: string[];
}

function parseSearchQuery(query: string): SearchQuery {
  const q = query.trim().toLowerCase();
  const tokens = q.split(/\s+/).filter(Boolean);
  return {
    q,
    qNorm: normalizeForSearch(q),
    tokens,
    tokensNorm: tokens.map(singularizeWord),
  };
}

/** Exact name/id 10, full substring 5, +1 per matching token; 0 means no match. */
function scoreSearch(
  { q, qNorm, tokens, tokensNorm }: SearchQuery,
  haystackParts: string[],
  name: string,
  id: string,
): number {
  const nameLower = name.toLowerCase();
  const idLower = id.toLowerCase();
  if (
    nameLower === q ||
    idLower === q ||
    normalizeForSearch(nameLower) === qNorm
  ) {
    return 10;
  }

  const haystack = haystackParts.join(" ").toLowerCase();
  const haystackNorm = normalizeForSearch(haystack);
  let score = haystack.includes(q) || haystackNorm.includes(qNorm) ? 5 : 0;

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

export interface ProductAnalyticsSearchLoaders {
  getMetrics: () => Promise<FactMetricInterface[]>;
  getFactTables: () => Promise<FactTableInterface[]>;
}

/** Memoized: a turn searches several times and each miss refetches every metric. */
export function createProductAnalyticsSearchLoaders(
  ctx: ReqContext,
  datasourceId?: string,
): ProductAnalyticsSearchLoaders {
  let metricsCache: FactMetricInterface[] | null = null;
  let factTablesCache: FactTableInterface[] | null = null;

  return {
    getMetrics: async () => {
      if (metricsCache) return metricsCache;
      const all = await ctx.models.factMetrics.getAll();
      metricsCache = datasourceId
        ? all.filter((m) => m.datasource === datasourceId)
        : all;
      return metricsCache;
    },
    getFactTables: async () => {
      if (factTablesCache) return factTablesCache;
      factTablesCache = datasourceId
        ? await getFactTablesForDatasource(ctx, datasourceId)
        : await getAllFactTablesForOrganization(ctx);
      return factTablesCache;
    },
  };
}

type ScoredResult = { score: number; name: string; result: unknown };

/** Scores one kind of candidate. A blank query keeps everything, unscored. */
function collectMatches<T>(
  items: T[],
  search: SearchQuery | null,
  toResult: (item: T) => { id: string; name: string } & Record<string, unknown>,
  toHaystack: (item: T) => string[],
): ScoredResult[] {
  const out: ScoredResult[] = [];
  for (const item of items) {
    const result = toResult(item);
    if (!search) {
      out.push({ score: 0, name: result.name, result });
      continue;
    }
    const score = scoreSearch(search, toHaystack(item), result.name, result.id);
    if (score > 0) out.push({ score, name: result.name, result });
  }
  return out;
}

export async function runProductAnalyticsSearch(
  { getMetrics, getFactTables }: ProductAnalyticsSearchLoaders,
  input: ProductAnalyticsSearchInput,
): Promise<ProductAnalyticsDiscoveryResult> {
  const { query, limit, skip } = input;
  const parsed = parseSearchQuery(query);
  const isBlank = parsed.q.length === 0;
  const search = isBlank ? null : parsed;

  const metrics = await getMetrics();
  const factTables = await getFactTables();

  const all = [
    ...collectMatches(
      metrics,
      search,
      (m) => ({
        kind: "metric" as const,
        explorerType: "metric" as const,
        id: m.id,
        name: m.name,
        type: m.metricType,
        official: m.managedBy === "admin",
        description: m.description ?? null,
        owner: m.owner ?? null,
        tags: m.tags ?? [],
      }),
      (m) => [
        m.id,
        m.name,
        m.description ?? "",
        m.owner ?? "",
        ...(m.tags ?? []),
      ],
    ),
    ...collectMatches(
      factTables,
      search,
      (ft) => ({
        kind: "fact_table" as const,
        explorerType: "fact_table" as const,
        id: ft.id,
        name: ft.name,
        official: ft.managedBy === "admin",
        eventName: ft.eventName ?? null,
        columnCount: (ft.columns ?? []).filter((c) => !c.deleted).length,
      }),
      (ft) => [ft.id, ft.name, ft.eventName ?? ""],
    ),
  ];

  const sorted = isBlank
    ? all.sort((a, b) => a.name.localeCompare(b.name))
    : all.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));

  const totalMatches = sorted.length;
  const matches = sorted.slice(skip, skip + limit).map((x) => x.result);

  if (!matches.length) {
    return ok({
      matches: [],
      totalMetrics: metrics.length,
      totalFactTables: factTables.length,
      totalMatches: 0,
      ...(isBlank ? {} : { message: `No results found for "${query}".` }),
    });
  }
  return ok({
    matches,
    totalMetrics: metrics.length,
    totalFactTables: factTables.length,
    totalMatches,
    skip,
    limit,
  });
}

// =============================================================================
// columns
// =============================================================================

/** Columns a caller can actually use — a deleted column is still on the doc. */
function liveColumns(ft: FactTableInterface | null): ColumnInterface[] {
  return (ft?.columns ?? []).filter((c) => !c.deleted);
}

/** Column list as the lookups report it: by display name, minimal fields. */
function toColumnSummaries(columns: ColumnInterface[]) {
  return [...columns]
    .sort((a, b) => (a.name || a.column).localeCompare(b.name || b.column))
    .map((c) => ({ column: c.column, name: c.name, datatype: c.datatype }));
}

/** Named directly, or behind the first metric that has one. */
async function resolveSourceFactTable(
  ctx: ReqContext,
  input: ProductAnalyticsColumnsInput,
): Promise<
  { ok: true; factTable: FactTableInterface } | { ok: false; message: string }
> {
  if (input.source === "fact_table") {
    const { factTableId } = input;
    if (!factTableId) {
      return {
        ok: false,
        message: "factTableId is required for fact_table source.",
      };
    }
    const ft = await getFactTable(ctx, factTableId);
    if (!ft) {
      return { ok: false, message: `Fact table "${factTableId}" not found.` };
    }
    return { ok: true, factTable: ft };
  }

  const { metricIds } = input;
  if (!metricIds?.length) {
    return { ok: false, message: "metricIds is required for metric source." };
  }
  const metrics = await ctx.models.factMetrics.getByIds(metricIds);
  const factTableId = metrics.find((m) => m.numerator?.factTableId)?.numerator
    ?.factTableId;
  if (!factTableId) {
    return {
      ok: false,
      message: "Could not resolve a fact table from the provided metric IDs.",
    };
  }
  const ft = await getFactTable(ctx, factTableId);
  if (!ft) return { ok: false, message: `Fact table not found.` };
  return { ok: true, factTable: ft };
}

export async function getProductAnalyticsColumns(
  ctx: ReqContext,
  input: ProductAnalyticsColumnsInput,
): Promise<ProductAnalyticsDiscoveryResult> {
  switch (input.source) {
    case "fact_table": {
      const resolved = await resolveSourceFactTable(ctx, input);
      if (!resolved.ok) return fail(resolved.message);
      const ft = resolved.factTable;
      return ok({
        columns: toColumnSummaries(liveColumns(ft)),
        userIdTypes: ft.userIdTypes ?? [],
        unitNote: ft.userIdTypes?.length
          ? `For valueType "unit_count", set unit to one of userIdTypes (default: "${ft.userIdTypes[0]}"). For "count" or "sum", set unit to null.`
          : 'No userIdTypes configured — use valueType "count" or "sum" only; set unit to null.',
      });
    }

    case "metric": {
      const { metricIds } = input;
      if (!metricIds?.length) {
        return fail("metricIds is required for metric source.");
      }
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
            .map((m) => m.numerator?.factTableId)
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
            m.numerator?.column === "$$distinctUsers");

        metricUnitInfo.push({
          metricId: m.id,
          metricType: m.metricType,
          needsUnit,
        });

        if (!m.numerator?.factTableId) continue;
        const ft = ftMap.get(m.numerator.factTableId) ?? null;
        if (!userIdTypes.length && ft?.userIdTypes?.length) {
          userIdTypes = ft.userIdTypes;
        }
        const ftCols = liveColumns(ft);
        if (columns === null) {
          columns = ftCols;
        } else {
          const nameSet = new Set(ftCols.map((c) => c.column));
          columns = columns.filter((c) => nameSet.has(c.column));
        }
      }

      const unitNote = userIdTypes.length
        ? `For metrics where needsUnit=true, set unit to one of userIdTypes (default: "${userIdTypes[0]}"). For others, set unit to null.`
        : "No userIdTypes found — set unit to null for all metrics.";

      return ok({
        columns: toColumnSummaries(columns ?? []),
        userIdTypes,
        metrics: metricUnitInfo,
        unitNote,
      });
    }
  }
}

// =============================================================================
// column values
// =============================================================================

export async function getProductAnalyticsColumnValues(
  ctx: ReqContext,
  input: ProductAnalyticsColumnValuesInput,
): Promise<ProductAnalyticsDiscoveryResult> {
  const { columns: requestedColumns, searchTerm, limit } = input;

  const resolved = await resolveSourceFactTable(ctx, input);
  if (!resolved.ok) return fail(resolved.message);
  const factTable = resolved.factTable;
  const availableColumns = liveColumns(factTable);

  const datasource = await getDataSourceById(ctx, factTable.datasource);
  if (!datasource) return fail(`Datasource not found.`);

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
      colsToQuery.push(found);
    }
  }

  const warnings: string[] = [];
  if (nonStringCols.length)
    warnings.push(`Skipped (non-string type): ${nonStringCols.join(", ")}`);
  if (notFoundCols.length)
    warnings.push(`Columns not found: ${notFoundCols.join(", ")}`);

  if (colsToQuery.length === 0) {
    return ok({
      values: {},
      ...(warnings.length ? { warnings } : {}),
    });
  }

  let rawValues: Record<string, string[]>;
  try {
    rawValues = await runColumnsTopValuesQuery(
      ctx,
      datasource,
      { sql: factTable.sql, eventName: factTable.eventName ?? "" },
      colsToQuery,
    );
  } catch (err) {
    return fail(
      `Failed to query column values on ${datasource.type}: ${
        err instanceof Error ? err.message : "Unknown error"
      }`,
    );
  }

  const values: Record<string, string[]> = {};
  for (const col of Object.keys(rawValues)) {
    let vals = rawValues[col];
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      vals = vals.filter((v) => v.toLowerCase().includes(term));
    }
    values[col] = vals.slice(0, limit);
  }

  return ok({
    values,
    ...(warnings.length ? { warnings } : {}),
  });
}

/** Indented JSON on success, a plain sentence on failure. */
export function discoveryResultToToolString(
  result: ProductAnalyticsDiscoveryResult,
): string {
  return result.ok ? JSON.stringify(result.data, null, 2) : result.message;
}
