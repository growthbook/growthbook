import { format } from "shared/sql";
import type { DropAggregatedFactTableQueryParams } from "shared/types/integrations";
import type { SqlDialect } from "shared/types/sql";
import { AGGREGATED_FACT_TABLE_PREFIX } from "back-end/src/queryRunners/AggregatedFactTableQueryRunner";

// Drops the whole table. This is the only backfill mechanism (new metric,
// schema change, forced restate) since restating one metric costs about the
// same as the whole table; outside a restate the data path stays insert-only.
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
