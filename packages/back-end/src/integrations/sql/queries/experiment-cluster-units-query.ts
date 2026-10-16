import { format } from "shared/sql";
import type { DataSourceInterface } from "shared/types/datasource";
import type { ExperimentAggregateUnitsQueryParams } from "shared/types/integrations";
import type { SqlDialect } from "shared/types/sql";
import { MAX_ROWS_CLUSTER_UNITS_QUERY } from "back-end/src/services/experimentQueries/constants";

import { getConsistentClusterCondition } from "back-end/src/integrations/sql/clauses/cluster-assignment-filter";
import { getExperimentUnitsQuery } from "back-end/src/integrations/sql/queries/experiment-units-query";

/**
 * Health query for cluster experiments: counts the number of sub-units (e.g.
 * users) assigned to each cluster, along with the cluster's variation.
 */
export function getExperimentClusterUnitsQuery(
  dialect: SqlDialect,
  datasource: DataSourceInterface,
  params: ExperimentAggregateUnitsQueryParams,
): string {
  const { useUnitsTable, unitsSettings } = params;

  const exposureQuery = unitsSettings.exposureQuery;

  const clusterIdColumn = exposureQuery.identifierType;
  const subUnitColumn =
    unitsSettings.clusterSubUnitIdentifier ?? exposureQuery.identifierType;

  const unitsSourceName = useUnitsTable
    ? `${params.unitsTableFullName}`
    : "__experimentUnits";

  return format(
    `-- Cluster Units Query for Health Tab
    WITH
      ${
        !useUnitsTable
          ? `${getExperimentUnitsQuery(dialect, datasource, {
              ...params,
              includeIdJoins: true,
            })},`
          : ""
      }
      __clusterUnits AS (
        SELECT
          ${clusterIdColumn} AS cluster_id
          , variation AS variation
          , COUNT(DISTINCT ${subUnitColumn}) AS units
          , ${dialect.castToFloat(
            `COUNT(DISTINCT ${subUnitColumn})`,
          )} / SUM(COUNT(DISTINCT ${subUnitColumn})) OVER () AS pct
        FROM ${unitsSourceName}
        -- Drop clusters with mixed assignment (randomization is per cluster).
        WHERE ${getConsistentClusterCondition({
          sourceTable: unitsSourceName,
          clusterIdColumn,
        })}
        GROUP BY
          ${clusterIdColumn}
          , variation
      )
      ${dialect.selectStarLimit(
        "__clusterUnits",
        MAX_ROWS_CLUSTER_UNITS_QUERY,
        "ORDER BY units DESC",
      )}
    `,
    dialect.formatDialect,
  );
}
