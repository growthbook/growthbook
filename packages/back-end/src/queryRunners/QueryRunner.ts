import EventEmitter from "events";
import {
  Queries,
  QueryInterface,
  QueryPointer,
  QueryStatus,
  QueryType,
} from "../../types/query";
import {
  createNewQuery,
  createNewQueryFromCached,
  getQueriesByIds,
  getRecentQuery,
  updateQuery,
} from "../models/QueryModel";
import {
  ExternalIdCallback,
  QueryResponse,
  SourceIntegrationInterface,
} from "../types/Integration";
import { logger } from "../util/logger";
import { promiseAllChunks } from "../util/promise";
import { ReqContext } from "../../types/organization";
import { ApiReqContext } from "../../types/api";

export type QueryMap = Map<string, QueryInterface>;

export type RunnerStatus = "pending" | "running" | "finished";

export type InterfaceWithQueries = {
  runStarted: Date | null;
  queries: Queries;
  organization: string;
};

export type QueryStatusEndpointResponse = {
  status: number;
  queryStatus: QueryStatus;
  elapsed: number;
  finished: number;
  total: number;
};

export type RowsType = Record<string, string | boolean | number | object>[];
// eslint-disable-next-line
export type ProcessedRowsType = Record<string, any>;

export type StartQueryParams<Rows, ProcessedRows> = {
  name: string;
  query: string;
  dependencies: string[];
  run: (
    query: string,
    setExternalId: ExternalIdCallback
  ) => Promise<QueryResponse<Rows>>;
  process: (rows: Rows) => ProcessedRows;
  queryType: QueryType;
};

const FINISH_EVENT = "finish";

export async function getQueryMap(
  organization: string,
  queries: Queries
): Promise<QueryMap> {
  const queryDocs = await getQueriesByIds(
    organization,
    queries.map((q) => q.query)
  );

  const map: QueryMap = new Map();
  queries.forEach((q) => {
    const query = queryDocs.find((doc) => doc.id === q.query);
    if (query) {
      map.set(q.name, query);
    }
  });

  return map;
}

export abstract class QueryRunner<
  Model extends InterfaceWithQueries,
  Params,
  Result
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
        setExternalId: ExternalIdCallback
      ) => Promise<QueryResponse<RowsType>>;
      process: (rows: RowsType) => ProcessedRowsType;
    };
  } = {};
  private useCache: boolean;

  public constructor(
    model: Model,
    integration: SourceIntegrationInterface,
    context: ReqContext | ApiReqContext,
    useCache = true
  ) {
    this.model = model;
    this.integration = integration;
    this.useCache = useCache;
    this.context = context;
    this.emitter = new EventEmitter();
  }

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

  async onQueryFinish() {
    if (!this.timer) {
      logger.debug("Query finished, refreshing in 1 second");
      this.timer = setTimeout(async () => {
        this.timer = null;
        try {
          logger.debug("Getting latest model");
          this.model = await this.getLatestModel();
          const queryMap = await this.refreshQueryStatuses();
          await this.startReadyQueries(queryMap);
        } catch (e) {
          logger.error(e);
        }
      }, 1000);
    } else {
      logger.debug("Query finished, timer already started");
    }
  }

  private async getQueryMap(pointers: Queries): Promise<QueryMap> {
    return getQueryMap(this.model.organization, pointers);
  }

  public async startAnalysis(params: Params): Promise<Model> {
    logger.debug("Starting queries");
    const queries = await this.startQueries(params);
    this.model.queries = queries;

    // If already finished (queries were cached)
    let error = "";
    let result: Result | undefined = undefined;

    const queryStatus = this.getOverallQueryStatus();
    if (queryStatus === "succeeded") {
      logger.debug("Query already succeeded (cached)");
      const queryMap = await this.getQueryMap(queries);
      try {
        result = await this.runAnalysis(queryMap);
        logger.debug("Ran analysis successfully");
      } catch (e) {
        logger.debug("Error running analysis");
        error = "Error running analysis: " + e.message;
      }
    } else if (queryStatus === "failed") {
      logger.debug("Query failed immediately");
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
    result: Result | null = null
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
      this.emitter.on(FINISH_EVENT, () => {
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
      (q) => q.status === "queued"
    );
    logger.debug(
      `Starting any queued queries that are ready: ${queuedQueries.map(
        (q) => q.id
      )}`
    );
    await Promise.all(
      queuedQueries.map(async (query) => {
        // check if all dependencies are finished
        // assumes all dependencies are within the model; if any are not, query will hang
        // in queued state

        const failedDependencies: QueryPointer[] = [];
        const succeededDependencies: QueryPointer[] = [];
        const pendingDependencies: QueryPointer[] = [];

        const dependencyIds: string[] = query.dependencies ?? [];
        dependencyIds.forEach((dependencyId) => {
          const dependencyQuery = this.model.queries.find(
            (q) => q.query == dependencyId
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
          await updateQuery(query, {
            finishedAt: new Date(),
            status: "failed",
            error: `Dependencies failed: ${failedDependencies.map(
              (q) => q.query
            )}`,
          });
          this.onQueryFinish();
          return;
        }
        if (pendingDependencies.length) {
          logger.debug(`${query.id}: Dependencies pending...`);
          return;
        }
        if (succeededDependencies.length === dependencyIds.length) {
          logger.debug(`${query.id}: Dependencies completed, running...`);
          const runCallbacks = this.runCallbacks[query.id];
          if (runCallbacks === undefined) {
            logger.debug(`${query.id}: Run callbacks not found..`);
            await updateQuery(query, {
              finishedAt: new Date(),
              status: "failed",
              error: `Run callbacks not found`,
            });
            this.onQueryFinish();
          } else {
            await this.executeQuery(
              query,
              runCallbacks.run,
              runCallbacks.process
            );
          }
        }
      })
    );
  }

  public async refreshQueryStatuses(): Promise<QueryMap> {
    const oldStatus = this.getOverallQueryStatus();
    logger.debug("Refreshing query statuses");

    // If there are no running or queued queries, return immediately
    if (
      !this.model.queries.some(
        (q) => q.status === "running" || q.status === "queued"
      )
    ) {
      logger.debug("No running or queued queries, return");
      return new Map();
    }

    const { hasChanges, queryMap } = await this.updateQueryPointers();

    const newStatus = this.getOverallQueryStatus();

    logger.debug("Has changes? " + hasChanges + ", New Status: " + newStatus);

    if (!hasChanges) return queryMap;

    let error: string | undefined = undefined;
    let result: Result | undefined = undefined;

    if (oldStatus === "running" && newStatus === "failed") {
      error = "Failed to run a majority of the database queries";
      logger.debug("Query failed, transitioning to error state");
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
        logger.debug(
          `Queries ${newStatus}, failed running analysis: ` + e.message
        );
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
        (q) => q.status === "running" || q.status === "queued"
      )
    ) {
      const runningIds = this.model.queries
        .filter((q) => q.status === "running")
        .map((q) => q.query);

      if (runningIds.length) {
        const queryDocs = await getQueriesByIds(
          this.model.organization,
          runningIds
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
            5
          );
        }
      }

      const newModel = await this.updateModel({
        queries: [],
        status: "failed",
        error: "",
      });
      this.model = newModel;

      this.setStatus("finished", "Queries cancelled by user");
    }
  }

  public async executeQuery<
    Rows extends RowsType,
    ProcessedRows extends ProcessedRowsType
  >(
    doc: QueryInterface,
    run: (
      query: string,
      setExternalId: ExternalIdCallback
    ) => Promise<QueryResponse<Rows>>,
    process: (rows: Rows) => ProcessedRows
  ): Promise<void> {
    // Update heartbeat for the query once every 30 seconds
    // This lets us detect orphaned queries where the thread died
    const timer = setInterval(() => {
      updateQuery(doc, { heartbeat: new Date() }).catch((e) => {
        logger.error(e);
      });
    }, 30000);

    // Run the query in the background
    logger.debug(`Start executing query in background: ${doc.id}`);
    if (doc.status !== "running") {
      await updateQuery(doc, {
        startedAt: new Date(),
        status: "running",
      });
    }

    const setExternalId = async (id: string) => {
      await updateQuery(doc, {
        externalId: id,
      });
    };

    run(doc.query, setExternalId)
      .then(async ({ rows, statistics }) => {
        clearInterval(timer);
        logger.debug("Query succeeded");
        await updateQuery(doc, {
          finishedAt: new Date(),
          status: "succeeded",
          rawResult: rows,
          result: process(rows),
          statistics: statistics,
        });
        this.onQueryFinish();
      })
      .catch(async (e) => {
        clearInterval(timer);
        logger.debug("Query failed: " + e.message);
        updateQuery(doc, {
          finishedAt: new Date(),
          status: "failed",
          error: e.message,
        })
          .then(() => {
            this.onQueryFinish();
          })
          .catch((e) => logger.error(e));
      });
  }

  public async startQuery<
    Rows extends RowsType,
    ProcessedRows extends ProcessedRowsType
  >(params: StartQueryParams<Rows, ProcessedRows>): Promise<QueryPointer> {
    const { name, query, dependencies, run, process, queryType } = params;
    // Re-use recent identical query if it exists
    if (this.useCache) {
      logger.debug("Trying to reuse existing query");
      try {
        const existing = await getRecentQuery(
          this.integration.organization,
          this.integration.datasource,
          query
        );
        if (existing) {
          // Query still running, periodically check the status
          if (existing.status === "running") {
            logger.debug(
              "Reusing previous query. Currently running, checking every 3 seconds for changes"
            );
            const check = () => {
              getQueriesByIds(this.model.organization, [existing.id])
                .then(async (queries) => {
                  const query = queries[0];
                  if (
                    !query ||
                    query.status === "failed" ||
                    query.status === "succeeded"
                  ) {
                    this.onQueryFinish();
                  } else {
                    // Still running, check again after a delay
                    setTimeout(check, 3000);
                  }
                })
                .catch(() => {
                  this.onQueryFinish();
                });
            };
            setTimeout(check, 3000);
          }
          // Query already finished
          else {
            logger.debug("Reusing previous query. Already finished");
            this.onQueryFinish();
          }
          logger.debug("Creating query with cached values");
          const copiedCachedDoc = await createNewQueryFromCached({
            existing: existing,
            dependencies: dependencies,
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
    logger.debug("Creating query: " + name);
    const readyToRun = dependencies.length === 0;
    const doc = await createNewQuery({
      query,
      queryType,
      datasource: this.integration.datasource,
      organization: this.integration.organization,
      language: this.integration.getSourceProperties().queryLanguage,
      dependencies: dependencies,
      running: readyToRun,
    });

    logger.debug("Created new query object in Mongo: " + doc.id);
    if (readyToRun) {
      this.executeQuery(doc, run, process);
    } else {
      // save callback methods for execution later
      this.runCallbacks[doc.id] = { run, process };
    }

    return {
      name,
      query: doc.id,
      status: doc.status,
    };
  }

  private getOverallQueryStatus(): QueryStatus {
    const failedQueries = this.model.queries.filter(
      (q) => q.status === "failed"
    );
    const runningQueries = this.model.queries.filter(
      (q) => q.status === "running"
    );
    const queuedQueries = this.model.queries.filter(
      (q) => q.status === "queued"
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
    const queries = await getQueriesByIds(
      this.model.organization,
      this.model.queries.map((p) => p.query)
    );

    let hasChanges = false;
    const queryMap: QueryMap = new Map();
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
    });

    return {
      hasChanges,
      queryMap,
    };
  }
}
