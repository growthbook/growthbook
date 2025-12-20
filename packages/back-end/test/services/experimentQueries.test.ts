import {
  chunkMetrics,
  maxColumnsNeededForMetricType,
} from "back-end/src/services/experimentQueries/experimentQueries";
import { MAX_METRICS_PER_QUERY } from "back-end/src/services/experimentQueries/constants";
import { FactMetricInterface } from "back-end/types/fact-table";
import { factMetricFactory } from "../factories/FactMetric.factory";

describe("experimentQueries", () => {
  describe("chunkMetrics", () => {
    // Base columns needed for each query (dimensions + variation + users + count)
    const baseColumnsNeeded = 103;

    describe("quantile metrics chunking", () => {
      it("should chunk 100 quantile metrics into appropriate number of chunks given 1000 column limit", () => {
        const maxColumnsPerQuery = 1000;
        const quantileColsNeeded = maxColumnsNeededForMetricType("quantile");

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

        const chunks = chunkMetrics(metrics, maxColumnsPerQuery);

        // Calculate expected metrics per chunk
        // Available columns = maxColumnsPerQuery - baseColumnsNeeded = 897
        // Each quantile metric needs 60 columns
        // Metrics per chunk = floor(897 / 60) = 14
        const availableColumns = maxColumnsPerQuery - baseColumnsNeeded;
        const metricsPerChunk = Math.floor(
          availableColumns / quantileColsNeeded,
        );
        expect(metricsPerChunk).toBe(14);

        // Verify chunks are created
        expect(chunks.length).toBeGreaterThan(0);

        // Verify no chunk exceeds column limit
        chunks.forEach((chunk) => {
          const totalCols =
            baseColumnsNeeded +
            chunk.reduce(
              (sum, m) => sum + maxColumnsNeededForMetricType(m.metricType),
              0,
            );
          expect(totalCols).toBeLessThanOrEqual(maxColumnsPerQuery);
        });

        // Verify all metrics are present across chunks
        const totalMetricsInChunks = chunks.reduce(
          (sum, chunk) => sum + chunk.length,
          0,
        );
        expect(totalMetricsInChunks).toBe(100);

        // Calculate expected number of chunks
        // 100 metrics / 14 per chunk = 8 chunks (7 full + 1 partial)
        const expectedChunks = Math.ceil(100 / metricsPerChunk);
        expect(chunks.length).toBe(expectedChunks);

        // Verify each chunk (except possibly the last) has expected number of metrics
        for (let i = 0; i < chunks.length - 1; i++) {
          expect(chunks[i].length).toBe(metricsPerChunk);
        }
      });

      it("should respect both column limit and MAX_METRICS_PER_QUERY limit", () => {
        // Use a high column limit so metric count is the limiting factor
        const maxColumnsPerQuery = 50000;

        // Create 250 quantile metrics (more than MAX_METRICS_PER_QUERY)
        const metrics: FactMetricInterface[] = [];
        for (let i = 0; i < 250; i++) {
          metrics.push(
            factMetricFactory.build({
              metricType: "quantile",
              numerator: { factTableId: "ft_1" },
            }),
          );
        }

        const chunks = chunkMetrics(metrics, maxColumnsPerQuery);

        // Each chunk should have at most MAX_METRICS_PER_QUERY metrics
        chunks.forEach((chunk) => {
          expect(chunk.length).toBeLessThanOrEqual(MAX_METRICS_PER_QUERY);
        });

        // Total metrics should be preserved
        const totalMetrics = chunks.reduce(
          (sum, chunk) => sum + chunk.length,
          0,
        );
        expect(totalMetrics).toBe(250);

        // With 250 metrics and max 200 per chunk, we need at least 2 chunks
        expect(chunks.length).toBeGreaterThanOrEqual(2);
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

        const chunks = chunkMetrics(metrics, maxColumnsPerQuery);

        // Verify chunks are created
        expect(chunks.length).toBeGreaterThan(0);

        // Verify no chunk exceeds column limit
        chunks.forEach((chunk) => {
          const totalCols =
            baseColumnsNeeded +
            chunk.reduce(
              (sum, m) => sum + maxColumnsNeededForMetricType(m.metricType),
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

        // We should need multiple chunks since 200 metrics with ~9-18 cols each won't all fit
        expect(chunks.length).toBeGreaterThan(1);

        // Verify the chunking is efficient (not overly fragmented)
        // Mean metrics take 9 cols, ratio 18 cols
        // With 897 available columns, chunking should be reasonably efficient
        expect(chunks.length).toBeLessThanOrEqual(10);
      });

      it("should handle interleaved mean and ratio metrics", () => {
        const maxColumnsPerQuery = 1000;

        // Create interleaved mean and ratio metrics
        const metrics: FactMetricInterface[] = [];
        for (let i = 0; i < 100; i++) {
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

        const chunks = chunkMetrics(metrics, maxColumnsPerQuery);

        // Verify all 200 metrics are present
        const totalMetricsInChunks = chunks.reduce(
          (sum, chunk) => sum + chunk.length,
          0,
        );
        expect(totalMetricsInChunks).toBe(200);

        // Verify no chunk exceeds limits
        chunks.forEach((chunk) => {
          const totalCols =
            baseColumnsNeeded +
            chunk.reduce(
              (sum, m) => sum + maxColumnsNeededForMetricType(m.metricType),
              0,
            );
          expect(totalCols).toBeLessThanOrEqual(maxColumnsPerQuery);
          expect(chunk.length).toBeLessThanOrEqual(MAX_METRICS_PER_QUERY);
        });
      });
    });

    describe("edge cases", () => {
      it("should handle empty metrics array", () => {
        const chunks = chunkMetrics([], 1000);
        expect(chunks).toEqual([]);
      });

      it("should handle single metric", () => {
        const metrics = [
          factMetricFactory.build({
            metricType: "mean",
            numerator: { factTableId: "ft_1" },
          }),
        ];

        const chunks = chunkMetrics(metrics, 1000);
        expect(chunks.length).toBe(1);
        expect(chunks[0].length).toBe(1);
      });

      it("should handle very restrictive column limit", () => {
        const quantileColsNeeded = maxColumnsNeededForMetricType("quantile");
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

        const chunks = chunkMetrics(metrics, maxColumnsPerQuery);

        // Each metric should be in its own chunk
        expect(chunks.length).toBe(5);
        chunks.forEach((chunk) => {
          expect(chunk.length).toBe(1);
        });
      });
    });
  });
});
