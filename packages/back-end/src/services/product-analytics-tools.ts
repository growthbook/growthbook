import { ColumnInterface, FactTableInterface } from "shared/types/fact-table";
import type { ApiReqContext } from "back-end/types/api";
import type { ReqContext } from "back-end/types/request";
import {
  getAllFactTablesForOrganization,
  getFactTable,
  getFactTablesForDatasource,
} from "back-end/src/models/FactTableModel";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import { runColumnsTopValuesQuery } from "back-end/src/services/factTableColumns";
import { BadRequestError, NotFoundError } from "back-end/src/util/errors";

type ProductAnalyticsContext = ReqContext | ApiReqContext;

export type ProductAnalyticsMetricSearchResult = {
  kind: "metric";
  explorerType: "metric";
  id: string;
  name: string;
  type: string;
  official: boolean;
  description: string | null;
  owner: string | null;
  tags: string[];
};

export type ProductAnalyticsFactTableSearchResult = {
  kind: "fact_table";
  explorerType: "fact_table";
  id: string;
  name: string;
  official: boolean;
  eventName: string | null;
  columnCount: number;
};

export type ProductAnalyticsSearchMatch =
  | ProductAnalyticsMetricSearchResult
  | ProductAnalyticsFactTableSearchResult;

export type ProductAnalyticsSearchInput = {
  query: string;
  limit: number;
  skip: number;
  datasourceId?: string;
};

export type ProductAnalyticsSearchResult = {
  matches: ProductAnalyticsSearchMatch[];
  totalMetrics: number;
  totalFactTables: number;
  totalMatches: number;
  skip: number;
  limit: number;
};

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
  if (
    nameLower === q ||
    idLower === q ||
    normalizeForSearch(nameLower) === qNorm
  ) {
    return 10;
  }

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

export async function searchProductAnalyticsResources(
  context: ProductAnalyticsContext,
  input: ProductAnalyticsSearchInput,
): Promise<ProductAnalyticsSearchResult> {
  const { query, limit, skip, datasourceId } = input;
  if (datasourceId && !(await getDataSourceById(context, datasourceId))) {
    throw new NotFoundError("Data Source not found.");
  }

  const q = query.trim().toLowerCase();
  const isBlank = q.length === 0;
  const tokens = q.split(/\s+/).filter(Boolean);
  const qNorm = normalizeForSearch(q);
  const tokensNorm = tokens.map(singularizeWord);

  const allMetrics = await context.models.factMetrics.getAll();
  const metrics = datasourceId
    ? allMetrics.filter((metric) => metric.datasource === datasourceId)
    : allMetrics;
  const factTables = datasourceId
    ? await getFactTablesForDatasource(context, datasourceId)
    : await getAllFactTablesForOrganization(context);

  const scored: {
    score: number;
    name: string;
    result: ProductAnalyticsSearchMatch;
  }[] = [];

  for (const metric of metrics) {
    const result: ProductAnalyticsMetricSearchResult = {
      kind: "metric",
      explorerType: "metric",
      id: metric.id,
      name: metric.name,
      type: metric.metricType,
      official: metric.managedBy === "admin",
      description: metric.description ?? null,
      owner: metric.owner ?? null,
      tags: metric.tags ?? [],
    };
    if (isBlank) {
      scored.push({ score: 0, name: metric.name, result });
      continue;
    }
    const haystack = [
      metric.id,
      metric.name,
      metric.description ?? "",
      metric.owner ?? "",
      ...(metric.tags ?? []),
    ]
      .join(" ")
      .toLowerCase();
    const score = scoreSearch(
      q,
      qNorm,
      tokens,
      tokensNorm,
      haystack,
      normalizeForSearch(haystack),
      metric.name,
      metric.id,
    );
    if (score > 0) scored.push({ score, name: metric.name, result });
  }

  for (const factTable of factTables) {
    const result: ProductAnalyticsFactTableSearchResult = {
      kind: "fact_table",
      explorerType: "fact_table",
      id: factTable.id,
      name: factTable.name,
      official: factTable.managedBy === "admin",
      eventName: factTable.eventName ?? null,
      columnCount: (factTable.columns ?? []).filter((column) => !column.deleted)
        .length,
    };
    if (isBlank) {
      scored.push({ score: 0, name: factTable.name, result });
      continue;
    }
    const haystack = [factTable.id, factTable.name, factTable.eventName ?? ""]
      .join(" ")
      .toLowerCase();
    const score = scoreSearch(
      q,
      qNorm,
      tokens,
      tokensNorm,
      haystack,
      normalizeForSearch(haystack),
      factTable.name,
      factTable.id,
    );
    if (score > 0) scored.push({ score, name: factTable.name, result });
  }

  const sorted = isBlank
    ? scored.sort((a, b) => a.name.localeCompare(b.name))
    : scored.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));

  return {
    matches: sorted.slice(skip, skip + limit).map(({ result }) => result),
    totalMetrics: metrics.length,
    totalFactTables: factTables.length,
    totalMatches: sorted.length,
    skip,
    limit,
  };
}

export type ProductAnalyticsColumnsSource = "fact_table" | "metric";

export type ProductAnalyticsColumnsInput = {
  source: ProductAnalyticsColumnsSource;
  factTableId?: string;
  metricIds?: string[];
};

export type ProductAnalyticsColumn = {
  column: string;
  name: string;
  datatype: string;
};

export type ProductAnalyticsMetricUnitInfo = {
  metricId: string;
  metricType: string;
  needsUnit: boolean;
};

export type ProductAnalyticsColumnsResult = {
  columns: ProductAnalyticsColumn[];
  userIdTypes: string[];
  metrics?: ProductAnalyticsMetricUnitInfo[];
  unitNote: string;
};

async function getRequestedMetrics(
  context: ProductAnalyticsContext,
  metricIds: string[] | undefined,
) {
  if (!metricIds?.length) {
    throw new BadRequestError("metricIds is required when source is metric.");
  }
  const uniqueIds = Array.from(new Set(metricIds));
  const metrics = await context.models.factMetrics.getByIds(uniqueIds);
  if (metrics.length !== uniqueIds.length) {
    throw new NotFoundError(
      "One or more Fact Metrics were not found or are not accessible.",
    );
  }
  const datasourceIds = new Set(metrics.map((metric) => metric.datasource));
  if (datasourceIds.size > 1) {
    throw new BadRequestError(
      "All Fact Metrics must belong to the same Data Source.",
    );
  }
  return metrics;
}

export async function getProductAnalyticsColumns(
  context: ProductAnalyticsContext,
  input: ProductAnalyticsColumnsInput,
): Promise<ProductAnalyticsColumnsResult> {
  if (input.source === "fact_table") {
    if (!input.factTableId) {
      throw new BadRequestError(
        "factTableId is required when source is fact_table.",
      );
    }
    const factTable = await getFactTable(context, input.factTableId);
    if (!factTable) {
      throw new NotFoundError(`Fact Table "${input.factTableId}" not found.`);
    }
    return {
      columns: (factTable.columns ?? [])
        .filter((column) => !column.deleted)
        .sort((a, b) => (a.name || a.column).localeCompare(b.name || b.column))
        .map(({ column, name, datatype }) => ({ column, name, datatype })),
      userIdTypes: factTable.userIdTypes ?? [],
      unitNote: factTable.userIdTypes?.length
        ? `For valueType "unit_count", set unit to one of userIdTypes (default: "${factTable.userIdTypes[0]}"). For "count" or "sum", set unit to null.`
        : 'No userIdTypes are configured. Use valueType "count" or "sum" only, and set unit to null.',
    };
  }

  const metrics = await getRequestedMetrics(context, input.metricIds);
  let columns: FactTableInterface["columns"] | null = null;
  let userIdTypes: string[] | null = null;
  const metricUnitInfo: ProductAnalyticsMetricUnitInfo[] = [];
  const factTableIds = Array.from(
    new Set(
      metrics
        .map((metric) => metric.numerator?.factTableId)
        .filter((id): id is string => Boolean(id)),
    ),
  );
  const factTables = await Promise.all(
    factTableIds.map((id) => getFactTable(context, id)),
  );
  const factTableMap = new Map(
    factTableIds.map((id, index) => [id, factTables[index]] as const),
  );

  for (const metric of metrics) {
    const needsUnit =
      metric.metricType === "proportion" ||
      metric.metricType === "retention" ||
      metric.metricType === "dailyParticipation" ||
      (metric.metricType === "ratio" &&
        metric.numerator?.column === "$$distinctUsers");
    metricUnitInfo.push({
      metricId: metric.id,
      metricType: metric.metricType,
      needsUnit,
    });

    const factTableId = metric.numerator?.factTableId;
    if (!factTableId) continue;
    const factTable = factTableMap.get(factTableId);
    if (!factTable) {
      throw new NotFoundError(
        `Fact Table "${factTableId}" was not found or is not accessible.`,
      );
    }
    if (needsUnit) {
      const factTableUserIdTypes = factTable.userIdTypes ?? [];
      userIdTypes =
        userIdTypes === null
          ? [...factTableUserIdTypes]
          : userIdTypes.filter((userIdType) =>
              factTableUserIdTypes.includes(userIdType),
            );
    }
    const factTableColumns = (factTable.columns ?? []).filter(
      (column) => !column.deleted,
    );
    if (columns === null) {
      columns = factTableColumns;
    } else {
      const names = new Set(factTableColumns.map((column) => column.column));
      columns = columns.filter((column) => names.has(column.column));
    }
  }

  const commonUserIdTypes = userIdTypes ?? [];
  return {
    columns: (columns ?? [])
      .sort((a, b) => (a.name || a.column).localeCompare(b.name || b.column))
      .map(({ column, name, datatype }) => ({ column, name, datatype })),
    userIdTypes: commonUserIdTypes,
    metrics: metricUnitInfo,
    unitNote: commonUserIdTypes.length
      ? `For metrics where needsUnit is true, set unit to one of userIdTypes (default: "${commonUserIdTypes[0]}"). For other metrics, set unit to null.`
      : metricUnitInfo.some(({ needsUnit }) => needsUnit)
        ? "The selected Fact Metrics that require units have no common user ID type. Request each metric separately to find its valid units."
        : "The selected Fact Metrics do not require a unit. Set unit to null.",
  };
}

export type ProductAnalyticsColumnValuesInput = {
  source: ProductAnalyticsColumnsSource;
  factTableId?: string;
  metricIds?: string[];
  columns: string[];
  searchTerm?: string;
  limit: number;
};

export type ProductAnalyticsColumnValuesResult = {
  values: Record<string, string[]>;
  warnings?: string[];
};

export async function getProductAnalyticsColumnValues(
  context: ProductAnalyticsContext,
  input: ProductAnalyticsColumnValuesInput,
): Promise<ProductAnalyticsColumnValuesResult> {
  let factTable: FactTableInterface | null;
  if (input.source === "fact_table") {
    if (!input.factTableId) {
      throw new BadRequestError(
        "factTableId is required when source is fact_table.",
      );
    }
    factTable = await getFactTable(context, input.factTableId);
    if (!factTable) {
      throw new NotFoundError(`Fact Table "${input.factTableId}" not found.`);
    }
  } else {
    const metrics = await getRequestedMetrics(context, input.metricIds);
    const factTableIds = Array.from(
      new Set(
        metrics
          .map((metric) => metric.numerator?.factTableId)
          .filter((id): id is string => Boolean(id)),
      ),
    );
    if (factTableIds.length !== 1) {
      throw new BadRequestError(
        "The selected Fact Metrics must resolve to one Fact Table.",
      );
    }
    factTable = await getFactTable(context, factTableIds[0]);
    if (!factTable) {
      throw new NotFoundError(
        "The selected Fact Metrics reference an inaccessible Fact Table.",
      );
    }
  }

  const datasource = await getDataSourceById(context, factTable.datasource);
  if (!datasource) {
    throw new NotFoundError("Data Source not found.");
  }

  const availableColumns = (factTable.columns ?? []).filter(
    (column) => !column.deleted,
  );
  const columnsToQuery: ColumnInterface[] = [];
  const nonStringColumns: string[] = [];
  const missingColumns: string[] = [];
  for (const requestedColumn of input.columns) {
    const found = availableColumns.find(
      (column) => column.column === requestedColumn,
    );
    if (!found) {
      missingColumns.push(requestedColumn);
    } else if (found.datatype !== "string") {
      nonStringColumns.push(requestedColumn);
    } else {
      columnsToQuery.push(found);
    }
  }

  const warnings: string[] = [];
  if (nonStringColumns.length) {
    warnings.push(
      `Skipped non-string columns: ${nonStringColumns.join(", ")}.`,
    );
  }
  if (missingColumns.length) {
    warnings.push(`Columns not found: ${missingColumns.join(", ")}.`);
  }
  if (!columnsToQuery.length) {
    return { values: {}, ...(warnings.length ? { warnings } : {}) };
  }

  const rawValues = await runColumnsTopValuesQuery(
    context,
    datasource,
    {
      sql: factTable.sql,
      eventName: factTable.eventName ?? "",
      timestampColumn: factTable.timestampColumn,
    },
    columnsToQuery,
    {
      limit: input.limit,
      searchTerm: input.searchTerm,
    },
  );
  const searchTerm = input.searchTerm?.toLowerCase();
  const values = Object.fromEntries(
    Object.entries(rawValues).map(([column, rawColumnValues]) => [
      column,
      rawColumnValues
        .filter(
          (value) => !searchTerm || value.toLowerCase().includes(searchTerm),
        )
        .slice(0, input.limit),
    ]),
  );
  return { values, ...(warnings.length ? { warnings } : {}) };
}
