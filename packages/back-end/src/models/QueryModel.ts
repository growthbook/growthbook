import mongoose from "mongoose";
import { omit } from "lodash";
import { QueryInterface } from "../../types/query";

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

export type QueryDocument = mongoose.Document & QueryInterface;

export const QueryModel = mongoose.model<QueryInterface>("Query", querySchema);

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
  organization: string,
  id: string,
  changes: Partial<QueryInterface>
): Promise<void> {
  await QueryModel.updateOne({ organization, id }, { $set: changes });
}
