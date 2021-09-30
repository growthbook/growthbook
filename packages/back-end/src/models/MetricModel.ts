import mongoose from "mongoose";
import { MetricInterface } from "../../types/metric";
import { getConfigMetrics, usingFileConfig } from "../init/config";
import { queriesSchema } from "./QueryModel";

export const ALLOWED_METRIC_TYPES = [
  "binomial",
  "count",
  "duration",
  "revenue",
];

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
  conversionWindowHours: Number,
  winRisk: Number,
  loseRisk: Number,
  maxPercentChange: Number,
  minSampleSize: Number,
  dateCreated: Date,
  dateUpdated: Date,
  userIdColumn: String,
  segment: String,
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
    segment: String,
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
        s: Number,
        u: Number,
      },
    ],
  },
});
metricSchema.index({ id: 1, organization: 1 }, { unique: true });
type MetricDocument = mongoose.Document & MetricInterface;

const MetricModel = mongoose.model<MetricDocument>("Metric", metricSchema);

function toInterface(doc: MetricDocument): MetricInterface {
  if (!doc) return null;
  return doc.toJSON();
}

export async function insertMetric(metric: Partial<MetricInterface>) {
  if (usingFileConfig()) {
    throw new Error("Cannot add. Metrics managed by config.yml");
  }
  return toInterface(await MetricModel.create(metric));
}

export async function deleteMetricById(id: string, organization: string) {
  if (usingFileConfig()) {
    throw new Error("Cannot delete. Metrics managed by config.yml");
  }
  await MetricModel.deleteOne({
    id,
    organization,
  });
}

export async function getMetricsByOrganization(organization: string) {
  // If using config.yml, immediately return the list from there
  if (usingFileConfig()) {
    return getConfigMetrics(organization);
  }

  const docs = await MetricModel.find({
    organization,
  });

  return docs.map(toInterface);
}

export async function getMetricsByDatasource(
  datasource: string,
  organization: string
) {
  // If using config.yml, immediately return the list from there
  if (usingFileConfig()) {
    return getConfigMetrics(organization).filter(
      (m) => m.datasource === datasource
    );
  }

  const docs = await MetricModel.find({
    datasource,
  });
  return docs.map(toInterface);
}

export async function hasSampleMetric(organization: string) {
  if (usingFileConfig()) return false;

  const doc = await MetricModel.findOne({
    id: /^met_sample/,
    organization,
  });
  return !!doc;
}

export async function getMetricById(
  id: string,
  organization: string,
  requireMatchingOrgs: boolean = true,
  includeAnalysis: boolean = false
) {
  // If using config.yml, immediately return the from there
  if (usingFileConfig()) {
    const doc =
      getConfigMetrics(organization).filter((m) => m.id === id)[0] || null;
    if (!doc) return null;

    if (includeAnalysis) {
      const metric = await MetricModel.findOne({ id, organization });
      doc.queries = metric?.queries || [];
      doc.analysis = metric?.analysis || null;
      doc.runStarted = metric?.runStarted || null;
    }

    return doc;
  }

  const res = toInterface(
    await MetricModel.findOne({
      id,
    })
  );

  if (res && requireMatchingOrgs && res.organization !== organization) {
    throw new Error("You do not have access to that metric");
  }

  return res;
}

export async function updateMetric(
  id: string,
  updates: Partial<MetricInterface>,
  organization: string
) {
  if (usingFileConfig()) {
    // Trying to update unsupported properties
    if (
      Object.keys(updates).filter(
        (k) => !["analysis", "queries", "runStarted"].includes(k)
      ).length > 0
    ) {
      throw new Error("Cannot update. Metrics managed by config.yml");
    }

    await MetricModel.updateOne(
      {
        id,
        organization,
      },
      {
        $set: updates,
      },
      {
        upsert: true,
      }
    );
    return;
  }

  await MetricModel.updateOne(
    {
      id,
    },
    {
      $set: updates,
    }
  );
}
