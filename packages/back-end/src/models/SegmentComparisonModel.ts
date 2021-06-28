import mongoose from "mongoose";
import { SegmentComparisonInterface } from "../../types/segment-comparison";
import { queriesSchema } from "./QueryModel";

const segmentComparisonSchema = new mongoose.Schema({
  id: String,
  organization: String,
  title: String,
  datasource: String,
  metrics: [String],
  conversionWindow: Number,
  segment1: {
    segment: String,
    from: Date,
    to: Date,
  },
  segment2: {
    segment: String,
    sameDateRange: Boolean,
    from: Date,
    to: Date,
  },
  runStarted: Date,
  queries: queriesSchema,
  results: {
    users: {
      segment1: Number,
      segment2: Number,
    },
    metrics: {
      type: Map,
      of: {
        _id: false,
        segment1: {
          value: Number,
          cr: Number,
          users: Number,
        },
        segment2: {
          value: Number,
          cr: Number,
          users: Number,
          ci: [Number],
          risk: [Number],
          expected: Number,
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
  },
  dateCreated: Date,
  dateUpdated: Date,
});

export type SegmentComparisonDocument = mongoose.Document &
  SegmentComparisonInterface;

export const SegmentComparisonModel = mongoose.model<SegmentComparisonDocument>(
  "SegmentComparison",
  segmentComparisonSchema
);
