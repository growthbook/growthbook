import type {
  ExperimentSnapshotAnalysisSettings,
  SnapshotSettingsVariation,
} from "shared/types/experiment-snapshot";
import type { ExperimentAggregateUnitsQueryResponseRows } from "shared/types/integrations";
import type { ExperimentMetricAnalysis } from "shared/types/stats";
import {
  parseStatsEngineResult,
  analyzeExperimentTraffic,
} from "back-end/src/services/stats";

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
  it("computes multiple exposures from traffic query rows", () => {
    const rows: ExperimentAggregateUnitsQueryResponseRows = [
      {
        variation: "control",
        dimension_name: "dim_exposure_date",
        dimension_value: "2026-08-29",
        units: 25360,
      },
      {
        variation: "treatment",
        dimension_name: "dim_exposure_date",
        dimension_value: "2026-08-29",
        units: 25398,
      },
      {
        variation: "__multiple__",
        dimension_name: "dim_exposure_date",
        dimension_value: "2026-08-29",
        units: 198,
      },
      {
        variation: "__multiple__",
        dimension_name: "dim_exposure_date",
        dimension_value: "2026-08-30",
        units: 84,
      },
      {
        variation: "__multiple__",
        dimension_name: "dim_exposure_date",
        dimension_value: "2026-08-31",
        units: 40,
      },
      {
        variation: "__multiple__",
        dimension_name: "dim_exposure_date",
        dimension_value: "2026-09-01",
        units: 30,
      },
      {
        variation: "__multiple__",
        dimension_name: "dim_exposure_date",
        dimension_value: "2026-08-28",
        units: 1,
      },
    ];

    const result = analyzeExperimentTraffic({
      rows,
      variations,
    });

    expect(result.multipleExposures).toBe(353);
  });

  it("uses max across dimensions when multiple dimensions have __multiple__ rows", () => {
    const rows: ExperimentAggregateUnitsQueryResponseRows = [
      {
        variation: "control",
        dimension_name: "dim_exposure_date",
        dimension_value: "2026-08-29",
        units: 100,
      },
      {
        variation: "__multiple__",
        dimension_name: "dim_app_platform",
        dimension_value: "iOS",
        units: 353,
      },
      {
        variation: "__multiple__",
        dimension_name: "dim_app_theme",
        dimension_value: "Light",
        units: 189,
      },
      {
        variation: "__multiple__",
        dimension_name: "dim_app_theme",
        dimension_value: "Black",
        units: 145,
      },
      {
        variation: "__multiple__",
        dimension_name: "dim_app_theme",
        dimension_value: "Dark",
        units: 13,
      },
      {
        variation: "__multiple__",
        dimension_name: "dim_app_theme",
        dimension_value: "Sepia",
        units: 6,
      },
    ];

    const result = analyzeExperimentTraffic({
      rows,
      variations,
    });

    expect(result.multipleExposures).toBe(353);
  });

  it("returns undefined multipleExposures when no __multiple__ rows exist", () => {
    const rows: ExperimentAggregateUnitsQueryResponseRows = [
      {
        variation: "control",
        dimension_name: "dim_exposure_date",
        dimension_value: "2026-08-29",
        units: 100,
      },
      {
        variation: "treatment",
        dimension_name: "dim_exposure_date",
        dimension_value: "2026-08-29",
        units: 100,
      },
    ];

    const result = analyzeExperimentTraffic({
      rows,
      variations,
    });

    expect(result.multipleExposures).toBeUndefined();
  });
});
