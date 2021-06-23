import mongoose from "mongoose";
import { ExperimentSnapshotInterface } from "../../types/experiment-snapshot";

const experimentSnapshotSchema = new mongoose.Schema({
  id: String,
  experiment: String,
  phase: Number,
  type: { type: String },
  dateCreated: Date,
  manual: Boolean,
  query: String,
  queryLanguage: String,
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
              hdi: {
                dist: String,
                mean: Number,
                stddev: Number,
              },
              expected: Number,
              risk: Number,
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
