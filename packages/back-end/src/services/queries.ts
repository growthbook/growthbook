import { getValidDate } from "shared/dates";
import {
  createNewQuery,
  getQueriesByIds,
  getRecentQuery,
  updateQuery,
} from "../models/QueryModel";
import {
  ExperimentMetricStats,
  MetricValueParams,
  SourceIntegrationInterface,
  ExperimentMetricQueryParams,
  MetricValueQueryResponse,
  MetricValueResult,
  PastExperimentResponse,
  PastExperimentResult,
  ExperimentResults,
  ExperimentQueryResponses,
} from "../types/Integration";
import {
  Queries,
  QueryInterface,
  QueryPointer,
  QueryStatus,
} from "../../types/query";
import { MetricInterface } from "../../types/metric";
import { DimensionInterface } from "../../types/dimension";
import { meanVarianceFromSums } from "../util/stats";
import {
  ExperimentSnapshotInterface,
  ExperimentSnapshotSettings,
} from "../../types/experiment-snapshot";
import { updateSnapshot } from "../models/ExperimentSnapshotModel";
import { getMetricMap } from "../models/MetricModel";
import { ExperimentInterface } from "../../types/experiment";
import { logger } from "../util/logger";
import { analyzeExperimentResults } from "./stats";
export type QueryMap = Map<string, QueryInterface>;

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

async function getExistingQuery(
  integration: SourceIntegrationInterface,
  query: string
): Promise<QueryInterface | null> {
  return await getRecentQuery(
    integration.organization,
    integration.datasource,
    query
  );
}

async function getQueryDoc<T extends Record<string, unknown>[], P>(
  integration: SourceIntegrationInterface,
  query: string,
  run: (query: string) => Promise<T>,
  process: (rows: T) => P,
  useExisting: boolean = true
): Promise<QueryInterface> {
  // Re-use recent identical query
  if (useExisting) {
    const existing = await getExistingQuery(integration, query);
    if (existing) return existing;
  }

  // Otherwise, create a new query in mongo;
  const doc = await createNewQuery({
    query,
    datasource: integration.datasource,
    organization: integration.organization,
    language: integration.getSourceProperties().queryLanguage,
  });

  // Update heartbeat for the query once every 30 seconds
  // This lets us detect orphaned queries where the thread died
  const timer = setInterval(() => {
    updateQuery(doc, { heartbeat: new Date() }).catch((e) => {
      logger.error(e);
    });
  }, 30000);

  // Run the query in the background
  run(query)
    .then((rows) => {
      clearInterval(timer);
      return updateQuery(doc, {
        finishedAt: new Date(),
        status: "succeeded",
        rawResult: rows as Record<string, string | boolean | number>[],
        result: process(rows),
      });
    })
    .catch((e) => {
      clearInterval(timer);
      updateQuery(doc, {
        finishedAt: new Date(),
        status: "failed",
        error: e.message,
      }).catch((e) => logger.error(e));
    });

  return doc;
}
//called by postPastExperiments in experiments.ts
export async function getPastExperiments(
  integration: SourceIntegrationInterface,
  from: Date
): Promise<QueryInterface> {
  return getQueryDoc(
    integration,
    integration.getPastExperimentQuery({
      from,
    }),
    (query) => integration.runPastExperimentQuery(query),
    processPastExperimentQueryResponse
  );
}

export async function getMetricValue(
  integration: SourceIntegrationInterface,
  params: MetricValueParams
): Promise<QueryInterface> {
  return getQueryDoc(
    integration,
    integration.getMetricValueQuery(params),
    (query) => integration.runMetricValueQuery(query),
    processMetricValueQueryResponse
  );
}

export async function getExperimentResults({
  integration,
  metrics,
  activationMetric,
  snapshotSettings,
  dimension,
}: {
  integration: SourceIntegrationInterface;
  snapshotSettings: ExperimentSnapshotSettings;
  metrics: MetricInterface[];
  activationMetric: MetricInterface | null;
  dimension: DimensionInterface | null;
}): Promise<QueryInterface> {
  const query = integration.getExperimentResultsQuery(
    snapshotSettings,
    metrics,
    activationMetric,
    dimension
  );

  return getQueryDoc(
    integration,
    query,
    () =>
      integration.getExperimentResults(
        snapshotSettings,
        metrics,
        activationMetric,
        dimension
      ),
    (rows) => processExperimentResultsResponse(snapshotSettings, rows),
    false
  );
}

export async function getExperimentMetric(
  integration: SourceIntegrationInterface,
  params: ExperimentMetricQueryParams,
  useCache: boolean
): Promise<QueryInterface> {
  return getQueryDoc(
    integration,
    integration.getExperimentMetricQuery(params),
    (query) => integration.runExperimentMetricQuery(query),
    (rows) => rows,
    useCache
  );
}

export function processPastExperimentQueryResponse(
  rows: PastExperimentResponse
): PastExperimentResult {
  return {
    experiments: rows.map((row) => {
      return {
        exposureQueryId: row.exposure_query,
        users: row.users,
        experiment_id: row.experiment_id,
        experiment_name: row.experiment_name,
        variation_id: row.variation_id,
        variation_name: row.variation_name,
        end_date: getValidDate(row.end_date),
        start_date: getValidDate(row.start_date),
      };
    }),
  };
}

export function processExperimentResultsResponse(
  snapshotSettings: ExperimentSnapshotSettings,
  rows: ExperimentQueryResponses
): ExperimentResults {
  const ret: ExperimentResults = {
    dimensions: [],
    unknownVariations: [],
  };

  const variationMap = new Map<string, number>();
  snapshotSettings.variations.forEach((v, i) => variationMap.set(v.id, i));

  const unknownVariations: Map<string, number> = new Map();
  let totalUsers = 0;

  const dimensionMap = new Map<string, number>();

  rows.forEach(({ dimension, metrics, users, variation }) => {
    let i = 0;
    if (dimensionMap.has(dimension)) {
      i = dimensionMap.get(dimension) || 0;
    } else {
      i = ret.dimensions.length;
      ret.dimensions.push({
        dimension,
        variations: [],
      });
      dimensionMap.set(dimension, i);
    }

    const numUsers = users || 0;
    totalUsers += numUsers;

    const varIndex = variationMap.get(variation + "");
    if (
      typeof varIndex === "undefined" ||
      varIndex < 0 ||
      varIndex >= snapshotSettings.variations.length
    ) {
      unknownVariations.set(variation, numUsers);
      return;
    }

    const metricData: { [key: string]: ExperimentMetricStats } = {};
    metrics.forEach(({ metric, ...stats }) => {
      metricData[metric] = stats;
    });

    ret.dimensions[i].variations.push({
      variation: varIndex,
      users: numUsers,
      metrics: metricData,
    });
  });

  unknownVariations.forEach((users, variation) => {
    // Ignore unknown variations with an insignificant number of users
    // This protects against random typos causing false positives
    if (totalUsers > 0 && users / totalUsers >= 0.02) {
      ret.unknownVariations.push(variation);
    }
  });

  return ret;
}

export function processMetricValueQueryResponse(
  rows: MetricValueQueryResponse
): MetricValueResult {
  const ret: MetricValueResult = { count: 0, mean: 0, stddev: 0 };

  rows.forEach((row) => {
    const { date, count, main_sum, main_sum_squares } = row;
    const mean = main_sum / count;
    const stddev = Math.sqrt(
      meanVarianceFromSums(main_sum, main_sum_squares, count)
    );
    // Row for each date
    if (date) {
      ret.dates = ret.dates || [];
      ret.dates.push({
        date,
        count,
        mean,
        stddev,
      });
    }
    // Overall numbers
    else {
      ret.count = count;
      ret.mean = mean;
      ret.stddev = stddev;
    }
  });

  return ret;
}

export async function getQueryData(
  queries: Queries,
  organization: string,
  map?: QueryMap
): Promise<QueryMap> {
  const docs = await getQueriesByIds(
    organization,
    queries.map((q) => q.query)
  );

  const res: QueryMap = map || new Map();
  docs.forEach((doc) => {
    const match = queries.filter((q) => q.query === doc.id)[0];
    if (!match) return;
    res.set(match.name, doc);
  });

  return res;
}

export function getOverallQueryStatus(pointers: Queries): QueryStatus {
  const hasFailedQueries = pointers.some((q) => q.status === "failed");
  const hasRunningQueries = pointers.some((q) => q.status === "running");
  return hasFailedQueries
    ? "failed"
    : hasRunningQueries
    ? "running"
    : "succeeded";
}

export async function updateQueryPointers(
  organization: string,
  pointers: QueryPointer[]
): Promise<{
  pointers: QueryPointer[];
  overallStatus: QueryStatus;
  hasChanges: boolean;
  queryMap: QueryMap;
}> {
  const queries = await getQueriesByIds(
    organization,
    pointers.map((p) => p.query)
  );

  const updateQueryPromises: Promise<QueryInterface>[] = [];

  let hasChanges = false;
  const queryMap: QueryMap = new Map();
  queries.forEach((query) => {
    // Running with no recent heartbeat, update to mark as failed
    if (
      query.status === "running" &&
      Date.now() - query.heartbeat.getTime() > 150000
    ) {
      query.status = "failed";
      updateQueryPromises.push(updateQuery(query, { status: "failed" }));
    }

    // Update pointer status to match query status
    const pointer = pointers.find((p) => p.query === query.id);
    if (!pointer) return;

    // Build a query map based on the pointer name
    queryMap.set(pointer.name, query);

    if (pointer.status !== query.status) {
      hasChanges = true;
      pointer.status = query.status;
    }
  });

  if (updateQueryPromises.length > 0) {
    await Promise.all(updateQueryPromises);
  }

  return {
    pointers,
    overallStatus: getOverallQueryStatus(pointers),
    hasChanges,
    queryMap,
  };
}

export async function refreshSnapshotStatus(
  snapshot: ExperimentSnapshotInterface,
  experiment: ExperimentInterface
): Promise<ExperimentSnapshotInterface> {
  const {
    pointers: queries,
    hasChanges,
    overallStatus,
    queryMap,
  } = await updateQueryPointers(snapshot.organization, snapshot.queries);

  if (!hasChanges) return snapshot;

  const changes: Partial<ExperimentSnapshotInterface> = {
    status:
      overallStatus === "failed"
        ? "error"
        : overallStatus === "running"
        ? "running"
        : overallStatus === "succeeded"
        ? "success"
        : undefined,
    queries: queries,
  };

  // If it's going from "running" to "failed", update the error field
  if (snapshot.status === "running" && overallStatus === "failed") {
    changes.error = "There was an error running one or more database queries.";
  }

  // If it's going from "running" to "succeeded", run each analyses
  if (snapshot.status === "running" && overallStatus === "succeeded") {
    const metricMap = await getMetricMap(snapshot.organization);

    const analysisPromises: Promise<void>[] = [];
    const newAnalyses = snapshot.analyses;
    newAnalyses.forEach((analysis) => {
      analysisPromises.push(
        (async () => {
          try {
            const results = await analyzeExperimentResults({
              queryData: queryMap,
              snapshotSettings: snapshot.settings,
              analysisSettings: analysis.settings,
              variationNames: experiment.variations.map((v) => v.name),
              metricMap,
            });

            analysis.results = results.dimensions || [];
            analysis.status = "success";
            analysis.error = "";

            // TODO: do this once, not per analysis
            changes.unknownVariations = results.unknownVariations || [];
            changes.multipleExposures = results.multipleExposures ?? 0;
          } catch (e) {
            analysis.error = e?.message || "An error occurred";
            analysis.status = "error";
          }
        })()
      );
    });

    if (analysisPromises.length > 0) {
      await Promise.all(analysisPromises);
      changes.analyses = newAnalyses;
    }
  }

  await updateSnapshot(snapshot.organization, snapshot.id, changes);

  return {
    ...snapshot,
    ...changes,
  };
}

export async function updateQueryStatuses(
  queries: Queries,
  organization: string,
  onUpdate: (queries: Queries, error?: string) => Promise<void>,
  onSuccess: (queries: Queries, data: QueryMap) => Promise<void>,
  currentError?: string
): Promise<QueryStatus> {
  // Group queries by status
  const byStatus: Record<QueryStatus, QueryPointer[]> = {
    failed: [],
    running: [],
    succeeded: [],
  };

  queries.forEach((q) => {
    byStatus[q.status].push(q);
  });

  // If there's at least 1 failed query, the overall status is failed
  if (currentError || byStatus.failed.length > 0) {
    return "failed";
  }

  // If all of the queries are successful already, the overall status is success
  if (byStatus.running.length === 0) {
    return "succeeded";
  }

  // Some queries are still running, fetch the latest statuses
  const queryMap = await getQueryData(byStatus.running, organization);
  let needsUpdate = false;
  byStatus.running.forEach((q) => {
    const latest = queryMap.get(q.name);
    if (!latest) {
      return;
    }

    let status = latest.status;
    if (
      status === "running" &&
      Date.now() - latest.heartbeat.getTime() > 150000
    ) {
      status = "failed";
    }

    if (status !== q.status) {
      needsUpdate = true;
      q.status = status;
    }
  });

  // If all of the queries are finished now for the first time
  if (
    byStatus.running.filter((q) => q.status === "succeeded").length ===
    byStatus.running.length
  ) {
    // Add results from the already successful queries
    await getQueryData(byStatus.succeeded, organization, queryMap);
    await onSuccess(queries, queryMap);
    return "succeeded";
  }

  // If one of the queries just failed for the first time
  if (byStatus.running.some((q) => q.status === "failed")) {
    await onUpdate(
      queries,
      "There was an error running one or more database queries."
    );
    return "failed";
  }

  // If the queries are still running, but the status needs to get updated
  if (needsUpdate) {
    onUpdate(queries);
  }
  return "running";
}

export async function startRun<T>(
  docs: { [key: string]: Promise<QueryInterface> },
  processResults: (data: QueryMap) => Promise<T>
): Promise<{
  queries: Queries;
  result?: T;
}> {
  const queryData: QueryMap = new Map();

  const queries: Queries = await Promise.all(
    Object.keys(docs).map(async (k) => {
      const doc = await docs[k];
      queryData.set(k, doc);
      return {
        name: k,
        query: doc.id,
        status: doc.status,
      };
    })
  );

  let result;
  if (queries.filter((q) => q.status !== "succeeded").length === 0) {
    result = await processResults(queryData);
  }

  return {
    queries,
    result,
  };
}

export async function cancelRun<T extends InterfaceWithQueries>(
  doc: T,
  organization: string,
  onDelete: () => Promise<void>
) {
  if (!doc) {
    throw new Error("Could not find document");
  }
  if (doc.organization !== organization) {
    throw new Error("You do not have access to this document");
  }

  // Only cancel if it's currently running
  if (doc.queries.filter((q) => q.status === "running").length > 0) {
    await onDelete();
  }

  return {
    status: 200,
  };
}

export async function getStatusEndpoint<T extends InterfaceWithQueries, R>(
  doc: T,
  organization: string,
  processResults: (data: QueryMap) => Promise<R>,
  onSave: (
    data: Partial<InterfaceWithQueries>,
    result?: R,
    error?: string
  ) => Promise<void>,
  currentError?: string
) {
  if (!doc) {
    throw new Error("Could not find document");
  }

  if (doc.organization !== organization) {
    throw new Error("You do not have access to this document");
  }

  const status = await updateQueryStatuses(
    doc.queries,
    organization,
    async (queries: Queries, error?: string) => {
      await onSave({ queries }, undefined, error || undefined);
    },
    async (queries: Queries, data: QueryMap) => {
      let error = "";
      let results: R | undefined = undefined;
      try {
        results = await processResults(data);
      } catch (e) {
        error = e.message;
      }
      await onSave({ queries }, results, error);
    },
    currentError
  );

  return {
    status: 200,
    queryStatus: status,
    elapsed: Math.floor(
      (Date.now() - (doc?.runStarted?.getTime() || 0)) / 1000
    ),
    finished: doc.queries.filter((q) => q.status === "succeeded").length,
    total: doc.queries.length,
  };
}
