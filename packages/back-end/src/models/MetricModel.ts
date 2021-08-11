import mongoose from "mongoose";
import { MetricInterface } from "../../types/metric";
import { queriesSchema } from "./QueryModel";

const metricSchema = new mongoose.Schema({
  id: String,
  organization: {
    type: String,
    index: true,
  },
  datasource: String,
  name: String,
  description: String,
  type: { type: String },
  table: { type: String },
  column: String,
  earlyStart: Boolean,
  inverse: Boolean,
  ignoreNulls: Boolean,
  cap: Number,
  dateCreated: Date,
  dateUpdated: Date,
  userIdColumn: String,
  anonymousIdColumn: String,
  userIdType: String,
  sql: String,
  timestampColumn: String,
  tags: [String],
  conditions: [
    {
      _id: false,
      column: String,
      operator: String,
      value: String,
    },
  ],
  queries: queriesSchema,
  runStarted: Date,
  analysis: {
    createdAt: Date,
    users: Number,
    average: Number,
    stddev: Number,
    count: Number,
    percentiles: [
      {
        _id: false,
        p: Number,
        v: Number,
      },
    ],
    dates: [
      {
        _id: false,
        d: Date,
        v: Number,
      },
    ],
  },
});
export type MetricDocument = mongoose.Document & MetricInterface;

const MetricModel = mongoose.model<MetricDocument>("Metric", metricSchema);

export function findMetricById(id: string | RegExp, organization?: string) {
  return MetricModel.findOne(organization ? { id, organization } : { id });
}

export function insertMetric(metric: Partial<MetricInterface>) {
  return MetricModel.create(metric);
}

export function deleteMetricById(id: string) {
  return MetricModel.deleteOne({
    id,
  });
}

export function getMetricsByOrganization(organization: string) {
  return MetricModel.find({
    organization,
  });
}

export function getMetricsByDatasource(datasource: string) {
  return MetricModel.find({
    datasource,
  });
}

export function getMetricById(id: string) {
  return MetricModel.findOne({
    id,
  });
}
