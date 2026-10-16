import { format } from "shared/sql";
import type { DataSourceInterface } from "shared/types/datasource";
import type { ExperimentAggregateUnitsQueryParams } from "shared/types/integrations";
import type { SqlDialect } from "shared/types/sql";

import { MULTIPLE_CLUSTER_SENTINEL } from "back-end/src/integrations/sql/clauses/cluster-assignment-filter";
import { getExperimentUnitsQuery } from "back-end/src/integrations/sql/queries/experiment-units-query";

/**
 * Verifies that each sub-unit (e.g. a
 * user) maps to a single cluster (e.g. a region).
 */
export function getExperimentClusterSubUnitMappingQuery(
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
    `-- Cluster Sub-Unit Mapping Health Check
    WITH
      ${
        !useUnitsTable
          ? `${getExperimentUnitsQuery(dialect, datasource, {
              ...params,
              includeIdJoins: true,
            })},`
          : ""
      }
      __clusterSubUnitMapping AS (
        -- One row per sub-unit; its cluster id is the sentinel when it mapped to
        -- more than one cluster.
        SELECT
          COUNT(*) AS total_units
          , SUM(
              CASE
                WHEN ${clusterIdColumn} = '${MULTIPLE_CLUSTER_SENTINEL}'
                THEN 1
                ELSE 0
              END
            ) AS multi_cluster_units
        FROM ${unitsSourceName}
      )
    SELECT
      total_units
      , multi_cluster_units
    FROM __clusterSubUnitMapping
    `,
    dialect.formatDialect,
  );
}
