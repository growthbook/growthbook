import mongoose from "mongoose";
import omit from "lodash/omit";
import uniqid from "uniqid";
import {
  PastExperiment,
  PastExperimentsInterface,
} from "shared/types/past-experiments";
import { Queries } from "shared/types/query";
import { queriesSchema } from "./QueryModel";

const pastExperimentsSchema = new mongoose.Schema({
  id: String,
  organization: {
    type: String,
    index: true,
  },
  datasource: String,
  experiments: [
    {
      _id: false,
      trackingKey: String,
      experimentName: String,
      variationNames: [String],
      numVariations: Number,
      variationKeys: [String],
      weights: [Number],
      users: Number,
      startDate: Date,
      endDate: Date,
      exposureQueryId: String,
      latestData: Date,
      startOfRange: Boolean,
    },
  ],
  config: {
    start: Date,
    end: Date,
  },
  runStarted: Date,
  queries: queriesSchema,
  error: String,
  dateCreated: Date,
  dateUpdated: Date,
  latestData: Date,
});

type PastExperimentsDocument = mongoose.Document & PastExperimentsInterface;

const PastExperimentsModel = mongoose.model<PastExperimentsInterface>(
  "PastExperiments",
  pastExperimentsSchema,
);

function toInterface(doc: PastExperimentsDocument): PastExperimentsInterface {
  const ret = doc.toJSON<PastExperimentsDocument>();
  return omit(ret, ["__v", "_id"]);
}

export async function getPastExperimentsById(organization: string, id: string) {
  const doc = await PastExperimentsModel.findOne({ organization, id });

  return doc ? toInterface(doc) : null;
}

export async function getPastExperimentsModelByDatasource(
  organization: string,
  datasource: string,
) {
  const doc = await PastExperimentsModel.findOne({ organization, datasource });

  return doc ? toInterface(doc) : null;
}

export async function findRunningPastExperimentsByQueryId(
  orgIds: string[],
  ids: string[],
) {
  const docs = await PastExperimentsModel.find({
    organization: { $in: orgIds },
    queries: { $elemMatch: { query: { $in: ids }, status: "running" } },
  });

  return docs.map((doc) => toInterface(doc));
}

export async function updatePastExperiments(
  pastExperiments: PastExperimentsInterface,
  changes: Partial<PastExperimentsInterface>,
) {
  const dateUpdated = new Date();
  await PastExperimentsModel.updateOne(
    {
      organization: pastExperiments.organization,
      id: pastExperiments.id,
    },
    {
      $set: { ...changes, dateUpdated },
    },
  );

  return {
    ...pastExperiments,
    ...changes,
    dateUpdated,
  };
}

export async function createPastExperiments({
  organization,
  datasource,
  experiments,
  start,
  queries,
}: {
  organization: string;
  datasource: string;
  experiments: PastExperiment[];
  start: Date;
  queries: Queries;
}) {
  const now = new Date();
  const doc = await PastExperimentsModel.create({
    id: uniqid("imp_"),
    organization,
    datasource,
    experiments,
    runStarted: now,
    config: {
      start,
      end: now,
    },
    error: "",
    queries,
    dateCreated: now,
    dateUpdated: now,
  });

  return toInterface(doc);
}
