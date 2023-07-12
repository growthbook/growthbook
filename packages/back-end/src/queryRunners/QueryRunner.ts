import EventEmitter from "events";
import {
  Queries,
  QueryInterface,
  QueryPointer,
  QueryStatus,
} from "../../types/query";
import {
  createNewQuery,
  getQueriesByIds,
  getRecentQuery,
  updateQuery,
} from "../models/QueryModel";
import { SourceIntegrationInterface } from "../types/Integration";
import { logger } from "../util/logger";

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

const FINISH_EVENT = "finish";

export abstract class QueryRunner<
  Model extends InterfaceWithQueries,
  Params,
  Result
> {
  public model: Model;
  public integration: SourceIntegrationInterface;
  private timer: null | NodeJS.Timeout = null;
  private emitter: EventEmitter;
  public status: RunnerStatus = "pending";
  public result: Result | null = null;
  public error = "";
  private useCache: boolean;

  public constructor(
    model: Model,
    integration: SourceIntegrationInterface,
    useCache = true
  ) {
    this.model = model;
    this.integration = integration;
    this.useCache = useCache;
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
          await this.refreshQueryStatuses();
        } catch (e) {
          logger.error(e);
        }
      }, 1000);
    } else {
      logger.debug("Query finished, timer already started");
    }
  }

  private async getQueryMap(pointers: Queries): Promise<QueryMap> {
    const queryDocs = await getQueriesByIds(
      this.model.organization,
      pointers.map((q) => q.query)
    );

    const map: QueryMap = new Map();
    pointers.forEach((q) => {
      const query = queryDocs.find((doc) => doc.id === q.query);
      if (query) {
        map.set(q.name, query);
      }
    });

    return map;
  }

  public async startAnalysis(params: Params): Promise<Model> {
    logger.debug("Starting queries");
    const queries = await this.startQueries(params);
    this.model.queries = queries;

    // If already finished (queries were cached)
    let error: string | undefined = undefined;
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

  public async refreshQueryStatuses(): Promise<void> {
    const oldStatus = this.getOverallQueryStatus();
    logger.debug("Refreshing query statuses");

    // If there are no running queries, return immediately
    if (!this.model.queries.some((q) => q.status === "running")) {
      logger.debug("No running queries, return");
      return;
    }

    const { hasChanges, queryMap } = await this.updateQueryPointers();

    const newStatus = this.getOverallQueryStatus();

    logger.debug("Has changes? " + hasChanges + ", New Status: " + newStatus);

    if (!hasChanges) return;

    let error: string | undefined = undefined;
    let result: Result | undefined = undefined;

    if (oldStatus === "running" && newStatus === "failed") {
      error = "Failed to run one or more database queries";
      logger.debug("Query failed, transitioning to error state");
    }
    if (oldStatus === "running" && newStatus === "succeeded") {
      try {
        result = await this.runAnalysis(queryMap);
        logger.debug("Queries succeeded, ran analysis successfully");
      } catch (e) {
        error = "Error running analysis: " + e.message;
        logger.debug(
          "Queries succeeded, failed running analysis: " + e.message
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
  }

  public async cancelQueries(): Promise<void> {
    // Only cancel if it's currently running
    if (this.model.queries.filter((q) => q.status === "running").length > 0) {
      const newModel = await this.updateModel({
        queries: [],
        status: "failed",
        error: "",
      });
      this.model = newModel;

      this.setStatus("finished", "Queries cancelled by user");
    }
  }

  public async startQuery<
    Rows extends Record<string, string | boolean | number>[],
    ProcessedRows
  >(
    name: string,
    query: string,
    run: (query: string) => Promise<Rows>,
    process: (rows: Rows) => ProcessedRows
  ): Promise<QueryPointer> {
    logger.debug("Running query: " + name);

    // Re-use recent identical query
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

          return {
            name,
            query: existing.id,
            status: existing.status,
          };
        }
      } catch (e) {
        logger.error(e);
      }
    }

    // Otherwise, create a new query in mongo;
    const doc = await createNewQuery({
      query,
      datasource: this.integration.datasource,
      organization: this.integration.organization,
      language: this.integration.getSourceProperties().queryLanguage,
    });
    logger.debug("Created new query object in Mongo: " + doc.id);

    // Update heartbeat for the query once every 30 seconds
    // This lets us detect orphaned queries where the thread died
    const timer = setInterval(() => {
      updateQuery(doc, { heartbeat: new Date() }).catch((e) => {
        logger.error(e);
      });
    }, 30000);

    // Run the query in the background
    logger.debug("Start executing query in background");
    run(query)
      .then(async (rows) => {
        clearInterval(timer);
        logger.debug("Query succeeded");
        await updateQuery(doc, {
          finishedAt: new Date(),
          status: "succeeded",
          rawResult: rows,
          result: process(rows),
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

    return {
      name,
      query: doc.id,
      status: doc.status,
    };
  }

  private getOverallQueryStatus(): QueryStatus {
    const hasFailedQueries = this.model.queries.some(
      (q) => q.status === "failed"
    );
    const hasRunningQueries = this.model.queries.some(
      (q) => q.status === "running"
    );
    return hasFailedQueries
      ? "failed"
      : hasRunningQueries
      ? "running"
      : "succeeded";
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
