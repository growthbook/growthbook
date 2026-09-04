import { ExperimentSnapshotInterface } from "shared/types/experiment-snapshot";
import { funnelStepMetricId } from "shared/experiments";
import { FunnelFactMetricInterface } from "shared/types/fact-table";
import { recoverStalledSnapshot } from "back-end/src/queryRunners/rehydrate";
import { getExperimentById } from "back-end/src/models/ExperimentModel";
import { getLatestSuccessfulSnapshot } from "back-end/src/models/ExperimentSnapshotModel";
import { getFactTableMap } from "back-end/src/models/FactTableModel";
import { getMetricMap } from "back-end/src/models/MetricModel";
import { getIntegrationFromDatasourceId } from "back-end/src/services/datasource";
import { ExperimentResultsQueryRunner } from "back-end/src/queryRunners/ExperimentResultsQueryRunner";
import { ExperimentIncrementalRefreshQueryRunner } from "back-end/src/queryRunners/ExperimentIncrementalRefreshQueryRunner";
import { ExperimentIncrementalRefreshExploratoryQueryRunner } from "back-end/src/queryRunners/ExperimentIncrementalRefreshExploratoryQueryRunner";
import { ReqContext } from "back-end/types/request";

jest.mock("back-end/src/models/ExperimentModel", () => ({
  getExperimentById: jest.fn(),
}));

jest.mock("back-end/src/models/ExperimentSnapshotModel", () => ({
  getLatestSuccessfulSnapshot: jest.fn(),
}));

jest.mock("back-end/src/models/FactTableModel", () => ({
  getFactTableMap: jest.fn(),
}));

jest.mock("back-end/src/models/MetricModel", () => ({
  getMetricMap: jest.fn(),
}));

jest.mock("back-end/src/services/datasource", () => ({
  getIntegrationFromDatasourceId: jest.fn(),
}));

// The runner classes are stubbed with capturing constructors so routing can be
// asserted without loading the datasource/integration/context chain. Each
// exposes its own finalize spy so tests can tell which class ran.
const mockResultsFinalize = jest.fn().mockResolvedValue(true);
const mockIncrFinalize = jest.fn().mockResolvedValue(true);
const mockIncrExplFinalize = jest.fn().mockResolvedValue(true);

jest.mock("back-end/src/queryRunners/ExperimentResultsQueryRunner", () => ({
  ExperimentResultsQueryRunner: jest.fn(() => ({
    prepareAnalysisData: jest.fn(),
    finalizeFromPersistedResults: mockResultsFinalize,
  })),
}));

jest.mock(
  "back-end/src/queryRunners/ExperimentIncrementalRefreshQueryRunner",
  () => ({
    ExperimentIncrementalRefreshQueryRunner: jest.fn(() => ({
      prepareAnalysisData: jest.fn(),
      finalizeFromPersistedResults: mockIncrFinalize,
    })),
  }),
);

jest.mock(
  "back-end/src/queryRunners/ExperimentIncrementalRefreshExploratoryQueryRunner",
  () => ({
    ExperimentIncrementalRefreshExploratoryQueryRunner: jest.fn(() => ({
      prepareAnalysisData: jest.fn(),
      finalizeFromPersistedResults: mockIncrExplFinalize,
    })),
  }),
);

const funnelMetric = {
  id: "fact__funnel",
  name: "Signup Funnel",
  metricType: "funnel",
  numerator: null,
  denominator: null,
  regressionAdjustmentOverride: true,
  regressionAdjustmentEnabled: true,
  regressionAdjustmentDays: 14,
  priorSettings: { override: false, proper: false, mean: 0, stddev: 1 },
  funnelSettings: {
    steps: [
      {
        name: "View",
        factTableId: "ft_views",
        rowFilters: [],
        optional: false,
      },
      {
        name: "Signup",
        factTableId: "ft_events",
        rowFilters: [{ operator: "=", column: "event", values: ["signup"] }],
        optional: false,
      },
    ],
  },
} as unknown as FunnelFactMetricInterface;

describe("recoverStalledSnapshot", () => {
  const context = {
    org: { id: "org_1" },
    models: {
      metricGroups: { getAll: jest.fn().mockResolvedValue([]) },
    },
  } as unknown as ReqContext;

  const snapshotDateCreated = new Date("2026-08-01T00:00:00Z");

  function snapshot(
    overrides: Record<string, unknown> = {},
  ): ExperimentSnapshotInterface {
    return {
      id: "snp_1",
      organization: "org_1",
      experiment: "exp_1",
      phase: 0,
      dimension: null,
      type: "standard",
      dateCreated: snapshotDateCreated,
      settings: { datasourceId: "ds_1" },
      ...overrides,
    } as unknown as ExperimentSnapshotInterface;
  }

  function experiment(overrides: Record<string, unknown> = {}) {
    return {
      id: "exp_1",
      type: "standard",
      variations: [
        { id: "v0", name: "Control", key: "0", screenshots: [] },
        { id: "v1", name: "Treatment", key: "1", screenshots: [] },
      ],
      phases: [{ variations: [] }],
      goalMetrics: [],
      secondaryMetrics: [],
      guardrailMetrics: [],
      ...overrides,
    };
  }

  /** The analysis inputs the nth routed results runner was seeded with. */
  function seededResultsInputs(index = 0) {
    return (ExperimentResultsQueryRunner as jest.Mock).mock.results[index].value
      .prepareAnalysisData.mock.calls[0][0];
  }

  beforeEach(() => {
    jest.clearAllMocks();
    (getExperimentById as jest.Mock).mockResolvedValue(experiment());
    (getLatestSuccessfulSnapshot as jest.Mock).mockResolvedValue(null);
    (getFactTableMap as jest.Mock).mockResolvedValue(new Map());
    (getMetricMap as jest.Mock).mockResolvedValue(new Map());
    (getIntegrationFromDatasourceId as jest.Mock).mockResolvedValue({});
  });

  it("routes a results snapshot to the results runner and finalizes it", async () => {
    await expect(
      recoverStalledSnapshot(context, snapshot({ runnerKind: "results" })),
    ).resolves.toBe(true);

    expect(getIntegrationFromDatasourceId).toHaveBeenCalledWith(
      context,
      "ds_1",
      true,
    );
    expect(ExperimentResultsQueryRunner).toHaveBeenCalled();
    expect(mockResultsFinalize).toHaveBeenCalled();
    expect(ExperimentIncrementalRefreshQueryRunner).not.toHaveBeenCalled();
  });

  it("treats an absent runnerKind as a results snapshot", async () => {
    await expect(recoverStalledSnapshot(context, snapshot())).resolves.toBe(
      true,
    );

    expect(ExperimentResultsQueryRunner).toHaveBeenCalled();
    expect(mockResultsFinalize).toHaveBeenCalled();
  });

  it.each(["incremental-full", "incremental-update"] as const)(
    "routes %s to the incremental runner",
    async (runnerKind) => {
      await expect(
        recoverStalledSnapshot(context, snapshot({ runnerKind })),
      ).resolves.toBe(true);

      expect(ExperimentIncrementalRefreshQueryRunner).toHaveBeenCalled();
      expect(mockIncrFinalize).toHaveBeenCalled();
      expect(ExperimentResultsQueryRunner).not.toHaveBeenCalled();
    },
  );

  it("routes an incremental-exploratory snapshot to the exploratory runner", async () => {
    await expect(
      recoverStalledSnapshot(
        context,
        snapshot({ runnerKind: "incremental-exploratory" }),
      ),
    ).resolves.toBe(true);

    expect(
      ExperimentIncrementalRefreshExploratoryQueryRunner,
    ).toHaveBeenCalled();
    expect(mockIncrExplFinalize).toHaveBeenCalled();
  });

  it("declines a persisted runner kind with no recovery path", async () => {
    // Persisted data can name a kind this build does not know how to rebuild.
    await expect(
      recoverStalledSnapshot(context, snapshot({ runnerKind: "future-kind" })),
    ).resolves.toBe(false);
    expect(getIntegrationFromDatasourceId).not.toHaveBeenCalled();
  });

  it("declines when the experiment is gone", async () => {
    (getExperimentById as jest.Mock).mockResolvedValue(null);

    await expect(
      recoverStalledSnapshot(context, snapshot({ runnerKind: "results" })),
    ).resolves.toBe(false);
    expect(ExperimentResultsQueryRunner).not.toHaveBeenCalled();
  });

  it("declines a report snapshot without loading the experiment", async () => {
    await expect(
      recoverStalledSnapshot(context, snapshot({ report: "rep_1" })),
    ).resolves.toBe(false);
    expect(getExperimentById).not.toHaveBeenCalled();
  });

  it("declines a bandit experiment", async () => {
    (getExperimentById as jest.Mock).mockResolvedValue(
      experiment({ type: "multi-armed-bandit" }),
    );

    await expect(recoverStalledSnapshot(context, snapshot())).resolves.toBe(
      false,
    );
    expect(ExperimentResultsQueryRunner).not.toHaveBeenCalled();
  });

  it("declines a snapshot superseded by a newer successful one", async () => {
    (getLatestSuccessfulSnapshot as jest.Mock).mockResolvedValue({
      id: "snp_2",
      dateCreated: new Date("2026-08-02T00:00:00Z"),
    });

    await expect(recoverStalledSnapshot(context, snapshot())).resolves.toBe(
      false,
    );
    expect(getLatestSuccessfulSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        experiment: "exp_1",
        phase: 0,
        type: "standard",
      }),
    );
    expect(ExperimentResultsQueryRunner).not.toHaveBeenCalled();
  });

  it("recovers when the latest successful snapshot is older", async () => {
    (getLatestSuccessfulSnapshot as jest.Mock).mockResolvedValue({
      id: "snp_0",
      dateCreated: new Date("2026-07-31T00:00:00Z"),
    });

    await expect(recoverStalledSnapshot(context, snapshot())).resolves.toBe(
      true,
    );
  });

  it("seeds variation names from the snapshot's own phase", async () => {
    (getExperimentById as jest.Mock).mockResolvedValue(
      experiment({
        phases: [
          {
            variations: [
              { id: "v0", status: "active" },
              { id: "v1", status: "active" },
            ],
          },
          { variations: [{ id: "v0", status: "active" }] },
        ],
      }),
    );

    await recoverStalledSnapshot(context, snapshot({ phase: 0 }));
    await recoverStalledSnapshot(context, snapshot({ phase: 1 }));

    expect(seededResultsInputs(0).variationNames).toEqual([
      "Control",
      "Treatment",
    ]);
    expect(seededResultsInputs(1).variationNames).toEqual(["Control"]);
  });

  it("seeds a metric map that includes derived funnel step metrics", async () => {
    (getMetricMap as jest.Mock).mockResolvedValue(
      new Map([[funnelMetric.id, funnelMetric]]),
    );
    (getExperimentById as jest.Mock).mockResolvedValue(
      experiment({ goalMetrics: [funnelMetric.id] }),
    );

    await recoverStalledSnapshot(context, snapshot());

    expect(
      seededResultsInputs().metricMap.has(
        funnelStepMetricId(funnelMetric.id, 0),
      ),
    ).toBe(true);
  });
});
