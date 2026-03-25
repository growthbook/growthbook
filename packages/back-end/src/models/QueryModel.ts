import mongoose from "mongoose";
import { omit } from "lodash";
import uniqid from "uniqid";
import { QueryInterface, QueryType } from "shared/types/query";
import { QueryLanguage } from "shared/types/datasource";
import { ApiQuery } from "shared/types/openapi";
import { QUERY_CACHE_TTL_MINS } from "back-end/src/util/secrets";
import type { ReqContext } from "back-end/types/request";
import type { ApiReqContext } from "back-end/types/api";

export const queriesSchema = [
  {
    _id: false,
    query: String,
    status: String,
    name: String,
  },
];

const querySchema = new mongoose.Schema({
  id: {
    type: String,
    unique: true,
  },
  displayTitle: String,
  organization: {
    type: String,
    index: true,
  },
  datasource: String,
  language: String,
  query: String,
  status: {
    type: String,
    index: true,
  },
  queryType: String,
  createdAt: Date,
  startedAt: Date,
  finishedAt: Date,
  heartbeat: Date,
  externalId: String,
  result: {},
  rawResult: [],
  hasChunkedResults: Boolean,
  error: String,
  statistics: {},
  dependencies: [String],
  runAtEnd: Boolean,
  cachedQueryUsed: String,
});

querySchema.index({ organization: 1, datasource: 1, status: 1, createdAt: -1 });

type QueryDocument = mongoose.Document & QueryInterface;

const QueryModel = mongoose.model<QueryInterface>("Query", querySchema);

function toInterface(doc: QueryDocument): QueryInterface {
  const ret = doc.toJSON<QueryDocument>();
  return omit(ret, ["__v", "_id"]);
}

export async function getQueriesByIds(
  context: ReqContext,
  ids: string[],
  includeChunkedResults: boolean = true,
) {
  if (!ids.length) return [];
  const docs = await QueryModel.find({
    organization: context.org.id,
    id: { $in: ids },
  });
  const queries = docs.map((doc) => toInterface(doc));

  if (includeChunkedResults) {
    await context.models.sqlResultChunks.addResultsToQueries(queries);
  }

  return queries;
}

export async function getQueryById(
  context: ReqContext | ApiReqContext,
  id: string,
) {
  const doc = await QueryModel.findOne({
    organization: context.org.id,
    id: id,
  });
  return doc ? toInterface(doc) : null;
}

export async function getQueriesByDatasource(
  organization: string,
  datasource: string,
  limit: number = 50,
) {
  const docs = await QueryModel.find({ organization, datasource })
    .limit(limit)
    .sort({
      createdAt: -1,
    });
  return docs.map((doc) => toInterface(doc));
}

export async function countRunningQueries(
  organization: string,
  datasource: string,
) {
  return await QueryModel.find({
    organization,
    datasource,
    status: "running",
  }).count();
}

export async function updateQuery(
  context: ReqContext,
  query: QueryInterface,
  changes: Partial<QueryInterface>,
): Promise<QueryInterface> {
  if (query.organization !== context.org.id) {
    throw new Error("Cannot update query from different organization");
  }

  // If we're setting results, store them in a separate collection
  // Some legacy queries have processed results that differ from raw results, so skip those
  if (
    changes.result &&
    changes.result === changes.rawResult &&
    changes.rawResult.length > 0
  ) {
    await context.models.sqlResultChunks.createFromResults(
      query.id,
      changes.rawResult,
    );
    changes = omit(changes, ["result", "rawResult"]);
    changes.hasChunkedResults = true;
  }

  await QueryModel.updateOne(
    { organization: query.organization, id: query.id },
    { $set: changes },
  );
  return {
    ...query,
    ...changes,
  };
}

export async function getRecentQuery(
  organization: string,
  datasource: string,
  query: string,
  cacheTTLMins?: number,
) {
  // Only re-use queries that were run recently
  const ttl = cacheTTLMins ?? QUERY_CACHE_TTL_MINS;
  const earliestDate = new Date();
  earliestDate.setMinutes(earliestDate.getMinutes() - ttl);

  const latest = await QueryModel.find({
    organization,
    datasource,
    query,
    createdAt: {
      $gt: earliestDate,
    },
    status: { $in: ["succeeded", "running"] },
    // Exclude documents that were created from cache - they shouldn't reset the TTL
    cachedQueryUsed: { $exists: false },
  })
    .sort({ createdAt: -1 })
    .limit(1);

  return latest[0] ? toInterface(latest[0]) : null;
}

export async function getStaleQueries(): Promise<
  { id: string; organization: string }[]
> {
  // Queries get a heartbeat updated every 30 seconds while actively running
  // If there's a fatal error (e.g. Node gets killed), a query could be stuck in a "running" state
  // This looks for any recent query that missed 2 heartbeats and marks them as failed
  const lastHeartbeat = new Date();
  lastHeartbeat.setSeconds(lastHeartbeat.getSeconds() - 70);

  const query = {
    status: "running",
    heartbeat: {
      $lt: lastHeartbeat,
    },
  };

  const docs = await QueryModel.find(query, {
    _id: 1,
    id: 1,
    organization: 1,
  }).limit(20);
  if (!docs.length) return [];

  await QueryModel.updateMany(
    {
      ...query,
      _id: { $in: docs.map((d) => d._id) },
    },
    {
      $set: {
        status: "failed",
        error: "Query execution was interupted. Please try again.",
      },
    },
  );

  return docs.map((doc) => ({ id: doc.id, organization: doc.organization }));
}

export async function createNewQuery({
  organization,
  datasource,
  language,
  query,
  displayTitle,
  dependencies = [],
  running = false,
  queryType = "",
  runAtEnd = false,
}: {
  organization: string;
  datasource: string;
  language: QueryLanguage;
  query: string;
  displayTitle?: string;
  dependencies: string[];
  running: boolean;
  queryType: QueryType;
  runAtEnd?: boolean;
}): Promise<QueryInterface> {
  const data: QueryInterface = {
    createdAt: new Date(),
    datasource,
    heartbeat: new Date(),
    id: uniqid("qry_"),
    language,
    organization,
    query,
    displayTitle,
    startedAt: running ? new Date() : undefined,
    status: running ? "running" : "queued",
    dependencies: dependencies,
    runAtEnd: runAtEnd,
    queryType,
  };
  const doc = await QueryModel.create(data);
  return toInterface(doc);
}

export async function createNewQueryFromCached({
  existing,
  dependencies,
  runAtEnd,
}: {
  existing: QueryInterface;
  dependencies: string[];
  runAtEnd?: boolean;
}): Promise<QueryInterface> {
  const data: QueryInterface = {
    createdAt: new Date(),
    datasource: existing.datasource,
    heartbeat: new Date(),
    id: uniqid("qry_"),
    displayTitle: existing.displayTitle,
    language: existing.language,
    organization: existing.organization,
    query: existing.query,
    startedAt: existing.startedAt,
    finishedAt: existing.finishedAt,
    status: existing.status,
    result: existing.result,
    rawResult: existing.rawResult,
    error: existing.error,
    statistics: existing.statistics,
    dependencies: dependencies,
    runAtEnd: runAtEnd,
    cachedQueryUsed: existing.cachedQueryUsed || existing.id,
    hasChunkedResults: existing.hasChunkedResults,
  };
  const doc = await QueryModel.create(data);
  return toInterface(doc);
}

export function toQueryApiInterface(query: QueryInterface): ApiQuery {
  return {
    id: query.id,
    organization: query.organization,
    datasource: query.datasource,
    language: query.language,
    query: query.query,
    queryType: query.queryType || "",
    createdAt: query.createdAt?.toISOString() || "",
    startedAt: query.startedAt?.toISOString() || "",
    status: query.status,
    externalId: query.externalId ? query.externalId : "",
    dependencies: query.dependencies ? query.dependencies : [],
    runAtEnd: query.runAtEnd ? query.runAtEnd : false,
  };
}
