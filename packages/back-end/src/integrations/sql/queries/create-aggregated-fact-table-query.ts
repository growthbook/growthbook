import { format } from "shared/sql";
import type { CreateAggregatedFactTableQueryParams } from "shared/types/integrations";
import type { SqlDialect } from "shared/types/sql";

import { getAggregatedFactTableSchema } from "back-end/src/integrations/sql/fact-metrics/aggregated-fact-table-schema";

// Builds the `CREATE TABLE` for an aggregated fact table. Partitioning is
// delegated to the dialect's `createTablePartitions` hook; we partition on
// `event_date` and cluster on `<idType>` (the natural read key). When set, a
// retention window (days) is passed through so dialects that support it drop
// partitions older than the window automatically.
export function getCreateAggregatedFactTableQuery(
  dialect: SqlDialect,
  params: CreateAggregatedFactTableQueryParams,
  createTablePartitions: (
    columns: string[],
    opts?: { partitionByDate?: boolean; partitionExpirationDays?: number },
  ) => string,
): string {
  const schema = getAggregatedFactTableSchema(dialect, {
    idType: params.idType,
    factTableId: params.factTableId,
    metrics: params.metrics,
  });

  const columnDefinitions = Array.from(schema.entries()).map(
    ([columnName, dataType]) => `${columnName} ${dataType}`,
  );

  return format(
    `
    CREATE TABLE ${params.tableFullName}
    (
      ${columnDefinitions.join("\n, ")}
    )
    ${createTablePartitions(["event_date", params.idType], {
      partitionByDate: true,
      partitionExpirationDays: params.retentionWindowDays,
    })}
    `,
    dialect.formatDialect,
  );
}
