import mongoose from "mongoose";
import uniqid from "uniqid";
import { omit } from "lodash";
import {
  CreateFactFilterProps,
  CreateFactTableProps,
  FactFilterInterface,
  FactTableInterface,
  UpdateFactFilterProps,
  UpdateColumnProps,
  UpdateFactTableProps,
} from "../../types/fact-table";
import { ReliableDimensionInterface } from "../types/Integration";
import { queriesSchema } from "./QueryModel";

const reliableDimensionSchema = new mongoose.Schema({
  id: {
    type: String,
    unique: true,
  },
  organization: String,
  runStarted: Date,

  queries: queriesSchema,

  datasource: String,
  exposureQueryId: String,

  results: [], // TODO 
  error: String,
});

type ReliableDimensionDocument = mongoose.Document & ReliableDimensionInterface;

const ReliableDimensionModel = mongoose.model<ReliableDimensionInterface>(
  "ReliableDimension",
  reliableDimensionSchema
);

function toInterface(doc: ReliableDimensionDocument): ReliableDimensionInterface {
  const ret = doc.toJSON<ReliableDimensionDocument>();
  return omit(ret, ["__v", "_id"]);
}


export async function updateReliableDimension(
  reliableDimension: ReliableDimensionInterface,
  updates: Partial<ReliableDimensionInterface>
): Promise<ReliableDimensionInterface> {
  const organization = reliableDimension.organization;
  const id = reliableDimension.id;
  await ReliableDimensionModel.updateOne(
    {
      organization,
      id
    },
    {
      $set: updates,
    }
  );
  return {
    ...reliableDimension,
    ...updates
  }
}
export async function getReliableDimensionById(organization: string, id: string) {
  const doc = await ReliableDimensionModel.findOne({ organization, id });

  return doc ? toInterface(doc) : null;
}

export async function getLatestReliableDimension(organization: string, datasource: string, exposureQueryId: string): Promise<ReliableDimensionInterface | null>{
  // TODO get no error or status === good
  console.log(datasource);
  console.log(exposureQueryId);
  const doc = await ReliableDimensionModel.find(
    { organization, datasource, exposureQueryId },
    null,
    {
      sort: { dateCreated: -1 },
      limit: 1,
    }
  ).exec();
  if (doc[0]) {
    return toInterface(doc[0]);
  }
  return null;
}

export async function createReliableDimension({
  organization,
  datasourceId,
  queryId,
}: {
  organization: string;
  datasourceId: string;
  queryId: string;
}) {
  const now = new Date();
  const doc = await ReliableDimensionModel.create({
    id: uniqid("reld_"),
    organization,
    datasource: datasourceId,
    exposureQueryId: queryId,
    runStarted: now,
    error: "",
    queries: []
  });

  return toInterface(doc);
}
