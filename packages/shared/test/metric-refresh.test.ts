import { MetricGroupInterface } from "shared/types/metric-groups";
import { ExperimentSnapshotInterface } from "shared/types/experiment-snapshot";
import {
  getMetricFilterForCarriedQueries,
  getMetricIdsMissingFromSnapshot,
  getSnapshotSideEffects,
} from "../src/experiments/metric-refresh";

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
  it("returns the metrics a snapshot never computed, in experiment order", () => {
    expect(
      getMetricIdsMissingFromSnapshot({
        experiment: {
          goalMetrics: ["fact__a", "fact__new_goal"],
          secondaryMetrics: ["fact__b"],
          guardrailMetrics: ["fact__new_guardrail"],
        },
        snapshotSettings: snapshotSettingsFor(["fact__a", "fact__b"]),
        metricGroups: [],
      }),
    ).toEqual(["fact__new_goal", "fact__new_guardrail"]);
  });

  it("expands metric groups and lists a metric once", () => {
    expect(
      getMetricIdsMissingFromSnapshot({
        experiment: {
          goalMetrics: ["mg_core", "fact__c"],
          secondaryMetrics: ["mg_more"],
          guardrailMetrics: [],
        },
        snapshotSettings: snapshotSettingsFor(["fact__a"]),
        metricGroups: [
          metricGroup("mg_core", ["fact__a", "fact__b"]),
          metricGroup("mg_more", ["fact__b", "met_legacy"]),
        ],
      }),
    ).toEqual(["fact__b", "fact__c", "met_legacy"]);
  });

  it("leaves out the activation metric unless it is also an analyzed metric", () => {
    const snapshotSettings = snapshotSettingsFor(["fact__a"]);
    expect(
      getMetricIdsMissingFromSnapshot({
        experiment: {
          goalMetrics: ["fact__a"],
          secondaryMetrics: [],
          guardrailMetrics: [],
          activationMetric: "met_activation",
        } as Parameters<
          typeof getMetricIdsMissingFromSnapshot
        >[0]["experiment"],
        snapshotSettings,
        metricGroups: [],
      }),
    ).toEqual([]);
    expect(
      getMetricIdsMissingFromSnapshot({
        experiment: {
          goalMetrics: ["fact__a", "met_activation"],
          secondaryMetrics: [],
          guardrailMetrics: [],
          activationMetric: "met_activation",
        } as Parameters<
          typeof getMetricIdsMissingFromSnapshot
        >[0]["experiment"],
        snapshotSettings,
        metricGroups: [],
      }),
    ).toEqual(["met_activation"]);
  });

  it("ignores slice and funnel step ids on either side", () => {
    expect(
      getMetricIdsMissingFromSnapshot({
        experiment: {
          goalMetrics: [
            "fact__a",
            "fact__a?dim:country=us",
            "fact__funnel?step=1",
          ],
          secondaryMetrics: [],
          guardrailMetrics: [],
        },
        snapshotSettings: snapshotSettingsFor([
          "fact__a",
          "fact__b?dim:country=us",
        ]),
        metricGroups: [],
      }),
    ).toEqual([]);
  });

  it("does not report a metric removed from the experiment", () => {
    expect(
      getMetricIdsMissingFromSnapshot({
        experiment: {
          goalMetrics: ["fact__b"],
          secondaryMetrics: [],
          guardrailMetrics: [],
        },
        snapshotSettings: snapshotSettingsFor(["fact__a", "fact__b"]),
        metricGroups: [],
      }),
    ).toEqual([]);
  });

  it("returns nothing when the snapshot holds every metric", () => {
    expect(
      getMetricIdsMissingFromSnapshot({
        experiment: {
          goalMetrics: ["mg_core"],
          secondaryMetrics: ["fact__c"],
          guardrailMetrics: [],
        },
        snapshotSettings: snapshotSettingsFor([
          "fact__a",
          "fact__b",
          "fact__c",
          "fact__a?dim:country=us",
        ]),
        metricGroups: [metricGroup("mg_core", ["fact__a", "fact__b"])],
      }),
    ).toEqual([]);
  });
});

describe("a report snapshot copied from a metric refresh", () => {
  const report = {
    type: "report",
    dateCreated: new Date("2026-11-12T00:00:00Z"),
    settings: { metricSettings: [{ id: "fact__a" }] },
    metricRefresh: {
      baseSnapshotId: "snp_base",
      baseDateCreated: new Date("2026-11-10T00:00:00Z"),
      baseCutoffDate: null,
      parentSnapshotId: "snp_base",
      metricIds: ["fact__new"],
    },
  } as unknown as ExperimentSnapshotInterface;

  it("has the side effects of a report, not of a metric refresh", () => {
    const effects = getSnapshotSideEffects(report);

    expect(effects).toMatchObject({
      advanceUpdateSchedule: true,
      refreshDashboards: true,
      ownsUpdateFailedAlert: true,
    });
    expect(effects.timeSeries.pointDate).toEqual(report.dateCreated);
    expect(effects.timeSeries.includesMetric("fact__a")).toBe(true);
  });

  it("analyzes every metric its queries return", () => {
    expect(getMetricFilterForCarriedQueries(report)).toBeUndefined();
  });
});
