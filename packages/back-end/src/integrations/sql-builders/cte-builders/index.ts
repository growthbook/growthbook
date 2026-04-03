/**
 * CTE Builders Module
 *
 * This module provides pure functions for generating SQL Common Table Expressions (CTEs)
 * used in experiment analysis queries. These functions have been extracted from
 * SqlIntegration.ts for better testability, reuse, and maintainability.
 *
 * Each CTE builder:
 * - Takes a dialect object for database-specific SQL generation
 * - Returns a SQL string fragment (the CTE body, without the "name AS (...)" wrapper)
 * - Is pure (no side effects, deterministic output)
 *
 * CTE Types:
 * - Identities: Join different user ID types together
 * - Segments: Filter users to specific groups
 * - Metrics: Calculate metric values from raw data
 * - Statistics: Aggregate metric data for statistical analysis
 */

// ============================================================
// Identities CTE Builder
// ============================================================

export {
  buildIdentitiesCTE,
  generateIdentitiesQuery,
  type IdentitiesCTEDialect,
  type IdentitiesCTEParams,
  type IdentitiesCTEResult,
} from "./identities";

// ============================================================
// Segments CTE Builder
// ============================================================

export {
  buildSegmentCTE,
  buildFactSegmentCTE,
  type SegmentCTEDialect,
  type FactSegmentCTEDialect,
  type SegmentCTEParams,
} from "./segments";

// ============================================================
// Metrics CTE Builder
// ============================================================

export {
  buildMetricCTE,
  buildFactMetricCTE,
  type MetricCTEDialect,
  type MetricCTEParams,
  type FactMetricCTEParams,
} from "./metrics";

// ============================================================
// Statistics CTE Builder
// ============================================================

export {
  buildExperimentFactMetricStatisticsCTE,
  type StatisticsCTEDialect,
  type StatisticsCTEParams,
} from "./statistics";
