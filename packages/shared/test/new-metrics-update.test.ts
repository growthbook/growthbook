import { MetricGroupInterface } from "shared/types/metric-groups";
import {
  ExperimentSnapshotAnalysisSettings,
  ExperimentSnapshotInterface,
} from "shared/types/experiment-snapshot";
import type { FactMetricInterface } from "shared/types/fact-table";
import type { ExperimentMetricDefinition } from "../src/experiments/experiments";
import {
  getComputableNewMetricIds,
  getCopiedMetricCounts,
  getMetricIdsMissingFromSnapshot,
  getMetricStatsEngineInputs,
  getPlannedCopiedMetricSettings,
  getSnapshotSideEffects,
  getStatsEngineAnalysisSettings,
  haveStatsEngineInputsChanged,
} from "../src/experiments/new-metrics-update";

function snapshotSettingsFor(metricIds: string[]) {
  return {
    metricSettings: metricIds.map((id) => ({
      id,
      computedSettings: undefined,
    })),
  } as unknown as Parameters<
    typeof getMetricIdsMissingFromSnapshot
  >[0]["snapshotSettings"];
}

function metricGroup(id: string, metrics: string[]): MetricGroupInterface {
  return { id, metrics } as unknown as MetricGroupInterface;
}

describe("getMetricIdsMissingFromSnapshot", () => {
  type Experiment = Parameters<
    typeof getMetricIdsMissingFromSnapshot
  >[0]["experiment"];

  it.each<{
    name: string;
    experiment: Experiment;
    computed: string[];
    metricGroups?: MetricGroupInterface[];
    expected: string[];
  }>([
    {
      name: "returns the metrics a snapshot never computed, in experiment order",
      experiment: {
        goalMetrics: ["fact__a", "fact__new_goal"],
        secondaryMetrics: ["fact__b"],
        guardrailMetrics: ["fact__new_guardrail"],
      },
      computed: ["fact__a", "fact__b"],
      expected: ["fact__new_goal", "fact__new_guardrail"],
    },
    {
      name: "expands metric groups and lists a metric once",
      experiment: {
        goalMetrics: ["mg_core", "fact__c"],
        secondaryMetrics: ["mg_more"],
        guardrailMetrics: [],
      },
      computed: ["fact__a"],
      metricGroups: [
        metricGroup("mg_core", ["fact__a", "fact__b"]),
        metricGroup("mg_more", ["fact__b", "met_legacy"]),
      ],
      expected: ["fact__b", "fact__c", "met_legacy"],
    },
    {
      name: "leaves out the activation metric",
      experiment: {
        goalMetrics: ["fact__a"],
        secondaryMetrics: [],
        guardrailMetrics: [],
        activationMetric: "met_activation",
      } as Experiment,
      computed: ["fact__a"],
      expected: [],
    },
    {
      name: "lists the activation metric when it is also analyzed",
      experiment: {
        goalMetrics: ["fact__a", "met_activation"],
        secondaryMetrics: [],
        guardrailMetrics: [],
        activationMetric: "met_activation",
      } as Experiment,
      computed: ["fact__a"],
      expected: ["met_activation"],
    },
    {
      name: "ignores slice and funnel step ids on either side",
      experiment: {
        goalMetrics: [
          "fact__a",
          "fact__a?dim:country=us",
          "fact__funnel?step=1",
        ],
        secondaryMetrics: [],
        guardrailMetrics: [],
      },
      computed: ["fact__a", "fact__b?dim:country=us"],
      expected: [],
    },
  ])("$name", ({ experiment, computed, metricGroups = [], expected }) => {
    expect(
      getMetricIdsMissingFromSnapshot({
        experiment,
        snapshotSettings: snapshotSettingsFor(computed),
        metricGroups,
      }),
    ).toEqual(expected);
  });
});

describe("getSnapshotSideEffects", () => {
  it("lets a new-metrics update skip the schedule, dashboards and update alerts", () => {
    const baseDateCreated = new Date("2026-11-10T00:00:00Z");
    const effects = getSnapshotSideEffects({
      type: "standard",
      dateCreated: new Date("2026-11-12T00:00:00Z"),
      settings: { metricSettings: [{ id: "met_a" }, { id: "met_c" }] },
      updateScope: {
        kind: "new_metrics" as const,
        parentSnapshotId: "snp_base",
        queriedMetricIds: ["met_c"],
        base: {
          dateCreated: baseDateCreated,
          runStarted: null,
          cutoffDate: null,
        },
      },
    } as unknown as ExperimentSnapshotInterface);

    expect(effects).toMatchObject({
      advanceUpdateSchedule: false,
      refreshDashboards: false,
      ownsUpdateFailedAlert: false,
    });
    expect(effects.timeSeries.pointDate).toEqual(baseDateCreated);
    expect(effects.timeSeries.includesMetric("met_c?dim:os=ios")).toBe(true);
    expect(effects.timeSeries.includesMetric("met_a")).toBe(false);
  });
});

// A report never copies a lineage, but one that did must act as a report.
describe("a report snapshot copied from a new-metrics update", () => {
  const report = {
    type: "report",
    dateCreated: new Date("2026-11-12T00:00:00Z"),
    settings: { metricSettings: [{ id: "fact__a" }] },
    updateScope: {
      kind: "new_metrics" as const,
      parentSnapshotId: "snp_base",
      queriedMetricIds: ["fact__new"],
      base: {
        dateCreated: new Date("2026-11-10T00:00:00Z"),
        runStarted: null,
        cutoffDate: null,
      },
    },
  } as unknown as ExperimentSnapshotInterface;

  it("has the side effects of a report, not of a new-metrics update", () => {
    const effects = getSnapshotSideEffects(report);

    expect(effects).toMatchObject({
      advanceUpdateSchedule: true,
      refreshDashboards: true,
      ownsUpdateFailedAlert: true,
    });
    expect(effects.timeSeries.pointDate).toEqual(report.dateCreated);
    expect(effects.timeSeries.includesMetric("fact__a")).toBe(true);
  });
});

describe("getComputableNewMetricIds", () => {
  type Args = Parameters<typeof getComputableNewMetricIds>[0];
  const factTables: Record<string, string[]> = {
    ft_user: ["user_id"],
    ft_region: ["region_id"],
    ft_device: ["device_id"],
  };
  const factMetric = (
    id: string,
    factTableId: string,
    overrides: Partial<FactMetricInterface> = {},
  ) =>
    ({
      id,
      metricType: "mean",
      numerator: { factTableId, column: "value" },
      denominator: null,
      windowSettings: { type: "" },
      ...overrides,
    }) as unknown as FactMetricInterface;
  const metrics: Record<string, ExperimentMetricDefinition> = {
    fact__user: factMetric("fact__user", "ft_user"),
    fact__region: factMetric("fact__region", "ft_region"),
    fact__device: factMetric("fact__device", "ft_device"),
    fact__conversion: factMetric("fact__conversion", "ft_user", {
      windowSettings: {
        type: "conversion",
      } as FactMetricInterface["windowSettings"],
    }),
    fact__quantile: factMetric("fact__quantile", "ft_user", {
      metricType: "quantile",
      quantileSettings: { type: "unit", quantile: 0.5, ignoreZeros: false },
    }),
    // Joins on the cluster id, but no cluster experiment analyzes a quantile.
    fact__region_quantile: factMetric("fact__region_quantile", "ft_region", {
      metricType: "quantile",
      quantileSettings: { type: "unit", quantile: 0.5, ignoreZeros: false },
    }),
    met_legacy: {
      id: "met_legacy",
      userIdTypes: ["user_id"],
    } as unknown as ExperimentMetricDefinition,
  };
  const computable = (
    experiment: Partial<Args["experiment"]>,
    {
      computed = ["fact__old"],
      identifierType = "user_id",
      metricGroups = [],
    }: {
      computed?: string[];
      identifierType?: string;
      metricGroups?: MetricGroupInterface[];
    } = {},
  ) =>
    getComputableNewMetricIds({
      experiment: {
        type: "standard",
        goalMetrics: [],
        secondaryMetrics: [],
        guardrailMetrics: [],
        ...experiment,
      },
      snapshotSettings: snapshotSettingsFor(computed),
      metricGroups,
      getMetricById: (id) => metrics[id],
      getFactTableById: (id) =>
        factTables[id] ? { userIdTypes: factTables[id] } : undefined,
      identifierType,
      datasourceSettings: {},
    });

  it("keeps added metrics that join the experiment's units", () => {
    expect(
      computable({
        goalMetrics: ["fact__old", "fact__user", "fact__device"],
        secondaryMetrics: ["met_legacy", "met_deleted"],
        guardrailMetrics: ["fact__region", "fact__quantile"],
      }),
    ).toEqual(["fact__user", "met_legacy", "fact__quantile"]);
  });

  it("lets every loaded metric join while the Data Source is unknown", () => {
    expect(
      getComputableNewMetricIds({
        experiment: {
          type: "standard",
          goalMetrics: ["fact__device", "met_deleted"],
          secondaryMetrics: [],
          guardrailMetrics: [],
        },
        snapshotSettings: snapshotSettingsFor([]),
        metricGroups: [],
        getMetricById: (id) => metrics[id],
        getFactTableById: () => undefined,
        identifierType: "user_id",
        datasourceSettings: undefined,
      }),
    ).toEqual(["fact__device"]);
  });

  it("leaves out a holdout's guardrails and conversion-window metrics, groups expanded", () => {
    expect(
      computable(
        {
          type: "holdout",
          goalMetrics: ["fact__user", "fact__conversion"],
          secondaryMetrics: ["fact__quantile"],
          guardrailMetrics: ["mg_guard", "fact__user"],
        },
        { metricGroups: [metricGroup("mg_guard", ["met_legacy"])] },
      ),
    ).toEqual(["fact__user", "fact__quantile"]);
  });

  it("keeps only cluster-eligible metrics in a cluster experiment", () => {
    expect(
      computable(
        {
          isClusterExperiment: true,
          clusterSubUnitIdentifier: "user_id",
          goalMetrics: [
            "fact__user",
            "fact__region",
            "fact__device",
            "fact__quantile",
            "met_legacy",
          ],
        },
        { identifierType: "region_id" },
      ),
    ).toEqual(["fact__user", "fact__region"]);
  });

  it("returns nothing when a cluster experiment's only added metric is ineligible", () => {
    expect(
      computable(
        {
          isClusterExperiment: true,
          clusterSubUnitIdentifier: "user_id",
          goalMetrics: ["fact__old", "fact__region_quantile"],
        },
        { identifierType: "region_id" },
      ),
    ).toEqual([]);
  });
});

describe("stats engine inputs", () => {
  const metric = {
    id: "met_a",
    inverse: false,
    priorSettings: { override: false, proper: false, mean: 0, stddev: 0.3 },
    targetMDE: 0.2,
  } as unknown as ExperimentMetricDefinition;
  const lists = {
    goalMetrics: ["met_a"],
    secondaryMetrics: [],
    guardrailMetrics: ["met_a"],
  };

  it("reads the snapshot's computed priors and target MDE over the definition's", () => {
    expect(
      getMetricStatsEngineInputs({ ...metric, inverse: true }, {
        ...lists,
        metricSettings: [
          {
            id: "met_a",
            computedSettings: {
              properPrior: true,
              properPriorMean: 0.1,
              properPriorStdDev: 0.5,
            },
          },
        ],
      } as unknown as Parameters<typeof getMetricStatsEngineInputs>[1]),
    ).toEqual({
      inverse: true,
      properPrior: true,
      properPriorMean: 0.1,
      properPriorStdDev: 0.5,
      targetMDE: 0.1,
      businessMetricTypes: ["goal", "guardrail"],
    });
  });

  it("falls back to the definition without computed settings", () => {
    expect(
      getMetricStatsEngineInputs(metric, { ...lists, metricSettings: [] }),
    ).toMatchObject({
      properPrior: false,
      properPriorStdDev: 0.3,
      targetMDE: 0.2,
    });
  });

  describe("getPlannedCopiedMetricSettings", () => {
    const experiment = {
      goalMetrics: ["mg_core"],
      secondaryMetrics: [],
      guardrailMetrics: [],
      regressionAdjustmentEnabled: false,
    };
    const definitions: Record<string, ExperimentMetricDefinition> = {
      met_a: metric,
    };
    const planned = (
      overrides: Partial<Parameters<typeof getPlannedCopiedMetricSettings>[0]>,
    ) =>
      getPlannedCopiedMetricSettings({
        parentSettings: snapshotSettingsFor(["met_a"]),
        experiment,
        metricGroups: [metricGroup("mg_core", ["met_a"])],
        organizationSettings: {},
        getMetricById: (id) => definitions[id],
        ...overrides,
      });
    const inputsOf = (settings: ReturnType<typeof planned>, id = "met_a") =>
      settings.metricStatsEngineInputs?.find((m) => m.id === id);

    it("expands metric groups and gives a slice its metric's priors but no type", () => {
      const settings = planned({
        parentSettings: snapshotSettingsFor(["met_a", "met_a?dim:country=US"]),
      });
      expect(inputsOf(settings)).toMatchObject({
        businessMetricTypes: ["goal"],
      });
      expect(inputsOf(settings, "met_a?dim:country=US")).toMatchObject({
        businessMetricTypes: [],
        properPriorStdDev: 0.3,
      });
    });

    it("applies the organization's default prior, then the experiment's overrides", () => {
      const organizationSettings = {
        metricDefaults: {
          priorSettings: { override: false, proper: true, mean: 0, stddev: 1 },
        },
      } as Parameters<typeof planned>[0]["organizationSettings"];
      expect(inputsOf(planned({ organizationSettings }))).toMatchObject({
        properPrior: true,
        properPriorStdDev: 1,
      });
      expect(
        inputsOf(
          planned({
            organizationSettings,
            experiment: {
              ...experiment,
              metricOverrides: [
                {
                  id: "met_a",
                  properPriorOverride: true,
                  properPriorEnabled: false,
                },
              ],
              decisionFrameworkSettings: {
                decisionFrameworkMetricOverrides: [
                  { id: "met_a", targetMDE: 0.05 },
                ],
              },
            },
          }),
        ),
      ).toMatchObject({ properPrior: false, targetMDE: 0.05 });
    });

    it("plans each metric's CUPED flag as the planner computes it", () => {
      const cupedOf = (settings: ReturnType<typeof planned>) =>
        settings.metricSettings[0]?.computedSettings
          ?.regressionAdjustmentEnabled;
      expect(cupedOf(planned({}))).toBe(false);
      const adjusted = { ...experiment, regressionAdjustmentEnabled: true };
      expect(cupedOf(planned({ experiment: adjusted }))).toBe(true);
      expect(
        cupedOf(
          planned({
            experiment: {
              ...adjusted,
              metricOverrides: [
                {
                  id: "met_a",
                  regressionAdjustmentOverride: true,
                  regressionAdjustmentEnabled: false,
                },
              ],
            },
          }),
        ),
      ).toBe(false);
      // A legacy ratio metric over a count denominator can't be adjusted.
      const ratio = {
        ...metric,
        denominator: "met_count",
      } as unknown as ExperimentMetricDefinition;
      const count = {
        ...metric,
        id: "met_count",
        type: "count",
      } as unknown as ExperimentMetricDefinition;
      expect(
        cupedOf(
          planned({
            experiment: adjusted,
            getMetricById: (id) => ({ met_a: ratio, met_count: count })[id],
          }),
        ),
      ).toBe(false);
    });

    it("gives an activation metric that is nothing else the planner's defaults", () => {
      const settings = planned({
        parentSettings: snapshotSettingsFor(["met_act"]),
        experiment: {
          ...experiment,
          activationMetric: "met_act",
          regressionAdjustmentEnabled: true,
        },
        organizationSettings: {
          metricDefaults: {
            priorSettings: {
              override: false,
              proper: true,
              mean: 0,
              stddev: 1,
            },
          },
        } as Parameters<typeof planned>[0]["organizationSettings"],
        getMetricById: (id) =>
          id === "met_act"
            ? ({ ...metric, id } as ExperimentMetricDefinition)
            : undefined,
      });
      expect(settings.metricSettings).toEqual([
        {
          id: "met_act",
          computedSettings: { regressionAdjustmentEnabled: false },
        },
      ]);
      expect(inputsOf(settings, "met_act")).toMatchObject({
        properPrior: false,
        properPriorStdDev: 0.3,
        businessMetricTypes: [],
      });
    });

    it("leaves out metrics no longer on the experiment, and gives an unresolved one no inputs", () => {
      expect(
        planned({
          parentSettings: snapshotSettingsFor(["met_a", "met_gone"]),
        }).metricSettings.map((m) => m.id),
      ).toEqual(["met_a"]);
      expect(planned({ getMetricById: () => null })).toEqual({
        metricSettings: [{ id: "met_a" }],
        metricStatsEngineInputs: [],
      });
    });
  });

  describe("haveStatsEngineInputsChanged", () => {
    const inputs = getMetricStatsEngineInputs(metric, {
      ...lists,
      metricSettings: [],
    });
    const changed = (getInputs: (id: string) => typeof inputs | null) =>
      haveStatsEngineInputsChanged({
        snapshotSettings: {
          metricStatsEngineInputs: [{ id: "met_a", ...inputs }],
        },
        metricIds: ["met_a"],
        getInputs,
      });

    it("compares each metric's inputs with the stored ones", () => {
      expect(changed(() => ({ ...inputs }))).toBe(false);
      expect(changed(() => ({ ...inputs, inverse: true }))).toBe(true);
      expect(
        changed(() => ({ ...inputs, businessMetricTypes: ["goal"] })),
      ).toBe(true);
    });

    it("counts a metric without stored or resolvable inputs as changed", () => {
      expect(changed(() => null)).toBe(true);
      expect(
        haveStatsEngineInputsChanged({
          snapshotSettings: {},
          metricIds: ["met_a"],
          getInputs: () => inputs,
        }),
      ).toBe(true);
      expect(
        haveStatsEngineInputsChanged({
          snapshotSettings: {},
          metricIds: [],
          getInputs: () => inputs,
        }),
      ).toBe(false);
    });
  });
});

describe("getStatsEngineAnalysisSettings", () => {
  const analysisSettings = {
    baselineVariationIndex: 1,
    numGoalMetrics: 0,
    numGuardrailMetrics: 2,
  } as ExperimentSnapshotAnalysisSettings;
  const snapshot = (updateScope?: ExperimentSnapshotInterface["updateScope"]) =>
    ({
      type: "standard",
      updateScope,
      settings: {
        goalMetrics: ["met_new"],
        guardrailMetrics: ["met_a", "met_b", "met_c"],
      },
    }) as unknown as ExperimentSnapshotInterface;

  it("counts a new-metrics update's goals and guardrails from its own metrics", () => {
    expect(
      getStatsEngineAnalysisSettings(
        snapshot({
          kind: "new_metrics",
          parentSnapshotId: "snp_parent",
          queriedMetricIds: ["met_new"],
          base: { dateCreated: new Date(), runStarted: null, cutoffDate: null },
        }),
        analysisSettings,
      ),
    ).toEqual({
      baselineVariationIndex: 1,
      numGoalMetrics: 1,
      numGuardrailMetrics: 3,
    });
  });

  it("leaves another snapshot's settings as requested", () => {
    expect(getStatsEngineAnalysisSettings(snapshot(), analysisSettings)).toBe(
      analysisSettings,
    );
  });
});

describe("getCopiedMetricCounts", () => {
  const counts = (numGoalMetrics: number) => ({
    numGoalMetrics,
    numGuardrailMetrics: 1,
  });
  // Parent first: two new-metrics updates on a full update with 6 goals.
  const lineage = [
    { queriedMetricIds: ["met_c"], counts: counts(10) },
    { queriedMetricIds: ["met_b"], counts: counts(9) },
    { queriedMetricIds: null, counts: counts(6) },
  ];

  it("gives each metric the counts of the latest snapshot that queried it", () => {
    expect(getCopiedMetricCounts(lineage, "met_c")).toEqual(counts(10));
    expect(getCopiedMetricCounts(lineage, "met_b?dim:country=US")).toEqual(
      counts(9),
    );
    expect(getCopiedMetricCounts(lineage, "met_a")).toEqual(counts(6));
  });

  it("is null for a metric queried before a lineage that ends early", () => {
    expect(getCopiedMetricCounts(lineage.slice(0, 2), "met_a")).toBeNull();
  });
});
