import { describe, expect, it } from "vitest";
import type { ExperimentInterfaceStringDates } from "shared/types/experiment";
import type { MetricInterface } from "shared/types/metric";
import type { MetricGroupInterface } from "shared/types/metric-groups";
import {
  convertExperimentToTemplate,
  getClusterUnitsLabel,
  getIneligibleClusterMetrics,
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
