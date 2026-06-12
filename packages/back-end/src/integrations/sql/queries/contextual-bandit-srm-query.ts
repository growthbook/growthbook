import { format } from "shared/sql";
import {
  CONTEXTUAL_BANDIT_EAQ_LEAF_ID_COLUMN,
  CONTEXTUAL_BANDIT_EAQ_SNAPSHOT_UPDATE_COUNT_COLUMN,
  CONTEXTUAL_BANDIT_EAQ_VARIATION_WEIGHTS_COLUMN,
} from "shared/validators";
import type { DataSourceInterface } from "shared/types/datasource";
import type { ContextualBanditSrmQueryParams } from "shared/types/integrations";
import type { SqlDialect } from "shared/types/sql";
import { compileSqlTemplate } from "back-end/src/util/sql";
import { getExposureQuery } from "back-end/src/integrations/sql/queries/exposure-query";

/**
 * Sample Ratio Mismatch (SRM) for contextual bandits, computed in SQL.
 *
 * Each assignment-query row carries the per-row variation weights, the policy
 * leaf (`leaf_id`), and the weight-update generation (`snapshot_update_count`).
 * For every (leaf_id, snapshot_update_count) group we compare, per variation:
 *   - observed = number of users assigned to that variation, and
 *   - expected = sum of that variation's per-user weights.
 * The result is the chi-square statistic SUM((observed - expected)^2 / expected)
 * across all (group, variation) cells, plus the distinct leaf count, distinct
 * weight-update-generation count, and variation count. The caller derives the
 * degrees of freedom as numLeaves * numUpdates * (numVariations - 1) and the
 * p-value from the statistic.
 *
 * Within each (leaf_id, snapshot_update_count) cell a user contributes a single
 * observation: their first (earliest-timestamp) exposure in that cell. A user can
 * still appear in multiple cells (e.g. across leaves or weight-update generations).
 */
export function getContextualBanditSrmQuery(
  dialect: SqlDialect,
  datasource: DataSourceInterface,
  params: ContextualBanditSrmQueryParams,
): string {
  const { settings } = params;

  const exposureQuery = getExposureQuery(
    datasource,
    settings.exposureQueryId || "",
  );

  const variations = settings.variations ?? [];
  if (variations.length === 0) {
    throw new Error(
      "Contextual bandit SRM query requires at least one variation",
    );
  }

  const userIdType = exposureQuery.userIdType;
  const timestampColumn = "e.timestamp";
  const startDate: Date = settings.startDate;
  const endDate: Date | undefined = settings.endDate;

  const leafCol = CONTEXTUAL_BANDIT_EAQ_LEAF_ID_COLUMN;
  const updateCountCol = CONTEXTUAL_BANDIT_EAQ_SNAPSHOT_UPDATE_COUNT_COLUMN;
  const weightsCol = CONTEXTUAL_BANDIT_EAQ_VARIATION_WEIGHTS_COLUMN;

  // One scalar weight column per variation, extracted from the per-row array.
  const weightSelectCols = variations
    .map((_, i) => `, ${dialect.arrayElement(`e.${weightsCol}`, i)} AS w_${i}`)
    .join("\n          ");

  // Pass the per-variation weight columns through the first-exposure pick unchanged.
  const weightPassCols = variations
    .map((_, i) => `, w_${i}`)
    .join("\n          ");

  // observed_i / expected_i per (leaf_id, snapshot_update_count) cell.
  // The assignment query logs the variation key (0-based index, e.g. "0"/"1"),
  // not the GrowthBook variation id, so match on the index.
  const cellAggCols = variations
    .map(
      (_, i) =>
        `, SUM(${dialect.ifElse(
          `variation = '${i}'`,
          "1",
          "0",
        )}) AS observed_${i}\n          , SUM(w_${i}) AS expected_${i}`,
    )
    .join("\n          ");

  // Unpivot the k (observed, expected) pairs into one row per cell-variation.
  const cellRows = variations
    .map(
      (_, i) =>
        `SELECT observed_${i} AS observed, expected_${i} AS expected FROM __cbCellAgg`,
    )
    .join("\n        UNION ALL\n        ");

  return format(
    `-- Contextual Bandit SRM
    WITH
      __rawExperiment AS (
        ${compileSqlTemplate(
          exposureQuery.query,
          {
            startDate,
            endDate,
            experimentId: settings.experimentId,
            phase: settings.phase,
            customFields: settings.customFields,
          },
          dialect,
        )}
      )
      , __cbExposures AS (
        SELECT
          e.${userIdType} AS uid
          , e.${leafCol} AS leaf_id
          , e.${updateCountCol} AS snapshot_update_count
          , ${dialect.castToString("e.variation_id")} AS variation
          , ${timestampColumn} AS timestamp
          ${weightSelectCols}
        FROM
          __rawExperiment e
        WHERE
          e.experiment_id = '${settings.experimentId}'
          AND ${timestampColumn} >= ${dialect.toTimestamp(startDate)}
          ${
            endDate
              ? `AND ${timestampColumn} <= ${dialect.toTimestamp(endDate)}`
              : ""
          }
      )
      , __cbRankedExposures AS (
        -- Rank a user's rows within each (leaf_id, snapshot_update_count) cell by time
        SELECT
          uid
          , leaf_id
          , snapshot_update_count
          , variation
          ${weightPassCols}
          , ROW_NUMBER() OVER (
              PARTITION BY uid, leaf_id, snapshot_update_count
              ORDER BY timestamp ASC
            ) AS __rn
        FROM
          __cbExposures
      )
      , __cbUnits AS (
        -- Keep only each user's first exposure within the cell
        SELECT
          uid
          , leaf_id
          , snapshot_update_count
          , variation
          ${weightPassCols}
        FROM
          __cbRankedExposures
        WHERE
          __rn = 1
      )
      , __cbCellAgg AS (
        SELECT
          leaf_id
          , snapshot_update_count
          ${cellAggCols}
        FROM
          __cbUnits
        GROUP BY
          leaf_id
          , snapshot_update_count
      )
      , __cbCells AS (
        ${cellRows}
      )
      , __cbStatistic AS (
        SELECT
          COALESCE(SUM(POW(observed - expected, 2) / expected), 0) AS statistic
        FROM
          __cbCells
        WHERE
          expected > 0
      )
      , __cbDims AS (
        -- Distinct policy leaves and weight-update generations present in the data.
        SELECT
          COUNT(DISTINCT leaf_id) AS num_leaves
          , COUNT(DISTINCT snapshot_update_count) AS num_updates
        FROM
          __cbCellAgg
      )
    SELECT
      s.statistic AS statistic
      , d.num_leaves AS num_leaves
      , d.num_updates AS num_updates
      , ${variations.length} AS num_variations
    FROM
      __cbStatistic s
      CROSS JOIN __cbDims d
    `,
    dialect.formatDialect,
  );
}
