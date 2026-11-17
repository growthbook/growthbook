import { describe, expect, it } from "vitest";
import type { ExperimentInterfaceStringDates } from "shared/types/experiment";
import type { MetricInterface } from "shared/types/metric";
import type { MetricGroupInterface } from "shared/types/metric-groups";
import type { MetricForSnapshot } from "shared/types/experiment-snapshot";
import type { DataSourceInterfaceWithParams } from "shared/types/datasource";
import type { ExperimentReportResultDimension } from "shared/types/report";
import type { ExperimentMetricDefinition } from "shared/experiments";
import {
  convertExperimentToTemplate,
  getClusterSubUnitsLabel,
  getClusterUnitsLabel,
  getIneligibleClusterMetrics,
  getMetricRefreshRequestOutcome,
  getNewMetricRowStates,
  getUnitDisplayName,
  getUnjoinableMetricIds,
  hasOutdatedReasonBlockingMetricRefresh,
  isMetricRefreshUnavailable,
  NewMetricRowState,
  newMetricRowsOfferRefresh,
} from "@/services/experiments";
import { generateRowsForMetricGroup } from "@/hooks/useExperimentTableRows";
import { ApiCallError } from "@/services/apiCallError";

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
    expect(
      statesFor({
        latest: {
          type: "standard",
          status: "success",
        },
      }),
    ).toEqual({
      met_goal: { status: "idle" },
      met_secondary: { status: "idle" },
      met_guardrail: { status: "idle" },
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
        experiment: {
          goalMetrics: ["met_goal", "met_secondary"],
          secondaryMetrics: [],
          guardrailMetrics: [],
        },
        metricGroups: [],
        snapshotSettings: {
          metricSettings: [{ id: "met_goal" } as MetricForSnapshot],
        },
        request: { status: "none" },
        refreshUnavailable: false,
      }),
    });
    expect(
      rows.map((r) => [r.metric.id, r.newMetricState, r.variations[1]]),
    ).toEqual([
      ["met_goal", undefined, zeroUsers],
      ["met_secondary", { status: "idle" }, expect.anything()],
    ]);
  });

  it("keeps the No data row for a metric no snapshot can compute", () => {
    const unjoinable = getUnjoinableMetricIds({
      metricIds: ["met_goal", "met_secondary"],
      getExperimentMetricById: (id) =>
        ({
          id,
          userIdTypes: id === "met_goal" ? ["anonymous_id"] : ["user_id"],
        }) as MetricInterface,
      getFactTableById: () => null,
      userIdType: "user_id",
      datasourceSettings: {},
    });
    expect(
      statesFor({
        latest: { type: "standard", status: "success" },
        uncomputableMetricIds: unjoinable,
      }),
    ).toEqual({
      met_secondary: { status: "idle" },
      met_guardrail: { status: "idle" },
    });
  });

  it("stops treating metrics as new once the server found nothing to update for them", () => {
    expect(
      statesFor({
        latest: { type: "standard", status: "success" },
        request: {
          status: "nothingToCompute",
          metricIds: ["met_old", "met_goal", "met_secondary"],
        },
      }),
    ).toEqual({ met_guardrail: { status: "idle" } });
  });

  it("shows the metrics a running refresh queries as running, and offers no update for the rest", () => {
    expect(
      statesFor({
        latest: {
          type: "standard",
          status: "running",
          metricRefresh: refreshOf(["met_goal", "met_secondary"]),
        },
      }),
    ).toEqual({
      met_goal: { status: "running" },
      met_secondary: { status: "running" },
      met_guardrail: { status: "otherUpdateRunning" },
    });
  });

  it("shows every new metric as running during a full update", () => {
    expect(
      statesFor({
        latest: {
          type: "standard",
          status: "running",
        },
      }),
    ).toEqual({
      met_goal: { status: "running" },
      met_secondary: { status: "running" },
      met_guardrail: { status: "running" },
    });
  });

  it("shows every new metric as running while the request is sent", () => {
    expect(
      statesFor({
        latest: {
          type: "standard",
          status: "success",
        },
        request: { status: "sending" },
      }).met_guardrail,
    ).toEqual({ status: "running" });
  });

  it("shows the metrics of a failed refresh as failed", () => {
    expect(
      statesFor({
        latest: {
          type: "standard",
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
      statesFor({
        latest: {
          type: "standard",
          status: "error",
          error: "Query failed",
        },
      }).met_goal,
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
          type: "standard",
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

describe("newMetricRowsOfferRefresh", () => {
  const offers = (...states: NewMetricRowState[]) =>
    newMetricRowsOfferRefresh(
      new Map(states.map((state, i) => [`met_${i}`, state])),
    );

  it("is true when a row shows an update or retry link", () => {
    expect(offers({ status: "running" }, { status: "idle" })).toBe(true);
    expect(offers({ status: "failed", error: null })).toBe(true);
  });

  it("is false when no row can start an update", () => {
    expect(offers()).toBe(false);
    expect(
      offers(
        { status: "running" },
        { status: "otherUpdateRunning" },
        { status: "unavailable" },
      ),
    ).toBe(false);
  });

  it("is false without row states, as in a dimension breakdown", () => {
    expect(newMetricRowsOfferRefresh(undefined)).toBe(false);
  });
});

describe("getMetricRefreshRequestOutcome", () => {
  const attempted = ["met_a", "met_b"];
  const rejected = (code: string, details?: unknown) =>
    getMetricRefreshRequestOutcome(
      new ApiCallError({ code, message: "Refused", details }),
      attempted,
    );

  it("settles the attempted metrics when the server says nothing is missing", () => {
    expect(rejected("metrics_already_up_to_date")).toEqual({
      status: "nothingToCompute",
      metricIds: attempted,
    });
  });

  it("defers to the status poll when another update is running", () => {
    expect(rejected("snapshot_in_progress")).toEqual({ status: "none" });
  });

  it("shows the rows as unavailable for every refusal reason", () => {
    for (const reason of [
      "no_base_snapshot",
      "not_latest_phase",
      "unsupported_experiment_type",
      "unsupported_data_source",
      "incremental_pipeline",
      "settings_changed",
      "base_incomplete",
      "phase_ended",
    ]) {
      expect(rejected("metric_refresh_unavailable", { reason })).toEqual({
        status: "unavailable",
      });
    }
  });

  it("shows a bad request, a permission error and a network failure as failed", () => {
    expect(
      getMetricRefreshRequestOutcome(
        new ApiCallError({ message: "Can't be combined with a dimension." }),
        attempted,
      ),
    ).toEqual({
      status: "failed",
      error: "Can't be combined with a dimension.",
    });
    expect(
      getMetricRefreshRequestOutcome(
        new ApiCallError({ message: "You do not have access to this action" }),
        attempted,
      ),
    ).toEqual({
      status: "failed",
      error: "You do not have access to this action",
    });
    expect(
      getMetricRefreshRequestOutcome(
        new TypeError("Failed to fetch"),
        attempted,
      ),
    ).toEqual({ status: "failed", error: "Failed to fetch" });
  });
});

describe("isMetricRefreshUnavailable", () => {
  const running = {
    id: "exp_1",
    type: "standard" as const,
    phases: [
      { dateEnded: "2026-11-01T00:00:00Z" },
      { dateEnded: undefined },
    ] as ExperimentInterfaceStringDates["phases"],
  };
  const sqlDatasource = {
    properties: { separateExperimentResultQueries: true },
    settings: {},
  } as DataSourceInterfaceWithParams;
  const unavailable = (
    overrides: Partial<Parameters<typeof isMetricRefreshUnavailable>[0]>,
  ) =>
    isMetricRefreshUnavailable({
      experiment: running,
      phase: 1,
      datasource: sqlDatasource,
      settingsOutdated: false,
      ...overrides,
    });

  it("allows a running standard experiment on a SQL data source", () => {
    expect(unavailable({})).toBe(false);
  });

  it("refuses bandits and holdouts", () => {
    expect(
      unavailable({ experiment: { ...running, type: "multi-armed-bandit" } }),
    ).toBe(true);
    expect(unavailable({ experiment: { ...running, type: "holdout" } })).toBe(
      true,
    );
  });

  it("refuses an ended phase", () => {
    expect(unavailable({ phase: 0 })).toBe(true);
  });

  it("refuses a data source that queries every metric at once", () => {
    expect(
      unavailable({ datasource: { ...sqlDatasource, properties: undefined } }),
    ).toBe(true);
    expect(unavailable({ datasource: null })).toBe(true);
  });

  it("allows an experiment on the incremental pipeline", () => {
    expect(
      unavailable({
        datasource: {
          ...sqlDatasource,
          settings: {
            pipelineSettings: {
              allowWriting: true,
              mode: "incremental",
              unitsTableRetentionHours: 24,
              includedExperimentIds: ["exp_1"],
            },
          },
        } as DataSourceInterfaceWithParams,
      }),
    ).toBe(false);
  });

  it("refuses when analysis settings changed since the last update", () => {
    expect(unavailable({ settingsOutdated: true })).toBe(true);
  });
});

describe("hasOutdatedReasonBlockingMetricRefresh", () => {
  it("ignores added metrics and date drift", () => {
    expect(
      hasOutdatedReasonBlockingMetricRefresh([
        "Metrics changed",
        "Analysis dates changed",
      ]),
    ).toBe(false);
  });

  it("blocks on any other reason", () => {
    expect(
      hasOutdatedReasonBlockingMetricRefresh([
        "Metrics changed",
        "Stats engine changed",
      ]),
    ).toBe(true);
  });
});
