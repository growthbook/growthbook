import mongoose from "mongoose";
import uniqid from "uniqid";
import lodash from "lodash";
import { DimensionSlicesInterface } from "shared/types/dimension";
import { queriesSchema } from "./QueryModel.js";

const { omit } = lodash;
const dimensionSlicesSchema = new mongoose.Schema({
  id: {
    type: String,
    unique: true,
  },
  organization: String,
  runStarted: Date,

  queries: queriesSchema,

  datasource: String,
  exposureQueryId: String,

  results: [
    {
      _id: false,
      dimension: String,
      dimensionSlices: [
        {
          _id: false,
          name: String,
          percent: Number,
        },
      ],
    },
  ],
  error: String,
});

type DimensionSlicesDocument = mongoose.Document & DimensionSlicesInterface;

const DimensionSlicesModel = mongoose.model<DimensionSlicesInterface>(
  "DimensionSlices",
  dimensionSlicesSchema,
);

function toInterface(doc: DimensionSlicesDocument): DimensionSlicesInterface {
  const ret = doc.toJSON<DimensionSlicesDocument>();
  return omit(ret, ["__v", "_id"]);
}

export async function updateDimensionSlices(
  dimensionSlices: DimensionSlicesInterface,
  updates: Partial<DimensionSlicesInterface>,
): Promise<DimensionSlicesInterface> {
  const organization = dimensionSlices.organization;
  const id = dimensionSlices.id;
  await DimensionSlicesModel.updateOne(
    {
      organization,
      id,
    },
    {
      $set: updates,
    },
  );
  return {
    ...dimensionSlices,
    ...updates,
  };
}
export async function getDimensionSlicesById(
  organization: string,
  id: string,
): Promise<DimensionSlicesInterface | null> {
  const doc = await DimensionSlicesModel.findOne({ organization, id });

  return doc ? toInterface(doc) : null;
}

export async function createDimensionSlices({
  organization,
  dataSourceId,
  queryId,
}: {
  organization: string;
  dataSourceId: string;
  queryId: string;
}) {
  const now = new Date();
  const doc = await DimensionSlicesModel.create({
    id: uniqid("dimslice_"),
    organization,
    datasource: dataSourceId,
    exposureQueryId: queryId,
    runStarted: now,
    error: "",
    queries: [],
  });

  return toInterface(doc);
}
