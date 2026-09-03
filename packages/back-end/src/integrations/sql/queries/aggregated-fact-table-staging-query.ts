import { format } from "shared/sql";
import { isRatioMetric } from "shared/experiments";
import type {
  CreateAggregatedFactTableStagingQueryParams,
  InsertAggregatedFactTableStagingDataQueryParams,
} from "shared/types/integrations";
import type { FactMetricInterface } from "shared/types/fact-table";
import type { SqlDialect } from "shared/types/sql";

import { getFactMetricCTE } from "back-end/src/integrations/sql/ctes/fact-metric-cte";

// Shared-staging tables materialize the event-grain output of the fact-table
// CTE (all enabled idType columns + timestamp + per-metric raw value columns)
// once per restate. Each per-idType aggregated table then reads its GROUP BY
// from the staging table instead of re-scanning the fact-table SQL, so a fact
// table with N idTypes pays one source scan instead of N.

// Column list of the staging table, in stable order. Metric columns use the
// same `m{index}` naming as `getFactMetricCTE` so the per-idType insert can
// read them without a rename.
export function getAggregatedFactTableStagingColumns({
  idTypes,
  metrics,
  factTableId,
}: {
  idTypes: string[];
  metrics: FactMetricInterface[];
  factTableId: string;
}): string[] {
  const sortedMetrics = [...metrics].sort((a, b) => a.id.localeCompare(b.id));
  const cols = [...idTypes, "timestamp"];
  sortedMetrics.forEach((m, index) => {
    if (m.numerator?.factTableId === factTableId) {
      cols.push(`m${index}_value`);
      if (m.numerator.aggregation === "kll merge") {
        cols.push(`m${index}_n_events`);
      }
    }
    if (isRatioMetric(m) && m.denominator?.factTableId === factTableId) {
      cols.push(`m${index}_denominator`);
    }
  });
  return cols;
}

export function getCreateAggregatedFactTableStagingQuery(
  dialect: SqlDialect,
  params: CreateAggregatedFactTableStagingQueryParams,
  createTablePartitions: (
    columns: string[],
    opts?: { partitionByDate?: boolean; partitionExpirationDays?: number },
  ) => string,
): string {
  const { stagingTableFullName, factTable, idTypes, metrics, expirationHours } =
    params;

  // Derive column types from a zero-row projection of the CTE so metric-value
  // column types (float / KLL sketch / etc.) match the source without a
  // parallel type-derivation table. `expirationHours` guards against orphaned
  // staging tables when the coordinating driver dies before the explicit DROP.
  const cte = getFactMetricCTE(dialect, {
    baseIdType: idTypes[0],
    projectIdTypes: idTypes,
    idJoinMap: {},
    factTable,
    startDate: new Date(0),
    endDate: null,
    metricsWithIndices: [...metrics]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((metric, index) => ({ metric, index })),
    addFiltersToWhere: true,
    castIdToString: true,
  });

  // CREATE ... AS SELECT with WHERE FALSE derives column types from the CTE
  // without scanning data; the chunked INSERTs then fill it.
  return format(
    `
    CREATE TABLE ${stagingTableFullName}
    ${createTablePartitions(["timestamp", ...idTypes], {
      // The CTE emits `timestamp` as a TIMESTAMP; partition on the trunc, not a
      // DATE cast, so the schema matches.
      partitionByDate: false,
      // Days-granular expiration is the portable option; the hours arg rounds up.
      partitionExpirationDays: Math.max(1, Math.ceil(expirationHours / 24)),
    })}
    AS SELECT * FROM (${cte}) WHERE FALSE
    `,
    dialect.formatDialect,
  );
}

export function getInsertAggregatedFactTableStagingDataQuery(
  dialect: SqlDialect,
  params: InsertAggregatedFactTableStagingDataQueryParams,
): string {
  const { stagingTableFullName, factTable, idTypes, metrics } = params;

  const sortedMetrics = [...metrics].sort((a, b) => a.id.localeCompare(b.id));
  const columns = getAggregatedFactTableStagingColumns({
    idTypes,
    metrics,
    factTableId: factTable.id,
  });

  const cte = getFactMetricCTE(dialect, {
    baseIdType: idTypes[0],
    projectIdTypes: idTypes,
    idJoinMap: {},
    factTable,
    startDate: params.windowStartDate,
    endDate: params.windowEndDate,
    metricsWithIndices: sortedMetrics.map((metric, index) => ({
      metric,
      index,
    })),
    addFiltersToWhere: true,
    exclusiveStartDateFilter: false,
    exclusiveEndDateFilter: true,
    castIdToString: true,
  });

  return format(
    `
    INSERT INTO ${stagingTableFullName}
    (${columns.join(", \n")})
    SELECT ${columns.join(", ")} FROM (${cte})
    `,
    dialect.formatDialect,
  );
}
