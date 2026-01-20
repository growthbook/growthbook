/**
 * Tests for Metric Analysis Query Generator
 *
 * Tests the metric analysis query structure and helper functions.
 */

import {
  generateMetricAnalysisStatisticClauses,
  generateHistogramBins,
  generateHistogramPlaceholders,
  generateDailyStatisticsCTE,
  generateOverallStatisticsCTE,
  generateHistogramCTE,
  DEFAULT_METRIC_HISTOGRAM_BINS,
  MetricAnalysisStatisticsConfig,
} from "../../../../src/integrations/sql-builders/query-generators/metric-analysis";
import { bigQueryDialect } from "../../../../src/integrations/sql-dialects";
import { postgresDialect } from "../../../../src/integrations/sql-dialects/postgres-dialect";

describe("Metric Analysis Query Generator", () => {
  describe("Constants", () => {
    it("should have DEFAULT_METRIC_HISTOGRAM_BINS = 20", () => {
      expect(DEFAULT_METRIC_HISTOGRAM_BINS).toBe(20);
    });
  });

  describe("generateMetricAnalysisStatisticClauses", () => {
    it("should generate basic statistics for non-ratio metrics", () => {
      const config: MetricAnalysisStatisticsConfig = {
        isRatioMetric: false,
        valueColumn: "value",
        createHistogram: false,
        isCapped: false,
      };

      const clauses = generateMetricAnalysisStatisticClauses(config);

      expect(clauses).toContain("COUNT(*)");
      expect(clauses).toContain("SUM(value)");
      expect(clauses).toContain("SUM(POWER(value, 2))");
      expect(clauses).toContain("main_sum");
      expect(clauses).toContain("main_sum_squares");
    });

    it("should include denominator statistics for ratio metrics", () => {
      const config: MetricAnalysisStatisticsConfig = {
        isRatioMetric: true,
        valueColumn: "value",
        denominatorColumn: "denominator",
        createHistogram: false,
        isCapped: false,
      };

      const clauses = generateMetricAnalysisStatisticClauses(config);

      expect(clauses).toContain("SUM(denominator)");
      expect(clauses).toContain("SUM(POWER(denominator, 2))");
      expect(clauses).toContain("denominator_sum");
      expect(clauses).toContain("denominator_sum_squares");
      expect(clauses).toContain("main_denominator_sum_product");
    });

    it("should handle capped value columns", () => {
      const config: MetricAnalysisStatisticsConfig = {
        isRatioMetric: false,
        valueColumn: "COALESCE(cap.value_capped, value)",
        createHistogram: false,
        isCapped: true,
      };

      const clauses = generateMetricAnalysisStatisticClauses(config);

      expect(clauses).toContain("COALESCE(cap.value_capped, value)");
    });
  });

  describe("generateHistogramBins", () => {
    it("should generate the correct number of bins", () => {
      const bins = generateHistogramBins(bigQueryDialect, 10);

      // Should have all 10 bin columns
      for (let i = 0; i < 10; i++) {
        expect(bins).toContain(`units_bin_${i}`);
      }
    });

    it("should use dialect ifElse for bin conditions", () => {
      const bins = generateHistogramBins(bigQueryDialect, 5);

      // BigQuery uses CASE WHEN
      expect(bins).toContain("CASE WHEN");
      expect(bins).toContain("THEN");
      expect(bins).toContain("ELSE");
    });

    it("should use default bin count when not specified", () => {
      const bins = generateHistogramBins(bigQueryDialect);

      // Should have 20 bins by default
      expect(bins).toContain("units_bin_0");
      expect(bins).toContain(`units_bin_${DEFAULT_METRIC_HISTOGRAM_BINS - 1}`);
    });

    it("should create first bin for values less than min + width", () => {
      const bins = generateHistogramBins(bigQueryDialect, 5);

      expect(bins).toContain("m.value < (s.value_min + s.bin_width)");
      expect(bins).toContain("units_bin_0");
    });

    it("should create last bin for values >= final threshold", () => {
      const bins = generateHistogramBins(bigQueryDialect, 5);

      expect(bins).toContain("m.value >= (s.value_min + s.bin_width*4.0)");
      expect(bins).toContain("units_bin_4");
    });
  });

  describe("generateHistogramPlaceholders", () => {
    it("should generate NULL placeholders for all bins", () => {
      const placeholders = generateHistogramPlaceholders(bigQueryDialect, 5);

      for (let i = 0; i < 5; i++) {
        expect(placeholders).toContain(`units_bin_${i}`);
      }
    });

    it("should use dialect ensureFloat for NULL values", () => {
      const placeholders = generateHistogramPlaceholders(bigQueryDialect, 3);

      // BigQuery ensureFloat on NULL returns NULL (unchanged)
      expect(placeholders).toContain("NULL");
    });

    it("should use default bin count when not specified", () => {
      const placeholders = generateHistogramPlaceholders(bigQueryDialect);

      expect(placeholders).toContain("units_bin_0");
      expect(placeholders).toContain(`units_bin_${DEFAULT_METRIC_HISTOGRAM_BINS - 1}`);
    });
  });

  describe("generateDailyStatisticsCTE", () => {
    const baseConfig: MetricAnalysisStatisticsConfig = {
      isRatioMetric: false,
      valueColumn: "value",
      createHistogram: false,
      isCapped: false,
    };

    it("should generate daily statistics CTE", () => {
      const cte = generateDailyStatisticsCTE(baseConfig, bigQueryDialect, {
        sourceTable: "__userMetricDaily",
        useCapTable: false,
      });

      expect(cte).toContain("SELECT");
      expect(cte).toContain("date");
      expect(cte).toContain("data_type");
      expect(cte).toContain("capped");
      expect(cte).toContain("GROUP BY date");
      expect(cte).toContain("__userMetricDaily");
    });

    it("should include histogram placeholders when createHistogram is true", () => {
      const config: MetricAnalysisStatisticsConfig = {
        ...baseConfig,
        createHistogram: true,
      };

      const cte = generateDailyStatisticsCTE(config, bigQueryDialect, {
        sourceTable: "__userMetricDaily",
        useCapTable: false,
      });

      expect(cte).toContain("value_min");
      expect(cte).toContain("value_max");
      expect(cte).toContain("bin_width");
      expect(cte).toContain("units_bin_0");
    });

    it("should add CROSS JOIN when cap table is used", () => {
      const cte = generateDailyStatisticsCTE(baseConfig, bigQueryDialect, {
        sourceTable: "__userMetricDaily",
        useCapTable: true,
      });

      expect(cte).toContain("CROSS JOIN __capValue cap");
    });

    it("should set capped status correctly", () => {
      const cappedConfig: MetricAnalysisStatisticsConfig = {
        ...baseConfig,
        isCapped: true,
      };

      const cte = generateDailyStatisticsCTE(cappedConfig, bigQueryDialect, {
        sourceTable: "__userMetricDaily",
        useCapTable: false,
      });

      expect(cte).toContain("'capped'");
    });
  });

  describe("generateOverallStatisticsCTE", () => {
    const baseConfig: MetricAnalysisStatisticsConfig = {
      isRatioMetric: false,
      valueColumn: "value",
      createHistogram: false,
      isCapped: false,
    };

    it("should generate overall statistics CTE with NULL date", () => {
      const cte = generateOverallStatisticsCTE(baseConfig, bigQueryDialect, {
        sourceTable: "__userMetricOverall",
        useCapTable: false,
      });

      expect(cte).toContain("SELECT");
      expect(cte).toContain("NULL");
      expect(cte).toContain("date");
      expect(cte).toContain("data_type");
      expect(cte).toContain("'overall'");
    });

    it("should include bin_width calculation when createHistogram is true", () => {
      const config: MetricAnalysisStatisticsConfig = {
        ...baseConfig,
        createHistogram: true,
      };

      const cte = generateOverallStatisticsCTE(config, bigQueryDialect, {
        sourceTable: "__userMetricOverall",
        useCapTable: false,
      });

      expect(cte).toContain("value_min");
      expect(cte).toContain("value_max");
      expect(cte).toContain("bin_width");
      // Should calculate bin_width, not use NULL
      expect(cte).toContain("(MAX");
      expect(cte).toContain("MIN");
    });

    it("should add CROSS JOIN when cap table is used", () => {
      const cte = generateOverallStatisticsCTE(baseConfig, bigQueryDialect, {
        sourceTable: "__userMetricOverall",
        useCapTable: true,
      });

      expect(cte).toContain("CROSS JOIN __capValue cap");
    });
  });

  describe("generateHistogramCTE", () => {
    it("should generate histogram CTE with CROSS JOIN", () => {
      const cte = generateHistogramCTE(bigQueryDialect, {
        sourceTable: "__userMetricOverall",
        statisticsTable: "__statisticsOverall",
      });

      expect(cte).toContain("SELECT");
      expect(cte).toContain("FROM");
      expect(cte).toContain("__userMetricOverall");
      expect(cte).toContain("CROSS JOIN");
      expect(cte).toContain("__statisticsOverall");
    });

    it("should include histogram bin calculations", () => {
      const cte = generateHistogramCTE(bigQueryDialect, {
        sourceTable: "__userMetricOverall",
        statisticsTable: "__statisticsOverall",
      });

      expect(cte).toContain("units_bin_0");
      expect(cte).toContain("m.value");
      expect(cte).toContain("s.value_min");
      expect(cte).toContain("s.bin_width");
    });
  });

  describe("Cross-dialect support", () => {
    const baseConfig: MetricAnalysisStatisticsConfig = {
      isRatioMetric: false,
      valueColumn: "value",
      createHistogram: true,
      isCapped: false,
    };

    it("should work with Postgres dialect", () => {
      const cte = generateDailyStatisticsCTE(baseConfig, postgresDialect, {
        sourceTable: "__userMetricDaily",
        useCapTable: false,
      });

      expect(cte).toContain("SELECT");
      expect(cte).toContain("date");
    });

    it("should use dialect-specific casting", () => {
      const bigqueryCte = generateOverallStatisticsCTE(
        baseConfig,
        bigQueryDialect,
        { sourceTable: "__test", useCapTable: false }
      );

      const postgresCte = generateOverallStatisticsCTE(
        baseConfig,
        postgresDialect,
        { sourceTable: "__test", useCapTable: false }
      );

      // Both should have the basic structure
      expect(bigqueryCte).toContain("date");
      expect(postgresCte).toContain("date");

      // BigQuery uses cast(... as string), Postgres uses cast(... as varchar)
      expect(bigqueryCte).toContain("cast");
      expect(postgresCte).toContain("cast");
    });
  });

  describe("Ratio metrics", () => {
    it("should include denominator in daily statistics for ratio metrics", () => {
      const config: MetricAnalysisStatisticsConfig = {
        isRatioMetric: true,
        valueColumn: "value",
        denominatorColumn: "denominator",
        createHistogram: false,
        isCapped: false,
      };

      const cte = generateDailyStatisticsCTE(config, bigQueryDialect, {
        sourceTable: "__userMetricDaily",
        useCapTable: false,
      });

      expect(cte).toContain("denominator_sum");
      expect(cte).toContain("denominator_sum_squares");
      expect(cte).toContain("main_denominator_sum_product");
    });
  });
});
