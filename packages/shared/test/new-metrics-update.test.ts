import { MetricGroupInterface } from "shared/types/metric-groups";
import { ExperimentSnapshotInterface } from "shared/types/experiment-snapshot";
import {
  getMetricIdsExcludedByExperimentType,
  getMetricIdsMissingFromSnapshot,
  getSnapshotSideEffects,
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
        baseSnapshotId: "snp_base",
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
      baseSnapshotId: "snp_base",
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

describe("getMetricIdsExcludedByExperimentType", () => {
  const windowTypes: Record<string, string> = { met_conversion: "conversion" };
  const excluded = (
    experiment: Parameters<
      typeof getMetricIdsExcludedByExperimentType
    >[0]["experiment"],
    metricGroups: MetricGroupInterface[] = [],
  ) =>
    [
      ...getMetricIdsExcludedByExperimentType({
        experiment,
        metricGroups,
        getMetricById: (id) => ({ windowSettings: { type: windowTypes[id] } }),
      }),
    ].sort();

  it.each<[string, Parameters<typeof excluded>[0], string[]]>([
    [
      "excludes nothing outside a holdout",
      {
        type: "standard",
        goalMetrics: ["met_conversion"],
        secondaryMetrics: [],
        guardrailMetrics: ["met_plain"],
      },
      [],
    ],
    [
      "excludes a holdout's guardrails and conversion-window metrics, groups expanded",
      {
        type: "holdout",
        goalMetrics: ["met_plain", "met_conversion"],
        secondaryMetrics: [],
        guardrailMetrics: ["mg_guard"],
      },
      ["met_conversion", "met_guard"],
    ],
    [
      "keeps a holdout guardrail that is also a goal",
      {
        type: "holdout",
        goalMetrics: ["met_plain"],
        secondaryMetrics: [],
        guardrailMetrics: ["met_plain"],
      },
      [],
    ],
  ])("%s", (name, experiment, expected) => {
    expect(
      excluded(experiment, [metricGroup("mg_guard", ["met_guard"])]),
    ).toEqual(expected);
  });
});
