import mongoose from "mongoose";
import uniqid from "uniqid";
import { omit } from "lodash";
import { hasReadAccess } from "shared/permissions";
import {
  CreateFactMetricProps,
  FactMetricInterface,
  UpdateFactMetricProps,
} from "../../types/fact-table";
import { upgradeFactMetricDoc } from "../util/migrations";
import { ApiFactMetric } from "../../types/openapi";
import { ApiReqContext } from "../../types/api";
import { ReqContext } from "../../types/organization";

const factTableSchema = new mongoose.Schema({
  id: String,
  managedBy: String,
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

  quantileSettings: {
    type: { type: String },
    quantile: Number,
    ignoreZeros: Boolean,
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

  // deprecated fields
  capping: String,
  capValue: Number,
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
  return upgradeFactMetricDoc(omit(ret, ["__v", "_id"]));
}

export async function getAllFactMetricsForOrganization(
  context: ReqContext | ApiReqContext
) {
  const docs = await FactMetricModel.find({ organization: context.org.id });
  return docs
    .map((doc) => toInterface(doc))
    .filter((f) => hasReadAccess(context.readAccessFilter, f.projects || []));
}

export async function getFactMetric(
  context: ReqContext | ApiReqContext,
  id: string
) {
  const doc = await FactMetricModel.findOne({
    organization: context.org.id,
    id,
  });

  if (!doc) return null;

  const factMetric = toInterface(doc);
  if (!hasReadAccess(context.readAccessFilter, factMetric.projects || [])) {
    return null;
  }

  return factMetric;
}

export async function createFactMetric(
  context: ReqContext | ApiReqContext,
  data: CreateFactMetricProps
) {
  const id = data.id || uniqid("fact__");
  if (!id.match(/^fact__[-a-zA-Z0-9_]+$/)) {
    throw new Error(
      "Fact metric ids MUST start with 'fact__' and contain only letters, numbers, underscores, and dashes"
    );
  }

  const doc = await FactMetricModel.create({
    organization: context.org.id,
    id,
    dateCreated: new Date(),
    dateUpdated: new Date(),
    ...data,
  });
  return toInterface(doc);
}

export async function updateFactMetric(
  context: ReqContext | ApiReqContext,
  factMetric: FactMetricInterface,
  changes: UpdateFactMetricProps
) {
  if (factMetric.managedBy === "api" && context.auditUser?.type !== "api_key") {
    throw new Error("Cannot update fact metric managed by API");
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

export async function deleteFactMetric(
  context: ReqContext | ApiReqContext,
  factMetric: FactMetricInterface
) {
  if (factMetric.managedBy === "api" && context.auditUser?.type !== "api_key") {
    throw new Error("Cannot delete fact metric managed by API");
  }

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
    managedBy: factMetric.managedBy || "",
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
