/**
 * Metric Analysis Query Generator
 *
 * Generates SQL queries for analyzing metrics over time periods.
 * This provides both overall statistics and daily breakdown for a single metric.
 *
 * Query Structure:
 * 1. Identity CTEs (join different user ID types)
 * 2. Population CTEs (optional - filter to specific user segment)
 * 3. Fact Table CTE (get raw metric events)
 * 4. User Metric Daily CTE (aggregate per user per day)
 * 5. User Metric Overall CTE (aggregate across all days)
 * 6. Cap Value CTE (optional - for percentile capping)
 * 7. Statistics Daily CTE (statistics per day)
 * 8. Statistics Overall CTE (overall statistics)
 * 9. Histogram CTE (optional - for mean metrics)
 *
 * This module provides the query assembly logic while delegating
 * CTE generation to the CTE builders from Phase 4.
 */

import { format, FormatDialect } from "sql-formatter";
import { SqlDialect } from "../../sql-dialects";

/**
 * Default number of histogram bins for metric analysis
 */
export const DEFAULT_METRIC_HISTOGRAM_BINS = 20;

/**
 * Configuration for metric analysis statistics
 */
export interface MetricAnalysisStatisticsConfig {
  /** Whether the metric uses ratio (numerator/denominator) */
  isRatioMetric: boolean;
  /** Column expression for the metric value (with optional capping) */
  valueColumn: string;
  /** Column expression for the denominator (for ratio metrics) */
  denominatorColumn?: string;
  /** Whether to create histogram bins */
  createHistogram: boolean;
  /** Whether the metric is capped */
  isCapped: boolean;
}

/**
 * Generate the statistic clauses for metric analysis.
 *
 * These clauses calculate count, sum, sum of squares, etc. for
 * both the numerator and (optionally) denominator.
 *
 * @param config Statistics configuration
 * @returns SQL fragment with statistic columns
 */
export function generateMetricAnalysisStatisticClauses(
  config: MetricAnalysisStatisticsConfig
): string {
  const { isRatioMetric, valueColumn, denominatorColumn } = config;

  let clauses = `
    , COUNT(*) as count
    , SUM(${valueColumn}) as main_sum
    , SUM(POWER(${valueColumn}, 2)) as main_sum_squares`;

  if (isRatioMetric && denominatorColumn) {
    clauses += `
    , SUM(${denominatorColumn}) as denominator_sum
    , SUM(POWER(${denominatorColumn}, 2)) as denominator_sum_squares
    , SUM(${denominatorColumn} * ${valueColumn}) as main_denominator_sum_product`;
  }

  return clauses;
}

/**
 * Generate histogram bin expressions for a given number of bins.
 *
 * Creates SQL expressions that count values falling into each bin,
 * based on value_min and bin_width from the statistics table.
 *
 * @param dialect SQL dialect for conditional expressions
 * @param numBins Number of histogram bins
 * @returns SQL fragment with histogram bin columns
 */
export function generateHistogramBins(
  dialect: SqlDialect,
  numBins: number = DEFAULT_METRIC_HISTOGRAM_BINS
): string {
  const bins: string[] = [];

  // First bin: value < value_min + bin_width
  bins.push(
    `SUM(${dialect.ifElse("m.value < (s.value_min + s.bin_width)", "1", "0")}) as units_bin_0`
  );

  // Middle bins
  for (let i = 0; i < numBins - 2; i++) {
    bins.push(
      `SUM(${dialect.ifElse(
        `m.value >= (s.value_min + s.bin_width*${i + 1}.0) AND m.value < (s.value_min + s.bin_width*${i + 2}.0)`,
        "1",
        "0"
      )}) as units_bin_${i + 1}`
    );
  }

  // Last bin: value >= value_min + bin_width * (numBins - 1)
  bins.push(
    `SUM(${dialect.ifElse(
      `m.value >= (s.value_min + s.bin_width*${numBins - 1}.0)`,
      "1",
      "0"
    )}) as units_bin_${numBins - 1}`
  );

  return bins.join("\n      , ");
}

/**
 * Generate placeholder histogram columns for daily statistics.
 *
 * Daily statistics don't have histogram data, so we generate NULL placeholders.
 *
 * @param dialect SQL dialect for type casting
 * @param numBins Number of histogram bins
 * @returns SQL fragment with NULL histogram columns
 */
export function generateHistogramPlaceholders(
  dialect: SqlDialect,
  numBins: number = DEFAULT_METRIC_HISTOGRAM_BINS
): string {
  const placeholders: string[] = [];

  for (let i = 0; i < numBins; i++) {
    placeholders.push(`${dialect.ensureFloat("NULL")} AS units_bin_${i}`);
  }

  return placeholders.join("\n      , ");
}

/**
 * Generate the __statisticsDaily CTE body.
 *
 * Calculates per-day statistics for the metric.
 *
 * @param config Statistics configuration
 * @param dialect SQL dialect
 * @param options Additional options
 * @returns SQL CTE body
 */
export function generateDailyStatisticsCTE(
  config: MetricAnalysisStatisticsConfig,
  dialect: SqlDialect,
  options: {
    sourceTable: string;
    useCapTable: boolean;
  }
): string {
  const { createHistogram, isCapped, valueColumn, denominatorColumn } = config;

  const cappedString = dialect.castToString(`'${isCapped ? "capped" : "uncapped"}'`);
  const dataTypeString = dialect.castToString("'date'");

  let histogramCols = "";
  if (createHistogram) {
    histogramCols = `
    , MIN(${valueColumn}) as value_min
    , MAX(${valueColumn}) as value_max
    , ${dialect.ensureFloat("NULL")} AS bin_width
    , ${generateHistogramPlaceholders(dialect)}`;
  }

  return `
SELECT
  date
  , MAX(${dataTypeString}) AS data_type
  , ${cappedString} AS capped
  ${generateMetricAnalysisStatisticClauses(config)}
  ${histogramCols}
FROM ${options.sourceTable}
${options.useCapTable ? "CROSS JOIN __capValue cap" : ""}
GROUP BY date`;
}

/**
 * Generate the __statisticsOverall CTE body.
 *
 * Calculates overall statistics for the metric across all days.
 *
 * @param config Statistics configuration
 * @param dialect SQL dialect
 * @param options Additional options
 * @returns SQL CTE body
 */
export function generateOverallStatisticsCTE(
  config: MetricAnalysisStatisticsConfig,
  dialect: SqlDialect,
  options: {
    sourceTable: string;
    useCapTable: boolean;
  }
): string {
  const { createHistogram, isCapped, valueColumn } = config;

  const cappedString = dialect.castToString(`'${isCapped ? "capped" : "uncapped"}'`);
  const dataTypeString = dialect.castToString("'overall'");
  const numBins = DEFAULT_METRIC_HISTOGRAM_BINS;

  let histogramCols = "";
  if (createHistogram) {
    histogramCols = `
    , MIN(${valueColumn}) as value_min
    , MAX(${valueColumn}) as value_max
    , (MAX(${valueColumn}) - MIN(${valueColumn})) / ${numBins}.0 as bin_width`;
  }

  return `
SELECT
  ${dialect.castToDate("NULL")} AS date
  , MAX(${dataTypeString}) AS data_type
  , ${cappedString} AS capped
  ${generateMetricAnalysisStatisticClauses(config)}
  ${histogramCols}
FROM ${options.sourceTable}
${options.useCapTable ? "CROSS JOIN __capValue cap" : ""}`;
}

/**
 * Generate the __histogram CTE body.
 *
 * Calculates histogram bin counts for the overall metric distribution.
 *
 * @param dialect SQL dialect
 * @param options Additional options
 * @returns SQL CTE body
 */
export function generateHistogramCTE(
  dialect: SqlDialect,
  options: {
    sourceTable: string;
    statisticsTable: string;
  }
): string {
  return `
SELECT
  ${generateHistogramBins(dialect)}
FROM
  ${options.sourceTable} m
CROSS JOIN
  ${options.statisticsTable} s`;
}

/**
 * Parameters for the metric analysis query structure.
 *
 * This interface defines the pre-computed values needed to assemble
 * the full metric analysis query. The actual CTE contents are generated
 * by the CTE builders (Phase 4).
 */
export interface MetricAnalysisQueryParams {
  /** Name of the metric (for query comment) */
  metricName: string;

  /** The base user ID type */
  baseIdType: string;

  /** SQL for identity joins (from buildIdentitiesCTE) */
  identitiesCTESQL: string;

  /** SQL for population CTEs (optional) */
  populationCTESQL: string;

  /** SQL for fact table CTE (from buildFactMetricCTE) */
  factTableCTESQL: string;

  /** Metric statistics configuration */
  statisticsConfig: MetricAnalysisStatisticsConfig;

  /** SQL dialect for formatting */
  dialect: SqlDialect;

  /** Format dialect string */
  formatDialect: FormatDialect;

  /** Numerator aggregation functions */
  numeratorAggFns: {
    fullAggregationFunction: (col: string) => string;
    partialAggregationFunction: (col: string) => string;
    reAggregationFunction: (col: string) => string;
  };

  /** Denominator aggregation functions (for ratio metrics) */
  denominatorAggFns?: {
    fullAggregationFunction: (col: string) => string;
    partialAggregationFunction: (col: string) => string;
    reAggregationFunction: (col: string) => string;
  };

  /** Value transformation function */
  aggregatedValueTransformation: (params: {
    column: string;
    initialTimestampColumn: string;
    analysisEndDate?: Date;
  }) => string;

  /** Column alias for the metric */
  metricAlias: string;

  /** Whether percentile capping is used */
  isPercentileCapped: boolean;

  /** Percentile cap CTE SQL (if capping is used) */
  percentileCapCTESQL?: string;
}

/**
 * Assemble the full metric analysis query from pre-computed parts.
 *
 * This function takes the outputs of CTE builders and combines them
 * into the complete metric analysis query.
 *
 * @param params Query parameters with pre-computed CTE SQL
 * @returns Formatted SQL query string
 */
export function assembleMetricAnalysisQuery(
  params: MetricAnalysisQueryParams
): string {
  const {
    metricName,
    baseIdType,
    identitiesCTESQL,
    populationCTESQL,
    factTableCTESQL,
    statisticsConfig,
    dialect,
    formatDialect,
    numeratorAggFns,
    denominatorAggFns,
    aggregatedValueTransformation,
    metricAlias,
    isPercentileCapped,
    percentileCapCTESQL,
  } = params;

  const hasPopulation = !!populationCTESQL;
  const tablePrefix = hasPopulation ? "p" : "f";

  // Build __userMetricDaily CTE
  const denominatorDailyCols = statisticsConfig.isRatioMetric && denominatorAggFns
    ? `, ${denominatorAggFns.fullAggregationFunction(`f.${metricAlias}_denominator`)} AS denominator
    , ${denominatorAggFns.partialAggregationFunction(`f.${metricAlias}_denominator`)} AS denominator_for_reaggregation`
    : "";

  const userMetricDailyFrom = hasPopulation
    ? `FROM __population p
      LEFT JOIN __factTable f ON (f.${baseIdType} = p.${baseIdType})`
    : `FROM __factTable f`;

  const userMetricDailyCTE = `
SELECT
  ${tablePrefix}.${baseIdType} AS ${baseIdType}
  , ${dialect.dateTrunc("timestamp")} AS date
  , ${numeratorAggFns.fullAggregationFunction(`f.${metricAlias}_value`)} AS value
  , ${numeratorAggFns.partialAggregationFunction(`f.${metricAlias}_value`)} AS value_for_reaggregation
  ${denominatorDailyCols}
${userMetricDailyFrom}
GROUP BY
  ${dialect.dateTrunc("f.timestamp")}
  , ${tablePrefix}.${baseIdType}`;

  // Build __userMetricOverall CTE
  // Note: This uses a simplified version - the actual implementation has more complex transformation
  const denominatorOverallCol = statisticsConfig.isRatioMetric && denominatorAggFns
    ? `, ${denominatorAggFns.reAggregationFunction("denominator_for_reaggregation")} AS denominator`
    : "";

  const userMetricOverallCTE = `
SELECT
  ${baseIdType}
  , ${numeratorAggFns.reAggregationFunction("value_for_reaggregation")} AS value
  ${denominatorOverallCol}
FROM
  __userMetricDaily
GROUP BY
  ${baseIdType}`;

  // Assemble the full query
  const query = `-- ${metricName} Metric Analysis
WITH
  ${identitiesCTESQL}
  ${populationCTESQL}
  __factTable AS (${factTableCTESQL})
  , __userMetricDaily AS (
    -- Get aggregated metric per user by day
    ${userMetricDailyCTE}
  )
  , __userMetricOverall AS (${userMetricOverallCTE})
  ${isPercentileCapped && percentileCapCTESQL ? `, __capValue AS (${percentileCapCTESQL})` : ""}
  , __statisticsDaily AS (${generateDailyStatisticsCTE(
    statisticsConfig,
    dialect,
    { sourceTable: "__userMetricDaily", useCapTable: isPercentileCapped }
  )})
  , __statisticsOverall AS (${generateOverallStatisticsCTE(
    statisticsConfig,
    dialect,
    { sourceTable: "__userMetricOverall", useCapTable: isPercentileCapped }
  )})
  ${statisticsConfig.createHistogram ? `, __histogram AS (${generateHistogramCTE(
    dialect,
    { sourceTable: "__userMetricOverall", statisticsTable: "__statisticsOverall" }
  )})` : ""}
SELECT *
FROM __statisticsOverall
${statisticsConfig.createHistogram ? "CROSS JOIN __histogram" : ""}
UNION ALL
SELECT *
FROM __statisticsDaily`;

  return format(query, formatDialect);
}
