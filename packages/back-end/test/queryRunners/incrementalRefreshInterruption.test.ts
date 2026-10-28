import mongoose from "mongoose";
import type { ExperimentSnapshotSettings } from "shared/types/experiment-snapshot";
import type {
  FactMetricInterface,
  FactTableInterface,
} from "shared/types/fact-table";
import type {
  QueryPointer,
  QueryStatus,
  RunQueryMetadata,
} from "shared/types/query";
import type { ExposureQuery } from "shared/types/datasource";
import type { IncrementalRefreshInterface } from "shared/validators";
import {
  connectTestMongo,
  disconnectTestMongo,
} from "back-end/test/test-helpers";
import {
  COLLECTION_NAME,
  IncrementalRefreshModel,
} from "back-end/src/models/IncrementalRefreshModel";
import type { Context } from "back-end/src/models/BaseModel";
import {
  getQueryStatusesByIds,
  failQueuedQueries,
} from "back-end/src/models/QueryModel";
import { startExperimentIncrementalRefreshQueries } from "back-end/src/queryRunners/ExperimentIncrementalRefreshQueryRunner";
import type {
  ProcessedRowsType,
  RowsType,
  StartQueryParams,
} from "back-end/src/queryRunners/QueryRunner";
import {
  getCancelledRunQueryStatuses,
  planInterruptedRunCleanup,
  releaseInterruptedRefresh,
  stopTimedOutRefresh,
} from "back-end/src/jobs/interruptedRefresh";
import type { SourceIntegrationInterface } from "back-end/src/types/Integration";
import type { ApiReqContext } from "back-end/types/api";
import { factMetricFactory } from "../factories/FactMetric.factory";
import { factTableFactory } from "../factories/FactTable.factory";

// Drives the real incremental refresh query plan against a simulated
// warehouse, interrupts it at every step, runs each cleanup path, then checks
// that the next refresh leaves every cache table equal to a clean full refresh.

jest.mock("back-end/src/models/QueryModel", () => ({
  ...jest.requireActual("back-end/src/models/QueryModel"),
  getQueryStatusesByIds: jest.fn(),
  failQueuedQueries: jest.fn(),
}));

jest.mock(
  "back-end/src/integrations/sql/fact-metrics/resolve-covariate-insert-path",
  () => ({
    resolveCovariateInsertPath: jest.fn(async () => ({
      path: "legacy",
      reason: "test",
    })),
  }),
);

const ORG = "org_1";
const BASE = Date.UTC(2024, 0, 1);
const toDate = (minute: number) => new Date(BASE + minute * 60_000);
const toMinute = (date: Date | string) =>
  (new Date(date).getTime() - BASE) / 60_000;

// ---------------------------------------------------------------------------
// Source data

type Exposure = { unit: string; variation: string; ts: number };
type FactEvent = { id: string; unit: string; ts: number };

const UNITS = 16;
const exposures: Exposure[] = Array.from({ length: UNITS }, (_, i) => ({
  unit: `u${i}`,
  variation: i % 2 ? "1" : "0",
  ts: 5 + i * 19,
}));
// A unit seen again later, in another variation.
exposures.push({ unit: "u1", variation: "0", ts: 250 });

const factTableIds = ["ft_a", "ft_b", "ft_c"];
const events = new Map<string, FactEvent[]>(
  factTableIds.map((ft, f) => [
    ft,
    exposures.flatMap((e, i) =>
      [-3, 1, 37, 88, 141].map((offset, j) => ({
        id: `${ft}_${i}_${j}`,
        unit: e.unit,
        ts: e.ts + offset + f,
      })),
    ),
  ]),
);
const covariateValue = (unit: string, ft: string) =>
  Number(unit.slice(1)) * 10 + factTableIds.indexOf(ft);

// ---------------------------------------------------------------------------
// Simulated warehouse

type UnitRow = {
  unit: string;
  variation: string;
  first: number;
  maxTs: number | null;
};
type Table =
  | { kind: "units"; rows: UnitRow[] }
  | { kind: "metric"; rows: { eventId: string; maxTs: number | null }[] }
  | { kind: "covariate"; rows: { unit: string; value: number }[] };

type Op =
  | { op: "drop"; table: string }
  | { op: "create"; table: string; kind: Table["kind"] }
  | { op: "updateUnits"; table: string; temp: string; lastMax: number | null }
  | { op: "rename"; from: string; to: string }
  | { op: "maxTs"; table: string }
  | {
      op: "insertMetric";
      table: string;
      units: string;
      ft: string;
      lastMax: number | null;
      end: number;
    }
  | {
      op: "insertCovariate";
      table: string;
      units: string;
      ft: string;
      lastMax: number | null;
    }
  | { op: "stats" };

const minuteOrNull = (d: Date | null | undefined) => (d ? toMinute(d) : null);
const afterWatermark = (ts: number, lastMax: number | null) =>
  lastMax === null ? ts >= 0 : ts > lastMax;
const maxOf = (values: (number | null)[]) => {
  const nums = values.filter((v): v is number => v !== null);
  return nums.length ? Math.max(...nums) : null;
};

class Warehouse {
  tables = new Map<string, Table>();
  now = 0;

  private get<K extends Table["kind"]>(name: string, kind: K) {
    const table = this.tables.get(name);
    if (!table || table.kind !== kind) {
      throw new Error(`Table ${name} does not exist`);
    }
    return table as Extract<Table, { kind: K }>;
  }

  private create(name: string, table: Table) {
    if (this.tables.has(name)) throw new Error(`Table ${name} already exists`);
    this.tables.set(name, table);
  }

  apply(op: Op): RowsType {
    switch (op.op) {
      case "drop":
        this.tables.delete(op.table);
        return [];
      case "create":
        this.create(op.table, { kind: op.kind, rows: [] } as Table);
        return [];
      case "updateUnits": {
        const existing = this.get(op.table, "units").rows;
        const fresh = exposures.filter(
          (e) => e.ts <= this.now && afterWatermark(e.ts, op.lastMax),
        );
        const batchMax = maxOf(fresh.map((e) => e.ts));
        const joint = [
          ...existing.map((r) => ({ ...r, variations: [r.variation] })),
          ...fresh.map((e) => ({
            unit: e.unit,
            variations: [e.variation],
            first: e.ts,
            maxTs: batchMax,
          })),
        ];
        const byUnit = new Map<string, typeof joint>();
        joint.forEach((r) =>
          byUnit.set(r.unit, [...(byUnit.get(r.unit) ?? []), r]),
        );
        const rows = [...byUnit.entries()].map(([unit, rs]) => {
          const variations = new Set(rs.flatMap((r) => r.variations));
          const maxTsValues = rs
            .map((r) => r.maxTs)
            .filter((v): v is number => v !== null);
          return {
            unit,
            variation:
              variations.size > 1 ? "__multiple__" : [...variations][0],
            first: Math.min(...rs.map((r) => r.first)),
            maxTs: maxTsValues.length ? Math.min(...maxTsValues) : null,
          };
        });
        this.create(op.temp, { kind: "units", rows });
        return [];
      }
      case "rename": {
        const table = this.tables.get(op.from);
        if (!table) throw new Error(`Table ${op.from} does not exist`);
        this.create(op.to, table);
        this.tables.delete(op.from);
        return [];
      }
      case "maxTs": {
        const table = this.tables.get(op.table);
        if (!table || table.kind === "covariate") {
          throw new Error(`Table ${op.table} does not exist`);
        }
        const max = maxOf(table.rows.map((r) => r.maxTs));
        return [
          {
            max_timestamp: max === null ? undefined : toDate(max).toISOString(),
          },
        ];
      }
      case "insertMetric": {
        const target = this.get(op.table, "metric");
        const units = new Map(
          this.get(op.units, "units").rows.map((r) => [r.unit, r]),
        );
        const window = (events.get(op.ft) ?? []).filter(
          (e) =>
            e.ts <= Math.min(this.now, op.end) &&
            afterWatermark(e.ts, op.lastMax),
        );
        const windowMax = maxOf(window.map((e) => e.ts));
        window
          .filter((e) => {
            const unit = units.get(e.unit);
            return !!unit && e.ts >= unit.first;
          })
          .forEach((e) =>
            target.rows.push({ eventId: e.id, maxTs: windowMax }),
          );
        return [];
      }
      case "insertCovariate": {
        const target = this.get(op.table, "covariate");
        this.get(op.units, "units")
          .rows.filter(
            (r) => op.lastMax === null || (r.maxTs ?? -1) > op.lastMax,
          )
          .forEach((r) =>
            target.rows.push({
              unit: r.unit,
              value: covariateValue(r.unit, op.ft),
            }),
          );
        return [];
      }
      case "stats":
        return [];
    }
  }
}

// ---------------------------------------------------------------------------
// Fake integration: each query string is the JSON of its warehouse effect,
// and each run waits on a gate the scheduler opens when it applies it.

type Gate = { op: Op; resolve: (rows: RowsType) => void };

function createIntegration(warehouse: Warehouse, exposureQuery: ExposureQuery) {
  const gates = new Map<string, Gate>();
  const gateWaiters = new Map<string, () => void>();
  const run = async (query: string, _: unknown, meta: RunQueryMetadata) => {
    const id = meta.queryId ?? "";
    const rows = await new Promise<RowsType>((resolve) => {
      gates.set(id, { op: JSON.parse(query) as Op, resolve });
      gateWaiters.get(id)?.();
    });
    return { rows };
  };
  const q = (op: Op) => JSON.stringify(op);
  const integration = {
    datasource: {
      id: "ds_1",
      settings: {
        queries: { exposure: [exposureQuery] },
        pipelineSettings: {},
      },
    },
    getSourceProperties: () => ({ maxColumns: 1000 }),
    generateTablePath: (name: string) => name,
    getDropOldIncrementalUnitsQuery: (p: { unitsTableFullName: string }) =>
      q({ op: "drop", table: p.unitsTableFullName }),
    getCreateExperimentIncrementalUnitsQuery: (p: {
      unitsTableFullName: string;
    }) => q({ op: "create", table: p.unitsTableFullName, kind: "units" }),
    getUpdateExperimentIncrementalUnitsQuery: (p: {
      unitsTableFullName: string;
      unitsTempTableFullName: string;
      lastMaxTimestamp: Date | null;
    }) =>
      q({
        op: "updateUnits",
        table: p.unitsTableFullName,
        temp: p.unitsTempTableFullName,
        lastMax: minuteOrNull(p.lastMaxTimestamp),
      }),
    getAlterNewIncrementalUnitsQuery: (p: {
      unitsTableFullName: string;
      unitsTempTableFullName: string;
    }) =>
      q({
        op: "rename",
        from: p.unitsTempTableFullName,
        to: p.unitsTableFullName,
      }),
    getMaxTimestampIncrementalUnitsQuery: (p: { unitsTableFullName: string }) =>
      q({ op: "maxTs", table: p.unitsTableFullName }),
    getCreateMetricSourceTableQuery: (p: {
      metricSourceTableFullName: string;
    }) =>
      q({ op: "create", table: p.metricSourceTableFullName, kind: "metric" }),
    getInsertMetricSourceDataQuery: (p: {
      metricSourceTableFullName: string;
      unitsSourceTableFullName: string;
      factTableId: string;
      lastMaxTimestamp: Date | null;
      incrementalRefreshStartTime: Date;
    }) =>
      q({
        op: "insertMetric",
        table: p.metricSourceTableFullName,
        units: p.unitsSourceTableFullName,
        ft: p.factTableId,
        lastMax: minuteOrNull(p.lastMaxTimestamp),
        end: toMinute(p.incrementalRefreshStartTime),
      }),
    getMaxTimestampMetricSourceQuery: (p: {
      metricSourceTableFullName: string;
    }) => q({ op: "maxTs", table: p.metricSourceTableFullName }),
    getDropMetricSourceCovariateTableQuery: (p: {
      metricSourceCovariateTableFullName: string;
    }) => q({ op: "drop", table: p.metricSourceCovariateTableFullName }),
    getCreateMetricSourceCovariateTableQuery: (p: {
      metricSourceCovariateTableFullName: string;
    }) =>
      q({
        op: "create",
        table: p.metricSourceCovariateTableFullName,
        kind: "covariate",
      }),
    getInsertMetricSourceCovariateDataQuery: (p: {
      metricSourceCovariateTableFullName: string;
      unitsSourceTableFullName: string;
      factTableId: string;
      lastCovariateSuccessfulMaxTimestamp: Date | null;
    }) =>
      q({
        op: "insertCovariate",
        table: p.metricSourceCovariateTableFullName,
        units: p.unitsSourceTableFullName,
        ft: p.factTableId,
        lastMax: minuteOrNull(p.lastCovariateSuccessfulMaxTimestamp),
      }),
    getIncrementalRefreshStatisticsQuery: () => q({ op: "stats" }),
    runDropTableQuery: run,
    runIncrementalWithNoOutputQuery: run,
    runMaxTimestampQuery: run,
    runIncrementalRefreshStatisticsQuery: run,
  } as unknown as SourceIntegrationInterface;

  const waitForGate = (id: string) =>
    new Promise<void>((resolve) => {
      if (gates.has(id)) return resolve();
      gateWaiters.set(id, resolve);
    });

  return { integration, gates, waitForGate };
}

// ---------------------------------------------------------------------------
// Query scheduler

type Phase = "queued" | "started" | "applied" | "succeeded" | "done";
type SimQuery = {
  id: string;
  name: string;
  query: string;
  dependencies: string[];
  params: StartQueryParams<RowsType, ProcessedRowsType>;
  status: QueryStatus;
  phase: Phase;
  promise?: Promise<{ rows: RowsType }>;
  rows?: RowsType;
};

type Schedule = "serial" | "waves";

class Interrupted extends Error {}

class SimRun {
  queries: SimQuery[] = [];
  steps = 0;
  failures: string[] = [];

  constructor(
    readonly snapshotId: string,
    readonly fullRefresh: boolean,
    private readonly sim: ReturnType<typeof createIntegration>,
    private readonly warehouse: Warehouse,
    private readonly stopAfter: number | null,
    private readonly failQueryName: string | null,
  ) {}

  startQuery = async (
    params: StartQueryParams<RowsType, ProcessedRowsType>,
  ): Promise<QueryPointer> => {
    const id = `${this.snapshotId}_q${this.queries.length}`;
    this.queries.push({
      id,
      name: params.name,
      query: params.query,
      dependencies: params.dependencies,
      params,
      status: "queued",
      phase: "queued",
    });
    return { name: params.name, query: id, status: "queued" };
  };

  private step() {
    if (this.stopAfter !== null && this.steps >= this.stopAfter) {
      throw new Interrupted();
    }
    this.steps++;
  }

  private fail(q: SimQuery) {
    q.status = "failed";
    q.phase = "done";
    this.failures.push(q.name);
    q.params.onFailure?.();
  }

  private ready() {
    const byId = new Map(this.queries.map((q) => [q.id, q]));
    this.queries
      .filter((q) => q.status === "queued")
      .filter((q) =>
        q.dependencies.some((d) => byId.get(d)?.status === "failed"),
      )
      .forEach((q) => {
        q.status = "failed";
        q.phase = "done";
      });
    return this.queries.filter(
      (q) =>
        q.status === "queued" &&
        q.dependencies.every((d) => byId.get(d)?.status === "succeeded"),
    );
  }

  private async start(q: SimQuery) {
    this.step();
    if (q.name === this.failQueryName) {
      this.fail(q);
      return;
    }
    q.status = "running";
    q.phase = "started";
    const promise = q.params.run(q.query, async () => undefined, {
      queryId: q.id,
    } as RunQueryMetadata);
    q.promise = promise;
    const outcome = await Promise.race([
      promise.then(
        () => "done" as const,
        () => "rejected" as const,
      ),
      this.sim.waitForGate(q.id).then(() => "gate" as const),
    ]);
    if (outcome === "rejected") this.fail(q);
  }

  async apply(q: SimQuery, countStep = true) {
    if (countStep) this.step();
    const gate = this.sim.gates.get(q.id);
    if (!gate || !q.promise) throw new Error(`No gate for ${q.name}`);
    try {
      gate.resolve(this.warehouse.apply(gate.op));
    } catch (e) {
      this.fail(q);
      return;
    }
    q.rows = (await q.promise).rows;
    q.phase = "applied";
  }

  async succeed(q: SimQuery, countStep = true) {
    if (countStep) this.step();
    q.status = "succeeded";
    q.phase = "succeeded";
  }

  async callback(q: SimQuery, countStep = true) {
    if (countStep) this.step();
    await q.params.onSuccess?.(q.rows ?? []);
    q.phase = "done";
  }

  // Returns false when interrupted.
  async execute(schedule: Schedule): Promise<boolean> {
    try {
      for (;;) {
        const ready = this.ready();
        if (!ready.length) break;
        const batch = schedule === "serial" ? [ready[0]] : ready;
        for (const q of batch) await this.start(q);
        for (const q of batch.filter((q) => q.phase === "started")) {
          await this.apply(q);
        }
        for (const q of batch.filter((q) => q.phase === "applied")) {
          await this.succeed(q);
        }
        for (const q of batch.filter((q) => q.phase === "succeeded")) {
          await this.callback(q);
        }
      }
      return true;
    } catch (e) {
      if (e instanceof Interrupted) return false;
      throw e;
    }
  }

  // Lets in-flight queries finish after the cleanup ran.
  async finishLate(runner: boolean) {
    for (const q of this.queries) {
      if (q.phase === "started" && this.sim.gates.has(q.id)) {
        await this.apply(q, false);
      }
      if (!runner) continue;
      if (q.phase === "applied") await this.succeed(q, false);
      if (q.phase === "succeeded") await this.callback(q, false);
    }
  }
}

// ---------------------------------------------------------------------------
// Harness

const exposureQuery: ExposureQuery = {
  id: "exposure",
  name: "Exposure",
  description: "",
  query: "SELECT * FROM exposures",
  userIdType: "user_id",
  dimensions: [],
};

type Config = { groups: number; covariates: boolean };

function buildMetrics({ groups, covariates }: Config) {
  const fts = factTableIds.slice(0, groups);
  const factTableMap = new Map<string, FactTableInterface>(
    fts.map((id) => [
      id,
      factTableFactory.build({ id, name: id, userIdTypes: ["user_id"] }),
    ]),
  );
  const metrics: FactMetricInterface[] = fts.map((ft) =>
    factMetricFactory.build({
      id: `met_${ft}`,
      metricType: "mean",
      numerator: { factTableId: ft, column: "value", aggregation: "sum" },
      regressionAdjustmentEnabled: covariates,
    }),
  );
  const settings: ExperimentSnapshotSettings = {
    manual: false,
    dimensions: [],
    metricSettings: metrics.map((m) => ({ id: m.id })),
    goalMetrics: metrics.map((m) => m.id),
    secondaryMetrics: [],
    guardrailMetrics: [],
    activationMetric: null,
    defaultMetricPriorSettings: {
      override: false,
      proper: false,
      mean: 0,
      stddev: 0,
    },
    regressionAdjustmentEnabled: covariates,
    attributionModel: "firstExposure",
    experimentId: "exp",
    queryFilter: "",
    segment: "",
    skipPartialData: false,
    datasourceId: "ds_1",
    exposureQueryId: "exposure",
    startDate: toDate(0),
    endDate: toDate(100_000),
    variations: [],
  };
  return { factTableMap, metrics, settings };
}

let model: IncrementalRefreshModel;
const pendingWrites = new Set<Promise<unknown>>();

// Same lock and cleanup semantics as IncrementalRefreshModel, without Mongo,
// so the full sweep stays fast. The Mongo-backed sweep below checks it agrees.
class InMemoryIncrementalRefreshModel {
  docs = new Map<string, IncrementalRefreshInterface>();

  private locked(experimentId: string, snapshotId: string) {
    const doc = this.docs.get(experimentId);
    return doc && doc.currentExecutionSnapshotId === snapshotId ? doc : null;
  }

  async getByExperimentIdAndPhase(experimentId: string) {
    const doc = this.docs.get(experimentId);
    return doc ? structuredClone(doc) : null;
  }

  async getLockedBySnapshotId(experimentId: string, snapshotId: string) {
    const doc = this.locked(experimentId, snapshotId);
    return doc ? structuredClone(doc) : null;
  }

  async isLockedBySnapshotId(experimentId: string, snapshotId: string) {
    return !!this.locked(experimentId, snapshotId);
  }

  async acquireLock({
    experimentId,
    phase,
    snapshotId,
  }: {
    experimentId: string;
    phase: number;
    snapshotId: string;
  }) {
    const doc = this.docs.get(experimentId);
    if (doc && doc.currentExecutionSnapshotId) return false;
    this.docs.set(experimentId, {
      ...(doc ??
        ({
          id: `ir_${experimentId}`,
          organization: ORG,
          experimentId,
          phase,
          dateCreated: new Date(),
          dateUpdated: new Date(),
          unitsTableFullName: null,
          unitsMaxTimestamp: null,
          unitsDimensions: [],
          metricSources: [],
          metricCovariateSources: [],
          experimentSettingsHash: null,
        } as IncrementalRefreshInterface)),
      currentExecutionSnapshotId: snapshotId,
      lockHeartbeatAt: new Date(),
    });
    return true;
  }

  async updateByExperimentIdIfCurrentExecution(
    experimentId: string,
    snapshotId: string,
    data: Partial<IncrementalRefreshInterface>,
  ) {
    const doc = this.locked(experimentId, snapshotId);
    if (!doc) return false;
    Object.assign(doc, structuredClone(data));
    return true;
  }

  async releaseLock(experimentId: string, snapshotId: string) {
    const doc = this.locked(experimentId, snapshotId);
    if (doc) {
      doc.currentExecutionSnapshotId = null;
      doc.lockHeartbeatAt = null;
    }
  }

  async releaseLockAfterInterruptedRun(
    experimentId: string,
    snapshotId: string,
    plan: { metricGroupIdsToRebuild: string[]; forceFullRefresh: boolean },
  ) {
    const doc = this.locked(experimentId, snapshotId);
    if (!doc) return false;
    doc.currentExecutionSnapshotId = null;
    doc.lockHeartbeatAt = null;
    if (plan.forceFullRefresh) doc.unitsTableFullName = null;
    const keep = (s: { groupId: string }) =>
      !plan.metricGroupIdsToRebuild.includes(s.groupId);
    doc.metricSources = doc.metricSources.filter(keep);
    doc.metricCovariateSources = doc.metricCovariateSources.filter(keep);
    return true;
  }
}

async function drainWrites() {
  while (pendingWrites.size) {
    await Promise.allSettled([...pendingWrites]);
  }
}

function createModel(backend: "memory" | "mongo") {
  const modelContext = {
    org: { id: ORG },
    populateForeignRefs: jest.fn().mockResolvedValue(undefined),
    models: {},
  } as unknown as Context;
  const m =
    backend === "mongo"
      ? new IncrementalRefreshModel(modelContext)
      : (new InMemoryIncrementalRefreshModel() as unknown as IncrementalRefreshModel);
  const write = m.updateByExperimentIdIfCurrentExecution.bind(m);
  m.updateByExperimentIdIfCurrentExecution = (...args) => {
    const p = write(...args);
    pendingWrites.add(p);
    p.finally(() => pendingWrites.delete(p)).catch(() => undefined);
    return p;
  };
  return m;
}

const logger = {
  warn: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
};
const context = () =>
  ({
    org: { id: ORG, settings: {} },
    models: { incrementalRefresh: model, segments: { getById: jest.fn() } },
    logger,
  }) as unknown as ApiReqContext;

const getDoc = (experimentId: string) =>
  model.getByExperimentIdAndPhase(experimentId, 0);

let snapshotCounter = 0;

class Experiment {
  warehouse = new Warehouse();
  sim = createIntegration(this.warehouse, exposureQuery);
  built: ReturnType<typeof buildMetrics>;

  constructor(
    readonly id: string,
    readonly config: Config,
  ) {
    this.built = buildMetrics(config);
  }

  async startRun({
    now,
    fullRefresh,
    stopAfter = null,
    failQueryName = null,
    schedule = "serial",
  }: {
    now: number;
    fullRefresh: boolean;
    stopAfter?: number | null;
    failQueryName?: string | null;
    schedule?: Schedule;
  }) {
    const snapshotId = `snp_${++snapshotCounter}`;
    const locked = await model.acquireLock({
      experimentId: this.id,
      phase: 0,
      snapshotId,
      legacyExperimentSettingsHash: "unused",
    });
    if (!locked) throw new Error("Could not acquire the lock");
    this.warehouse.now = now;
    const run = new SimRun(
      snapshotId,
      fullRefresh,
      this.sim,
      this.warehouse,
      stopAfter,
      failQueryName,
    );
    const { factTableMap, metrics, settings } = this.built;
    await startExperimentIncrementalRefreshQueries(
      context(),
      {
        snapshotType: "standard",
        snapshotSettings: { ...settings, experimentId: this.id },
        variationNames: ["Control", "Variant"],
        metricMap: new Map(metrics.map((m) => [m.id, m])),
        factTableMap,
        queryParentId: snapshotId,
        experimentId: this.id,
        experimentQueryMetadata: null,
        fullRefresh,
        incrementalRefreshStartTime: toDate(now),
      },
      this.sim.integration,
      run.startQuery,
      null,
    );
    const finished = await run.execute(schedule);
    await drainWrites();
    return { run, finished };
  }

  // A run to completion, released the way the runner releases it.
  async completeRun(now: number, fullRefresh: boolean, schedule?: Schedule) {
    const { run, finished } = await this.startRun({
      now,
      fullRefresh,
      schedule,
    });
    expect(finished).toBe(true);
    await this.release(run);
    return run;
  }

  async release(run: SimRun) {
    if (!run.failures.length) {
      await model.updateByExperimentIdIfCurrentExecution(
        this.id,
        run.snapshotId,
        { materializedBySnapshotId: run.snapshotId },
      );
    }
    await model.releaseLock(this.id, run.snapshotId);
  }

  // What the cache tables hold, as the statistics queries read them.
  async contents() {
    const doc = await getDoc(this.id);
    if (!doc?.unitsTableFullName) throw new Error("No units table recorded");
    const units = this.warehouse.tables.get(doc.unitsTableFullName);
    if (units?.kind !== "units") throw new Error("Units table missing");
    const metricRows: Record<string, string[]> = {};
    const covariates: Record<string, Record<string, number>> = {};
    for (const ft of factTableIds.slice(0, this.config.groups)) {
      const sources = doc.metricSources.filter((s) => s.factTableId === ft);
      expect(sources).toHaveLength(1);
      const table = this.warehouse.tables.get(sources[0].tableFullName);
      if (table?.kind !== "metric")
        throw new Error(`No metric table for ${ft}`);
      metricRows[ft] = table.rows.map((r) => r.eventId).sort();
      if (!this.config.covariates) continue;
      const covSource = doc.metricCovariateSources.find(
        (s) => s.groupId === sources[0].groupId,
      );
      if (!covSource) throw new Error(`No covariate source for ${ft}`);
      const cov = this.warehouse.tables.get(covSource.tableFullName);
      if (cov?.kind !== "covariate") {
        throw new Error(`No covariate table for ${ft}`);
      }
      const maxByUnit: Record<string, number> = {};
      cov.rows.forEach((r) => {
        maxByUnit[r.unit] = Math.max(maxByUnit[r.unit] ?? -Infinity, r.value);
      });
      covariates[ft] = maxByUnit;
    }
    return {
      units: units.rows
        .map((r) => `${r.unit}:${r.variation}:${r.first}`)
        .sort(),
      metricRows,
      covariates,
    };
  }
}

// What a clean full refresh at `now` holds, from the source data alone.
function expectedContents(config: Config, now: number) {
  const units = new Map<string, { variations: Set<string>; first: number }>();
  exposures
    .filter((e) => e.ts <= now)
    .forEach((e) => {
      const u = units.get(e.unit) ?? { variations: new Set(), first: e.ts };
      u.variations.add(e.variation);
      u.first = Math.min(u.first, e.ts);
      units.set(e.unit, u);
    });
  const metricRows: Record<string, string[]> = {};
  const covariates: Record<string, Record<string, number>> = {};
  factTableIds.slice(0, config.groups).forEach((ft) => {
    metricRows[ft] = (events.get(ft) ?? [])
      .filter((e) => {
        const u = units.get(e.unit);
        return e.ts <= now && !!u && e.ts >= u.first;
      })
      .map((e) => e.id)
      .sort();
    if (config.covariates) {
      covariates[ft] = Object.fromEntries(
        [...units.keys()].map((unit) => [unit, covariateValue(unit, ft)]),
      );
    }
  });
  return {
    units: [...units.entries()]
      .map(
        ([unit, u]) =>
          `${unit}:${u.variations.size > 1 ? "__multiple__" : [...u.variations][0]}:${u.first}`,
      )
      .sort(),
    metricRows,
    covariates,
  };
}

// ---------------------------------------------------------------------------
// Cleanup paths

type CleanupPath = "reaper" | "timedOut" | "cancel";

const snapshotOf = (experimentId: string, run: SimRun) => ({
  id: run.snapshotId,
  experiment: experimentId,
  organization: ORG,
  runnerKind: run.fullRefresh
    ? ("incremental-full" as const)
    : ("incremental-update" as const),
  queries: run.queries.map((q) => ({
    name: q.name,
    query: q.id,
    status: q.status,
  })),
});

async function cleanUp(
  path: CleanupPath,
  experimentId: string,
  run: SimRun,
): Promise<boolean> {
  const snapshot = snapshotOf(experimentId, run);
  const byId = new Map(run.queries.map((q) => [q.id, q]));
  switch (path) {
    case "reaper":
      return releaseInterruptedRefresh(
        context(),
        snapshot,
        new Map(run.queries.map((q) => [q.id, q.status])),
      );
    case "timedOut": {
      jest.mocked(getQueryStatusesByIds).mockImplementation(async (_, ids) =>
        ids.flatMap((id) => {
          const q = byId.get(id);
          return q ? [{ id, status: q.status, createdAt: new Date() }] : [];
        }),
      );
      jest.mocked(failQueuedQueries).mockImplementation(async (_, ids) =>
        ids.filter((id) => {
          const q = byId.get(id);
          if (q?.status !== "queued") return false;
          q.status = "failed";
          return true;
        }),
      );
      const { needsFullRefresh } = await stopTimedOutRefresh(
        context(),
        snapshot,
      );
      return needsFullRefresh;
    }
    case "cancel": {
      const before = run.queries.map((q) => ({ id: q.id, status: q.status }));
      run.queries
        .filter((q) => q.status === "queued" || q.status === "running")
        .forEach((q) => (q.status = "failed"));
      const after = run.queries.map((q) => ({ id: q.id, status: q.status }));
      return releaseInterruptedRefresh(
        context(),
        snapshot,
        getCancelledRunQueryStatuses(before, after),
      );
    }
  }
}

// ---------------------------------------------------------------------------

const SETUP_AT = 100;
const INTERRUPTED_AT = 200;
const NEXT_AT = 300;

let experimentCounter = 0;
async function setUpExperiment(config: Config) {
  const exp = new Experiment(`exp_${++experimentCounter}`, config);
  await exp.completeRun(SETUP_AT, true);
  return exp;
}

// Refreshes as the app would next: a full refresh when the cleanup asked
// for one or the units table is gone, otherwise an Update.
async function nextRefresh(exp: Experiment, needsFullRefresh: boolean) {
  const doc = await getDoc(exp.id);
  const fullRefresh = needsFullRefresh || !doc?.unitsTableFullName;
  const run = await exp.completeRun(NEXT_AT, fullRefresh);
  expect(run.failures).toEqual([]);
}

const configs: Config[] = [1, 2, 3].flatMap((groups) =>
  [false, true].map((covariates) => ({ groups, covariates })),
);
const label = (c: Config) =>
  `${c.groups} group(s), covariates ${c.covariates ? "on" : "off"}`;

async function countSteps(
  config: Config,
  fullRefresh: boolean,
  schedule: Schedule,
) {
  const exp = await setUpExperiment(config);
  const { run, finished } = await exp.startRun({
    now: INTERRUPTED_AT,
    fullRefresh,
    schedule,
  });
  expect(finished).toBe(true);
  return run.steps;
}

const modes = [
  { mode: "Update", fullRefresh: false },
  { mode: "Full refresh", fullRefresh: true },
];
const paths: {
  path: CleanupPath;
  late: ("none" | "warehouse" | "runner")[];
}[] = [
  { path: "reaper", late: ["none", "warehouse"] },
  { path: "timedOut", late: ["none", "runner"] },
  { path: "cancel", late: ["none", "warehouse", "runner"] },
];

// Interrupts a run after each step in turn, cleans up through every path,
// then checks the next refresh. Returns a description of each bad outcome.
async function sweep(
  config: Config,
  fullRefresh: boolean,
  schedules: Schedule[],
) {
  const failures: string[] = [];
  for (const schedule of schedules) {
    const total = await countSteps(config, fullRefresh, schedule);
    for (let stopAfter = 0; stopAfter < total; stopAfter++) {
      for (const { path, late } of paths) {
        for (const lateMode of late) {
          const exp = await setUpExperiment(config);
          const { run, finished } = await exp.startRun({
            now: INTERRUPTED_AT,
            fullRefresh,
            stopAfter,
            schedule,
          });
          expect(finished).toBe(false);
          const needsFullRefresh = await cleanUp(path, exp.id, run);
          const where = `${schedule} step ${stopAfter} (${run.queries
            .filter((q) => q.phase !== "queued")
            .map((q) => `${q.name}:${q.phase}`)
            .slice(-3)
            .join(", ")}) via ${path}, late ${lateMode}`;
          const doc = await getDoc(exp.id);
          if (doc?.currentExecutionSnapshotId !== null) {
            failures.push(`${where}: lock not released`);
            continue;
          }
          if (lateMode !== "none") {
            await run.finishLate(lateMode === "runner");
            await drainWrites();
          }
          try {
            await nextRefresh(exp, needsFullRefresh);
            expect(await exp.contents()).toEqual(
              expectedContents(config, NEXT_AT),
            );
          } catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            failures.push(
              `${where}: ${message.split("\n").slice(0, 12).join(" ")}`,
            );
          }
        }
      }
    }
  }
  return failures;
}

describe("incremental refresh interruption (in-memory lock state)", () => {
  beforeAll(() => {
    model = createModel("memory");
  });

  it.each(configs)(
    "clean runs match the source data ($groups, $covariates)",
    async (config) => {
      const exp = await setUpExperiment(config);
      expect(await exp.contents()).toEqual(expectedContents(config, SETUP_AT));
      await exp.completeRun(INTERRUPTED_AT, false);
      await exp.completeRun(NEXT_AT, false);
      expect(await exp.contents()).toEqual(expectedContents(config, NEXT_AT));
    },
  );

  it.each(modes)(
    "leaves a finished $mode untouched",
    async ({ fullRefresh }) => {
      const config = { groups: 2, covariates: true };
      const exp = await setUpExperiment(config);
      const { run, finished } = await exp.startRun({
        now: INTERRUPTED_AT,
        fullRefresh,
      });
      expect(finished).toBe(true);
      const before = await getDoc(exp.id);
      for (const path of ["reaper", "timedOut", "cancel"] as const) {
        expect(await cleanUp(path, exp.id, run)).toBe(false);
      }
      expect(await getDoc(exp.id)).toEqual({
        ...before,
        currentExecutionSnapshotId: null,
        lockHeartbeatAt: null,
      });
      expect(await exp.contents()).toEqual(
        expectedContents(config, INTERRUPTED_AT),
      );
    },
  );

  it.each(modes)(
    "changes nothing when another snapshot holds the lock: $mode",
    async ({ fullRefresh }) => {
      const config = { groups: 2, covariates: true };
      const total = await countSteps(config, fullRefresh, "serial");
      for (let stopAfter = 0; stopAfter < total; stopAfter++) {
        for (const path of ["reaper", "timedOut", "cancel"] as const) {
          const exp = await setUpExperiment(config);
          const { run } = await exp.startRun({
            now: INTERRUPTED_AT,
            fullRefresh,
            stopAfter,
          });
          await model.updateByExperimentIdIfCurrentExecution(
            exp.id,
            run.snapshotId,
            { currentExecutionSnapshotId: "snp_other" },
          );
          const before = await getDoc(exp.id);
          const plan = planInterruptedRunCleanup({
            snapshotId: run.snapshotId,
            fullRefresh,
            queries: run.queries.map((q) => ({
              name: q.name,
              status: q.status,
            })),
          });
          const needsFullRefresh = await cleanUp(path, exp.id, run);
          expect(await getDoc(exp.id)).toEqual(before);
          if (path === "reaper") {
            expect(needsFullRefresh).toBe(
              plan.forceFullRefresh || plan.metricGroupIdsToRebuild.length > 0,
            );
          }
        }
      }
    },
  );

  describe.each(modes)("$mode", ({ fullRefresh }) => {
    it.each(configs.map((c) => [label(c), c] as const))(
      "recovers from an interruption at every step: %s",
      async (_, config) => {
        const schedules: Schedule[] =
          config.groups > 1 ? ["serial", "waves"] : ["serial"];
        expect(await sweep(config, fullRefresh, schedules)).toEqual([]);
      },
      120_000,
    );
  });
});

describe("incremental refresh interruption (Mongo lock state)", () => {
  beforeAll(async () => {
    await connectTestMongo();
    model = createModel("mongo");
  }, 60000);

  afterAll(async () => {
    await mongoose.connection.db!.collection(COLLECTION_NAME).deleteMany({});
    await disconnectTestMongo();
  });

  it.each(modes)(
    "recovers from an interruption at every step: $mode",
    async ({ fullRefresh }) => {
      const config = { groups: 2, covariates: true };
      expect(await sweep(config, fullRefresh, ["serial"])).toEqual([]);
    },
    120_000,
  );
});
