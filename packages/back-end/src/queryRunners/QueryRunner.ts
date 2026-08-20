import EventEmitter from "events";
import { ExternalIdCallback, QueryResponse } from "shared/types/integrations";
import {
  Queries,
  QueryInterface,
  QueryPointer,
  QueryStatus,
  QueryType,
  RunQueryMetadata,
} from "shared/types/query";
import { getMaxConcurrentQueriesLimit, parseOptionalInt } from "shared/util";
import {
  countRunningQueries,
  createNewQuery,
  createNewQueryFromCached,
  getQueriesByIds,
  getRecentQuery,
  markPendingQueriesAsFailed,
  updateQuery,
  updateQueryIfPending,
  updateQueryIfRunning,
} from "back-end/src/models/QueryModel";
import { SourceIntegrationInterface } from "back-end/src/types/Integration";
import { getErrorMessage } from "back-end/src/util/errors";
import { logger } from "back-end/src/util/logger";
import { promiseAllChunks } from "back-end/src/util/promise";
import { ReqContext } from "back-end/types/request";
import { ApiReqContext } from "back-end/types/api";
import {
  ExperimentUpdateExecutionLogger,
  ExperimentUpdateTimingPhase,
} from "back-end/src/services/experimentUpdateExecutionLogger";

export type QueryMap = Map<string, QueryInterface>;

export type RunnerStatus = "pending" | "running" | "finishing" | "finished";

export type InterfaceWithQueries = {
  runStarted: Date | null;
  queries: Queries;
  organization: string;
  id: string;
};

export type QueryStatusEndpointResponse = {
  status: number;
  queryStatus: QueryStatus;
  elapsed: number;
  finished: number;
  total: number;
};

export type RowsType = Record<
  string,
  string | boolean | number | object | undefined
>[];
// eslint-disable-next-line
export type ProcessedRowsType = Record<string, any>;

export type StartQueryParams<Rows, ProcessedRows> = {
  name: string;
  displayTitle?: string;
  query: string;
  dependencies: string[];
  run: (
    query: string,
    setExternalId: ExternalIdCallback,
    queryMetadata: RunQueryMetadata,
  ) => Promise<QueryResponse<Rows>>;
  /** @deprecated */
  process?: (rows: Rows) => ProcessedRows;
  onSuccess?: (rows: Rows) => void | Promise<void>;
  onFailure?: () => void;
  queryType: QueryType;
  runAtEnd?: boolean;
};

const FINISH_EVENT = "finish";
// How long to wait before retrying a query that was queued due to concurrency limit.
// Wait is doubled on subsequent retries, capped at the maximum
const INITIAL_CONCURRENCY_TIMEOUT = 250;
const MAX_CONCURRENCY_TIMEOUT = 4000;

/**
 * How often to re-arm a dropped refresh while the runner is active.
 * Query completions normally drive refresh; this recovers single-shot
 * hand-offs that were lost (stale reads, dropped timers). Long on purpose:
 * recovery, not latency.
 */
const REFRESH_WATCHDOG_INTERVAL_MS = 5 * 60 * 1000;
/**
 * Stop retrying after this many consecutive failed refresh passes.
 * Missing snapshots (cancel deleted the doc) stand down instead of erroring.
 */
const MAX_CONSECUTIVE_REFRESH_FAILURES = 5;
const MAX_NAMES_IN_ERROR = 5;

const GENERIC_QUERY_FAILURE_ERROR =
  "Failed to run a majority of the database queries";

/**
 * Prefer a root-cause warehouse error over "Dependencies failed: ..."
 * cascade messages, then fall back to a generic failure string.
 */
export function getQueryFailureError(queryMap: QueryMap): string {
  const failed = Array.from(queryMap.values()).filter(
    (q) => q.status === "failed" && q.error,
  );
  const rootCause = failed.find(
    (q) => !q.error?.startsWith("Dependencies failed"),
  );
  return (rootCause ?? failed[0])?.error || GENERIC_QUERY_FAILURE_ERROR;
}

/**
 * Roll up pointer statuses: failed if at least half failed, running while
 * any are queued/running, partially-succeeded if a minority failed.
 */
export function rollupQueryStatus(queries: Queries): QueryStatus {
  const failedQueries = queries.filter((q) => q.status === "failed");
  const runningQueries = queries.filter((q) => q.status === "running");
  const queuedQueries = queries.filter((q) => q.status === "queued");

  const totalQueries = queries.length;

  if (failedQueries.length >= totalQueries / 2) return "failed";

  if (queuedQueries.length + runningQueries.length > 0) return "running";

  if (failedQueries.length > 0) return "partially-succeeded";

  return "succeeded";
}

/**
 * Refuse analysis when query docs or their stored results are missing from
 * the read. A partial map would otherwise zero-fill metrics into a published
 * "no difference" snapshot. Exported for tests.
 */
export function assertQueryMapComplete(
  queries: Queries,
  queryMap: QueryMap,
): void {
  const missing = queries.filter((pointer) => {
    const doc = queryMap.get(pointer.name);
    if (doc === undefined) return true;
    return (
      doc.status === "succeeded" &&
      (doc.result === undefined || doc.result === null)
    );
  });
  if (missing.length > 0) {
    const names = missing
      .slice(0, MAX_NAMES_IN_ERROR)
      .map((q) => q.name)
      .join(", ");
    throw new Error(
      `Refusing to run analysis with incomplete query results: ${missing.length} of ${queries.length} query docs are missing or have no stored result (${names}${missing.length > MAX_NAMES_IN_ERROR ? ", ..." : ""})`,
    );
  }
}

export async function getQueryMap(
  context: ReqContext,
  queries: Queries,
  cache?: QueryMap,
): Promise<QueryMap> {
  // Only fetch queries that are not already in the cache
  const idsToFetch = queries
    .filter((p) => !cache || !cache.has(p.name))
    .map((p) => p.query);

  const queryDocs = await getQueriesByIds(context, idsToFetch);

  const map: QueryMap = new Map(cache);
  queryDocs.forEach((query) => {
    const pointer = queries.find((qp) => qp.query === query.id);
    if (pointer) {
      map.set(pointer.name, query);

      // Cache only result-bearing successes so a partial read is re-fetched.
      if (
        query.status === "succeeded" &&
        query.result !== undefined &&
        query.result !== null &&
        cache
      ) {
        cache.set(pointer.name, query);
      }
    }
  });

  return map;
}

export abstract class QueryRunner<
  Model extends InterfaceWithQueries,
  Params,
  Result,
> {
  public model: Model;
  public integration: SourceIntegrationInterface;
  public context: ReqContext | ApiReqContext;
  private timer: null | NodeJS.Timeout = null;
  private emitter: EventEmitter;
  public status: RunnerStatus = "pending";
  public result: Result | null = null;
  public error = "";
  public runCallbacks: {
    [key: string]: {
      run: (
        query: string,
        setExternalId: ExternalIdCallback,
        queryMetadata: RunQueryMetadata,
      ) => Promise<QueryResponse<RowsType>>;
      process?: (rows: RowsType) => ProcessedRowsType;
      onSuccess?: (rows: RowsType) => void | Promise<void>;
      onFailure: () => void;
    };
  } = {};
  /** Blocks refresh until startAnalysis has persisted the query DAG. */
  private dagPersisted = false;
  private useCache: boolean;
  private pendingTimers: Record<string, NodeJS.Timeout> = {};
  private lockHeartbeatTimer: null | NodeJS.Timeout = null;
  private refreshWatchdogTimer: null | NodeJS.Timeout = null;
  /** Non-null while a refresh pass is in flight; watchdog skips re-arm then. */
  private refreshStartedAt: number | null = null;
  private consecutiveRefreshFailures = 0;
  /** Serializes refresh passes so two cannot analyze or mutate model at once. */
  private refreshChain: Promise<void> = Promise.resolve();
  private finishedQueryMapCache: QueryMap = new Map();
  protected experimentUpdateExecutionLogger: ExperimentUpdateExecutionLogger | null =
    null;

  public constructor(
    context: ReqContext | ApiReqContext,
    model: Model,
    integration: SourceIntegrationInterface,
    useCache = true,
  ) {
    this.model = model;
    this.integration = integration;
    this.useCache = useCache;
    this.context = context;
    this.emitter = new EventEmitter();

    if (!this.checkPermissions()) {
      this.context.permissions.throwPermissionError();
    }
  }

  abstract checkPermissions(): boolean;

  abstract startQueries(params: Params): Promise<Queries>;

  abstract runAnalysis(queryMap: QueryMap): Promise<Result>;

  abstract getLatestModel(): Promise<Model>;

  abstract updateModel(params: {
    status: QueryStatus;
    queries: Queries;
    runStarted?: Date;
    result?: Result;
    error?: string;
  }): Promise<Model>;

  private setTimer(id: string, timer: NodeJS.Timeout): void {
    if (this.isStopping()) {
      clearTimeout(timer);
      return;
    }
    this.pendingTimers[id] = timer;
  }

  private clearTimer(id: string): void {
    if (this.pendingTimers[id]) {
      clearTimeout(this.pendingTimers[id]);
      delete this.pendingTimers[id];
    }
  }

  private clearAllTimers(): void {
    for (const id of Object.keys(this.pendingTimers)) {
      clearTimeout(this.pendingTimers[id]);
      delete this.pendingTimers[id];
    }
  }

  private hasTimer(id: string): boolean {
    return this.pendingTimers[id] !== undefined;
  }

  private isFinished(): boolean {
    return this.status === "finished";
  }

  private isStopping(): boolean {
    return this.status === "finishing" || this.isFinished();
  }

  /**
   * Called periodically while the runner is active. Override to refresh an
   * external lock; default is a no-op.
   */
  protected onHeartbeat(): void {}

  private startLockHeartbeat(): void {
    if (this.lockHeartbeatTimer) return;
    this.lockHeartbeatTimer = setInterval(() => {
      this.onHeartbeat();
    }, 30000);
  }

  private stopLockHeartbeat(): void {
    if (this.lockHeartbeatTimer) {
      clearInterval(this.lockHeartbeatTimer);
      this.lockHeartbeatTimer = null;
    }
  }

  private startRefreshWatchdog(): void {
    if (this.refreshWatchdogTimer) return;
    this.refreshWatchdogTimer = setInterval(() => {
      this.runRefreshWatchdogCheck();
    }, REFRESH_WATCHDOG_INTERVAL_MS);
  }

  private stopRefreshWatchdog(): void {
    if (this.refreshWatchdogTimer) {
      clearInterval(this.refreshWatchdogTimer);
      this.refreshWatchdogTimer = null;
    }
  }

  /** Re-arm the debounced refresh when nothing else will. */
  private runRefreshWatchdogCheck(): void {
    if (this.status !== "running") return;
    if (this.timer || this.refreshStartedAt !== null) return;
    logger.debug(
      `Refresh watchdog for ${this.model.id}: re-arming the debounced refresh`,
    );
    this.onQueryFinish();
  }

  async onQueryFinish() {
    if (this.isStopping()) {
      logger.debug(
        "Query finished for " + this.model.id + " after the runner concluded",
      );
      return;
    }
    // Dependency-free queries can finish while startAnalysis is still
    // persisting the DAG; wait so refresh cannot read an empty query list.
    if (!this.dagPersisted) {
      logger.debug(
        "Query finished for " +
          this.model.id +
          " runner before DAG was persisted; deferring refresh",
      );
      return;
    }
    if (!this.timer) {
      logger.debug(
        "Query finished for " +
          this.model.id +
          " runner, refreshing in 1 second",
      );
      this.timer = setTimeout(() => {
        this.timer = null;
        this.queueRefreshPass();
      }, 1000);
    } else {
      logger.debug(
        "Query finished for " +
          this.model.id +
          " runner, timer already started",
      );
    }
  }

  /**
   * Persist a terminal error. Snapshot runners override to write only while
   * status is still running, so a cancel/reaper conclusion is not clobbered.
   */
  protected async writeErrorIfStillActive(error: string): Promise<void> {
    this.model = await this.updateModel({
      status: "failed",
      queries: this.model.queries,
      error,
    });
  }

  /** Clear timers, persist the error, and finish the runner. */
  private async shutDownWithError(error: string): Promise<void> {
    this.setStatus("finishing");
    this.stopRefreshWatchdog();
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.clearAllTimers();
    const fullError = "Error finalizing query results: " + error;
    try {
      await this.writeErrorIfStillActive(fullError);
    } catch (writeErr) {
      logger.error(
        writeErr,
        "Failed to persist error status for runner of " + this.model.id,
      );
    }
    this.setStatus("finished", fullError);
  }

  /** Enqueue one refresh pass on the serialized chain. */
  private queueRefreshPass(): void {
    this.refreshChain = this.refreshChain
      .then(() => this.runRefreshPass())
      .catch(async (e) => {
        // Keep the chain alive; count toward the failure budget.
        if (this.isFinished()) return;
        this.consecutiveRefreshFailures++;
        logger.error(
          e,
          "Unexpected error in refresh pass chain for " + this.model.id,
        );
        if (
          this.consecutiveRefreshFailures >= MAX_CONSECUTIVE_REFRESH_FAILURES
        ) {
          await this.shutDownWithError(getErrorMessage(e));
        }
      });
  }

  /**
   * Finish without writing an error when the DB record already concluded
   * elsewhere. Resolves waitForResults successfully so a user cancel does
   * not disable scheduled auto-updates.
   */
  private standDown(reason: string): void {
    logger.warn(`Runner of ${this.model.id} standing down: ${reason}`);
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.clearAllTimers();
    this.setStatus("finished", "");
  }

  /**
   * Whether the persisted model is already terminal. Default false; snapshot
   * runners override using their status field.
   */
  protected isModelTerminal(_model: Model): boolean {
    return false;
  }

  /**
   * True when getLatestModel failed because the snapshot doc is gone (cancel),
   * matching the message thrown by the three experiment snapshot runners.
   */
  protected isMissingModelError(error: unknown): boolean {
    return (
      error instanceof Error &&
      error.message.startsWith("Could not load snapshot model:")
    );
  }

  /**
   * One refresh pass: re-fetch the model, reconcile pointers, start ready
   * queries, finalize when done. Retried by the watchdog until the failure
   * budget is exhausted.
   */
  private async runRefreshPass(): Promise<void> {
    if (this.isFinished()) return;
    this.refreshStartedAt = Date.now();
    try {
      let latest: Model;
      try {
        logger.debug("Getting latest model for " + this.model.id);
        latest = await this.getLatestModel();
      } catch (e) {
        if (this.isFinished()) return;
        this.consecutiveRefreshFailures++;
        if (
          this.consecutiveRefreshFailures >= MAX_CONSECUTIVE_REFRESH_FAILURES
        ) {
          if (this.isMissingModelError(e)) {
            this.standDown(
              `model is missing after ${this.consecutiveRefreshFailures} attempts (${
                e instanceof Error ? e.message : String(e)
              })`,
            );
            return;
          }
          // Call updateModel so locks (e.g. aggregated fact tables) release.
          await this.shutDownWithError(getErrorMessage(e));
          return;
        }
        logger.warn(
          e,
          `Could not re-fetch model for runner of ${this.model.id} (attempt ${this.consecutiveRefreshFailures} of ${MAX_CONSECUTIVE_REFRESH_FAILURES}); the refresh watchdog will retry`,
        );
        return;
      }
      if (this.isFinished()) return;
      this.model = latest;
      if (this.isModelTerminal(latest)) {
        this.standDown("model is already terminal in the database");
        return;
      }
      // startAnalysis never runs with an empty DAG, so empty queries here
      // means cancelQueries() on another instance wrote queries: [].
      if (this.status === "running" && latest.queries.length === 0) {
        this.standDown("query list was emptied by a cancel");
        return;
      }
      try {
        const queryMap = await this.refreshQueryStatuses();
        if (this.isFinished()) return;
        await this.startReadyQueries(queryMap);
        this.consecutiveRefreshFailures = 0;
      } catch (e) {
        if (this.isFinished()) return;
        this.consecutiveRefreshFailures++;
        if (
          this.consecutiveRefreshFailures < MAX_CONSECUTIVE_REFRESH_FAILURES
        ) {
          logger.warn(
            e,
            `Error refreshing query statuses for runner of ${this.model.id} (attempt ${this.consecutiveRefreshFailures} of ${MAX_CONSECUTIVE_REFRESH_FAILURES}); the refresh watchdog will retry`,
          );
          return;
        }
        logger.error(
          e,
          "Error refreshing query statuses for runner of " + this.model.id,
        );
        await this.shutDownWithError(getErrorMessage(e));
      }
    } finally {
      this.refreshStartedAt = null;
    }
  }

  private async getQueryMap(pointers: Queries): Promise<QueryMap> {
    return getQueryMap(this.context, pointers, this.finishedQueryMapCache);
  }

  setExperimentUpdateExecutionLogger(
    logger: ExperimentUpdateExecutionLogger | null,
  ): void {
    this.experimentUpdateExecutionLogger = logger;
  }

  withExperimentUpdateTiming<T>(
    phase: ExperimentUpdateTimingPhase,
    fn: () => Promise<T> | T,
  ): Promise<T> | T {
    if (!this.experimentUpdateExecutionLogger) {
      return fn();
    }
    return this.experimentUpdateExecutionLogger.withTiming(phase, fn);
  }

  public async startAnalysis(params: Params): Promise<Model> {
    logger.debug(this.model.id + " runner: Starting queries");
    const queries = await this.withExperimentUpdateTiming("generateSql", () =>
      this.startQueries(params),
    );
    this.experimentUpdateExecutionLogger?.startPhase("runQueries");
    this.model.queries = queries;

    if (queries.length === 0) {
      this.experimentUpdateExecutionLogger?.endPhase("runQueries");
      const noQueriesError = "No queries were generated for this analysis";
      logger.debug(this.model.id + " runner: " + noQueriesError);
      const newModel = await this.updateModel({
        status: "failed",
        queries: [],
        runStarted: new Date(),
        error: noQueriesError,
      });
      this.model = newModel;
      this.setStatus("finished", noQueriesError);
      return newModel;
    }

    // If already finished (queries were cached)
    let error = "";
    let result: Result | undefined = undefined;

    const queryStatus = this.getOverallQueryStatus();
    if (queryStatus === "succeeded") {
      logger.debug(this.model.id + " runner: Query already succeeded (cached)");
      const queryMap = await this.getQueryMap(queries);
      try {
        // No refresh loop yet; incomplete cached results fail the run now.
        assertQueryMapComplete(queries, queryMap);
        this.experimentUpdateExecutionLogger?.endPhase("runQueries");
        result = await this.withExperimentUpdateTiming("analyze", () =>
          this.runAnalysis(queryMap),
        );
        logger.debug(this.model.id + " runner: Ran analysis successfully");
      } catch (e) {
        logger.error(e, this.model.id + " runner: Error running analysis");
        error = "Error running analysis: " + e.message;
      }
    } else if (queryStatus === "failed") {
      this.experimentUpdateExecutionLogger?.endPhase("runQueries");
      logger.debug(this.model.id + " runner: Query failed immediately");
      error = "Error running one or more database queries";
    }

    const newModel = await this.updateModel({
      status: error ? "failed" : queryStatus,
      queries,
      runStarted: new Date(),
      result: result,
      error: error,
    });
    this.model = newModel;
    this.dagPersisted = true;

    if (error || result) {
      this.setStatus("finished", error, result);
    } else {
      this.setStatus("running");
      // Pick up any query completions that happened before the DAG write.
      this.onQueryFinish();
    }

    return newModel;
  }

  private setStatus(
    status: RunnerStatus,
    error: string = "",
    result: Result | null = null,
  ) {
    // Status already up-to-date
    if (status === this.status) return;

    this.status = status;
    this.error = error;
    this.result = result;

    if (this.status === "running") {
      this.startLockHeartbeat();
      this.startRefreshWatchdog();
    }

    if (this.status === "finished") {
      this.stopLockHeartbeat();
      this.stopRefreshWatchdog();
      this.emitter.emit(FINISH_EVENT);
    }
  }

  public async waitForResults(): Promise<void> {
    // Already finished
    if (this.status === "finished") {
      if (this.error) {
        throw new Error(this.error);
      } else {
        return;
      }
    }

    // Otherwise, add a listener and wait
    await new Promise<void>((resolve, reject) => {
      this.emitter.once(FINISH_EVENT, () => {
        if (this.error) {
          reject(this.error);
        } else {
          resolve();
        }
      });
    });
  }

  public async startReadyQueries(queryMap: QueryMap): Promise<void> {
    const queuedQueries = Array.from(queryMap.values()).filter(
      (q) => q.status === "queued",
    );
    logger.debug(
      `Starting any queued queries for ${
        this.model.id
      } runner that are ready: ${queuedQueries.map((q) => q.id)}`,
    );
    for (const query of queuedQueries) {
      // If the query already has a timeout set, we don't need to queue it up again.
      if (this.hasTimer(query.id)) {
        continue;
      }
      // check if all dependencies are finished
      // assumes all dependencies are within the model; if any are not, query will hang
      // in queued state

      const failedDependencies: QueryPointer[] = [];
      const succeededDependencies: QueryPointer[] = [];
      const pendingDependencies: QueryPointer[] = [];

      const dependencyIds: string[] = query.dependencies ?? [];
      dependencyIds.forEach((dependencyId) => {
        const dependencyQuery = this.model.queries.find(
          (q) => q.query === dependencyId,
        );
        if (dependencyQuery === undefined) {
          throw new Error(`Dependency ${dependencyId} not found in model`);
        } else if (dependencyQuery.status === "succeeded") {
          succeededDependencies.push(dependencyQuery);
        } else if (dependencyQuery.status === "failed") {
          failedDependencies.push(dependencyQuery);
        } else {
          pendingDependencies.push(dependencyQuery);
        }
      });

      if (failedDependencies.length) {
        logger.debug(`${query.id}: Dependency failed...`);
        await updateQuery(this.context, query, {
          finishedAt: new Date(),
          status: "failed",
          error: `Dependencies failed: ${failedDependencies.map(
            (q) => q.query,
          )}`,
        });
        this.onQueryFinish();
        continue;
      }
      if (pendingDependencies.length) {
        logger.debug(`${query.id}: Dependencies pending...`);
        continue;
      }

      // if `runAtEnd = true` run if all queries that are not marked
      // `runAtEnd` are finished
      if (query.runAtEnd) {
        const pendingQueries = this.model.queries.filter(
          (q) =>
            !queryMap.get(q.name)?.runAtEnd &&
            (q.status === "queued" || q.status === "running"),
        );
        if (pendingQueries.length) {
          logger.debug(
            `${query.id}: "Run at end query" waiting for other queries to finish...`,
          );
          // Keep scanning. A later non-runAtEnd query may be ready.
          continue;
        }
      }

      if (succeededDependencies.length === dependencyIds.length) {
        logger.debug(`${query.id}: Dependencies completed, running...`);
        const runCallbacks = this.runCallbacks[query.id];
        if (runCallbacks === undefined) {
          logger.debug(`${query.id}: Run callbacks not found..`);
          await updateQuery(this.context, query, {
            finishedAt: new Date(),
            status: "failed",
            error: `Run callbacks not found`,
          });
          this.onQueryFinish();
        } else {
          if (await this.concurrencyLimitReached()) {
            this.queueQueryExecution(query);
          } else {
            await this.executeQuery(query, runCallbacks);
          }
        }
      }
    }
  }

  public async refreshQueryStatuses(): Promise<QueryMap> {
    const oldStatus = this.getOverallQueryStatus();
    logger.debug("Refreshing query statuses for " + this.model.id);

    // If no pointers are active, usually return. Mid-run with all-terminal
    // pointers means another writer persisted terminal statuses without
    // concluding the run; fall through and finalize from persisted results.
    if (
      !this.model.queries.some(
        (q) => q.status === "running" || q.status === "queued",
      )
    ) {
      if (this.status !== "running") {
        logger.debug(
          "No running or queued queries for " + this.model.id + ", return",
        );
        return new Map();
      }
      if (this.model.queries.length === 0) {
        // Unreachable if runRefreshPass stood down first; guard anyway.
        logger.debug(
          `No queries for ${this.model.id} but runner status is "${this.status}". ` +
            `The persisted query DAG is empty; nothing to refresh.`,
        );
        return new Map();
      }
      logger.warn(
        `All queries for ${this.model.id} are terminal but runner status is "${this.status}"; finalizing from persisted results`,
      );
    }

    const { hasChanges, queryMap } = await this.updateQueryPointers();

    const newStatus = this.getOverallQueryStatus();

    // Finalize even when hasChanges is false if this runner is mid-run and
    // overall status is already terminal. Pending runners keep the fast path.
    const needsFinalize = this.status === "running" && newStatus !== "running";

    logger.debug(
      this.model.id +
        " has changes? " +
        hasChanges +
        ", New Status: " +
        newStatus,
    );

    if (!hasChanges && !needsFinalize) return queryMap;

    let error: string | undefined = undefined;
    let result: Result | undefined = undefined;

    if (newStatus === "failed") {
      error = getQueryFailureError(queryMap);

      if (oldStatus === "running") {
        this.experimentUpdateExecutionLogger?.endPhase("runQueries");

        logger.debug(
          "Query failed for " +
            this.model.id +
            " runner, transitioning to error state",
        );
      }
    }
    if (
      (oldStatus === "running" || needsFinalize) &&
      (newStatus === "succeeded" || newStatus === "partially-succeeded")
    ) {
      // Incomplete reads throw here so the watchdog retries, not fail the run.
      assertQueryMapComplete(this.model.queries, queryMap);
      logger.info(
        `Running analysis for ${this.model.id} (${this.model.queries.length} queries, status ${newStatus})`,
      );
      try {
        this.experimentUpdateExecutionLogger?.endPhase("runQueries");
        result = await this.withExperimentUpdateTiming("analyze", () =>
          this.runAnalysis(queryMap),
        );
        logger.debug(`Queries ${newStatus}, ran analysis successfully`);
      } catch (e) {
        error = "Error running analysis: " + e.message;
        logger.error(e, `Queries ${newStatus}, failed running analysis`);
      }
    }

    const newModel = await this.updateModel({
      status: error ? "failed" : newStatus,
      queries: this.model.queries,
      result,
      // Empty string clears stale error text; mongoose strips undefined from $set.
      error: error ?? "",
    });
    this.model = newModel;

    if (error || result) {
      this.setStatus("finished", error, result);
    }
    return queryMap;
  }

  public async cancelQueries(): Promise<void> {
    if (
      !this.model.queries.some(
        (q) => q.status === "running" || q.status === "queued",
      )
    ) {
      return;
    }

    // Pointer status lags Mongo (the polling runner pushes updates), so a
    // "queued" pointer can have a "running" Mongo doc with externalId set.
    // Take both and let Mongo decide what's still cancellable.
    const pendingIds = this.model.queries
      .filter((q) => q.status === "running" || q.status === "queued")
      .map((q) => q.query);

    // Mark failed BEFORE issuing warehouse cancels. The original runner is
    // still alive with pending timers; paired with updateQueryIfPending in
    // executeQuery, this stops a queued query from being promoted (and
    // firing a fresh external job) while parallel cancel calls are in
    // flight. Also reflects the cancel in the queries-log UI immediately.
    if (pendingIds.length) {
      const affected = await markPendingQueriesAsFailed(
        this.context,
        pendingIds,
        "Query cancelled by user",
      );
      logger.debug(
        { modelId: this.model.id, affected, attempted: pendingIds.length },
        "Marked queries as cancelled in Mongo",
      );

      const queryDocs = await getQueriesByIds(this.context, pendingIds, false);

      // Cached copies (createNewQueryFromCached) share their upstream's
      // externalId via cachedQueryUsed; chase one hop to find it.
      const cachedSourceIds = Array.from(
        new Set(
          queryDocs
            .map((q) => q.cachedQueryUsed)
            .filter((id): id is string => Boolean(id)),
        ),
      );
      const cachedSourceDocs = cachedSourceIds.length
        ? await getQueriesByIds(this.context, cachedSourceIds, false)
        : [];
      const cachedSourceById = new Map(cachedSourceDocs.map((q) => [q.id, q]));

      // Dedupe by externalId so cached copies don't trigger duplicate cancels.
      type ExternalJob = { id: string; metadata?: Record<string, string> };
      const externalJobsById = new Map<string, ExternalJob>();
      for (const q of queryDocs) {
        if (q.externalId) {
          if (!externalJobsById.has(q.externalId)) {
            externalJobsById.set(q.externalId, {
              id: q.externalId,
              metadata: q.externalIdMetadata,
            });
          }
          continue;
        }
        if (q.cachedQueryUsed) {
          const source = cachedSourceById.get(q.cachedQueryUsed);
          if (source?.externalId && !externalJobsById.has(source.externalId)) {
            externalJobsById.set(source.externalId, {
              id: source.externalId,
              metadata: source.externalIdMetadata,
            });
          }
        }
      }
      const externalJobs = [...externalJobsById.values()];
      logger.debug(
        {
          datasourceId: this.integration.datasource.id,
          modelId: this.model.id,
          externalJobs: externalJobs.map((j) => ({
            id: j.id,
            metadataKeys: j.metadata ? Object.keys(j.metadata) : [],
          })),
        },
        `Cancelling ${externalJobs.length} external jobs`,
      );

      if (externalJobs.length) {
        await promiseAllChunks(
          externalJobs.map(({ id, metadata }) => {
            return async () => {
              if (!this.integration.cancelQuery) return;
              try {
                await this.integration.cancelQuery(id, metadata);
              } catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                logger.warn(
                  { err: e, externalId: id },
                  `Failed to cancel external job: ${msg}`,
                );
              }
            };
          }),
          5,
        );
      }
    }

    this.clearAllTimers();
    const newModel = await this.updateModel({
      queries: [],
      status: "failed",
      error: "",
    });
    this.model = newModel;

    this.setStatus("finished", "Queries cancelled by user");
  }

  public queueQueryExecution(
    query: QueryInterface,
    timeout: number = INITIAL_CONCURRENCY_TIMEOUT,
  ) {
    // Queue query randomly within the window [timeout, timeout*2) to reduce race conditions
    const jitter = Math.floor(Math.random() * timeout);
    logger.debug(
      `${query.id}: Query concurrency limit reached, waiting ${
        timeout + jitter
      } before retrying`,
    );
    this.setTimer(
      query.id,
      setTimeout(() => {
        this.executeQueryWhenReady(query, timeout).catch((e) => {
          // Clear the timer and re-queue; a thrown concurrency check used to
          // leave a stale pendingTimers entry that permanently skipped the query.
          this.clearTimer(query.id);
          if (this.isStopping()) return;
          logger.warn(
            e,
            `${query.id}: Error while retrying queued query; re-queueing`,
          );
          this.queueQueryExecution(
            query,
            Math.min(timeout * 2, MAX_CONCURRENCY_TIMEOUT),
          );
        });
      }, timeout + jitter),
    );
  }

  public async executeQueryWhenReady(
    doc: QueryInterface,
    currentTimeout: number = INITIAL_CONCURRENCY_TIMEOUT,
  ): Promise<void> {
    // If too many queries are running against the datastore, use capped exponential backoff to wait until they've finished
    const concurrencyLimitReached = await this.concurrencyLimitReached();
    if (concurrencyLimitReached) {
      const nextTimeout = Math.min(currentTimeout * 2, MAX_CONCURRENCY_TIMEOUT);
      this.queueQueryExecution(doc, nextTimeout);
      return;
    }

    this.clearTimer(doc.id);
    const runCallbacks = this.runCallbacks[doc.id];
    if (runCallbacks === undefined) {
      logger.debug(`${doc.id}: Run callbacks not found..`);
      await updateQuery(this.context, doc, {
        finishedAt: new Date(),
        status: "failed",
        error: `Run callbacks not found`,
      });
      return this.onQueryFinish();
    }
    return this.executeQuery(doc, runCallbacks);
  }

  public async executeQuery<
    Rows extends RowsType,
    ProcessedRows extends ProcessedRowsType,
  >(
    doc: QueryInterface,
    {
      run,
      process,
      onFailure,
      onSuccess,
    }: {
      run: (
        query: string,
        setExternalId: ExternalIdCallback,
        queryMetadata: RunQueryMetadata,
      ) => Promise<QueryResponse<Rows>>;
      process?: (rows: Rows) => ProcessedRows;
      onFailure: () => void;
      onSuccess?: (rows: Rows) => void | Promise<void>;
    },
  ): Promise<void> {
    // Update heartbeat for the query once every 30 seconds
    // This lets us detect orphaned queries where the thread died
    const timer = setInterval(() => {
      updateQuery(this.context, doc, { heartbeat: new Date() }).catch((e) => {
        logger.error(e);
      });
    }, 30000);

    // Run the query in the background
    logger.debug(`Start executing query in background: ${doc.id}`);
    // Conditional fence: bail if a concurrent cancel marked the doc failed
    // between scheduling and here — otherwise we'd fire a fresh external
    // job for a cancelled query.
    const stillPending = await updateQueryIfPending(this.context, doc, {
      status: "running",
      heartbeat: new Date(),
      startedAt: new Date(),
    });
    if (!stillPending) {
      clearInterval(timer);
      logger.debug(
        { queryId: doc.id, modelId: this.model.id },
        "Skipping execution — query no longer pending (likely cancelled)",
      );
      this.onQueryFinish();
      return;
    }
    if (this.isStopping()) {
      clearInterval(timer);
      await updateQueryIfRunning(this.context, doc, {
        finishedAt: new Date(),
        status: "failed",
        error: "Query runner concluded before execution",
      }).catch((e) =>
        logger.warn(
          e,
          `${doc.id}: Failed to stop query claimed during shutdown`,
        ),
      );
      return;
    }

    const setExternalId = async (
      id: string,
      metadata?: Record<string, string>,
    ) => {
      await updateQuery(this.context, doc, {
        externalId: id,
        ...(metadata ? { externalIdMetadata: metadata } : {}),
      });
    };

    run(doc.query, setExternalId, { queryType: doc.queryType || "unknown" })
      .then(async ({ rows, statistics }) => {
        clearInterval(timer);
        logger.debug("Query succeeded: " + doc.id);
        await updateQuery(this.context, doc, {
          finishedAt: new Date(),
          status: "succeeded",
          rawResult: rows,
          result: process ? process(rows) : rows,
          statistics: statistics,
        });
        if (onSuccess) {
          await onSuccess(rows);
        }
        this.onQueryFinish();
      })
      .catch(async (e) => {
        clearInterval(timer);
        logger.debug("Query failed: " + e.message);
        try {
          const updated = await updateQueryIfRunning(this.context, doc, {
            finishedAt: new Date(),
            status: "failed",
            error: e.message,
          });
          if (!updated) {
            logger.debug(
              `Query ${doc.id} failure not written: already terminal (e.g. user cancel)`,
            );
          }
          onFailure();
          this.onQueryFinish();
        } catch (err) {
          logger.error(err);
        }
      });
  }

  public async startQuery<
    Rows extends RowsType,
    ProcessedRows extends ProcessedRowsType,
  >(params: StartQueryParams<Rows, ProcessedRows>): Promise<QueryPointer> {
    const {
      name,
      displayTitle,
      query,
      dependencies,
      runAtEnd,
      run,
      process,
      onFailure: specifiedOnFailureCallback,
      onSuccess,
      queryType,
    } = params;
    // Re-use recent identical query if it exists
    if (this.useCache) {
      logger.debug("Trying to reuse existing query for " + name);
      try {
        // Use datasource-specific cache TTL if set, otherwise use global default
        const cacheTTLMins = parseOptionalInt(
          this.integration.datasource.settings.queryCacheTTLMins,
        );
        const existing = await getRecentQuery(
          this.integration.context.org.id,
          this.integration.datasource.id,
          query,
          cacheTTLMins,
        );
        if (existing) {
          // Query still running, periodically check the status
          if (existing.status === "running") {
            logger.debug(
              "Reusing previous query " +
                existing.id +
                " for query " +
                query +
                ". Currently running, checking every 3 seconds for changes",
            );
            const check = () => {
              getQueriesByIds(this.context, [existing.id], false)
                .then(async (queries) => {
                  const query = queries[0];
                  if (
                    !query ||
                    query.status === "failed" ||
                    query.status === "succeeded"
                  ) {
                    this.clearTimer(existing.id);
                    this.onQueryFinish();
                  } else {
                    // Still running, check again after a delay
                    this.setTimer(existing.id, setTimeout(check, 3000));
                  }
                })
                .catch(() => {
                  this.clearTimer(existing.id);
                  this.onQueryFinish();
                });
            };
            this.setTimer(existing.id, setTimeout(check, 3000));
          }
          // Query already finished
          else {
            logger.debug(
              "Reusing previous query for " + query + ". Already finished",
            );
            this.onQueryFinish();
          }
          logger.debug(
            "Creating query with cached values for " +
              query +
              " from " +
              existing.id,
          );
          const copiedCachedDoc = await createNewQueryFromCached({
            existing: existing,
            dependencies: dependencies,
            runAtEnd: runAtEnd,
          });
          return {
            name,
            query: copiedCachedDoc.id,
            status: copiedCachedDoc.status,
          };
        }
      } catch (e) {
        logger.error(e);
      }
    }

    // Create a new query in mongo
    logger.debug("Creating query for: " + name);
    const concurrencyLimitReached = await this.concurrencyLimitReached();
    const dependenciesComplete = dependencies.length === 0;
    const readyToRun =
      dependenciesComplete && !runAtEnd && !concurrencyLimitReached;
    const doc = await createNewQuery({
      query,
      queryType,
      displayTitle,
      datasource: this.integration.datasource.id,
      organization: this.integration.context.org.id,
      language: this.integration.getSourceProperties().queryLanguage,
      dependencies: dependencies,
      running: readyToRun,
      runAtEnd: runAtEnd,
    });

    logger.debug("Created new query " + doc.id + " for " + name);

    const defaultOnFailure = () => {};
    const onFailure = specifiedOnFailureCallback ?? defaultOnFailure;
    const runCallbacksEntry = {
      run,
      process: process as ((rows: RowsType) => ProcessedRowsType) | undefined,
      onFailure,
      onSuccess: onSuccess as
        | ((rows: RowsType) => void | Promise<void>)
        | undefined,
    };
    if (readyToRun) {
      this.executeQuery(doc, { run, process, onFailure, onSuccess });
    } else if (dependenciesComplete && !runAtEnd) {
      this.runCallbacks[doc.id] = runCallbacksEntry;
      this.queueQueryExecution(doc);
    } else {
      // save callback methods for execution later
      this.runCallbacks[doc.id] = runCallbacksEntry;
    }

    return {
      name,
      query: doc.id,
      status: doc.status,
    };
  }

  // Limit number of currently running queries
  private async concurrencyLimitReached(): Promise<boolean> {
    const numericConcurrencyLimit = getMaxConcurrentQueriesLimit(
      this.integration.datasource.type,
      this.integration.datasource.settings.maxConcurrentQueries,
    );
    // 0 means no limit.
    if (numericConcurrencyLimit === 0) return false;

    const numRunningQueries = await countRunningQueries(
      this.integration.context.org.id,
      this.integration.datasource.id,
    );
    return numRunningQueries >= numericConcurrencyLimit;
  }

  protected getOverallQueryStatus(): QueryStatus {
    return rollupQueryStatus(this.model.queries);
  }

  private async updateQueryPointers(): Promise<{
    hasChanges: boolean;
    queryMap: QueryMap;
  }> {
    // Reuse matching result-bearing successes; re-fetch the rest so partial reads can recover.
    const queryMap: QueryMap = new Map();
    for (const pointer of this.model.queries) {
      const queryId = pointer.query;
      const cachedQuery = this.finishedQueryMapCache.get(pointer.name);
      if (cachedQuery?.id === queryId) {
        queryMap.set(pointer.name, cachedQuery);
      }
    }

    const idsToFetch = this.model.queries
      .filter((pointer) => !queryMap.has(pointer.name))
      .map((p) => p.query);

    const queries = await getQueriesByIds(this.context, idsToFetch);

    queries.forEach((queryDoc) => {
      const pointer = this.model.queries.find((p) => p.query === queryDoc.id);
      if (!pointer) return;

      queryMap.set(pointer.name, queryDoc);

      // Cache succeeded queries that still carry their stored result. Partial
      // reads are left uncached so the next pass re-reads them.
      if (
        queryDoc.status === "succeeded" &&
        queryDoc.result !== undefined &&
        queryDoc.result !== null
      ) {
        this.finishedQueryMapCache.set(pointer.name, queryDoc);
      }
    });

    let hasChanges = false;
    this.model.queries.forEach((pointer) => {
      const queryDoc = queryMap.get(pointer.name);
      if (!queryDoc || pointer.status === queryDoc.status) {
        return;
      }
      hasChanges = true;
      pointer.status = queryDoc.status;
    });

    return {
      hasChanges,
      queryMap,
    };
  }
}
