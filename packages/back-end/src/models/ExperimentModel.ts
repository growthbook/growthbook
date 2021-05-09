import mongoose from "mongoose";
import { ExperimentInterface } from "../../types/experiment";

export type ExperimentDocument = mongoose.Document & ExperimentInterface;

const experimentSchema = new mongoose.Schema({
  id: String,
  trackingKey: String,
  organization: String,
  owner: String,
  datasource: String,
  userIdType: String,
  name: String,
  dateCreated: Date,
  dateUpdated: Date,
  tags: [String],
  description: String,
  // Observations is not used anymore, keeping here so it will continue being saved in Mongo if present
  observations: String,
  hypothesis: String,
  conversionWindowDays: Number,
  metrics: [String],
  activationMetric: String,
  sqlOverride: {
    type: Map,
    of: String,
  },
  archived: Boolean,
  status: String,
  results: String,
  analysis: String,
  winner: Number,
  currentPhase: Number,
  autoAssign: Boolean,
  implementation: String,
  previewURL: String,
  targetURLRegex: String,
  variations: [
    {
      _id: false,
      name: String,
      description: String,
      key: String,
      value: String,
      screenshots: [
        {
          _id: false,
          path: String,
          width: Number,
          height: Number,
          description: String,
        },
      ],
      css: String,
      dom: [
        {
          _id: false,
          selector: String,
          action: String,
          attribute: String,
          value: String,
        },
      ],
    },
  ],
  phases: [
    {
      _id: false,
      dateStarted: Date,
      dateEnded: Date,
      phase: String,
      reason: String,
      coverage: Number,
      variationWeights: [Number],
      targeting: String,
    },
  ],
  data: String,
  targeting: String,
  segment: String,
  lastSnapshotAttempt: Date,
  autoSnapshots: Boolean,
});

export const ExperimentModel = mongoose.model<ExperimentDocument>(
  "Experiment",
  experimentSchema
);
