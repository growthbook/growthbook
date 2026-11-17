import { describe, expect, it } from "vitest";
import type { ExperimentInterfaceStringDates } from "shared/types/experiment";
import type { MetricInterface } from "shared/types/metric";
import type { MetricGroupInterface } from "shared/types/metric-groups";
import type { MetricForSnapshot } from "shared/types/experiment-snapshot";
import {
  convertExperimentToTemplate,
  getClusterSubUnitsLabel,
  getClusterUnitsLabel,
  getIneligibleClusterMetrics,
  getNewMetricRowStates,
  getUnitDisplayName,
} from "@/services/experiments";

describe("convertExperimentToTemplate", () => {
  it("stores a legacy experiment's resolved identifier type", () => {
    const experiment = {
      name: "Checkout",
      datasource: "ds_1",
      exposureQueryId: "eq_1",
      phases: [{ coverage: 1, condition: "" }],
    } as unknown as ExperimentInterfaceStringDates;

    const template = convertExperimentToTemplate(experiment, {
      userIdType: "anonymous_id",
      userIdTypes: ["user_id", "anonymous_id"],
    });
    expect(template.exposureQueryIdentifierType).toBe("anonymous_id");
  });
});

describe("getUnitDisplayName", () => {
  it("title-cases and pluralizes the identifier type", () => {
    expect(getUnitDisplayName("region_id")).toBe("Region Ids");
  });

  it("falls back to Units without an identifier type", () => {
    expect(getUnitDisplayName(undefined)).toBe("Units");
  });
});

describe("getClusterUnitsLabel", () => {
  const cluster = {
    isClusterExperiment: true,
    clusterSubUnitIdentifier: "user_id",
    exposureQueryIdentifierType: "region_id",
  };

  it("labels a cluster experiment's counts with the cluster identifier", () => {
    expect(getClusterUnitsLabel(cluster)).toBe("Region Ids");
  });

  it("returns nothing for a non-cluster experiment", () => {
    expect(
      getClusterUnitsLabel({ ...cluster, isClusterExperiment: false }),
    ).toBeUndefined();
  });

  it("returns nothing without a sub-unit", () => {
    expect(
      getClusterUnitsLabel({ ...cluster, clusterSubUnitIdentifier: undefined }),
    ).toBeUndefined();
  });
});

describe("getClusterSubUnitsLabel", () => {
  const cluster = {
    isClusterExperiment: true,
    clusterSubUnitIdentifier: "user_id",
    exposureQueryIdentifierType: "region_id",
    clusterLevelMetricIds: ["fact_region_spend"],
  };

  it("labels a sub-unit metric with the sub-unit identifier", () => {
    expect(getClusterSubUnitsLabel(cluster, "fact_orders")).toBe("User Ids");
  });

  it("returns nothing for a metric analyzed per cluster", () => {
    expect(
      getClusterSubUnitsLabel(cluster, "fact_region_spend"),
    ).toBeUndefined();
  });
});

describe("getIneligibleClusterMetrics", () => {
  // Cluster experiments only support fact metrics, so a legacy one is ineligible.
  const legacy = { id: "met_legacy", name: "Legacy" } as MetricInterface;
  const group = {
    id: "mg_group",
    name: "Group",
    metrics: ["met_legacy"],
  } as MetricGroupInterface;
  const options = {
    clusterIdentifier: "region_id",
    clusterSubUnitIdentifier: "user_id",
    getFactTable: () => null,
    metricGroups: [group],
    getExperimentMetricById: (id: string) => (id === legacy.id ? legacy : null),
  };

  it("drops a metric picked on its own", () => {
    const result = getIneligibleClusterMetrics(["met_legacy"], options);
    expect([...result.droppedIds]).toEqual(["met_legacy"]);
    expect(result.droppedNames).toEqual(["Legacy"]);
    expect(result.groupNames).toEqual([]);
  });

  it("names a group holding one instead of dropping it", () => {
    const result = getIneligibleClusterMetrics(["mg_group"], options);
    expect(result.droppedIds.size).toBe(0);
    expect(result.groupNames).toEqual(["Group"]);
  });
});

describe("getNewMetricRowStates", () => {
  const experiment = {
    goalMetrics: ["met_old", "met_goal"],
    secondaryMetrics: ["met_secondary"],
    guardrailMetrics: ["met_guardrail"],
  };
  const snapshotSettings = {
    metricSettings: [{ id: "met_old" } as MetricForSnapshot],
  };
  const statesFor = (
    overrides: Partial<Parameters<typeof getNewMetricRowStates>[0]>,
  ) =>
    Object.fromEntries(
      getNewMetricRowStates({
        experiment,
        metricGroups: [],
        snapshotSettings,
        request: { status: "none" },
        refreshUnavailable: false,
        ...overrides,
      }),
    );
  const refreshOf = (metricIds: string[]) => ({
    baseSnapshotId: "snp_base",
    baseDateCreated: new Date("2026-11-16T09:00:00Z"),
    baseCutoffDate: null,
    parentSnapshotId: "snp_base",
    metricIds,
  });

  it("marks every metric the snapshot lacks as idle", () => {
    expect(statesFor({ latest: { status: "success" } })).toEqual({
      met_goal: { status: "idle" },
      met_secondary: { status: "idle" },
      met_guardrail: { status: "idle" },
    });
  });

  it("leaves out a metric the snapshot computed, even with zero users", () => {
    const states = statesFor({
      snapshotSettings: {
        metricSettings: [
          { id: "met_old" },
          { id: "met_goal" },
          { id: "met_secondary" },
          { id: "met_guardrail" },
        ] as MetricForSnapshot[],
      },
    });
    expect(states).toEqual({});
  });

  it("shows the metrics a running refresh queries as running", () => {
    expect(
      statesFor({
        latest: {
          status: "running",
          metricRefresh: refreshOf(["met_goal", "met_secondary"]),
        },
      }),
    ).toEqual({
      met_goal: { status: "running" },
      met_secondary: { status: "running" },
      met_guardrail: { status: "idle" },
    });
  });

  it("shows every new metric as running during a full update", () => {
    expect(statesFor({ latest: { status: "running" } })).toEqual({
      met_goal: { status: "running" },
      met_secondary: { status: "running" },
      met_guardrail: { status: "running" },
    });
  });

  it("shows every new metric as running while the request is sent", () => {
    expect(
      statesFor({
        latest: { status: "success" },
        request: { status: "sending" },
      }).met_guardrail,
    ).toEqual({ status: "running" });
  });

  it("shows the metrics of a failed refresh as failed", () => {
    expect(
      statesFor({
        latest: {
          status: "error",
          error: "Query failed",
          metricRefresh: refreshOf(["met_goal"]),
        },
      }),
    ).toEqual({
      met_goal: { status: "failed", error: "Query failed" },
      met_secondary: { status: "idle" },
      met_guardrail: { status: "idle" },
    });
  });

  it("keeps new metrics idle after a failed full update", () => {
    expect(
      statesFor({ latest: { status: "error", error: "Query failed" } })
        .met_goal,
    ).toEqual({ status: "idle" });
  });

  it("shows a rejected request as failed", () => {
    expect(
      statesFor({ request: { status: "failed", error: "Network error" } })
        .met_goal,
    ).toEqual({ status: "failed", error: "Network error" });
  });

  it("marks new metrics unavailable when another setting is outdated", () => {
    expect(
      statesFor({
        latest: {
          status: "error",
          metricRefresh: refreshOf(["met_goal"]),
        },
        refreshUnavailable: true,
      }),
    ).toEqual({
      met_goal: { status: "unavailable" },
      met_secondary: { status: "unavailable" },
      met_guardrail: { status: "unavailable" },
    });
  });

  it("marks new metrics unavailable when the server refused the refresh", () => {
    expect(
      statesFor({ request: { status: "unavailable" } }).met_secondary,
    ).toEqual({ status: "unavailable" });
  });
});
