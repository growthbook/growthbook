import type {
  ExperimentSnapshotAnalysis,
  ExperimentSnapshotSettings,
} from "shared/types/experiment-snapshot";
import type { QueryInterface } from "shared/types/query";
import { summarizeHealth } from "back-end/src/services/experimentResults/summarize/health";

const settings = {
  variations: [
    { id: "control", weight: 0.5 },
    { id: "treatment", weight: 0.5 },
  ],
  startDate: new Date("2026-01-01"),
  goalMetrics: [],
  guardrailMetrics: [],
  secondaryMetrics: [],
  metricSettings: [],
} as unknown as ExperimentSnapshotSettings;

const query = (result: unknown[], error?: string) =>
  ({ result, error }) as unknown as QueryInterface;

const trafficRow = (variation: string, units: number) => ({
  variation,
  dimension_name: "dim_exposure_date",
  dimension_value: "2026-01-01",
  units,
});
// 353 units exposed to more than one variation.
const trafficQuery = query([
  trafficRow("control", 1000),
  trafficRow("treatment", 1000),
  trafficRow("__multiple__", 353),
]);

const clusterRow = (kind: string, metric_a: number, metric_b: number) => ({
  kind,
  cluster_id: "",
  variation: "",
  metric_a,
  metric_b,
});
// 12 sub-units exposed to more than one variation.
const clusterHealthQuery = query([
  clusterRow("assignment", 100, 3),
  clusterRow("mapping", 1000, 7),
  clusterRow("exposures", 1000, 12),
]);

const analysis = (
  analysisSettings: Partial<ExperimentSnapshotAnalysis["settings"]>,
) =>
  ({
    settings: analysisSettings,
    results: [
      {
        name: "",
        srm: 1,
        variations: [
          { users: 1000, metrics: {} },
          { users: 1000, metrics: {} },
        ],
      },
    ],
  }) as unknown as ExperimentSnapshotAnalysis;
const relativeAnalysis = analysis({ differenceType: "relative" });

const summarize = (args: Partial<Parameters<typeof summarizeHealth>[0]>) =>
  summarizeHealth({
    trafficQuery,
    clusterTrafficQuery: undefined,
    clusterHealthQuery: undefined,
    settings,
    analyses: [relativeAnalysis],
    experimentMaxLengthDays: undefined,
    ...args,
  });

describe("summarizeHealth", () => {
  it("is undefined when the snapshot ran no traffic query", () => {
    expect(summarize({ trafficQuery: undefined })).toBeUndefined();
  });

  it("reports a failed traffic query without exposures or power", () => {
    const summary = summarize({ trafficQuery: query([], "boom") });
    expect(summary?.health.traffic.error).toBeDefined();
    expect(summary?.multipleExposures).toBeUndefined();
    expect(summary?.health.power).toBeUndefined();
  });

  describe("multiple exposures", () => {
    it("come from the traffic query", () => {
      expect(summarize({})?.multipleExposures).toBe(353);
    });

    it("come from the cluster health query when there is one", () => {
      const summary = summarize({ clusterHealthQuery });
      expect(summary?.multipleExposures).toBe(12);
      expect(summary?.health.subUnitMultipleExposures).toBeDefined();
    });

    it("stay the traffic query's when the cluster health query failed", () => {
      expect(
        summarize({ clusterHealthQuery: query([], "boom") })?.multipleExposures,
      ).toBe(353);
    });
  });

  it("analyzes cluster traffic separately", () => {
    expect(summarize({})?.health.clusterTraffic).toBeUndefined();
    expect(
      summarize({ clusterTrafficQuery: trafficQuery })?.health.clusterTraffic
        ?.overall.variationUnits,
    ).toEqual([1000, 1000]);
  });

  describe("power", () => {
    it("is computed from the relative analysis", () => {
      expect(summarize({})?.health.power).toBeDefined();
    });

    it.each<{
      name: string;
      args: Partial<Parameters<typeof summarizeHealth>[0]>;
    }>([
      {
        name: "there is no relative analysis",
        args: { analyses: [analysis({ differenceType: "absolute" })] },
      },
      {
        name: "the experiment is a bandit",
        args: {
          settings: {
            ...settings,
            banditSettings: {},
          } as unknown as ExperimentSnapshotSettings,
        },
      },
    ])("is left out when $name", ({ args }) => {
      expect(summarize(args)?.health.power).toBeUndefined();
    });
  });

  it("checks covariate imbalance only when that analysis was run", () => {
    expect(summarize({})?.health.covariateImbalance).toBeUndefined();
    expect(
      summarize({
        analyses: [
          relativeAnalysis,
          analysis({
            differenceType: "absolute",
            useCovariateAsResponse: true,
          }),
        ],
      })?.health.covariateImbalance,
    ).toBeDefined();
  });
});
