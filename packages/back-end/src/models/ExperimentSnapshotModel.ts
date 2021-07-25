import mongoose from "mongoose";
import { ExperimentSnapshotInterface } from "../../types/experiment-snapshot";
import { queriesSchema } from "./QueryModel";

const experimentSnapshotSchema = new mongoose.Schema({
  id: String,
  organization: String,
  experiment: String,
  phase: Number,
  type: { type: String },
  dateCreated: Date,
  runStarted: Date,
  manual: Boolean,
  query: String,
  queryLanguage: String,
  queries: queriesSchema,
  dimension: String,
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
              ci: [Number],
              uplift: {
                dist: String,
                mean: Number,
                stddev: Number,
              },
              stats: {
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
            },
          },
        },
      ],
    },
  ],
});

export type ExperimentSnapshotDocument = mongoose.Document &
  ExperimentSnapshotInterface;

export const ExperimentSnapshotModel = mongoose.model<ExperimentSnapshotDocument>(
  "ExperimentSnapshot",
  experimentSnapshotSchema
);
