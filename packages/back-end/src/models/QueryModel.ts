import mongoose from "mongoose";
import { omit } from "lodash";
import uniqid from "uniqid";
import { QueryInterface } from "../../types/query";
import { QUERY_CACHE_TTL_MINS } from "../util/secrets";
import { QueryLanguage } from "../../types/datasource";

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
  createdAt: Date,
  startedAt: Date,
  finishedAt: Date,
  heartbeat: Date,
  result: {},
  rawResult: [],
  error: String,
});

type QueryDocument = mongoose.Document & QueryInterface;

const QueryModel = mongoose.model<QueryInterface>("Query", querySchema);

function toInterface(doc: QueryDocument): QueryInterface {
  const ret = doc.toJSON<QueryDocument>();
  return omit(ret, ["__v", "_id"]);
}

export async function getQueriesByIds(organization: string, ids: string[]) {
  if (!ids.length) return [];
  const docs = await QueryModel.find({ organization, id: { $in: ids } });
  return docs.map((doc) => toInterface(doc));
}

export async function updateQuery(
  query: QueryInterface,
  changes: Partial<QueryInterface>
): Promise<QueryInterface> {
  await QueryModel.updateOne(
    { organization: query.organization, id: query.id },
    { $set: changes }
  );
  return {
    ...query,
    ...changes,
  };
}

export async function getRecentQuery(
  organization: string,
  datasource: string,
  query: string
) {
  // Only re-use queries that were run recently
  const earliestDate = new Date();
  earliestDate.setMinutes(earliestDate.getMinutes() - QUERY_CACHE_TTL_MINS);

  const latest = await QueryModel.find({
    organization,
    datasource,
    query,
    createdAt: {
      $gt: earliestDate,
    },
    status: { $in: ["succeeded", "running"] },
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
    }
  );

  return docs.map((doc) => ({ id: doc.id, organization: doc.organization }));
}

export async function createNewQuery({
  organization,
  datasource,
  language,
  query,
  result = null,
  error = null,
}: {
  organization: string;
  datasource: string;
  language: QueryLanguage;
  query: string;
  result?: null | Record<string, unknown>;
  error?: null | string;
}): Promise<QueryInterface> {
  const data: QueryInterface = {
    createdAt: new Date(),
    datasource,
    finishedAt: result || error ? new Date() : undefined,
    heartbeat: new Date(),
    id: uniqid("qry_"),
    language,
    organization,
    query,
    startedAt: new Date(),
    status: result ? "succeeded" : error ? "failed" : "running",
    result: result || undefined,
    error: error || undefined,
  };
  const doc = await QueryModel.create(data);
  return toInterface(doc);
}
