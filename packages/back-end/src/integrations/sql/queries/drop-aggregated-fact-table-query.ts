import { format } from "shared/sql";
import type { DropAggregatedFactTableQueryParams } from "shared/types/integrations";
import type { SqlDialect } from "shared/types/sql";
import { AGGREGATED_FACT_TABLE_PREFIX } from "back-end/src/queryRunners/AggregatedFactTableQueryRunner";

// Drops an entire aggregated fact table. This is the single mechanism for any
// backfill — new metric, schema-breaking change, or forced restate — since a
// full fact-table scan produces all columns in one pass and restating one
// metric costs essentially the same as restating the whole table. Outside of a
// restate the data path stays insert-only.
export function getDropAggregatedFactTableQuery(
  dialect: SqlDialect,
  params: DropAggregatedFactTableQueryParams,
): string {
  if (!params.tableFullName.includes(AGGREGATED_FACT_TABLE_PREFIX)) {
    throw new Error(
      "Refusing to drop a table that is not a GrowthBook aggregated fact table.",
    );
  }
  return format(
    `
    DROP TABLE IF EXISTS ${params.tableFullName}
    `,
    dialect.formatDialect,
  );
}
