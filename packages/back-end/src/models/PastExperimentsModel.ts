import mongoose from "mongoose";
import { ObjectId } from "mongodb";
import { PastExperimentsInterface } from "../../types/past-experiments";
import { queriesSchema } from "./QueryModel";

const pastExperimentsSchema = new mongoose.Schema({
  id: String,
  organization: String,
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
});

export type PastExperimentsDocument = mongoose.Document<
  ObjectId | undefined,
  Record<string, never>,
  PastExperimentsInterface
> &
  PastExperimentsInterface;

export const PastExperimentsModel = mongoose.model<PastExperimentsDocument>(
  "PastExperiments",
  pastExperimentsSchema
);
