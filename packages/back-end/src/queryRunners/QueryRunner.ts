import EventEmitter from "events";
import { ExternalIdCallback, QueryResponse } from "shared/types/integrations";
import {
  Queries,
  QueryInterface,
  QueryPointer,
  QueryStatus,
  QueryType,
} from "shared/types/query";
import {
  countRunningQueries,
  createNewQuery,
  createNewQueryFromCached,
  getQueriesByIds,
  getRecentQuery,
  updateQuery,
} from "back-end/src/models/QueryModel";
import {
  PossiblyFormattedSql,
  resolveSqlQuery,
  SourceIntegrationInterface,
} from "back-end/src/types/Integration";
import { logger } from "back-end/src/util/logger";
import { promiseAllChunks } from "back-end/src/util/promise";
import { ReqContext } from "back-end/types/request";
import { ApiReqContext } from "back-end/types/api";

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
  query: PossiblyFormattedSql;
  dependencies: string[];
  run: (
    query: string,
    setExternalId: ExternalIdCallback,
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
      if (query.status === "succeeded" && cache) {
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
      ) => Promise<QueryResponse<RowsType>>;
      process?: (rows: RowsType) => ProcessedRowsType;
      onSuccess?: (rows: RowsType) => void | Promise<void>;
      onFailure: () => void;
    };
  } = {};
  private useCache: boolean;
  private pendingTimers: Record<string, NodeJS.Timeout> = {};
  private finishedQueryMapCache: QueryMap = new Map();

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

  async onQueryFinish() {
    if (!this.timer) {
      logger.debug(
        "Query finished for " +
          this.model.id +
          " runner, refreshing in 1 second",
      );
      this.timer = setTimeout(async () => {
        this.timer = null;
        try {
          logger.debug("Getting latest model for " + this.model.id);
          this.model = await this.getLatestModel();
          const queryMap = await this.refreshQueryStatuses();
          await this.startReadyQueries(queryMap);
        } catch (e) {
          logger.error(
            e,
            "Error refreshing query statuses for runner of " + this.model.id,
          );
        }
      }, 1000);
    } else {
      logger.debug(
        "Query finished for " +
          this.model.id +
          " runner, timer already started",
      );
    }
  }

  private async getQueryMap(pointers: Queries): Promise<QueryMap> {
    return getQueryMap(this.context, pointers, this.finishedQueryMapCache);
  }

  public async startAnalysis(params: Params): Promise<Model> {
    logger.debug(this.model.id + " runner: Starting queries");
    const queries = await this.startQueries(params);
    this.model.queries = queries;

    // If already finished (queries were cached)
    let error = "";
    let result: Result | undefined = undefined;

    const queryStatus = this.getOverallQueryStatus();
    if (queryStatus === "succeeded") {
      logger.debug(this.model.id + " runner: Query already succeeded (cached)");
      const queryMap = await this.getQueryMap(queries);
      try {
        result = await this.runAnalysis(queryMap);
        logger.debug(this.model.id + " runner: Ran analysis successfully");
      } catch (e) {
        logger.error(e, this.model.id + " runner: Error running analysis");
        error = "Error running analysis: " + e.message;
      }
    } else if (queryStatus === "failed") {
      logger.debug(this.model.id + " runner: Query failed immediately");
      error = "Error running one or more database queries";
    }

    const newModel = await this.updateModel({
      status: queryStatus,
      queries,
      runStarted: new Date(),
      result: result,
      error: error,
    });
    this.model = newModel;

    if (error || result) {
      this.setStatus("finished", error, result);
    } else {
      this.setStatus("running");
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

    if (this.status === "finished") {
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
          return;
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

    // If there are no running or queued queries, return immediately
    if (
      !this.model.queries.some(
        (q) => q.status === "running" || q.status === "queued",
      )
    ) {
      logger.debug(
        "No running or queued queries for " + this.model.id + ", return",
      );
      return new Map();
    }

    const { hasChanges, queryMap } = await this.updateQueryPointers();

    const newStatus = this.getOverallQueryStatus();

    logger.debug(
      this.model.id +
        " has changes? " +
        hasChanges +
        ", New Status: " +
        newStatus,
    );

    if (!hasChanges) return queryMap;

    let error: string | undefined = undefined;
    let result: Result | undefined = undefined;

    if (oldStatus === "running" && newStatus === "failed") {
      error = "Failed to run a majority of the database queries";
      logger.debug(
        "Query failed for " +
          this.model.id +
          " runner, transitioning to error state",
      );
    }
    if (
      oldStatus === "running" &&
      (newStatus === "succeeded" || newStatus === "partially-succeeded")
    ) {
      try {
        result = await this.runAnalysis(queryMap);
        logger.debug(`Queries ${newStatus}, ran analysis successfully`);
      } catch (e) {
        error = "Error running analysis: " + e.message;
        logger.error(e, `Queries ${newStatus}, failed running analysis`);
      }
    }

    const newModel = await this.updateModel({
      status: newStatus,
      queries: this.model.queries,
      result,
      error,
    });
    this.model = newModel;

    if (error || result) {
      this.setStatus("finished", error, result);
    }
    return queryMap;
  }

  public async cancelQueries(): Promise<void> {
    // Only cancel if it's currently running or queued
    if (
      this.model.queries.some(
        (q) => q.status === "running" || q.status === "queued",
      )
    ) {
      const runningIds = this.model.queries
        .filter((q) => q.status === "running")
        .map((q) => q.query);

      if (runningIds.length) {
        const queryDocs = await getQueriesByIds(
          this.context,
          runningIds,
          false,
        );

        const externalIds = queryDocs.map((q) => q.externalId).filter(Boolean);

        if (externalIds.length) {
          await promiseAllChunks(
            externalIds.map((id) => {
              return async () => {
                if (!id || !this.integration.cancelQuery) return;
                try {
                  await this.integration.cancelQuery(id);
                } catch (e) {
                  logger.debug(`Failed to cancel query - ${e.message}`);
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
        this.executeQueryWhenReady(query, timeout);
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
    if (doc.status !== "running") {
      await updateQuery(this.context, doc, {
        startedAt: new Date(),
        status: "running",
        heartbeat: new Date(),
      });
    }

    const setExternalId = async (id: string) => {
      await updateQuery(this.context, doc, {
        externalId: id,
      });
    };

    run(doc.query, setExternalId)
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
        updateQuery(this.context, doc, {
          finishedAt: new Date(),
          status: "failed",
          error: e.message,
        })
          .then(() => {
            onFailure();
            this.onQueryFinish();
          })
          .catch((e) => logger.error(e));
      });
  }

  public async startQuery<
    Rows extends RowsType,
    ProcessedRows extends ProcessedRowsType,
  >(params: StartQueryParams<Rows, ProcessedRows>): Promise<QueryPointer> {
    const {
      name,
      displayTitle,
      query: queryParam,
      dependencies,
      runAtEnd,
      run,
      process,
      onFailure: specifiedOnFailureCallback,
      onSuccess,
      queryType,
    } = params;
    const { sql: querySql, isFormatted } = resolveSqlQuery(queryParam);
    // Re-use recent identical query if it exists
    if (this.useCache) {
      logger.debug("Trying to reuse existing query for " + name);
      try {
        // Use datasource-specific cache TTL if set, otherwise use global default
        const queryCacheTTLSetting =
          this.integration.datasource.settings.queryCacheTTLMins;
        const parsedTTL = queryCacheTTLSetting
          ? parseInt(queryCacheTTLSetting)
          : NaN;
        const cacheTTLMins = isNaN(parsedTTL) ? undefined : parsedTTL;
        const existing = await getRecentQuery(
          this.integration.context.org.id,
          this.integration.datasource.id,
          querySql,
          cacheTTLMins,
        );
        if (existing) {
          // Query still running, periodically check the status
          if (existing.status === "running") {
            logger.debug(
              "Reusing previous query " +
                existing.id +
                " for query " +
                querySql +
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
              "Reusing previous query for " + querySql + ". Already finished",
            );
            this.onQueryFinish();
          }
          logger.debug(
            "Creating query with cached values for " +
              querySql +
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
      query: querySql,
      queryType,
      displayTitle,
      datasource: this.integration.datasource.id,
      organization: this.integration.context.org.id,
      language: this.integration.getSourceProperties().queryLanguage,
      dependencies: dependencies,
      running: readyToRun,
      runAtEnd: runAtEnd,
      sqlFormatted: isFormatted,
    });

    logger.debug("Created new query " + doc.id + " for " + name);

    const defaultOnFailure = () => {};
    const onFailure = specifiedOnFailureCallback ?? defaultOnFailure;
    if (readyToRun) {
      this.executeQuery(doc, { run, process, onFailure, onSuccess });
    } else if (dependenciesComplete && !runAtEnd) {
      this.runCallbacks[doc.id] = {
        run,
        process,
        onFailure,
        onSuccess,
      };
      this.queueQueryExecution(doc);
    } else {
      // save callback methods for execution later
      this.runCallbacks[doc.id] = { run, process, onFailure, onSuccess };
    }

    return {
      name,
      query: doc.id,
      status: doc.status,
    };
  }

  // Limit number of currently running queries
  private async concurrencyLimitReached(): Promise<boolean> {
    if (!this.integration.datasource.settings.maxConcurrentQueries)
      return new Promise<boolean>((resolve) => resolve(false));
    const numericConcurrencyLimit = parseInt(
      this.integration.datasource.settings.maxConcurrentQueries,
    );
    if (isNaN(numericConcurrencyLimit) || numericConcurrencyLimit === 0) {
      return new Promise<boolean>((resolve) => resolve(false));
    }

    const numRunningQueries = await countRunningQueries(
      this.integration.context.org.id,
      this.integration.datasource.id,
    );
    return numRunningQueries >= numericConcurrencyLimit;
  }

  private getOverallQueryStatus(): QueryStatus {
    const failedQueries = this.model.queries.filter(
      (q) => q.status === "failed",
    );
    const runningQueries = this.model.queries.filter(
      (q) => q.status === "running",
    );
    const queuedQueries = this.model.queries.filter(
      (q) => q.status === "queued",
    );

    const totalQueries = this.model.queries.length;

    if (failedQueries.length >= totalQueries / 2) return "failed";

    if (queuedQueries.length + runningQueries.length > 0) return "running";

    if (failedQueries.length > 0) return "partially-succeeded";

    return "succeeded";
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
      if (query.status === "succeeded") {
        this.finishedQueryMapCache.set(pointer.name, query);
      }
    });

    return {
      hasChanges,
      queryMap,
    };
  }
}
