import mongoose from "mongoose";
import uniqid from "uniqid";
import { omit } from "lodash";
import {
  CreateFactMetricProps,
  FactMetricInterface,
  UpdateFactMetricProps,
} from "../../types/fact-table";
import { getConfigFactMetrics, usingFileConfig } from "../init/config";
import { ALLOW_CREATE_FACT_METRICS } from "../util/secrets";

const factTableSchema = new mongoose.Schema({
  id: String,
  organization: String,
  official: Boolean,
  dateCreated: Date,
  dateUpdated: Date,
  name: String,
  description: String,
  owner: String,
  datasource: String,
  projects: [String],
  tags: [String],
  inverse: Boolean,
  metricType: String,
  numerator: {
    factTableId: String,
    column: String,
    filters: [String],
  },
  denominator: {
    factTableId: String,
    column: String,
    filters: [String],
  },
  capping: String,
  capValue: Number,
  maxPercentChange: Number,
  minPercentChange: Number,
  minSampleSize: Number,
  winRisk: Number,
  loseRisk: Number,

  regressionAdjustmentOverride: Boolean,
  regressionAdjustmentEnabled: Boolean,
  regressionAdjustmentDays: Number,

  conversionDelayHours: Number,
  hasConversionWindow: Boolean,
  conversionWindowValue: Number,
  conversionWindowUnit: String,
});

factTableSchema.index({ id: 1, organization: 1 }, { unique: true });

type FactMetricDocument = mongoose.Document & FactMetricInterface;

const FactMetricModel = mongoose.model<FactMetricInterface>(
  "FactMetric",
  factTableSchema
);

function toInterface(doc: FactMetricDocument): FactMetricInterface {
  const ret = doc.toJSON<FactMetricDocument>();
  return omit(ret, ["__v", "_id"]);
}

export async function getAllFactMetricsForOrganization(organization: string) {
  const factMetrics: FactMetricInterface[] = [];

  if (usingFileConfig()) {
    const configFactMetrics = getConfigFactMetrics(organization);
    factMetrics.push(...configFactMetrics);
  }

  const docs = await FactMetricModel.find({ organization });
  factMetrics.push(...docs.map((doc) => toInterface(doc)));

  return factMetrics;
}

export async function getFactMetric(organization: string, id: string) {
  // First check config.yml
  if (usingFileConfig()) {
    const configFactMetrics = getConfigFactMetrics(organization);
    const configFactMetric = configFactMetrics.find((m) => m.id === id);
    if (configFactMetric) return configFactMetric;
  }

  // Then check the database
  const doc = await FactMetricModel.findOne({ organization, id });
  return doc ? toInterface(doc) : null;
}

export async function createFactMetric(
  organization: string,
  data: CreateFactMetricProps
) {
  if (usingFileConfig() && !ALLOW_CREATE_FACT_METRICS) {
    throw new Error("Not allowed to create fact metrics");
  }

  const doc = await FactMetricModel.create({
    organization: organization,
    id: uniqid("fact__"),
    dateCreated: new Date(),
    dateUpdated: new Date(),
    ...data,
  });
  return toInterface(doc);
}

export async function updateFactMetric(
  factMetric: FactMetricInterface,
  changes: UpdateFactMetricProps
) {
  if (factMetric.official) {
    throw new Error("Official fact metrics cannot be updated");
  }

  await FactMetricModel.updateOne(
    {
      id: factMetric.id,
      organization: factMetric.organization,
    },
    {
      $set: {
        ...changes,
        dateUpdated: new Date(),
      },
    }
  );
}

export async function deleteFactMetric(factMetric: FactMetricInterface) {
  if (factMetric.official) {
    throw new Error("Official fact metrics cannot be deleted");
  }

  await FactMetricModel.deleteOne({
    id: factMetric.id,
    organization: factMetric.organization,
  });
}
