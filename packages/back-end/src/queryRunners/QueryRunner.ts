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
import { logger } from "back-end/src/util/logger";
import { promiseAllChunks } from "back-end/src/util/promise";
import { ReqContext } from "back-end/types/request";
import { ApiReqContext } from "back-end/types/api";
import {
  ExperimentUpdateExecutionLogger,
  ExperimentUpdateTimingPhase,
} from "back-end/src/services/experimentUpdateExecutionLogger";

export type QueryMap = Map<string, QueryInterface>;

export type RunnerStatus = "pending" | "running" | "finished";

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

// How often the refresh watchdog re-arms the debounced refresh while the
// runner is active. Query completions normally drive the refresh, but every
// trigger is a single-shot in-memory hand-off: a transient error, a stale
// status read, or a lost concurrency-backoff timer can silently strand the
// model in "running" until the stalled-snapshot reaper errors it an hour
// later. The watchdog turns any such dropped trigger into a bounded delay.
// It exists for lost-trigger recovery, not latency, so the interval is
// deliberately long to keep the steady-state read load negligible.
const REFRESH_WATCHDOG_INTERVAL_MS = 5 * 60 * 1000;
// If a single refresh pass has been in flight for this long, assume one of
// its awaits will never settle: fence the stuck pass off (it abandons at its
// next checkpoint instead of publishing stale state) and start a fresh one.
// The clock restarts at every pass checkpoint, so this bounds one SEGMENT
// between checkpoints (model read / analysis / publish), not the whole pass.
// The fence exists because Mongo awaits are unbounded (no socketTimeout is
// configured), so a wedged connection would otherwise hang a pass forever.
// Stats-engine calls are bounded per call (local pool: 5 min acquire + 5 min
// call by default; external server: 10 min), but runSnapshotAnalyses runs
// its chunks sequentially, so a multi-chunk analysis on a slow engine can
// legitimately exceed this and be fenced while still progressing. That
// costs a duplicate (convergent) analysis on the replacement pass — an
// accepted trade-off; raise this if a deployment sees it regularly.
const REFRESH_STUCK_RETRIGGER_MS = 15 * 60 * 1000;
// After this many consecutive failed refresh passes, stop retrying and fail
// the run so the user sees a real error instead of an eternal "running".
// The counter is shared across model re-fetch failures, status-refresh
// failures and watchdog fences; when the pass that reaches the limit is a
// re-fetch failure the runner stands down (the model itself is gone —
// almost always a cancel) rather than failing the run.
const MAX_CONSECUTIVE_REFRESH_FAILURES = 5;
// How many missing/result-less query names to spell out in the
// assertQueryMapComplete error before eliding the rest.
const MAX_NAMES_IN_ERROR = 5;

const GENERIC_QUERY_FAILURE_ERROR =
  "Failed to run a majority of the database queries";

// Pick the most useful error to surface for a failed runner. Prefer a real
// failing query's error (e.g. the warehouse's invalid-SQL message) over the
// "Dependencies failed: ..." cascade messages the runner writes onto queries
// whose upstream failed, and fall back to a generic message when no query
// carries a usable error.
export function getQueryFailureError(queryMap: QueryMap): string {
  const failed = Array.from(queryMap.values()).filter(
    (q) => q.status === "failed" && q.error,
  );
  const rootCause = failed.find(
    (q) => !q.error?.startsWith("Dependencies failed"),
  );
  return (rootCause ?? failed[0])?.error || GENERIC_QUERY_FAILURE_ERROR;
}

// Overall status rollup for a set of query pointers: failed if at least
// half the queries failed, running while any are queued or running,
// partially-succeeded if a minority failed, succeeded otherwise.
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

// A partial query-doc read must never reach the analysis step: metrics whose
// query docs are missing from the map get silently zero-filled into the
// published result, which the UI then renders as a complete snapshot with
// "no difference" rows. Throwing turns a partial read into a retryable
// error instead of silently-wrong published data.
// Exported for tests.
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

      // If the query succeeded, add it to the cache
      // We could do this for failed queries too, but we may want to do retries in the future
      // Also, failed queries are tiny since they don't have result rows, so caching doesn't help much
      // Only cache docs that carry their stored result, so a partial read
      // (see assertQueryMapComplete) is re-read on the next pass instead of
      // being pinned in the cache.
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
  // Prevent early query completions from refreshing against a partial DAG.
  private dagPersisted = false;
  private useCache: boolean;
  private pendingTimers: Record<string, NodeJS.Timeout> = {};
  private lockHeartbeatTimer: null | NodeJS.Timeout = null;
  private refreshWatchdogTimer: null | NodeJS.Timeout = null;
  // Epoch ms when the currently-running refresh pass started, or null when
  // no pass is in flight. Used by the watchdog to detect a stuck pass.
  private refreshStartedAt: number | null = null;
  private consecutiveRefreshFailures = 0;
  // Refresh passes are strictly serialized on this chain so two passes can
  // never mutate this.model or run duplicate analyses concurrently. The
  // generation is a fence: the watchdog bumps it when it abandons a stuck
  // pass, and a fenced-off pass stops at its next checkpoint instead of
  // publishing stale state.
  private refreshChain: Promise<void> = Promise.resolve();
  private refreshGeneration = 0;
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

  // Called periodically while the runner is active. Override to refresh an
  // external lock; default is a no-op.
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

  // Re-arm the debounced refresh if nothing else is going to. See the
  // comment on REFRESH_WATCHDOG_INTERVAL_MS for why this exists.
  private runRefreshWatchdogCheck(): void {
    if (this.status !== "running") return;
    // A refresh is already scheduled
    if (this.timer) return;
    if (this.refreshStartedAt !== null) {
      const inFlightMs = Date.now() - this.refreshStartedAt;
      // A refresh pass is running normally
      if (inFlightMs < REFRESH_STUCK_RETRIGGER_MS) return;
      // A stuck pass counts as a failure: a permanently-hanging runner
      // (e.g. a wedged stats engine) must eventually fail loudly rather
      // than fence-and-restart forever.
      this.consecutiveRefreshFailures++;
      if (this.consecutiveRefreshFailures >= MAX_CONSECUTIVE_REFRESH_FAILURES) {
        logger.error(
          `Giving up on runner of ${this.model.id}: ${this.consecutiveRefreshFailures} consecutive refresh passes failed or hung`,
        );
        this.shutDownWithError(
          "Refresh repeatedly hung; results were not finalized",
        );
        return;
      }
      // Fence the stuck pass off and start over on a fresh chain. The stuck
      // pass (if one of its awaits ever settles) abandons at its next
      // checkpoint. Checkpoints bracket the analysis and the publish, but
      // the interiors of individual awaits (notably updateModel) are not
      // checkpoints — a write already in flight cannot be recalled; it is
      // convergent with the replacement's (same terminal query docs).
      logger.warn(
        `Refresh pass for ${this.model.id} has been in flight for ${inFlightMs}ms; abandoning it and starting a fresh pass`,
      );
      this.refreshGeneration++;
      this.refreshChain = Promise.resolve();
      this.refreshStartedAt = null;
    } else {
      logger.debug(
        `Refresh watchdog for ${this.model.id}: re-arming the debounced refresh`,
      );
    }
    this.onQueryFinish();
  }

  async onQueryFinish() {
    // A late query completion must not restart a runner that already
    // concluded (e.g. shut down after repeated refresh failures).
    if (this.status === "finished") {
      logger.debug(
        "Query finished for " + this.model.id + " after the runner concluded",
      );
      return;
    }
    // Dependency-free queries can finish while startAnalysis() is still
    // persisting the query DAG. Wait until the DAG is durable so the debounced
    // refresh cannot read an empty query list and swallow the real refresh.
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

  // Terminal error write used by shutDownWithError. Overridable so models
  // with a status field can make the write conditional on the run still
  // being active — a shutdown must never clobber a conclusion that another
  // finalizer (e.g. the stalled-snapshot reaper erroring it, or a cancel)
  // already published.
  protected async writeErrorIfStillActive(error: string): Promise<void> {
    this.model = await this.updateModel({
      status: "failed",
      queries: this.model.queries,
      error,
    });
  }

  // Terminal shutdown for a runner that cannot make progress: fences off
  // any queued or late refresh passes, clears every timer this runner owns
  // (debounce, queued-query backoff, watchdog and heartbeat via setStatus)
  // and finishes loudly. Best-effort persists the error; if that write
  // fails, the stalled-snapshot reaper backstops experiment snapshots
  // (within its 24-hour scan window) while model types without a reaper
  // keep their database status until a user retries — same as before, but
  // now with error logs.
  private shutDownWithError(error: string): void {
    this.refreshGeneration++;
    this.refreshChain = Promise.resolve();
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.clearAllTimers();
    const fullError = "Error finalizing query results: " + error;
    this.writeErrorIfStillActive(fullError).catch((writeErr) => {
      logger.error(
        writeErr,
        "Failed to persist error status for runner of " + this.model.id,
      );
    });
    this.setStatus("finished", fullError);
  }

  // Enqueue one refresh pass on the serialized chain. Passes run strictly
  // one after another; see the refreshChain field comment.
  private queueRefreshPass(): void {
    const gen = this.refreshGeneration;
    this.refreshChain = this.refreshChain
      .then(() => this.runRefreshPass(gen))
      .catch((e) => {
        // runRefreshPass catches errors from the model re-fetch and the
        // status refresh itself; this catches any rejection from the parts
        // outside those inner try/catches (isModelTerminal, setStatus and
        // its finish listeners, clearAllTimers) so later passes still run.
        // It counts as a failed pass and gives up after
        // MAX_CONSECUTIVE_REFRESH_FAILURES like any other.
        this.consecutiveRefreshFailures++;
        logger.error(
          e,
          "Unexpected error in refresh pass chain for " + this.model.id,
        );
        if (
          this.consecutiveRefreshFailures >= MAX_CONSECUTIVE_REFRESH_FAILURES &&
          this.status !== "finished"
        ) {
          this.shutDownWithError(e instanceof Error ? e.message : String(e));
        }
      });
  }

  // Checkpoint for a refresh pass. True when the watchdog fenced this pass
  // off as stuck (or the runner shut down or stood down); the pass must not
  // publish or swap this.model (an await already in flight may still land
  // its convergent pointer-status update). A pass that is NOT superseded
  // marks progress: the stuck clock restarts, so REFRESH_STUCK_RETRIGGER_MS
  // applies per segment between checkpoints rather than to the pass as a
  // whole, and a pass that keeps reaching checkpoints on a huge snapshot is
  // never fenced mid-work. (The awaits inside a segment are not all bounded
  // — Mongo has no socket timeout — which is what the fence is for; see
  // REFRESH_STUCK_RETRIGGER_MS.)
  private passSuperseded(gen: number): boolean {
    if (gen !== this.refreshGeneration) {
      logger.debug(
        `Abandoning superseded refresh pass for ${this.model.id} without publishing`,
      );
      return true;
    }
    this.refreshStartedAt = Date.now();
    return false;
  }

  // Conclude this runner without publishing or writing an error: the run
  // was concluded elsewhere (cancelled, or errored by the stalled-snapshot
  // reaper) and the database record is authoritative. Fences off queued or
  // late refresh passes, clears every timer this runner owns, and resolves
  // in-process waiters without an error — readers consult the database
  // record for the outcome. Deliberately NOT a rejection: rejecting
  // waitForResults makes the scheduled refresh job disable auto-updates
  // for the experiment, which a user cancel must never do.
  private standDown(reason: string): void {
    logger.warn(`Runner of ${this.model.id} standing down: ${reason}`);
    this.refreshGeneration++;
    this.refreshChain = Promise.resolve();
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.clearAllTimers();
    this.setStatus("finished", "");
  }

  // Override point: report whether the persisted model says this run is
  // already terminal (concluded elsewhere — e.g. the stalled-snapshot reaper
  // errored it while this runner was struggling, or it was cancelled). The
  // base model shape has no status field, so the default is "unknown" (false);
  // subclasses with a status override this.
  protected isModelTerminal(_model: Model): boolean {
    return false;
  }

  // One debounced refresh pass: re-fetch the model, reconcile query
  // statuses, start any newly-ready queries, and finalize when everything
  // is done. Failures are retried by the refresh watchdog a bounded number
  // of times before the run is failed loudly (or stood down, when the model
  // itself is gone — see standDown) — a dropped pass must never silently
  // strand the model in "running".
  private async runRefreshPass(gen: number): Promise<void> {
    if (this.passSuperseded(gen)) return;
    try {
      // Fetch the latest model in its own try so we can distinguish
      // "model is gone or unreadable" from a genuine refresh failure.
      // The most common cause of getLatestModel throwing here is a
      // concurrent cancel: cancelSnapshot constructs its own runner
      // instance to call cancelQueries() and then deletes the snapshot,
      // so this (separate) instance never sees the status flip and only
      // learns about the cancellation when findSnapshotById returns null and
      // getLatestModel throws.
      let latest: Model;
      try {
        logger.debug("Getting latest model for " + this.model.id);
        latest = await this.getLatestModel();
      } catch (e) {
        this.consecutiveRefreshFailures++;
        if (
          this.consecutiveRefreshFailures >= MAX_CONSECUTIVE_REFRESH_FAILURES
        ) {
          // The model was unreadable across N attempts — almost always a
          // concurrent cancel that deleted it; the DB record is
          // authoritative and for experiment snapshots the stalled-snapshot
          // reaper backstops the error write. Stand down rather than fail:
          // an error write would target the same unreadable document, and
          // rejecting waitForResults would make the scheduled refresh job
          // disable auto-updates for the experiment after a user cancel.
          this.standDown(
            `could not re-fetch the model in ${this.consecutiveRefreshFailures} consecutive attempts (${
              e instanceof Error ? e.message : String(e)
            })`,
          );
          return;
        }
        logger.warn(
          e,
          `Could not re-fetch model for runner of ${this.model.id} (attempt ${this.consecutiveRefreshFailures} of ${MAX_CONSECUTIVE_REFRESH_FAILURES}); the refresh watchdog will retry`,
        );
        return;
      }
      if (this.passSuperseded(gen)) return;
      this.model = latest;
      if (this.isModelTerminal(latest)) {
        // Someone else concluded this run (reap-to-error or cancel). Stand
        // down without publishing over it.
        this.standDown("model is already terminal in the database");
        return;
      }
      if (this.status === "running" && latest.queries.length === 0) {
        // startAnalysis never sets "running" with an empty DAG, so an empty
        // query list on a running runner can only mean cancelQueries() (on
        // a separate instance) wrote queries: [] — the run was cancelled.
        this.standDown("query list was emptied by a cancel");
        return;
      }
      try {
        const queryMap = await this.refreshQueryStatuses(() =>
          this.passSuperseded(gen),
        );
        if (this.passSuperseded(gen)) return;
        await this.startReadyQueries(queryMap);
        this.consecutiveRefreshFailures = 0;
      } catch (e) {
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
        if (this.status !== "finished") {
          this.shutDownWithError(e instanceof Error ? e.message : String(e));
        }
      }
    } finally {
      if (gen === this.refreshGeneration) {
        this.refreshStartedAt = null;
      }
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
        // No refresh loop exists yet at this point to retry an incomplete
        // read, so a cached copy that lost its stored result fails the run
        // immediately rather than being analyzed with zero-filled metrics.
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

  // shouldAbandon is the checkpoint used by serialized refresh passes: when
  // it returns true the pass has been fenced off as stuck and must not
  // publish. External callers (e.g. the metric-analysis status endpoint)
  // omit it.
  public async refreshQueryStatuses(
    shouldAbandon?: () => boolean,
  ): Promise<QueryMap> {
    const oldStatus = this.getOverallQueryStatus();
    logger.debug("Refreshing query statuses for " + this.model.id);

    // If there are no running or queued queries, there is usually nothing
    // to do — unless this runner is still mid-run and every pointer is already
    // terminal, i.e. another writer (the stale-query fan-out, or a fresh runner
    // instance behind a status endpoint) persisted the terminal statuses
    // without concluding the run. In that case fall through and finalize
    // from the persisted query results.
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
        // Defensive: refresh passes stand down on an empty DAG before reaching
        // here (see runRefreshPass) and external callers are never "running", so
        // this should be unreachable; guard anyway so an empty DAG can never
        // roll up to "failed" and publish.
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

    // The pointers can already be terminal when this pass starts (see above),
    // so a read that reports no changes must still finalize when the overall
    // status is terminal and this runner is mid-run. Scoped to status "running"
    // so fresh runner instances (e.g. the status-polling endpoints) keep their
    // no-change fast path.
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
      if (shouldAbandon?.()) return queryMap;
      // Throws before the analysis try/catch: an incomplete read should be
      // retried by the refresh watchdog, not recorded as a failed run.
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

    if (shouldAbandon?.()) return queryMap;

    const newModel = await this.updateModel({
      status: error ? "failed" : newStatus,
      queries: this.model.queries,
      result,
      // An empty string (not undefined) so a successful finalize clears any
      // stale error text on the model — mongoose strips undefined from $set.
      error: error ?? "",
    });
    // Re-check after the write: if this pass was fenced while updateModel
    // was in flight (its interior is not a checkpoint and the write cannot
    // be recalled), at least do not swap the replacement pass's model or
    // flip the runner state from under it.
    if (shouldAbandon?.()) return queryMap;
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
          // A thrown concurrency check used to strand the query forever:
          // the rejection was unhandled, and the stale pendingTimers entry
          // made startReadyQueries skip this query on every later pass.
          // Clear the entry and retry with backoff instead.
          this.clearTimer(query.id);
          // Stop retrying once the run is over (e.g. failed loudly after
          // repeated refresh errors) so the retry chain can't outlive it.
          if (this.status === "finished") return;
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
    // No need to re-fetch finished queries
    const idsToFetch = this.model.queries
      .filter((p) => !this.finishedQueryMapCache.has(p.name))
      .map((p) => p.query);

    const queries = await getQueriesByIds(this.context, idsToFetch);

    let hasChanges = false;
    const queryMap: QueryMap = new Map(this.finishedQueryMapCache);
    queries.forEach((query) => {
      // Update pointer status to match query status
      const pointer = this.model.queries.find((p) => p.query === query.id);
      if (!pointer) return;

      // Build a query map based on the pointer name
      queryMap.set(pointer.name, query);

      if (pointer.status !== query.status) {
        hasChanges = true;
        pointer.status = query.status;
      }

      // If the query succeeded, add it to the cache
      // We could do this for failed queries too, but we may want to do retries in the future
      // Also, failed queries are tiny since they don't have result rows, so caching doesn't help much
      // Only cache docs that carry their stored result, so a partial read
      // (see assertQueryMapComplete) is re-read on the next pass instead of
      // being pinned in the cache.
      if (
        query.status === "succeeded" &&
        query.result !== undefined &&
        query.result !== null
      ) {
        this.finishedQueryMapCache.set(pointer.name, query);
      }
    });

    return {
      hasChanges,
      queryMap,
    };
  }
}
