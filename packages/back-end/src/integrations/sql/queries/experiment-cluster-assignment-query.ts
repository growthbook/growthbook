import { format } from "shared/sql";
import type { DataSourceInterface } from "shared/types/datasource";
import type { ExperimentAggregateUnitsQueryParams } from "shared/types/integrations";
import type { SqlDialect } from "shared/types/sql";

import { getExperimentUnitsQuery } from "back-end/src/integrations/sql/queries/experiment-units-query";

/**
 * Health check for cluster experiments: verifies that every sub-unit in a
 * cluster shares the same assignment (randomization is at the cluster level).
 */
export function getExperimentClusterAssignmentQuery(
  dialect: SqlDialect,
  datasource: DataSourceInterface,
  params: ExperimentAggregateUnitsQueryParams,
): string {
  const { useUnitsTable, unitsSettings } = params;

  const clusterIdColumn = unitsSettings.exposureQuery.identifierType;

  const unitsSourceName = useUnitsTable
    ? `${params.unitsTableFullName}`
    : "__experimentUnits";

  return format(
    `-- Cluster Assignment Health Check
    WITH
      ${
        !useUnitsTable
          ? `${getExperimentUnitsQuery(dialect, datasource, {
              ...params,
              includeIdJoins: true,
            })},`
          : ""
      }
      __clusterAssignment AS (
        -- One row per cluster with its min/max sub-unit assignment; a cluster is
        -- consistent when they are equal.
        SELECT
          ${clusterIdColumn} AS cluster_id
          , MIN(variation) AS min_variation
          , MAX(variation) AS max_variation
        FROM ${unitsSourceName}
        GROUP BY
          ${clusterIdColumn}
      )
    SELECT
      COUNT(*) AS total_clusters
      , SUM(
          CASE WHEN min_variation <> max_variation THEN 1 ELSE 0 END
        ) AS mixed_clusters
    FROM __clusterAssignment
    `,
    dialect.formatDialect,
  );
}
