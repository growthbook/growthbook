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
import type { QueryInterface } from "shared/types/query";
import type { ExperimentMetricInterface } from "shared/experiments";
import {
  getMetricFilterForCarriedQueries,
  getResultsDateEnd,
} from "shared/experiments";
import type { ReqContext } from "back-end/types/request";
import type { PlannedExperimentSnapshot } from "back-end/src/services/experiments";
import type { SourceIntegrationInterface } from "back-end/src/types/Integration";
import type { QueryMap } from "back-end/src/queryRunners/QueryRunner";
import {
  analyzeMetricRefresh,
  mergeMetricRefreshAnalyses,
} from "back-end/src/services/metricRefreshExecution";
import {
  getMetricRefreshLineage,
  getQueriesWithChangedSql,
  getSettingsChangedSinceParent,
  mergeMetricRefreshSettings,
  assertIncrementalTablesMatchParent,
  planMetricRefresh,
  type GenerateResultQuerySql,
  type ReplayedQuerySql,
} from "back-end/src/services/metricRefreshPlanning";
import {
  ExperimentResultsQueryRunner,
  isCarriedMetricRefreshQuery,
} from "back-end/src/queryRunners/ExperimentResultsQueryRunner";
import {
  ExperimentIncrementalRefreshQueryRunner,
  isCarriedIncrementalQuery,
} from "back-end/src/queryRunners/ExperimentIncrementalRefreshQueryRunner";
import {
  findLatestSuccessfulOverallSnapshot,
  findMetricRefreshAncestor,
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
import { orgHasPremiumFeature } from "back-end/src/enterprise";
import {
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
  findMetricRefreshAncestor: jest.fn(),
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

jest.mock("back-end/src/enterprise", () => ({
  ...jest.requireActual("back-end/src/enterprise"),
  orgHasPremiumFeature: jest.fn(),
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
const findAncestorMock = jest.mocked(findMetricRefreshAncestor);

const PARENT_START = new Date("2026-11-01T00:00:00Z");
const PARENT_END = new Date("2026-11-10T12:00:00Z");
const PARENT_CREATED = new Date("2026-11-10T12:05:00Z");

const pipelineStateMock = jest.fn();
const context = {
  org: { id: "org_1", settings: {} },
  permissions: { canRunExperimentQueries: () => true },
  logger: { warn: jest.fn() },
  models: {
    incrementalRefresh: { getByExperimentIdAndPhase: pipelineStateMock },
  },
} as unknown as ReqContext;

// The shared context with other models or org settings.
const contextWith = (overrides: object) =>
  ({ ...context, ...overrides }) as unknown as ReqContext;

const datasource = { id: "ds_1", settings: {} } as DataSourceInterface;

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
    phases: [{ dateStarted: PARENT_START }],
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

// Entries with only the computed settings a test reads.
function metricSettingsFor(
  metricIds: string[],
  computedSettings: object,
): ExperimentSnapshotSettings["metricSettings"] {
  return metricIds.map((id) => ({
    id,
    computedSettings,
  })) as unknown as ExperimentSnapshotSettings["metricSettings"];
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
      metricSettings: metricSettingsFor(metricIds, { planned: true }),
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
    generateResultQuerySql: jest.fn(storedSqlGenerator),
    ...overrides,
  };
}

// A group's SQL names its metrics and its index, as real group SQL depends on both.
const groupSql = (metricIds: readonly string[], index: number) =>
  `SELECT ${metricIds.join(", ")}\nFROM group_${index}`;

const storedSqlGenerator: GenerateResultQuerySql = async ({
  settings,
  scope,
}) => {
  const first = scope?.firstGroupIndex ?? 0;
  const metricIds = settings.metricSettings
    .map((m) => m.id)
    .filter((id) => !scope || scope.metricIds.has(id));
  return new Map([[`group_${first}`, groupSql(metricIds, first)]]);
};

function storeQueries(docs: Record<string, string>) {
  getQueriesByIdsMock.mockImplementation(async (ctx, ids) =>
    ids
      .filter((id) => id in docs)
      .map((id) => ({ id, query: docs[id] }) as QueryInterface),
  );
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
  storeQueries({ qry_group: groupSql(["met_a", "met_b"], 0) });
  pipelineStateMock.mockResolvedValue({
    unitsTableFullName: "t_units",
    unitsMaxTimestamp: PARENT_END,
    materializedBySnapshotId: "snp_parent",
    metricSources: [],
  });
});

describe("planMetricRefresh", () => {
  // The analysis dates are outdated once the results are a day old.
  const NOW = new Date(PARENT_CREATED.getTime() + 60 * 60_000);
  beforeAll(() => {
    jest.useFakeTimers({
      now: NOW,
      doNotFake: [
        "hrtime",
        "nextTick",
        "performance",
        "queueMicrotask",
        "setImmediate",
        "clearImmediate",
        "setInterval",
        "clearInterval",
        "setTimeout",
        "clearTimeout",
      ],
    });
  });
  afterAll(() => {
    jest.useRealTimers();
  });

  it("queries only the missing metric, pinned to the parent's end date", async () => {
    const args = refreshArgs();
    const plan = await planMetricRefresh(args);

    expect(args.planSnapshotAt).toHaveBeenCalledWith(PARENT_END);
    expect(plan.snapshot.metricRefresh).toEqual({
      baseSnapshotId: "snp_parent",
      baseDateCreated: PARENT_CREATED,
      baseRunStarted: null,
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

  const refreshOf = (
    id: string,
    parentSnapshotId: string,
    metricIds: string[],
    overrides: Partial<ExperimentSnapshotInterface> = {},
  ) =>
    makeParent({
      id,
      metricRefresh: {
        baseSnapshotId: "snp_base",
        baseDateCreated: PARENT_CREATED,
        baseRunStarted: null,
        baseCutoffDate: PARENT_END,
        parentSnapshotId,
        metricIds,
      },
      ...overrides,
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

  // The typed refusal each condition returns to a "new_metrics" request.
  it.each<Rejection>([
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
      name: "a lineage whose ancestor is gone",
      setup: () => {
        findAncestorMock.mockResolvedValue(null);
        findParentMock.mockResolvedValue(
          refreshOf("snp_parent", "snp_base", ["met_b"]),
        );
      },
      expected: unavailable("base_incomplete"),
    },
    {
      name: "a lineage longer than ten runs",
      setup: () => {
        findAncestorMock.mockImplementation(async (ctx, id) =>
          refreshOf(id, `${id}_up`, ["met_b"]),
        );
        findParentMock.mockResolvedValue(
          refreshOf("snp_parent", "snp_1", ["met_b"]),
        );
      },
      expected: unavailable("base_incomplete"),
    },
    {
      name: "a phase that has ended",
      setup: () => ({
        planSnapshotAt: async () =>
          makePlan({ settings: { endDateIsCutoff: false } }),
      }),
      expected: unavailable("phase_ended"),
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
      expected: unavailable("metric_not_supported"),
    },
    {
      name: "an Incremental Pipeline parent whose tables a later run extended",
      setup: () => {
        findParentMock.mockResolvedValue(
          makeParent({ runnerKind: "incremental-update" }),
        );
        pipelineStateMock.mockResolvedValue({
          unitsTableFullName: "t_units",
          unitsMaxTimestamp: new Date(PARENT_END.getTime() + 60_000),
          materializedBySnapshotId: "snp_parent",
          metricSources: [],
        });
      },
      expected: unavailable("incremental_pipeline"),
    },
    {
      name: "analysis dates that moved by a day",
      setup: () => ({
        experiment: makeExperiment({
          phases: [
            { dateStarted: new Date("2026-10-31T00:00:00Z") },
          ] as ExperimentInterface["phases"],
        }),
      }),
      expected: unavailable("analysis_dates_changed"),
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
      name: "a copied query whose SQL would differ today",
      setup: () => ({
        generateResultQuerySql: async () =>
          new Map([["group_0", groupSql(["met_a", "met_b"], 0) + " WHERE x"]]),
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

  it.each(["results", "incremental-update"] as const)(
    "refuses before planning when the parent's default analysis failed (%s)",
    async (runnerKind) => {
      findParentMock.mockResolvedValue(
        makeParent({
          runnerKind,
          analyses: [{ ...makeParent().analyses[0], status: "error" }],
        }),
      );
      const args = refreshArgs();

      await expect(planMetricRefresh(args)).rejects.toMatchObject({
        details: { reason: "base_incomplete" },
      });
      expect(args.planSnapshotAt).not.toHaveBeenCalled();
    },
  );

  it("measures the window from the end date the results cover, not from when they ran, before planning", async () => {
    findParentMock.mockResolvedValue(
      makeParent({
        dateCreated: new Date(PARENT_END.getTime() + 3 * 3_600_000),
      }),
    );
    const args = refreshArgs({
      window: {
        windowHours: 4,
        now: new Date(PARENT_END.getTime() + 5 * 3_600_000),
      },
    });

    await expect(planMetricRefresh(args)).rejects.toBeInstanceOf(
      MetricRefreshOutsideWindowError,
    );
    expect(args.planSnapshotAt).not.toHaveBeenCalled();
  });

  it("accepts a parent whose only failed query is its own units table drop, which it does not copy", async () => {
    findParentMock.mockResolvedValue(
      makeParent({
        queries: [
          { name: "group_0", query: "qry_group", status: "succeeded" },
          { name: "drop_snp_parent", query: "qry_failed", status: "failed" },
        ],
      }),
    );

    const plan = await planMetricRefresh(refreshArgs());

    expect(plan.snapshot.metricRefresh?.metricIds).toEqual(["met_c"]);
  });

  it("refuses as changed settings when a metric the parent copied is no longer on the experiment", async () => {
    findParentMock.mockResolvedValue(
      makeParent({ settings: makeSettings(["met_a", "met_b", "met_gone"]) }),
    );
    storeQueries({ qry_group: groupSql(["met_a", "met_b", "met_gone"], 0) });

    await expect(planMetricRefresh(refreshArgs())).rejects.toMatchObject({
      details: { reason: "settings_changed" },
    });
  });

  // The first update on the Incremental Pipeline is a Full Refresh.
  it("plans an incremental update after an incremental-full parent", async () => {
    findParentMock.mockResolvedValue(
      makeParent({ runnerKind: "incremental-full" }),
    );
    const plan = await planMetricRefresh(
      refreshArgs({
        planSnapshotAt: async () =>
          makePlan({ runnerKind: "incremental-update" }),
      }),
    );
    expect(plan.snapshot.runnerKind).toBe("incremental-update");
    expect(plan.snapshot.metricRefresh?.metricIds).toEqual(["met_c"]);
  });

  describe("comparing the SQL it would copy", () => {
    it("refuses as changed settings when today's SQL can't be generated, and logs why", async () => {
      const error = new Error("Unknown exposure query: user_id");
      const promise = planMetricRefresh(
        refreshArgs({
          generateResultQuerySql: jest.fn().mockRejectedValue(error),
        }),
      );

      await expect(promise).rejects.toMatchObject({
        details: { reason: "settings_changed" },
      });
      expect(context.logger.warn).toHaveBeenCalledWith(
        error,
        "Could not regenerate the SQL a metric refresh would copy",
      );
    });

    it("checks a refresh of a refresh against each run's own groups, numbered after the earlier runs", async () => {
      // base snp_base ran met_a; snp_mid added met_b; the parent added met_d.
      findAncestorMock.mockImplementation(async (ctx, id) =>
        id === "snp_mid"
          ? refreshOf("snp_mid", "snp_base", ["met_b"], {
              settings: makeSettings(["met_a", "met_b"]),
            })
          : makeParent({ id, settings: makeSettings(["met_a"]) }),
      );
      findParentMock.mockResolvedValue(
        refreshOf("snp_parent", "snp_mid", ["met_d"], {
          settings: makeSettings(["met_a", "met_b", "met_d"]),
          queries: ["group_0", "group_1", "group_2"].map((name) => ({
            name,
            query: `qry_${name}`,
            status: "succeeded",
          })),
        }),
      );
      const plan = (midGroupSql: string) => {
        storeQueries({
          qry_group_0: groupSql(["met_a"], 0),
          qry_group_1: midGroupSql,
          qry_group_2: groupSql(["met_d"], 2),
        });
        return planMetricRefresh(
          refreshArgs({
            experiment: makeExperiment({
              goalMetrics: ["met_a", "met_b", "met_c", "met_d"],
            }),
            planSnapshotAt: async () =>
              makePlan({ metricIds: ["met_a", "met_b", "met_c", "met_d"] }),
          }),
        );
      };

      await expect(plan(groupSql(["met_b"], 1))).resolves.toMatchObject({
        snapshot: { metricRefresh: { metricIds: ["met_c"] } },
      });
      await expect(
        plan(`${groupSql(["met_b"], 1)} WHERE x`),
      ).rejects.toMatchObject({ details: { reason: "settings_changed" } });
    });
  });
});

describe("getQueriesWithChangedSql", () => {
  const stored = new Map([
    ["group_0", "-- Revenue\nSELECT 1\n  -- Fact Table: Orders\nFROM t"],
    ["traffic", "SELECT 2"],
  ]);
  const replayed = (sql: string): ReplayedQuerySql => ({
    sql,
    clockedExposureCutoffs: null,
  });

  it.each<[string, string[], Record<string, string>, string[]]>([
    [
      "ignores whole comment lines, such as a renamed metric's",
      ["group_0", "traffic"],
      {
        group_0:
          "-- Revenue (renamed)\nSELECT 1\n  -- Fact Table: Sales\nFROM t",
        traffic: "SELECT 2",
      },
      [],
    ],
    [
      "names a query whose SQL changed, even only after a comment on a code line",
      ["group_0", "traffic"],
      { group_0: "SELECT 1\nFROM t -- note", traffic: "SELECT 2" },
      ["group_0"],
    ],
    [
      "names a query today's plan would not generate",
      ["group_0", "traffic"],
      { group_0: "SELECT 1\nFROM t" },
      ["traffic"],
    ],
    [
      "names a query that has no stored SQL",
      ["group_1"],
      { group_1: "SELECT 3" },
      ["group_1"],
    ],
  ])("%s", (name, queryNames, today, expected) => {
    expect(
      getQueriesWithChangedSql({
        queryNames,
        storedSql: stored,
        todaysSql: new Map(
          Object.entries(today).map(([query, sql]) => [query, replayed(sql)]),
        ),
      }),
    ).toEqual(expected);
  });

  describe("a run that took its exposure cutoff from its clock", () => {
    const groupAt = (cutoff: string, metricEnd = "'2026-11-13 12:00:00'") =>
      `SELECT * FROM units\nWHERE\n  first_exposure_timestamp <= ${cutoff}\n  AND m.timestamp <= ${metricEnd}`;
    const changedFrom = (
      stored: string,
      today = groupAt("'2026-11-18 09:00:00'"),
      asOfEndDate = groupAt("'2026-11-07 12:00:00'", "'2026-11-10 12:00:00'"),
    ) =>
      getQueriesWithChangedSql({
        queryNames: ["group_0"],
        storedSql: new Map([["group_0", stored]]),
        todaysSql: new Map([
          [
            "group_0",
            {
              sql: today,
              clockedExposureCutoffs: {
                sqlAsOfEndDate: asOfEndDate,
                maxDriftMs: 5000,
              },
            },
          ],
        ]),
      });

    it.each<[string, () => string[], string[]]>([
      [
        "accepts a cutoff at its end date's",
        () => changedFrom(groupAt("'2026-11-07 12:00:00'")),
        [],
      ],
      [
        "accepts a cutoff written up to when its queries started, in whole seconds",
        () => changedFrom(groupAt("'2026-11-07 12:00:05'")),
        [],
      ],
      [
        "accepts a dialect's full ISO timestamp",
        () =>
          changedFrom(
            groupAt("TIMESTAMP'2026-11-07T12:00:04.250Z'"),
            groupAt("TIMESTAMP'2026-11-18T09:00:00.000Z'"),
            groupAt("TIMESTAMP'2026-11-07T12:00:00.000Z'"),
          ),
        [],
      ],
      [
        "refuses a cutoff before its end date's",
        () => changedFrom(groupAt("'2026-11-07 11:59:59'")),
        ["group_0"],
      ],
      [
        "refuses a cutoff after its queries started",
        () => changedFrom(groupAt("'2026-11-07 12:00:06'")),
        ["group_0"],
      ],
      [
        "still compares every other timestamp",
        () =>
          changedFrom(
            groupAt("'2026-11-07 12:00:01'", "'2026-11-13 12:00:01'"),
          ),
        ["group_0"],
      ],
    ])("%s", (name, run, expected) => {
      expect(run()).toEqual(expected);
    });
  });
});

describe("assertIncrementalTablesMatchParent", () => {
  const SCAN_END = PARENT_END;
  const before = (minutes: number) =>
    new Date(SCAN_END.getTime() - minutes * 60_000);
  const after = (minutes: number) =>
    new Date(SCAN_END.getTime() + minutes * 60_000);

  type State = NonNullable<
    Parameters<typeof assertIncrementalTablesMatchParent>[0]["state"]
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
  const parse = (s: State | null) => () =>
    assertIncrementalTablesMatchParent({
      state: s,
      parentSnapshotId: "snp_parent",
      scanEnd: SCAN_END,
    });

  it.each<[string, () => State]>([
    ["the state the parent left", () => state()],
    [
      "a cache that already holds a target, left by a refresh that failed after rebuilding it",
      () => withSource(source("ftc_1", ["met_c"], SCAN_END)),
    ],
    [
      "a rebuilt cache sharing a target with a metric the refresh copies",
      () => withSource(source("fta_1", ["met_d", "met_c"], before(1))),
    ],
  ])("accepts %s", (name, makeState) => {
    expect(parse(makeState())).not.toThrow();
  });

  it("rejects a cache a failed update filled past the parent's end", () => {
    expect(parse(withSource(source("ftc_1", ["met_c"], after(1))))).toThrow(
      expect.objectContaining({ details: { reason: "incremental_pipeline" } }),
    );
  });
});

describe("getSettingsChangedSinceParent", () => {
  const incremental = { runnerKind: "incremental-update" } as const;
  const planned = (
    settings: object,
    analysisSettings: Partial<ExperimentSnapshotAnalysisSettings> = {},
  ) => {
    const plan = makePlan({ analysisSettings }).snapshot;
    Object.assign(plan.settings, settings);
    return plan;
  };
  // The parent's and the plan's regression adjustment of copied metrics.
  const adjustedParent = (
    adjusted: boolean,
    runnerKind: ExperimentSnapshotInterface["runnerKind"] = "incremental-update",
  ) =>
    makeParent({
      runnerKind,
      settings: makeSettings(["met_a", "met_b"], {
        regressionAdjustmentEnabled: false,
        metricSettings: metricSettingsFor(["met_a", "met_b"], {
          regressionAdjustmentEnabled: adjusted,
        }),
      }),
    });
  const adjustingPlan = (adjustsCopiedMetrics: boolean) =>
    makePlan({
      settings: {
        regressionAdjustmentEnabled: true,
        metricSettings: [
          ...metricSettingsFor(["met_a", "met_b"], {
            regressionAdjustmentEnabled: adjustsCopiedMetrics,
          }),
          ...metricSettingsFor(["met_c"], {
            regressionAdjustmentEnabled: true,
          }),
        ],
      },
      analysisSettings: { regressionAdjusted: true },
    }).snapshot;
  const adjustmentFlags = [
    "analysis.regressionAdjusted",
    "regressionAdjustmentEnabled",
  ];

  // The parity test in snapshot-planning.test.ts covers every setting behind
  // an Outdated reason; these rows cover what it can't reach.
  it.each<{
    name: string;
    parent?: ExperimentSnapshotInterface;
    planned: Pick<ExperimentSnapshotInterface, "settings" | "analyses">;
    expected: string[];
  }>([
    {
      name: "on the standard pipeline, ignores a custom field edit",
      planned: planned({ customFields: { team: "growth" } }),
      expected: [],
    },
    {
      name: "ignores the regression adjustment flags when no copied metric is or would be adjusted",
      parent: adjustedParent(false),
      planned: adjustingPlan(false),
      expected: [],
    },
    {
      name: "names the regression adjustment flags when a copied metric is adjusted",
      parent: adjustedParent(true),
      planned: adjustingPlan(true),
      expected: adjustmentFlags,
    },
    {
      name: "on the standard pipeline, names only the analysis flag and leaves the snapshot flag to the SQL check",
      parent: adjustedParent(true, "results"),
      planned: adjustingPlan(true),
      expected: ["analysis.regressionAdjusted"],
    },
    {
      name: "names the regression adjustment flags when turning it on would adjust a copied metric",
      parent: adjustedParent(false),
      planned: adjustingPlan(true),
      expected: adjustmentFlags,
    },
    {
      name: "treats a setting one side lacks as that setting left empty",
      planned: planned(
        {
          isClusterExperiment: false,
          clusterSubUnitIdentifier: "",
          customFields: {},
          precomputedUnitDimensionIds: [],
          lookbackOverride: null,
        },
        { postStratificationEnabled: false },
      ),
      expected: [],
    },
    {
      name: "still names a setting one side lacks when the other side sets it",
      planned: planned(
        { isClusterExperiment: true, coverage: 0 },
        { postStratificationEnabled: true },
      ),
      expected: [
        "analysis.postStratificationEnabled",
        "coverage",
        "isClusterExperiment",
      ],
    },
    {
      name: "treats a missing assignment identifier as the query's legacy one",
      parent: makeParent(incremental),
      planned: planned({ exposureQueryIdentifierType: "user_id" }),
      expected: [],
    },
    {
      name: "names an assignment identifier other than the query's legacy one",
      parent: makeParent(incremental),
      planned: planned({ exposureQueryIdentifierType: "anonymous_id" }),
      expected: ["exposureQueryIdentifierType"],
    },
  ])("$name", ({ parent = makeParent(), planned, expected }) => {
    expect(
      getSettingsChangedSinceParent({
        parent,
        planned,
        exposureQueries: [
          {
            id: "eq_1",
            userIdType: "user_id",
            userIdTypes: ["user_id", "anonymous_id"],
          },
        ],
      }).sort(),
    ).toEqual(expected);
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
    planned.metricSettings = metricSettingsFor(
      planned.metricSettings.map((m) => m.id),
      { planned: true },
    );

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
  it("points a refresh of a refresh at the root full run", () => {
    const refresh = makeParent({
      id: "snp_refresh",
      dateCreated: new Date("2026-11-11T00:00:00Z"),
      runStarted: new Date("2026-11-11T00:00:01Z"),
      metricRefresh: getMetricRefreshLineage(
        makeParent({ runStarted: PARENT_CREATED }),
        ["met_c"],
      ),
    });

    expect(getMetricRefreshLineage(refresh, ["met_d"])).toEqual({
      baseSnapshotId: "snp_parent",
      baseDateCreated: PARENT_CREATED,
      baseRunStarted: PARENT_CREATED,
      baseCutoffDate: PARENT_END,
      parentSnapshotId: "snp_refresh",
      metricIds: ["met_d"],
    });
  });
});

// The results endpoint must report the same dateEnd before and after a
// refresh; metricRefresh.dateEnd is the analysis end the refresh is pinned to.
describe("dateEnd of a refresh", () => {
  const baseRan = new Date("2026-11-18T22:17:36.299Z");
  const runningPhase = { dateEnded: undefined };

  function refreshOf(
    parent: ExperimentSnapshotInterface,
    id: string,
    ran: Date,
  ): ExperimentSnapshotInterface {
    return makeParent({
      id,
      runStarted: ran,
      dateCreated: ran,
      settings: { ...parent.settings },
      metricRefresh: getMetricRefreshLineage(parent, ["met_c"]),
    });
  }

  it.each([
    {
      name: "a refresh of a base analyzed through its run time",
      endDate: new Date("2026-11-18T22:17:36.208Z"),
      endDateIsCutoff: false,
      refreshes: 1,
    },
    {
      name: "a refresh of a base analyzed through a lagged cutoff",
      endDate: new Date("2026-11-17T21:17:36.208Z"),
      endDateIsCutoff: true,
      refreshes: 1,
    },
    {
      name: "a refresh of a refresh of a lagged base",
      endDate: new Date("2026-11-17T21:17:36.208Z"),
      endDateIsCutoff: true,
      refreshes: 2,
    },
  ])(
    "keeps the base's dateEnd for $name",
    ({ endDate, endDateIsCutoff, refreshes }) => {
      const base = makeParent({
        runStarted: baseRan,
        settings: makeSettings(["met_a", "met_b"], {
          endDate,
          endDateIsCutoff,
        }),
      });
      let refresh = base;
      for (let i = 1; i <= refreshes; i++) {
        refresh = refreshOf(
          refresh,
          `snp_refresh_${i}`,
          new Date(Date.UTC(2026, 10, 18, 22 + i)),
        );
      }
      const dateEnded = new Date("2026-11-20T00:00:00Z");

      expect(getResultsDateEnd(base, runningPhase)).toEqual(baseRan);
      expect(getResultsDateEnd(refresh, runningPhase)).toEqual(baseRan);
      expect(getResultsDateEnd(refresh, { dateEnded })).toEqual(dateEnded);
    },
  );
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
});

// One rule on both pipelines: a refresh can't partly succeed, except when
// only the cleanup of a table it no longer needs fails.
describe("metric refresh status", () => {
  class ResultsStatusProbe extends ExperimentResultsQueryRunner {
    overallStatus() {
      return this.getOverallQueryStatus();
    }
  }
  class IncrementalStatusProbe extends ExperimentIncrementalRefreshQueryRunner {
    overallStatus() {
      return this.getOverallQueryStatus();
    }
  }
  const pipelines = {
    results: {
      probe: ResultsStatusProbe,
      queries: ["group_0", "group_1", "met_c"],
      cleanup: "drop_snp_refresh",
    },
    "incremental-update": {
      probe: IncrementalStatusProbe,
      queries: [
        "statistics_fta_0",
        "traffic",
        "insert_metrics_source_data_ftc_1",
        "statistics_ftc_1",
      ],
      cleanup: "drop_replaced_metrics_source_ftc_0",
    },
  } as const;

  it.each([
    {
      runnerKind: "results",
      run: "a refresh",
      failed: "met_c",
      expected: "failed",
    },
    {
      runnerKind: "results",
      run: "a refresh",
      failed: "cleanup",
      expected: "partially-succeeded",
    },
    {
      runnerKind: "results",
      run: "a normal update",
      failed: "met_c",
      expected: "partially-succeeded",
    },
    {
      runnerKind: "incremental-update",
      run: "a refresh",
      failed: "insert_metrics_source_data_ftc_1",
      expected: "failed",
    },
    {
      runnerKind: "incremental-update",
      run: "a refresh",
      failed: "cleanup",
      expected: "partially-succeeded",
    },
    {
      runnerKind: "incremental-update",
      run: "a normal update",
      failed: "insert_metrics_source_data_ftc_1",
      expected: "partially-succeeded",
    },
    {
      runnerKind: "incremental-update",
      run: "a normal update",
      failed: "cleanup",
      expected: "partially-succeeded",
    },
  ] as const)(
    "on $runnerKind, $run whose $failed query failed is $expected",
    ({ runnerKind, run, failed, expected }) => {
      const { probe: Probe, queries, cleanup } = pipelines[runnerKind];
      const failedName = failed === "cleanup" ? cleanup : failed;
      const snapshot = makeParent({
        id: "snp_refresh",
        runnerKind,
        queries: [...queries, cleanup].map((name) => ({
          name,
          query: `qry_${name}`,
          status: name === failedName ? "failed" : "succeeded",
        })),
        ...(run === "a refresh"
          ? { metricRefresh: getMetricRefreshLineage(makeParent(), ["met_c"]) }
          : {}),
      });

      expect(
        new Probe(
          context,
          snapshot,
          {} as SourceIntegrationInterface,
          false,
        ).overallStatus(),
      ).toBe(expected);
    },
  );
});

describe("a metric refresh that succeeds on the Incremental Pipeline", () => {
  it("records itself as the tables' builder, so the next refresh builds on it", async () => {
    const updateState = jest.fn().mockResolvedValue(true);
    const incrementalContext = contextWith({
      models: {
        incrementalRefresh: {
          updateByExperimentIdIfCurrentExecution: updateState,
          releaseLock: jest.fn().mockResolvedValue(undefined),
        },
      },
    });
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
  const trafficContext = contextWith({
    org: { id: "org_1", settings: { runHealthTrafficQuery: true } },
  });

  async function start(
    snapshot: ExperimentSnapshotInterface,
    sourceIntegration = integration,
  ) {
    const runner = new ExperimentResultsQueryRunner(
      trafficContext,
      snapshot,
      sourceIntegration,
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
    getQueriesByIdsMock.mockImplementation(async (ctx, ids) =>
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

  it("on a Data Source that materializes units tables, builds and drops its own, pinned to the base's end", async () => {
    jest.mocked(orgHasPremiumFeature).mockReturnValue(true);
    const getExperimentUnitsTableQuery = jest.fn(() => "CREATE units");
    const getExperimentFactMetricsQuery = jest.fn(() => "SELECT metrics");
    const unitsTable = "gb_tmp.growthbook_tmp_units_snp_refresh";

    const { started, names } = await start(refresh(), {
      ...integration,
      datasource: {
        ...integration.datasource,
        settings: {
          ...integration.datasource.settings,
          pipelineSettings: {
            allowWriting: true,
            mode: "ephemeral",
            writeDataset: "gb_tmp",
            unitsTableDeletion: true,
          },
        },
      },
      getSourceProperties: () => ({
        separateExperimentResultQueries: true,
        supportsWritingTables: true,
        dropUnitsTable: true,
      }),
      generateTablePath: (name: string, dataset?: string) =>
        `${dataset}.${name}`,
      getExperimentUnitsTableQuery,
      getExperimentFactMetricsQuery,
      getDropUnitsTableQuery: () => "DROP units",
    } as unknown as SourceIntegrationInterface);

    expect(started).toEqual(["snp_refresh", "group_2", "drop_snp_refresh"]);
    expect(names).toEqual([
      "group_0",
      "group_1",
      "traffic",
      "snp_refresh",
      "group_2",
      "drop_snp_refresh",
    ]);
    expect(getExperimentUnitsTableQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        unitsTableFullName: unitsTable,
        unitsSettings: expect.objectContaining({
          endDate: PARENT_END,
          endDateIsCutoff: true,
        }),
      }),
    );
    expect(getExperimentFactMetricsQuery).toHaveBeenCalledWith(
      expect.objectContaining({ unitsTableFullName: unitsTable }),
    );
  });
});

// Result queries and metrics for the metrics a refresh analyzes.
const metricMap = new Map<string, ExperimentMetricInterface>(
  ["met_a", "met_gone", "met_c"].map((id) => [
    id,
    factMetricFactory.build({ id }),
  ]),
);
function resultQuery(
  queryType: QueryInterface["queryType"],
  metricIds: Record<string, string> = {},
): QueryInterface {
  const result = ["0", "1"].map((variation) => ({
    variation,
    dimension: "",
    users: 10,
    count: 10,
    main_sum: 1,
    main_sum_squares: 1,
    ...metricIds,
  }));
  return { queryType, query: "", result } as unknown as QueryInterface;
}

describe("re-analysis of a stored metric refresh", () => {
  const stored = makeParent({
    id: "snp_refresh",
    settings: makeSettings(["met_a", "met_c"]),
    metricRefresh: getMetricRefreshLineage(makeParent(), ["met_c"]),
  });
  const queryMap: QueryMap = new Map([
    [
      "group_0",
      resultQuery("experimentMultiMetric", {
        m0_id: "met_a",
        m1_id: "met_gone",
      }),
    ],
    ["met_c", resultQuery("experimentMetric")],
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

describe("mergeMetricRefreshAnalyses", () => {
  const merge = (
    analyses: ExperimentSnapshotAnalysis[],
    freshResults: ExperimentReportResultDimension[][],
  ) =>
    mergeMetricRefreshAnalyses({
      analyses,
      freshResults,
      analyzedMetricIds: new Set([
        "met_a",
        "met_b",
        "met_c",
        "met_c?dim:country=US",
      ]),
      newMetricIds: new Set(["met_c"]),
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

  it("keeps the parent's numbers for a metric this run returned rows for again", () => {
    const parent = analysis({}, [resultDimension({ met_a: 1, met_b: 2 })]);

    const [merged] = merge(
      [parent],
      [
        [
          resultDimension({
            met_a: 7,
            met_b: 5,
            met_c: 3,
            "met_c?dim:country=US": 4,
          }),
        ],
      ],
    );
    const [noOutput] = merge([parent], [[]]);

    expect(merged.results[0].variations[0].metrics).toEqual({
      met_a: metricResult(1),
      met_b: metricResult(2),
      met_c: metricResult(3),
      "met_c?dim:country=US": metricResult(4),
    });
    expect(noOutput.results[0].variations[0].metrics).toEqual({
      met_a: metricResult(1),
      met_b: metricResult(2),
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

  it("keeps dimension values only one side has, with only the new metrics from one the parent lacks", () => {
    const [merged] = merge(
      [
        analysis({ dimensions: ["dim:country"] }, [
          resultDimension({ met_a: 1 }, "US"),
        ]),
      ],
      [
        [
          resultDimension({ met_a: 7, met_c: 3 }, "FR"),
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
  const queryMap: QueryMap = new Map([
    [
      "group_0",
      {
        ...resultQuery("experimentMultiMetric", {
          m0_id: "met_a",
          m1_id: "met_gone",
        }),
        cachedQueryUsed: "qry_group",
      },
    ],
    ["group_1", resultQuery("experimentMultiMetric", { m0_id: "met_c" })],
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

  it("analyzes only this run's queries and holds the parent's finished analyses, each with its copied and fresh metrics", async () => {
    const result = await analyze();

    expect(analyzeMock).toHaveBeenCalledTimes(1);
    const [{ queryData, analysisSettings: settings }] =
      analyzeMock.mock.calls[0];
    expect([...queryData.keys()]).toEqual(["group_1"]);
    expect(settings).toEqual([analysisSettings, byBaseline.settings]);
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

  describe("on the Incremental Pipeline, where the rebuilt cache returns rows for every metric of its fact table", () => {
    const parentSettings = makeSettings(["met_a"], {
      metricSettings: metricSettingsFor(["met_a"], { window: "base" }),
    });
    const editedPlan = makeSettings(["met_a", "met_c"], {
      metricSettings: metricSettingsFor(["met_a", "met_c"], {
        window: "edited",
      }),
    });
    const statisticsQueryMap: QueryMap = new Map([
      [
        "statistics_fta_1",
        resultQuery("experimentIncrementalRefreshStatistics", {
          m0_id: "met_a",
          m1_id: "met_c",
        }),
      ],
    ]);

    beforeEach(() => {
      findSnapshotByIdMock.mockResolvedValue(
        makeParent({
          runnerKind: "incremental-update",
          settings: parentSettings,
          queries: [
            {
              name: "statistics_fta_0",
              query: "qry_stats",
              status: "succeeded",
            },
          ],
          analyses: [analysis({}, [resultDimension({ met_a: 1 })])],
        }),
      );
      analyzeMock.mockResolvedValue({
        results: [
          {
            unknownVariations: [],
            multipleExposures: 0,
            dimensions: [resultDimension({ met_a: 7, met_c: 3 })],
          },
        ],
      });
    });

    const analyzeIncremental = (settings: ExperimentSnapshotSettings) =>
      analyzeMetricRefresh({
        context,
        snapshot: { ...refresh, runnerKind: "incremental-update", settings },
        metricRefresh: refresh.metricRefresh!,
        queryMap: statisticsQueryMap,
        metricMap,
        variationNames: ["Control", "Treatment"],
      });

    it("keeps the parent's numbers for a metric on the rebuilt fact table and adds the new metric's", async () => {
      const result = await analyzeIncremental(makeSettings(["met_a", "met_c"]));

      expect(result.analyses[0].results[0].variations[1].metrics).toEqual({
        met_a: metricResult(1),
        met_c: metricResult(3),
      });
    });

    it("keeps the parent's numbers and settings for a metric edited since the parent", async () => {
      const { settings } = mergeMetricRefreshSettings({
        parent: parentSettings,
        planned: editedPlan,
        targetMetricIds: ["met_c"],
      });

      const result = await analyzeIncremental(settings);

      expect(settings.metricSettings).toEqual([
        parentSettings.metricSettings[0],
        editedPlan.metricSettings[1],
      ]);
      expect(result.analyses[0].results[0].variations[0].metrics).toEqual({
        met_a: metricResult(1),
        met_c: metricResult(3),
      });
    });
  });

  it("counts a new goal metric among the refresh's goals when the parent had none", async () => {
    const parentSettings = { numGoalMetrics: 0, numGuardrailMetrics: 0 };
    findSnapshotByIdMock.mockResolvedValue(
      makeParent({
        analyses: [
          analysis(parentSettings, [resultDimension({ met_a: 1 })]),
          analysis({ ...parentSettings, baselineVariationIndex: 1 }, []),
        ],
      }),
    );

    const result = await analyzeMetricRefresh({
      context,
      snapshot: {
        ...refresh,
        analyses: [
          analysis(
            { numGoalMetrics: 1, numGuardrailMetrics: 2 },
            [],
            "running",
          ),
        ],
      },
      metricRefresh: refresh.metricRefresh!,
      queryMap,
      metricMap,
      variationNames: ["Control", "Treatment"],
    });

    expect(
      analyzeMock.mock.calls[0][0].analysisSettings.map((s) => [
        s.numGoalMetrics,
        s.numGuardrailMetrics,
      ]),
    ).toEqual([
      [1, 2],
      [1, 2],
    ]);
    expect(
      result.analyses.map((a) => [
        a.settings.numGoalMetrics,
        a.settings.numGuardrailMetrics,
      ]),
    ).toEqual([
      [0, 0],
      [0, 0],
    ]);
  });
});
