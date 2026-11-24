import type { ExposureQuery } from "shared/types/datasource";
import type { ExperimentSnapshotSettings } from "shared/types/experiment-snapshot";
import type { FactMetricInterface } from "shared/types/fact-table";
import type { IncrementalRefreshInterface } from "shared/validators";
import type { QueryInterface, QueryPointer } from "shared/types/query";
import type { ExperimentInterface } from "shared/types/experiment";
import {
  ExperimentIncrementalRefreshQueryRunner,
  startExperimentIncrementalRefreshQueries,
} from "back-end/src/queryRunners/ExperimentIncrementalRefreshQueryRunner";
import type { ExperimentIncrementalRefreshQueryParams } from "back-end/src/queryRunners/ExperimentIncrementalRefreshQueryRunner";
import type { StartQueryParams } from "back-end/src/queryRunners/QueryRunner";
import { getMetricSettingsHashForIncrementalRefresh } from "back-end/src/enterprise/services/data-pipeline";
import { getClusterMetricCacheLevel } from "back-end/src/integrations/sql/fact-metrics/cluster-metric-grain";
import type { SourceIntegrationInterface } from "back-end/src/types/Integration";
import type { ApiReqContext } from "back-end/types/api";
import { getExperimentById } from "back-end/src/models/ExperimentModel";
import { getSnapshotQueryPointers } from "back-end/src/models/ExperimentSnapshotModel";
import {
  createNewQueryFromCached,
  getQueriesByIds,
} from "back-end/src/models/QueryModel";
import { factMetricFactory } from "../factories/FactMetric.factory";
import { factTableFactory } from "../factories/FactTable.factory";
import { snapshotFactory } from "../factories/Snapshot.factory";

jest.mock("back-end/src/models/ExperimentModel", () => ({
  getExperimentById: jest.fn(),
}));

jest.mock("back-end/src/models/ExperimentSnapshotModel", () => ({
  errorSnapshotIfStillRunning: jest.fn(),
  findSnapshotById: jest.fn(),
  getSnapshotQueryPointers: jest.fn(),
  updateSnapshot: jest.fn(),
}));

jest.mock("back-end/src/models/QueryModel", () => ({
  ...jest.requireActual("back-end/src/models/QueryModel"),
  createNewQueryFromCached: jest.fn(),
  getQueriesByIds: jest.fn(),
}));

jest.mock("back-end/src/enterprise/services/data-pipeline", () => ({
  ...jest.requireActual("back-end/src/enterprise/services/data-pipeline"),
  assertIncrementalRefreshPrerequisites: jest.fn(),
}));

const CREATED = new Date("2026-10-01T00:00:00Z");
const PHASE_START = new Date("2026-11-01T00:00:00Z");
const BASE_END = new Date("2026-11-10T12:00:00Z");
const LATER_END = new Date("2026-11-11T12:00:00Z");

const exposureQuery: ExposureQuery = {
  id: "exp_q",
  name: "Exposures",
  query:
    "SELECT user_id, timestamp, experiment_id, variation_id, country FROM exposures",
  userIdType: "user_id",
  dimensions: ["country"],
};

const factTable = (id: string) =>
  factTableFactory.build({
    id,
    name: id,
    userIdTypes: ["user_id"],
    sql: `SELECT user_id, timestamp, value FROM ${id}`,
    dateCreated: CREATED,
    dateUpdated: CREATED,
  });
const factTableMap = new Map(
  ["ft_a", "ft_b", "ft_c"].map((id) => [id, factTable(id)]),
);

const metric = (
  id: string,
  over: Partial<FactMetricInterface>,
): FactMetricInterface =>
  factMetricFactory.build({
    id,
    name: id,
    dateCreated: CREATED,
    dateUpdated: CREATED,
    ...over,
  });
const metrics = [
  metric("a1", {
    metricType: "proportion",
    numerator: {
      factTableId: "ft_a",
      column: "$$distinctUsers",
      rowFilters: [],
    },
  }),
  metric("a2", {
    metricType: "mean",
    numerator: { factTableId: "ft_a", column: "value", rowFilters: [] },
  }),
  metric("b1", {
    metricType: "mean",
    numerator: { factTableId: "ft_b", column: "value", rowFilters: [] },
  }),
  metric("r1", {
    metricType: "ratio",
    numerator: { factTableId: "ft_a", column: "value", rowFilters: [] },
    denominator: { factTableId: "ft_b", column: "$$count", rowFilters: [] },
  }),
  metric("a3", {
    metricType: "mean",
    numerator: { factTableId: "ft_a", column: "$$count", rowFilters: [] },
  }),
  metric("a3?dim:country=US", {
    metricType: "mean",
    numerator: { factTableId: "ft_a", column: "$$count", rowFilters: [] },
  }),
  metric("c1", {
    metricType: "mean",
    numerator: { factTableId: "ft_c", column: "value", rowFilters: [] },
  }),
  metric("r2", {
    metricType: "ratio",
    numerator: { factTableId: "ft_a", column: "value", rowFilters: [] },
    denominator: { factTableId: "ft_c", column: "value", rowFilters: [] },
  }),
  metric("r3", {
    metricType: "ratio",
    numerator: { factTableId: "ft_a", column: "$$count", rowFilters: [] },
    denominator: { factTableId: "ft_b", column: "value", rowFilters: [] },
  }),
];
const metricMap = new Map(metrics.map((m) => [m.id, m]));

const metricSettings = (id: string) => ({
  id,
  computedSettings: {
    windowSettings: {
      type: "" as const,
      windowUnit: "days" as const,
      windowValue: 1,
      delayUnit: "days" as const,
      delayValue: 0,
    },
    regressionAdjustmentDays: id === "a1" || id === "a3" ? 14 : 0,
    regressionAdjustmentEnabled: id === "a1" || id === "a3",
    regressionAdjustmentAvailable: true,
    regressionAdjustmentReason: "",
    properPrior: false,
    properPriorMean: 0,
    properPriorStdDev: 0.3,
  },
});

function snapshotSettings(
  metricIds: string[],
  endDate: Date,
): ExperimentSnapshotSettings {
  return {
    manual: false,
    dimensions: [],
    metricSettings: metricIds.map(metricSettings),
    goalMetrics: metricIds,
    secondaryMetrics: [],
    guardrailMetrics: [],
    activationMetric: null,
    defaultMetricPriorSettings: {
      override: false,
      proper: false,
      mean: 0,
      stddev: 0.3,
    },
    regressionAdjustmentEnabled: true,
    attributionModel: "firstExposure",
    experimentId: "exp_1",
    queryFilter: "",
    segment: "",
    skipPartialData: false,
    datasourceId: "ds_1",
    exposureQueryId: exposureQuery.id,
    startDate: PHASE_START,
    endDate,
    variations: [
      { id: "0", weight: 0.5 },
      { id: "1", weight: 0.5 },
    ],
  };
}

const BASE_METRICS = ["a1", "a2", "b1", "r1"];

const storedMetric = (id: string) => {
  const factMetric = metricMap.get(id);
  if (!factMetric) throw new Error(`unknown metric ${id}`);
  const settings = snapshotSettings([id], BASE_END);
  return {
    id,
    settingsHash: getMetricSettingsHashForIncrementalRefresh({
      factMetric,
      factTableMap,
      metricSettings: settings.metricSettings.find((m) => m.id === id),
      clusterMetricLevel: getClusterMetricCacheLevel(settings, id),
    }),
  };
};

function baseState(): IncrementalRefreshInterface {
  return {
    id: "ir_1",
    organization: "org_1",
    dateCreated: CREATED,
    dateUpdated: CREATED,
    experimentId: "exp_1",
    phase: 0,
    unitsTableFullName: "proj.ds.gb_units_exp_1_base",
    unitsMaxTimestamp: new Date("2026-11-10T11:59:50Z"),
    unitsMaxTimestampRaw: null,
    unitsDimensions: ["country"],
    experimentSettingsHash: "settings-hash",
    materializedBySnapshotId: "snp_base",
    currentExecutionSnapshotId: "snp_run",
    lockHeartbeatAt: CREATED,
    metricSources: [
      {
        groupId: "ft_a_stored0",
        factTableId: "ft_a",
        metrics: ["a1", "a2", "r1"].map(storedMetric),
        maxTimestamp: new Date("2026-11-10T11:58:00Z"),
        maxTimestampRaw: null,
        tableFullName: "proj.ds.gb_metrics_exp_1_ft_a_stored0",
      },
      {
        groupId: "ft_b_stored0",
        factTableId: "ft_b",
        metrics: ["b1", "r1"].map(storedMetric),
        maxTimestamp: new Date("2026-11-10T11:57:00Z"),
        maxTimestampRaw: null,
        tableFullName: "proj.ds.gb_metrics_exp_1_ft_b_stored0",
      },
    ],
    metricCovariateSources: [
      {
        groupId: "ft_a_stored0",
        tableFullName: "proj.ds.gb_metrics_exp_1_ft_a_stored0_covariate",
        lastSuccessfulMaxTimestamp: new Date("2026-11-10T11:59:50Z"),
        lastSuccessfulMaxTimestampRaw: null,
      },
    ],
  } as IncrementalRefreshInterface;
}

type BuilderCall = { method: string; args: Record<string, unknown> };

function fakeIntegration(maxColumns: number): {
  integration: SourceIntegrationInterface;
  calls: Map<string, BuilderCall>;
} {
  const calls = new Map<string, BuilderCall>();
  let n = 0;
  const base: Record<string, unknown> = {
    datasource: {
      id: "ds_1",
      type: "bigquery",
      settings: {
        queries: { exposure: [exposureQuery] },
        pipelineSettings: {
          allowWriting: true,
          writeDataset: "ds",
          writeDatabase: "proj",
          mode: "incremental",
        },
      },
    },
    getSourceProperties: () => ({ maxColumns }),
    generateTablePath: (name: string, dataset?: string, database?: string) =>
      `${database}.${dataset}.${name}`,
  };
  const integration = new Proxy(base, {
    get(target, prop) {
      if (typeof prop !== "string") return undefined;
      if (prop in target) return target[prop];
      if (prop.startsWith("get") && prop.endsWith("Query")) {
        return (args: Record<string, unknown>) => {
          const sql = `${prop}#${n++}`;
          calls.set(sql, { method: prop, args });
          return sql;
        };
      }
      if (prop.startsWith("run")) return jest.fn();
      return undefined;
    },
  }) as unknown as SourceIntegrationInterface;
  return { integration, calls };
}

type Recorded = StartQueryParams<unknown, unknown> & {
  dependencyNames: string[];
};

function makeContext(
  state: IncrementalRefreshInterface | null,
  updateState = jest.fn().mockResolvedValue(true),
) {
  return {
    org: { id: "org_1", settings: { runHealthTrafficQuery: true } },
    permissions: { canRunExperimentQueries: () => true },
    logger: {
      warn: jest.fn(),
      error: jest.fn(),
      info: jest.fn(),
      debug: jest.fn(),
    },
    models: {
      incrementalRefresh: {
        getLockedBySnapshotId: jest.fn().mockResolvedValue(state),
        isLockedBySnapshotId: jest.fn().mockResolvedValue(true),
        updateByExperimentIdIfCurrentExecution: updateState,
      },
      segments: { getById: jest.fn() },
      aggregatedFactTables: { getByKey: jest.fn() },
    },
  } as unknown as ApiReqContext;
}

async function buildDag({
  params,
  state,
  maxColumns = 1000,
}: {
  params: Partial<
    ExperimentIncrementalRefreshQueryParams & { isNewMetricsUpdate: boolean }
  >;
  state: IncrementalRefreshInterface | null;
  maxColumns?: number;
}) {
  const { integration, calls } = fakeIntegration(maxColumns);
  const recorded: Recorded[] = [];
  const updateState = jest.fn().mockResolvedValue(true);
  const context = makeContext(state, updateState);

  const startQuery = async (
    q: StartQueryParams<unknown, unknown>,
  ): Promise<QueryPointer> => {
    const byId = new Map(recorded.map((r) => [`id:${r.name}`, r.name]));
    recorded.push({
      ...q,
      dependencyNames: q.dependencies.map((d) => byId.get(d) ?? d),
    });
    return { name: q.name, query: `id:${q.name}`, status: "queued" };
  };

  const queries = await startExperimentIncrementalRefreshQueries(
    context,
    {
      snapshotType: "standard",
      snapshotSettings: snapshotSettings(BASE_METRICS, BASE_END),
      variationNames: ["Control", "Treatment"],
      metricMap,
      factTableMap,
      queryParentId: "snp_run",
      experimentId: "exp_1",
      experimentQueryMetadata: null,
      mode: { kind: "update" },
      isNewMetricsUpdate: false,
      incrementalRefreshStartTime: BASE_END,
      ...params,
    },
    integration,
    startQuery,
    null,
  );
  return {
    queries,
    recorded,
    calls,
    updateState,
  };
}

type DagOptions = {
  state?: IncrementalRefreshInterface;
  maxColumns?: number;
};

function refreshDag(
  targets: string[],
  { state = baseState(), maxColumns }: DagOptions = {},
) {
  return buildDag({
    params: {
      isNewMetricsUpdate: true,
      snapshotSettings: snapshotSettings(
        [...BASE_METRICS, ...targets],
        BASE_END,
      ),
      incrementalRefreshStartTime: BASE_END,
    },
    state,
    maxColumns,
  });
}

function updateDag(
  metricIds: string[],
  { state = baseState(), maxColumns }: DagOptions = {},
) {
  return buildDag({
    params: {
      snapshotSettings: snapshotSettings(metricIds, LATER_END),
      incrementalRefreshStartTime: LATER_END,
    },
    state,
    maxColumns,
  });
}

type Dag = Awaited<ReturnType<typeof buildDag>>;

function argsOf(
  { recorded, calls }: Dag,
  prefix: string,
): (BuilderCall["args"] & { name: string })[] {
  return recorded
    .filter((r) => r.name.startsWith(prefix))
    .map((r) => ({ ...(calls.get(r.query)?.args ?? {}), name: r.name }));
}

const metricIdsOf = (args: Record<string, unknown>) =>
  (args.metrics as FactMetricInterface[]).map((m) => m.id);

const namesOf = (dag: Dag) => dag.recorded.map((r) => r.name);

// The caches a run creates, as "factTableId:metricIds".
const createdCaches = (dag: Dag) =>
  argsOf(dag, "create_metrics_source_")
    .map((a) => `${a.factTableId}:${metricIdsOf(a).sort().join(",")}`)
    .sort();

// Settles every state write of the run and returns the state it leaves.
async function finishWrites(
  dag: Dag,
  state: IncrementalRefreshInterface,
): Promise<IncrementalRefreshInterface> {
  for (const r of dag.recorded) {
    if (r.name.startsWith("max_timestamp_metrics_source_")) {
      await r.onSuccess?.([{ max_timestamp: "2026-11-10T11:59:30Z" }]);
    }
    if (r.name.startsWith("insert_metrics_covariate_data_")) {
      await r.onSuccess?.([]);
    }
  }
  return Object.assign(
    { ...state },
    ...dag.updateState.mock.calls.map((c) => c[2]),
  );
}

const UNITS =
  /^(update|drop|alter|max_timestamp|create)_snp_run|^drop_snp_run_old$/;

describe("new-metrics update (new-metrics runs)", () => {
  it("rebuilds a target's fact table cache like an update, on the base's units table and end", async () => {
    const refresh = await refreshDag(["a3", "c1"]);
    const update = await updateDag([...BASE_METRICS, "a3", "c1"]);

    expect(createdCaches(refresh)).toEqual(["ft_a:a1,a2,a3,r1", "ft_c:c1"]);
    expect(createdCaches(refresh)).toEqual(createdCaches(update));

    expect(namesOf(refresh).filter((n) => UNITS.test(n))).toEqual([]);
    expect(
      namesOf(refresh).filter(
        (n) => n.includes("ft_b_stored0") && !n.startsWith("statistics_"),
      ),
    ).toEqual([]);
    argsOf(refresh, "insert_metrics_source_data_").forEach((a) => {
      expect(a.lastMaxTimestamp).toBeNull();
      expect(a.unitsSourceTableFullName).toBe("proj.ds.gb_units_exp_1_base");
      expect(a.incrementalRefreshStartTime).toEqual(BASE_END);
    });

    const statistics = argsOf(refresh, "statistics_");
    expect(statistics.flatMap(metricIdsOf).sort()).toEqual([
      "a1",
      "a2",
      "a3",
      "b1",
      "c1",
      "r1",
    ]);
    statistics.forEach((a) => expect(a.asOf).toEqual(BASE_END));
  });

  it("rebuilds both fact tables of a cross-fact-table ratio target", async () => {
    const refresh = await refreshDag(["r3"]);

    expect(createdCaches(refresh)).toEqual([
      "ft_a:a1,a2,r1,r3",
      "ft_b:b1,r1,r3",
    ]);
    expect(createdCaches(refresh)).toEqual(
      createdCaches(await updateDag([...BASE_METRICS, "r3"])),
    );
    expect(namesOf(refresh).filter((n) => n.includes("stored0"))).toEqual([]);
    expect(
      argsOf(refresh, "statistics_multi_").flatMap(metricIdsOf).sort(),
    ).toEqual(["r1", "r3"]);
  });

  it("lets the normal update that replaces a refused new-metrics update rebuild a metric edited since its cache was built", async () => {
    const asBuilt = metricMap.get("b1");
    if (!asBuilt) throw new Error("unknown metric b1");
    const settings = snapshotSettings(["b1"], BASE_END);
    const hashBeforeEdit = getMetricSettingsHashForIncrementalRefresh({
      factMetric: {
        ...asBuilt,
        numerator: { ...asBuilt.numerator, column: "$$count" },
      },
      factTableMap,
      metricSettings: settings.metricSettings[0],
    });
    const state = baseState();
    state.metricSources.forEach((source) =>
      source.metrics.forEach((m) => {
        if (m.id === "b1") m.settingsHash = hashBeforeEdit;
      }),
    );

    const update = await updateDag([...BASE_METRICS, "c1"], { state });

    expect(createdCaches(update)).toEqual(["ft_b:b1,r1", "ft_c:c1"]);
    expect(createdCaches(await updateDag([...BASE_METRICS, "c1"]))).toEqual([
      "ft_c:c1",
    ]);
  });

  describe("a fact table split across two caches", () => {
    // a1 and a3 take 6 columns each (CUPED), a2 takes 3 and r1 6.
    const splitState = () => {
      const split = baseState();
      split.metricSources = [
        { ...split.metricSources[0], metrics: ["a1", "a2"].map(storedMetric) },
        {
          ...split.metricSources[0],
          groupId: "ft_a_stored1",
          metrics: [storedMetric("r1")],
          tableFullName: "proj.ds.gb_metrics_exp_1_ft_a_stored1",
        },
        split.metricSources[1],
      ];
      return split;
    };

    it("rebuilds only the smallest cache with room, so the other keeps its tables and queries", async () => {
      const maxColumns = 115;
      const split = splitState();
      expect(
        createdCaches(await updateDag(BASE_METRICS, { state: split })),
      ).toEqual([]);

      const refresh = await refreshDag(["a3"], { state: split, maxColumns });
      expect(createdCaches(refresh)).toEqual(["ft_a:a3,r1"]);
      expect(
        namesOf(refresh).filter((n) => n.includes("ft_a_stored0")),
      ).toEqual(["statistics_ft_a_stored0"]);
      const [builtA] = argsOf(refresh, "create_metrics_source_").map((a) =>
        a.name.replace("create_metrics_source_", ""),
      );
      expect(
        argsOf(refresh, "statistics_multi_").map((a) => [
          a.name,
          metricIdsOf(a),
        ]),
      ).toEqual([[`statistics_multi_${builtA}__ft_b_stored0`, ["r1"]]]);

      const state = await finishWrites(refresh, split);
      expect(state.metricSources.map((s) => s.groupId).sort()).toEqual(
        [builtA, "ft_a_stored0", "ft_b_stored0"].sort(),
      );
      expect(
        createdCaches(
          await updateDag([...BASE_METRICS, "a3"], { state, maxColumns }),
        ),
      ).toEqual([]);

      // A normal update that adds the metric still restates the fact table.
      expect(
        createdCaches(
          await updateDag([...BASE_METRICS, "a3"], {
            state: split,
            maxColumns,
          }),
        ),
      ).toEqual(["ft_a:a1,a3", "ft_a:a2,r1"]);
    });

    it("rebuilds one cache for a new metric and its slice when one cache has room for both", async () => {
      // a3 takes 6 columns and its slice 3. Placed on their own, a3 would
      // rebuild ft_a_stored1 and the slice the then smaller ft_a_stored0.
      const refresh = await refreshDag(["a3", "a3?dim:country=US"], {
        state: splitState(),
        maxColumns: 118,
      });
      expect(createdCaches(refresh)).toEqual(["ft_a:a3,a3?dim:country=US,r1"]);
    });

    it("opens a new cache alongside when no cache has room, and rebuilds none", async () => {
      const maxColumns = 112;
      const split = splitState();
      const refresh = await refreshDag(["a3"], { state: split, maxColumns });

      expect(createdCaches(refresh)).toEqual(["ft_a:a3"]);
      expect(namesOf(refresh).filter((n) => n.includes("_stored"))).toEqual([
        "statistics_ft_a_stored0",
        "statistics_ft_b_stored0",
        "statistics_multi_ft_a_stored1__ft_b_stored0",
      ]);

      const state = await finishWrites(refresh, split);
      expect(
        state.metricSources.filter((s) => s.factTableId === "ft_a"),
      ).toHaveLength(3);
      expect(
        createdCaches(
          await updateDag([...BASE_METRICS, "a3"], { state, maxColumns }),
        ),
      ).toEqual([]);
    });
  });

  it("rebuilds nothing after a chain of new-metrics updates and a normal update", async () => {
    const first = await refreshDag(["a3"]);
    const afterFirst = await finishWrites(first, baseState());

    const second = await refreshDag(["a3", "c1"], { state: afterFirst });
    expect(createdCaches(second)).toEqual(["ft_c:c1"]);
    expect(namesOf(second).filter((n) => n.startsWith("drop_"))).toEqual([]);
    const afterSecond = await finishWrites(second, afterFirst);

    const update = await updateDag([...BASE_METRICS, "a3", "c1"], {
      state: afterSecond,
    });
    expect(createdCaches(update)).toEqual([]);
  });

  it("refuses to keep a source under its id when its metrics would change", async () => {
    const state = baseState();
    state.metricSources = [
      { ...state.metricSources[0], metrics: ["a1", "a2"].map(storedMetric) },
      {
        ...state.metricSources[0],
        groupId: "ft_a_stored1",
        metrics: ["a2", "r1"].map(storedMetric),
        tableFullName: "proj.ds.gb_metrics_exp_1_ft_a_stored1",
      },
      state.metricSources[1],
    ];
    await expect(refreshDag(["c1"], { state })).rejects.toThrow(
      "Metrics source ft_a_stored1 would change its metrics without a new id",
    );
  });

  it("leaves state that the next update and the next new-metrics update rebuild from when a rebuild fails", async () => {
    const refresh = await refreshDag(["a3"]);
    refresh.recorded
      .find((r) => r.name.startsWith("max_timestamp_metrics_source_ft_a_"))
      ?.onFailure?.();
    await Promise.resolve();
    const state = baseState();
    Object.assign(state, ...refresh.updateState.mock.calls.map((c) => c[2]));
    expect(state.metricSources.map((s) => s.groupId)).toEqual(["ft_b_stored0"]);

    expect(
      createdCaches(await updateDag([...BASE_METRICS, "a3"], { state })),
    ).toEqual(["ft_a:a1,a2,a3,r1"]);
    expect(createdCaches(await refreshDag(["a3"], { state }))).toEqual([
      "ft_a:a1,a2,a3,r1",
    ]);
  });

  it("lets the next update append to every cache, so it runs no extra queries", async () => {
    const refresh = await refreshDag(["a3", "c1"]);
    const state = await finishWrites(refresh, baseState());

    const afterRefresh = await updateDag([...BASE_METRICS, "a3", "c1"], {
      state,
    });
    expect(createdCaches(afterRefresh)).toEqual([]);
    expect(
      argsOf(afterRefresh, "insert_metrics_source_data_")
        .map((a) => (a.lastMaxTimestamp === null ? null : a.name))
        .sort(),
    ).toEqual(
      state.metricSources
        .map((s) => `insert_metrics_source_data_${s.groupId}`)
        .sort(),
    );

    const update = await updateDag([...BASE_METRICS, "a3", "c1"]);
    const afterUpdate = await updateDag([...BASE_METRICS, "a3", "c1"], {
      state: await finishWrites(update, baseState()),
    });
    expect(afterRefresh.recorded.length).toBe(afterUpdate.recorded.length);
  });
});

describe("a new-metrics update run on the Incremental Pipeline", () => {
  it("copies the parent's traffic and untouched statistics queries instead of running them", async () => {
    jest
      .mocked(getSnapshotQueryPointers)
      .mockResolvedValue(
        [
          "update_snp_base",
          "statistics_ft_a_stored0",
          "statistics_ft_b_stored0",
          "traffic",
        ].map((name) => ({ name, query: `qry_${name}`, status: "succeeded" })),
      );
    jest
      .mocked(getQueriesByIds)
      .mockImplementation(async (ctx, ids) =>
        ids.map((id) => ({ id, status: "succeeded" }) as QueryInterface),
      );
    jest.mocked(createNewQueryFromCached).mockImplementation(
      async ({ existing }) =>
        ({
          id: `copy_of_${existing.id}`,
          status: "succeeded",
        }) as QueryInterface,
    );
    jest
      .mocked(getExperimentById)
      .mockResolvedValue({ id: "exp_1" } as ExperimentInterface);
    const settings = snapshotSettings([...BASE_METRICS, "a3"], BASE_END);
    const runner = new ExperimentIncrementalRefreshQueryRunner(
      makeContext(baseState()),
      snapshotFactory.build({
        id: "snp_run",
        type: "standard",
        runnerKind: "incremental-update",
        settings,
        updateScope: {
          kind: "new_metrics" as const,
          parentSnapshotId: "snp_base",
          queriedMetricIds: ["a3"],
          base: {
            dateCreated: BASE_END,
            runStarted: null,
            cutoffDate: BASE_END,
          },
        },
      }),
      fakeIntegration(1000).integration,
      false,
    );
    const started: string[] = [];
    jest.spyOn(runner, "startQuery").mockImplementation(async ({ name }) => {
      started.push(name);
      return { name, query: `qry_new_${name}`, status: "queued" };
    });

    const queries = await runner.startQueries({
      snapshotType: "standard",
      snapshotSettings: settings,
      variationNames: ["Control", "Treatment"],
      metricMap,
      factTableMap,
      queryParentId: "snp_run",
      experimentId: "exp_1",
      experimentQueryMetadata: null,
      mode: { kind: "update" },
      incrementalRefreshStartTime: BASE_END,
    });

    expect(queries).toEqual(
      expect.arrayContaining(
        ["traffic", "statistics_ft_b_stored0"].map((name) => ({
          name,
          query: `copy_of_qry_${name}`,
          status: "succeeded",
        })),
      ),
    );
    expect(started).not.toContain("traffic");
    expect(started).not.toContain("update_snp_run");
    expect(started).not.toContain("statistics_ft_b_stored0");
    expect(started).toContainEqual(expect.stringMatching(/^statistics_ft_a_/));
  });
});
