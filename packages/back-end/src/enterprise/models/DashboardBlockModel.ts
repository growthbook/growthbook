import mongoose from "mongoose";
import uniqid from "uniqid";
import { v4 as uuidv4 } from "uuid";
import {
  CreateDashboardBlockInterface,
  DashboardBlockInterface,
  LegacyDashboardBlockInterface,
} from "back-end/src/enterprise/validators/dashboard-block";
import {
  removeMongooseFields,
  ToInterface,
} from "back-end/src/util/mongo.util";

export const dashboardBlockSchema = new mongoose.Schema(
  {
    organization: String,
    id: String,
    uid: String,
    type: {
      type: String,
      required: true,
      enum: [
        "markdown",
        "experiment-description",
        "experiment-hypothesis",
        "experiment-variation-image",
        "experiment-metric",
        "experiment-dimension",
        "experiment-time-series",
        "experiment-traffic-table",
        "experiment-traffic-graph",
        "sql-explorer",
      ],
    },
    title: String,
    description: String,
    snapshotId: String,
  },
  { discriminatorKey: "type" },
);

const markdownBlockSchema = new mongoose.Schema({
  content: String,
});

// Begin deprecated block types
const legacyExperimentDescriptionBlockSchema = new mongoose.Schema({
  experimentId: String,
});
const legacyExperimentHypothesisBlockSchema = new mongoose.Schema({
  experimentId: String,
});
const legacyExperimentVariationImageBlockSchema = new mongoose.Schema({
  experimentId: String,
  variationIds: [String],
});
const legacyExperimentTrafficTableBlockSchema = new mongoose.Schema({
  experimentId: String,
});
const legacyExperimentTrafficGraphBlockSchema = new mongoose.Schema({
  experimentId: String,
});
// End deprecated block types

const experimentMetadataBlockSchema = new mongoose.Schema({
  experimentId: String,
  showDescription: Boolean,
  showHypothesis: Boolean,
  showVariationImages: Boolean,
  variationIds: [String],
});

const experimentTrafficBlockSchema = new mongoose.Schema({
  experimentId: String,
  showTable: Boolean,
  showTimeseries: Boolean,
});

const experimentMetricBlockSchema = new mongoose.Schema({
  experimentId: String,
  metricSelector: String,
  metricIds: [String],
  variationIds: [String],
  baselineRow: Number,
  differenceType: String,
  columnsFilter: [String],
});

const experimentDimensionBlockSchema = new mongoose.Schema({
  experimentId: String,
  metricSelector: String,
  metricIds: [String],
  dimensionId: String,
  dimensionValues: [String],
  variationIds: [String],
  baselineRow: Number,
  differenceType: String,
  columnsFilter: [String],
});

const experimentTimeSeriesBlockSchema = new mongoose.Schema({
  experimentId: String,
  metricId: String, // Deprecated
  metricSelector: String,
  metricIds: [String],
  variationIds: [String],
});

const sqlExplorerBlockSchema = new mongoose.Schema({
  savedQueryId: String,
  dataVizConfigIndex: Number,
  showResultsTable: Boolean,
  blockConfig: [String],
});

const metricExplorerBlockSchema = new mongoose.Schema({
  factMetricId: String,
  analysisSettings: {
    userIdType: String,
    startDate: Date,
    endDate: Date,
    lookbackDays: Number,
    populationType: String,
    populationId: String,
  },
  visualizationType: String,
  valueType: String,
  metricAnalysisId: String,
});

dashboardBlockSchema.index({
  uid: 1,
});

export const DashboardBlockModel = mongoose.model(
  "DashboardBlock",
  dashboardBlockSchema,
);

DashboardBlockModel.discriminator("markdown", markdownBlockSchema);
DashboardBlockModel.discriminator(
  "experiment-description",
  legacyExperimentDescriptionBlockSchema,
);
DashboardBlockModel.discriminator(
  "experiment-hypothesis",
  legacyExperimentHypothesisBlockSchema,
);
DashboardBlockModel.discriminator(
  "experiment-variation-image",
  legacyExperimentVariationImageBlockSchema,
);
DashboardBlockModel.discriminator(
  "experiment-metadata",
  experimentMetadataBlockSchema,
);
DashboardBlockModel.discriminator(
  "experiment-metric",
  experimentMetricBlockSchema,
);
DashboardBlockModel.discriminator(
  "experiment-dimension",
  experimentDimensionBlockSchema,
);
DashboardBlockModel.discriminator(
  "experiment-time-series",
  experimentTimeSeriesBlockSchema,
);
DashboardBlockModel.discriminator(
  "experiment-traffic-table",
  legacyExperimentTrafficTableBlockSchema,
);
DashboardBlockModel.discriminator(
  "experiment-traffic-graph",
  legacyExperimentTrafficGraphBlockSchema,
);
DashboardBlockModel.discriminator(
  "experiment-traffic",
  experimentTrafficBlockSchema,
);
DashboardBlockModel.discriminator("sql-explorer", sqlExplorerBlockSchema);
DashboardBlockModel.discriminator("metric-explorer", metricExplorerBlockSchema);

export const toInterface: ToInterface<DashboardBlockInterface> = (doc) => {
  return removeMongooseFields<DashboardBlockInterface>(doc);
};

export async function createDashboardBlock(
  organization: string,
  initialValue: CreateDashboardBlockInterface,
) {
  const block = await DashboardBlockModel.create({
    ...initialValue,
    organization,
    id: uniqid("dshblk_"),
    uid: uuidv4().replace(/-/g, ""),
  });

  return toInterface(block);
}

export function migrate(
  doc: LegacyDashboardBlockInterface,
): DashboardBlockInterface {
  switch (doc.type) {
    case "experiment-metric":
      return {
        ...doc,
        metricSelector: doc.metricSelector || "custom",
      };
    case "experiment-dimension":
      return {
        ...doc,
        metricSelector: doc.metricSelector || "custom",
      };
    case "experiment-time-series":
      return {
        ...doc,
        metricIds: doc.metricIds || [doc.metricId],
        metricId: undefined,
        metricSelector: doc.metricSelector || "custom",
      };
    case "experiment-description":
      return {
        ...doc,
        type: "experiment-metadata",
        showDescription: true,
        showHypothesis: false,
        showVariationImages: false,
      };
    case "experiment-hypothesis":
      return {
        ...doc,
        type: "experiment-metadata",
        showDescription: false,
        showHypothesis: true,
        showVariationImages: false,
      };
    case "experiment-variation-image":
      return {
        ...doc,
        type: "experiment-metadata",
        showDescription: false,
        showHypothesis: false,
        showVariationImages: true,
      };
    case "experiment-traffic-graph":
      return {
        ...doc,
        type: "experiment-traffic",
        showTable: false,
        showTimeseries: true,
      };
    case "experiment-traffic-table":
      return {
        ...doc,
        type: "experiment-traffic",
        showTable: true,
        showTimeseries: false,
      };
    default:
      return doc;
  }
}
