/**
 * Statistics CTE Builder
 *
 * Pure functions for generating experiment statistics SQL CTEs.
 * Extracted from SqlIntegration.ts for better testability and reuse.
 *
 * The statistics CTE aggregates metric data per variation and dimension
 * to calculate:
 * - User counts
 * - Sum and sum of squares (for mean calculations)
 * - Denominator data (for ratio metrics)
 * - Covariate data (for CUPED regression adjustment)
 * - Quantile data (for percentile metrics)
 */

import {
  DimensionColumnData,
  FactMetricData,
  FactMetricQuantileData,
} from "shared/types/integrations";
import { FactTableInterface } from "shared/types/fact-table";
import { MetricQuantileSettings } from "shared/types/fact-table";
import { N_STAR_VALUES } from "back-end/src/services/experimentQueries/constants";

/**
 * Interface for SQL generation methods needed by statistics CTE builder.
 */
export interface StatisticsCTEDialect {
  /** Cast a value to a string type */
  castToString(col: string): string;

  /** Get quantile grid columns for percentile metrics */
  getQuantileGridColumns(
    quantileSettings: MetricQuantileSettings | undefined,
    prefix: string
  ): string;
}

/**
 * Parameters for building the experiment statistics CTE.
 */
export interface StatisticsCTEParams {
  /** Dimension columns for GROUP BY */
  dimensionCols: DimensionColumnData[];

  /** Metric data with aggregation expressions */
  metricData: FactMetricData[];

  /** Event-level quantile data for quantile metrics */
  eventQuantileData: FactMetricQuantileData[];

  /** Base user ID type */
  baseIdType: string;

  /** Name of the joined metric table CTE */
  joinedMetricTableName: string;

  /** Name of the event quantile table CTE */
  eventQuantileTableName: string;

  /** Name of the CUPED covariate table CTE */
  cupedMetricTableName: string;

  /** Name of the cap value table CTE */
  capValueTableName: string;

  /** Fact tables with their indices */
  factTablesWithIndices: { factTable: FactTableInterface; index: number }[];

  /** Set of table indices that use regression adjustment */
  regressionAdjustedTableIndices: Set<number>;

  /** Set of table indices that use percentile capping */
  percentileTableIndices: Set<number>;
}

/**
 * Build the experiment fact metric statistics CTE.
 *
 * This generates the final aggregation SQL that:
 * 1. Joins metric data with optional quantile, covariate, and cap value tables
 * 2. Groups by variation and dimension columns
 * 3. Calculates sum, sum_squares for each metric
 * 4. Handles ratio metrics with denominator calculations
 * 5. Handles CUPED regression adjustment with covariate products
 * 6. Handles quantile metrics with grid columns or event-level quantiles
 *
 * @param dialect - SQL dialect implementation
 * @param params - Parameters including metric data, tables, and indices
 * @returns SQL string for the statistics CTE body
 */
export function buildExperimentFactMetricStatisticsCTE(
  dialect: StatisticsCTEDialect,
  params: StatisticsCTEParams
): string {
  const {
    dimensionCols,
    metricData,
    eventQuantileData,
    baseIdType,
    joinedMetricTableName,
    eventQuantileTableName,
    cupedMetricTableName,
    capValueTableName,
    factTablesWithIndices,
    regressionAdjustedTableIndices,
    percentileTableIndices,
  } = params;

  // Generate metric column SELECT expressions
  const metricColumns = metricData.map((data) => {
    const numeratorSuffix = `${data.numeratorSourceIndex === 0 ? "" : data.numeratorSourceIndex}`;

    return buildMetricSelectColumns(
      dialect,
      data,
      numeratorSuffix,
      eventQuantileData.length > 0
    );
  });

  // Generate JOIN clauses for additional tables
  const tableJoins = factTablesWithIndices.map(({ index }) => {
    const suffix = `${index === 0 ? "" : index}`;

    return buildTableJoins(
      index,
      suffix,
      baseIdType,
      joinedMetricTableName,
      cupedMetricTableName,
      capValueTableName,
      regressionAdjustedTableIndices,
      percentileTableIndices
    );
  });

  return `SELECT
        m.variation AS variation
        ${dimensionCols.map((c) => `, m.${c.alias} AS ${c.alias}`).join("")}
        , COUNT(*) AS users
        ${metricColumns.join("\n")}
      FROM
        ${joinedMetricTableName} m
        ${
          eventQuantileData.length
            ? `LEFT JOIN ${eventQuantileTableName} qm ON (
          qm.variation = m.variation
          ${dimensionCols
            .map((c) => `AND qm.${c.alias} = m.${c.alias}`)
            .join("\n")}
            )`
            : ""
        }
      ${tableJoins.join("\n")}
      GROUP BY
        m.variation
        ${dimensionCols.map((c) => `, m.${c.alias}`).join("")}
    `;
}

/**
 * Build SELECT columns for a single metric.
 */
function buildMetricSelectColumns(
  dialect: StatisticsCTEDialect,
  data: FactMetricData,
  numeratorSuffix: string,
  hasEventQuantiles: boolean
): string {
  const columns: string[] = [];

  // Metric ID column
  columns.push(`, ${dialect.castToString(`'${data.id}'`)} as ${data.alias}_id`);

  // Cap value for percentile-capped metrics
  if (data.isPercentileCapped) {
    columns.push(
      `, MAX(COALESCE(cap${numeratorSuffix}.${data.alias}_value_cap, 0)) as ${data.alias}_main_cap_value`
    );
  }

  // Main sum and sum_squares
  columns.push(
    `, SUM(${data.capCoalesceMetric}) AS ${data.alias}_main_sum`,
    `, SUM(POWER(${data.capCoalesceMetric}, 2)) AS ${data.alias}_main_sum_squares`
  );

  // Event-level quantile columns
  if (data.quantileMetric === "event") {
    columns.push(buildEventQuantileColumns(data, hasEventQuantiles));
  }

  // Unit-level quantile columns
  if (data.quantileMetric === "unit") {
    columns.push(
      dialect.getQuantileGridColumns(
        data.metricQuantileSettings,
        `${data.alias}_`
      ),
      `, COUNT(m.${data.alias}_value) AS ${data.alias}_quantile_n`
    );
  }

  // Ratio metric columns
  if (data.ratioMetric) {
    columns.push(
      buildRatioMetricColumns(data)
    );
  } else if (data.regressionAdjusted) {
    // Non-ratio metric with regression adjustment
    columns.push(
      `, SUM(${data.capCoalesceCovariate}) AS ${data.alias}_covariate_sum`,
      `, SUM(POWER(${data.capCoalesceCovariate}, 2)) AS ${data.alias}_covariate_sum_squares`,
      `, SUM(${data.capCoalesceMetric} * ${data.capCoalesceCovariate}) AS ${data.alias}_main_covariate_sum_product`
    );
  }

  return columns.join("\n            ");
}

/**
 * Build event quantile columns.
 */
function buildEventQuantileColumns(
  data: FactMetricData,
  hasEventQuantiles: boolean
): string {
  const columns: string[] = [
    `, SUM(COALESCE(m.${data.alias}_n_events, 0)) AS ${data.alias}_denominator_sum`,
    `, SUM(POWER(COALESCE(m.${data.alias}_n_events, 0), 2)) AS ${data.alias}_denominator_sum_squares`,
    `, SUM(COALESCE(m.${data.alias}_n_events, 0) * ${data.capCoalesceMetric}) AS ${data.alias}_main_denominator_sum_product`,
    `, SUM(COALESCE(m.${data.alias}_n_events, 0)) AS ${data.alias}_quantile_n`,
  ];

  if (hasEventQuantiles) {
    columns.push(`, MAX(qm.${data.alias}_quantile) AS ${data.alias}_quantile`);

    // Add N-star value columns
    N_STAR_VALUES.forEach((n) => {
      columns.push(
        `, MAX(qm.${data.alias}_quantile_lower_${n}) AS ${data.alias}_quantile_lower_${n}`,
        `, MAX(qm.${data.alias}_quantile_upper_${n}) AS ${data.alias}_quantile_upper_${n}`
      );
    });
  }

  return columns.join("\n              ");
}

/**
 * Build ratio metric columns.
 */
function buildRatioMetricColumns(data: FactMetricData): string {
  const columns: string[] = [];

  // Denominator cap value for percentile-capped metrics
  if (data.isPercentileCapped) {
    const denomSuffix = data.denominatorSourceIndex === 0 ? "" : data.denominatorSourceIndex;
    columns.push(
      `, MAX(COALESCE(cap${denomSuffix}.${data.alias}_denominator_cap, 0)) as ${data.alias}_denominator_cap_value`
    );
  }

  // Denominator sum and sum_squares
  columns.push(
    `, SUM(${data.capCoalesceDenominator}) AS ${data.alias}_denominator_sum`,
    `, SUM(POWER(${data.capCoalesceDenominator}, 2)) AS ${data.alias}_denominator_sum_squares`
  );

  if (data.regressionAdjusted) {
    // Full CUPED columns for ratio metrics
    columns.push(
      `, SUM(${data.capCoalesceCovariate}) AS ${data.alias}_covariate_sum`,
      `, SUM(POWER(${data.capCoalesceCovariate}, 2)) AS ${data.alias}_covariate_sum_squares`,
      `, SUM(${data.capCoalesceDenominatorCovariate}) AS ${data.alias}_denominator_pre_sum`,
      `, SUM(POWER(${data.capCoalesceDenominatorCovariate}, 2)) AS ${data.alias}_denominator_pre_sum_squares`,
      `, SUM(${data.capCoalesceMetric} * ${data.capCoalesceDenominator}) AS ${data.alias}_main_denominator_sum_product`,
      `, SUM(${data.capCoalesceMetric} * ${data.capCoalesceCovariate}) AS ${data.alias}_main_covariate_sum_product`,
      `, SUM(${data.capCoalesceMetric} * ${data.capCoalesceDenominatorCovariate}) AS ${data.alias}_main_post_denominator_pre_sum_product`,
      `, SUM(${data.capCoalesceCovariate} * ${data.capCoalesceDenominator}) AS ${data.alias}_main_pre_denominator_post_sum_product`,
      `, SUM(${data.capCoalesceCovariate} * ${data.capCoalesceDenominatorCovariate}) AS ${data.alias}_main_pre_denominator_pre_sum_product`,
      `, SUM(${data.capCoalesceDenominator} * ${data.capCoalesceDenominatorCovariate}) AS ${data.alias}_denominator_post_denominator_pre_sum_product`
    );
  } else {
    // Simple ratio without CUPED
    columns.push(
      `, SUM(${data.capCoalesceDenominator} * ${data.capCoalesceMetric}) AS ${data.alias}_main_denominator_sum_product`
    );
  }

  return columns.join("\n                ");
}

/**
 * Build JOIN clauses for fact tables.
 */
function buildTableJoins(
  index: number,
  suffix: string,
  baseIdType: string,
  joinedMetricTableName: string,
  cupedMetricTableName: string,
  capValueTableName: string,
  regressionAdjustedTableIndices: Set<number>,
  percentileTableIndices: Set<number>
): string {
  const joins: string[] = [];

  // JOIN for non-first tables
  if (index !== 0) {
    joins.push(
      `LEFT JOIN ${joinedMetricTableName}${suffix} m${suffix} ON (
          m${suffix}.${baseIdType} = m.${baseIdType}
        )`
    );
  }

  // CUPED covariate JOIN
  if (regressionAdjustedTableIndices.has(index)) {
    joins.push(
      `LEFT JOIN ${cupedMetricTableName}${suffix} c${suffix} ON (
            c${suffix}.${baseIdType} = m${suffix}.${baseIdType}
          )`
    );
  }

  // Percentile cap value CROSS JOIN
  if (percentileTableIndices.has(index)) {
    joins.push(`CROSS JOIN ${capValueTableName}${suffix} cap${suffix}`);
  }

  return joins.join("\n        ");
}
