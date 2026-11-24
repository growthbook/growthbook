import cloneDeep from "lodash/cloneDeep";
import omit from "lodash/omit";
import type { ExperimentInterface } from "shared/types/experiment";
import type { DataSourceInterface } from "shared/types/datasource";
import type {
  ExperimentSnapshotAnalysis,
  ExperimentSnapshotAnalysisSettings,
  ExperimentSnapshotInterface,
  ExperimentSnapshotSettings,
  MetricForSnapshot,
  SnapshotMetric,
  SnapshotQueryRunnerKind,
} from "shared/types/experiment-snapshot";
import type { ExperimentReportResultDimension } from "shared/types/report";
import type { QueryInterface } from "shared/types/query";
import type { ExperimentMetricInterface } from "shared/experiments";
import {
  getComputableNewMetricIds,
  getDefinitionMetricId,
  getResultsDateEnd,
  MAX_NEW_METRICS_UPDATES_IN_A_ROW,
} from "shared/experiments";
import { DEFAULT_SEQUENTIAL_TESTING_TUNING_PARAMETER } from "shared/constants";
import { calculatePowerScalingFactor } from "shared/enterprise";
import type { ReqContext } from "back-end/types/request";
import {
  getSnapshotSettings,
  type PlannedExperimentSnapshot,
} from "back-end/src/services/experiments";
import type { FactTableMap } from "back-end/src/models/FactTableModel";
import type { SourceIntegrationInterface } from "back-end/src/types/Integration";
import type { QueryMap } from "back-end/src/queryRunners/QueryRunner";
import {
  analyzeNewMetricsUpdate,
  mergeNewMetricsUpdateAnalyses,
} from "back-end/src/services/experimentResults/compute/analyzeSnapshot";
import { getNewMetricsUpdateQueryStatus } from "back-end/src/services/experimentResults/query/newMetricsUpdateQueries";
import {
  COPIED_RESULTS_SETTING_RULES,
  getChangedCopiedResultsSettings,
  getNewMetricsUpdateLineage,
  mergeNewMetricsUpdateSettings,
  assertIncrementalTablesMatchParent,
  planNewMetricsUpdate,
} from "back-end/src/services/experimentResults/plan/newMetricsUpdate";
import {
  getQueriesWithChangedSql,
  type GenerateResultQuerySql,
} from "back-end/src/services/experimentResults/plan/newMetricsUpdateSqlIdentity";
import { ExperimentResultsQueryRunner } from "back-end/src/queryRunners/ExperimentResultsQueryRunner";
import { ExperimentIncrementalRefreshQueryRunner } from "back-end/src/queryRunners/ExperimentIncrementalRefreshQueryRunner";
import { isCarriedNewMetricsUpdateQuery } from "back-end/src/queryRunners/experimentQueryNaming";
import {
  findLatestSuccessfulOverallSnapshot,
  findNewMetricsUpdateAncestor,
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
import { getMetricSettingsHashesForIncrementalRefresh } from "back-end/src/enterprise/services/data-pipeline";
import {
  ExperimentIncrementalPipelineRequiresFullRefreshError,
  NewMetricsUpdateUnavailableError,
  MetricsAlreadyUpToDateError,
  SnapshotInProgressError,
} from "back-end/src/util/errors";
import { snapshotFactory } from "../factories/Snapshot.factory";
import { factMetricFactory } from "../factories/FactMetric.factory";
import { factTableFactory } from "../factories/FactTable.factory";

jest.mock("back-end/src/models/ExperimentSnapshotModel", () => ({
  findLatestSuccessfulOverallSnapshot: jest.fn(),
  findNewMetricsUpdateAncestor: jest.fn(),
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
const findAncestorMock = jest.mocked(findNewMetricsUpdateAncestor);

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
  numGuardrailMetrics: 0,
  // Bayesian analyses record that no correction applies.
  pValueCorrection: null,
} as unknown as ExperimentSnapshotAnalysisSettings;

function makeExperiment(
  overrides: Partial<ExperimentInterface> = {},
): ExperimentInterface {
  return {
    id: "exp_1",
    type: "standard",
    exposureQueryId: "eq_1",
    variations: [],
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
      metricSettings: metricSettingsFor(metricIds, {}),
      ...overrides,
    },
  }).settings;
}

// The computed settings the stats engine reads.
const statsEnginePriors = {
  properPrior: false,
  properPriorMean: 0,
  properPriorStdDev: 0.3,
  targetMDE: 0.1,
};

// Entries with only the computed settings a test reads.
function metricSettingsFor(
  metricIds: string[],
  computedSettings: object,
): ExperimentSnapshotSettings["metricSettings"] {
  return metricIds.map((id) => ({
    id,
    computedSettings: { ...statsEnginePriors, ...computedSettings },
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
  overrides: Partial<Parameters<typeof planNewMetricsUpdate>[0]> = {},
): Parameters<typeof planNewMetricsUpdate>[0] {
  return {
    context,
    experiment: makeExperiment(),
    datasource,
    phase: 0,
    dimension: undefined,
    useCache: true,
    metricGroups: [],
    statsEngine: "bayesian",
    pValueThreshold: 0.05,
    metricMap: new Map(),
    factTableMap: new Map(),
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

describe("planNewMetricsUpdate", () => {
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
    const plan = await planNewMetricsUpdate(args);

    expect(args.planSnapshotAt).toHaveBeenCalledWith(PARENT_END);
    expect(plan.snapshot.updateScope).toEqual({
      kind: "new_metrics",
      parentSnapshotId: "snp_parent",
      queriedMetricIds: ["met_c"],
      updatesInARow: 1,
      base: {
        dateCreated: PARENT_CREATED,
        runStarted: null,
        cutoffDate: PARENT_END,
      },
    });
    expect(plan.snapshot.settings.metricSettings).toEqual([
      ...metricSettingsFor(["met_a", "met_b"], {}),
      ...metricSettingsFor(["met_c"], { planned: true }),
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
      updateScope: {
        kind: "new_metrics" as const,
        parentSnapshotId,
        queriedMetricIds: metricIds,
        base: {
          dateCreated: PARENT_CREATED,
          runStarted: null,
          cutoffDate: PARENT_END,
        },
      },
      ...overrides,
    });

  type Rejection = {
    name: string;
    setup: () => Partial<Parameters<typeof planNewMetricsUpdate>[0]> | void;
    expected: { type: new (...args: never[]) => Error; details?: object };
  };
  const unavailable = (reason: string) => ({
    type: NewMetricsUpdateUnavailableError,
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
        experiment: makeExperiment({
          phases: [
            { dateStarted: PARENT_START, dateEnded: PARENT_END },
          ] as ExperimentInterface["phases"],
        }),
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
        details: { latestSnapshotId: "snp_parent" },
      },
    },
    {
      name: "nothing missing while another update runs",
      setup: () => {
        latestStatusMock.mockResolvedValue({
          id: "snp_running",
          status: "running",
        } as Awaited<ReturnType<typeof getLatestSnapshotStatus>>);
        return {
          experiment: makeExperiment({ goalMetrics: ["met_a", "met_b"] }),
        };
      },
      expected: {
        type: MetricsAlreadyUpToDateError,
        details: { latestSnapshotId: "snp_parent" },
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
      name: "an Incremental Pipeline parent whose tables a later run rebuilt",
      setup: () => {
        findParentMock.mockResolvedValue(
          makeParent({ runnerKind: "incremental-update" }),
        );
        pipelineStateMock.mockResolvedValue({
          unitsTableFullName: "t_units",
          unitsMaxTimestamp: PARENT_END,
          materializedBySnapshotId: "snp_later",
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
      name: "another Outdated reason beside the added metrics",
      setup: () => ({ statsEngine: "frequentist" }),
      expected: unavailable("settings_changed"),
    },
    {
      name: "CUPED turned on while a copied metric does not opt out",
      setup: () => {
        jest.mocked(orgHasPremiumFeature).mockReturnValue(true);
        return {
          experiment: makeExperiment({ regressionAdjustmentEnabled: true }),
        };
      },
      expected: unavailable("settings_changed"),
    },
    {
      name: "a changed setting with a rule that refuses",
      setup: () => ({
        planSnapshotAt: async () =>
          makePlan({ settings: { datasourceId: "ds_2" } }),
      }),
      expected: unavailable("settings_changed"),
    },
    {
      name: "a query-only setting on the Incremental Pipeline",
      setup: () => {
        findParentMock.mockResolvedValue(
          makeParent({ runnerKind: "incremental-update" }),
        );
        return {
          planSnapshotAt: async () =>
            makePlan({
              runnerKind: "incremental-update",
              settings: { customFields: { team: "growth" } },
            }),
        };
      },
      expected: unavailable("settings_changed"),
    },
    {
      name: "a missing metric the plan cannot compute",
      setup: () => ({
        planSnapshotAt: async () => makePlan({ metricIds: ["met_a", "met_b"] }),
      }),
      expected: {
        type: MetricsAlreadyUpToDateError,
        details: { latestSnapshotId: "snp_parent" },
      },
    },
  ])("rejects $name", async ({ setup, expected }) => {
    const overrides = setup() ?? {};
    const promise = planNewMetricsUpdate(refreshArgs(overrides));
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

      await expect(planNewMetricsUpdate(args)).rejects.toMatchObject({
        details: { reason: "base_incomplete" },
      });
      expect(args.planSnapshotAt).not.toHaveBeenCalled();
    },
  );

  it("accepts a parent whose only failed query is its own units table drop, which it does not copy", async () => {
    findParentMock.mockResolvedValue(
      makeParent({
        queries: [
          { name: "group_0", query: "qry_group", status: "succeeded" },
          { name: "drop_snp_parent", query: "qry_failed", status: "failed" },
        ],
      }),
    );

    const plan = await planNewMetricsUpdate(refreshArgs());

    expect(plan.snapshot.updateScope?.queriedMetricIds).toEqual(["met_c"]);
  });

  describe("a metric the parent computed that is no longer on the experiment", () => {
    // met_gone shared the parent's query with the metrics still copied.
    const planWithRemovedMetric = (storedGroupSql: string) => {
      findParentMock.mockResolvedValue(
        makeParent({ settings: makeSettings(["met_a", "met_gone", "met_b"]) }),
      );
      storeQueries({ qry_group: storedGroupSql });
      const args = refreshArgs();
      return { args, promise: planNewMetricsUpdate(args) };
    };

    it("queries only the new metric, compares the shared query regenerated with the parent's entry for it, and drops it", async () => {
      const { args, promise } = planWithRemovedMetric(
        groupSql(["met_a", "met_gone", "met_b"], 0),
      );
      const plan = await promise;

      expect(plan.snapshot.updateScope?.queriedMetricIds).toEqual(["met_c"]);
      expect(plan.snapshot.settings.metricSettings.map((m) => m.id)).toEqual([
        "met_a",
        "met_b",
        "met_c",
      ]);
      expect(args.generateResultQuerySql).toHaveBeenCalledWith(
        expect.objectContaining({
          settings: expect.objectContaining({
            metricSettings: [
              ...metricSettingsFor(["met_a"], { planned: true }),
              ...metricSettingsFor(["met_gone"], {}),
              ...metricSettingsFor(["met_b"], { planned: true }),
            ],
          }),
        }),
      );
    });

    it("refuses as changed settings when the shared query no longer matches", async () => {
      await expect(
        planWithRemovedMetric(
          `${groupSql(["met_a", "met_gone", "met_b"], 0)} WHERE x`,
        ).promise,
      ).rejects.toMatchObject({ details: { reason: "settings_changed" } });
    });
  });

  // The first update on the Incremental Pipeline is a Full Refresh.
  it("plans an incremental update after an incremental-full parent", async () => {
    findParentMock.mockResolvedValue(
      makeParent({ runnerKind: "incremental-full" }),
    );
    const plan = await planNewMetricsUpdate(
      refreshArgs({
        planSnapshotAt: async () =>
          makePlan({ runnerKind: "incremental-update" }),
      }),
    );
    expect(plan.snapshot.runnerKind).toBe("incremental-update");
    expect(plan.snapshot.updateScope?.queriedMetricIds).toEqual(["met_c"]);
  });

  describe("on the Incremental Pipeline, the documents of the queries it would copy", () => {
    const planIncremental = (
      docs: Record<string, QueryInterface["status"]>,
    ) => {
      findParentMock.mockResolvedValue(
        makeParent({
          runnerKind: "incremental-update",
          queries: [
            {
              name: "statistics_ft_a_g0",
              query: "qry_stats",
              status: "succeeded",
            },
            { name: "traffic", query: "qry_traffic", status: "succeeded" },
          ],
        }),
      );
      getQueriesByIdsMock.mockImplementation(async (ctx, ids) =>
        ids
          .filter((id) => id in docs)
          .map((id) => ({ id, status: docs[id] }) as QueryInterface),
      );
      return planNewMetricsUpdate(
        refreshArgs({
          planSnapshotAt: async () =>
            makePlan({ runnerKind: "incremental-update" }),
        }),
      );
    };

    it.each<[string, Record<string, QueryInterface["status"]>]>([
      ["is gone", { qry_traffic: "succeeded" }],
      [
        "no longer succeeded",
        { qry_stats: "failed", qry_traffic: "succeeded" },
      ],
    ])(
      "refuse as an incomplete base when one %s, instead of failing at runner start",
      async (name, docs) => {
        await expect(planIncremental(docs)).rejects.toMatchObject({
          details: { reason: "base_incomplete" },
        });
        expect(getQueriesByIdsMock).toHaveBeenCalledWith(
          context,
          ["qry_stats", "qry_traffic"],
          false,
        );
      },
    );

    it("plan when every one is there", async () => {
      const plan = await planIncremental({
        qry_stats: "succeeded",
        qry_traffic: "succeeded",
      });

      expect(plan.snapshot.runnerKind).toBe("incremental-update");
      expect(plan.snapshot.updateScope?.queriedMetricIds).toEqual(["met_c"]);
    });
  });

  describe("a copied metric edited since the parent", () => {
    const orders = factTableFactory.build({
      id: "ft_orders",
      sql: "SELECT user_id, timestamp, amount FROM orders",
      userIdTypes: ["user_id"],
    });
    const factTableMap = new Map([[orders.id, orders]]);
    const factMetric = (id: string, column = "amount") =>
      factMetricFactory.build({
        id,
        metricType: "mean",
        numerator: { factTableId: orders.id, column, rowFilters: [] },
      });
    const asBuilt = ["met_a", "met_b", "met_c"].map((id) => factMetric(id));
    const withEditedMetA = [
      factMetric("met_a", "$$count"),
      ...asBuilt.slice(1),
    ];

    // The parent's caches, with each metric's hash as the parent stored it.
    const storedHashes = getMetricSettingsHashesForIncrementalRefresh({
      factMetrics: asBuilt,
      factTableMap,
      snapshotSettings: makePlan({ runnerKind: "incremental-update" }).snapshot
        .settings,
    });

    const planWith = (
      runnerKind: "results" | "incremental-update",
      todaysMetrics: typeof asBuilt,
    ) => {
      findParentMock.mockResolvedValue(makeParent({ runnerKind }));
      pipelineStateMock.mockResolvedValue({
        unitsTableFullName: "t_units",
        unitsMaxTimestamp: PARENT_END,
        materializedBySnapshotId: "snp_parent",
        metricSources: [
          {
            groupId: "ft_orders_0",
            factTableId: orders.id,
            metrics: ["met_a", "met_b"].map((id) => ({
              id,
              settingsHash: storedHashes.get(id),
            })),
            maxTimestamp: PARENT_END,
            tableFullName: "t_orders",
          },
        ],
      });
      const edited = todaysMetrics !== asBuilt;
      const args = refreshArgs({
        metricMap: new Map(todaysMetrics.map((m) => [m.id, m])),
        factTableMap,
        planSnapshotAt: async () => makePlan({ runnerKind }),
        // Today's SQL for the copied group reflects the edit.
        generateResultQuerySql: jest.fn(async () =>
          edited
            ? new Map([["group_0", `${groupSql(["met_a", "met_b"], 0)} -- n`]])
            : storedSqlGenerator({
                settings: makeSettings(["met_a", "met_b"]),
                queryParentId: "snp_parent",
              }),
        ),
      });
      return { args, promise: planNewMetricsUpdate(args) };
    };

    it.each(["results", "incremental-update"] as const)(
      "refuses as changed settings on the %s pipeline",
      async (runnerKind) => {
        const { promise } = planWith(runnerKind, withEditedMetA);

        await expect(promise).rejects.toBeInstanceOf(
          NewMetricsUpdateUnavailableError,
        );
        await expect(promise).rejects.toMatchObject({
          details: { reason: "settings_changed" },
        });
      },
    );

    it("on the Incremental Pipeline, compares the stored settings hash rather than the SQL", async () => {
      const { args, promise } = planWith("incremental-update", withEditedMetA);

      await expect(promise).rejects.toMatchObject({
        details: { reason: "settings_changed" },
      });
      expect(args.generateResultQuerySql).not.toHaveBeenCalled();
    });

    it("on the Incremental Pipeline, accepts copied metrics whose caches match today's settings", async () => {
      await expect(
        planWith("incremental-update", asBuilt).promise,
      ).resolves.toMatchObject({
        snapshot: { updateScope: { queriedMetricIds: ["met_c"] } },
      });
    });
  });

  // The stats engine reads these, but neither the SQL nor the Incremental
  // Pipeline's settings hash covers them.
  describe("a copied metric whose stats engine inputs changed since the parent", () => {
    const planWithMetA = (
      runnerKind: "results" | "incremental-update",
      edit: {
        computedSettings?: Partial<typeof statsEnginePriors>;
        settings?: Partial<ExperimentSnapshotSettings>;
      },
    ) => {
      findParentMock.mockResolvedValue(makeParent({ runnerKind }));
      const planned = makePlan({ runnerKind, settings: edit.settings });
      planned.snapshot.settings.metricSettings =
        planned.snapshot.settings.metricSettings.map((entry) =>
          entry.id === "met_a"
            ? {
                ...entry,
                computedSettings: {
                  ...entry.computedSettings,
                  ...edit.computedSettings,
                } as MetricForSnapshot["computedSettings"],
              }
            : entry,
        );
      const args = refreshArgs({ planSnapshotAt: async () => planned });
      return { args, promise: planNewMetricsUpdate(args) };
    };

    it.each<{
      name: string;
      computedSettings?: Partial<typeof statsEnginePriors>;
      settings?: Partial<ExperimentSnapshotSettings>;
    }>([
      {
        name: "its prior",
        computedSettings: { properPrior: true, properPriorMean: 0.2 },
      },
      { name: "its target MDE", computedSettings: { targetMDE: 0.05 } },
      {
        name: "its goal, secondary or guardrail type",
        settings: {
          goalMetrics: ["met_b", "met_c"],
          secondaryMetrics: ["met_a"],
        },
      },
    ])(
      "refuses as changed settings after an edit to $name, on either pipeline, before comparing the SQL",
      async (edit) => {
        for (const runnerKind of ["results", "incremental-update"] as const) {
          const { args, promise } = planWithMetA(runnerKind, edit);

          await expect(promise).rejects.toMatchObject({
            details: { reason: "settings_changed" },
          });
          expect(args.generateResultQuerySql).not.toHaveBeenCalled();
        }
      },
    );

    // Its per-metric priors are compared instead; the default reaches the
    // stats engine through nothing else.
    it("plans it after a change to the organization's default prior alone, on either pipeline", async () => {
      for (const runnerKind of ["results", "incremental-update"] as const) {
        findParentMock.mockResolvedValue(
          makeParent({
            runnerKind,
            settings: makeSettings(["met_a", "met_b"], {
              defaultMetricPriorSettings: {
                override: false,
                proper: true,
                mean: 0,
                stddev: 0.444,
              },
            }),
          }),
        );
        const planned = makePlan({
          runnerKind,
          settings: {
            defaultMetricPriorSettings: {
              override: false,
              proper: true,
              mean: 0,
              stddev: 0.3,
            },
          },
        });

        await expect(
          planNewMetricsUpdate(
            refreshArgs({ planSnapshotAt: async () => planned }),
          ),
        ).resolves.toMatchObject({
          snapshot: { updateScope: { queriedMetricIds: ["met_c"] } },
        });
      }
    });

    // A snapshot planned before priors were stored loads with computed
    // settings that lack them, so what its stats engine read is unknown.
    it("refuses as changed settings when the parent's computed settings lack priors", async () => {
      const settings = makeSettings(["met_a", "met_b"], {
        metricSettings: metricSettingsFor(["met_a", "met_b"], {
          properPrior: undefined,
          properPriorMean: undefined,
          properPriorStdDev: undefined,
        }),
      });
      findParentMock.mockResolvedValue(makeParent({ settings }));

      await expect(planNewMetricsUpdate(refreshArgs())).rejects.toMatchObject({
        details: { reason: "settings_changed" },
      });
    });

    it("refuses as changed settings when the parent stored no computed settings for a copied metric", async () => {
      const settings = makeSettings(["met_a", "met_b"], {
        metricSettings: [{ id: "met_a" }, { id: "met_b" }],
      });
      findParentMock.mockResolvedValue(makeParent({ settings }));

      await expect(planNewMetricsUpdate(refreshArgs())).rejects.toMatchObject({
        details: { reason: "settings_changed" },
      });
    });
  });

  describe("comparing the SQL it would copy", () => {
    it("refuses as changed settings when today's SQL can't be generated, and logs why", async () => {
      const error = new Error("Unknown exposure query: user_id");
      const promise = planNewMetricsUpdate(
        refreshArgs({
          generateResultQuerySql: jest.fn().mockRejectedValue(error),
        }),
      );

      await expect(promise).rejects.toMatchObject({
        details: { reason: "settings_changed" },
      });
      expect(context.logger.warn).toHaveBeenCalledWith(
        error,
        "Could not regenerate the SQL a new-metrics update would copy",
      );
    });

    it("checks a new-metrics update of a new-metrics update against each run's own groups, numbered after the earlier runs", async () => {
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
        return planNewMetricsUpdate(
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
        snapshot: { updateScope: { queriedMetricIds: ["met_c"] } },
      });
      await expect(
        plan(`${groupSql(["met_b"], 1)} WHERE x`),
      ).rejects.toMatchObject({ details: { reason: "settings_changed" } });
    });

    // snp_u0 is a full update of met_0; each snp_uN since added met_N. None
    // stores its count, as before it was stored, so the planner walks the
    // chain.
    const planOnChainOf = (updatesInARow: number) => {
      const metricIds = (through: number) =>
        Array.from({ length: through + 1 }, (_, i) => `met_${i}`);
      findAncestorMock.mockImplementation(async (ctx, id) => {
        const n = Number(id.replace("snp_u", ""));
        const settings = makeSettings(metricIds(n));
        return n === 0
          ? makeParent({ id, settings })
          : refreshOf(id, `snp_u${n - 1}`, [`met_${n}`], { settings });
      });
      findParentMock.mockResolvedValue(
        refreshOf(
          `snp_u${updatesInARow}`,
          `snp_u${updatesInARow - 1}`,
          [`met_${updatesInARow}`],
          {
            settings: makeSettings(metricIds(updatesInARow)),
            queries: metricIds(updatesInARow).map((id, i) => ({
              name: `group_${i}`,
              query: `qry_group_${i}`,
              status: "succeeded",
            })),
          },
        ),
      );
      storeQueries(
        Object.fromEntries(
          metricIds(updatesInARow).map((id, i) => [
            `qry_group_${i}`,
            groupSql([id], i),
          ]),
        ),
      );
      const goalMetrics = [...metricIds(updatesInARow), "met_new"];
      return planNewMetricsUpdate(
        refreshArgs({
          experiment: makeExperiment({ goalMetrics }),
          planSnapshotAt: async () => makePlan({ metricIds: goalMetrics }),
        }),
      );
    };

    it(`plans the ${MAX_NEW_METRICS_UPDATES_IN_A_ROW}th update of newly added metrics in a row`, async () => {
      await expect(
        planOnChainOf(MAX_NEW_METRICS_UPDATES_IN_A_ROW - 1),
      ).resolves.toMatchObject({
        snapshot: { updateScope: { queriedMetricIds: ["met_new"] } },
      });
    });

    it(`refuses after ${MAX_NEW_METRICS_UPDATES_IN_A_ROW} updates of newly added metrics in a row, and says how many`, async () => {
      await expect(
        planOnChainOf(MAX_NEW_METRICS_UPDATES_IN_A_ROW),
      ).rejects.toMatchObject({
        details: { reason: "base_incomplete" },
        message: expect.stringContaining(
          `from ${MAX_NEW_METRICS_UPDATES_IN_A_ROW} updates of newly added metrics in a row`,
        ),
      });
    });

    // A parent's stored count decides it before any ancestor is loaded.
    describe("a parent that stores its count", () => {
      const planOnCountedParent = (
        updatesInARow: number,
        runnerKind: "results" | "incremental-update" = "results",
      ) => {
        findParentMock.mockResolvedValue(
          refreshOf("snp_parent", "snp_before", ["met_b"], {
            runnerKind,
            updateScope: {
              ...refreshOf("snp_parent", "snp_before", ["met_b"]).updateScope!,
              updatesInARow,
            },
          }),
        );
        // Walking would find a short chain.
        findAncestorMock.mockResolvedValue(makeParent({ id: "snp_before" }));
        const args = refreshArgs({
          planSnapshotAt: async () => makePlan({ runnerKind }),
        });
        return { args, promise: planNewMetricsUpdate(args) };
      };

      it(`plans the ${MAX_NEW_METRICS_UPDATES_IN_A_ROW}th and stores its count`, async () => {
        await expect(
          planOnCountedParent(MAX_NEW_METRICS_UPDATES_IN_A_ROW - 1).promise,
        ).resolves.toMatchObject({
          snapshot: {
            updateScope: {
              queriedMetricIds: ["met_c"],
              updatesInARow: MAX_NEW_METRICS_UPDATES_IN_A_ROW,
            },
          },
        });
      });

      it(`refuses after ${MAX_NEW_METRICS_UPDATES_IN_A_ROW} with the same message, before comparing the SQL`, async () => {
        const { args, promise } = planOnCountedParent(
          MAX_NEW_METRICS_UPDATES_IN_A_ROW,
        );

        await expect(promise).rejects.toMatchObject({
          details: { reason: "base_incomplete" },
          message: expect.stringContaining(
            `from ${MAX_NEW_METRICS_UPDATES_IN_A_ROW} updates of newly added metrics in a row`,
          ),
        });
        expect(findAncestorMock).not.toHaveBeenCalled();
        expect(args.generateResultQuerySql).not.toHaveBeenCalled();
      });

      // Its updates copy cache tables, not a chain of queries to replay.
      it("plans any number in a row on the Incremental Pipeline", async () => {
        await expect(
          planOnCountedParent(
            MAX_NEW_METRICS_UPDATES_IN_A_ROW + 5,
            "incremental-update",
          ).promise,
        ).resolves.toMatchObject({
          snapshot: {
            runnerKind: "incremental-update",
            updateScope: {
              updatesInARow: MAX_NEW_METRICS_UPDATES_IN_A_ROW + 6,
            },
          },
        });
      });
    });

    describe("a parent without a cutoff, whose SQL read the clock it was planned at", () => {
      const planWith = ({
        skipPartialData,
        plannedAt,
      }: {
        skipPartialData: boolean;
        plannedAt?: Date;
      }) => {
        findParentMock.mockResolvedValue(
          makeParent({
            settings: makeSettings(["met_a", "met_b"], {
              endDateIsCutoff: false,
              skipPartialData,
              ...(plannedAt ? { plannedAt } : {}),
            }),
          }),
        );
        const args = refreshArgs({
          experiment: makeExperiment({ skipPartialData }),
          planSnapshotAt: async () =>
            makePlan({
              settings: { skipPartialData, plannedAt: new Date() },
            }),
        });
        return {
          args,
          promise: planNewMetricsUpdate(args),
        };
      };

      it("regenerates its SQL with its own stored clock", async () => {
        const { args, promise } = planWith({
          skipPartialData: true,
          plannedAt: PARENT_END,
        });

        await expect(promise).resolves.toMatchObject({
          snapshot: { updateScope: { queriedMetricIds: ["met_c"] } },
        });
        expect(args.generateResultQuerySql).toHaveBeenCalledWith(
          expect.objectContaining({
            settings: expect.objectContaining({
              endDateIsCutoff: false,
              plannedAt: PARENT_END,
            }),
          }),
        );
      });

      it("refuses as changed settings when it was planned before the clock was stored", async () => {
        const { args, promise } = planWith({ skipPartialData: true });

        await expect(promise).rejects.toMatchObject({
          details: { reason: "settings_changed" },
        });
        expect(args.generateResultQuerySql).not.toHaveBeenCalled();
      });

      it("still compares one planned before the clock was stored without skipPartialData, whose SQL never read it", async () => {
        await expect(
          planWith({ skipPartialData: false }).promise,
        ).resolves.toMatchObject({
          snapshot: { updateScope: { queriedMetricIds: ["met_c"] } },
        });
      });
    });
  });
});

describe("getQueriesWithChangedSql", () => {
  const stored = new Map([
    ["group_0", "-- Revenue\nSELECT 1\n  -- Fact Table: Orders\nFROM t"],
    ["traffic", "SELECT 2"],
  ]);
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
        todaysSql: new Map(Object.entries(today)),
      }),
    ).toEqual(expected);
  });
});

describe("assertIncrementalTablesMatchParent", () => {
  type State = NonNullable<
    Parameters<typeof assertIncrementalTablesMatchParent>[0]["state"]
  >;
  const state = (overrides: Partial<State> = {}): State => ({
    unitsTableFullName: "t_units",
    materializedBySnapshotId: "snp_parent",
    ...overrides,
  });
  const parse = (s: State | null) => () =>
    assertIncrementalTablesMatchParent({
      state: s,
      parentSnapshotId: "snp_parent",
    });

  it("accepts the state the parent left", () => {
    expect(parse(state())).not.toThrow();
  });

  it.each<[string, State | null]>([
    ["no pipeline state", null],
    ["no units table", state({ unitsTableFullName: null })],
    [
      "tables a later run succeeded on",
      state({ materializedBySnapshotId: "snp_later" }),
    ],
  ])("rejects %s", (name, s) => {
    expect(parse(s)).toThrow(
      expect.objectContaining({ details: { reason: "incremental_pipeline" } }),
    );
  });
});

describe("mergeNewMetricsUpdateSettings", () => {
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

    const { settings, queriedMetricIds } = mergeNewMetricsUpdateSettings({
      parent,
      planned,
      targetMetricIds: ["met_c", "met_d"],
    });

    expect(
      settings.metricSettings.map(({ id, computedSettings }) => ({
        id,
        planned: "planned" in (computedSettings ?? {}),
      })),
    ).toEqual([
      { id: "met_a", planned: false },
      { id: "met_b", planned: false },
      { id: "met_c", planned: true },
      { id: "met_c?dim:country=US", planned: true },
    ]);
    expect(settings.clusterLevelMetricIds).toEqual(["met_a", "met_c"]);
    expect(queriedMetricIds).toEqual(["met_c"]);
  });
});

describe("getChangedCopiedResultsSettings", () => {
  const parent = (runnerKind: SnapshotQueryRunnerKind = "results") => ({
    runnerKind,
    settings: makeSettings(["met_a"], { plannedAt: PARENT_CREATED }),
  });

  // The settings type has no runtime schema, so the planner's output stands in
  // for one.
  const plannedSettingKeys = (experiment: Partial<ExperimentInterface>) =>
    Object.keys(
      getSnapshotSettings({
        experiment: makeExperiment({
          variations: [{ key: "0" }, { key: "1" }],
          phases: [{ dateStarted: PARENT_START, variationWeights: [0.5, 0.5] }],
          ...experiment,
        } as Partial<ExperimentInterface>),
        phaseIndex: 0,
        snapshotType: "standard",
        dimension: null,
        regressionAdjustmentEnabled: false,
        orgPriorSettings: undefined,
        orgDisabledPrecomputedDimensions: true,
        settingsForSnapshotMetrics: [],
        metricMap: new Map(),
        factTableMap: new Map(),
        metricGroups: [],
        incrementalRefreshModel: null,
        cutoff: PARENT_END,
      }),
    );

  it.each<{ name: string; experiment: Partial<ExperimentInterface> }>([
    { name: "a standard experiment", experiment: {} },
    { name: "a Bandit", experiment: { type: "multi-armed-bandit" } },
    {
      name: "a cluster experiment with custom fields and a lookback",
      experiment: {
        isClusterExperiment: true,
        clusterSubUnitIdentifier: "user_id",
        customFields: { team: "growth" },
        lookbackOverride: { type: "window", value: 7, valueUnit: "days" },
      },
    },
  ])("has a rule for every setting planned for $name", ({ experiment }) => {
    const unruled = plannedSettingKeys(experiment).filter(
      (key) => !(key in COPIED_RESULTS_SETTING_RULES),
    );
    expect(unruled).toEqual([]);
  });

  const NOW_LATER = new Date(PARENT_CREATED.getTime() + 60_000);

  it("refuses a changed setting that has no rule", () => {
    const planned = {
      ...makeSettings(["met_a"], { plannedAt: NOW_LATER }),
      newSetting: "on",
    } as ExperimentSnapshotSettings;

    expect(getChangedCopiedResultsSettings(parent(), planned)).toEqual([
      "newSetting",
    ]);
  });

  it("refuses a change the Outdated badge also reports", () => {
    const planned = makeSettings(["met_a"], { segment: "seg_1" });

    expect(getChangedCopiedResultsSettings(parent(), planned)).toEqual([
      "segment",
    ]);
  });

  it("ignores the planning clock, the cutoff flag and the metric lists", () => {
    const planned = makeSettings(["met_a", "met_c"], {
      plannedAt: NOW_LATER,
      endDateIsCutoff: true,
    });

    expect(
      getChangedCopiedResultsSettings(
        {
          runnerKind: "results",
          settings: makeSettings(["met_a"], {
            plannedAt: PARENT_CREATED,
            endDateIsCutoff: false,
          }),
        },
        planned,
      ),
    ).toEqual([]);
  });

  it("leaves query-only settings to a Results parent's SQL comparison", () => {
    const planned = makeSettings(["met_a"], {
      customFields: { team: "growth" },
    });

    expect(getChangedCopiedResultsSettings(parent(), planned)).toEqual([]);
    expect(
      getChangedCopiedResultsSettings(parent("incremental-update"), planned),
    ).toEqual(["customFields"]);
  });
});

describe("getNewMetricsUpdateLineage", () => {
  it("points a new-metrics update of a new-metrics update at the root full run", () => {
    const refresh = makeParent({
      id: "snp_refresh",
      dateCreated: new Date("2026-11-11T00:00:00Z"),
      runStarted: new Date("2026-11-11T00:00:01Z"),
      updateScope: getNewMetricsUpdateLineage(
        makeParent({ runStarted: PARENT_CREATED }),
        ["met_c"],
      ),
    });

    expect(getNewMetricsUpdateLineage(refresh, ["met_d"])).toEqual({
      kind: "new_metrics",
      parentSnapshotId: "snp_refresh",
      queriedMetricIds: ["met_d"],
      base: {
        dateCreated: PARENT_CREATED,
        runStarted: PARENT_CREATED,
        cutoffDate: PARENT_END,
      },
      updatesInARow: 2,
    });
  });

  it("counts the updates in a row, the first after a full update as 1", () => {
    const fromFull = getNewMetricsUpdateLineage(makeParent(), ["met_c"]);
    expect(fromFull.updatesInARow).toBe(1);

    const counted = makeParent({
      updateScope: { ...fromFull, updatesInARow: 7 },
    });
    expect(getNewMetricsUpdateLineage(counted, ["met_d"]).updatesInARow).toBe(
      8,
    );

    // Stored before the count was, so it counts as one.
    const { updatesInARow, ...uncounted } = fromFull;
    expect(updatesInARow).toBe(1);
    expect(
      getNewMetricsUpdateLineage(makeParent({ updateScope: uncounted }), [
        "met_d",
      ]).updatesInARow,
    ).toBe(2);
  });
});

// The results endpoint must report the same dateEnd before and after a
// new-metrics update; its settings.endDate is the analysis end the update
// is pinned to.
describe("dateEnd of a new-metrics update", () => {
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
      updateScope: getNewMetricsUpdateLineage(parent, ["met_c"]),
    });
  }

  it.each([
    {
      name: "a new-metrics update of a base analyzed through its run time",
      endDate: new Date("2026-11-18T22:17:36.208Z"),
      endDateIsCutoff: false,
      refreshes: 1,
    },
    {
      name: "a new-metrics update of a base analyzed through a lagged cutoff",
      endDate: new Date("2026-11-17T21:17:36.208Z"),
      endDateIsCutoff: true,
      refreshes: 1,
    },
    {
      name: "a new-metrics update of a new-metrics update of a lagged base",
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
  const refresh = makeParent({
    settings: makeSettings(["met_a", "met_single"]),
  });

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
    expect(
      isCarriedNewMetricsUpdateQuery(name, refresh, {
        parentSnapshotId: "snp_parent",
      }),
    ).toBe(carried);
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
    expect(
      isCarriedNewMetricsUpdateQuery(
        name,
        makeParent({ runnerKind: "incremental-update" }),
        { parentSnapshotId: "snp_parent" },
      ),
    ).toBe(carried);
  });
});

// One rule on both pipelines: a new-metrics update can't partly succeed,
// except when only the cleanup of a table it no longer needs fails.
describe("new-metrics update status", () => {
  const pipelines = {
    results: {
      queries: ["group_0", "group_1", "met_c"],
      cleanup: "drop_snp_refresh",
    },
    "incremental-update": {
      queries: [
        "statistics_fta_0",
        "traffic",
        "insert_metrics_source_data_ftc_1",
        "statistics_ftc_1",
      ],
      cleanup: null,
    },
  } as const;

  it.each([
    {
      runnerKind: "results",
      run: "a new-metrics update",
      failed: "met_c",
      expected: "failed",
    },
    {
      runnerKind: "results",
      run: "a new-metrics update",
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
      run: "a new-metrics update",
      failed: "insert_metrics_source_data_ftc_1",
      expected: "failed",
    },
    {
      runnerKind: "incremental-update",
      run: "a normal update",
      failed: "insert_metrics_source_data_ftc_1",
      expected: "partially-succeeded",
    },
  ] as const)(
    "on $runnerKind, $run whose $failed query failed is $expected",
    ({ runnerKind, run, failed, expected }) => {
      const { queries, cleanup } = pipelines[runnerKind];
      const failedName = failed === "cleanup" ? cleanup : failed;
      const names = cleanup ? [...queries, cleanup] : queries;
      const snapshot = makeParent({
        id: "snp_refresh",
        runnerKind,
        queries: names.map((name) => ({
          name,
          query: `qry_${name}`,
          status: name === failedName ? "failed" : "succeeded",
        })),
        ...(run === "a new-metrics update"
          ? {
              updateScope: getNewMetricsUpdateLineage(makeParent(), ["met_c"]),
            }
          : {}),
      });

      expect(
        getNewMetricsUpdateQueryStatus(snapshot, "partially-succeeded"),
      ).toBe(expected);
    },
  );
});

describe("a new-metrics update that succeeds on the Incremental Pipeline", () => {
  it("records itself as the tables' builder, so the next new-metrics update builds on it", async () => {
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
      updateScope: getNewMetricsUpdateLineage(root, ["met_c"]),
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

describe("starting a new-metrics update's queries", () => {
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
      updateScope: getNewMetricsUpdateLineage(makeParent(), ["met_c"]),
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

// Result queries and metrics for the metrics a new-metrics update analyzes.
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

const frequentist = {
  statsEngine: "frequentist",
  pValueThreshold: 0.05,
  sequentialTesting: false,
} as const;
const tested = (pValue: number, extra: Partial<SnapshotMetric> = {}) =>
  ({ ...metricResult(pValue), pValue, ...extra }) as SnapshotMetric;
const treatmentDimension = (
  metrics: Record<string, SnapshotMetric>,
  name = "All",
): ExperimentReportResultDimension => ({
  name,
  srm: 0.5,
  variations: [
    { users: 10, metrics: {} },
    { users: 10, metrics },
  ],
});
const treatmentMetrics = (merged: ExperimentSnapshotAnalysis, level = 0) =>
  merged.results[level].variations[1].metrics;

describe("mergeNewMetricsUpdateAnalyses", () => {
  type MergeArgs = Parameters<typeof mergeNewMetricsUpdateAnalyses>[0];
  const merge = (
    analyses: ExperimentSnapshotAnalysis[],
    freshResults: ExperimentReportResultDimension[][],
    overrides: Partial<MergeArgs> = {},
  ) =>
    mergeNewMetricsUpdateAnalyses({
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
      goalMetrics: ["met_a", "met_c"],
      ...overrides,
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

  it("leaves out a metric the parent computed that is no longer analyzed", () => {
    const parent = analysis({}, [
      resultDimension({ met_a: 1, met_gone: 5, met_b: 2 }),
    ]);

    const [merged] = merge([parent], [[resultDimension({ met_c: 3 })]]);

    expect(merged.results).toEqual([
      resultDimension({ met_a: 1, met_b: 2, met_c: 3 }),
    ]);
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

  describe("the values that depend on more than one test", () => {
    describe("with a correction method the parent recorded", () => {
      // met_a and met_b hold the values of a family of two; met_demoted, a goal
      // since moved to secondary, still holds a corrected value; met_s is
      // secondary.
      const parent = (pValueCorrection?: "holm-bonferroni") =>
        analysis({ ...frequentist, pValueCorrection }, [
          treatmentDimension({
            met_a: tested(0.01, { pValueAdjusted: 0.02 }),
            met_b: tested(0.03, { pValueAdjusted: 0.03 }),
            met_demoted: tested(0.02, { pValueAdjusted: 0.04 }),
            met_s: tested(0.02),
          }),
        ]);
      const mergeWithNewGoal = (
        analyses: ExperimentSnapshotAnalysis[],
        analyzed: string[],
      ) =>
        merge(analyses, [[treatmentDimension({ met_c: tested(0.04) })]], {
          analyzedMetricIds: new Set(analyzed),
          goalMetrics: ["met_a", "met_b", "met_c"],
        });

      // Holm-Bonferroni over 0.01, 0.03, 0.04: 3 x 0.01, 2 x 0.03, then
      // max(0.06, 1 x 0.04).
      it("corrects copied and new goal metrics as one family, and no secondary metric", () => {
        const [merged] = mergeWithNewGoal(
          [parent("holm-bonferroni")],
          ["met_a", "met_b", "met_c", "met_s"],
        );

        const metrics = treatmentMetrics(merged);
        expect(metrics.met_a.pValueAdjusted).toBeCloseTo(0.03);
        expect(metrics.met_b.pValueAdjusted).toBeCloseTo(0.06);
        expect(metrics.met_c.pValueAdjusted).toBeCloseTo(0.06);
        expect(metrics.met_s.pValueAdjusted).toBeUndefined();
      });

      // met_demoted is still analyzed and still corrected in the parent's
      // results. With its 0.02 in the family, met_a would get 4 x 0.01.
      it("leaves a goal metric moved to secondary out of the family", () => {
        const [merged] = mergeWithNewGoal(
          [parent("holm-bonferroni")],
          ["met_a", "met_b", "met_c", "met_demoted"],
        );

        const metrics = treatmentMetrics(merged);
        expect(metrics.met_demoted.pValue).toBe(0.02);
        expect(metrics.met_a.pValueAdjusted).toBeCloseTo(0.03);
        expect(metrics.met_b.pValueAdjusted).toBeCloseTo(0.06);
      });

      // The family without CUPED: met_a's unadjusted 0.02 and the others'
      // own 0.03 and 0.04. Holm: 3 x 0.02, then 2 x 0.03.
      it("recomputes a copied goal's corrected value without an adjustment, leaving the parent as it was", () => {
        const withCupedUnadjusted = analysis(
          { ...frequentist, pValueCorrection: "holm-bonferroni" },
          [
            treatmentDimension({
              met_a: tested(0.01, {
                pValueAdjusted: 0.02,
                supplementalResults: {
                  cupedUnadjusted: tested(0.02, { pValueAdjusted: 0.04 }),
                },
              }),
              met_b: tested(0.03, { pValueAdjusted: 0.03 }),
            }),
          ],
        );
        const before = cloneDeep(withCupedUnadjusted);

        const [merged] = mergeWithNewGoal(
          [withCupedUnadjusted],
          ["met_a", "met_b", "met_c"],
        );

        expect(
          treatmentMetrics(merged).met_a.supplementalResults?.cupedUnadjusted
            ?.pValueAdjusted,
        ).toBeCloseTo(0.06);
        expect(withCupedUnadjusted).toEqual(before);
      });

      // One family across the levels: US met_a 0.01, US met_c 0.04, FR met_c
      // 0.015. Holm: 3 x 0.01, 2 x 0.015, then 1 x 0.04.
      it("corrects every dimension level as one family, including a level only this run returned", () => {
        const byCountry = analysis(
          {
            ...frequentist,
            pValueCorrection: "holm-bonferroni",
            dimensions: ["dim:country"],
          },
          [treatmentDimension({ met_a: tested(0.01) }, "US")],
        );

        const [merged] = merge(
          [byCountry],
          [
            [
              treatmentDimension({ met_c: tested(0.04) }, "US"),
              treatmentDimension({ met_c: tested(0.015) }, "FR"),
            ],
          ],
        );

        expect(
          merged.results.map((level, i) => ({
            level: level.name,
            met_a: treatmentMetrics(merged, i).met_a?.pValueAdjusted,
            met_c: treatmentMetrics(merged, i).met_c.pValueAdjusted,
          })),
        ).toEqual([
          {
            level: "US",
            met_a: expect.closeTo(0.03),
            met_c: expect.closeTo(0.04),
          },
          { level: "FR", met_a: undefined, met_c: expect.closeTo(0.03) },
        ]);
      });

      it("stores no correction for a parent that recorded no method, which is corrected when read", () => {
        const [merged] = mergeWithNewGoal(
          [parent()],
          ["met_a", "met_b", "met_c"],
        );

        expect(merged.settings.pValueCorrection).toBeUndefined();
        expect(treatmentMetrics(merged).met_c.pValueAdjusted).toBeUndefined();
      });
    });

    // The copy was scaled for one goal; the update ends with three.
    it("scales copied and new metrics' power for the goal metrics the update ends with, and keeps a copy's other numbers", () => {
      const inputs = {
        status: "successful",
        firstPeriodPairwiseSampleSize: 1000,
        sigmahat2Delta: 0.01,
        targetMDE: 0.1,
      };
      const powerSettings = (numGoalMetrics: number) => ({
        alpha: 0.05,
        numGoalMetrics,
        sequential: false,
        sequentialTuningParameter: DEFAULT_SEQUENTIAL_TESTING_TUNING_PARAMETER,
      });
      const copied = tested(0.2, {
        ci: [-0.1, 0.3],
        expected: 0.1,
        stats: { users: 10, count: 10, mean: 1, stddev: 1 },
        power: {
          ...inputs,
          ...calculatePowerScalingFactor(inputs, powerSettings(1)),
        },
      });
      const parent = analysis(
        { ...frequentist, pValueCorrection: null, numGoalMetrics: 1 },
        [treatmentDimension({ met_a: copied })],
      );
      const before = cloneDeep(parent);

      const [merged] = merge(
        [parent],
        [[treatmentDimension({ met_c: tested(0.3, { power: inputs }) })]],
        { goalMetrics: ["met_a", "met_c", "met_d"] },
      );

      const { met_a, met_c } = treatmentMetrics(merged);
      const expected = calculatePowerScalingFactor(inputs, powerSettings(3));
      expect(met_a.power?.scalingFactor).toBe(expected?.scalingFactor);
      expect(met_c.power?.scalingFactor).toBe(expected?.scalingFactor);
      expect(met_a.power?.scalingFactor).not.toBe(copied.power?.scalingFactor);
      expect(omit(met_a, "power")).toEqual(omit(copied, "power"));
      expect(parent).toEqual(before);
    });
  });
});

describe("analyzeNewMetricsUpdate", () => {
  const refresh = makeParent({
    id: "snp_refresh",
    settings: makeSettings(["met_a", "met_c"]),
    updateScope: getNewMetricsUpdateLineage(makeParent(), ["met_c"]),
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
    analyzeNewMetricsUpdate({
      context,
      snapshot: refresh,
      newMetricsUpdate: refresh.updateScope!,
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
      analyzeNewMetricsUpdate({
        context,
        snapshot: { ...refresh, runnerKind: "incremental-update", settings },
        newMetricsUpdate: refresh.updateScope!,
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
  });

  // The parent's goals were met_a and met_b; met_c joins them. Holm over
  // 0.01, 0.03, 0.04: 3 x 0.01, 2 x 0.03, then max(0.06, 1 x 0.04).
  it("corrects the goal metrics the update ends with, including one the parent lacked", async () => {
    findSnapshotByIdMock.mockResolvedValue(
      makeParent({
        settings: makeSettings(["met_a", "met_b"]),
        analyses: [
          analysis({ ...frequentist, pValueCorrection: "holm-bonferroni" }, [
            treatmentDimension({
              met_a: tested(0.01, { pValueAdjusted: 0.02 }),
              met_b: tested(0.03, { pValueAdjusted: 0.03 }),
            }),
          ]),
        ],
      }),
    );
    analyzeMock.mockResolvedValue({
      results: [
        {
          unknownVariations: [],
          multipleExposures: 0,
          dimensions: [treatmentDimension({ met_c: tested(0.04) })],
        },
      ],
    });
    const result = await analyzeNewMetricsUpdate({
      context,
      snapshot: {
        ...refresh,
        settings: makeSettings(["met_a", "met_b", "met_c"]),
      },
      newMetricsUpdate: refresh.updateScope!,
      queryMap,
      metricMap,
      variationNames: ["Control", "Treatment"],
    });

    const { met_a, met_c } = treatmentMetrics(result.analyses[0]);
    expect({
      met_a: met_a.pValueAdjusted,
      met_c: met_c.pValueAdjusted,
    }).toEqual({ met_a: expect.closeTo(0.03), met_c: expect.closeTo(0.06) });
  });
});

// The page predicts which added metrics a new-metrics update computes; the
// planner keeps the ones the planned snapshot gives a metricSettings entry.
describe("getComputableNewMetricIds matches the snapshot planner", () => {
  const datasource = {
    id: "ds_1",
    type: "postgres",
    settings: {
      queries: {
        exposure: [
          {
            id: "exposure_user",
            name: "Users",
            userIdType: "user_id",
            query: "SELECT * FROM exposures",
            dimensions: [],
          },
          {
            id: "exposure_region",
            name: "Regions",
            userIdType: "region_id",
            userIdTypes: ["region_id", "user_id"],
            query: "SELECT * FROM exposures",
            dimensions: [],
          },
        ],
      },
    },
  } as unknown as DataSourceInterface;
  const factTableMap = new Map(
    [
      factTableFactory.build({ id: "ft_user", userIdTypes: ["user_id"] }),
      factTableFactory.build({ id: "ft_region", userIdTypes: ["region_id"] }),
      factTableFactory.build({ id: "ft_device", userIdTypes: ["device_id"] }),
    ].map((t) => [t.id, t]),
  ) as FactTableMap;
  const metrics: ExperimentMetricInterface[] = [
    factMetricFactory.build({
      id: "fact__user",
      numerator: { factTableId: "ft_user" },
    }),
    factMetricFactory.build({
      id: "fact__region",
      numerator: { factTableId: "ft_region" },
    }),
    factMetricFactory.build({
      id: "fact__device",
      numerator: { factTableId: "ft_device" },
    }),
    factMetricFactory.build({
      id: "fact__conversion",
      numerator: { factTableId: "ft_user" },
      windowSettings: { type: "conversion" },
    }),
    {
      ...factMetricFactory.build({
        id: "fact__quantile",
        metricType: "quantile",
        numerator: { factTableId: "ft_user" },
      }),
      quantileSettings: {
        type: "unit" as const,
        quantile: 0.5,
        ignoreZeros: false,
      },
    },
  ];
  const allMetricIds = [...metrics.map((m) => m.id), "fact__deleted"];

  it.each<{
    name: string;
    experiment: Partial<ExperimentInterface>;
    expected: string[];
  }>([
    {
      name: "a standard experiment",
      experiment: {
        exposureQueryId: "exposure_user",
        goalMetrics: allMetricIds,
      },
      expected: ["fact__user", "fact__conversion", "fact__quantile"],
    },
    {
      name: "a holdout",
      experiment: {
        type: "holdout",
        exposureQueryId: "exposure_user",
        goalMetrics: ["fact__user", "fact__conversion"],
        secondaryMetrics: ["fact__device"],
        guardrailMetrics: ["fact__quantile", "fact__user"],
      },
      expected: ["fact__user"],
    },
    {
      name: "a cluster experiment",
      experiment: {
        exposureQueryId: "exposure_region",
        exposureQueryIdentifierType: "region_id",
        isClusterExperiment: true,
        clusterSubUnitIdentifier: "user_id",
        goalMetrics: allMetricIds,
      },
      expected: ["fact__user", "fact__region", "fact__conversion"],
    },
  ])("$name", ({ experiment: overrides, expected }) => {
    const experiment = {
      id: "exp_1",
      organization: "org_1",
      datasource: datasource.id,
      type: "standard",
      variations: [{ name: "Control" }, { name: "Treatment" }],
      phases: [
        {
          dateStarted: new Date("2026-11-01T00:00:00Z"),
          variationWeights: [0.5, 0.5],
        },
      ],
      goalMetrics: [],
      secondaryMetrics: [],
      guardrailMetrics: [],
      metricOverrides: [],
      ...overrides,
    } as unknown as ExperimentInterface;
    const metricMap = new Map(metrics.map((m) => [m.id, m]));

    const planned = getSnapshotSettings({
      experiment,
      phaseIndex: 0,
      snapshotType: "standard",
      dimension: null,
      regressionAdjustmentEnabled: false,
      orgPriorSettings: undefined,
      orgDisabledPrecomputedDimensions: true,
      settingsForSnapshotMetrics: [],
      metricMap,
      factTableMap,
      metricGroups: [],
      incrementalRefreshModel: null,
      datasource,
    });
    const computable = getComputableNewMetricIds({
      experiment,
      snapshotSettings: { metricSettings: [] },
      metricGroups: [],
      getMetricById: (id) => metricMap.get(id),
      getFactTableById: (id) => factTableMap.get(id),
      identifierType: planned.exposureQueryIdentifierType,
      datasourceSettings: datasource.settings,
    });

    expect(computable).toEqual(expected);
    expect(computable).toEqual(
      planned.metricSettings
        .map((m) => m.id)
        .filter((id) => getDefinitionMetricId(id) === id),
    );
  });
});
