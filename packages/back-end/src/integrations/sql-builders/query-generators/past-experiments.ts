/**
 * Past Experiments Query Generator
 *
 * Generates SQL queries to discover past experiments from exposure data.
 * This is the simplest query generator, extracting experiment and variation
 * information from exposure queries over a date range.
 */

import { format } from "sql-formatter";
import { SAFE_ROLLOUT_TRACKING_KEY_PREFIX } from "shared/constants";
import { ExposureQuery } from "shared/types/datasource";
import { SqlDialect, hasHllSupport } from "../../sql-dialects";
import { compileSqlTemplate } from "back-end/src/util/sql";

/**
 * Maximum number of rows to return from past experiments query.
 * This prevents overly large result sets.
 */
export const MAX_ROWS_PAST_EXPERIMENTS_QUERY = 3000;

/**
 * Parameters for generating past experiments query
 */
export interface PastExperimentsQueryParams {
  /** Start date for the query range */
  from: Date;
  /** End date for the query range (optional, defaults to now) */
  to?: Date;
  /** List of exposure queries to scan for experiments */
  exposureQueries: ExposureQuery[];
}

/**
 * Generate a SQL query to discover past experiments from exposure data.
 *
 * This function scans exposure queries and aggregates experiment/variation data
 * to identify past experiments based on user traffic patterns.
 *
 * Key features:
 * - Unions multiple exposure queries together
 * - Groups by experiment_id, variation_id, and date
 * - Filters out safe rollout tracking keys
 * - Uses user thresholds to filter out low-traffic variations
 * - Returns top N results ordered by start_date DESC
 *
 * @param params Query parameters
 * @param dialect SQL dialect for database-specific syntax
 * @returns Formatted SQL query string
 */
export function generatePastExperimentsQuery(
  params: PastExperimentsQueryParams,
  dialect: SqlDialect
): string {
  const { from, exposureQueries } = params;
  const end = params.to ?? new Date();

  if (exposureQueries.length === 0) {
    throw new Error("At least one exposure query is required");
  }

  // Build individual exposure CTEs
  const exposureCTEs = exposureQueries.map((q, i) => {
    const hasNameCol = q.hasNameCol || false;

    // Use HLL for user count if available, otherwise COUNT DISTINCT
    const userCountColumn = hasHllSupport(dialect)
      ? dialect.hllCardinality(dialect.hllAggregate(q.userIdType))
      : `COUNT(distinct ${q.userIdType})`;

    return `
    __exposures${i} as (
      SELECT
        ${dialect.castToString(`'${q.id}'`)} as exposure_query,
        experiment_id,
        ${hasNameCol ? "MIN(experiment_name)" : "experiment_id"} as experiment_name,
        ${dialect.castToString("variation_id")} as variation_id,
        ${hasNameCol ? "MIN(variation_name)" : dialect.castToString("variation_id")} as variation_name,
        ${dialect.dateTrunc(dialect.castUserDateCol("timestamp"))} as date,
        ${userCountColumn} as users,
        MAX(${dialect.castUserDateCol("timestamp")}) as latest_data
      FROM
        (
          ${compileSqlTemplate(q.query, { startDate: from })}
        ) e${i}
      WHERE
        timestamp > ${dialect.toTimestamp(from)}
        AND timestamp <= ${dialect.toTimestamp(end)}
        AND SUBSTRING(experiment_id, 1, ${SAFE_ROLLOUT_TRACKING_KEY_PREFIX.length}) != '${SAFE_ROLLOUT_TRACKING_KEY_PREFIX}'
        AND experiment_id IS NOT NULL
        AND variation_id IS NOT NULL
      GROUP BY
        experiment_id,
        variation_id,
        ${dialect.dateTrunc(dialect.castUserDateCol("timestamp"))}
    )`;
  });

  // Union all exposure CTEs
  const experimentsUnion = exposureQueries
    .map((_, i) => `SELECT * FROM __exposures${i}`)
    .join("\nUNION ALL\n");

  const query = `-- Past Experiments
WITH
  ${exposureCTEs.join(",\n")}
  , __experiments as (
    ${experimentsUnion}
  ),
  __userThresholds as (
    SELECT
      exposure_query,
      experiment_id,
      MIN(experiment_name) as experiment_name,
      variation_id,
      MIN(variation_name) as variation_name,
      -- It's common for a small number of tracking events to continue coming in
      -- long after an experiment ends, so limit to days with enough traffic
      max(users)*0.05 as threshold
    FROM
      __experiments
    WHERE
      -- Skip days where a variation got 5 or fewer visitors since it's probably not real traffic
      users > 5
    GROUP BY
    exposure_query, experiment_id, variation_id
  ),
  __variations as (
    SELECT
      d.exposure_query,
      d.experiment_id,
      MIN(d.experiment_name) as experiment_name,
      d.variation_id,
      MIN(d.variation_name) as variation_name,
      MIN(d.date) as start_date,
      MAX(d.date) as end_date,
      SUM(d.users) as users,
      MAX(latest_data) as latest_data
    FROM
      __experiments d
      JOIN __userThresholds u ON (
        d.exposure_query = u.exposure_query
        AND d.experiment_id = u.experiment_id
        AND d.variation_id = u.variation_id
      )
    WHERE
      d.users > u.threshold
    GROUP BY
      d.exposure_query, d.experiment_id, d.variation_id
  )
${dialect.selectStarLimit(
  `
  __variations
ORDER BY
  start_date DESC, experiment_id ASC, variation_id ASC
  `,
  MAX_ROWS_PAST_EXPERIMENTS_QUERY
)}`;

  return format(query, dialect.formatDialect);
}
