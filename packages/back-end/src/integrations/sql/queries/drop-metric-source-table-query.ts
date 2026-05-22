import { format } from "shared/sql";
import { DropMetricSourceTableQueryParams } from "shared/types/integrations";
import { SqlDialect } from "shared/types/sql";
import { INCREMENTAL_METRICS_TABLE_PREFIX } from "back-end/src/queryRunners/ExperimentIncrementalRefreshQueryRunner";

export function getDropMetricSourceTableQuery(
  dialect: SqlDialect,
  params: DropMetricSourceTableQueryParams,
): string {
  if (
    !params.metricSourceTableFullName.includes(INCREMENTAL_METRICS_TABLE_PREFIX)
  ) {
    throw new Error(
      "Unable to drop table that is not an incremental refresh metric source table.",
    );
  }
  return format(
    `
      DROP TABLE IF EXISTS ${params.metricSourceTableFullName}
      `,
    dialect.formatDialect,
  );
}
