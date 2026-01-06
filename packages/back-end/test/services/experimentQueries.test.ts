import { FactMetricInterface } from "shared/types/fact-table";
import {
  chunkMetrics,
  maxColumnsNeededForMetric,
} from "back-end/src/services/experimentQueries/experimentQueries";
import { MAX_METRICS_PER_QUERY } from "back-end/src/services/experimentQueries/constants";
import { factMetricFactory } from "../factories/FactMetric.factory";

describe("experimentQueries", () => {
  describe("maxColumnsNeededForMetric", () => {
    describe("mean metrics", () => {
      it("should correct N of columns for a mean metric", () => {
        const metric = factMetricFactory.build({
          metricType: "mean",
          numerator: { factTableId: "ft_1" },
        });
        // 1 (id) + 2 (BASE_METRIC_FLOAT_COLS: main_sum, main_sum_squares) = 3

        const baseExpectedCols = 3;
        expect(
          maxColumnsNeededForMetric({
            metric,
            regressionAdjusted: false,
            isBandit: false,
          }),
        ).toBe(baseExpectedCols);

        expect(
          maxColumnsNeededForMetric({
            metric,
            regressionAdjusted: true,
            isBandit: false,
          }),
        ).toBe(baseExpectedCols + 3);

        expect(
          maxColumnsNeededForMetric({
            metric,
            regressionAdjusted: true,
            isBandit: true,
          }),
        ).toBe(baseExpectedCols + 4);
      });

      it("should return 4 columns for mean metric with percentile capping", () => {
        const metric = factMetricFactory.build({
          metricType: "mean",
          numerator: { factTableId: "ft_1" },
          cappingSettings: { type: "percentile", value: 0.99 },
        });
        // 1 (id) + 2 (base) + 1 (BASE_METRIC_PERCENTILE_CAPPING_FLOAT_COLS) = 4
        expect(
          maxColumnsNeededForMetric({
            metric,
            regressionAdjusted: false,
            isBandit: false,
          }),
        ).toBe(4);
      });
    });
  });

  describe("chunkMetrics", () => {
    // Base columns needed for each query (dimensions + variation + users + count)
    const baseColumnsNeeded = 103;

    // Helper to wrap metrics with regressionAdjusted flag
    const wrapMetrics = (
      metrics: FactMetricInterface[],
      regressionAdjusted: boolean,
    ) => metrics.map((metric) => ({ metric, regressionAdjusted }));

    describe("quantile metrics chunking", () => {
      it("should chunk 100 quantile metrics into appropriate number of chunks given 1000 column limit", () => {
        const maxColumnsPerQuery = 1000;
        const quantileColsNeeded = maxColumnsNeededForMetric({
          metric: factMetricFactory.build({
            metricType: "quantile",
            numerator: { factTableId: "ft_1" },
          }),
          regressionAdjusted: false,
          isBandit: false,
        });

        // Create 100 quantile metrics
        const metrics: FactMetricInterface[] = [];
        for (let i = 0; i < 100; i++) {
          metrics.push(
            factMetricFactory.build({
              metricType: "quantile",
              numerator: { factTableId: "ft_1" },
            }),
          );
        }

        const chunks = chunkMetrics({
          metrics: wrapMetrics(metrics, false),
          maxColumnsPerQuery,
          isBandit: false,
        });

        // Calculate expected metrics per chunk
        // Available columns = maxColumnsPerQuery - baseColumnsNeeded = 897
        // Each quantile metric needs 48 columns (without CUPED)
        // Metrics per chunk = floor(897 / 48) = 18
        const availableColumns = maxColumnsPerQuery - baseColumnsNeeded;
        const metricsPerChunk = Math.floor(
          availableColumns / quantileColsNeeded,
        );
        expect(metricsPerChunk).toBe(18);

        // Verify all metrics are present across chunks
        const totalMetricsInChunks = chunks.reduce(
          (sum, chunk) => sum + chunk.length,
          0,
        );
        expect(totalMetricsInChunks).toBe(100);

        // Calculate expected number of chunks
        // 100 metrics / 18 per chunk = 6 chunks
        const expectedChunks = Math.ceil(100 / metricsPerChunk);
        expect(chunks.length).toBe(expectedChunks);

        // Verify each chunk (except possibly the last) has expected number of metrics
        for (let i = 0; i < chunks.length - 1; i++) {
          expect(chunks[i].length).toBe(metricsPerChunk);
        }
      });
    });

    describe("mixed mean and ratio metrics chunking", () => {
      it("should chunk 100 mean + 100 ratio metrics into appropriate number of chunks given 1000 column limit", () => {
        const maxColumnsPerQuery = 1000;

        // Create 100 mean metrics followed by 100 ratio metrics
        const metrics: FactMetricInterface[] = [];
        for (let i = 0; i < 100; i++) {
          metrics.push(
            factMetricFactory.build({
              metricType: "mean",
              numerator: { factTableId: "ft_1" },
            }),
          );
        }
        for (let i = 0; i < 100; i++) {
          metrics.push(
            factMetricFactory.build({
              metricType: "ratio",
              numerator: { factTableId: "ft_1" },
              denominator: { factTableId: "ft_1" },
            }),
          );
        }

        const chunks = chunkMetrics({
          metrics: wrapMetrics(metrics, false),
          maxColumnsPerQuery,
          isBandit: false,
        });

        // Verify chunks are created
        expect(chunks.length).toBeGreaterThan(0);

        // Verify no chunk exceeds column limit
        chunks.forEach((chunk) => {
          const totalCols =
            baseColumnsNeeded +
            chunk.reduce(
              (sum, m) =>
                sum +
                maxColumnsNeededForMetric({
                  metric: m,
                  regressionAdjusted: false,
                  isBandit: false,
                }),
              0,
            );
          expect(totalCols).toBeLessThanOrEqual(maxColumnsPerQuery);
        });

        // Verify no chunk exceeds metric limit
        chunks.forEach((chunk) => {
          expect(chunk.length).toBeLessThanOrEqual(MAX_METRICS_PER_QUERY);
        });

        // Verify all 200 metrics are present across chunks
        const totalMetricsInChunks = chunks.reduce(
          (sum, chunk) => sum + chunk.length,
          0,
        );
        expect(totalMetricsInChunks).toBe(200);

        // Mean = 3 cols, Ratio = 6 cols
        // 100 mean metrics = 300 cols, 100 ratio metrics = 600 cols
        // With 897 available per chunk, that means we need two chunks
        expect(chunks.length).toEqual(2);
        expect(chunks[0].length).toEqual(199);
        expect(chunks[1].length).toEqual(1);
      });

      it("should handle mixed metrics with CUPED enabled", () => {
        const maxColumnsPerQuery = 1000;

        const metrics: FactMetricInterface[] = [];
        for (let i = 0; i < 50; i++) {
          metrics.push(
            factMetricFactory.build({
              metricType: "mean",
              numerator: { factTableId: "ft_1" },
            }),
          );
          metrics.push(
            factMetricFactory.build({
              metricType: "ratio",
              numerator: { factTableId: "ft_1" },
              denominator: { factTableId: "ft_1" },
            }),
          );
        }

        const chunks = chunkMetrics({
          metrics: wrapMetrics(metrics, true),
          maxColumnsPerQuery,
          isBandit: false,
        });

        // Mean with CUPED = 6 cols, Ratio with CUPED = 15 cols
        // Average = 10.5 cols per metric
        // 100 metrics * 10.5 = 1050 cols total
        // With 897 available per chunk, need ~2 chunks
        expect(chunks.length).toEqual(2);

        // Verify all metrics present
        const totalMetrics = chunks.reduce(
          (sum, chunk) => sum + chunk.length,
          0,
        );
        expect(totalMetrics).toBe(100);
      });
    });

    describe("edge cases", () => {
      it("should handle empty metrics array", () => {
        const chunks = chunkMetrics({
          metrics: [],
          maxColumnsPerQuery: 1000,
          isBandit: false,
        });
        expect(chunks).toEqual([]);
      });

      it("should handle single metric", () => {
        const metrics = [
          factMetricFactory.build({
            metricType: "mean",
            numerator: { factTableId: "ft_1" },
          }),
        ];

        const chunks = chunkMetrics({
          metrics: wrapMetrics(metrics, false),
          maxColumnsPerQuery: 1000,
          isBandit: false,
        });
        expect(chunks.length).toBe(1);
        expect(chunks[0].length).toBe(1);
      });

      it("should handle very restrictive column limit", () => {
        const quantileColsNeeded = maxColumnsNeededForMetric({
          metric: factMetricFactory.build({
            metricType: "quantile",
            numerator: { factTableId: "ft_1" },
          }),
          regressionAdjusted: false,
          isBandit: false,
        });
        // Set max columns so only 1 quantile metric fits per chunk
        const maxColumnsPerQuery = baseColumnsNeeded + quantileColsNeeded + 1;

        const metrics: FactMetricInterface[] = [];
        for (let i = 0; i < 5; i++) {
          metrics.push(
            factMetricFactory.build({
              metricType: "quantile",
              numerator: { factTableId: "ft_1" },
            }),
          );
        }

        const chunks = chunkMetrics({
          metrics: wrapMetrics(metrics, false),
          maxColumnsPerQuery,
          isBandit: false,
        });

        // Each metric should be in its own chunk
        expect(chunks.length).toBe(5);
        chunks.forEach((chunk) => {
          expect(chunk.length).toBe(1);
        });
      });
    });
  });
});
