import { format } from "shared/sql";
import type { DataSourceInterface } from "shared/types/datasource";
import type { ExperimentAggregateUnitsQueryParams } from "shared/types/integrations";
import type { SqlDialect } from "shared/types/sql";
import { MAX_ROWS_CLUSTER_UNITS_QUERY } from "back-end/src/services/experimentQueries/constants";

import { MULTIPLE_CLUSTER_SENTINEL } from "back-end/src/integrations/sql/clauses/cluster-assignment-filter";
import { getExperimentUnitsQuery } from "back-end/src/integrations/sql/queries/experiment-units-query";

// Discriminator values for the rows returned by the consolidated cluster-health
// query. `metric_a`/`metric_b` carry different meanings depending on `kind`.
export const CLUSTER_HEALTH_KIND_RELIABILITY = "reliability";
export const CLUSTER_HEALTH_KIND_ASSIGNMENT = "assignment";
export const CLUSTER_HEALTH_KIND_MAPPING = "mapping";

/**
 * Consolidated health query for cluster experiments. A single scan of the units
 * set (aggregated once into `__clusterAgg`) powers all three cluster health
 * checks, each emitted as its own `kind` of row:
 *  - reliability: per-cluster sub-unit counts for the top-N largest clusters
 *    (cluster_id/variation populated; metric_a = units, metric_b = pct)
 *  - assignment: cluster-assignment consistency summary
 *    (metric_a = total clusters, metric_b = clusters with mixed assignment)
 *  - mapping: sub-unit-to-cluster mapping summary
 *    (metric_a = total sub-units, metric_b = sub-units mapping to >1 cluster)
 */
export function getExperimentClusterHealthQuery(
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

  const nullString = `CAST(NULL AS ${dialect.getDataType("string")})`;

  return format(
    `-- Cluster Health Query for Health Tab
    WITH
      ${
        !useUnitsTable
          ? `${getExperimentUnitsQuery(dialect, datasource, {
              ...params,
              includeIdJoins: true,
            })},`
          : ""
      }
      __clusterAgg AS (
        -- One row per cluster: its min/max sub-unit assignment (a cluster is
        -- consistent when they are equal) and its sub-unit count.
        SELECT
          ${clusterIdColumn} AS cluster_id
          , MIN(variation) AS min_variation
          , MAX(variation) AS max_variation
          , COUNT(DISTINCT ${subUnitColumn}) AS units
        FROM ${unitsSourceName}
        GROUP BY
          ${clusterIdColumn}
      ),
      __realClusters AS (
        -- Drop sub-units that map to multiple clusters, and clusters with mixed
        -- assignment (randomization is per cluster).
        SELECT
          cluster_id
          , min_variation AS variation
          , units
          , ${dialect.castToFloat("units")} / SUM(units) OVER () AS pct
        FROM __clusterAgg
        WHERE cluster_id <> '${MULTIPLE_CLUSTER_SENTINEL}'
          AND min_variation = max_variation
      ),
      __topClusters AS (
        ${dialect.selectStarLimit(
          "__realClusters",
          MAX_ROWS_CLUSTER_UNITS_QUERY,
          "ORDER BY units DESC",
        )}
      )
    SELECT
      '${CLUSTER_HEALTH_KIND_RELIABILITY}' AS kind
      , cluster_id
      , variation
      , ${dialect.castToFloat("units")} AS metric_a
      , ${dialect.castToFloat("pct")} AS metric_b
    FROM __topClusters
    UNION ALL
    SELECT
      '${CLUSTER_HEALTH_KIND_ASSIGNMENT}' AS kind
      , ${nullString} AS cluster_id
      , ${nullString} AS variation
      , ${dialect.castToFloat("COUNT(*)")} AS metric_a
      , ${dialect.castToFloat(
        "SUM(CASE WHEN min_variation <> max_variation THEN 1 ELSE 0 END)",
      )} AS metric_b
    FROM __clusterAgg
    UNION ALL
    SELECT
      '${CLUSTER_HEALTH_KIND_MAPPING}' AS kind
      , ${nullString} AS cluster_id
      , ${nullString} AS variation
      , ${dialect.castToFloat("SUM(units)")} AS metric_a
      , ${dialect.castToFloat(
        `SUM(CASE WHEN cluster_id = '${MULTIPLE_CLUSTER_SENTINEL}' THEN units ELSE 0 END)`,
      )} AS metric_b
    FROM __clusterAgg
    `,
    dialect.formatDialect,
  );
}
