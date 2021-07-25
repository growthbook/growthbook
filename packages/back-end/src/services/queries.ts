import { QueryDocument, QueryModel } from "../models/QueryModel";
import {
  UsersQueryParams,
  MetricValueParams,
  SourceIntegrationInterface,
  ExperimentUsersQueryParams,
  ExperimentMetricQueryParams,
} from "../types/Integration";
import uniqid from "uniqid";
import mongoose from "mongoose";
import {
  Queries,
  QueryInterface,
  QueryPointer,
  QueryStatus,
} from "../../types/query";
import { ExperimentInterface, ExperimentPhase } from "../../types/experiment";
import { MetricInterface } from "../../types/metric";
import { DimensionInterface } from "../../types/dimension";
export type QueryMap = Map<string, QueryInterface>;

export type InterfaceWithQueries = {
  runStarted: Date;
  queries: Queries;
  organization: string;
};
export type DocumentWithQueries = mongoose.Document & InterfaceWithQueries;

async function getExistingQuery(
  integration: SourceIntegrationInterface,
  query: string
): Promise<QueryDocument | null> {
  const lasthour = new Date();
  lasthour.setHours(lasthour.getHours() - 1);

  const twoMinutesAgo = new Date();
  twoMinutesAgo.setMinutes(twoMinutesAgo.getMinutes() - 2);

  const existing = await QueryModel.find({
    organization: integration.organization,
    datasource: integration.datasource,
    query,
    createdAt: {
      $gt: lasthour,
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
    if (existing[i].heartbeat >= twoMinutesAgo) {
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
    finishedAt: result || error ? new Date() : null,
    heartbeat: new Date(),
    id: uniqid("qry_"),
    language: integration.getSourceProperties().queryLanguage,
    organization: integration.organization,
    query,
    startedAt: new Date(),
    status: result ? "succeeded" : error ? "failed" : "running",
    result,
    error,
  };
  return await QueryModel.create(data);
}

function runBackgroundQuery<T>(run: Promise<T>, doc: QueryDocument) {
  // Update heartbeat for the query once every 30 seconds
  // This lets us detect orphaned queries where the thread died
  const timer = setInterval(() => {
    doc.set("heartbeat", new Date());
    doc.save();
  }, 30000);

  run.then((res) => {
    clearInterval(timer);
    doc.set("finishedAt", new Date());
    doc.set("status", "succeeded");
    doc.set("result", res);
    doc.save();
  });

  run.catch((e) => {
    clearInterval(timer);
    doc.set("finishedAt", new Date());
    doc.set("status", "failed");
    doc.set("error", e.message);
    doc.save();
  });
}

async function getQueryDoc<T>(
  integration: SourceIntegrationInterface,
  query: string,
  run: (query: string) => Promise<T>,
  useExisting: boolean = true
): Promise<QueryDocument> {
  // Re-use recent identical query
  if (useExisting) {
    const existing = await getExistingQuery(integration, query);
    if (existing) return existing;
  }

  // Otherwise, create a new query in mongo;
  const doc = await createNewQuery(integration, query);

  // Run the query in the background
  runBackgroundQuery<T>(run(query), doc);

  return doc;
}

export async function getPastExperiments(
  integration: SourceIntegrationInterface,
  from: Date
): Promise<QueryDocument> {
  return getQueryDoc(
    integration,
    integration.getPastExperimentQuery(from),
    (query: string) => integration.runPastExperimentQuery(query)
  );
}

export async function getUsers(
  integration: SourceIntegrationInterface,
  params: UsersQueryParams
): Promise<QueryDocument> {
  return getQueryDoc(
    integration,
    integration.getUsersQuery(params),
    (query: string) => integration.runUsersQuery(query)
  );
}
export async function getMetricValue(
  integration: SourceIntegrationInterface,
  params: MetricValueParams
): Promise<QueryDocument> {
  return getQueryDoc(
    integration,
    integration.getMetricValueQuery(params),
    (query: string) => integration.runMetricValueQuery(query)
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
    false
  );
}

export async function getExperimentUsers(
  integration: SourceIntegrationInterface,
  params: ExperimentUsersQueryParams
): Promise<QueryDocument> {
  return getQueryDoc(
    integration,
    integration.getExperimentUsersQuery(params),
    (query: string) =>
      integration.runExperimentUsersQuery(params.experiment, query),
    false
  );
}

export async function getExperimentMetric(
  integration: SourceIntegrationInterface,
  params: ExperimentMetricQueryParams
): Promise<QueryDocument> {
  return getQueryDoc(
    integration,
    integration.getExperimentMetricQuery(params),
    (query: string) =>
      integration.runExperimentMetricQuery(params.experiment, query),
    false
  );
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
  onSuccess: (queries: Queries, data: QueryMap) => Promise<void>
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
  if (byStatus.failed.length > 0) {
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
      q.status = latest.status;
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

export async function cancelRun<T extends DocumentWithQueries>(
  doc: T,
  organization: string,
  onDelete?: () => Promise<void>
) {
  if (!doc) {
    throw new Error("Could not find document");
  }
  if (doc.organization !== organization) {
    throw new Error("You do not have access to this document");
  }

  // Only cancel if it's currently running
  if (doc.queries.filter((q) => q.status === "running").length > 0) {
    if (onDelete) {
      await onDelete();
    } else {
      doc.set("queries", []);
      doc.set("runStarted", null);
      await doc.save();
    }
  }

  return {
    status: 200,
  };
}

export async function getStatusEndpoint<T extends DocumentWithQueries, R>(
  doc: T,
  organization: string,
  resultsKey: string,
  processResults: (data: QueryMap) => Promise<R>
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
      doc.set("queries", queries);
      await doc.save();
    },
    async (queries: Queries, data: QueryMap) => {
      doc.set("queries", queries);
      const results = await processResults(data);
      doc.set(resultsKey, results);
      await doc.save();
    }
  );

  return {
    status: 200,
    queryStatus: status,
    elapsed: Math.floor((Date.now() - doc?.runStarted?.getTime()) / 1000),
    finished: doc.queries.filter((q) => q.status === "succeeded").length,
    total: doc.queries.length,
  };
}
