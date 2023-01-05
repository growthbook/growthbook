import mongoose from "mongoose";
import { ExperimentSnapshotInterface } from "../../types/experiment-snapshot";
import { queriesSchema } from "./QueryModel";

const experimentSnapshotSchema = new mongoose.Schema({
  id: {
    type: String,
    unique: true,
  },
  organization: String,
  experiment: String,
  phase: Number,
  type: { type: String },
  dateCreated: Date,
  runStarted: Date,
  manual: Boolean,
  query: String,
  queryLanguage: String,
  error: String,
  queries: queriesSchema,
  dimension: String,
  unknownVariations: [String],
  multipleExposures: Number,
  hasCorrectedStats: Boolean,
  results: [
    {
      _id: false,
      name: String,
      srm: Number,
      variations: [
        {
          _id: false,
          users: Number,
          metrics: {
            type: Map,
            of: {
              _id: false,
              value: Number,
              cr: Number,
              users: Number,
              denominator: Number,
              ci: [Number],
              uplift: {
                dist: String,
                mean: Number,
                stddev: Number,
              },
              stats: {
                users: Number,
                mean: Number,
                count: Number,
                stddev: Number,
              },
              expected: Number,
              risk: [Number],
              buckets: [
                {
                  _id: false,
                  x: Number,
                  y: Number,
                },
              ],
              chanceToWin: Number,
              pValue: Number,
            },
          },
        },
      ],
    },
  ],
  hasRawQueries: Boolean,
  queryFilter: String,
  segment: String,
  activationMetric: String,
  skipPartialData: Boolean,
  statsEngine: String,
});
experimentSnapshotSchema.index({
  experiment: 1,
  dateCreated: -1,
});

export type ExperimentSnapshotDocument = mongoose.Document &
  ExperimentSnapshotInterface;

export const ExperimentSnapshotModel = mongoose.model<ExperimentSnapshotDocument>(
  "ExperimentSnapshot",
  experimentSnapshotSchema
);
