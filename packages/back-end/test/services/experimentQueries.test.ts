import { FactMetricInterface } from "shared/types/fact-table";
import {
  chunkMetrics,
  getFactMetricGroup,
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

      it("should return 6 columns for mean metric with percentile capping", () => {
        const metric = factMetricFactory.build({
          metricType: "mean",
          numerator: { factTableId: "ft_1" },
          cappingSettings: { type: "percentile", value: 0.99 },
        });
        // 1 (id) + 2 (base) + 1 (BASE_METRIC_PERCENTILE_CAPPING_FLOAT_COLS) + 2 (BASE_METRIC_FLOAT_COLS_UNCAPPED) = 6
        expect(
          maxColumnsNeededForMetric({
            metric,
            regressionAdjusted: false,
            isBandit: false,
          }),
        ).toBe(6);
      });

      it("should return 6 columns for mean metric with lower-tail percentile capping only", () => {
        const metric = factMetricFactory.build({
          metricType: "mean",
          numerator: { factTableId: "ft_1" },
          cappingSettings: {
            type: "", // no upper cap
            value: 0,
          },
          lowerCappingSettings: {
            type: "percentile",
            value: 0.05, // lower cap at 5th percentile
          },
        });
        // 1 + 2 base + 1 lower cap col + 2 uncapped = 6
        expect(
          maxColumnsNeededForMetric({
            metric,
            regressionAdjusted: false,
            isBandit: false,
          }),
        ).toBe(6);
      });

      it("should return 7 columns when both upper and lower percentile capping are set", () => {
        const metric = factMetricFactory.build({
          metricType: "mean",
          numerator: { factTableId: "ft_1" },
          cappingSettings: {
            type: "percentile",
            value: 0.99,
          },
          lowerCappingSettings: {
            type: "percentile",
            value: 0.01,
          },
        });
        expect(
          maxColumnsNeededForMetric({
            metric,
            regressionAdjusted: false,
            isBandit: false,
          }),
        ).toBe(7);
      });
    });

    describe("slice metrics vs regular metrics", () => {
      it("should return fewer columns for slice metric (no uncapped cols) vs regular metric with percentile capping", () => {
        const regularMetric = factMetricFactory.build({
          id: "fact_regular",
          metricType: "mean",
          numerator: { factTableId: "ft_1" },
          cappingSettings: { type: "percentile", value: 0.99 },
        });

        // Slice metric has same settings but id contains slice query string
        const sliceMetric = factMetricFactory.build({
          id: "fact_regular?dim:browser=Chrome",
          metricType: "mean",
          numerator: { factTableId: "ft_1" },
          cappingSettings: { type: "percentile", value: 0.99 },
        });

        const regularCols = maxColumnsNeededForMetric({
          metric: regularMetric,
          regressionAdjusted: false,
          isBandit: false,
        });

        const sliceCols = maxColumnsNeededForMetric({
          metric: sliceMetric,
          regressionAdjusted: false,
          isBandit: false,
        });

        // Regular metric: 1 (id) + 2 (base) + 1 (percentile cap) + 2 (uncapped) = 6
        expect(regularCols).toBe(6);

        // Slice metric: 1 (id) + 2 (base) + 1 (percentile cap) + 0 (NO uncapped for slices) = 4
        expect(sliceCols).toBe(4);

        // Slice metric should have 2 fewer columns (no uncapped cols)
        expect(regularCols - sliceCols).toBe(2);
      });

      it("should return same columns for slice vs regular metric without capping", () => {
        const regularMetric = factMetricFactory.build({
          id: "fact_regular",
          metricType: "mean",
          numerator: { factTableId: "ft_1" },
        });

        const sliceMetric = factMetricFactory.build({
          id: "fact_regular?dim:browser=Chrome",
          metricType: "mean",
          numerator: { factTableId: "ft_1" },
        });

        const regularCols = maxColumnsNeededForMetric({
          metric: regularMetric,
          regressionAdjusted: false,
          isBandit: false,
        });

        const sliceCols = maxColumnsNeededForMetric({
          metric: sliceMetric,
          regressionAdjusted: false,
          isBandit: false,
        });

        // Without capping, both should have same columns since uncapped cols only apply to capped metrics
        // 1 (id) + 2 (base) = 3
        expect(regularCols).toBe(3);
        expect(sliceCols).toBe(3);
      });

      it("should return fewer columns for slice metric with absolute capping vs regular metric", () => {
        const regularMetric = factMetricFactory.build({
          id: "fact_regular",
          metricType: "ratio",
          numerator: { factTableId: "ft_1" },
          denominator: { factTableId: "ft_1" },
          cappingSettings: { type: "absolute", value: 100 },
        });

        const sliceMetric = factMetricFactory.build({
          id: "fact_regular?dim:country=US",
          metricType: "ratio",
          numerator: { factTableId: "ft_1" },
          denominator: { factTableId: "ft_1" },
          cappingSettings: { type: "absolute", value: 100 },
        });

        const regularCols = maxColumnsNeededForMetric({
          metric: regularMetric,
          regressionAdjusted: false,
          isBandit: false,
        });

        const sliceCols = maxColumnsNeededForMetric({
          metric: sliceMetric,
          regressionAdjusted: false,
          isBandit: false,
        });

        // Regular ratio with absolute capping: 1 (id) + 2 (base) + 3 (ratio) + 5 (uncapped: 2 base + 3 ratio) = 11
        expect(regularCols).toBe(11);

        // Slice ratio: 1 (id) + 2 (base) + 3 (ratio) + 0 (NO uncapped for slices) = 6
        expect(sliceCols).toBe(6);

        // Slice metric should have 5 fewer columns (no uncapped cols for ratio)
        expect(regularCols - sliceCols).toBe(5);
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

    describe("efficient quantile grid (array column packing)", () => {
      // BigQuery emits the unit-quantile n_star confidence-interval grid as a
      // single ARRAY column instead of N_STAR_VALUES.length*2 scalar columns,
      // so each quantile metric costs far fewer output columns. chunkMetrics
      // must honor this so it packs more metrics per query and reduces the
      // BQ job fan-out per snapshot.
      it("dramatically increases the quantile chunk size when set", () => {
        const maxColumnsPerQuery = 1000;
        const baseColumnsNeeded = 103;

        const quantileColsLegacy = maxColumnsNeededForMetric({
          metric: factMetricFactory.build({
            metricType: "quantile",
            numerator: { factTableId: "ft_1" },
          }),
          regressionAdjusted: false,
          isBandit: false,
        });
        const quantileColsEfficient = maxColumnsNeededForMetric({
          metric: factMetricFactory.build({
            metricType: "quantile",
            numerator: { factTableId: "ft_1" },
          }),
          regressionAdjusted: false,
          isBandit: false,
          efficientQuantileGrid: true,
        });
        // Efficient mode must reduce the per-metric column cost by at least 5×.
        expect(quantileColsEfficient * 5).toBeLessThan(quantileColsLegacy);

        const metrics: FactMetricInterface[] = Array.from({ length: 100 }, () =>
          factMetricFactory.build({
            metricType: "quantile",
            numerator: { factTableId: "ft_1" },
          }),
        );
        const wrap = metrics.map((m) => ({
          metric: m,
          regressionAdjusted: false,
        }));

        const legacyChunks = chunkMetrics({
          metrics: wrap,
          maxColumnsPerQuery,
          isBandit: false,
        });
        const efficientChunks = chunkMetrics({
          metrics: wrap,
          maxColumnsPerQuery,
          isBandit: false,
          efficientQuantileGrid: true,
        });

        // All 100 metrics still present in both modes.
        expect(legacyChunks.reduce((s, c) => s + c.length, 0)).toBe(100);
        expect(efficientChunks.reduce((s, c) => s + c.length, 0)).toBe(100);

        // Concrete expected packing for 100 unit-quantile metrics under a
        // 1000-column / 103-base budget:
        //   legacy quantile cost     = 1 + 5 + 2 + N_STAR_VALUES.length * 2 = 48
        //   efficient quantile cost  = 1 + 5 + 2 + 1                       = 9
        //   legacy chunks    = ceil(100 / floor(897/48))  = ceil(100/18) = 6
        //   efficient chunks = ceil(100 / floor(897/9))   = ceil(100/99) = 2
        expect(legacyChunks.length).toBe(6);
        expect(efficientChunks.length).toBe(2);

        // No chunk in efficient mode may exceed maxColumnsPerQuery.
        efficientChunks.forEach((chunk) => {
          const totalCols =
            baseColumnsNeeded +
            chunk.reduce(
              (sum, m) =>
                sum +
                maxColumnsNeededForMetric({
                  metric: m,
                  regressionAdjusted: false,
                  isBandit: false,
                  efficientQuantileGrid: true,
                }),
              0,
            );
          expect(totalCols).toBeLessThanOrEqual(maxColumnsPerQuery);
          expect(chunk.length).toBeLessThanOrEqual(MAX_METRICS_PER_QUERY);
        });
      });
    });
  });

  describe("getFactMetricGroup", () => {
    const conversionWindow = (
      windowValue: number,
      windowUnit: "minutes" | "hours" | "days" | "weeks",
      delayValue = 0,
      delayUnit: "minutes" | "hours" | "days" | "weeks" = "hours",
    ) => ({
      type: "conversion" as const,
      delayValue,
      delayUnit,
      windowValue,
      windowUnit,
    });

    const meanMetric = (
      factTableId: string,
      windowSettings: FactMetricInterface["windowSettings"],
    ) =>
      factMetricFactory.build({
        metricType: "mean",
        numerator: { factTableId },
        windowSettings,
      });

    describe("when skipPartialData is false", () => {
      it("keys on the fact table only, ignoring the conversion window", () => {
        const a = meanMetric("ft_1", conversionWindow(3, "days"));
        const b = meanMetric("ft_1", conversionWindow(7, "days"));

        // Different conversion windows still share a group because the window
        // does not affect the query when partial data is included.
        expect(getFactMetricGroup(a, { skipPartialData: false })).toBe("ft_1");
        expect(getFactMetricGroup(b, { skipPartialData: false })).toBe("ft_1");
      });
    });

    describe("when skipPartialData is true", () => {
      it("appends the conversion window (in hours) to the fact table key", () => {
        // 3 days = 72 hours
        const metric = meanMetric("ft_1", conversionWindow(3, "days"));
        expect(getFactMetricGroup(metric, { skipPartialData: true })).toBe(
          "ft_1_cw72",
        );
      });

      it("groups metrics from the same fact table with the same conversion window", () => {
        const a = meanMetric("ft_1", conversionWindow(3, "days"));
        const b = meanMetric("ft_1", conversionWindow(3, "days"));

        expect(getFactMetricGroup(a, { skipPartialData: true })).toBe(
          getFactMetricGroup(b, { skipPartialData: true }),
        );
      });

      it("separates metrics from the same fact table with different conversion windows", () => {
        const a = meanMetric("ft_1", conversionWindow(3, "days"));
        const b = meanMetric("ft_1", conversionWindow(7, "days"));

        expect(getFactMetricGroup(a, { skipPartialData: true })).not.toBe(
          getFactMetricGroup(b, { skipPartialData: true }),
        );
      });

      it("groups equivalent conversion windows expressed in different units", () => {
        const days = meanMetric("ft_1", conversionWindow(1, "days"));
        const hours = meanMetric("ft_1", conversionWindow(24, "hours"));

        // 1 day == 24 hours, so both contribute the same end-date cutoff.
        expect(getFactMetricGroup(days, { skipPartialData: true })).toBe(
          getFactMetricGroup(hours, { skipPartialData: true }),
        );
      });

      it("includes the delay window when computing the conversion window key", () => {
        // 3-day window, no delay = 72h total
        const noDelay = meanMetric("ft_1", conversionWindow(3, "days"));
        // 2-day window + 1-day delay = 72h total (should match noDelay)
        const withDelay = meanMetric(
          "ft_1",
          conversionWindow(2, "days", 1, "days"),
        );
        // 3-day window + 1-day delay = 96h total (should differ)
        const longerDelay = meanMetric(
          "ft_1",
          conversionWindow(3, "days", 1, "days"),
        );

        expect(getFactMetricGroup(noDelay, { skipPartialData: true })).toBe(
          getFactMetricGroup(withDelay, { skipPartialData: true }),
        );
        expect(getFactMetricGroup(noDelay, { skipPartialData: true })).not.toBe(
          getFactMetricGroup(longerDelay, { skipPartialData: true }),
        );
      });

      it("treats lookback and no-window metrics as a single zero-window group, distinct from conversion windows", () => {
        const noWindow = meanMetric("ft_1", {
          type: "",
          delayValue: 0,
          delayUnit: "hours",
          windowValue: 0,
          windowUnit: "hours",
        });
        const lookback = meanMetric("ft_1", {
          type: "lookback",
          delayValue: 0,
          delayUnit: "hours",
          windowValue: 3,
          windowUnit: "days",
        });
        const conversion = meanMetric("ft_1", conversionWindow(3, "days"));

        // Neither lookback nor "no window" affects the skipPartialData cutoff,
        // so they share a group with each other...
        expect(getFactMetricGroup(noWindow, { skipPartialData: true })).toBe(
          getFactMetricGroup(lookback, { skipPartialData: true }),
        );
        // ...but not with a conversion-window metric.
        expect(
          getFactMetricGroup(noWindow, { skipPartialData: true }),
        ).not.toBe(getFactMetricGroup(conversion, { skipPartialData: true }));
      });

      it("keeps metrics on different fact tables separate even with the same window", () => {
        const a = meanMetric("ft_1", conversionWindow(3, "days"));
        const b = meanMetric("ft_2", conversionWindow(3, "days"));

        expect(getFactMetricGroup(a, { skipPartialData: true })).not.toBe(
          getFactMetricGroup(b, { skipPartialData: true }),
        );
      });

      it("appends the conversion window to cross-table ratio metric groups", () => {
        const crossTableRatio = (
          windowSettings: FactMetricInterface["windowSettings"],
        ) =>
          factMetricFactory.build({
            metricType: "ratio",
            numerator: { factTableId: "ft_1" },
            denominator: { factTableId: "ft_2" },
            windowSettings,
          });

        const a = crossTableRatio(conversionWindow(3, "days"));
        const b = crossTableRatio(conversionWindow(3, "days"));
        const c = crossTableRatio(conversionWindow(7, "days"));

        expect(getFactMetricGroup(a, { skipPartialData: true })).toBe(
          getFactMetricGroup(b, { skipPartialData: true }),
        );
        expect(getFactMetricGroup(a, { skipPartialData: true })).not.toBe(
          getFactMetricGroup(c, { skipPartialData: true }),
        );
        // The base cross-table grouping is preserved.
        expect(getFactMetricGroup(a, { skipPartialData: true })).toContain(
          "(cross-table ratio metrics)",
        );
      });

      it("appends the conversion window to quantile metric groups", () => {
        const quantileMetric = (
          windowSettings: FactMetricInterface["windowSettings"],
        ): FactMetricInterface => ({
          ...factMetricFactory.build({
            metricType: "quantile",
            numerator: { factTableId: "ft_1" },
            windowSettings,
          }),
          quantileSettings: {
            type: "unit",
            quantile: 0.5,
            ignoreZeros: false,
          },
        });

        const a = quantileMetric(conversionWindow(3, "days"));
        const b = quantileMetric(conversionWindow(7, "days"));

        // Quantile metrics keep their dedicated `_qtile` group, now further
        // split by conversion window under skipPartialData.
        expect(getFactMetricGroup(a, { skipPartialData: true })).toContain(
          "ft_1_qtile",
        );
        expect(getFactMetricGroup(a, { skipPartialData: true })).not.toBe(
          getFactMetricGroup(b, { skipPartialData: true }),
        );
      });
    });
  });
});
