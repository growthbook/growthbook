import {
  getResultsOutdatedReasons,
  type ResultsOutdatedReason,
} from "../src/experiments/outdated-reasons";

type Input = Parameters<typeof getResultsOutdatedReasons>[0];

const START = new Date("2026-01-01T00:00:00Z");
const END = new Date("2026-01-10T00:00:00Z");

function experiment(
  overrides: Partial<Input["experiment"]> = {},
): Input["experiment"] {
  return {
    type: "standard",
    variations: [
      { id: "v0", key: "0", name: "Control" },
      { id: "v1", key: "1", name: "Treatment" },
    ],
    phases: [
      {
        dateStarted: START.toISOString(),
        dateEnded: END.toISOString(),
        variations: [],
      },
    ],
    goalMetrics: ["fact__a"],
    secondaryMetrics: [],
    guardrailMetrics: [],
    activationMetric: "",
    segment: "",
    queryFilter: "",
    skipPartialData: false,
    exposureQueryId: "user_exposure",
    exposureQueryIdentifierType: "user_id",
    attributionModel: "firstExposure",
    regressionAdjustmentEnabled: false,
    ...overrides,
  } as Input["experiment"];
}

function snapshot(
  settings: Partial<Input["snapshot"]["settings"]> = {},
  extra: Partial<Input["snapshot"]> = {},
): Input["snapshot"] {
  return {
    type: "standard",
    dateCreated: END,
    settings: {
      goalMetrics: ["fact__a"],
      secondaryMetrics: [],
      guardrailMetrics: [],
      activationMetric: null,
      segment: "",
      queryFilter: "",
      skipPartialData: false,
      exposureQueryId: "user_exposure",
      exposureQueryIdentifierType: "user_id",
      attributionModel: "firstExposure",
      startDate: START,
      endDate: END,
      variations: [
        { id: "0", weight: 0.5 },
        { id: "1", weight: 0.5 },
      ],
      ...settings,
    },
    analyses: [
      {
        settings: {
          statsEngine: "bayesian",
          pValueThreshold: 0.05,
          regressionAdjusted: false,
          postStratificationEnabled: false,
          sequentialTesting: false,
        },
      },
    ],
    ...extra,
  } as Input["snapshot"];
}

function reasons(overrides: Partial<Input> = {}): ResultsOutdatedReason[] {
  return getResultsOutdatedReasons({
    experiment: experiment(),
    snapshot: snapshot(),
    metricGroups: [],
    orgSettings: {},
    pValueThreshold: 0.05,
    statsEngine: "bayesian",
    features: {
      regressionAdjustment: true,
      postStratification: false,
      sequentialTesting: true,
    },
    phase: 0,
    exposureQueries: [],
    unjoinableMetricIds: new Set(),
    conversionWindowMetricIds: new Set(),
    newerOverallResultsAvailable: false,
    resultsUpdateDisabled: false,
    ...overrides,
  });
}

describe("getResultsOutdatedReasons", () => {
  it.each<[ResultsOutdatedReason, Partial<Input>]>([
    ["stats_engine", { statsEngine: "frequentist" }],
    [
      "activation_metric",
      { experiment: experiment({ activationMetric: "m" }) },
    ],
    ["segment", { experiment: experiment({ segment: "seg_1" }) }],
    ["query_filter", { experiment: experiment({ queryFilter: "x > 1" }) }],
    [
      "conversion_behavior",
      { experiment: experiment({ skipPartialData: true }) },
    ],
    [
      "assignment_query",
      { experiment: experiment({ exposureQueryId: "other" }) },
    ],
    [
      "identifier_type",
      { experiment: experiment({ exposureQueryIdentifierType: "anon_id" }) },
    ],
    [
      "cluster_analysis",
      { experiment: experiment({ isClusterExperiment: true }) },
    ],
    [
      "attribution_model",
      { experiment: experiment({ attributionModel: "experimentDuration" }) },
    ],
    [
      "metrics_changed",
      { experiment: experiment({ goalMetrics: ["fact__a", "fact__b"] }) },
    ],
    [
      "variations_changed",
      {
        experiment: experiment({
          variations: [
            { id: "v0", key: "0", name: "Control", screenshots: [] },
            { id: "v2", key: "2", name: "Other", screenshots: [] },
          ],
        }),
      },
    ],
    [
      "analysis_dates_changed",
      {
        experiment: experiment({
          phases: [
            {
              dateStarted: START.toISOString(),
              dateEnded: "2026-01-12T00:00:00Z",
              variations: [],
            },
          ],
        }),
      },
    ],
    ["p_value_threshold", { pValueThreshold: 0.1 }],
    [
      "cuped",
      { experiment: experiment({ regressionAdjustmentEnabled: true }) },
    ],
    ["newer_overall_results", { newerOverallResultsAvailable: true }],
    [
      "cluster_sub_unit",
      {
        experiment: experiment({
          isClusterExperiment: true,
          clusterSubUnitIdentifier: "user_id",
        }),
        snapshot: snapshot({
          isClusterExperiment: true,
          clusterSubUnitIdentifier: "device_id",
        }),
      },
    ],
  ])("returns %s for its change alone", (expected, overrides) => {
    expect(reasons(overrides)).toEqual([expected]);
  });

  it("lists every reason in the badge's order", () => {
    expect(
      reasons({
        experiment: experiment({
          goalMetrics: ["fact__a", "fact__b"],
          segment: "seg_1",
        }),
        pValueThreshold: 0.1,
      }),
    ).toEqual(["segment", "metrics_changed", "p_value_threshold"]);
  });

  it.each<[string, Partial<Input>]>([
    ["the results match the experiment", {}],
    [
      "the snapshot has no analysis",
      {
        experiment: experiment({ segment: "seg_1" }),
        snapshot: snapshot({}, { analyses: [] }),
      },
    ],
    ["a metric was removed", { experiment: experiment({ goalMetrics: [] }) }],
    [
      "the only added metric is one no update computes",
      {
        experiment: experiment({
          goalMetrics: ["fact__a", "fact__unjoinable"],
        }),
        unjoinableMetricIds: new Set(["fact__unjoinable"]),
      },
    ],
    [
      "the only added metric is a holdout's conversion-window metric",
      {
        experiment: experiment({
          type: "holdout",
          goalMetrics: ["fact__a", "fact__conversion"],
        }),
        conversionWindowMetricIds: new Set(["fact__conversion"]),
      },
    ],
    [
      "the analysis dates changed while updates are disabled",
      {
        experiment: experiment({
          phases: [
            {
              dateStarted: START.toISOString(),
              dateEnded: "2026-01-12T00:00:00Z",
              variations: [],
            },
          ],
        }),
        resultsUpdateDisabled: true,
      },
    ],
  ])("returns no reason when %s", (name, overrides) => {
    expect(reasons(overrides)).toEqual([]);
  });

  describe("a frequentist analysis that stored corrected p-values", () => {
    const corrected = (goalMetrics: string[]): Partial<Input> => ({
      statsEngine: "frequentist",
      orgSettings: { pValueCorrection: "holm-bonferroni" },
      snapshot: snapshot(
        { goalMetrics },
        {
          analyses: [
            {
              settings: {
                statsEngine: "frequentist",
                dimensions: [],
                pValueThreshold: 0.05,
                regressionAdjusted: false,
                postStratificationEnabled: false,
                sequentialTesting: false,
                pValueCorrection: "holm-bonferroni",
              },
            },
          ] as Input["snapshot"]["analyses"],
        },
      ),
    });

    it("returns p_value_correction when the organization's method changed", () => {
      expect(
        reasons({
          ...corrected(["fact__a"]),
          orgSettings: { pValueCorrection: "benjamini-hochberg" },
        }),
      ).toEqual(["p_value_correction"]);
    });

    it("returns goal_metrics_changed when an analyzed goal metric was removed", () => {
      expect(reasons(corrected(["fact__a", "fact__b"]))).toEqual([
        "goal_metrics_changed",
      ]);
    });

    it("returns only metrics_changed for a newly added goal metric", () => {
      expect(
        reasons({
          ...corrected(["fact__a"]),
          experiment: experiment({ goalMetrics: ["fact__a", "fact__b"] }),
        }),
      ).toEqual(["metrics_changed"]);
    });
  });

  it("measures a lagged running phase from the base update of a new-metrics update", () => {
    const now = Date.now();
    const runningExperiment = experiment({
      phases: [{ dateStarted: START.toISOString(), variations: [] }],
    });
    const laggedSettings = {
      endDate: new Date(now - 6 * 60 * 60 * 1000),
      endDateIsCutoff: true,
    };
    const threeDaysAgo = new Date(now - 3 * 24 * 60 * 60 * 1000);
    expect(
      reasons({
        experiment: runningExperiment,
        snapshot: snapshot(laggedSettings, { dateCreated: new Date(now) }),
      }),
    ).toEqual([]);
    expect(
      reasons({
        experiment: runningExperiment,
        snapshot: snapshot(laggedSettings, {
          dateCreated: new Date(now),
          updateScope: {
            kind: "new_metrics" as const,
            parentSnapshotId: "snp_base",
            queriedMetricIds: ["fact__a"],
            base: {
              dateCreated: threeDaysAgo,
              runStarted: null,
              cutoffDate: laggedSettings.endDate,
            },
          },
        }),
      }),
    ).toEqual(["analysis_dates_changed"]);
  });
});
