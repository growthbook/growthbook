import type {
  ExperimentSnapshotAnalysisSettings,
  ExperimentSnapshotSettings,
  SnapshotSettingsVariation,
} from "shared/types/experiment-snapshot";
import type { ExperimentMetricAnalysis } from "shared/types/stats";
import type { QueryInterface } from "shared/types/query";
import type { QueryMap } from "back-end/src/queryRunners/QueryRunner";
import {
  addMetricErrorsToDimensions,
  getMetricsAndQueryDataForStatsEngine,
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

const snapshotSettings: ExperimentSnapshotSettings = {
  manual: false,
  dimensions: [],
  metricSettings: [],
  goalMetrics: [],
  secondaryMetrics: [],
  guardrailMetrics: [],
  activationMetric: null,
  defaultMetricPriorSettings: {
    override: false,
    proper: false,
    mean: 0,
    stddev: 0,
  },
  regressionAdjustmentEnabled: false,
  attributionModel: "firstExposure",
  experimentId: "experiment",
  queryFilter: "",
  segment: "",
  skipPartialData: false,
  datasourceId: "datasource",
  exposureQueryId: "exposure",
  startDate: new Date("2024-01-01"),
  endDate: new Date("2024-01-31"),
  variations,
};

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

function warehouseQuery({
  id,
  status,
  error,
}: {
  id: string;
  status: QueryInterface["status"];
  error?: string;
}): QueryInterface {
  return {
    id,
    organization: "org",
    datasource: "datasource",
    language: "sql",
    query: "SELECT 1",
    status,
    error,
    createdAt: new Date(),
    heartbeat: new Date(),
  };
}

describe("partial warehouse results", () => {
  it("preserves a failed group's metrics as errors beside surviving results", () => {
    const failedGroup = warehouseQuery({
      id: "failed_group",
      status: "failed",
      error: "Warehouse query timed out",
    });
    const survivingGroup = warehouseQuery({
      id: "surviving_group",
      status: "succeeded",
    });
    const queryData: QueryMap = new Map([
      ["group_0", failedGroup],
      ["group_1", survivingGroup],
    ]);
    const { queryResults, unknownVariations, queryMetricErrors } =
      getMetricsAndQueryDataForStatsEngine(
        queryData,
        new Map(),
        snapshotSettings,
        {
          queries: [
            {
              name: "group_0",
              query: failedGroup.id,
              status: "failed",
              resultMetricIds: ["failed"],
            },
            {
              name: "group_1",
              query: survivingGroup.id,
              status: "succeeded",
              resultMetricIds: ["survivor"],
            },
          ],
          allQueryData: queryData,
        },
      );

    const [result] = parseStatsEngineResult({
      analysisSettings: [analysisSettings],
      snapshotSettings,
      queryResults,
      unknownVariations,
      queryMetricErrors,
      result: [survivorResult],
    });

    result.dimensions[0].variations.forEach((variation) => {
      expect(variation.metrics.survivor).toBeDefined();
      expect(variation.metrics.failed.errorMessage).toBe(
        "Warehouse query timed out",
      );
    });
  });

  it("does not leak unit-dimension failures into parent results", () => {
    const parentGroup = warehouseQuery({
      id: "parent_group",
      status: "succeeded",
    });
    const failedUnitDimensionGroup = warehouseQuery({
      id: "unit_dimension_group",
      status: "failed",
      error: "Unit dimension query failed",
    });
    const queryData: QueryMap = new Map([
      ["group_0", parentGroup],
      ["unitdim:dimension:group_0", failedUnitDimensionGroup],
    ]);

    const { queryMetricErrors } = getMetricsAndQueryDataForStatsEngine(
      queryData,
      new Map(),
      snapshotSettings,
      {
        queries: [
          {
            name: "group_0",
            query: parentGroup.id,
            status: "succeeded",
            resultMetricIds: ["metric"],
          },
          {
            name: "unitdim:dimension:group_0",
            query: failedUnitDimensionGroup.id,
            status: "failed",
            resultMetricIds: ["metric"],
          },
        ],
        allQueryData: queryData,
      },
    );

    expect(queryMetricErrors).toEqual(new Map());
  });
});

describe("addMetricErrorsToDimensions", () => {
  it("adds errors without mutating surviving dimensions", () => {
    const [parsed] = parseStatsEngineResult({
      analysisSettings: [analysisSettings],
      snapshotSettings: { variations },
      queryResults: [],
      unknownVariations: [],
      result: [survivorResult],
    });
    const dimensions = parsed.dimensions;

    const result = addMetricErrorsToDimensions(
      dimensions,
      new Map([["failed", "metric analysis failed"]]),
      variations.length,
    );

    expect(result).not.toBe(dimensions);
    expect(result[0]).not.toBe(dimensions[0]);
    expect(result[0].variations[0]).not.toBe(dimensions[0].variations[0]);
    expect(result[0].variations[0].metrics).not.toBe(
      dimensions[0].variations[0].metrics,
    );
    expect(dimensions[0].variations[0].metrics.failed).toBeUndefined();
    result[0].variations.forEach((variation) => {
      expect(variation.metrics.failed).toEqual({
        users: 0,
        value: 0,
        cr: 0,
        buckets: [],
        errorMessage: "metric analysis failed",
      });
    });
  });

  it("creates an All dimension with the requested variation count", () => {
    expect(
      addMetricErrorsToDimensions(
        [],
        new Map([["failed", "metric analysis failed"]]),
        3,
      ),
    ).toEqual([
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
  it("attaches warehouse query errors alongside surviving metrics", () => {
    const [result] = parseStatsEngineResult({
      analysisSettings: [analysisSettings],
      snapshotSettings: { variations },
      queryResults: [],
      unknownVariations: [],
      queryMetricErrors: new Map([["failed", "Warehouse query timed out"]]),
      result: [survivorResult],
    });

    result.dimensions[0].variations.forEach((variation) => {
      expect(variation.metrics.survivor).toBeDefined();
      expect(variation.metrics.failed).toEqual({
        value: 0,
        cr: 0,
        users: 0,
        buckets: [],
        errorMessage: "Warehouse query timed out",
      });
    });
  });

  it("does not overwrite a successful metric with a query error", () => {
    const [result] = parseStatsEngineResult({
      analysisSettings: [analysisSettings],
      snapshotSettings: { variations },
      queryResults: [],
      unknownVariations: [],
      queryMetricErrors: new Map([["survivor", "Stale warehouse query error"]]),
      result: [survivorResult],
    });

    expect(
      result.dimensions[0].variations[0].metrics.survivor,
    ).not.toHaveProperty("errorMessage");
    expect(result.dimensions[0].variations[0].metrics.survivor.value).toBe(5);
  });

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
