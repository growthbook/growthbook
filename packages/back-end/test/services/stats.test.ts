import type {
  ExperimentSnapshotAnalysisSettings,
  ExperimentSnapshotSettings,
  SnapshotSettingsVariation,
} from "shared/types/experiment-snapshot";
import type { ExperimentMetricAnalysis } from "shared/types/stats";
import type { ExperimentReportVariation } from "shared/types/report";
import type { QueryInterface } from "shared/types/query";
import type { QueryMap } from "back-end/src/queryRunners/QueryRunner";
import { getUnitDimQueryName } from "back-end/src/queryRunners/unitDimensionQueryNaming";
import {
  analyzeExperimentClusterHealth,
  analyzeExperimentTraffic,
  getAnalysisSettingsForStatsEngine,
  parseStatsEngineResult,
  selectAnalysisQueryData,
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

describe("analyzeExperimentClusterHealth", () => {
  const reliability = (
    cluster_id: string,
    variation: string,
    units: number,
    pct: number,
  ) => ({
    kind: "reliability" as const,
    cluster_id,
    variation,
    metric_a: units,
    metric_b: pct,
  });
  const assignment = (total: number, mixed: number) => ({
    kind: "assignment" as const,
    cluster_id: "",
    variation: "",
    metric_a: total,
    metric_b: mixed,
  });
  const mapping = (total: number, multi: number) => ({
    kind: "mapping" as const,
    cluster_id: "",
    variation: "",
    metric_a: total,
    metric_b: multi,
  });

  it("splits reliability/assignment/mapping rows into the three results", () => {
    const result = analyzeExperimentClusterHealth({
      variations,
      rows: [
        reliability("region_a", "treatment", 500, 0.5),
        reliability("region_b", "control", 300, 0.3),
        reliability("region_c", "control", 200, 0.2),
        assignment(100, 3),
        mapping(1000, 7),
      ],
    });

    expect(result.clusterUnits.error).toBeUndefined();
    expect(result.clusterUnits.clusters).toEqual([
      { id: "region_a", variation: 1, units: 500, pct: 0.5 },
      { id: "region_b", variation: 0, units: 300, pct: 0.3 },
      { id: "region_c", variation: 0, units: 200, pct: 0.2 },
    ]);
    expect(result.clusterAssignment).toEqual({
      totalClusters: 100,
      mixedClusters: 3,
    });
    expect(result.clusterSubUnitMapping).toEqual({
      totalUnits: 1000,
      multiClusterUnits: 7,
    });
  });

  it("uses -1 for unknown reliability variations", () => {
    const result = analyzeExperimentClusterHealth({
      variations,
      rows: [reliability("region_a", "__unknown__", 10, 1)],
    });
    expect(result.clusterUnits.clusters[0].variation).toBe(-1);
  });

  it("defaults to zero when summary rows are absent", () => {
    const result = analyzeExperimentClusterHealth({ variations, rows: [] });
    expect(result.clusterUnits.clusters).toEqual([]);
    expect(result.clusterAssignment).toEqual({
      totalClusters: 0,
      mixedClusters: 0,
    });
    expect(result.clusterSubUnitMapping).toEqual({
      totalUnits: 0,
      multiClusterUnits: 0,
    });
  });

  it("returns empty/zeroed results and the error when the query failed", () => {
    const result = analyzeExperimentClusterHealth({
      variations,
      rows: [],
      error: "boom",
    });
    expect(result.clusterUnits).toEqual({ clusters: [], error: "boom" });
    expect(result.clusterAssignment).toEqual({
      totalClusters: 0,
      mixedClusters: 0,
      error: "boom",
    });
    expect(result.clusterSubUnitMapping).toEqual({
      totalUnits: 0,
      multiClusterUnits: 0,
      error: "boom",
    });
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

  const postStratFor = (
    settings: Partial<ExperimentSnapshotAnalysisSettings>,
    isClusterExperiment?: boolean,
  ): boolean =>
    getAnalysisSettingsForStatsEngine(
      { ...analysisSettings, ...settings },
      reportVariations,
      1,
      14,
      isClusterExperiment,
    ).post_stratification_enabled;

  it("passes through post-stratification for non-cluster experiments", () => {
    expect(postStratFor({ postStratificationEnabled: true })).toBe(true);
    expect(postStratFor({ postStratificationEnabled: false })).toBe(false);
  });

  it("forces post-stratification off for cluster experiments", () => {
    expect(postStratFor({ postStratificationEnabled: true }, true)).toBe(false);
    expect(postStratFor({ postStratificationEnabled: false }, true)).toBe(
      false,
    );
  });
});

describe("selectAnalysisQueryData", () => {
  const q = (id: string) => ({ id }) as unknown as QueryInterface;

  const clusterSettings = {
    isClusterExperiment: true,
    clusterSubUnitIdentifier: "user_id",
    dimensions: [{ id: "exp:browser" }],
    precomputedUnitDimensionIds: [],
  } as unknown as ExperimentSnapshotSettings;

  // Distinct references so we can tell the parent bucket apart from the
  // isolated bucket even though they share the bare key names.
  const parentGroup = q("parent-group");
  const parentMetric = q("parent-metric");
  const isolatedGroup = q("isolated-group");
  const isolatedMetric = q("isolated-metric");

  const fullMap = (): QueryMap =>
    new Map([
      ["group_0", parentGroup],
      ["met_revenue", parentMetric],
      [getUnitDimQueryName("exp:browser", "group_0"), isolatedGroup],
      [getUnitDimQueryName("exp:browser", "met_revenue"), isolatedMetric],
    ]);

  it("routes an isolated cluster sub-unit dimension to its isolated query map", () => {
    const result = selectAnalysisQueryData(
      fullMap(),
      clusterSettings,
      "exp:browser",
    );
    expect([...result.keys()].sort()).toEqual(["group_0", "met_revenue"]);
    expect(result.get("group_0")).toBe(isolatedGroup);
    expect(result.get("met_revenue")).toBe(isolatedMetric);
  });

  it("uses the dimensionless parent query map for the parent analysis", () => {
    const result = selectAnalysisQueryData(fullMap(), clusterSettings, "");
    expect([...result.keys()].sort()).toEqual(["group_0", "met_revenue"]);
    expect(result.get("group_0")).toBe(parentGroup);
    expect(result.get("met_revenue")).toBe(parentMetric);
  });

  it("falls through to the parent filter for a non-isolated dimension", () => {
    const nonClusterSettings = {
      isClusterExperiment: false,
      clusterSubUnitIdentifier: null,
      dimensions: [{ id: "exp:browser" }],
      precomputedUnitDimensionIds: [],
    } as unknown as ExperimentSnapshotSettings;

    const result = selectAnalysisQueryData(
      fullMap(),
      nonClusterSettings,
      "exp:browser",
    );
    expect(result.get("group_0")).toBe(parentGroup);
    expect(result.get("met_revenue")).toBe(parentMetric);
  });

  it("throws when an isolated dimension has no unitdim: query results", () => {
    // Routing now lives solely here, so a map missing the isolated dimension's
    // `unitdim:` queries fails loud instead of silently falling back to the
    // parent (overall) query, which would fail confusingly inside the stats
    // engine.
    const missingIsolated: QueryMap = new Map([
      ["group_0", parentGroup],
      ["met_revenue", parentMetric],
    ]);
    expect(() =>
      selectAnalysisQueryData(missingIsolated, clusterSettings, "exp:browser"),
    ).toThrow(/missing query results for dimension "exp:browser"/);
  });
});
