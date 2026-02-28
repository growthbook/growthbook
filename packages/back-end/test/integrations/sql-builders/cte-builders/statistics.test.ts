/**
 * Statistics CTE Builder Tests
 *
 * These tests verify:
 * 1. The extracted buildExperimentFactMetricStatisticsCTE function works correctly
 * 2. The extracted function produces IDENTICAL results to the original
 *    SqlIntegration.getExperimentFactMetricStatisticsCTE method (parity tests)
 *
 * The statistics CTE builder is responsible for:
 * - Aggregating metric data per variation and dimension
 * - Calculating sum, sum_squares for statistical analysis
 * - Handling ratio metrics with denominator data
 * - Handling CUPED regression adjustment
 * - Handling quantile/percentile metrics
 */

import BigQuery from "../../../../src/integrations/BigQuery";
import {
  DimensionColumnData,
  FactMetricData,
  FactMetricQuantileData,
} from "shared/types/integrations";
import { FactTableInterface, MetricQuantileSettings } from "shared/types/fact-table";
import {
  buildExperimentFactMetricStatisticsCTE,
  StatisticsCTEDialect,
  StatisticsCTEParams,
} from "../../../../src/integrations/sql-builders/cte-builders/statistics";

// ============================================================
// Test Setup
// ============================================================

// Create BigQuery instance for testing original private methods
// @ts-expect-error - context not needed for method testing
const bqInstance = new BigQuery("", {
  settings: {},
});

// Helper to access private methods from original implementation
function getPrivateMethod<T>(methodName: string): T {
  return (bqInstance as unknown as Record<string, T>)[methodName].bind(
    bqInstance
  );
}

// Get reference to ORIGINAL method (for parity testing)
// Note: This is a public method in SqlIntegration
const originalGetExperimentFactMetricStatisticsCTE = getPrivateMethod<
  (params: StatisticsCTEParams) => string
>("getExperimentFactMetricStatisticsCTE");

// Create a dialect adapter that wraps the BigQuery instance
function createBigQueryDialectAdapter(): StatisticsCTEDialect {
  return {
    castToString: getPrivateMethod<(col: string) => string>("castToString"),
    getQuantileGridColumns: getPrivateMethod<
      (quantileSettings: MetricQuantileSettings | undefined, prefix: string) => string
    >("getQuantileGridColumns"),
  };
}

// ============================================================
// Test Fixtures
// ============================================================

function createDimensionColumn(alias: string): DimensionColumnData {
  return {
    alias,
    expression: `d.${alias}`,
  } as DimensionColumnData;
}

function createFactMetricData(
  overrides: Partial<FactMetricData> = {}
): FactMetricData {
  return {
    id: "metric_1",
    alias: "m0",
    numeratorSourceIndex: 0,
    denominatorSourceIndex: 0,
    capCoalesceMetric: "COALESCE(m.m0_value, 0)",
    capCoalesceCovariate: "COALESCE(c0.m0_covariate, 0)",
    capCoalesceDenominator: "COALESCE(m.m0_denominator, 0)",
    capCoalesceDenominatorCovariate: "COALESCE(c0.m0_denominator_covariate, 0)",
    ratioMetric: false,
    regressionAdjusted: false,
    isPercentileCapped: false,
    quantileMetric: undefined,
    metricQuantileSettings: undefined,
    ...overrides,
  } as FactMetricData;
}

function createFactTable(): FactTableInterface {
  return {
    id: "ft-1",
    name: "Events",
    description: "",
    organization: "org-1",
    datasource: "ds-1",
    userIdTypes: ["user_id"],
    sql: "SELECT user_id, timestamp, value FROM events",
    dateCreated: new Date(),
    dateUpdated: new Date(),
    columns: [],
    filters: [],
  } as FactTableInterface;
}

// ============================================================
// Unit Tests for buildExperimentFactMetricStatisticsCTE
// ============================================================

describe("buildExperimentFactMetricStatisticsCTE", () => {
  const dialect = createBigQueryDialectAdapter();

  describe("basic aggregation", () => {
    it("generates statistics CTE with basic metric", () => {
      const result = buildExperimentFactMetricStatisticsCTE(dialect, {
        dimensionCols: [],
        metricData: [createFactMetricData()],
        eventQuantileData: [],
        baseIdType: "user_id",
        joinedMetricTableName: "__userMetricAgg",
        eventQuantileTableName: "__eventQuantileMetric",
        cupedMetricTableName: "__userCovariateMetric",
        capValueTableName: "__capValue",
        factTablesWithIndices: [{ factTable: createFactTable(), index: 0 }],
        regressionAdjustedTableIndices: new Set(),
        percentileTableIndices: new Set(),
      });

      expect(result).toContain("SELECT");
      expect(result).toContain("m.variation AS variation");
      expect(result).toContain("COUNT(*) AS users");
      expect(result).toContain("m0_main_sum");
      expect(result).toContain("m0_main_sum_squares");
      expect(result).toContain("FROM");
      expect(result).toContain("__userMetricAgg m");
      expect(result).toContain("GROUP BY");
    });

    it("includes dimension columns", () => {
      const result = buildExperimentFactMetricStatisticsCTE(dialect, {
        dimensionCols: [createDimensionColumn("dim_experiment")],
        metricData: [createFactMetricData()],
        eventQuantileData: [],
        baseIdType: "user_id",
        joinedMetricTableName: "__userMetricAgg",
        eventQuantileTableName: "__eventQuantileMetric",
        cupedMetricTableName: "__userCovariateMetric",
        capValueTableName: "__capValue",
        factTablesWithIndices: [{ factTable: createFactTable(), index: 0 }],
        regressionAdjustedTableIndices: new Set(),
        percentileTableIndices: new Set(),
      });

      expect(result).toContain("m.dim_experiment AS dim_experiment");
      expect(result).toContain("GROUP BY");
      expect(result).toContain(", m.dim_experiment");
    });

    it("generates metric ID column", () => {
      const result = buildExperimentFactMetricStatisticsCTE(dialect, {
        dimensionCols: [],
        metricData: [createFactMetricData({ id: "test_metric" })],
        eventQuantileData: [],
        baseIdType: "user_id",
        joinedMetricTableName: "__userMetricAgg",
        eventQuantileTableName: "__eventQuantileMetric",
        cupedMetricTableName: "__userCovariateMetric",
        capValueTableName: "__capValue",
        factTablesWithIndices: [{ factTable: createFactTable(), index: 0 }],
        regressionAdjustedTableIndices: new Set(),
        percentileTableIndices: new Set(),
      });

      expect(result).toContain("'test_metric'");
      expect(result).toContain("m0_id");
    });
  });

  describe("ratio metrics", () => {
    it("includes denominator columns for ratio metrics", () => {
      const result = buildExperimentFactMetricStatisticsCTE(dialect, {
        dimensionCols: [],
        metricData: [createFactMetricData({ ratioMetric: true })],
        eventQuantileData: [],
        baseIdType: "user_id",
        joinedMetricTableName: "__userMetricAgg",
        eventQuantileTableName: "__eventQuantileMetric",
        cupedMetricTableName: "__userCovariateMetric",
        capValueTableName: "__capValue",
        factTablesWithIndices: [{ factTable: createFactTable(), index: 0 }],
        regressionAdjustedTableIndices: new Set(),
        percentileTableIndices: new Set(),
      });

      expect(result).toContain("m0_denominator_sum");
      expect(result).toContain("m0_denominator_sum_squares");
      expect(result).toContain("m0_main_denominator_sum_product");
    });
  });

  describe("regression adjustment (CUPED)", () => {
    it("includes covariate columns for CUPED", () => {
      const result = buildExperimentFactMetricStatisticsCTE(dialect, {
        dimensionCols: [],
        metricData: [createFactMetricData({ regressionAdjusted: true })],
        eventQuantileData: [],
        baseIdType: "user_id",
        joinedMetricTableName: "__userMetricAgg",
        eventQuantileTableName: "__eventQuantileMetric",
        cupedMetricTableName: "__userCovariateMetric",
        capValueTableName: "__capValue",
        factTablesWithIndices: [{ factTable: createFactTable(), index: 0 }],
        regressionAdjustedTableIndices: new Set([0]),
        percentileTableIndices: new Set(),
      });

      expect(result).toContain("m0_covariate_sum");
      expect(result).toContain("m0_covariate_sum_squares");
      expect(result).toContain("m0_main_covariate_sum_product");
      // For index 0, suffix is empty, so it's "c" not "c0"
      expect(result).toContain("LEFT JOIN __userCovariateMetric c ON");
    });

    it("includes full CUPED columns for ratio metrics", () => {
      const result = buildExperimentFactMetricStatisticsCTE(dialect, {
        dimensionCols: [],
        metricData: [
          createFactMetricData({ ratioMetric: true, regressionAdjusted: true }),
        ],
        eventQuantileData: [],
        baseIdType: "user_id",
        joinedMetricTableName: "__userMetricAgg",
        eventQuantileTableName: "__eventQuantileMetric",
        cupedMetricTableName: "__userCovariateMetric",
        capValueTableName: "__capValue",
        factTablesWithIndices: [{ factTable: createFactTable(), index: 0 }],
        regressionAdjustedTableIndices: new Set([0]),
        percentileTableIndices: new Set(),
      });

      expect(result).toContain("m0_denominator_pre_sum");
      expect(result).toContain("m0_main_pre_denominator_post_sum_product");
    });
  });

  describe("percentile capping", () => {
    it("includes cap value columns for percentile-capped metrics", () => {
      const result = buildExperimentFactMetricStatisticsCTE(dialect, {
        dimensionCols: [],
        metricData: [createFactMetricData({ isPercentileCapped: true })],
        eventQuantileData: [],
        baseIdType: "user_id",
        joinedMetricTableName: "__userMetricAgg",
        eventQuantileTableName: "__eventQuantileMetric",
        cupedMetricTableName: "__userCovariateMetric",
        capValueTableName: "__capValue",
        factTablesWithIndices: [{ factTable: createFactTable(), index: 0 }],
        regressionAdjustedTableIndices: new Set(),
        percentileTableIndices: new Set([0]),
      });

      expect(result).toContain("m0_main_cap_value");
      expect(result).toContain("CROSS JOIN __capValue cap");
    });
  });

  describe("multiple fact tables", () => {
    it("joins additional fact tables", () => {
      const result = buildExperimentFactMetricStatisticsCTE(dialect, {
        dimensionCols: [],
        metricData: [createFactMetricData()],
        eventQuantileData: [],
        baseIdType: "user_id",
        joinedMetricTableName: "__userMetricAgg",
        eventQuantileTableName: "__eventQuantileMetric",
        cupedMetricTableName: "__userCovariateMetric",
        capValueTableName: "__capValue",
        factTablesWithIndices: [
          { factTable: createFactTable(), index: 0 },
          { factTable: createFactTable(), index: 1 },
        ],
        regressionAdjustedTableIndices: new Set(),
        percentileTableIndices: new Set(),
      });

      expect(result).toContain("LEFT JOIN __userMetricAgg1 m1");
    });
  });
});

// ============================================================
// PARITY TESTS: Verify extracted code matches original
// ============================================================

describe("Parity Tests: buildExperimentFactMetricStatisticsCTE vs Original", () => {
  const dialect = createBigQueryDialectAdapter();

  // Helper to normalize SQL for comparison
  function normalizeSQL(sql: string): string {
    return sql.replace(/\s+/g, " ").trim();
  }

  const parityTestCases = [
    {
      name: "basic metric without dimensions",
      params: {
        dimensionCols: [],
        metricData: [createFactMetricData()],
        eventQuantileData: [],
        baseIdType: "user_id",
        joinedMetricTableName: "__userMetricAgg",
        eventQuantileTableName: "__eventQuantileMetric",
        cupedMetricTableName: "__userCovariateMetric",
        capValueTableName: "__capValue",
        factTablesWithIndices: [{ factTable: createFactTable(), index: 0 }],
        regressionAdjustedTableIndices: new Set<number>(),
        percentileTableIndices: new Set<number>(),
      },
    },
    {
      name: "metric with dimension",
      params: {
        dimensionCols: [createDimensionColumn("dim_exp")],
        metricData: [createFactMetricData()],
        eventQuantileData: [],
        baseIdType: "user_id",
        joinedMetricTableName: "__userMetricAgg",
        eventQuantileTableName: "__eventQuantileMetric",
        cupedMetricTableName: "__userCovariateMetric",
        capValueTableName: "__capValue",
        factTablesWithIndices: [{ factTable: createFactTable(), index: 0 }],
        regressionAdjustedTableIndices: new Set<number>(),
        percentileTableIndices: new Set<number>(),
      },
    },
    {
      name: "ratio metric",
      params: {
        dimensionCols: [],
        metricData: [createFactMetricData({ ratioMetric: true })],
        eventQuantileData: [],
        baseIdType: "user_id",
        joinedMetricTableName: "__userMetricAgg",
        eventQuantileTableName: "__eventQuantileMetric",
        cupedMetricTableName: "__userCovariateMetric",
        capValueTableName: "__capValue",
        factTablesWithIndices: [{ factTable: createFactTable(), index: 0 }],
        regressionAdjustedTableIndices: new Set<number>(),
        percentileTableIndices: new Set<number>(),
      },
    },
  ];

  parityTestCases.forEach(({ name, params }) => {
    it(`matches original for: ${name}`, () => {
      // Get result from original implementation
      const originalResult = originalGetExperimentFactMetricStatisticsCTE(params);

      // Get result from extracted implementation
      const extractedResult = buildExperimentFactMetricStatisticsCTE(
        dialect,
        params
      );

      // Compare normalized SQL
      expect(normalizeSQL(extractedResult)).toBe(normalizeSQL(originalResult));
    });
  });
});
