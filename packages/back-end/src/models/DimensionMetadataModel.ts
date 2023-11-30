import mongoose from "mongoose";
import uniqid from "uniqid";
import { omit } from "lodash";
import { DimensionMetadataInterface } from "../types/Integration";
import { queriesSchema } from "./QueryModel";

const dimensionMetadatachema = new mongoose.Schema({
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
      dimensionValues: [
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

type DimensionMetadataDocument = mongoose.Document & DimensionMetadataInterface;

const DimensionMetadataModel = mongoose.model<DimensionMetadataInterface>(
  "DimensionMetadata",
  dimensionMetadatachema
);

function toInterface(
  doc: DimensionMetadataDocument
): DimensionMetadataInterface {
  const ret = doc.toJSON<DimensionMetadataDocument>();
  return omit(ret, ["__v", "_id"]);
}

export async function updateDimensionMetadata(
  dimensionMetadata: DimensionMetadataInterface,
  updates: Partial<DimensionMetadataInterface>
): Promise<DimensionMetadataInterface> {
  const organization = dimensionMetadata.organization;
  const id = dimensionMetadata.id;
  await DimensionMetadataModel.updateOne(
    {
      organization,
      id,
    },
    {
      $set: updates,
    }
  );
  return {
    ...dimensionMetadata,
    ...updates,
  };
}
export async function getDimensionMetadataById(
  organization: string,
  id: string
): Promise<DimensionMetadataInterface | null> {
  const doc = await DimensionMetadataModel.findOne({ organization, id });

  return doc ? toInterface(doc) : null;
}

export async function getLatestDimensionMetadata(
  organization: string,
  datasource: string,
  exposureQueryId: string
): Promise<DimensionMetadataInterface | null> {
  // TODO get no error or status === good
  const doc = await DimensionMetadataModel.find(
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

export async function createDimensionMetadata({
  organization,
  dataSourceId,
  queryId,
}: {
  organization: string;
  dataSourceId: string;
  queryId: string;
}) {
  const now = new Date();
  const doc = await DimensionMetadataModel.create({
    id: uniqid("autodim_"),
    organization,
    datasource: dataSourceId,
    exposureQueryId: queryId,
    runStarted: now,
    error: "",
    queries: [],
  });

  return toInterface(doc);
}
