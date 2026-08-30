import { format } from "shared/sql";
import {
  CONTEXTUAL_BANDIT_EAQ_BANDIT_VERSION_COLUMN,
  CONTEXTUAL_BANDIT_EAQ_LEAF_ID_COLUMN,
  CONTEXTUAL_BANDIT_EAQ_VARIATION_WEIGHTS_COLUMN,
} from "shared/validators";
import type { ContextualBanditSrmQueryParams } from "shared/types/integrations";
import type { SqlDialect } from "shared/types/sql";
import { compileSqlTemplate } from "back-end/src/util/sql";

const MIN_EXPECTED_PER_CELL = 5;
const MIN_VALID_CELLS_PER_GROUP = 2;

/**
 * Sample Ratio Mismatch (SRM) for contextual bandits, computed in SQL.
 *
 * Each assignment-query row carries the per-row variation weights, the policy
 * leaf (`leaf_id`), and the bandit version / weight-update generation
 * (`bandit_version`).
 * For every (leaf_id, bandit_version) group we compare, per variation:
 *   - observed = number of users assigned to that variation, and
 *   - expected = sum of that variation's per-user weights.
 *
 * Cells whose expected count is below MIN_EXPECTED_PER_CELL (5) are dropped and
 * contribute to neither the statistic nor the degrees of freedom. A
 * (leaf_id, bandit_version) group is only kept when at least
 * MIN_VALID_CELLS_PER_GROUP (2) of its cells survive that filter.
 *
 * The query returns the chi-square statistic
 * SUM((observed - expected)^2 / expected) over the usable cells of the kept
 * groups, and the degrees of freedom computed directly in SQL as
 * (sum of usable cells across kept groups) - (number of kept groups). The caller
 * derives the p-value from the statistic and these degrees of freedom.
 *
 * Within each (leaf_id, bandit_version) cell a user contributes a single
 * observation: their first (earliest-timestamp) exposure in that cell. A user can
 * still appear in multiple cells (e.g. across leaves or weight-update generations).
 */
export function getContextualBanditSrmQuery(
  dialect: SqlDialect,
  params: ContextualBanditSrmQueryParams,
): string {
  const { settings } = params;

  const exposureQuery = settings.exposureQuery;

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
  const banditVersionCol = CONTEXTUAL_BANDIT_EAQ_BANDIT_VERSION_COLUMN;
  const weightsCol = CONTEXTUAL_BANDIT_EAQ_VARIATION_WEIGHTS_COLUMN;

  const weightSelectCols = variations
    .map((_, i) => `, ${dialect.arrayElement(`e.${weightsCol}`, i)} AS w_${i}`)
    .join("\n          ");

  const weightPassCols = variations
    .map((_, i) => `, w_${i}`)
    .join("\n          ");

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

  const cellRows = variations
    .map(
      (_, i) =>
        `SELECT leaf_id, bandit_version, observed_${i} AS observed, expected_${i} AS expected FROM __cbCellAgg`,
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
          , e.${banditVersionCol} AS bandit_version
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
        -- Rank a user's rows within each (leaf_id, bandit_version) cell by time
        SELECT
          uid
          , leaf_id
          , bandit_version
          , variation
          ${weightPassCols}
          , ROW_NUMBER() OVER (
              PARTITION BY uid, leaf_id, bandit_version
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
          , bandit_version
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
          , bandit_version
          ${cellAggCols}
        FROM
          __cbUnits
        GROUP BY
          leaf_id
          , bandit_version
      )
      , __cbCells AS (
        ${cellRows}
      )
      , __cbValidCells AS (
        -- Drop cells without enough expected data to be usable in the test.
        SELECT
          leaf_id
          , bandit_version
          , observed
          , expected
        FROM
          __cbCells
        WHERE
          expected >= ${MIN_EXPECTED_PER_CELL}
      )
      , __cbGroups AS (
        -- Per (leaf_id, bandit_version): count usable cells and accumulate
        -- their chi-square contribution. Keep only groups with at least 2 cells.
        SELECT
          leaf_id
          , bandit_version
          , COUNT(*) AS num_valid_cells
          , SUM(POW(observed - expected, 2) / expected) AS group_statistic
        FROM
          __cbValidCells
        GROUP BY
          leaf_id
          , bandit_version
        HAVING
          COUNT(*) >= ${MIN_VALID_CELLS_PER_GROUP}
      )
      , __cbResult AS (
        -- Statistic summed across kept groups, plus degrees of freedom computed
        -- as (sum of usable cells across kept groups) - (number of kept groups).
        SELECT
          COALESCE(SUM(group_statistic), 0) AS statistic
          , COALESCE(SUM(num_valid_cells), 0) - COUNT(*) AS degrees_of_freedom
        FROM
          __cbGroups
      )
    SELECT
      statistic AS statistic
      , degrees_of_freedom AS degrees_of_freedom
    FROM
      __cbResult
    `,
    dialect.formatDialect,
  );
}
