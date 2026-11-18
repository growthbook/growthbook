import type { ExperimentInterface } from "shared/types/experiment";
import type { DataSourceInterface } from "shared/types/datasource";
import type {
  ExperimentSnapshotAnalysis,
  ExperimentSnapshotAnalysisSettings,
  ExperimentSnapshotInterface,
  ExperimentSnapshotSettings,
  SnapshotMetric,
} from "shared/types/experiment-snapshot";
import type { ExperimentReportResultDimension } from "shared/types/report";
import type { QueryInterface, QueryPointer } from "shared/types/query";
import type { ExperimentMetricInterface } from "shared/experiments";
import {
  getMetricFilterForCarriedQueries,
  getSnapshotSideEffects,
} from "shared/experiments";
import type { ReqContext } from "back-end/types/request";
import type { PlannedExperimentSnapshot } from "back-end/src/services/experiments";
import type { SourceIntegrationInterface } from "back-end/src/types/Integration";
import type { QueryMap } from "back-end/src/queryRunners/QueryRunner";
import {
  analyzeMetricRefresh,
  carryMetricRefreshQueries,
  getAnalysesToExtend,
  getMetricRefreshLineage,
  getQueriesStartedByRefresh,
  mergeMetricRefreshAnalyses,
  getSettingsChangedSinceParent,
  mergeMetricRefreshSettings,
  parseIncrementalRefreshBase,
  planMetricRefresh,
  resolveIncrementalMetricRefreshRun,
  shouldUpdateNewMetricsOnly,
} from "back-end/src/services/metricRefresh";
import {
  ExperimentResultsQueryRunner,
  getIndexAfterLastGroup,
  isCarriedMetricRefreshQuery,
} from "back-end/src/queryRunners/ExperimentResultsQueryRunner";
import {
  ExperimentIncrementalRefreshQueryRunner,
  isCarriedIncrementalQuery,
} from "back-end/src/queryRunners/ExperimentIncrementalRefreshQueryRunner";
import {
  findLatestSuccessfulOverallSnapshot,
  findSnapshotById,
  getLatestSnapshotStatus,
  getSnapshotQueryPointers,
} from "back-end/src/models/ExperimentSnapshotModel";
import {
  createNewQueryFromCached,
  getQueriesByIds,
} from "back-end/src/models/QueryModel";
import { getSourceIntegrationObject } from "back-end/src/services/datasource";
import { analyzeExperimentResults } from "back-end/src/services/stats";
import {
  BadRequestError,
  ExperimentIncrementalPipelineRequiresFullRefreshError,
  MetricRefreshOutsideWindowError,
  MetricRefreshUnavailableError,
  MetricsAlreadyUpToDateError,
  SnapshotInProgressError,
} from "back-end/src/util/errors";
import { snapshotFactory } from "../factories/Snapshot.factory";
import { factMetricFactory } from "../factories/FactMetric.factory";

jest.mock("back-end/src/models/ExperimentSnapshotModel", () => ({
  findLatestSuccessfulOverallSnapshot: jest.fn(),
  findSnapshotById: jest.fn(),
  getLatestSnapshotStatus: jest.fn(),
  getSnapshotQueryPointers: jest.fn(),
  updateSnapshot: jest.fn(),
}));

jest.mock("back-end/src/models/QueryModel", () => ({
  ...jest.requireActual("back-end/src/models/QueryModel"),
  createNewQueryFromCached: jest.fn(),
  getQueriesByIds: jest.fn(),
}));

jest.mock("back-end/src/services/datasource", () => ({
  getSourceIntegrationObject: jest.fn(),
}));

jest.mock("back-end/src/services/stats", () => ({
  ...jest.requireActual("back-end/src/services/stats"),
  analyzeExperimentResults: jest.fn(),
}));

const findParentMock = jest.mocked(findLatestSuccessfulOverallSnapshot);
const latestStatusMock = jest.mocked(getLatestSnapshotStatus);
const queryPointersMock = jest.mocked(getSnapshotQueryPointers);
const createFromCachedMock = jest.mocked(createNewQueryFromCached);
const getQueriesByIdsMock = jest.mocked(getQueriesByIds);
const integrationMock = jest.mocked(getSourceIntegrationObject);
const analyzeMock = jest.mocked(analyzeExperimentResults);
const findSnapshotByIdMock = jest.mocked(findSnapshotById);

const context = {
  org: { id: "org_1", settings: {} },
  permissions: { canRunExperimentQueries: () => true },
} as unknown as ReqContext;

const datasource = { id: "ds_1", settings: {} } as DataSourceInterface;

const PARENT_START = new Date("2026-11-01T00:00:00Z");
const PARENT_END = new Date("2026-11-10T12:00:00Z");
const PARENT_CREATED = new Date("2026-11-10T12:05:00Z");

const analysisSettings = {
  dimensions: [],
  statsEngine: "bayesian",
  regressionAdjusted: false,
  differenceType: "relative",
  numGoalMetrics: 2,
} as unknown as ExperimentSnapshotAnalysisSettings;

function makeExperiment(
  overrides: Partial<ExperimentInterface> = {},
): ExperimentInterface {
  return {
    id: "exp_1",
    type: "standard",
    phases: [{}],
    goalMetrics: ["met_a", "met_b", "met_c"],
    secondaryMetrics: [],
    guardrailMetrics: [],
    ...overrides,
  } as unknown as ExperimentInterface;
}

function makeSettings(
  metricIds: string[],
  overrides: Partial<ExperimentSnapshotSettings> = {},
): ExperimentSnapshotSettings {
  return snapshotFactory.build({
    settings: {
      experimentId: "exp_1",
      startDate: PARENT_START,
      endDate: PARENT_END,
      endDateIsCutoff: true,
      goalMetrics: metricIds,
      metricSettings: metricIds.map((id) => ({ id })),
      ...overrides,
    },
  }).settings;
}

function makeParent(
  overrides: Partial<ExperimentSnapshotInterface> = {},
): ExperimentSnapshotInterface {
  return snapshotFactory.build({
    id: "snp_parent",
    experiment: "exp_1",
    type: "standard",
    runnerKind: "results",
    dateCreated: PARENT_CREATED,
    settings: makeSettings(["met_a", "met_b"]),
    analyses: [
      {
        analysisKey: "key_parent",
        settings: analysisSettings,
        status: "success",
        dateCreated: PARENT_CREATED,
        results: [],
      },
    ],
    queries: [{ name: "group_0", query: "qry_group", status: "succeeded" }],
    ...overrides,
  });
}

function makePlan(
  overrides: {
    settings?: Partial<ExperimentSnapshotSettings>;
    analysisSettings?: Partial<ExperimentSnapshotAnalysisSettings>;
    runnerKind?: PlannedExperimentSnapshot["snapshot"]["runnerKind"];
    metricIds?: string[];
  } = {},
): PlannedExperimentSnapshot {
  const metricIds = overrides.metricIds ?? ["met_a", "met_b", "met_c"];
  const snapshot = makeParent({
    id: "snp_new",
    settings: makeSettings(metricIds, {
      metricSettings: metricIds.map((id) => ({
        id,
        computedSettings: { planned: true },
      })) as unknown as ExperimentSnapshotSettings["metricSettings"],
      ...overrides.settings,
    }),
    analyses: [
      {
        analysisKey: "key_new",
        settings: {
          ...analysisSettings,
          numGoalMetrics: 3,
          ...overrides.analysisSettings,
        },
        status: "running",
        dateCreated: new Date(),
        results: [],
      },
    ],
    queries: [],
  });
  return {
    snapshot: { ...snapshot, runnerKind: overrides.runnerKind ?? "results" },
    useCache: true,
    fullRefresh: false,
    settingsForSnapshotMetrics: [],
    incrementalFallbackReason: null,
    fullRefreshReason: null,
  };
}

function refreshArgs(
  overrides: Partial<Parameters<typeof planMetricRefresh>[0]> = {},
): Parameters<typeof planMetricRefresh>[0] {
  return {
    context,
    experiment: makeExperiment(),
    datasource,
    phase: 0,
    dimension: undefined,
    useCache: true,
    metricGroups: [],
    planSnapshotAt: jest.fn(async () => makePlan()),
    ...overrides,
  };
}

function stubIntegration(separateExperimentResultQueries = true) {
  integrationMock.mockReturnValue({
    getSourceProperties: () => ({ separateExperimentResultQueries }),
  } as unknown as SourceIntegrationInterface);
}

beforeEach(() => {
  jest.resetAllMocks();
  stubIntegration();
  latestStatusMock.mockResolvedValue(null);
  findParentMock.mockResolvedValue(makeParent());
});

describe("planMetricRefresh", () => {
  it("queries only the missing metric, pinned to the parent's end date", async () => {
    const args = refreshArgs();
    const plan = await planMetricRefresh(args);

    expect(args.planSnapshotAt).toHaveBeenCalledWith(PARENT_END);
    expect(plan.snapshot.metricRefresh).toEqual({
      baseSnapshotId: "snp_parent",
      baseDateCreated: PARENT_CREATED,
      baseCutoffDate: PARENT_END,
      parentSnapshotId: "snp_parent",
      metricIds: ["met_c"],
    });
    expect(plan.snapshot.settings.metricSettings).toEqual([
      { id: "met_a" },
      { id: "met_b" },
      { id: "met_c", computedSettings: { planned: true } },
    ]);
  });

  type Rejection = {
    name: string;
    setup: () => Partial<Parameters<typeof planMetricRefresh>[0]> | void;
    expected: { type: new (...args: never[]) => Error; details?: object };
  };
  const unavailable = (reason: string) => ({
    type: MetricRefreshUnavailableError,
    details: { reason },
  });

  it.each<Rejection>([
    {
      name: "a dimension",
      setup: () => ({ dimension: "exp:browser" }),
      expected: { type: BadRequestError },
    },
    {
      name: "a forced rerun",
      setup: () => ({ useCache: false }),
      expected: { type: BadRequestError },
    },
    {
      name: "a Bandit",
      setup: () => ({
        experiment: makeExperiment({ type: "multi-armed-bandit" }),
      }),
      expected: unavailable("unsupported_experiment_type"),
    },
    {
      name: "an earlier phase",
      setup: () => ({
        experiment: makeExperiment({
          phases: [{}, {}] as ExperimentInterface["phases"],
        }),
      }),
      expected: unavailable("not_latest_phase"),
    },
    {
      name: "an ended phase, whose plan is not pinned to the parent's end date",
      setup: () => ({
        experiment: makeExperiment({
          phases: [{ dateEnded: PARENT_END }] as ExperimentInterface["phases"],
        }),
        planSnapshotAt: async () =>
          makePlan({ settings: { endDateIsCutoff: false } }),
      }),
      expected: unavailable("phase_ended"),
    },
    {
      name: "a single-query Data Source",
      setup: () => stubIntegration(false),
      expected: unavailable("unsupported_data_source"),
    },
    {
      name: "a running update",
      setup: () => {
        latestStatusMock.mockResolvedValue({
          id: "snp_running",
          status: "running",
        } as Awaited<ReturnType<typeof getLatestSnapshotStatus>>);
      },
      expected: {
        type: SnapshotInProgressError,
        details: { snapshotId: "snp_running" },
      },
    },
    {
      name: "no successful Overall results",
      setup: () => {
        findParentMock.mockResolvedValue(null);
      },
      expected: unavailable("no_base_snapshot"),
    },
    {
      name: "a parent with a failed query it would copy",
      setup: () => {
        findParentMock.mockResolvedValue(
          makeParent({
            queries: [
              { name: "group_0", query: "qry_group", status: "succeeded" },
              { name: "group_1", query: "qry_group_1", status: "failed" },
            ],
          }),
        );
      },
      expected: unavailable("base_incomplete"),
    },
    {
      name: "nothing missing",
      setup: () => ({
        experiment: makeExperiment({ goalMetrics: ["met_a", "met_b"] }),
      }),
      expected: {
        type: MetricsAlreadyUpToDateError,
        details: { baseSnapshotId: "snp_parent" },
      },
    },
    {
      name: "an Incremental Pipeline parent with a results plan",
      setup: () => {
        findParentMock.mockResolvedValue(
          makeParent({ runnerKind: "incremental-update" }),
        );
      },
      expected: unavailable("incremental_pipeline"),
    },
    {
      name: "a results parent with an Incremental Pipeline plan",
      setup: () => ({
        planSnapshotAt: async () =>
          makePlan({ runnerKind: "incremental-update" }),
      }),
      expected: unavailable("incremental_pipeline"),
    },
    {
      name: "a planned full refresh of the Incremental Pipeline",
      setup: () => {
        findParentMock.mockResolvedValue(
          makeParent({ runnerKind: "incremental-update" }),
        );
        return {
          planSnapshotAt: async () =>
            makePlan({ runnerKind: "incremental-full" }),
        };
      },
      expected: unavailable("incremental_pipeline"),
    },
    {
      name: "a plan that requires a full refresh",
      setup: () => {
        findParentMock.mockResolvedValue(
          makeParent({ runnerKind: "incremental-update" }),
        );
        return {
          planSnapshotAt: async () => {
            throw new ExperimentIncrementalPipelineRequiresFullRefreshError(
              "Experiment settings changed",
            );
          },
        };
      },
      expected: unavailable("settings_changed"),
    },
    {
      name: "changed snapshot settings",
      setup: () => ({
        planSnapshotAt: async () =>
          makePlan({ settings: { segment: "seg_new" } }),
      }),
      expected: unavailable("settings_changed"),
    },
    {
      name: "changed analysis settings",
      setup: () => ({
        planSnapshotAt: async () =>
          makePlan({ analysisSettings: { statsEngine: "frequentist" } }),
      }),
      expected: unavailable("settings_changed"),
    },
    {
      name: "a missing metric the plan cannot compute",
      setup: () => ({
        planSnapshotAt: async () => makePlan({ metricIds: ["met_a", "met_b"] }),
      }),
      expected: {
        type: MetricsAlreadyUpToDateError,
        details: { baseSnapshotId: "snp_parent" },
      },
    },
  ])("rejects $name", async ({ setup, expected }) => {
    const overrides = setup() ?? {};
    const promise = planMetricRefresh(refreshArgs(overrides));
    await expect(promise).rejects.toBeInstanceOf(expected.type);
    if (expected.details) {
      await expect(promise).rejects.toMatchObject({
        details: expected.details,
      });
    }
  });

  describe("with a window", () => {
    const window = (minutesAfterParent: number) => ({
      windowMinutes: 60,
      now: new Date(PARENT_CREATED.getTime() + minutesAfterParent * 60_000),
    });

    it("plans the refresh when the parent ran within the window", async () => {
      const plan = await planMetricRefresh(refreshArgs({ window: window(30) }));
      expect(plan.snapshot.metricRefresh?.metricIds).toEqual(["met_c"]);
    });

    it("refuses before planning when the parent ran before the window", async () => {
      const args = refreshArgs({ window: window(90) });
      await expect(planMetricRefresh(args)).rejects.toBeInstanceOf(
        MetricRefreshOutsideWindowError,
      );
      expect(args.planSnapshotAt).not.toHaveBeenCalled();
    });

    it("measures from the base full update when the latest results are a refresh", async () => {
      const refreshRanAt = new Date(PARENT_CREATED.getTime() + 80 * 60_000);
      findParentMock.mockResolvedValue(
        makeParent({
          id: "snp_refresh",
          dateCreated: refreshRanAt,
          metricRefresh: {
            baseSnapshotId: "snp_parent",
            baseDateCreated: PARENT_CREATED,
            baseCutoffDate: PARENT_END,
            parentSnapshotId: "snp_parent",
            metricIds: ["met_b"],
          },
        }),
      );

      await expect(
        planMetricRefresh(refreshArgs({ window: window(90) })),
      ).rejects.toBeInstanceOf(MetricRefreshOutsideWindowError);
    });
  });

  it.each([
    ["its own units table drop", "drop_snp_parent"],
    ["the query of a metric since removed", "met_gone"],
  ])(
    "accepts a parent whose only failed query is %s, which it does not copy",
    async (_, failed) => {
      findParentMock.mockResolvedValue(
        makeParent({
          settings: makeSettings(["met_a", "met_b", "met_gone"]),
          queries: [
            { name: "group_0", query: "qry_group", status: "succeeded" },
            { name: failed, query: "qry_failed", status: "failed" },
          ],
        }),
      );

      const plan = await planMetricRefresh(refreshArgs());

      expect(plan.snapshot.metricRefresh?.metricIds).toEqual(["met_c"]);
    },
  );

  it.each([
    ["a statistics query", "statistics_fta_0", true],
    ["a traffic query", "traffic", true],
    [
      "a cache insert, which it does not copy",
      "insert_metrics_source_data_fta_0",
      false,
    ],
  ])(
    "on the Incremental Pipeline, a parent with a failed %s",
    async (_, failed, rejected) => {
      findParentMock.mockResolvedValue(
        makeParent({
          runnerKind: "incremental-update",
          queries: [
            {
              name: "statistics_ftb_0",
              query: "qry_stats",
              status: "succeeded",
            },
            { name: failed, query: "qry_failed", status: "failed" },
          ],
        }),
      );

      const promise = planMetricRefresh(
        refreshArgs({
          planSnapshotAt: async () =>
            makePlan({ runnerKind: "incremental-update" }),
        }),
      );

      if (rejected) {
        await expect(promise).rejects.toMatchObject({
          details: { reason: "base_incomplete" },
        });
      } else {
        await expect(promise).resolves.toMatchObject({
          snapshot: { metricRefresh: { metricIds: ["met_c"] } },
        });
      }
    },
  );

  it.each(["incremental-full", "incremental-update"] as const)(
    "plans an incremental update after an %s parent",
    async (parentKind) => {
      findParentMock.mockResolvedValue(makeParent({ runnerKind: parentKind }));
      const plan = await planMetricRefresh(
        refreshArgs({
          planSnapshotAt: async () =>
            makePlan({ runnerKind: "incremental-update" }),
        }),
      );
      expect(plan.snapshot.runnerKind).toBe("incremental-update");
      expect(plan.snapshot.metricRefresh?.metricIds).toEqual(["met_c"]);
    },
  );
});

describe("shouldUpdateNewMetricsOnly", () => {
  const baseComputedAt = new Date("2026-11-18T10:00:00Z");
  const minutesLater = (minutes: number) =>
    new Date(baseComputedAt.getTime() + minutes * 60_000);
  const decide = (
    overrides: Partial<Parameters<typeof shouldUpdateNewMetricsOnly>[0]>,
  ) =>
    shouldUpdateNewMetricsOnly({
      missingMetricIds: ["met_c"],
      baseComputedAt,
      now: minutesLater(30),
      windowMinutes: 60,
      ...overrides,
    });

  it("applies when metrics are missing and the base ran within the window", () => {
    expect(decide({})).toBe(true);
    expect(decide({ now: minutesLater(59.9) })).toBe(true);
  });

  it("does not apply once the window has passed", () => {
    expect(decide({ now: minutesLater(60) })).toBe(false);
    expect(decide({ now: minutesLater(600) })).toBe(false);
  });

  it("does not apply when nothing is missing", () => {
    expect(decide({ missingMetricIds: [] })).toBe(false);
  });

  it("never applies with a window of 0", () => {
    expect(decide({ windowMinutes: 0, now: baseComputedAt })).toBe(false);
  });
});

describe("parseIncrementalRefreshBase", () => {
  const SCAN_END = PARENT_END;
  const before = (minutes: number) =>
    new Date(SCAN_END.getTime() - minutes * 60_000);
  const after = (minutes: number) =>
    new Date(SCAN_END.getTime() + minutes * 60_000);

  type State = NonNullable<
    Parameters<typeof parseIncrementalRefreshBase>[0]["state"]
  >;
  const source = (
    groupId: string,
    metricIds: string[],
    maxTimestamp: Date | null,
  ): State["metricSources"][number] => ({
    groupId,
    factTableId: groupId.split("_")[0],
    metrics: metricIds.map((id) => ({ id, settingsHash: `h_${id}` })),
    maxTimestamp,
    maxTimestampRaw: null,
    tableFullName: `t_${groupId}`,
  });
  const state = (overrides: Partial<State> = {}): State => ({
    unitsTableFullName: "t_units",
    unitsMaxTimestamp: before(1),
    materializedBySnapshotId: "snp_parent",
    metricSources: [
      source("fta_0", ["met_a"], before(2)),
      source("ftb_0", ["met_b"], SCAN_END),
    ],
    ...overrides,
  });
  const withSource = (...extra: State["metricSources"]) => {
    const s = state();
    s.metricSources.push(...extra);
    return s;
  };
  const parse = (s: State | null) =>
    parseIncrementalRefreshBase({
      state: s,
      parentSnapshotId: "snp_parent",
      definitionMetricIds: new Set(["met_c"]),
      scanEnd: SCAN_END,
    });

  it("accepts the state the parent left and names the targets", () => {
    expect(parse(state())).toEqual({
      definitionMetricIds: new Set(["met_c"]),
      scanEnd: SCAN_END,
    });
  });

  it.each<[string, () => State | null]>([
    ["no pipeline state", () => null],
    ["no units table", () => state({ unitsTableFullName: null })],
    [
      "tables materialized by another run",
      () => state({ materializedBySnapshotId: "snp_failed_update" }),
    ],
    [
      "tables never stamped by a run",
      () => state({ materializedBySnapshotId: undefined }),
    ],
    [
      "a units table past the parent's end",
      () => state({ unitsMaxTimestamp: after(5) }),
    ],
    [
      "a sibling cache past the parent's end, left by an update that replaced the units table",
      () => {
        const s = state();
        s.metricSources[1].maxTimestamp = after(30);
        return s;
      },
    ],
    [
      "a cache that already holds a target",
      () => withSource(source("ftc_1", ["met_c"], before(1))),
    ],
    [
      "a cache that already holds a target's slice",
      () => withSource(source("ftc_1", ["met_c?dim:country=US"], before(1))),
    ],
    [
      "a target sharing a cache with a metric the refresh doesn't compute",
      () => withSource(source("fta_1", ["met_d", "met_c"], before(1))),
    ],
  ])("rejects %s", (_name, makeState) => {
    expect(() => parse(makeState())).toThrow(
      expect.objectContaining({ details: { reason: "incremental_pipeline" } }),
    );
  });
});

describe("resolveIncrementalMetricRefreshRun", () => {
  function resolve(plan: PlannedExperimentSnapshot) {
    const getLockedBySnapshotId = jest.fn().mockResolvedValue({
      unitsTableFullName: "t_units",
      unitsMaxTimestamp: PARENT_END,
      materializedBySnapshotId: "snp_parent",
      metricSources: [],
    });
    const run = resolveIncrementalMetricRefreshRun({
      context: {
        ...context,
        models: { incrementalRefresh: { getLockedBySnapshotId } },
      } as unknown as ReqContext,
      snapshot: plan.snapshot,
      metricRefresh: getMetricRefreshLineage(makeParent(), ["met_c"]),
    });
    return { run, getLockedBySnapshotId };
  }

  it("scans to the plan's cutoff over the state read under the lock", async () => {
    const { run, getLockedBySnapshotId } = resolve(
      makePlan({ runnerKind: "incremental-update" }),
    );

    await expect(run).resolves.toEqual({
      definitionMetricIds: new Set(["met_c"]),
      scanEnd: PARENT_END,
    });
    expect(getLockedBySnapshotId).toHaveBeenCalledWith("exp_1", "snp_new");
  });

  it.each(["results", "incremental-full"] as const)(
    "rejects a plan for the %s runner",
    async (runnerKind) => {
      const { run, getLockedBySnapshotId } = resolve(makePlan({ runnerKind }));

      await expect(run).rejects.toMatchObject({
        details: { reason: "incremental_pipeline" },
      });
      expect(getLockedBySnapshotId).not.toHaveBeenCalled();
    },
  );

  it("rejects a plan with no cutoff as an ended phase", async () => {
    const { run } = resolve(
      makePlan({
        runnerKind: "incremental-update",
        settings: { endDateIsCutoff: false },
      }),
    );

    await expect(run).rejects.toMatchObject({
      details: { reason: "phase_ended" },
    });
  });
});

describe("getSettingsChangedSinceParent", () => {
  it("ignores the metric set, the cutoff flag and the metric counts", () => {
    const parent = makeParent();
    const planned = makePlan().snapshot;
    planned.settings.manual = true;
    planned.settings.endDateIsCutoff = false;

    expect(
      getSettingsChangedSinceParent({ parent, planned, exposureQueries: [] }),
    ).toEqual([]);
  });

  it("names every other difference, including fields only one side has", () => {
    const parent = makeParent();
    const planned = makePlan({
      settings: { segment: "seg_new", queryFilter: "x > 1" },
      analysisSettings: { regressionAdjusted: true },
    }).snapshot;
    Object.assign(planned.settings, { newSetting: true });

    expect(
      getSettingsChangedSinceParent({
        parent,
        planned,
        exposureQueries: [],
      }).sort(),
    ).toEqual(
      [
        "analysis.regressionAdjusted",
        "newSetting",
        "queryFilter",
        "segment",
      ].sort(),
    );
  });

  describe("regression adjustment", () => {
    const parentWithAdjustment = (adjusted: boolean) =>
      makeParent({
        settings: makeSettings(["met_a", "met_b"], {
          regressionAdjustmentEnabled: false,
          metricSettings: ["met_a", "met_b"].map((id) => ({
            id,
            computedSettings: { regressionAdjustmentEnabled: adjusted },
          })) as unknown as ExperimentSnapshotSettings["metricSettings"],
        }),
      });
    const planned = (adjustsCopiedMetrics: boolean) =>
      makePlan({
        settings: {
          regressionAdjustmentEnabled: true,
          metricSettings: [
            ...["met_a", "met_b"].map((id) => ({
              id,
              computedSettings: {
                regressionAdjustmentEnabled: adjustsCopiedMetrics,
              },
            })),
            {
              id: "met_c",
              computedSettings: { regressionAdjustmentEnabled: true },
            },
          ] as unknown as ExperimentSnapshotSettings["metricSettings"],
        },
        analysisSettings: { regressionAdjusted: true },
      }).snapshot;
    const flags = [
      "analysis.regressionAdjusted",
      "regressionAdjustmentEnabled",
    ];

    it("ignores its flags when no copied metric is or would be regression adjusted", () => {
      expect(
        getSettingsChangedSinceParent({
          parent: parentWithAdjustment(false),
          planned: planned(false),
          exposureQueries: [],
        }),
      ).toEqual([]);
    });

    it("names its flags when a copied metric is regression adjusted", () => {
      expect(
        getSettingsChangedSinceParent({
          parent: parentWithAdjustment(true),
          planned: planned(true),
          exposureQueries: [],
        }).sort(),
      ).toEqual(flags);
    });

    it("names its flags when turning it on would adjust a copied metric", () => {
      expect(
        getSettingsChangedSinceParent({
          parent: parentWithAdjustment(false),
          planned: planned(true),
          exposureQueries: [],
        }).sort(),
      ).toEqual(flags);
    });
  });

  it("treats a setting one side lacks as that setting left empty", () => {
    const parent = makeParent();
    const planned = makePlan({
      analysisSettings: { postStratificationEnabled: false },
    }).snapshot;
    Object.assign(planned.settings, {
      isClusterExperiment: false,
      clusterSubUnitIdentifier: "",
      customFields: {},
      precomputedUnitDimensionIds: [],
      lookbackOverride: null,
    });

    expect(
      getSettingsChangedSinceParent({ parent, planned, exposureQueries: [] }),
    ).toEqual([]);
  });

  it("still names a setting one side lacks when the other side sets it", () => {
    const parent = makeParent();
    const planned = makePlan({
      analysisSettings: { postStratificationEnabled: true },
    }).snapshot;
    Object.assign(planned.settings, {
      isClusterExperiment: true,
      coverage: 0,
    });

    expect(
      getSettingsChangedSinceParent({
        parent,
        planned,
        exposureQueries: [],
      }).sort(),
    ).toEqual([
      "analysis.postStratificationEnabled",
      "coverage",
      "isClusterExperiment",
    ]);
  });

  it("treats a missing assignment identifier as the query's legacy one", () => {
    const exposureQueries = [
      {
        id: "eq_1",
        userIdType: "user_id",
        userIdTypes: ["user_id", "anonymous_id"],
      },
    ];
    const parent = makeParent();
    const plannedWith = (identifierType: string) => {
      const planned = makePlan().snapshot;
      planned.settings.exposureQueryIdentifierType = identifierType;
      return planned;
    };

    expect(
      getSettingsChangedSinceParent({
        parent,
        planned: plannedWith("user_id"),
        exposureQueries,
      }),
    ).toEqual([]);
    expect(
      getSettingsChangedSinceParent({
        parent,
        planned: plannedWith("anonymous_id"),
        exposureQueries,
      }),
    ).toEqual(["exposureQueryIdentifierType"]);
  });
});

describe("mergeMetricRefreshSettings", () => {
  it("keeps the parent's entries, adds the targets with their slices, drops departed metrics", () => {
    const parent = makeSettings(["met_a", "met_gone", "met_b"], {
      clusterLevelMetricIds: ["met_a", "met_gone"],
    });
    const planned = makeSettings(
      ["met_a", "met_b", "met_c", "met_c?dim:country=US", "met_b?dim:os=ios"],
      { clusterLevelMetricIds: ["met_a", "met_c"] },
    );
    planned.metricSettings = planned.metricSettings.map((m) => ({
      ...m,
      computedSettings: { planned: true },
    })) as unknown as ExperimentSnapshotSettings["metricSettings"];

    const { settings, queriedMetricIds } = mergeMetricRefreshSettings({
      parent,
      planned,
      targetMetricIds: ["met_c", "met_d"],
    });

    expect(settings.metricSettings).toEqual([
      { id: "met_a" },
      { id: "met_b" },
      { id: "met_c", computedSettings: { planned: true } },
      { id: "met_c?dim:country=US", computedSettings: { planned: true } },
    ]);
    expect(settings.clusterLevelMetricIds).toEqual(["met_a", "met_c"]);
    expect(queriedMetricIds).toEqual(["met_c"]);
  });
});

describe("getMetricRefreshLineage", () => {
  it("points a refresh of a full run at that run", () => {
    expect(getMetricRefreshLineage(makeParent(), ["met_c"])).toEqual({
      baseSnapshotId: "snp_parent",
      baseDateCreated: PARENT_CREATED,
      baseCutoffDate: PARENT_END,
      parentSnapshotId: "snp_parent",
      metricIds: ["met_c"],
    });
  });

  it("points a refresh of a refresh at the root full run", () => {
    const refresh = makeParent({
      id: "snp_refresh",
      dateCreated: new Date("2026-11-11T00:00:00Z"),
      metricRefresh: getMetricRefreshLineage(makeParent(), ["met_c"]),
    });

    expect(getMetricRefreshLineage(refresh, ["met_d"])).toEqual({
      baseSnapshotId: "snp_parent",
      baseDateCreated: PARENT_CREATED,
      baseCutoffDate: PARENT_END,
      parentSnapshotId: "snp_refresh",
      metricIds: ["met_d"],
    });
  });
});

describe("query carry-over", () => {
  const analyzed = new Set(["met_a", "met_single"]);

  it.each([
    ["snp_parent", false],
    ["drop_snp_parent", false],
    ["group_0", true],
    ["unitdim:precomputed:country:group_3", true],
    ["traffic", true],
    ["clusterTraffic", true],
    ["clusterHealth", true],
    ["met_single", true],
    ["unitdim:exp:browser:met_single", true],
    ["met_gone", false],
  ])("carries %s: %s", (name, carried) => {
    expect(isCarriedMetricRefreshQuery(name, "snp_parent", analyzed)).toBe(
      carried,
    );
  });

  it("numbers new metric groups after every carried group", () => {
    expect(getIndexAfterLastGroup([])).toBe(0);
    expect(
      getIndexAfterLastGroup([
        "group_0",
        "met_single",
        "unitdim:exp:browser:group_4",
        "group_2",
        "traffic",
      ]),
    ).toBe(5);
  });

  it("copies the selected parent queries under the same names", async () => {
    queryPointersMock.mockResolvedValue([
      { name: "snp_parent", query: "qry_units", status: "succeeded" },
      { name: "group_0", query: "qry_group", status: "succeeded" },
      { name: "traffic", query: "qry_traffic", status: "succeeded" },
    ]);
    getQueriesByIdsMock.mockImplementation(async (_ctx, ids) =>
      ids.map((id) => ({ id, status: "succeeded" }) as QueryInterface),
    );
    createFromCachedMock.mockImplementation(
      async ({ existing }) =>
        ({
          id: `copy_of_${existing.id}`,
          status: "succeeded",
        }) as QueryInterface,
    );

    const carried = await carryMetricRefreshQueries(
      context,
      getMetricRefreshLineage(makeParent(), ["met_c"]),
      ({ name }: QueryPointer) => name !== "snp_parent",
    );

    expect(carried).toEqual([
      { name: "group_0", query: "copy_of_qry_group", status: "succeeded" },
      { name: "traffic", query: "copy_of_qry_traffic", status: "succeeded" },
    ]);
  });

  it("refuses to copy a query that is gone or unfinished", async () => {
    queryPointersMock.mockResolvedValue([
      { name: "group_0", query: "qry_group", status: "succeeded" },
    ]);
    getQueriesByIdsMock.mockResolvedValue([]);

    await expect(
      carryMetricRefreshQueries(
        context,
        getMetricRefreshLineage(makeParent(), ["met_c"]),
        () => true,
      ),
    ).rejects.toThrow('Query "group_0" of snapshot snp_parent');
  });
});

class StatusProbe extends ExperimentResultsQueryRunner {
  overallStatus() {
    return this.getOverallQueryStatus();
  }
}

function makeRunner(snapshot: ExperimentSnapshotInterface) {
  return new StatusProbe(
    context,
    snapshot,
    {} as SourceIntegrationInterface,
    true,
  );
}

describe("metric refresh status", () => {
  const queries = (failed: string): ExperimentSnapshotInterface["queries"] =>
    ["group_0", "group_1", "met_c", "drop_snp_refresh"].map((name) => ({
      name,
      query: `qry_${name}`,
      status: name === failed ? "failed" : "succeeded",
    }));
  const refresh = (failed: string) =>
    makeParent({
      id: "snp_refresh",
      queries: queries(failed),
      metricRefresh: getMetricRefreshLineage(makeParent(), ["met_c"]),
    });

  it("fails when one of its queries fails", () => {
    expect(makeRunner(refresh("met_c")).overallStatus()).toBe("failed");
  });

  it("only partially succeeds when its own units table cannot be dropped", () => {
    expect(makeRunner(refresh("drop_snp_refresh")).overallStatus()).toBe(
      "partially-succeeded",
    );
  });

  it("leaves a full run's rollup alone", () => {
    expect(
      makeRunner(makeParent({ queries: queries("met_c") })).overallStatus(),
    ).toBe("partially-succeeded");
  });
});

describe("Incremental Pipeline carry-over", () => {
  it.each([
    ["statistics_fta_0", true],
    ["statistics_multi_fta_0__ftb_0", true],
    ["unitdim:precomputed:country:statistics_fta_0", true],
    ["traffic", true],
    ["clusterTraffic", true],
    ["clusterHealth", true],
    ["update_snp_parent", false],
    ["max_timestamp_snp_parent", false],
    ["create_metrics_source_table_ftc_1", false],
    ["insert_metrics_source_data_ftc_1", false],
    ["insert_metrics_covariate_data_ftc_1", false],
    ["max_timestamp_metrics_source_ftc_1", false],
  ])("carries %s: %s", (name, carried) => {
    expect(isCarriedIncrementalQuery(name)).toBe(carried);
  });

  class IncrementalStatusProbe extends ExperimentIncrementalRefreshQueryRunner {
    overallStatus() {
      return this.getOverallQueryStatus();
    }
  }
  const queries = [
    "statistics_fta_0",
    "traffic",
    "insert_metrics_source_data_ftc_1",
    "statistics_ftc_1",
  ].map((name) => ({
    name,
    query: `qry_${name}`,
    status:
      name === "insert_metrics_source_data_ftc_1"
        ? ("failed" as const)
        : ("succeeded" as const),
  }));
  const status = (snapshot: ExperimentSnapshotInterface) =>
    new IncrementalStatusProbe(
      context,
      snapshot,
      {} as SourceIntegrationInterface,
      false,
    ).overallStatus();

  it("fails a refresh when one of its queries fails", () => {
    expect(
      status(
        makeParent({
          id: "snp_refresh",
          runnerKind: "incremental-update",
          queries,
          metricRefresh: getMetricRefreshLineage(makeParent(), ["met_c"]),
        }),
      ),
    ).toBe("failed");
  });

  it("leaves a normal update's rollup alone", () => {
    expect(
      status(makeParent({ runnerKind: "incremental-update", queries })),
    ).toBe("partially-succeeded");
  });
});

describe("a metric refresh that succeeds on the Incremental Pipeline", () => {
  it("records itself as the tables' builder, so the next refresh builds on it", async () => {
    const updateState = jest.fn().mockResolvedValue(true);
    const incrementalContext = {
      ...context,
      models: {
        incrementalRefresh: {
          updateByExperimentIdIfCurrentExecution: updateState,
          releaseLock: jest.fn().mockResolvedValue(undefined),
        },
      },
    } as unknown as ReqContext;
    const root = makeParent({ runnerKind: "incremental-update" });
    const firstRefresh = makeParent({
      id: "snp_refresh",
      runnerKind: "incremental-update",
      dateCreated: new Date("2026-11-11T00:00:00Z"),
      settings: makeSettings(["met_a", "met_b", "met_c"]),
      queries: [
        { name: "statistics_fta_0", query: "qry_a", status: "succeeded" },
        { name: "statistics_ftc_1", query: "qry_c", status: "succeeded" },
      ],
      metricRefresh: getMetricRefreshLineage(root, ["met_c"]),
    });

    await new ExperimentIncrementalRefreshQueryRunner(
      incrementalContext,
      firstRefresh,
      {} as SourceIntegrationInterface,
      false,
    ).updateModel({ status: "succeeded", queries: firstRefresh.queries });

    expect(updateState).toHaveBeenCalledWith("exp_1", "snp_refresh", {
      materializedBySnapshotId: "snp_refresh",
    });

    findParentMock.mockResolvedValue(firstRefresh);
    const allMetrics = ["met_a", "met_b", "met_c", "met_d"];
    const plan = await planMetricRefresh(
      refreshArgs({
        experiment: makeExperiment({ goalMetrics: allMetrics }),
        planSnapshotAt: async () =>
          makePlan({ runnerKind: "incremental-update", metricIds: allMetrics }),
      }),
    );
    const lineage = plan.snapshot.metricRefresh;
    expect(lineage).toEqual({
      baseSnapshotId: "snp_parent",
      baseDateCreated: PARENT_CREATED,
      baseCutoffDate: PARENT_END,
      parentSnapshotId: "snp_refresh",
      metricIds: ["met_d"],
    });

    const [, , written] = updateState.mock.calls[0];
    expect(
      parseIncrementalRefreshBase({
        state: {
          unitsTableFullName: "t_units",
          unitsMaxTimestamp: PARENT_END,
          metricSources: [],
          ...written,
        },
        parentSnapshotId: lineage?.parentSnapshotId ?? "",
        definitionMetricIds: new Set(["met_d"]),
        scanEnd: PARENT_END,
      }),
    ).toEqual({ definitionMetricIds: new Set(["met_d"]), scanEnd: PARENT_END });
  });
});

describe("starting a metric refresh's queries", () => {
  const metricMap = new Map<string, ExperimentMetricInterface>(
    ["met_a", "met_b", "met_c"].map((id) => [
      id,
      factMetricFactory.build({ id, datasource: "ds_1" }),
    ]),
  );
  const integration = {
    datasource: {
      id: "ds_1",
      type: "postgres",
      settings: {
        queries: {
          exposure: [
            {
              id: "eq_1",
              name: "Users",
              userIdType: "user_id",
              query: "SELECT * FROM exposures",
              dimensions: [],
            },
          ],
        },
      },
    },
    getSourceProperties: () => ({ separateExperimentResultQueries: true }),
    getExperimentFactMetricsQuery: () => "SELECT metrics",
    runExperimentFactMetricsQuery: jest.fn(),
    getExperimentAggregateUnitsQuery: () => "SELECT traffic",
  } as unknown as SourceIntegrationInterface;
  const trafficContext = {
    ...context,
    org: { id: "org_1", settings: { runHealthTrafficQuery: true } },
  } as unknown as ReqContext;

  async function start(snapshot: ExperimentSnapshotInterface) {
    const runner = new ExperimentResultsQueryRunner(
      trafficContext,
      snapshot,
      integration,
      true,
    );
    const started: string[] = [];
    jest.spyOn(runner, "startQuery").mockImplementation(async ({ name }) => {
      started.push(name);
      return { name, query: `qry_${name}`, status: "running" };
    });
    const queries = await runner.startQueries({
      snapshotType: snapshot.type ?? "standard",
      snapshotSettings: snapshot.settings,
      variationNames: ["Control", "Treatment"],
      metricMap,
      factTableMap: new Map(),
      queryParentId: snapshot.id,
      experimentQueryMetadata: null,
    });
    return { started, names: queries.map((q) => q.name) };
  }

  const refresh = () =>
    makeParent({
      id: "snp_refresh",
      settings: makeSettings(["met_a", "met_b", "met_c"], {
        exposureQueryId: "eq_1",
      }),
      metricRefresh: getMetricRefreshLineage(makeParent(), ["met_c"]),
    });

  beforeEach(() => {
    queryPointersMock.mockResolvedValue(
      ["snp_parent", "group_0", "group_1", "traffic", "drop_snp_parent"].map(
        (name) => ({ name, query: `qry_parent_${name}`, status: "succeeded" }),
      ),
    );
    getQueriesByIdsMock.mockImplementation(async (_ctx, ids) =>
      ids.map((id) => ({ id, status: "succeeded" }) as QueryInterface),
    );
    createFromCachedMock.mockImplementation(
      async ({ existing }) =>
        ({
          id: `copy_of_${existing.id}`,
          status: "succeeded",
        }) as QueryInterface,
    );
  });

  it("starts only the new metric's query, numbered after the copied groups, with no traffic query", async () => {
    const { started, names } = await start(refresh());

    expect(started).toEqual(["group_2"]);
    expect(names).toEqual(["group_0", "group_1", "traffic", "group_2"]);
  });

  it("runs every query of a report snapshot that still carries a refresh lineage", async () => {
    const { started } = await start({ ...refresh(), type: "report" });

    expect(queryPointersMock).not.toHaveBeenCalled();
    expect(started).toEqual(["group_0", "group_1", "group_2"]);
  });
});

describe("re-analysis of a stored metric refresh", () => {
  const stored = makeParent({
    id: "snp_refresh",
    settings: makeSettings(["met_a", "met_c"]),
    metricRefresh: getMetricRefreshLineage(makeParent(), ["met_c"]),
  });
  const metricA = factMetricFactory.build({ id: "met_a" });
  const metricGone = factMetricFactory.build({ id: "met_gone" });
  const metricC = factMetricFactory.build({ id: "met_c" });
  const metricMap = new Map<string, ExperimentMetricInterface>(
    [metricA, metricGone, metricC].map((m) => [m.id, m]),
  );
  const row = (variation: string) => ({
    variation,
    dimension: "",
    users: 10,
    count: 10,
    main_sum: 1,
    main_sum_squares: 1,
  });
  const queryMap: QueryMap = new Map([
    [
      "group_0",
      {
        queryType: "experimentMultiMetric",
        query: "",
        result: [
          { ...row("0"), m0_id: "met_a", m1_id: "met_gone" },
          { ...row("1"), m0_id: "met_a", m1_id: "met_gone" },
        ],
      } as unknown as QueryInterface,
    ],
    [
      "met_c",
      {
        queryType: "experimentMetric",
        query: "",
        result: [row("0"), row("1")],
      } as unknown as QueryInterface,
    ],
  ]);

  it("analyzes only the metrics in its stored settings", () => {
    const { getMetricsAndQueryDataForStatsEngine } = jest.requireActual<
      typeof import("back-end/src/services/stats")
    >("back-end/src/services/stats");
    const { queryResults } = getMetricsAndQueryDataForStatsEngine(
      queryMap,
      metricMap,
      stored.settings,
      getMetricFilterForCarriedQueries(stored),
    );

    expect(queryResults.map((r) => r.metrics)).toEqual([
      ["met_a", null],
      ["met_c"],
    ]);
  });

  it("keeps a full run unfiltered", () => {
    expect(getMetricFilterForCarriedQueries(makeParent())).toBeUndefined();
  });
});

const metricResult = (value: number) =>
  ({ value, cr: value, users: 10 }) as SnapshotMetric;

function resultDimension(
  metrics: Record<string, number>,
  name = "All",
  users = [10, 10],
): ExperimentReportResultDimension {
  return {
    name,
    srm: 0.5,
    variations: users.map((u) => ({
      users: u,
      metrics: Object.fromEntries(
        Object.entries(metrics).map(([id, v]) => [id, metricResult(v)]),
      ),
    })),
  };
}

function analysis(
  settings: Partial<ExperimentSnapshotAnalysisSettings>,
  results: ExperimentReportResultDimension[],
  status: ExperimentSnapshotAnalysis["status"] = "success",
): ExperimentSnapshotAnalysis {
  return {
    analysisKey: `key_${settings.baselineVariationIndex ?? 0}_${settings.differenceType ?? "relative"}`,
    settings: { ...analysisSettings, ...settings },
    status,
    dateCreated: PARENT_CREATED,
    results,
  };
}

describe("getQueriesStartedByRefresh", () => {
  const query = (cachedQueryUsed?: string) =>
    ({ cachedQueryUsed }) as QueryInterface;

  it("keeps what this run started and drops copies of the parent's queries", () => {
    const queryMap: QueryMap = new Map([
      ["group_0", query("qry_parent_group_0")],
      ["traffic", query("qry_root_traffic")],
      ["group_1", query()],
      ["group_2", query("qry_unrelated_cache_hit")],
      ["statistics_ft_1", query()],
    ]);
    const parentSources = new Map([
      ["group_0", "qry_parent_group_0"],
      ["traffic", "qry_root_traffic"],
      ["statistics_ft_1", "qry_parent_statistics_ft_1"],
    ]);

    expect([
      ...getQueriesStartedByRefresh(queryMap, parentSources).keys(),
    ]).toEqual(["group_1", "group_2", "statistics_ft_1"]);
  });
});

describe("getAnalysesToExtend", () => {
  it("extends only the parent's finished analyses", () => {
    const finished = analysis({}, []);
    const failed = analysis({ baselineVariationIndex: 1 }, [], "error");
    const running = analysis({ differenceType: "absolute" }, [], "running");

    expect(getAnalysesToExtend([finished, failed, running])).toEqual([
      finished,
    ]);
  });
});

describe("mergeMetricRefreshAnalyses", () => {
  const merge = (
    analyses: ExperimentSnapshotAnalysis[],
    freshResults: ExperimentReportResultDimension[][],
    freshMetricIds = ["met_c"],
  ) =>
    mergeMetricRefreshAnalyses({
      analyses,
      freshResults,
      analyzedMetricIds: new Set(["met_a", "met_b", "met_c"]),
      freshMetricIds: new Set(freshMetricIds),
      variationWeights: [0.5, 0.5],
    });

  it("copies the parent's metrics verbatim and adds the fresh ones to each analysis", () => {
    const relative = analysis({}, [resultDimension({ met_a: 1, met_b: 2 })]);
    const absolute = analysis({ differenceType: "absolute" }, [
      resultDimension({ met_a: 10, met_b: 20 }),
    ]);

    const [mergedRelative, mergedAbsolute] = merge(
      [relative, absolute],
      [[resultDimension({ met_c: 3 })], [resultDimension({ met_c: 30 })]],
    );

    expect(mergedRelative).toEqual({
      ...relative,
      results: [resultDimension({ met_a: 1, met_b: 2, met_c: 3 })],
    });
    expect(mergedAbsolute.settings).toEqual(absolute.settings);
    expect(mergedAbsolute.results[0].variations[1].metrics).toEqual({
      met_a: metricResult(10),
      met_b: metricResult(20),
      met_c: metricResult(30),
    });
  });

  it("drops a metric the refresh no longer analyzes", () => {
    const [merged] = merge(
      [analysis({}, [resultDimension({ met_a: 1, met_gone: 9 })])],
      [[resultDimension({ met_c: 3 })]],
    );

    expect(Object.keys(merged.results[0].variations[0].metrics)).toEqual([
      "met_a",
      "met_c",
    ]);
  });

  it("never keeps the parent's numbers for a metric this run queried again", () => {
    const parent = analysis({}, [resultDimension({ met_a: 1, met_b: 2 })]);

    const [requeried] = merge(
      [parent],
      [[resultDimension({ met_b: 5 })]],
      ["met_b"],
    );
    const [noOutput] = merge([parent], [[]], ["met_b"]);

    expect(requeried.results[0].variations[0].metrics.met_b).toEqual(
      metricResult(5),
    );
    expect(noOutput.results[0].variations[0].metrics).toEqual({
      met_a: metricResult(1),
    });
  });

  it("takes the most units any metric saw and recomputes SRM only when they change", () => {
    const parent = analysis({}, [
      resultDimension({ met_a: 1 }, "All", [10, 10]),
    ]);

    const [unchanged] = merge(
      [parent],
      [[resultDimension({ met_c: 3 }, "All", [10, 10])]],
    );
    const [grown] = merge(
      [parent],
      [[resultDimension({ met_c: 3 }, "All", [12, 30])]],
    );

    expect(unchanged.results[0].srm).toBe(0.5);
    expect(grown.results[0].variations.map((v) => v.users)).toEqual([12, 30]);
    expect(grown.results[0].srm).toBeLessThan(0.01);
  });

  it("keeps dimension values only one side has", () => {
    const [merged] = merge(
      [
        analysis({ dimensions: ["dim:country"] }, [
          resultDimension({ met_a: 1 }, "US"),
        ]),
      ],
      [
        [
          resultDimension({ met_c: 3 }, "FR"),
          { name: "All", srm: 1, variations: [] },
        ],
      ],
    );

    expect(merged.results).toEqual([
      resultDimension({ met_a: 1 }, "US"),
      resultDimension({ met_c: 3 }, "FR"),
    ]);
  });
});

describe("analyzeMetricRefresh", () => {
  const refresh = makeParent({
    id: "snp_refresh",
    settings: makeSettings(["met_a", "met_c"]),
    metricRefresh: getMetricRefreshLineage(makeParent(), ["met_c"]),
  });
  const metricMap = new Map<string, ExperimentMetricInterface>(
    ["met_a", "met_gone", "met_c"].map((id) => [
      id,
      factMetricFactory.build({ id }),
    ]),
  );
  const row = (variation: string) => ({
    variation,
    dimension: "",
    users: 10,
    count: 10,
    main_sum: 1,
    main_sum_squares: 1,
  });
  const queryMap: QueryMap = new Map([
    [
      "group_0",
      {
        queryType: "experimentMultiMetric",
        query: "",
        cachedQueryUsed: "qry_group",
        result: [
          { ...row("0"), m0_id: "met_a", m1_id: "met_gone" },
          { ...row("1"), m0_id: "met_a", m1_id: "met_gone" },
        ],
      } as unknown as QueryInterface,
    ],
    [
      "group_1",
      {
        queryType: "experimentMultiMetric",
        query: "",
        result: [
          { ...row("0"), m0_id: "met_c" },
          { ...row("1"), m0_id: "met_c" },
        ],
      } as unknown as QueryInterface,
    ],
  ]);
  const byBaseline = analysis({ baselineVariationIndex: 1 }, [
    resultDimension({ met_a: 2, met_gone: 9 }),
  ]);

  beforeEach(() => {
    findSnapshotByIdMock.mockResolvedValue(
      makeParent({
        unknownVariations: ["v_unknown"],
        multipleExposures: 4,
        analyses: [
          analysis({}, [resultDimension({ met_a: 1, met_gone: 9 })]),
          byBaseline,
          analysis({ differenceType: "absolute" }, [], "error"),
        ],
      }),
    );
    getQueriesByIdsMock.mockResolvedValue([
      { id: "qry_group", status: "succeeded" } as QueryInterface,
    ]);
    analyzeMock.mockImplementation(async ({ analysisSettings }) => ({
      results: analysisSettings.map((s) => ({
        unknownVariations: [],
        multipleExposures: 1,
        dimensions: [
          resultDimension({ met_c: 3 + (s.baselineVariationIndex ?? 0) }),
        ],
      })),
    }));
  });

  const analyze = () =>
    analyzeMetricRefresh({
      context,
      snapshot: refresh,
      metricRefresh: refresh.metricRefresh!,
      queryMap,
      metricMap,
      variationNames: ["Control", "Treatment"],
    });

  it("analyzes only this run's queries under every finished analysis of the parent", async () => {
    await analyze();

    expect(analyzeMock).toHaveBeenCalledTimes(1);
    const [{ queryData, analysisSettings: settings }] =
      analyzeMock.mock.calls[0];
    expect([...queryData.keys()]).toEqual(["group_1"]);
    expect(settings).toEqual([analysisSettings, byBaseline.settings]);
  });

  it("holds the parent's analyses, each with its copied and fresh metrics", async () => {
    const result = await analyze();

    expect(result.analyses.map((a) => a.settings)).toEqual([
      analysisSettings,
      byBaseline.settings,
    ]);
    expect(result.analyses[1].results[0].variations[0].metrics).toEqual({
      met_a: metricResult(2),
      met_c: metricResult(4),
    });
    expect(result).toMatchObject({
      unknownVariations: ["v_unknown"],
      multipleExposures: 4,
    });
  });

  it("refuses a parent whose default analysis is not finished", async () => {
    findSnapshotByIdMock.mockResolvedValue(
      makeParent({ analyses: [analysis({}, [], "error")] }),
    );

    await expect(analyze()).rejects.toThrow("no finished results");
  });
});

describe("getSnapshotSideEffects", () => {
  it("lets a metric refresh skip the schedule, dashboards and update alerts", () => {
    const refresh = makeParent({
      id: "snp_refresh",
      dateCreated: new Date("2026-11-12T00:00:00Z"),
      metricRefresh: getMetricRefreshLineage(makeParent(), ["met_c"]),
    });
    const effects = getSnapshotSideEffects(refresh);

    expect(effects).toMatchObject({
      advanceUpdateSchedule: false,
      refreshDashboards: false,
      ownsUpdateFailedAlert: false,
    });
    expect(effects.timeSeries.pointDate).toEqual(PARENT_CREATED);
    expect(effects.timeSeries.includesMetric("met_c?dim:os=ios")).toBe(true);
    expect(effects.timeSeries.includesMetric("met_a")).toBe(false);
  });
});
