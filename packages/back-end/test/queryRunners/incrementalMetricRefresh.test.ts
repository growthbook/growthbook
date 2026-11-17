import { createHash } from "node:crypto";
import type { ExposureQuery } from "shared/types/datasource";
import type { ExperimentSnapshotSettings } from "shared/types/experiment-snapshot";
import type { FactMetricInterface } from "shared/types/fact-table";
import type { IncrementalRefreshInterface } from "shared/validators";
import type { QueryPointer } from "shared/types/query";
import { startExperimentIncrementalRefreshQueries } from "back-end/src/queryRunners/ExperimentIncrementalRefreshQueryRunner";
import type { ExperimentIncrementalRefreshQueryParams } from "back-end/src/queryRunners/ExperimentIncrementalRefreshQueryRunner";
import type { StartQueryParams } from "back-end/src/queryRunners/QueryRunner";
import { getMetricSettingsHashForIncrementalRefresh } from "back-end/src/enterprise/services/data-pipeline";
import { getClusterMetricCacheLevel } from "back-end/src/integrations/sql/fact-metrics/cluster-metric-grain";
import type { SourceIntegrationInterface } from "back-end/src/types/Integration";
import type { ApiReqContext } from "back-end/types/api";
import { factMetricFactory } from "../factories/FactMetric.factory";
import { factTableFactory } from "../factories/FactTable.factory";

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

function digest(value: unknown): string {
  const seen = new WeakSet<object>();
  const json = JSON.stringify(value, (_key, v: unknown) => {
    if (v instanceof Map) return Object.fromEntries(v);
    if (v instanceof Set) return [...v];
    if (v && typeof v === "object") {
      if (seen.has(v)) return "[cycle]";
      seen.add(v);
    }
    return v;
  });
  return createHash("md5")
    .update(json ?? "undefined")
    .digest("hex")
    .slice(0, 12);
}

type BuilderCall = { method: string; args: Record<string, unknown> };

function fakeIntegration(): {
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
    getSourceProperties: () => ({ maxColumns: 1000 }),
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

async function buildDag({
  params,
  state,
}: {
  params: Partial<ExperimentIncrementalRefreshQueryParams>;
  state: IncrementalRefreshInterface | null;
}) {
  const { integration, calls } = fakeIntegration();
  const recorded: Recorded[] = [];
  const updateState = jest.fn().mockResolvedValue(true);
  const context = {
    org: { id: "org_1", settings: { runHealthTrafficQuery: true } },
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
      incrementalRefreshStartTime: BASE_END,
      ...params,
    },
    integration,
    startQuery,
    null,
  );
  return { queries, recorded, calls, updateState };
}

function describeDag(
  recorded: Recorded[],
  calls: Map<string, BuilderCall>,
): string[] {
  return recorded.map((r) => {
    const call = calls.get(r.query);
    return [
      r.name,
      r.queryType,
      r.displayTitle ?? "",
      `deps=[${r.dependencyNames.join(",")}]`,
      call ? `${call.method}#${digest(call.args)}` : r.query,
      `meta=${JSON.stringify(r.metadata ?? null)}`,
    ].join(" | ");
  });
}

let random: jest.SpyInstance;
beforeEach(() => {
  let i = 0;
  random = jest
    .spyOn(Math, "random")
    .mockImplementation(() => ((i++ * 0.137) % 1) + 0.0001);
});
afterEach(() => random.mockRestore());

describe("normal incremental runs (pinned at trunk b29299f794)", () => {
  it("full refresh", async () => {
    const { recorded, calls } = await buildDag({
      params: { mode: { kind: "full" } },
      state: baseState(),
    });
    expect(describeDag(recorded, calls)).toMatchSnapshot();
  });

  it("update with no metric change", async () => {
    const { recorded, calls } = await buildDag({
      params: {
        snapshotSettings: snapshotSettings(BASE_METRICS, LATER_END),
        incrementalRefreshStartTime: LATER_END,
      },
      state: baseState(),
    });
    expect(describeDag(recorded, calls)).toMatchSnapshot();
  });

  it("update after a3 and c1 were added", async () => {
    const { recorded, calls } = await buildDag({
      params: {
        snapshotSettings: snapshotSettings(
          [...BASE_METRICS, "a3", "c1"],
          LATER_END,
        ),
        incrementalRefreshStartTime: LATER_END,
      },
      state: baseState(),
    });
    expect(describeDag(recorded, calls)).toMatchSnapshot();
  });
});

function refreshDag(
  targets: string[],
  state: IncrementalRefreshInterface = baseState(),
) {
  return buildDag({
    params: {
      mode: { kind: "metrics-only", definitionMetricIds: new Set(targets) },
      snapshotSettings: snapshotSettings(
        [...BASE_METRICS, ...targets],
        BASE_END,
      ),
      incrementalRefreshStartTime: BASE_END,
    },
    state,
  });
}

function byName(recorded: Recorded[], name: string): Recorded {
  const query = recorded.find((r) => r.name === name);
  if (!query) throw new Error(`no query ${name}`);
  return query;
}

function argsOf(
  recorded: Recorded[],
  calls: Map<string, BuilderCall>,
  prefix: string,
): (BuilderCall["args"] & { name: string })[] {
  return recorded
    .filter((r) => r.name.startsWith(prefix))
    .map((r) => ({ ...(calls.get(r.query)?.args ?? {}), name: r.name }));
}

const metricIdsOf = (args: Record<string, unknown>) =>
  (args.metrics as FactMetricInterface[]).map((m) => m.id);

const UNITS_OR_TRAFFIC =
  /^(update|drop|alter|max_timestamp|create)_snp_run|^drop_snp_run_old$|^(traffic|clusterTraffic|clusterHealth)$/;

describe("metric refresh (metrics-only runs)", () => {
  it("builds only the targets' caches and statistics on the base's units table", async () => {
    const { recorded, calls } = await refreshDag(["a3", "c1"]);
    const names = recorded.map((r) => r.name);

    expect(names.filter((n) => UNITS_OR_TRAFFIC.test(n))).toEqual([]);
    expect(names.filter((n) => n.includes("stored0"))).toEqual([]);

    const inserts = argsOf(recorded, calls, "insert_metrics_source_data_");
    expect(
      inserts.map((a) => [a.factTableId, metricIdsOf(a), a.lastMaxTimestamp]),
    ).toEqual([
      ["ft_a", ["a3"], null],
      ["ft_c", ["c1"], null],
    ]);
    inserts.forEach((a) => {
      expect(a.unitsSourceTableFullName).toBe("proj.ds.gb_units_exp_1_base");
      expect(a.incrementalRefreshStartTime).toEqual(BASE_END);
    });

    const statistics = argsOf(recorded, calls, "statistics_");
    expect(statistics.flatMap(metricIdsOf).sort()).toEqual(["a3", "c1"]);
    statistics.forEach((a) => expect(a.asOf).toEqual(BASE_END));

    recorded
      .filter((r) =>
        /^(create_metrics_source|drop_metrics_covariate)_/.test(r.name),
      )
      .forEach((r) => expect(r.dependencyNames).toEqual([]));
    const covariateInsert = recorded.find((r) =>
      r.name.startsWith("insert_metrics_covariate_data_"),
    );
    expect(covariateInsert?.dependencyNames).toEqual([
      covariateInsert?.name.replace(
        "insert_metrics_covariate_data_",
        "create_metrics_covariate_table_",
      ),
    ]);

    expect(describeDag(recorded, calls)).toMatchSnapshot();
  });

  it("computes a cross-fact-table ratio from new caches on both of its fact tables", async () => {
    const { recorded, calls } = await refreshDag(["r3"]);
    const names = recorded.map((r) => r.name);

    expect(names.filter((n) => UNITS_OR_TRAFFIC.test(n))).toEqual([]);
    expect(names.filter((n) => n.includes("stored0"))).toEqual([]);
    expect(
      argsOf(recorded, calls, "insert_metrics_source_data_").map((a) => [
        a.factTableId,
        metricIdsOf(a),
      ]),
    ).toEqual([
      ["ft_a", ["r3"]],
      ["ft_b", ["r3"]],
    ]);
    const statistics = argsOf(recorded, calls, "statistics_");
    expect(
      statistics.map((a) => [
        a.name.startsWith("statistics_multi_"),
        metricIdsOf(a),
      ]),
    ).toEqual([[true, ["r3"]]]);
  });

  it("adds a target's cache to the stored ones and keeps every other entry", async () => {
    const { recorded, updateState } = await refreshDag(["a3", "c1"]);
    const base = baseState();
    const a3Group = recorded
      .find((r) => r.name.startsWith("max_timestamp_metrics_source_ft_a_"))
      ?.name.replace("max_timestamp_metrics_source_", "");
    if (!a3Group) throw new Error("no ft_a target cache");

    await byName(
      recorded,
      `max_timestamp_metrics_source_${a3Group}`,
    ).onSuccess?.([{ max_timestamp: "2026-11-10T11:59:30Z" }]);
    await byName(
      recorded,
      `insert_metrics_covariate_data_${a3Group}`,
    ).onSuccess?.([]);

    const written = updateState.mock.calls.map((c) => c[2]);
    expect(written).toEqual([
      {
        metricSources: [
          ...base.metricSources,
          {
            groupId: a3Group,
            factTableId: "ft_a",
            metrics: [storedMetric("a3")],
            maxTimestamp: new Date("2026-11-10T11:59:30Z"),
            maxTimestampRaw: null,
            tableFullName: `proj.ds.gb_metrics_exp_1_${a3Group}`,
          },
        ],
      },
      {
        metricCovariateSources: [
          ...base.metricCovariateSources,
          expect.objectContaining({
            groupId: a3Group,
            lastSuccessfulMaxTimestamp: base.unitsMaxTimestamp,
          }),
        ],
      },
    ]);
    expect(
      written.some(
        (w) => "unitsMaxTimestamp" in w || "unitsTableFullName" in w,
      ),
    ).toBe(false);
  });

  it("leaves the stored caches as the base left them when a target's cache fails", async () => {
    const { recorded, updateState } = await refreshDag(["a3"]);
    const maxTimestamp = recorded.find((r) =>
      r.name.startsWith("max_timestamp_metrics_source_"),
    );
    maxTimestamp?.onFailure?.();
    await Promise.resolve();

    expect(updateState.mock.calls.map((c) => c[2])).toEqual([
      { metricSources: baseState().metricSources },
    ]);
  });

  it("keeps a finished target's cache and every stored one when another target's cache fails", async () => {
    const { recorded, updateState } = await refreshDag(["a3", "c1"]);
    const maxTimestampOf = (factTableId: string) => {
      const query = recorded.find((r) =>
        r.name.startsWith(`max_timestamp_metrics_source_${factTableId}_`),
      );
      if (!query) throw new Error(`no ${factTableId} target cache`);
      return query;
    };
    const a3 = maxTimestampOf("ft_a");
    const c1 = maxTimestampOf("ft_c");

    await a3.onSuccess?.([{ max_timestamp: "2026-11-10T11:59:30Z" }]);
    c1.onFailure?.();
    await Promise.resolve();

    const stored = [
      ...baseState().metricSources,
      expect.objectContaining({
        groupId: a3.name.replace("max_timestamp_metrics_source_", ""),
        factTableId: "ft_a",
        metrics: [storedMetric("a3")],
      }),
    ];
    expect(
      updateState.mock.calls
        .map((c) => c[2])
        .filter((w) => "metricSources" in w),
    ).toEqual([{ metricSources: stored }, { metricSources: stored }]);
  });

  it("lets the next update append to every cache, the refresh's included", async () => {
    const refreshed = await refreshDag(["a3", "c1"]);
    const state = baseState();
    for (const r of refreshed.recorded.filter((q) =>
      q.name.startsWith("max_timestamp_metrics_source_"),
    )) {
      await r.onSuccess?.([{ max_timestamp: "2026-11-10T11:59:30Z" }]);
    }
    const lastWrite = refreshed.updateState.mock.calls
      .map((c) => c[2])
      .filter((w) => "metricSources" in w)
      .pop();
    state.metricSources = lastWrite.metricSources;

    const { recorded, calls } = await buildDag({
      params: {
        snapshotSettings: snapshotSettings(
          [...BASE_METRICS, "a3", "c1"],
          LATER_END,
        ),
        incrementalRefreshStartTime: LATER_END,
      },
      state,
    });
    const names = recorded.map((r) => r.name);

    expect(names.some((n) => n.startsWith("create_metrics_source_"))).toBe(
      false,
    );
    expect(
      argsOf(recorded, calls, "insert_metrics_source_data_")
        .map((a) => (a.lastMaxTimestamp === null ? null : a.name))
        .sort(),
    ).toEqual(
      state.metricSources
        .map((s) => `insert_metrics_source_data_${s.groupId}`)
        .sort(),
    );
  });
});
