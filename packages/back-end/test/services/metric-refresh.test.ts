import type { ExperimentInterface } from "shared/types/experiment";
import type { DataSourceInterface } from "shared/types/datasource";
import type {
  ExperimentSnapshotAnalysisSettings,
  ExperimentSnapshotInterface,
  ExperimentSnapshotSettings,
} from "shared/types/experiment-snapshot";
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
  carryMetricRefreshQueries,
  getMetricRefreshLineage,
  getSettingsChangedSinceParent,
  mergeMetricRefreshSettings,
  planMetricRefresh,
} from "back-end/src/services/metricRefresh";
import {
  ExperimentResultsQueryRunner,
  getIndexAfterLastGroup,
  isCarriedMetricRefreshQuery,
} from "back-end/src/queryRunners/ExperimentResultsQueryRunner";
import {
  findLatestSuccessfulOverallSnapshot,
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
  MetricRefreshUnavailableError,
  MetricsAlreadyUpToDateError,
  SnapshotInProgressError,
} from "back-end/src/util/errors";
import { snapshotFactory } from "../factories/Snapshot.factory";
import { factMetricFactory } from "../factories/FactMetric.factory";

jest.mock("back-end/src/models/ExperimentSnapshotModel", () => ({
  findLatestSuccessfulOverallSnapshot: jest.fn(),
  getLatestSnapshotStatus: jest.fn(),
  getSnapshotQueryPointers: jest.fn(),
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
  analyzeExperimentResults: jest.fn(),
}));

const findParentMock = jest.mocked(findLatestSuccessfulOverallSnapshot);
const latestStatusMock = jest.mocked(getLatestSnapshotStatus);
const queryPointersMock = jest.mocked(getSnapshotQueryPointers);
const createFromCachedMock = jest.mocked(createNewQueryFromCached);
const getQueriesByIdsMock = jest.mocked(getQueriesByIds);
const integrationMock = jest.mocked(getSourceIntegrationObject);
const analyzeMock = jest.mocked(analyzeExperimentResults);

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
      name: "a parent with a failed query",
      setup: () => {
        findParentMock.mockResolvedValue(
          makeParent({
            queries: [
              { name: "group_0", query: "qry_group", status: "succeeded" },
              { name: "met_x", query: "qry_x", status: "failed" },
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
      name: "an Incremental Pipeline parent",
      setup: () => {
        findParentMock.mockResolvedValue(
          makeParent({ runnerKind: "incremental-update" }),
        );
      },
      expected: unavailable("incremental_pipeline"),
    },
    {
      name: "an Incremental Pipeline plan",
      setup: () => ({
        planSnapshotAt: async () =>
          makePlan({ runnerKind: "incremental-full" }),
      }),
      expected: unavailable("incremental_pipeline"),
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
});

describe("getSettingsChangedSinceParent", () => {
  it("ignores the metric set, the cutoff flag and the metric counts", () => {
    const parent = makeParent();
    const planned = makePlan().snapshot;
    planned.settings.manual = true;
    planned.settings.endDateIsCutoff = false;

    expect(getSettingsChangedSinceParent({ parent, planned })).toEqual([]);
  });

  it("names every other difference, including fields only one side has", () => {
    const parent = makeParent();
    const planned = makePlan({
      settings: { segment: "seg_new", queryFilter: "x > 1" },
      analysisSettings: { regressionAdjusted: true },
    }).snapshot;
    Object.assign(planned.settings, { newSetting: true });

    expect(getSettingsChangedSinceParent({ parent, planned }).sort()).toEqual(
      [
        "analysis.regressionAdjusted",
        "newSetting",
        "queryFilter",
        "segment",
      ].sort(),
    );
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

  it("is limited the same way when a runner rebuilt from the document analyzes it", async () => {
    analyzeMock.mockResolvedValue({ results: [] });
    await makeRunner(stored).runAnalysis(queryMap);

    expect(analyzeMock.mock.calls[0][0].analyzedMetricIds).toEqual(
      new Set(["met_a", "met_c"]),
    );
  });

  it("keeps a full run unfiltered", () => {
    expect(getMetricFilterForCarriedQueries(makeParent())).toBeUndefined();
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
      yieldsToNewerOverallSnapshot: true,
    });
    expect(effects.timeSeries.pointDate).toEqual(PARENT_CREATED);
    expect(effects.timeSeries.includesMetric("met_c?dim:os=ios")).toBe(true);
    expect(effects.timeSeries.includesMetric("met_a")).toBe(false);
  });
});
