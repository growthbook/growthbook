import { ExperimentInterface } from "shared/types/experiment";
import {
  ExperimentSnapshotAnalysis,
  ExperimentSnapshotInterface,
  SnapshotVariation,
} from "shared/types/experiment-snapshot";
import { ExperimentMetricInterface } from "shared/experiments";
import {
  MAX_METRICS_FOR_AI,
  MAX_QUERY_FILTER_CHARS,
  METRIC_ROLE_RESERVATIONS,
  summarizeExperimentAnalysisForAI,
} from "back-end/src/util/ai-prompt.util";
import { snapshotFactory } from "back-end/test/factories/Snapshot.factory";

const experiment = {
  id: "exp_1",
  name: "Checkout redesign",
  status: "stopped",
  hypothesis: "A shorter checkout converts better",
  description: "Two-step checkout vs the current four-step flow",
  analysis: "Looks like a win",
  variations: [
    { id: "var_0", key: "0", name: "Control", description: "Current flow" },
    { id: "var_1", key: "1", name: "Two-step", description: "Shorter flow" },
  ],
  phases: [
    {
      name: "Ramp",
      reason: "Ramping up traffic",
      coverage: 0.1,
      dateStarted: new Date("2025-12-01T00:00:00Z"),
      dateEnded: new Date("2026-01-01T00:00:00Z"),
      variationWeights: [0.5, 0.5],
    },
    {
      name: "Main",
      reason: "",
      coverage: 1,
      dateStarted: new Date("2026-01-01T00:00:00Z"),
      dateEnded: new Date("2026-02-01T00:00:00Z"),
      variationWeights: [0.5, 0.5],
    },
  ],
  goalMetrics: ["met_purchases"],
  secondaryMetrics: ["met_revenue"],
  guardrailMetrics: ["met_errors"],
} as ExperimentInterface;

const srmThreshold = 0.001;

const metricMap = new Map<string, ExperimentMetricInterface>([
  [
    "met_purchases",
    { id: "met_purchases", name: "Purchases", type: "binomial" },
  ],
  ["met_revenue", { id: "met_revenue", name: "Revenue", type: "revenue" }],
  [
    "met_errors",
    { id: "met_errors", name: "Errors", type: "count", inverse: true },
  ],
] as [string, ExperimentMetricInterface][]);

function makeSnapshot(variations: SnapshotVariation[], srm = 0.63241234) {
  return snapshotFactory.build({
    multipleExposures: 3,
    analyses: [
      {
        analysisKey: "default",
        dateCreated: new Date(),
        status: "success",
        settings: {
          dimensions: [],
          statsEngine: "frequentist",
          differenceType: "relative",
          pValueThreshold: 0.05,
          sequentialTesting: true,
          regressionAdjusted: false,
          numGoalMetrics: 1,
          numGuardrailMetrics: 1,
        },
        results: [{ name: "All", srm, variations }],
      } as ExperimentSnapshotAnalysis,
    ],
  });
}

const resultVariations: SnapshotVariation[] = [
  {
    users: 1000,
    metrics: {
      met_purchases: { value: 100, cr: 0.1, users: 1000 },
      met_revenue: { value: 5000, cr: 5, users: 1000 },
      met_errors: { value: 20, cr: 0.02, users: 1000 },
    },
  },
  {
    users: 1010,
    metrics: {
      met_purchases: {
        value: 121,
        cr: 0.119801980198,
        users: 1010,
        expected: 0.198019801980198,
        ci: [0.0512345678, 0.3512345678],
        pValue: 0.012345678,
      },
      met_revenue: { value: 5600, cr: 5.544554455, users: 1010 },
      met_errors: {
        value: 30,
        cr: 0.0297029703,
        users: 1010,
        expected: 0.485148514,
        ci: [-0.1, 1.1],
        ciAdjusted: [-0.25, 1.25],
        pValue: 0.04,
        pValueAdjusted: 0.09,
      },
    },
  },
];

describe("summarizeExperimentAnalysisForAI", () => {
  it("summarizes the experiment when there is no snapshot", () => {
    const summary = summarizeExperimentAnalysisForAI({
      experiment,
      snapshot: undefined,
      metricMap,
      goalMetricIds: ["met_purchases"],
      secondaryMetricIds: ["met_revenue"],
      guardrailMetricIds: ["met_errors"],
      srmThreshold,
    });

    expect(summary.results).toBeUndefined();
    expect(summary.experiment).toEqual({
      id: "exp_1",
      name: "Checkout redesign",
      status: "stopped",
      hypothesis: "A shorter checkout converts better",
      description: "Two-step checkout vs the current four-step flow",
      priorAnalysis: "Looks like a win",
      variations: [
        { name: "Control", description: "Current flow", weight: 0.5 },
        { name: "Two-step", description: "Shorter flow", weight: 0.5 },
      ],
      startDate: "2026-01-01T00:00:00.000Z",
      endDate: "2026-02-01T00:00:00.000Z",
      coverage: 1,
      priorPhases: [
        {
          name: "Ramp",
          reason: "Ramping up traffic",
          startDate: "2025-12-01T00:00:00.000Z",
          endDate: "2026-01-01T00:00:00.000Z",
        },
      ],
    });
  });

  it("truncates long free-text fields", () => {
    const summary = summarizeExperimentAnalysisForAI({
      experiment: {
        ...experiment,
        hypothesis: "x".repeat(1000),
        variations: [
          { ...experiment.variations[0], description: "y".repeat(1000) },
        ],
      },
      snapshot: undefined,
      metricMap,
      goalMetricIds: [],
      secondaryMetricIds: [],
      guardrailMetricIds: [],
      srmThreshold,
    });

    expect(summary.experiment.hypothesis).toBe("x".repeat(600) + "…");
    expect(summary.experiment.variations[0].description).toBe(
      "y".repeat(300) + "…",
    );
  });

  it("groups results by metric, ordered goal then guardrail then secondary", () => {
    const summary = summarizeExperimentAnalysisForAI({
      experiment,
      snapshot: makeSnapshot(resultVariations),
      metricMap,
      goalMetricIds: ["met_purchases"],
      secondaryMetricIds: ["met_revenue"],
      guardrailMetricIds: ["met_errors"],
      srmThreshold,
    });

    expect(summary.results?.statsEngine).toBe("frequentist");
    expect(summary.results?.differenceType).toBe("relative");
    expect(summary.results?.pValueThreshold).toBe(0.05);
    expect(summary.results?.sequentialTesting).toBe(true);
    expect(summary.results?.srmPValue).toBe(0.6324);
    expect(summary.results?.srmThreshold).toBe(0.001);
    expect(summary.results?.multipleExposures).toBe(3);
    expect(summary.results?.droppedMetrics).toBeUndefined();

    expect(summary.results?.metrics.map((m) => [m.metric, m.role])).toEqual([
      ["Purchases", "goal"],
      ["Errors", "guardrail"],
      ["Revenue", "secondary"],
    ]);

    const purchases = summary.results?.metrics[0];
    expect(purchases?.metricType).toBe("binomial");
    expect(purchases?.betterDirection).toBe("higher");
    expect(purchases?.variations).toEqual([
      { variation: "Control", users: 1000, value: 100, cr: 0.1 },
      {
        variation: "Two-step",
        users: 1010,
        value: 121,
        cr: 0.1198,
        lift: 0.198,
        ci: [0.0512, 0.3512],
        pValue: 0.0123,
      },
    ]);
  });

  it("marks inverse metrics as better when lower and prefers adjusted stats", () => {
    const summary = summarizeExperimentAnalysisForAI({
      experiment,
      snapshot: makeSnapshot(resultVariations),
      metricMap,
      goalMetricIds: ["met_purchases"],
      secondaryMetricIds: ["met_revenue"],
      guardrailMetricIds: ["met_errors"],
      srmThreshold,
    });

    const errors = summary.results?.metrics.find((m) => m.metric === "Errors");
    expect(errors?.betterDirection).toBe("lower");
    expect(errors?.variations[1].ci).toEqual([-0.25, 1.25]);
    expect(errors?.variations[1].pValue).toBe(0.09);
  });

  it("omits metrics with no results and metrics missing from the metric map", () => {
    const summary = summarizeExperimentAnalysisForAI({
      experiment,
      snapshot: makeSnapshot(resultVariations),
      metricMap,
      goalMetricIds: ["met_purchases", "met_deleted"],
      secondaryMetricIds: [],
      guardrailMetricIds: ["met_no_results"],
      srmThreshold,
    });

    expect(summary.results?.metrics.map((m) => m.metric)).toEqual([
      "Purchases",
    ]);
    expect(summary.results?.droppedMetrics).toBeUndefined();
  });

  function manyMetrics(prefix: string, count: number) {
    return Array.from({ length: count }, (_, i) => `${prefix}_${i}`);
  }

  function summarizeManyMetrics({
    goal,
    guardrail,
    secondary,
  }: {
    goal: number;
    guardrail: number;
    secondary: number;
  }) {
    const goalIds = manyMetrics("goal", goal);
    const guardrailIds = manyMetrics("guardrail", guardrail);
    const secondaryIds = manyMetrics("secondary", secondary);
    const allIds = [...goalIds, ...guardrailIds, ...secondaryIds];

    const bigMetricMap = new Map<string, ExperimentMetricInterface>(
      allIds.map((id) => [
        id,
        { id, name: id, type: "binomial" } as ExperimentMetricInterface,
      ]),
    );
    const bigVariations: SnapshotVariation[] = [
      {
        users: 100,
        metrics: Object.fromEntries(
          allIds.map((id) => [id, { value: 10, cr: 0.1, users: 100 }]),
        ),
      },
    ];

    return summarizeExperimentAnalysisForAI({
      experiment,
      snapshot: makeSnapshot(bigVariations),
      metricMap: bigMetricMap,
      goalMetricIds: goalIds,
      secondaryMetricIds: secondaryIds,
      guardrailMetricIds: guardrailIds,
      srmThreshold,
    });
  }

  function countByRole(
    summary: ReturnType<typeof summarizeExperimentAnalysisForAI>,
  ) {
    return (summary.results?.metrics || []).reduce<Record<string, number>>(
      (acc, m) => ({ ...acc, [m.role]: (acc[m.role] || 0) + 1 }),
      {},
    );
  }

  it("never drops a metric while the cap has room", () => {
    const summary = summarizeManyMetrics({
      goal: MAX_METRICS_FOR_AI - 10,
      guardrail: 5,
      secondary: 5,
    });

    expect(summary.results?.metrics).toHaveLength(MAX_METRICS_FOR_AI);
    expect(summary.results?.droppedMetrics).toBeUndefined();
  });

  it("lets one role use the whole cap when the others need none", () => {
    const summary = summarizeManyMetrics({
      goal: MAX_METRICS_FOR_AI + 50,
      guardrail: 0,
      secondary: 0,
    });

    expect(countByRole(summary)).toEqual({ goal: MAX_METRICS_FOR_AI });
    expect(summary.results?.droppedMetrics).toEqual({ goal: 50 });
  });

  it("keeps guardrails when goal metrics would otherwise fill the cap", () => {
    const goal = MAX_METRICS_FOR_AI + 100;
    const guardrail = 60;
    const summary = summarizeManyMetrics({ goal, guardrail, secondary: 0 });

    expect(countByRole(summary)).toEqual({
      goal: MAX_METRICS_FOR_AI - guardrail,
      guardrail,
    });
    expect(summary.results?.droppedMetrics).toEqual({
      goal: goal - (MAX_METRICS_FOR_AI - guardrail),
    });
  });

  it("falls back to each role's reservation when every role is oversubscribed", () => {
    const summary = summarizeManyMetrics({
      goal: 1000,
      guardrail: 1000,
      secondary: 1000,
    });

    expect(countByRole(summary)).toEqual(METRIC_ROLE_RESERVATIONS);
    expect(summary.results?.droppedMetrics).toEqual({
      goal: 1000 - METRIC_ROLE_RESERVATIONS.goal,
      guardrail: 1000 - METRIC_ROLE_RESERVATIONS.guardrail,
      secondary: 1000 - METRIC_ROLE_RESERVATIONS.secondary,
    });
  });

  it("reduces snapshot health to its top-level verdicts", () => {
    const snapshot = makeSnapshot(resultVariations);
    snapshot.health = {
      traffic: {
        overall: { dimension: "All", variationUnits: [1000, 1010] },
        dimension: {},
        error: "TOO_MANY_ROWS",
      },
      power: {
        type: "success",
        power: 0.42123456,
        isLowPowered: true,
        additionalDaysNeeded: 9,
        metricVariationPowerResults: [],
      },
      covariateImbalance: {
        isImbalanced: false,
        pValueThreshold: 0.05,
        numGoalMetrics: 1,
        numGoalMetricsImbalanced: 0,
        numGuardrailMetrics: 1,
        numGuardrailMetricsImbalanced: 0,
        numSecondaryMetrics: 1,
        numSecondaryMetricsImbalanced: 0,
        metricVariationCovariateImbalanceResults: [],
      },
    } as ExperimentSnapshotInterface["health"];

    const summary = summarizeExperimentAnalysisForAI({
      experiment,
      snapshot,
      metricMap,
      goalMetricIds: ["met_purchases"],
      secondaryMetricIds: [],
      guardrailMetricIds: [],
      srmThreshold,
    });

    expect(summary.results?.health).toEqual({
      power: 0.4212,
      isLowPowered: true,
      additionalDaysNeeded: 9,
      covariateImbalance: false,
      trafficError: "TOO_MANY_ROWS",
    });
  });

  it("reports low power without a power estimate when the calculation failed", () => {
    const snapshot = makeSnapshot(resultVariations);
    snapshot.health = {
      traffic: {
        overall: { dimension: "All", variationUnits: [] },
        dimension: {},
      },
      power: {
        type: "error",
        isLowPowered: true,
        metricVariationPowerResults: [],
      },
    } as ExperimentSnapshotInterface["health"];

    const summary = summarizeExperimentAnalysisForAI({
      experiment,
      snapshot,
      metricMap,
      goalMetricIds: ["met_purchases"],
      secondaryMetricIds: [],
      guardrailMetricIds: [],
      srmThreshold,
    });

    expect(summary.results?.health).toEqual({ isLowPowered: true });
  });

  it("omits health entirely when the snapshot has none", () => {
    const summary = summarizeExperimentAnalysisForAI({
      experiment,
      snapshot: makeSnapshot(resultVariations),
      metricMap,
      goalMetricIds: ["met_purchases"],
      secondaryMetricIds: [],
      guardrailMetricIds: [],
      srmThreshold,
    });

    expect(summary.results?.health).toBeUndefined();
  });

  it("reports the segment and query filter that scoped the analysis", () => {
    const snapshot = makeSnapshot(resultVariations);
    snapshot.settings.segment = "seg_123";
    snapshot.settings.queryFilter = "country = 'US'";
    snapshot.unknownVariations = ["3", "4"];

    const summary = summarizeExperimentAnalysisForAI({
      experiment,
      snapshot,
      metricMap,
      goalMetricIds: ["met_purchases"],
      secondaryMetricIds: [],
      guardrailMetricIds: [],
      segmentName: "Logged-in mobile users",
      srmThreshold,
    });

    expect(summary.results?.segment).toBe("Logged-in mobile users");
    expect(summary.results?.queryFilter).toBe("country = 'US'");
    expect(summary.results?.unknownVariations).toEqual(["3", "4"]);
  });

  it("falls back to the segment id when the segment name is unavailable", () => {
    const snapshot = makeSnapshot(resultVariations);
    snapshot.settings.segment = "seg_123";

    const summary = summarizeExperimentAnalysisForAI({
      experiment,
      snapshot,
      metricMap,
      goalMetricIds: ["met_purchases"],
      secondaryMetricIds: [],
      guardrailMetricIds: [],
      segmentName: null,
      srmThreshold,
    });

    expect(summary.results?.segment).toBe("seg_123");
  });

  it("truncates a long query filter", () => {
    const snapshot = makeSnapshot(resultVariations);
    snapshot.settings.queryFilter = "a".repeat(1000);

    const summary = summarizeExperimentAnalysisForAI({
      experiment,
      snapshot,
      metricMap,
      goalMetricIds: ["met_purchases"],
      secondaryMetricIds: [],
      guardrailMetricIds: [],
      srmThreshold,
    });

    expect(summary.results?.queryFilter).toBe(
      "a".repeat(MAX_QUERY_FILTER_CHARS) + "…",
    );
  });

  it("omits scoping fields when the analysis covered everyone", () => {
    const summary = summarizeExperimentAnalysisForAI({
      experiment,
      snapshot: makeSnapshot(resultVariations),
      metricMap,
      goalMetricIds: ["met_purchases"],
      secondaryMetricIds: [],
      guardrailMetricIds: [],
      srmThreshold,
    });

    expect(summary.results?.segment).toBeUndefined();
    expect(summary.results?.queryFilter).toBeUndefined();
    expect(summary.results?.unknownVariations).toBeUndefined();
  });

  it("labels result rows using the latest phase's variation order", () => {
    // Snapshot rows follow the phase's list, which here is reversed relative
    // to experiment.variations.
    const reorderedExperiment = {
      ...experiment,
      phases: [
        {
          ...experiment.phases[1],
          variations: [
            { id: "var_1", status: "active" },
            { id: "var_0", status: "active" },
          ],
          variationWeights: [0.7, 0.3],
        },
      ],
    } as ExperimentInterface;

    const summary = summarizeExperimentAnalysisForAI({
      experiment: reorderedExperiment,
      snapshot: makeSnapshot(resultVariations),
      metricMap,
      goalMetricIds: ["met_purchases"],
      secondaryMetricIds: [],
      guardrailMetricIds: [],
      srmThreshold,
    });

    expect(summary.experiment.variations).toEqual([
      { name: "Two-step", description: "Shorter flow", weight: 0.7 },
      { name: "Control", description: "Current flow", weight: 0.3 },
    ]);
    // resultVariations[1] holds the lift, so it must be labelled with the
    // phase's second variation, not the experiment's.
    expect(summary.results?.metrics[0].variations).toEqual([
      { variation: "Two-step", users: 1000, value: 100, cr: 0.1 },
      {
        variation: "Control",
        users: 1010,
        value: 121,
        cr: 0.1198,
        lift: 0.198,
        ci: [0.0512, 0.3512],
        pValue: 0.0123,
      },
    ]);
  });

  it("keeps warehouse queries and health time series out of the prompt", () => {
    const snapshot: ExperimentSnapshotInterface = {
      ...makeSnapshot(resultVariations),
      queries: [
        {
          query: "SELECT secret_column FROM warehouse",
          status: "succeeded",
          name: "results",
        },
      ] as unknown as ExperimentSnapshotInterface["queries"],
      health: {
        traffic: { overall: { dimension: "All", variationUnits: [1, 2] } },
      } as unknown as ExperimentSnapshotInterface["health"],
    };

    const serialized = JSON.stringify(
      summarizeExperimentAnalysisForAI({
        experiment,
        snapshot,
        metricMap,
        goalMetricIds: ["met_purchases"],
        secondaryMetricIds: ["met_revenue"],
        guardrailMetricIds: ["met_errors"],
        srmThreshold,
      }),
    );

    expect(serialized).not.toContain("secret_column");
    expect(serialized).not.toContain("variationUnits");
    expect(serialized.length).toBeLessThan(JSON.stringify(snapshot).length);
  });
});
