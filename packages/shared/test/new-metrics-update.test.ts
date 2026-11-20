import { MetricGroupInterface } from "shared/types/metric-groups";
import {
  ExperimentSnapshotAnalysisSettings,
  ExperimentSnapshotInterface,
} from "shared/types/experiment-snapshot";
import type { FactMetricInterface } from "shared/types/fact-table";
import type { ExperimentMetricDefinition } from "../src/experiments/experiments";
import {
  getComputableNewMetricIds,
  getMetricIdsMissingFromSnapshot,
  getMetricStatsEngineInputs,
  getPlannedMetricStatsEngineInputs,
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
      newMetricsUpdate: {
        baseDateCreated,
        baseRunStarted: null,
        baseCutoffDate: null,
        parentSnapshotId: "snp_base",
        metricIds: ["met_c"],
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
    newMetricsUpdate: {
      baseDateCreated: new Date("2026-11-10T00:00:00Z"),
      baseRunStarted: null,
      baseCutoffDate: null,
      parentSnapshotId: "snp_base",
      metricIds: ["fact__new"],
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

  describe("getPlannedMetricStatsEngineInputs", () => {
    const experiment = {
      goalMetrics: ["mg_core"],
      secondaryMetrics: [],
      guardrailMetrics: [],
      regressionAdjustmentEnabled: false,
    };
    const planned = (
      overrides: Partial<
        Parameters<typeof getPlannedMetricStatsEngineInputs>[0]
      > = {},
    ) =>
      getPlannedMetricStatsEngineInputs({
        metricId: "met_a",
        metric,
        experiment,
        metricGroups: [metricGroup("mg_core", ["met_a"])],
        organizationSettings: {},
        ...overrides,
      });

    it("expands metric groups and gives a slice its metric's priors but no type", () => {
      expect(planned()).toMatchObject({ businessMetricTypes: ["goal"] });
      expect(planned({ metricId: "met_a?dim:country=US" })).toMatchObject({
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
      expect(planned({ organizationSettings })).toMatchObject({
        properPrior: true,
        properPriorStdDev: 1,
      });
      expect(
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
      ).toMatchObject({ properPrior: false, targetMDE: 0.05 });
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
  const snapshot = (
    newMetricsUpdate?: ExperimentSnapshotInterface["newMetricsUpdate"],
  ) =>
    ({
      type: "standard",
      newMetricsUpdate,
      settings: {
        goalMetrics: ["met_new"],
        guardrailMetrics: ["met_a", "met_b", "met_c"],
      },
    }) as unknown as ExperimentSnapshotInterface;

  it("counts a new-metrics update's goals and guardrails from its own metrics", () => {
    expect(
      getStatsEngineAnalysisSettings(
        snapshot({
          baseDateCreated: new Date(),
          baseRunStarted: null,
          baseCutoffDate: null,
          parentSnapshotId: "snp_parent",
          metricIds: ["met_new"],
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
