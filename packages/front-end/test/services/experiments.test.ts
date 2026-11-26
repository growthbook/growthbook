import { describe, expect, it } from "vitest";
import type { ExperimentInterfaceStringDates } from "shared/types/experiment";
import type { MetricInterface } from "shared/types/metric";
import type { MetricGroupInterface } from "shared/types/metric-groups";
import type { SnapshotVariation } from "shared/types/experiment-snapshot";
import type { ExperimentReportResultDimension } from "shared/types/report";
import type { ExperimentMetricDefinition } from "shared/experiments";
import {
  convertExperimentToTemplate,
  getClusterSubUnitsLabel,
  getClusterUnitsLabel,
  getIneligibleClusterMetrics,
  getNewMetricRowStates,
  getResultsSubUnitTotal,
  getUnitDisplayName,
} from "@/services/experiments";
import { generateRowsForMetricGroup } from "@/hooks/useExperimentTableRows";

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

describe("getResultsSubUnitTotal", () => {
  const variation = (subCounts: (number | undefined)[]) =>
    ({
      users: 0,
      metrics: Object.fromEntries(
        subCounts.map((sub_count, i) => [
          `m${i}`,
          {
            users: 0,
            value: 0,
            cr: 0,
            stats:
              sub_count === undefined
                ? undefined
                : { users: 0, count: 0, stddev: 0, mean: 0, sub_count },
          },
        ]),
      ),
    }) as SnapshotVariation;

  it("sums each variation's largest metric subunit count", () => {
    expect(
      getResultsSubUnitTotal([variation([40, 50]), variation([60, undefined])]),
    ).toBe(110);
  });

  it("returns null when no metric has a subunit count", () => {
    expect(
      getResultsSubUnitTotal([variation([undefined]), variation([0])]),
    ).toBeNull();
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
  const statesFor = (
    overrides: Partial<Parameters<typeof getNewMetricRowStates>[0]>,
  ) =>
    Object.fromEntries(
      getNewMetricRowStates({
        newMetricIds: ["met_goal", "met_secondary", "met_guardrail"],
        latest: null,
        ...overrides,
      }),
    );
  const refreshOf = (metricIds: string[]) => ({
    kind: "new_metrics" as const,
    parentSnapshotId: "snp_base",
    queriedMetricIds: metricIds,
    base: {
      dateCreated: new Date("2026-11-16T09:00:00Z"),
      runStarted: null,
      cutoffDate: null,
    },
  });

  it("marks every new metric as not computed", () => {
    expect(
      statesFor({
        latest: {
          type: "standard",
          status: "success",
        },
      }),
    ).toEqual({
      met_goal: { status: "notComputed" },
      met_secondary: { status: "notComputed" },
      met_guardrail: { status: "notComputed" },
    });
  });

  it("gives a computed metric with zero users its results row, next to a new metric", () => {
    const metricsById: Record<string, ExperimentMetricDefinition> = {
      met_goal: { id: "met_goal", name: "Zero users" } as MetricInterface,
      met_secondary: { id: "met_secondary", name: "Added" } as MetricInterface,
    };
    const zeroUsers = { users: 0, value: 0, cr: 0 };
    const results: ExperimentReportResultDimension = {
      name: "",
      srm: 1,
      variations: [0, 1].map(() => ({
        users: 1000,
        metrics: { met_goal: zeroUsers },
      })),
    };
    const rows = generateRowsForMetricGroup({
      metricIds: ["met_goal", "met_secondary"],
      resultGroup: "goal",
      results,
      metricOverrides: [],
      shouldShowMetricSlices: false,
      getExperimentMetricById: (id) => metricsById[id] ?? null,
      getFactTableById: () => null,
      newMetricStates: getNewMetricRowStates({
        newMetricIds: ["met_secondary"],
        latest: null,
      }),
    });
    expect(
      rows.map((r) => [r.metric.id, r.newMetricState, r.variations[1]]),
    ).toEqual([
      ["met_goal", undefined, zeroUsers],
      ["met_secondary", { status: "notComputed" }, expect.anything()],
    ]);
  });

  it.each([
    {
      name: "a running new-metrics update shows its metrics as running and the rest as not computed",
      latest: {
        type: "standard" as const,
        status: "running" as const,
        updateScope: refreshOf(["met_goal", "met_secondary"]),
      },
      expected: {
        met_goal: { status: "running" },
        met_secondary: { status: "running" },
        met_guardrail: { status: "notComputed" },
      },
    },
    {
      name: "a running full update shows every new metric as running",
      latest: { type: "standard" as const, status: "running" as const },
      expected: {
        met_goal: { status: "running" },
        met_secondary: { status: "running" },
        met_guardrail: { status: "running" },
      },
    },
    {
      name: "a failed new-metrics update shows its metrics as failed",
      latest: {
        type: "standard" as const,
        status: "error" as const,
        error: "Query failed",
        updateScope: refreshOf(["met_goal"]),
      },
      expected: {
        met_goal: { status: "failed", error: "Query failed" },
        met_secondary: { status: "notComputed" },
        met_guardrail: { status: "notComputed" },
      },
    },
    {
      name: "a failed full update leaves new metrics not computed",
      latest: {
        type: "standard" as const,
        status: "error" as const,
        error: "Query failed",
      },
      expected: {
        met_goal: { status: "notComputed" },
        met_secondary: { status: "notComputed" },
        met_guardrail: { status: "notComputed" },
      },
    },
  ])("$name", ({ latest, expected }) => {
    expect(statesFor({ latest })).toEqual(expected);
  });
});
