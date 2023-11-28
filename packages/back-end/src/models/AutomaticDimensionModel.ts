import mongoose from "mongoose";
import uniqid from "uniqid";
import { omit } from "lodash";
import { AutomaticDimensionInterface } from "../types/Integration";
import { queriesSchema } from "./QueryModel";

const automaticDimensionSchema = new mongoose.Schema({
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

type AutomaticDimensionDocument = mongoose.Document &
  AutomaticDimensionInterface;

const AutomaticDimensionModel = mongoose.model<AutomaticDimensionInterface>(
  "AutomaticDimension",
  automaticDimensionSchema
);

function toInterface(
  doc: AutomaticDimensionDocument
): AutomaticDimensionInterface {
  const ret = doc.toJSON<AutomaticDimensionDocument>();
  return omit(ret, ["__v", "_id"]);
}

export async function updateAutomaticDimension(
  automaticDimension: AutomaticDimensionInterface,
  updates: Partial<AutomaticDimensionInterface>
): Promise<AutomaticDimensionInterface> {
  const organization = automaticDimension.organization;
  const id = automaticDimension.id;
  await AutomaticDimensionModel.updateOne(
    {
      organization,
      id,
    },
    {
      $set: updates,
    }
  );
  return {
    ...automaticDimension,
    ...updates,
  };
}
export async function getAutomaticDimensionById(
  organization: string,
  id: string
): Promise<AutomaticDimensionInterface | null> {
  const doc = await AutomaticDimensionModel.findOne({ organization, id });

  return doc ? toInterface(doc) : null;
}

export async function getLatestAutomaticDimension(
  organization: string,
  datasource: string,
  exposureQueryId: string
): Promise<AutomaticDimensionInterface | null> {
  // TODO get no error or status === good
  const doc = await AutomaticDimensionModel.find(
    { organization, datasource, exposureQueryId },
    null,
    {
      sort: { runStarted: -1 },
      limit: 1,
    }
  ).exec();
  if (doc[0]) {
    return toInterface(doc[0]);
  }
  return null;
}

export async function createAutomaticDimension({
  organization,
  dataSourceId,
  queryId,
}: {
  organization: string;
  dataSourceId: string;
  queryId: string;
}) {
  const now = new Date();
  const doc = await AutomaticDimensionModel.create({
    id: uniqid("reld_"),
    organization,
    datasource: dataSourceId,
    exposureQueryId: queryId,
    runStarted: now,
    error: "",
    queries: [],
  });

  return toInterface(doc);
}
