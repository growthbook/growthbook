import type {
  ExperimentSnapshotAnalysisSettings,
  SnapshotSettingsVariation,
} from "shared/types/experiment-snapshot";
import type { ExperimentMetricAnalysis } from "shared/types/stats";
import type { ExperimentReportVariation } from "shared/types/report";
import {
  analyzeExperimentTraffic,
  getAnalysisSettingsForStatsEngine,
  getMetricSettingsForStatsEngine,
  getScaledImpactDays,
  parseStatsEngineResult,
} from "back-end/src/services/stats";
import { factMetricFactory } from "back-end/test/factories/FactMetric.factory";
import { snapshotFactory } from "back-end/test/factories/Snapshot.factory";

const analysisSettings: ExperimentSnapshotAnalysisSettings = {
  dimensions: [""],
  statsEngine: "bayesian",
  regressionAdjusted: false,
  sequentialTesting: false,
  baselineVariationIndex: 0,
  differenceType: "relative",
  pValueCorrection: null,
  numGoalMetrics: 1,
  numGuardrailMetrics: 0,
};

const variations: SnapshotSettingsVariation[] = [
  { id: "control", weight: 0.5 },
  { id: "treatment", weight: 0.5 },
];

describe("getScaledImpactDays", () => {
  const phase = {
    startDate: new Date("2026-01-01T00:00:00Z"),
    endDate: new Date("2026-01-31T00:00:00Z"),
  };

  it("uses the lookback window when it is shorter than the phase", () => {
    expect(
      getScaledImpactDays(
        {
          windowSettings: {
            type: "lookback",
            windowValue: 7,
            windowUnit: "days",
            delayValue: 0,
            delayUnit: "hours",
          },
        },
        phase,
      ),
    ).toBe(7);
  });

  it("uses the phase length when it is shorter than the lookback window", () => {
    expect(
      getScaledImpactDays(
        {
          windowSettings: {
            type: "lookback",
            windowValue: 60,
            windowUnit: "days",
            delayValue: 0,
            delayUnit: "hours",
          },
        },
        phase,
      ),
    ).toBe(30);
  });

  it("uses the phase length for non-lookback metrics", () => {
    expect(
      getScaledImpactDays(
        {
          windowSettings: {
            type: "conversion",
            windowValue: 7,
            windowUnit: "days",
            delayValue: 0,
            delayUnit: "hours",
          },
        },
        phase,
      ),
    ).toBe(30);
  });

  it("uses the effective snapshotted window in the stats payload", () => {
    const metric = factMetricFactory.build({
      id: "fact_metric",
      windowSettings: {
        type: "lookback",
        windowValue: 60,
        windowUnit: "days",
        delayValue: 0,
        delayUnit: "hours",
      },
    });
    const settings = {
      ...snapshotFactory.build().settings,
      ...phase,
      goalMetrics: [metric.id],
      metricSettings: [
        {
          id: metric.id,
          computedSettings: {
            regressionAdjustmentEnabled: false,
            regressionAdjustmentAvailable: false,
            regressionAdjustmentDays: 0,
            regressionAdjustmentReason: "",
            properPrior: false,
            properPriorMean: 0,
            properPriorStdDev: 1,
            windowSettings: {
              type: "lookback" as const,
              windowValue: 7,
              windowUnit: "days" as const,
              delayValue: 0,
              delayUnit: "hours" as const,
            },
          },
        },
      ],
    };

    expect(
      getMetricSettingsForStatsEngine(
        metric,
        new Map([[metric.id, metric]]),
        settings,
      ).scaled_impact_days,
    ).toBe(7);
  });
});

const survivorResult: ExperimentMetricAnalysis[number] = {
  metric: "survivor",
  analyses: [
    {
      unknownVariations: [],
      multipleExposures: 0,
      dimensions: [
        {
          dimension: "All",
          srm: 1,
          variations: [
            {
              users: 10,
              value: 5,
              cr: 0.5,
              stats: { users: 10, count: 10, stddev: 1, mean: 0.5 },
            },
            {
              users: 12,
              value: 7,
              cr: 0.6,
              stats: { users: 12, count: 12, stddev: 1, mean: 0.6 },
            },
          ],
        },
      ],
    },
  ],
};

const failedResult: ExperimentMetricAnalysis[number] = {
  metric: "failed",
  analyses: [
    {
      unknownVariations: [],
      multipleExposures: 0,
      dimensions: [],
      error: "metric analysis failed",
    },
  ],
};

describe("parseStatsEngineResult", () => {
  it("attaches a failed metric to every surviving variation", () => {
    const [result] = parseStatsEngineResult({
      analysisSettings: [analysisSettings],
      snapshotSettings: { variations },
      queryResults: [],
      unknownVariations: [],
      result: [survivorResult, failedResult],
    });

    expect(result.dimensions).toHaveLength(1);
    result.dimensions[0].variations.forEach((variation) => {
      expect(variation.metrics.survivor).toBeDefined();
      expect(variation.metrics.failed).toEqual({
        value: 0,
        cr: 0,
        users: 0,
        buckets: [],
        errorMessage: "metric analysis failed",
        computeFailed: true,
      });
    });
  });

  it("keeps the stats traceback out of the persisted metric error message", () => {
    const [result] = parseStatsEngineResult({
      analysisSettings: [analysisSettings],
      snapshotSettings: { variations },
      queryResults: [],
      unknownVariations: [],
      result: [
        {
          metric: "failed",
          analyses: [
            {
              unknownVariations: [],
              multipleExposures: 0,
              dimensions: [],
              error: "metric analysis failed",
              traceback: "Traceback line one\nTraceback line two",
            },
          ],
        },
      ],
    });

    expect(result.dimensions[0].variations[0].metrics.failed.errorMessage).toBe(
      "metric analysis failed",
    );
  });

  it("isolates a failed analysis without discarding the metric's other analyses", () => {
    const goodSlot = survivorResult.analyses[0];
    const results = parseStatsEngineResult({
      analysisSettings: [analysisSettings, analysisSettings],
      snapshotSettings: { variations },
      queryResults: [],
      unknownVariations: [],
      result: [
        {
          metric: "partial",
          analyses: [
            {
              unknownVariations: [],
              multipleExposures: 0,
              dimensions: [],
              error: "analysis 0 failed",
              traceback: "Traceback line one\nTraceback line two",
            },
            goodSlot,
          ],
        },
      ],
    });

    results[0].dimensions[0].variations.forEach((variation) => {
      expect(variation.metrics.partial).toEqual({
        users: 0,
        value: 0,
        cr: 0,
        buckets: [],
        errorMessage: "analysis 0 failed",
        computeFailed: true,
      });
    });

    results[1].dimensions[0].variations.forEach((variation) => {
      expect(variation.metrics.partial.errorMessage).toBeUndefined();
      expect(variation.metrics.partial.computeFailed).toBeUndefined();
      expect(variation.metrics.partial.cr).toBeGreaterThan(0);
    });
  });

  it("isolates an unexpected processing failure to the offending metric", () => {
    const throwingResult = {
      metric: "boom",
      analyses: [
        {
          unknownVariations: [],
          multipleExposures: 0,
          dimensions: [
            {
              dimension: "All",
              srm: 1,
              variations: null as unknown as [],
            },
          ],
        },
      ],
    };

    const [result] = parseStatsEngineResult({
      analysisSettings: [analysisSettings],
      snapshotSettings: { variations },
      queryResults: [],
      unknownVariations: [],
      result: [survivorResult, throwingResult],
    });

    result.dimensions[0].variations.forEach((variation) => {
      expect(variation.metrics.survivor).toBeDefined();
      expect(variation.metrics.boom.errorMessage).toBeTruthy();
      expect(variation.metrics.boom.computeFailed).toBe(true);
    });
  });

  it("creates variations for errors when no metric survives", () => {
    const [result] = parseStatsEngineResult({
      analysisSettings: [analysisSettings],
      snapshotSettings: { variations },
      queryResults: [],
      unknownVariations: [],
      result: [failedResult],
    });

    expect(result.dimensions).toEqual([
      {
        name: "All",
        srm: 1,
        variations: variations.map(() => ({
          users: 0,
          metrics: {
            failed: {
              value: 0,
              cr: 0,
              users: 0,
              buckets: [],
              errorMessage: "metric analysis failed",
              computeFailed: true,
            },
          },
        })),
      },
    ]);
  });

  it("sums __multiple__ across dimension slices within a query and takes the max across queries", () => {
    const row = (variation: string, dimension: string, users: number) => ({
      variation,
      dimension,
      users,
      count: users,
      main_sum: 0,
      main_sum_squares: 0,
    });
    const [result] = parseStatsEngineResult({
      analysisSettings: [analysisSettings],
      snapshotSettings: { variations },
      queryResults: [
        {
          metrics: ["a"],
          rows: [
            row("control", "A", 100),
            row("__multiple__", "A", 6),
            row("__multiple__", "B", 300),
            row("__multiple__", "C", 47),
          ],
        },
        {
          metrics: ["b"],
          rows: [row("__multiple__", "A", 6), row("__multiple__", "B", 347)],
        },
      ],
      unknownVariations: [],
      result: [survivorResult],
    });

    expect(result.multipleExposures).toBe(353);
  });

  it("uses an empty All dimension when nothing computed and nothing failed", () => {
    const [result] = parseStatsEngineResult({
      analysisSettings: [analysisSettings],
      snapshotSettings: { variations },
      queryResults: [],
      unknownVariations: [],
      result: [],
    });

    expect(result.dimensions).toEqual([
      {
        name: "All",
        srm: 1,
        variations: [],
      },
    ]);
  });
});

describe("analyzeExperimentTraffic", () => {
  const row = (
    variation: string,
    dimension_name: string,
    dimension_value: string,
    units: number,
  ) => ({ variation, dimension_name, dimension_value, units });

  it("sums __multiple__ rows once, via the exposure date dimension", () => {
    const traffic = analyzeExperimentTraffic({
      variations,
      rows: [
        row("control", "dim_exposure_date", "2026-01-01", 1000),
        row("treatment", "dim_exposure_date", "2026-01-01", 1000),
        row("__multiple__", "dim_exposure_date", "2026-01-01", 200),
        row("__multiple__", "dim_exposure_date", "2026-01-02", 153),
        row("__multiple__", "dim_exp_app_theme", "Sepia", 6),
        row("__multiple__", "dim_exp_app_theme", "Light", 347),
      ],
    });
    expect(traffic.multipleExposures).toBe(353);
    expect(traffic.overall.variationUnits).toEqual([1000, 1000]);
  });

  it("reports 0 when there are no __multiple__ rows", () => {
    const traffic = analyzeExperimentTraffic({
      variations,
      rows: [row("control", "dim_exposure_date", "2026-01-01", 1000)],
    });
    expect(traffic.multipleExposures).toBe(0);
  });

  it("omits multipleExposures when the traffic query failed", () => {
    expect(
      analyzeExperimentTraffic({ variations, rows: [], error: "boom" })
        .multipleExposures,
    ).toBeUndefined();
    expect(
      analyzeExperimentTraffic({ variations, rows: [] }).multipleExposures,
    ).toBeUndefined();
  });
});

describe("getAnalysisSettingsForStatsEngine", () => {
  const reportVariations: ExperimentReportVariation[] = [
    { id: "control", name: "Control", weight: 0.5, index: 0 },
    { id: "treatment", name: "Treatment", weight: 0.5, index: 1 },
  ];
  const alphaFor = (
    settings: Partial<ExperimentSnapshotAnalysisSettings>,
  ): number =>
    getAnalysisSettingsForStatsEngine(
      { ...analysisSettings, ...settings },
      reportVariations,
      1,
      14,
    ).alpha;

  it("sets alpha from the p-value threshold for frequentist analyses", () => {
    expect(alphaFor({ statsEngine: "frequentist", pValueThreshold: 0.2 })).toBe(
      0.2,
    );
    expect(alphaFor({ statsEngine: "frequentist" })).toBe(0.05);
  });

  it("holds Bayesian credible intervals at 95% regardless of the threshold", () => {
    expect(alphaFor({ statsEngine: "bayesian", pValueThreshold: 0.2 })).toBe(
      0.05,
    );
    expect(alphaFor({ statsEngine: "bayesian", pValueThreshold: 0.001 })).toBe(
      0.05,
    );
  });
});
