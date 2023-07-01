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
  status: String,
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
  // Only re-use queries that were started recently
  const earliestDate = new Date();
  earliestDate.setMinutes(earliestDate.getMinutes() - QUERY_CACHE_TTL_MINS);

  // Only re-use running queries if they've had a heartbeat recently
  const lastHeartbeat = new Date();
  lastHeartbeat.setMinutes(lastHeartbeat.getMinutes() - 2);

  // Last successful query
  const lastSuccess = await QueryModel.find({
    organization,
    datasource,
    query,
    createdAt: {
      $gt: earliestDate,
    },
    status: "succeeded",
  })
    .sort({ createdAt: -1 })
    .limit(1);

  // If there's an actively running query since the last success, use that instead
  const lastRunning = await QueryModel.find({
    organization,
    datasource,
    query,
    createdAt: {
      $gt: lastSuccess?.[0]?.createdAt || earliestDate,
    },
    status: "running",
    heartbeat: {
      $gte: lastHeartbeat,
    },
  })
    .sort({ createdAt: -1 })
    .limit(1);

  const mostRecent = lastRunning?.[0] || lastSuccess?.[0];

  return mostRecent ? toInterface(mostRecent) : null;
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
