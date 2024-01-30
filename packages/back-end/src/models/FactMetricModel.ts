import mongoose from "mongoose";
import uniqid from "uniqid";
import { omit } from "lodash";
import {
  CreateFactMetricProps,
  FactMetricInterface,
  UpdateFactMetricProps,
} from "../../types/fact-table";
import { upgradeFactMetricDoc } from "../util/migrations";
import { ApiFactMetric } from "../../types/openapi";

const factTableSchema = new mongoose.Schema({
  id: String,
  organization: String,
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

  cappingSettings: {
    type: { type: String },
    value: Number,
    ignoreZeros: Boolean,
  },
  windowSettings: {
    type: { type: String },
    delayHours: Number,
    windowValue: Number,
    windowUnit: String,
  },

  maxPercentChange: Number,
  minPercentChange: Number,
  minSampleSize: Number,
  winRisk: Number,
  loseRisk: Number,

  regressionAdjustmentOverride: Boolean,
  regressionAdjustmentEnabled: Boolean,
  regressionAdjustmentDays: Number,
});

factTableSchema.index({ id: 1, organization: 1 }, { unique: true });

type FactMetricDocument = mongoose.Document & FactMetricInterface;

const FactMetricModel = mongoose.model<FactMetricInterface>(
  "FactMetric",
  factTableSchema
);

function toInterface(doc: FactMetricDocument): FactMetricInterface {
  const ret = doc.toJSON<FactMetricDocument>();
  return upgradeFactMetricDoc(omit(ret, ["__v", "_id"]));
}

export async function getAllFactMetricsForOrganization(organization: string) {
  const docs = await FactMetricModel.find({ organization });
  return docs.map((doc) => toInterface(doc));
}

export async function getFactMetric(organization: string, id: string) {
  const doc = await FactMetricModel.findOne({ organization, id });
  return doc ? toInterface(doc) : null;
}

export async function createFactMetric(
  organization: string,
  data: CreateFactMetricProps
) {
  const id = data.id || uniqid("fact__");
  if (!id.match(/^fact__[-a-zA-Z0-9_]+$/)) {
    throw new Error(
      "Fact metric ids MUST start with 'fact__' and contain only letters, numbers, underscores, and dashes"
    );
  }

  const doc = await FactMetricModel.create({
    organization: organization,
    id,
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
  await FactMetricModel.deleteOne({
    id: factMetric.id,
    organization: factMetric.organization,
  });
}

export function toFactMetricApiInterface(
  factMetric: FactMetricInterface
): ApiFactMetric {
  const {
    cappingSettings,
    windowSettings,
    regressionAdjustmentDays,
    regressionAdjustmentEnabled,
    regressionAdjustmentOverride,
    dateCreated,
    dateUpdated,
    denominator,
    ...otherFields
  } = omit(factMetric, ["organization"]);

  return {
    ...otherFields,
    denominator: denominator || undefined,
    cappingSettings: {
      type: cappingSettings.type || "none",
      value: cappingSettings.value,
    },
    windowSettings: {
      type: windowSettings.type || "none",
      delayHours: windowSettings.delayHours,
      windowValue: windowSettings.windowValue,
      windowUnit: windowSettings.windowUnit,
    },
    regressionAdjustmentSettings: {
      override: regressionAdjustmentOverride || false,
      ...(regressionAdjustmentOverride
        ? {
            enabled: regressionAdjustmentEnabled || false,
          }
        : null),
      ...(regressionAdjustmentOverride && regressionAdjustmentEnabled
        ? {
            days: regressionAdjustmentDays || 0,
          }
        : null),
    },
    dateCreated: dateCreated?.toISOString() || "",
    dateUpdated: dateUpdated?.toISOString() || "",
  };
}
