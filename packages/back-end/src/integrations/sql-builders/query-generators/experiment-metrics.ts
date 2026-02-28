/**
 * Experiment Metrics Query Generators
 *
 * Generates SQL queries for analyzing experiment metrics. This module provides
 * utilities for both legacy metric queries and fact-based metric queries.
 *
 * Query Structure (getExperimentFactMetricsQuery):
 * 1. Identity CTEs (join different user ID types)
 * 2. Experiment Units CTE (get users exposed to experiment)
 * 3. Distinct Users CTE (apply filters, add dimensions)
 * 4. Fact Table CTEs (one per fact table used by metrics)
 * 5. User Metric Join CTEs (join users with metric events, apply conversion windows)
 * 6. Event Quantile Metric CTEs (for quantile metrics)
 * 7. User Metric Aggregate CTEs (aggregate per user)
 * 8. Cap Value CTEs (for percentile capping)
 * 9. User Covariate Metric CTEs (for CUPED/regression adjustment)
 * 10. Statistics CTE (final aggregation by variation/dimension)
 *
 * This is the most complex query type in GrowthBook. The full implementation
 * relies heavily on CTE builders from Phase 4 and internal SqlIntegration methods.
 */

import { format, FormatDialect } from "sql-formatter";
import { SqlDialect } from "../../sql-dialects";

/**
 * Dimension column data for grouping results
 */
export interface DimensionColumnData {
  /** SQL expression for the dimension value */
  value: string;
  /** Column alias in the output */
  alias: string;
}

/**
 * Parameters for building the __distinctUsers CTE
 */
export interface DistinctUsersParams {
  /** Base user ID type (e.g., "user_id") */
  baseIdType: string;
  /** Dimension columns to include */
  dimensionCols: DimensionColumnData[];
  /** Column to use for user timestamp */
  timestampColumn: string;
  /** Source table for units (exposure table or CTE) */
  sourceTable: string;
  /** Additional WHERE conditions */
  whereConditions: string[];
  /** Whether to include bandit period column */
  includeBanditPeriod: boolean;
  /** Bandit period case-when expression */
  banditCaseWhen?: string;
  /** Regression adjustment settings for pre-exposure windows */
  raMetricSettings?: Array<{
    alias: string;
    hours: number;
    minDelay: number;
  }>;
}

/**
 * Generate the __distinctUsers CTE body.
 *
 * This CTE filters experiment units and adds dimension columns.
 *
 * @param params CTE parameters
 * @param dialect SQL dialect for date functions
 * @returns SQL CTE body
 */
export function generateDistinctUsersCTE(
  params: DistinctUsersParams,
  dialect: SqlDialect
): string {
  const {
    baseIdType,
    dimensionCols,
    timestampColumn,
    sourceTable,
    whereConditions,
    includeBanditPeriod,
    banditCaseWhen,
    raMetricSettings,
  } = params;

  const dimensionSelects = dimensionCols
    .map((c) => `, ${c.value} AS ${c.alias}`)
    .join("");

  const banditColumn = includeBanditPeriod && banditCaseWhen ? banditCaseWhen : "";

  // Pre-exposure window columns for regression adjustment
  let raColumns = "";
  if (raMetricSettings && raMetricSettings.length > 0) {
    const minPreStart = Math.min(
      ...raMetricSettings.map((s) => s.minDelay - s.hours)
    );
    const maxPreEnd = Math.max(...raMetricSettings.map((s) => s.minDelay));

    raColumns = `
    , ${dialect.addHours("first_exposure_timestamp", minPreStart)} as min_preexposure_start
    , ${dialect.addHours("first_exposure_timestamp", maxPreEnd)} as max_preexposure_end
    ${raMetricSettings
      .map(
        ({ alias, hours, minDelay }) => `
    , ${dialect.addHours("first_exposure_timestamp", minDelay)} AS ${alias}_preexposure_end
    , ${dialect.addHours("first_exposure_timestamp", minDelay - hours)} AS ${alias}_preexposure_start`
      )
      .join("")}`;
  }

  const whereClause =
    whereConditions.length > 0
      ? `WHERE ${whereConditions.join(" AND ")}`
      : "";

  return `
SELECT
  ${baseIdType}
  ${dimensionSelects}
  , variation
  , ${timestampColumn} AS timestamp
  , ${dialect.dateTrunc("first_exposure_timestamp")} AS first_exposure_date
  ${banditColumn}
  ${raColumns}
FROM ${sourceTable}
${whereClause}`;
}

/**
 * Statistics output columns for a single metric
 */
export interface MetricStatisticsColumns {
  /** Metric ID column */
  idColumn: string;
  /** Whether metric uses percentile capping */
  isPercentileCapped: boolean;
  /** Expression for main cap value (if capped) */
  capValueExpression?: string;
  /** Expression for main sum */
  mainSumExpression: string;
  /** Expression for main sum of squares */
  mainSumSquaresExpression: string;
  /** Whether this is a ratio metric */
  isRatioMetric: boolean;
  /** Denominator expressions (for ratio metrics) */
  denominatorSumExpression?: string;
  denominatorSumSquaresExpression?: string;
  denominatorCapValueExpression?: string;
  mainDenominatorSumProductExpression?: string;
  /** Whether regression adjustment is enabled */
  isRegressionAdjusted: boolean;
  /** Covariate expressions (for CUPED) */
  covariateSumExpression?: string;
  covariateSumSquaresExpression?: string;
  mainCovariateSumProductExpression?: string;
  /** Whether this is a quantile metric */
  isQuantileMetric: boolean;
  quantileType?: "event" | "unit";
  /** Alias prefix for output columns */
  alias: string;
}

/**
 * Generate statistics columns for a single metric.
 *
 * @param metric Metric statistics configuration
 * @param dialect SQL dialect for casting
 * @returns SQL fragment with metric statistics columns
 */
export function generateMetricStatisticsColumns(
  metric: MetricStatisticsColumns,
  dialect: SqlDialect
): string {
  const { alias, isPercentileCapped, isRatioMetric, isRegressionAdjusted } =
    metric;

  let columns = `
  , ${dialect.castToString(`'${metric.idColumn}'`)} as ${alias}_id`;

  // Cap value (for percentile capping)
  if (isPercentileCapped && metric.capValueExpression) {
    columns += `
  , MAX(${metric.capValueExpression}) as ${alias}_main_cap_value`;
  }

  // Main sum and sum of squares
  columns += `
  , SUM(${metric.mainSumExpression}) AS ${alias}_main_sum
  , SUM(POWER(${metric.mainSumExpression}, 2)) AS ${alias}_main_sum_squares`;

  // Ratio metric columns
  if (isRatioMetric) {
    if (isPercentileCapped && metric.denominatorCapValueExpression) {
      columns += `
  , MAX(${metric.denominatorCapValueExpression}) as ${alias}_denominator_cap_value`;
    }

    columns += `
  , SUM(${metric.denominatorSumExpression}) AS ${alias}_denominator_sum
  , SUM(POWER(${metric.denominatorSumExpression}, 2)) AS ${alias}_denominator_sum_squares`;

    if (isRegressionAdjusted) {
      columns += `
  , SUM(${metric.covariateSumExpression}) AS ${alias}_covariate_sum
  , SUM(POWER(${metric.covariateSumExpression}, 2)) AS ${alias}_covariate_sum_squares
  , SUM(${metric.mainSumExpression} * ${metric.denominatorSumExpression}) AS ${alias}_main_denominator_sum_product
  , SUM(${metric.mainSumExpression} * ${metric.covariateSumExpression}) AS ${alias}_main_covariate_sum_product`;
    } else {
      columns += `
  , SUM(${metric.denominatorSumExpression} * ${metric.mainSumExpression}) AS ${alias}_main_denominator_sum_product`;
    }
  } else {
    // Non-ratio metric
    if (isRegressionAdjusted) {
      columns += `
  , SUM(${metric.covariateSumExpression}) AS ${alias}_covariate_sum
  , SUM(POWER(${metric.covariateSumExpression}, 2)) AS ${alias}_covariate_sum_squares
  , SUM(${metric.mainSumExpression} * ${metric.covariateSumExpression}) AS ${alias}_main_covariate_sum_product`;
    }
  }

  return columns;
}

/**
 * Parameters for building the final statistics CTE
 */
export interface ExperimentStatisticsParams {
  /** Dimension columns */
  dimensionCols: DimensionColumnData[];
  /** Metric statistics configurations */
  metrics: MetricStatisticsColumns[];
  /** Base user ID type */
  baseIdType: string;
  /** Name of the joined metric table */
  joinedMetricTableName: string;
  /** Additional table joins */
  additionalJoins: string[];
}

/**
 * Generate the final statistics SELECT.
 *
 * This produces the final aggregated results by variation and dimension.
 *
 * @param params Statistics parameters
 * @param dialect SQL dialect
 * @returns SQL SELECT statement
 */
export function generateExperimentStatisticsSelect(
  params: ExperimentStatisticsParams,
  dialect: SqlDialect
): string {
  const { dimensionCols, metrics, joinedMetricTableName, additionalJoins } =
    params;

  const dimensionSelects = dimensionCols
    .map((c) => `, m.${c.alias} AS ${c.alias}`)
    .join("");

  const dimensionGroupBy = dimensionCols
    .map((c) => `, m.${c.alias}`)
    .join("");

  const metricColumns = metrics
    .map((m) => generateMetricStatisticsColumns(m, dialect))
    .join("");

  const joins = additionalJoins.length > 0 ? additionalJoins.join("\n") : "";

  return `
SELECT
  m.variation AS variation
  ${dimensionSelects}
  , COUNT(*) AS users
  ${metricColumns}
FROM
  ${joinedMetricTableName} m
  ${joins}
GROUP BY
  m.variation
  ${dimensionGroupBy}`;
}

/**
 * Conversion window filter parameters
 */
export interface ConversionWindowFilter {
  /** Column containing the metric value */
  valueColumn: string;
  /** Column containing the metric timestamp */
  metricTimestampColumn: string;
  /** Column containing the exposure timestamp */
  exposureTimestampColumn: string;
  /** Conversion window start (hours after exposure) */
  conversionWindowStart?: number;
  /** Conversion window end (hours after exposure) */
  conversionWindowEnd?: number;
  /** Whether to override conversion windows */
  overrideConversionWindows: boolean;
  /** Analysis end date */
  endDate: Date;
}

/**
 * Generate a CASE WHEN expression for conversion window filtering.
 *
 * This wraps a metric value column with time-based filtering to only include
 * conversions that happened within the specified window.
 *
 * @param params Conversion window parameters
 * @param dialect SQL dialect
 * @returns SQL CASE WHEN expression
 */
export function generateConversionWindowFilter(
  params: ConversionWindowFilter,
  dialect: SqlDialect
): string {
  const {
    valueColumn,
    metricTimestampColumn,
    exposureTimestampColumn,
    conversionWindowStart,
    conversionWindowEnd,
    overrideConversionWindows,
    endDate,
  } = params;

  // If overriding windows, just check against end date
  if (overrideConversionWindows) {
    return `CASE WHEN ${metricTimestampColumn} <= ${dialect.toTimestamp(
      endDate
    )} THEN ${valueColumn} ELSE NULL END`;
  }

  const conditions: string[] = [];

  // Start condition
  if (conversionWindowStart !== undefined && conversionWindowStart > 0) {
    conditions.push(
      `${metricTimestampColumn} >= ${dialect.addHours(
        exposureTimestampColumn,
        conversionWindowStart
      )}`
    );
  }

  // End condition
  if (conversionWindowEnd !== undefined && conversionWindowEnd > 0) {
    conditions.push(
      `${metricTimestampColumn} <= ${dialect.addHours(
        exposureTimestampColumn,
        conversionWindowEnd
      )}`
    );
  }

  // End date condition
  conditions.push(
    `${metricTimestampColumn} <= ${dialect.toTimestamp(endDate)}`
  );

  if (conditions.length === 0) {
    return valueColumn;
  }

  return `CASE WHEN ${conditions.join(" AND ")} THEN ${valueColumn} ELSE NULL END`;
}

/**
 * Build a formatted comment for experiment metric queries.
 *
 * @param factTableNames Names of fact tables used in the query
 * @returns SQL comment
 */
export function generateQueryComment(factTableNames: string[]): string {
  if (factTableNames.length === 1) {
    return `-- Fact Table: ${factTableNames[0]}`;
  }
  return `-- Cross-Fact Table Metrics: ${factTableNames.join(" & ")}`;
}

/**
 * Parameters for the experiment fact metrics query structure.
 *
 * This interface defines the pre-computed values needed to assemble
 * the full experiment fact metrics query. The actual CTE contents are
 * generated by the CTE builders (Phase 4).
 */
export interface ExperimentFactMetricsQueryParams {
  /** Query comment (fact table names) */
  queryComment: string;

  /** Format dialect for sql-formatter */
  formatDialect: FormatDialect;

  /** SQL for identity joins */
  identitiesCTESQL: string;

  /** SQL for experiment units */
  experimentUnitsCTESQL?: string;

  /** SQL for distinct users CTE */
  distinctUsersCTESQL: string;

  /** SQL for fact table CTEs (array for multi-table queries) */
  factTableCTESQLs: string[];

  /** SQL for user metric join CTEs */
  userMetricJoinCTESQLs: string[];

  /** SQL for user metric aggregate CTEs */
  userMetricAggCTESQLs: string[];

  /** SQL for cap value CTEs (optional) */
  capValueCTESQLs?: string[];

  /** SQL for covariate metric CTEs (optional) */
  covariateCTESQLs?: string[];

  /** SQL for final statistics */
  statisticsSQL: string;
}

/**
 * Assemble the full experiment fact metrics query from pre-computed parts.
 *
 * This function takes the outputs of CTE builders and combines them
 * into the complete experiment metrics query.
 *
 * @param params Query parameters with pre-computed CTE SQL
 * @returns Formatted SQL query string
 */
export function assembleExperimentFactMetricsQuery(
  params: ExperimentFactMetricsQueryParams
): string {
  const {
    queryComment,
    formatDialect,
    identitiesCTESQL,
    experimentUnitsCTESQL,
    distinctUsersCTESQL,
    factTableCTESQLs,
    userMetricJoinCTESQLs,
    userMetricAggCTESQLs,
    capValueCTESQLs,
    covariateCTESQLs,
    statisticsSQL,
  } = params;

  // Build the CTE chain
  const cteParts: string[] = [identitiesCTESQL];

  if (experimentUnitsCTESQL) {
    cteParts.push(experimentUnitsCTESQL);
  }

  cteParts.push(`__distinctUsers AS (${distinctUsersCTESQL})`);

  // Add fact table and join CTEs
  for (let i = 0; i < factTableCTESQLs.length; i++) {
    const suffix = i === 0 ? "" : String(i);
    cteParts.push(`__factTable${suffix} AS (${factTableCTESQLs[i]})`);
    cteParts.push(`__userMetricJoin${suffix} AS (${userMetricJoinCTESQLs[i]})`);
    cteParts.push(`__userMetricAgg${suffix} AS (${userMetricAggCTESQLs[i]})`);

    if (capValueCTESQLs && capValueCTESQLs[i]) {
      cteParts.push(`__capValue${suffix} AS (${capValueCTESQLs[i]})`);
    }

    if (covariateCTESQLs && covariateCTESQLs[i]) {
      cteParts.push(`__userCovariateMetric${suffix} AS (${covariateCTESQLs[i]})`);
    }
  }

  const query = `${queryComment}
WITH
  ${cteParts.join(",\n  ")}
${statisticsSQL}`;

  return format(query, formatDialect);
}
