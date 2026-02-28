/**
 * Query Generators Module
 *
 * This module provides pure functions for generating complete SQL queries
 * used in GrowthBook's experiment analysis and data discovery features.
 *
 * Query generators compose CTE builders (from Phase 4) into full SQL queries.
 * They take database-agnostic parameters and a dialect for DB-specific syntax.
 *
 * Query Types:
 *
 * 1. Past Experiments Query
 *    - Discovers past experiments from exposure data
 *    - Simplest query type, good for understanding the pattern
 *
 * 2. Schema Discovery Queries
 *    - Information schema queries for table/column discovery
 *    - Database-specific metadata table handling
 *
 * 3. Metric Analysis Query
 *    - Analyzes a single metric over time
 *    - Returns daily and overall statistics with optional histogram
 *
 * 4. Experiment Metrics Queries
 *    - The most complex queries - analyze experiment metrics
 *    - Legacy (SQL-based) and Fact-based variants
 *    - Composes many CTEs: identities, units, metrics, statistics
 *
 * Usage:
 *
 * ```typescript
 * import { generatePastExperimentsQuery, bigQueryDialect } from '...';
 *
 * const query = generatePastExperimentsQuery({
 *   from: new Date('2024-01-01'),
 *   exposureQueries: [...]
 * }, bigQueryDialect);
 * ```
 *
 * Architecture Notes:
 *
 * - Query generators are pure functions (no side effects, deterministic)
 * - They take a dialect object for database-specific SQL syntax
 * - Complex queries may accept pre-computed CTE SQL from CTE builders
 * - All functions return formatted SQL strings
 *
 * @module query-generators
 */

// ============================================================
// Past Experiments Query Generator
// ============================================================

export {
  generatePastExperimentsQuery,
  MAX_ROWS_PAST_EXPERIMENTS_QUERY,
  type PastExperimentsQueryParams,
} from "./past-experiments";

// ============================================================
// Schema Discovery Query Generators
// ============================================================

export {
  generateInformationSchemaQuery,
  generateTableDataQuery,
  generateTablePath,
  defaultInformationSchemaConfigs,
  type InformationSchemaConfig,
  type TableDataQueryParams,
} from "./schema-discovery";

// ============================================================
// Metric Analysis Query Generator
// ============================================================

export {
  generateMetricAnalysisStatisticClauses,
  generateHistogramBins,
  generateHistogramPlaceholders,
  generateDailyStatisticsCTE,
  generateOverallStatisticsCTE,
  generateHistogramCTE,
  assembleMetricAnalysisQuery,
  DEFAULT_METRIC_HISTOGRAM_BINS,
  type MetricAnalysisStatisticsConfig,
  type MetricAnalysisQueryParams,
} from "./metric-analysis";

// ============================================================
// Experiment Metrics Query Generators
// ============================================================

export {
  generateDistinctUsersCTE,
  generateMetricStatisticsColumns,
  generateExperimentStatisticsSelect,
  generateConversionWindowFilter,
  generateQueryComment,
  assembleExperimentFactMetricsQuery,
  type DimensionColumnData,
  type DistinctUsersParams,
  type MetricStatisticsColumns,
  type ConversionWindowFilter,
  type ExperimentStatisticsParams,
  type ExperimentFactMetricsQueryParams,
} from "./experiment-metrics";
