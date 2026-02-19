/**
 * Tests for Experiment Metrics Query Generator
 *
 * Tests the experiment metrics query structure and helper functions.
 */

import {
  generateDistinctUsersCTE,
  generateMetricStatisticsColumns,
  generateExperimentStatisticsSelect,
  generateConversionWindowFilter,
  generateQueryComment,
  DimensionColumnData,
  DistinctUsersParams,
  MetricStatisticsColumns,
  ConversionWindowFilter,
} from "../../../../src/integrations/sql-builders/query-generators/experiment-metrics";
import { bigQueryDialect } from "../../../../src/integrations/sql-dialects";
import { postgresDialect } from "../../../../src/integrations/sql-dialects/postgres-dialect";

describe("Experiment Metrics Query Generator", () => {
  describe("generateDistinctUsersCTE", () => {
    const baseParams: DistinctUsersParams = {
      baseIdType: "user_id",
      dimensionCols: [],
      timestampColumn: "first_exposure_timestamp",
      sourceTable: "__experimentUnits",
      whereConditions: [],
      includeBanditPeriod: false,
    };

    it("should generate basic distinct users CTE", () => {
      const cte = generateDistinctUsersCTE(baseParams, bigQueryDialect);

      expect(cte).toContain("SELECT");
      expect(cte).toContain("user_id");
      expect(cte).toContain("variation");
      expect(cte).toContain("timestamp");
      expect(cte).toContain("first_exposure_date");
      expect(cte).toContain("FROM __experimentUnits");
    });

    it("should include dimension columns", () => {
      const params: DistinctUsersParams = {
        ...baseParams,
        dimensionCols: [
          { value: "country", alias: "dim_country" },
          { value: "platform", alias: "dim_platform" },
        ],
      };

      const cte = generateDistinctUsersCTE(params, bigQueryDialect);

      expect(cte).toContain("country AS dim_country");
      expect(cte).toContain("platform AS dim_platform");
    });

    it("should include WHERE conditions", () => {
      const params: DistinctUsersParams = {
        ...baseParams,
        whereConditions: [
          "first_activation_timestamp IS NOT NULL",
          "timestamp <= '2024-01-31'",
        ],
      };

      const cte = generateDistinctUsersCTE(params, bigQueryDialect);

      expect(cte).toContain("WHERE");
      expect(cte).toContain("first_activation_timestamp IS NOT NULL");
      expect(cte).toContain("AND");
      expect(cte).toContain("timestamp <= '2024-01-31'");
    });

    it("should include bandit case-when when specified", () => {
      const params: DistinctUsersParams = {
        ...baseParams,
        includeBanditPeriod: true,
        banditCaseWhen: ", CASE WHEN timestamp < '2024-01-15' THEN 0 ELSE 1 END AS bandit_period",
      };

      const cte = generateDistinctUsersCTE(params, bigQueryDialect);

      expect(cte).toContain("bandit_period");
    });

    it("should include regression adjustment columns", () => {
      const params: DistinctUsersParams = {
        ...baseParams,
        raMetricSettings: [
          { alias: "m0", hours: 24, minDelay: 0 },
          { alias: "m1", hours: 48, minDelay: -24 },
        ],
      };

      const cte = generateDistinctUsersCTE(params, bigQueryDialect);

      expect(cte).toContain("min_preexposure_start");
      expect(cte).toContain("max_preexposure_end");
      expect(cte).toContain("m0_preexposure_end");
      expect(cte).toContain("m0_preexposure_start");
      expect(cte).toContain("m1_preexposure_end");
      expect(cte).toContain("m1_preexposure_start");
    });

    it("should use correct timestamp column", () => {
      const params: DistinctUsersParams = {
        ...baseParams,
        timestampColumn: "first_activation_timestamp",
      };

      const cte = generateDistinctUsersCTE(params, bigQueryDialect);

      expect(cte).toContain("first_activation_timestamp AS timestamp");
    });

    it("should use correct source table", () => {
      const params: DistinctUsersParams = {
        ...baseParams,
        sourceTable: "my_experiment_units_table",
      };

      const cte = generateDistinctUsersCTE(params, bigQueryDialect);

      expect(cte).toContain("FROM my_experiment_units_table");
    });
  });

  describe("generateMetricStatisticsColumns", () => {
    const baseMetric: MetricStatisticsColumns = {
      idColumn: "metric_123",
      isPercentileCapped: false,
      mainSumExpression: "m.m0_value",
      mainSumSquaresExpression: "m.m0_value",
      isRatioMetric: false,
      isRegressionAdjusted: false,
      isQuantileMetric: false,
      alias: "m0",
    };

    it("should generate basic metric statistics columns", () => {
      const columns = generateMetricStatisticsColumns(
        baseMetric,
        bigQueryDialect
      );

      expect(columns).toContain("m0_id");
      expect(columns).toContain("m0_main_sum");
      expect(columns).toContain("m0_main_sum_squares");
      expect(columns).toContain("SUM(m.m0_value)");
      expect(columns).toContain("SUM(POWER(m.m0_value, 2))");
    });

    it("should include cap value for percentile-capped metrics", () => {
      const metric: MetricStatisticsColumns = {
        ...baseMetric,
        isPercentileCapped: true,
        capValueExpression: "COALESCE(cap.m0_value_cap, 0)",
      };

      const columns = generateMetricStatisticsColumns(metric, bigQueryDialect);

      expect(columns).toContain("m0_main_cap_value");
      expect(columns).toContain("MAX(COALESCE(cap.m0_value_cap, 0))");
    });

    it("should include denominator columns for ratio metrics", () => {
      const metric: MetricStatisticsColumns = {
        ...baseMetric,
        isRatioMetric: true,
        denominatorSumExpression: "m.m0_denominator",
        denominatorSumSquaresExpression: "m.m0_denominator",
        mainDenominatorSumProductExpression: "m.m0_value * m.m0_denominator",
      };

      const columns = generateMetricStatisticsColumns(metric, bigQueryDialect);

      expect(columns).toContain("m0_denominator_sum");
      expect(columns).toContain("m0_denominator_sum_squares");
      expect(columns).toContain("m0_main_denominator_sum_product");
    });

    it("should include covariate columns for regression-adjusted metrics", () => {
      const metric: MetricStatisticsColumns = {
        ...baseMetric,
        isRegressionAdjusted: true,
        covariateSumExpression: "c.m0_value",
        covariateSumSquaresExpression: "c.m0_value",
        mainCovariateSumProductExpression: "m.m0_value * c.m0_value",
      };

      const columns = generateMetricStatisticsColumns(metric, bigQueryDialect);

      expect(columns).toContain("m0_covariate_sum");
      expect(columns).toContain("m0_covariate_sum_squares");
      expect(columns).toContain("m0_main_covariate_sum_product");
    });

    it("should include all columns for capped ratio metrics with CUPED", () => {
      const metric: MetricStatisticsColumns = {
        ...baseMetric,
        isPercentileCapped: true,
        capValueExpression: "COALESCE(cap.m0_value_cap, 0)",
        isRatioMetric: true,
        denominatorSumExpression: "m.m0_denominator",
        denominatorSumSquaresExpression: "m.m0_denominator",
        denominatorCapValueExpression: "COALESCE(cap.m0_denominator_cap, 0)",
        isRegressionAdjusted: true,
        covariateSumExpression: "c.m0_value",
        covariateSumSquaresExpression: "c.m0_value",
      };

      const columns = generateMetricStatisticsColumns(metric, bigQueryDialect);

      expect(columns).toContain("m0_main_cap_value");
      expect(columns).toContain("m0_denominator_cap_value");
      expect(columns).toContain("m0_covariate_sum");
    });
  });

  describe("generateExperimentStatisticsSelect", () => {
    it("should generate statistics select with COUNT", () => {
      const select = generateExperimentStatisticsSelect(
        {
          dimensionCols: [],
          metrics: [
            {
              idColumn: "m1",
              isPercentileCapped: false,
              mainSumExpression: "m.m0_value",
              mainSumSquaresExpression: "m.m0_value",
              isRatioMetric: false,
              isRegressionAdjusted: false,
              isQuantileMetric: false,
              alias: "m0",
            },
          ],
          baseIdType: "user_id",
          joinedMetricTableName: "__userMetricAgg",
          additionalJoins: [],
        },
        bigQueryDialect
      );

      expect(select).toContain("SELECT");
      expect(select).toContain("m.variation AS variation");
      expect(select).toContain("COUNT(*) AS users");
      expect(select).toContain("FROM");
      expect(select).toContain("__userMetricAgg m");
      expect(select).toContain("GROUP BY");
      expect(select).toContain("m.variation");
    });

    it("should include dimension columns in SELECT and GROUP BY", () => {
      const dimensionCols: DimensionColumnData[] = [
        { value: "country", alias: "dim_country" },
      ];

      const select = generateExperimentStatisticsSelect(
        {
          dimensionCols,
          metrics: [],
          baseIdType: "user_id",
          joinedMetricTableName: "__userMetricAgg",
          additionalJoins: [],
        },
        bigQueryDialect
      );

      expect(select).toContain("m.dim_country AS dim_country");
      expect(select).toContain(", m.dim_country");
    });

    it("should include additional joins", () => {
      const select = generateExperimentStatisticsSelect(
        {
          dimensionCols: [],
          metrics: [],
          baseIdType: "user_id",
          joinedMetricTableName: "__userMetricAgg",
          additionalJoins: [
            "LEFT JOIN __capValue cap ON (cap.user_id = m.user_id)",
          ],
        },
        bigQueryDialect
      );

      expect(select).toContain("LEFT JOIN __capValue cap");
    });
  });

  describe("generateConversionWindowFilter", () => {
    const baseParams: ConversionWindowFilter = {
      valueColumn: "m.value",
      metricTimestampColumn: "m.timestamp",
      exposureTimestampColumn: "d.timestamp",
      overrideConversionWindows: false,
      endDate: new Date("2024-01-31T23:59:59Z"),
    };

    it("should return simple end date filter when overriding windows", () => {
      const params: ConversionWindowFilter = {
        ...baseParams,
        overrideConversionWindows: true,
      };

      const filter = generateConversionWindowFilter(params, bigQueryDialect);

      expect(filter).toContain("CASE WHEN");
      expect(filter).toContain("m.timestamp <=");
      expect(filter).toContain("2024-01-31");
      expect(filter).toContain("THEN m.value ELSE NULL END");
    });

    it("should include conversion window start condition", () => {
      const params: ConversionWindowFilter = {
        ...baseParams,
        conversionWindowStart: 1, // 1 hour after exposure
      };

      const filter = generateConversionWindowFilter(params, bigQueryDialect);

      expect(filter).toContain("m.timestamp >=");
      expect(filter).toContain("d.timestamp");
    });

    it("should include conversion window end condition", () => {
      const params: ConversionWindowFilter = {
        ...baseParams,
        conversionWindowEnd: 24, // 24 hours after exposure
      };

      const filter = generateConversionWindowFilter(params, bigQueryDialect);

      expect(filter).toContain("m.timestamp <=");
      expect(filter).toContain("d.timestamp");
    });

    it("should combine multiple conditions with AND", () => {
      const params: ConversionWindowFilter = {
        ...baseParams,
        conversionWindowStart: 1,
        conversionWindowEnd: 72,
      };

      const filter = generateConversionWindowFilter(params, bigQueryDialect);

      expect(filter).toContain("AND");
      expect(filter).toContain("m.timestamp >=");
      expect(filter).toContain("m.timestamp <=");
    });

    it("should always include end date condition", () => {
      const filter = generateConversionWindowFilter(baseParams, bigQueryDialect);

      expect(filter).toContain("2024-01-31");
    });
  });

  describe("generateQueryComment", () => {
    it("should generate comment for single fact table", () => {
      const comment = generateQueryComment(["events"]);

      expect(comment).toBe("-- Fact Table: events");
    });

    it("should generate comment for multiple fact tables", () => {
      const comment = generateQueryComment(["events", "purchases", "sessions"]);

      expect(comment).toBe("-- Cross-Fact Table Metrics: events & purchases & sessions");
    });
  });

  describe("Cross-dialect support", () => {
    it("should work with BigQuery dialect", () => {
      const cte = generateDistinctUsersCTE(
        {
          baseIdType: "user_id",
          dimensionCols: [],
          timestampColumn: "timestamp",
          sourceTable: "__units",
          whereConditions: [],
          includeBanditPeriod: false,
        },
        bigQueryDialect
      );

      expect(cte).toContain("user_id");
      expect(cte).toContain("FROM __units");
    });

    it("should work with Postgres dialect", () => {
      const cte = generateDistinctUsersCTE(
        {
          baseIdType: "user_id",
          dimensionCols: [],
          timestampColumn: "timestamp",
          sourceTable: "__units",
          whereConditions: [],
          includeBanditPeriod: false,
        },
        postgresDialect
      );

      expect(cte).toContain("user_id");
      expect(cte).toContain("FROM __units");
    });
  });
});
