import { format } from "shared/sql";
import type { CreateAggregatedFactTableQueryParams } from "shared/types/integrations";
import type { SqlDialect } from "shared/types/sql";

import { getAggregatedFactTableSchema } from "back-end/src/integrations/sql/fact-metrics/aggregated-fact-table-schema";

// Builds the `CREATE TABLE` for a shared daily aggregated fact table.
//
// Partitioning/clustering is emitted via the integration's existing
// `createTablePartitions` hook so each dialect renders the right syntax (base
// is a no-op, BigQuery partitions on the date column + clusters on the id,
// Presto declares partitioned_by). The id type is the natural read key, so we
// partition on `event_date` and cluster on `<idType>`.
export function getCreateAggregatedFactTableQuery(
  dialect: SqlDialect,
  params: CreateAggregatedFactTableQueryParams,
  createTablePartitions: (
    columns: string[],
    opts?: { partitionByDate?: boolean },
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
    })}
    `,
    dialect.formatDialect,
  );
}
