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
import type { IncrementalRefreshModel } from "back-end/src/models/IncrementalRefreshModel";
import {
  getQueryStatusesByIds,
  failQueuedQueries,
} from "back-end/src/models/QueryModel";
import {
  runsAsFullRefresh,
  startExperimentIncrementalRefreshQueries,
} from "back-end/src/queryRunners/ExperimentIncrementalRefreshQueryRunner";
import { createOrderedWriter } from "back-end/src/queryRunners/orderedWriter";
import {
  rollupQueryStatus,
  type ProcessedRowsType,
  type RowsType,
  type StartQueryParams,
} from "back-end/src/queryRunners/QueryRunner";
import {
  RESULTS_SUPERSEDED_ERROR,
  stopIncrementalRefresh,
} from "back-end/src/services/interruptedRefresh";
import type { SourceIntegrationInterface } from "back-end/src/types/Integration";
import type { ApiReqContext } from "back-end/types/api";
import { factMetricFactory } from "../factories/FactMetric.factory";
import { factTableFactory } from "../factories/FactTable.factory";

// Drives the real incremental refresh query plan against a simulated
// warehouse, stops it at every step through every stop path, then checks that
// the next refresh leaves every cache table equal to a clean full refresh.

jest.mock("back-end/src/models/QueryModel", () => ({
  ...jest.requireActual("back-end/src/models/QueryModel"),
  getQueryStatusesByIds: jest.fn(),
  failQueuedQueries: jest.fn(),
}));

jest.mock("back-end/src/util/logger", () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
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

// Each sweep replays hundreds of refreshes. They take a few seconds locally;
// CI runners can be several times slower.
jest.setTimeout(60_000);

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
  // Set when the run concluded without committing its results.
  resultsError: string | null = null;
  queries: SimQuery[] = [];
  steps = 0;
  failures: string[] = [];
  writer = createOrderedWriter();

  constructor(
    readonly snapshotId: string,
    readonly fullRefresh: boolean,
    private readonly sim: ReturnType<typeof createIntegration>,
    private readonly warehouse: Warehouse,
    private readonly stopAfter: number | null,
    private readonly failQueryIndex: number | number[] | null,
  ) {}

  startQuery = async (
    params: StartQueryParams<RowsType, ProcessedRowsType>,
  ): Promise<QueryPointer> => {
    if (this.queries.length === this.failPlanningAt) {
      throw new Error("Planning failed");
    }
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

  // Planning throws when it starts this query, as if a write failed.
  failPlanningAt: number | null = null;

  // Queries without dependencies start as soon as they are created.
  async startDependencyFree(applyEffects: boolean) {
    for (const q of this.queries.filter((x) => !x.dependencies.length)) {
      await this.start(q);
      if (applyEffects && q.phase === "started") await this.apply(q);
    }
  }

  // The run loses its lock once this many steps have run.
  stealLockAfter: number | null = null;
  stealLock: () => Promise<void> = async () => undefined;

  private async step() {
    if (this.stopAfter !== null && this.steps >= this.stopAfter) {
      throw new Interrupted();
    }
    if (this.steps === this.stealLockAfter) await this.stealLock();
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
    let blocked: SimQuery[];
    do {
      blocked = this.queries.filter(
        (q) =>
          q.status === "queued" &&
          q.dependencies.some((d) => byId.get(d)?.status === "failed"),
      );
      blocked.forEach((q) => {
        q.status = "failed";
        q.phase = "done";
      });
    } while (blocked.length);
    return this.queries.filter(
      (q) =>
        q.status === "queued" &&
        q.dependencies.every((d) => byId.get(d)?.status === "succeeded"),
    );
  }

  private async start(q: SimQuery) {
    await this.step();
    const index = this.queries.indexOf(q);
    if (
      Array.isArray(this.failQueryIndex)
        ? this.failQueryIndex.includes(index)
        : index === this.failQueryIndex
    ) {
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
    if (countStep) await this.step();
    const gate = this.sim.gates.get(q.id);
    if (!gate || !q.promise) throw new Error(`No gate for ${q.name}`);
    try {
      gate.resolve(this.warehouse.apply(gate.op));
      // The run can still fail after the warehouse, e.g. saving its state.
      q.rows = (await q.promise).rows;
    } catch (e) {
      this.fail(q);
      return;
    }
    q.phase = "applied";
  }

  async succeed(q: SimQuery, countStep = true) {
    if (countStep) await this.step();
    q.status = "succeeded";
    q.phase = "succeeded";
  }

  async callback(q: SimQuery, countStep = true) {
    if (countStep) await this.step();
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

// The lock semantics of IncrementalRefreshModel's fenced writes, in memory.
class InMemoryIncrementalRefreshModel {
  docs = new Map<string, IncrementalRefreshInterface>();

  // The next call to this method throws once, like a dropped connection.
  failOnce: string | null = null;
  private maybeFail(method: string) {
    if (this.failOnce !== method) return;
    this.failOnce = null;
    throw new Error(`${method} failed`);
  }

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
      lastCommittedSnapshotId: null,
      lockHeartbeatAt: new Date(),
    });
    return true;
  }

  async updateByExperimentIdIfCurrentExecution(
    experimentId: string,
    snapshotId: string,
    data: Partial<IncrementalRefreshInterface>,
  ) {
    this.maybeFail("updateByExperimentIdIfCurrentExecution");
    const doc = this.locked(experimentId, snapshotId);
    if (!doc) return false;
    Object.assign(doc, structuredClone(data));
    return true;
  }

  async releaseLock(experimentId: string, snapshotId: string) {
    this.maybeFail("releaseLock");
    const doc = this.locked(experimentId, snapshotId);
    if (doc) {
      doc.currentExecutionSnapshotId = null;
      doc.lockHeartbeatAt = null;
    }
  }

  async commitRunResults(experimentId: string, snapshotId: string) {
    this.maybeFail("commitRunResults");
    const doc = this.docs.get(experimentId);
    if (
      !doc ||
      (doc.currentExecutionSnapshotId !== snapshotId &&
        doc.lastCommittedSnapshotId !== snapshotId)
    ) {
      return false;
    }
    doc.lastCommittedSnapshotId = snapshotId;
    return true;
  }

  async markMaterialized(experimentId: string, snapshotId: string) {
    this.maybeFail("markMaterialized");
    const doc = this.docs.get(experimentId);
    if (doc?.lastCommittedSnapshotId !== snapshotId) return false;
    doc.materializedBySnapshotId = snapshotId;
    return true;
  }
}

async function drainWrites() {
  while (pendingWrites.size) {
    await Promise.allSettled([...pendingWrites]);
  }
}

function createModel() {
  const m =
    new InMemoryIncrementalRefreshModel() as unknown as IncrementalRefreshModel;
  const write = m.updateByExperimentIdIfCurrentExecution.bind(m);
  m.updateByExperimentIdIfCurrentExecution = (...args) => {
    const p = write(...args);
    pendingWrites.add(p);
    p.finally(() => pendingWrites.delete(p)).catch(() => undefined);
    return p;
  };
  return m;
}

const memoryModel = () => model as unknown as InMemoryIncrementalRefreshModel;

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

  // Starts a refresh the way the runner does: a marked units table turns an
  // Update into a full refresh once the lock is held.
  async startRun({
    now,
    fullRefresh,
    stopAfter = null,
    failQueryIndex = null,
    schedule = "serial",
    loseLockAfter = null,
    failPlanningAt = null,
  }: {
    now: number;
    fullRefresh: boolean;
    stopAfter?: number | null;
    failQueryIndex?: number | number[] | null;
    schedule?: Schedule;
    loseLockAfter?: number | null;
    failPlanningAt?: number | null;
  }) {
    const snapshotId = `snp_${++snapshotCounter}`;
    const locked = await model.acquireLock({
      experimentId: this.id,
      phase: 0,
      snapshotId,
      legacyExperimentSettingsHash: "unused",
    });
    if (!locked) throw new Error("Could not acquire the lock");
    const state = await model.getLockedBySnapshotId(this.id, snapshotId);
    const runsFull = runsAsFullRefresh(fullRefresh, state);
    this.warehouse.now = now;
    const run = new SimRun(
      snapshotId,
      runsFull,
      this.sim,
      this.warehouse,
      stopAfter,
      failQueryIndex,
    );
    run.stealLockAfter = loseLockAfter;
    run.failPlanningAt = failPlanningAt;
    // The run's heartbeat went stale and its lock was released for another.
    run.stealLock = () => model.releaseLock(this.id, snapshotId);
    const { factTableMap, metrics, settings } = this.built;
    const planning = startExperimentIncrementalRefreshQueries(
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
        fullRefresh: runsFull,
        incrementalRefreshStartTime: toDate(now),
      },
      this.sim.integration,
      run.startQuery,
      null,
      run.writer,
    );
    if (failPlanningAt !== null) {
      await expect(planning).rejects.toThrow("Planning failed");
      return { run, finished: false };
    }
    await planning;
    const finished = await run.execute(schedule);
    await drainWrites();
    return { run, finished };
  }

  // A run to completion, concluded the way the runner concludes it.
  async completeRun(now: number, fullRefresh: boolean, schedule?: Schedule) {
    const { run, finished } = await this.startRun({
      now,
      fullRefresh,
      schedule,
    });
    expect(finished).toBe(true);
    await this.conclude(run);
    return run;
  }

  // Concludes a finished run as the runner's updateModel does: commit while
  // holding the lock, save the snapshot, point the tables at it, stop. A
  // failing step throws, and calling this again retries, as the runner does.
  async conclude(run: SimRun, { saveFails = false } = {}) {
    await run.writer.flush();
    const status = finishedStatus(run);
    let committed = false;
    if (status !== "failed") {
      committed = await model.commitRunResults(this.id, run.snapshotId);
      run.resultsError = committed ? null : RESULTS_SUPERSEDED_ERROR;
    }
    if (saveFails) throw new Error("Saving the snapshot failed");
    if (committed) await model.markMaterialized(this.id, run.snapshotId);
    mockQueryStore(run);
    await stopIncrementalRefresh(context(), snapshotOf(this.id, run));
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
      if (table?.kind !== "metric") {
        throw new Error(`No metric table for ${ft}`);
      }
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
// Stop paths

type StopPath = "reaper" | "timedOut" | "cancel" | "runnerFailure";

// Query doc reads and writes go to the run's simulated queries.
function mockQueryStore(run: SimRun) {
  const byId = new Map(run.queries.map((q) => [q.id, q]));
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
}

// The run ended with results it was allowed to save.
const committed = (run: SimRun) =>
  finishedStatus(run) !== "failed" && run.resultsError === null;

function finishedStatus(run: SimRun) {
  const status = rollupQueryStatus(
    run.queries.map((q) => ({ name: q.name, query: q.id, status: q.status })),
  );
  return status === "failed" || status === "partially-succeeded"
    ? status
    : "succeeded";
}

const snapshotOf = (experimentId: string, run: SimRun) => ({
  id: run.snapshotId,
  experiment: experimentId,
  organization: ORG,
  queries: run.queries.map((q) => ({
    name: q.name,
    query: q.id,
    status: q.status,
  })),
});

// Every stop path fails the queries that have not started, then releases.
async function stop(path: StopPath, experimentId: string, run: SimRun) {
  if (path === "cancel") {
    // A user cancel fails every pending query first.
    run.queries
      .filter((q) => q.status === "queued" || q.status === "running")
      .forEach((q) => (q.status = "failed"));
    await model.releaseLock(experimentId, run.snapshotId);
    return;
  }
  if (path === "runnerFailure") await run.writer.flush();
  mockQueryStore(run);
  await stopIncrementalRefresh(context(), snapshotOf(experimentId, run));
}

// Statements that change the units table; each marks it first.
const changesUnits = (run: SimRun, name: string) =>
  [
    `drop_${run.snapshotId}_old`,
    `create_${run.snapshotId}`,
    `drop_${run.snapshotId}`,
    `alter_${run.snapshotId}`,
  ].includes(name);

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

// Refreshes as an Update would next, unless the units table is missing. A
// marked units table is left for the runner to turn into a full refresh.
async function nextRefresh(exp: Experiment, fullRefresh = false) {
  const doc = await getDoc(exp.id);
  const run = await exp.completeRun(
    NEXT_AT,
    fullRefresh || !doc?.unitsTableFullName,
  );
  expect(run.failures).toEqual([]);
  expect(committed(run)).toBe(true);
  // The recovering refresh leaves nothing marked.
  const after = await getDoc(exp.id);
  expect(after?.unitsDirtyBy ?? null).toBeNull();
  expect(
    [
      ...(after?.metricSources ?? []),
      ...(after?.metricCovariateSources ?? []),
    ].filter((s) => s.dirtyBy),
  ).toEqual([]);
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
  path: StopPath;
  late: ("none" | "warehouse" | "runner")[];
}[] = [
  { path: "reaper", late: ["none", "warehouse"] },
  { path: "timedOut", late: ["none", "runner"] },
  { path: "cancel", late: ["none", "warehouse", "runner"] },
  { path: "runnerFailure", late: ["none", "runner"] },
];

const failureText = (where: string, e: unknown) => {
  const message = e instanceof Error ? e.message : String(e);
  return `${where}: ${message.split("\n").slice(0, 12).join(" ")}`;
};

// Marks the run left must cover every table it may have changed, and none it
// didn't touch.
async function checkMarks(exp: Experiment, run: SimRun) {
  const doc = await getDoc(exp.id);
  const unitsStarted = run.queries.some(
    (q) => changesUnits(run, q.name) && q.phase !== "queued",
  );
  if (!unitsStarted) expect(doc?.unitsDirtyBy ?? null).toBeNull();
  const insertsStarted = run.queries.some(
    (q) => q.name.startsWith("insert_") && q.phase !== "queued",
  );
  if (!insertsStarted && !unitsStarted) {
    expect(
      [
        ...(doc?.metricSources ?? []),
        ...(doc?.metricCovariateSources ?? []),
      ].filter((s) => s.dirtyBy),
    ).toEqual([]);
  }
}

// Stops a run after each step in turn through every stop path, lets in-flight
// queries finish late, then checks the next refresh.
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
          await stop(path, exp.id, run);
          const where = `${schedule} step ${stopAfter} (${run.queries
            .filter((q) => q.phase !== "queued")
            .map((q) => `${q.name}:${q.phase}`)
            .slice(-3)
            .join(", ")}) via ${path}, late ${lateMode}`;
          try {
            expect(
              (await getDoc(exp.id))?.currentExecutionSnapshotId,
            ).toBeNull();
            await checkMarks(exp, run);
            if (lateMode !== "none") {
              await run.finishLate(lateMode === "runner");
              await drainWrites();
            }
            await nextRefresh(exp);
            expect(await exp.contents()).toEqual(
              expectedContents(config, NEXT_AT),
            );
          } catch (e) {
            failures.push(failureText(where, e));
          }
        }
      }
    }
  }
  return failures;
}

// The run's lock goes stale after each step in turn and a newer refresh takes
// it. The old run carries on: whatever it does after that must fail, and the
// newer refresh must see every table the old run may have changed.
async function sweepLostLock(
  config: Config,
  fullRefresh: boolean,
  newerFullRefresh: boolean,
) {
  const failures: string[] = [];
  const total = await countSteps(config, fullRefresh, "serial");
  for (let loseLockAfter = 0; loseLockAfter < total; loseLockAfter++) {
    const exp = await setUpExperiment(config);
    const { run, finished } = await exp.startRun({
      now: INTERRUPTED_AT,
      fullRefresh,
      loseLockAfter,
    });
    const where = `lock lost after step ${loseLockAfter}, newer ${newerFullRefresh ? "full refresh" : "Update"}`;
    try {
      expect(finished).toBe(true);
      await exp.conclude(run);
      expect(committed(run)).toBe(false);
      await nextRefresh(exp, newerFullRefresh);
      expect(await exp.contents()).toEqual(expectedContents(config, NEXT_AT));
    } catch (e) {
      failures.push(failureText(where, e));
    }
  }
  return failures;
}

// Fails each query in turn, lets the rest of the run finish, then concludes
// it the way the runner does.
async function sweepQueryFailures(config: Config, fullRefresh: boolean) {
  const failures: string[] = [];
  const count = (
    await (
      await setUpExperiment(config)
    ).startRun({ now: INTERRUPTED_AT, fullRefresh })
  ).run.queries.length;
  for (let failQueryIndex = 0; failQueryIndex < count; failQueryIndex++) {
    const exp = await setUpExperiment(config);
    const { run, finished } = await exp.startRun({
      now: INTERRUPTED_AT,
      fullRefresh,
      failQueryIndex,
    });
    const where = `${run.queries[failQueryIndex].name} failed`;
    try {
      expect(finished).toBe(true);
      await exp.conclude(run);
      expect((await getDoc(exp.id))?.currentExecutionSnapshotId).toBeNull();
      await nextRefresh(exp);
      expect(await exp.contents()).toEqual(expectedContents(config, NEXT_AT));
    } catch (e) {
      failures.push(failureText(where, e));
    }
  }
  return failures;
}

// A group's timestamp query and its covariate insert both fail.
async function sweepGroupFailures(config: Config, fullRefresh: boolean) {
  const failures: string[] = [];
  const names = (
    await (
      await setUpExperiment(config)
    ).startRun({ now: INTERRUPTED_AT, fullRefresh })
  ).run.queries.map((q) => q.name);
  const groupIds = names
    .filter((n) => n.startsWith("max_timestamp_metrics_source_"))
    .map((n) => n.replace("max_timestamp_metrics_source_", ""));
  for (const groupIndex of groupIds.keys()) {
    const exp = await setUpExperiment(config);
    const { run: probe } = await exp.startRun({
      now: INTERRUPTED_AT,
      fullRefresh,
      stopAfter: 0,
    });
    await stop("reaper", exp.id, probe);
    // Group ids are random per run, so find this run's by position.
    const groupId = probe.queries
      .map((q) => q.name)
      .filter((n) => n.startsWith("max_timestamp_metrics_source_"))
      .map((n) => n.replace("max_timestamp_metrics_source_", ""))[groupIndex];
    const failQueryIndex = probe.queries
      .map((q, i) => ({ name: q.name, i }))
      .filter(
        (q) =>
          q.name === `max_timestamp_metrics_source_${groupId}` ||
          q.name === `insert_metrics_covariate_data_${groupId}`,
      )
      .map((q) => q.i);
    const { run } = await exp.startRun({
      now: INTERRUPTED_AT,
      fullRefresh,
      failQueryIndex,
    });
    try {
      await exp.conclude(run);
      await nextRefresh(exp);
      expect(await exp.contents()).toEqual(expectedContents(config, NEXT_AT));
    } catch (e) {
      failures.push(failureText(`group ${groupIndex} failed`, e));
    }
  }
  return failures;
}

// Each step of concluding a finished run fails once, and the runner retries.
// The run keeps its results, the tables point at its snapshot only once it
// is saved, and the lock is released.
async function sweepConcludeRetries(config: Config, fullRefresh: boolean) {
  const failures: string[] = [];
  const steps = [
    "commitRunResults",
    "save",
    "markMaterialized",
    "releaseLock",
  ] as const;
  for (const failStep of steps) {
    const exp = await setUpExperiment(config);
    const before = (await getDoc(exp.id))?.materializedBySnapshotId;
    const { run } = await exp.startRun({ now: INTERRUPTED_AT, fullRefresh });
    const where = `${failStep} failing once`;
    try {
      if (failStep !== "save") memoryModel().failOnce = failStep;
      const firstAttempt = await exp
        .conclude(run, { saveFails: failStep === "save" })
        .then(() => true)
        .catch(() => false);
      if (failStep === "save") {
        // Never points at a snapshot whose save failed.
        expect((await getDoc(exp.id))?.materializedBySnapshotId).toBe(before);
      }
      if (!firstAttempt) await exp.conclude(run);
      expect(committed(run)).toBe(true);
      if (failStep === "releaseLock") {
        // A failed release isn't retried: the lock expires, and nothing is
        // marked, so the next refresh is an ordinary Update.
        expect((await getDoc(exp.id))?.currentExecutionSnapshotId).toBe(
          run.snapshotId,
        );
        await model.releaseLock(exp.id, run.snapshotId);
      }
      const doc = await getDoc(exp.id);
      expect(doc?.materializedBySnapshotId).toBe(run.snapshotId);
      expect(doc?.currentExecutionSnapshotId).toBeNull();
      expect(doc?.unitsDirtyBy ?? null).toBeNull();
      await nextRefresh(exp);
      expect(await exp.contents()).toEqual(expectedContents(config, NEXT_AT));
    } catch (e) {
      failures.push(failureText(where, e));
    }
  }
  return failures;
}

// Planning throws part-way, after queries without dependencies have started,
// and the run is stopped the way snapshot creation does on an error.
async function sweepFailedPlanning(config: Config, fullRefresh: boolean) {
  const failures: string[] = [];
  const count = (
    await (
      await setUpExperiment(config)
    ).startRun({ now: INTERRUPTED_AT, fullRefresh })
  ).run.queries.length;
  for (let failPlanningAt = 1; failPlanningAt < count; failPlanningAt++) {
    for (const applyEffectsFirst of [true, false]) {
      const exp = await setUpExperiment(config);
      const { run } = await exp.startRun({
        now: INTERRUPTED_AT,
        fullRefresh,
        failPlanningAt,
      });
      await run.startDependencyFree(applyEffectsFirst);
      await stop("reaper", exp.id, run);
      await run.finishLate(true);
      await drainWrites();
      const where = `planning failed at query ${failPlanningAt}${applyEffectsFirst ? "" : ", effects landing late"}`;
      try {
        expect((await getDoc(exp.id))?.currentExecutionSnapshotId).toBeNull();
        await nextRefresh(exp);
        expect(await exp.contents()).toEqual(expectedContents(config, NEXT_AT));
      } catch (e) {
        failures.push(failureText(where, e));
      }
    }
  }
  return failures;
}

// A dimension breakdown holds the lock, writes nothing, and its process dies.
// Nothing is marked, so the next refresh stays an Update.
async function expectBreakdownLockNeverForcesFullRefresh(config: Config) {
  const exp = await setUpExperiment(config);
  const unitsTable = (await getDoc(exp.id))?.unitsTableFullName;
  await model.acquireLock({
    experimentId: exp.id,
    phase: 0,
    snapshotId: "snp_breakdown",
    legacyExperimentSettingsHash: "unused",
  });
  await model.releaseLock(exp.id, "snp_breakdown");

  const doc = await getDoc(exp.id);
  expect(doc?.unitsDirtyBy ?? null).toBeNull();
  const run = await exp.completeRun(NEXT_AT, false);
  expect(run.fullRefresh).toBe(false);
  expect((await getDoc(exp.id))?.unitsTableFullName).toBe(unitsTable);
  expect(await exp.contents()).toEqual(expectedContents(config, NEXT_AT));
}

describe("incremental refresh interruption", () => {
  beforeAll(() => {
    model = createModel();
  });

  it.each(configs)(
    "clean runs match the source data ($groups, $covariates)",
    async (config) => {
      const exp = await setUpExperiment(config);
      expect(await exp.contents()).toEqual(expectedContents(config, SETUP_AT));
      await exp.completeRun(INTERRUPTED_AT, false);
      await exp.completeRun(NEXT_AT, false);
      expect(await exp.contents()).toEqual(expectedContents(config, NEXT_AT));
      expect((await getDoc(exp.id))?.unitsDirtyBy ?? null).toBeNull();
    },
  );

  it("refuses a retried commit once another run has taken the lock", async () => {
    const exp = await setUpExperiment({ groups: 1, covariates: false });
    const before = (await getDoc(exp.id))?.materializedBySnapshotId;
    const { run } = await exp.startRun({
      now: INTERRUPTED_AT,
      fullRefresh: false,
    });
    expect(await model.commitRunResults(exp.id, run.snapshotId)).toBe(true);
    // Its save stalls past the lock's expiry, and another run takes over.
    await model.releaseLock(exp.id, run.snapshotId);
    const { run: newer } = await exp.startRun({
      now: INTERRUPTED_AT + 50,
      fullRefresh: false,
    });

    expect(await model.commitRunResults(exp.id, run.snapshotId)).toBe(false);
    expect(await model.markMaterialized(exp.id, run.snapshotId)).toBe(false);
    expect((await getDoc(exp.id))?.materializedBySnapshotId).toBe(before);
    await exp.conclude(newer);
    expect((await getDoc(exp.id))?.materializedBySnapshotId).toBe(
      newer.snapshotId,
    );
  });

  it.each(configs)(
    "keeps Updates incremental after a breakdown's lock goes stale ($groups, $covariates)",
    (config) => expectBreakdownLockNeverForcesFullRefresh(config),
  );

  describe.each(modes)("$mode", ({ fullRefresh }) => {
    it.each(configs.map((c) => [label(c), c] as const))(
      "recovers from a stop at every step: %s",
      async (_, config) => {
        const schedules: Schedule[] =
          config.groups > 1 ? ["serial", "waves"] : ["serial"];
        expect(await sweep(config, fullRefresh, schedules)).toEqual([]);
      },
    );

    it.each(
      configs.flatMap((c) =>
        [false, true].map((newer) => [label(c), newer, c] as const),
      ),
    )(
      "recovers when the lock goes stale at every step: %s, newer full refresh %s",
      async (_, newerFullRefresh, config) => {
        expect(
          await sweepLostLock(config, fullRefresh, newerFullRefresh),
        ).toEqual([]);
      },
    );

    it.each(configs.map((c) => [label(c), c] as const))(
      "recovers from any one query failing: %s",
      async (_, config) => {
        expect(await sweepQueryFailures(config, fullRefresh)).toEqual([]);
      },
    );

    it.each(configs.map((c) => [label(c), c] as const))(
      "recovers when a group's timestamp query and covariate insert both fail: %s",
      async (_, config) => {
        expect(await sweepGroupFailures(config, fullRefresh)).toEqual([]);
      },
    );

    it.each(configs.map((c) => [label(c), c] as const))(
      "keeps its results when a conclude step fails once: %s",
      async (_, config) => {
        expect(await sweepConcludeRetries(config, fullRefresh)).toEqual([]);
      },
    );

    it.each(configs.map((c) => [label(c), c] as const))(
      "recovers when planning fails after queries started: %s",
      async (_, config) => {
        expect(await sweepFailedPlanning(config, fullRefresh)).toEqual([]);
      },
    );
  });
});
