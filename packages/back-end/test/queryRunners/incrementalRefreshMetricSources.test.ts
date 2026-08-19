import type { ExperimentSnapshotSettings } from "shared/types/experiment-snapshot";
import type { ApiReqContext } from "back-end/types/api";
import type { SourceIntegrationInterface } from "back-end/src/types/Integration";
import { updateSnapshot } from "back-end/src/models/ExperimentSnapshotModel";
import {
  ExperimentIncrementalRefreshQueryRunner,
  getIncrementalRefreshMetricSources,
  MetricSourceGroups,
} from "back-end/src/queryRunners/ExperimentIncrementalRefreshQueryRunner";
import { factMetricFactory } from "../factories/FactMetric.factory";
import { snapshotFactory } from "../factories/Snapshot.factory";

jest.mock("back-end/src/models/ExperimentSnapshotModel", () => ({
  findSnapshotById: jest.fn(),
  updateSnapshot: jest.fn(),
}));

// `getIncrementalRefreshMetricSources` only reaches into the integration for
// `getSourceProperties().maxColumns` (used by the chunker). The rest of the
// SourceIntegrationInterface surface is irrelevant here, so a minimal stub
// is enough — we cast through `unknown` to avoid leaking the full type into
// the test.
const fakeIntegration = {
  getSourceProperties: () => ({ maxColumns: 1000 }),
} as unknown as Parameters<
  typeof getIncrementalRefreshMetricSources
>[0]["integration"];

const baseSnapshotSettings: ExperimentSnapshotSettings = {
  manual: false,
  dimensions: [],
  metricSettings: [],
  goalMetrics: [],
  secondaryMetrics: [],
  guardrailMetrics: [],
  activationMetric: null,
  defaultMetricPriorSettings: {
    override: false,
    proper: false,
    mean: 0,
    stddev: 0,
  },
  regressionAdjustmentEnabled: false,
  attributionModel: "firstExposure",
  experimentId: "exp_1",
  queryFilter: "",
  segment: "",
  skipPartialData: false,
  datasourceId: "ds_1",
  exposureQueryId: "exposure",
  startDate: new Date("2024-01-01"),
  endDate: new Date("2024-01-31"),
  variations: [],
};

describe("getIncrementalRefreshMetricSources fan-out", () => {
  it("creates a single group in the numerator FT for a same-FT metric", () => {
    const metric = factMetricFactory.build({
      id: "fact_same_ft",
      metricType: "mean",
      numerator: { factTableId: "ft_a", column: "amount" },
    });
    const groups = getIncrementalRefreshMetricSources({
      metrics: [metric],
      existingMetricSources: [],
      integration: fakeIntegration,
      snapshotSettings: baseSnapshotSettings,
    });
    expect(groups).toHaveLength(1);
    expect(groups[0].factTableId).toBe("ft_a");
    expect(groups[0].metrics).toHaveLength(1);
    expect(groups[0].metrics[0].id).toBe("fact_same_ft");
  });

  it("splits a cross-FT ratio metric into groups in both FTs", () => {
    const crossFt = factMetricFactory.build({
      id: "fact_xft_ratio",
      metricType: "ratio",
      numerator: { factTableId: "ft_num", column: "amount" },
      denominator: { factTableId: "ft_denom", column: "tenure" },
    });
    const groups = getIncrementalRefreshMetricSources({
      metrics: [crossFt],
      existingMetricSources: [],
      integration: fakeIntegration,
      snapshotSettings: baseSnapshotSettings,
    });

    expect(groups).toHaveLength(2);
    const numGroup = groups.find((g) => g.factTableId === "ft_num");
    const denomGroup = groups.find((g) => g.factTableId === "ft_denom");
    expect(numGroup).toBeDefined();
    expect(denomGroup).toBeDefined();

    // The same FactMetricInterface reference lives in both groups. Schema
    // gen / insert SQL distinguish numerator-side from denominator-side by
    // comparing the metric's column refs against the cache's factTableId.
    expect(numGroup!.metrics).toHaveLength(1);
    expect(numGroup!.metrics[0].id).toBe("fact_xft_ratio");
    expect(numGroup!.metrics[0].numerator.factTableId).toBe("ft_num");

    expect(denomGroup!.metrics).toHaveLength(1);
    expect(denomGroup!.metrics[0].id).toBe("fact_xft_ratio");
    expect(denomGroup!.metrics[0].denominator?.factTableId).toBe("ft_denom");
  });

  it("co-locates a cross-FT numerator entry with a same-FT metric in the shared FT", () => {
    // When the numerator FT of a cross-FT ratio is the same FT that hosts an
    // unrelated same-FT metric, we expect ONE group on that FT containing
    // both metrics — chunking only kicks in when the column budget is
    // exceeded.
    const sameFt = factMetricFactory.build({
      id: "fact_same_ft",
      metricType: "mean",
      numerator: { factTableId: "ft_a", column: "amount" },
    });
    const crossFt = factMetricFactory.build({
      id: "fact_xft_ratio",
      metricType: "ratio",
      numerator: { factTableId: "ft_a", column: "amount" },
      denominator: { factTableId: "ft_b", column: "tenure" },
    });
    const groups = getIncrementalRefreshMetricSources({
      metrics: [sameFt, crossFt],
      existingMetricSources: [],
      integration: fakeIntegration,
      snapshotSettings: baseSnapshotSettings,
    });

    const groupA = groups.filter((g) => g.factTableId === "ft_a");
    const groupB = groups.filter((g) => g.factTableId === "ft_b");
    expect(groupA).toHaveLength(1);
    expect(groupB).toHaveLength(1);

    expect(groupA[0].metrics.map((m) => m.id).sort()).toEqual([
      "fact_same_ft",
      "fact_xft_ratio",
    ]);
    expect(groupB[0].metrics).toHaveLength(1);
    expect(groupB[0].metrics[0].id).toBe("fact_xft_ratio");
  });

  it("reuses an existing group when the (factTableId, metricId) tuple matches", () => {
    // A cross-FT ratio's denominator side has been materialized previously.
    // The same metric should attach to the existing groupId rather than
    // creating a brand new group — this is what avoids unnecessary cache
    // rebuilds across runs.
    const crossFt = factMetricFactory.build({
      id: "fact_xft_ratio",
      metricType: "ratio",
      numerator: { factTableId: "ft_num", column: "amount" },
      denominator: { factTableId: "ft_denom", column: "tenure" },
    });

    const groups = getIncrementalRefreshMetricSources({
      metrics: [crossFt],
      existingMetricSources: [
        {
          groupId: "preexisting_denom",
          factTableId: "ft_denom",
          tableFullName: "proj.ds.cache_denom",
          maxTimestamp: null,
          metrics: [
            {
              id: "fact_xft_ratio",
              settingsHash: "stale-hash",
            },
          ],
        },
      ],
      integration: fakeIntegration,
      snapshotSettings: baseSnapshotSettings,
    });

    const denomGroup = groups.find((g) => g.factTableId === "ft_denom") as
      | MetricSourceGroups
      | undefined;
    const numGroup = groups.find((g) => g.factTableId === "ft_num") as
      | MetricSourceGroups
      | undefined;

    expect(denomGroup?.groupId).toBe("preexisting_denom");
    // New side is fresh, so its groupId is randomized — just confirm it
    // exists and that orientation is recoverable from the metric.
    expect(numGroup).toBeDefined();
    expect(numGroup!.metrics[0].numerator.factTableId).toBe("ft_num");
  });
});

const createDeferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
};

class TestableIncrementalRefreshQueryRunner extends ExperimentIncrementalRefreshQueryRunner {
  public recordFailedGroup(groupId: string): void {
    this.recordFailedMetricSourceGroup(groupId);
  }
}

describe("ExperimentIncrementalRefreshQueryRunner terminal invalidation", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it("invalidates recorded groups before materialization and lock release", async () => {
    const events: string[] = [];
    const invalidationStarted = createDeferred();
    const finishInvalidation = createDeferred();
    const invalidateMetricSourceGroup = jest.fn(async () => {
      events.push("invalidate-started");
      invalidationStarted.resolve();
      await finishInvalidation.promise;
      events.push("invalidated");
      return true;
    });
    const updateByExperimentIdIfCurrentExecution = jest.fn(async () => {
      events.push("materialized");
      return true;
    });
    const releaseLock = jest.fn(async () => {
      events.push("released");
    });
    const context = {
      org: { id: "org_1" },
      permissions: { canRunExperimentQueries: () => true },
      logger: { warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
      models: {
        incrementalRefresh: {
          invalidateMetricSourceGroup,
          updateByExperimentIdIfCurrentExecution,
          releaseLock,
        },
      },
    } as unknown as ApiReqContext;
    const integration = {
      datasource: { id: "ds_1", type: "postgres", settings: {} },
      context: { org: { id: "org_1" } },
    } as unknown as SourceIntegrationInterface;
    const snapshot = snapshotFactory.build({
      id: "snap_1",
      experiment: "exp_1",
      status: "running",
    });
    const runner = new TestableIncrementalRefreshQueryRunner(
      context,
      snapshot,
      integration,
    );
    runner.recordFailedGroup("group_a");
    (updateSnapshot as jest.Mock).mockImplementation(async () => {
      events.push("snapshot-updated");
    });

    const terminalUpdate = runner.updateModel({
      status: "partially-succeeded",
      queries: [],
    });
    await invalidationStarted.promise;
    expect(updateByExperimentIdIfCurrentExecution).not.toHaveBeenCalled();
    expect(releaseLock).not.toHaveBeenCalled();

    finishInvalidation.resolve();
    await terminalUpdate;
    expect(events).toEqual([
      "snapshot-updated",
      "invalidate-started",
      "invalidated",
      "materialized",
      "released",
    ]);

    await runner.updateModel({
      status: "partially-succeeded",
      queries: [],
    });
    expect(invalidateMetricSourceGroup).toHaveBeenCalledTimes(1);
  });
});
