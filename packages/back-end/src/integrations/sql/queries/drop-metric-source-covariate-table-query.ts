import { format } from "shared/sql";
import { DropMetricSourceCovariateTableQueryParams } from "shared/types/integrations";
import { SqlDialect } from "shared/types/sql";
import { INCREMENTAL_METRICS_TABLE_PREFIX } from "back-end/src/queryRunners/ExperimentIncrementalRefreshQueryRunner";

export function getDropMetricSourceCovariateTableQuery(
  dialect: SqlDialect,
  params: DropMetricSourceCovariateTableQueryParams,
): string {
  if (
    !params.metricSourceCovariateTableFullName.includes(`_covariate`) ||
    !params.metricSourceCovariateTableFullName.includes(
      INCREMENTAL_METRICS_TABLE_PREFIX,
    )
  ) {
    throw new Error(
      "Unable to drop table that is not an incremental refresh covariate table.",
    );
  }
  return format(
    `
      DROP TABLE IF EXISTS ${params.metricSourceCovariateTableFullName}
      `,
    dialect.formatDialect,
  );
}
