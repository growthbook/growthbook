import type {
  ExperimentSnapshotAnalysisSettings,
  SnapshotSettingsVariation,
} from "shared/types/experiment-snapshot";
import type { ExperimentReportResultDimension } from "shared/types/report";
import type { ExperimentMetricAnalysis } from "shared/types/stats";
import {
  addMetricErrorsToDimensions,
  parseStatsEngineResult,
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
  analyses: [],
  error: "metric analysis failed",
};

describe("addMetricErrorsToDimensions", () => {
  it("adds errors onto surviving dimensions in place", () => {
    const [parsed] = parseStatsEngineResult({
      analysisSettings: [analysisSettings],
      snapshotSettings: { variations },
      queryResults: [],
      unknownVariations: [],
      result: [survivorResult],
    });
    const dimensions = parsed.dimensions;

    addMetricErrorsToDimensions(
      dimensions,
      new Map([["failed", "metric analysis failed"]]),
      variations.length,
    );

    dimensions[0].variations.forEach((variation) => {
      expect(variation.metrics.survivor).toBeDefined();
      expect(variation.metrics.failed).toEqual({
        users: 0,
        value: 0,
        cr: 0,
        buckets: [],
        errorMessage: "metric analysis failed",
      });
    });
  });

  it("leaves dimensions untouched when there are no errors", () => {
    const [parsed] = parseStatsEngineResult({
      analysisSettings: [analysisSettings],
      snapshotSettings: { variations },
      queryResults: [],
      unknownVariations: [],
      result: [survivorResult],
    });
    const dimensions = parsed.dimensions;
    const before = JSON.parse(JSON.stringify(dimensions));

    addMetricErrorsToDimensions(dimensions, new Map(), variations.length);

    expect(dimensions).toEqual(before);
  });

  it("creates an All dimension with the requested variation count", () => {
    const dimensions: ExperimentReportResultDimension[] = [];

    addMetricErrorsToDimensions(
      dimensions,
      new Map([["failed", "metric analysis failed"]]),
      3,
    );

    expect(dimensions).toEqual([
      {
        name: "All",
        srm: 1,
        variations: Array.from({ length: 3 }, () => ({
          users: 0,
          metrics: {
            failed: {
              users: 0,
              value: 0,
              cr: 0,
              buckets: [],
              errorMessage: "metric analysis failed",
            },
          },
        })),
      },
    ]);
  });
});

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
          ...failedResult,
          traceback: "Traceback line one\nTraceback line two",
        },
      ],
    });

    expect(result.dimensions[0].variations[0].metrics.failed.errorMessage).toBe(
      "metric analysis failed",
    );
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
            },
          },
        })),
      },
    ]);
  });
});
