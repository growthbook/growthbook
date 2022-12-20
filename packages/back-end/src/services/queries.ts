import uniqid from "uniqid";
import { QueryDocument, QueryModel } from "../models/QueryModel";
import {
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
import { ExperimentInterface, ExperimentPhase } from "../../types/experiment";
import { MetricInterface, MetricStats } from "../../types/metric";
import { DimensionInterface } from "../../types/dimension";
import { getValidDate } from "../util/dates";
import { QUERY_CACHE_TTL_MINS } from "../util/secrets";
export type QueryMap = Map<string, QueryInterface>;

export type InterfaceWithQueries = {
  runStarted: Date | null;
  queries: Queries;
  organization: string;
};

async function getExistingQuery(
  integration: SourceIntegrationInterface,
  query: string
): Promise<QueryDocument | null> {
  // Only re-use queries that were started recently
  const earliestDate = new Date();
  earliestDate.setMinutes(earliestDate.getMinutes() - QUERY_CACHE_TTL_MINS);

  // Only re-use running queries if they've had a heartbeat recently
  const lastHeartbeat = new Date();
  lastHeartbeat.setMinutes(lastHeartbeat.getMinutes() - 2);

  const existing = await QueryModel.find({
    organization: integration.organization,
    datasource: integration.datasource,
    query,
    createdAt: {
      $gt: earliestDate,
    },
    status: {
      $in: ["running", "succeeded"],
    },
  })
    .sort({ createdAt: -1 })
    .limit(5);
  for (let i = 0; i < existing.length; i++) {
    if (existing[i].status === "succeeded") {
      return existing[i];
    }
    if (existing[i].heartbeat >= lastHeartbeat) {
      return existing[i];
    }
  }

  return null;
}

async function createNewQuery(
  integration: SourceIntegrationInterface,
  query: string,
  // eslint-disable-next-line
  result: null | Record<string, any> = null,
  error: null | string = null
): Promise<QueryDocument> {
  const data: QueryInterface = {
    createdAt: new Date(),
    datasource: integration.datasource,
    finishedAt: result || error ? new Date() : undefined,
    heartbeat: new Date(),
    id: uniqid("qry_"),
    language: integration.getSourceProperties().queryLanguage,
    organization: integration.organization,
    query,
    startedAt: new Date(),
    status: result ? "succeeded" : error ? "failed" : "running",
    result: result || undefined,
    error: error || undefined,
  };
  return await QueryModel.create(data);
}

async function getQueryDoc<T, P>(
  integration: SourceIntegrationInterface,
  query: string,
  run: (query: string) => Promise<T>,
  process: (rows: T) => P,
  useExisting: boolean = true
): Promise<QueryDocument> {
  // Re-use recent identical query
  if (useExisting) {
    const existing = await getExistingQuery(integration, query);
    if (existing) return existing;
  }

  // Otherwise, create a new query in mongo;
  const doc = await createNewQuery(integration, query);

  // Update heartbeat for the query once every 30 seconds
  // This lets us detect orphaned queries where the thread died
  const timer = setInterval(() => {
    doc.set("heartbeat", new Date());
    doc.save();
  }, 30000);

  // Run the query in the background
  run(query)
    .then((rows) => {
      clearInterval(timer);
      doc.set("finishedAt", new Date());
      doc.set("status", "succeeded");
      doc.set("rawResult", rows);
      doc.set("result", process(rows));
      doc.save();
    })
    .catch((e) => {
      clearInterval(timer);
      doc.set("finishedAt", new Date());
      doc.set("status", "failed");
      doc.set("error", e.message);
      doc.save();
    });

  return doc;
}
//called by postPastExperiments in experiments.ts
export async function getPastExperiments(
  integration: SourceIntegrationInterface,
  from: Date
): Promise<QueryDocument> {
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
): Promise<QueryDocument> {
  return getQueryDoc(
    integration,
    integration.getMetricValueQuery(params),
    (query) => integration.runMetricValueQuery(query),
    processMetricValueQueryResponse
  );
}

export async function getExperimentResults(
  integration: SourceIntegrationInterface,
  experiment: ExperimentInterface,
  phase: ExperimentPhase,
  metrics: MetricInterface[],
  activationMetric: MetricInterface | null,
  dimension: DimensionInterface | null
): Promise<QueryDocument> {
  const query = integration.getExperimentResultsQuery(
    experiment,
    phase,
    metrics,
    activationMetric,
    dimension
  );

  return getQueryDoc(
    integration,
    query,
    () =>
      integration.getExperimentResults(
        experiment,
        phase,
        metrics,
        activationMetric,
        dimension
      ),
    (rows) => processExperimentResultsResponse(experiment, rows),
    false
  );
}

export async function getExperimentMetric(
  integration: SourceIntegrationInterface,
  params: ExperimentMetricQueryParams,
  useCache: boolean
): Promise<QueryDocument> {
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

function getVariationMap(experiment: ExperimentInterface) {
  const variationMap = new Map<string, number>();
  experiment.variations.forEach((v, i) => {
    variationMap.set(v.key || i + "", i);
  });
  return variationMap;
}

export function processExperimentResultsResponse(
  experiment: ExperimentInterface,
  rows: ExperimentQueryResponses
): ExperimentResults {
  const ret: ExperimentResults = {
    dimensions: [],
    unknownVariations: [],
  };

  const variationMap = getVariationMap(experiment);

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
      varIndex >= experiment.variations.length
    ) {
      unknownVariations.set(variation, numUsers);
      return;
    }

    const metricData: { [key: string]: MetricStats } = {};
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
    const { date, count, mean, stddev } = row;

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
  const docs = await QueryModel.find({
    organization,
    id: {
      $in: queries.map((q) => q.query),
    },
  });

  const res: QueryMap = map || new Map();
  docs.forEach((doc) => {
    const match = queries.filter((q) => q.query === doc.id)[0];
    if (!match) return;
    res.set(match.name, doc);
  });

  return res;
}

export async function updateQueryStatuses(
  queries: Queries,
  organization: string,
  onUpdate: (queries: Queries) => Promise<void>,
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

  // If the queries are still running, but the status needs to get updated
  if (needsUpdate) {
    onUpdate(queries);
  }
  return "running";
}

export async function startRun<T>(
  docs: { [key: string]: Promise<QueryDocument> },
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
    async (queries: Queries) => {
      await onSave({ queries });
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
