import mongoose from "mongoose";
import uniqid from "uniqid";
import { v4 as uuidv4 } from "uuid";
import {
  CreateDashboardBlockInterface,
  DashboardBlockInterface,
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

const experimentDescriptionBlockSchema = new mongoose.Schema({
  experimentId: String,
});

const experimentHypothesisBlockSchema = new mongoose.Schema({
  experimentId: String,
});

const experimentVariationImageBlockSchema = new mongoose.Schema({
  experimentId: String,
  variationIds: [String],
});

const experimentMetricBlockSchema = new mongoose.Schema({
  experimentId: String,
  metricIds: [String],
  variationIds: [String],
  baselineRow: Number,
  differenceType: String,
  columnsFilter: [String],
});

const experimentDimensionBlockSchema = new mongoose.Schema({
  experimentId: String,
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
  metricId: String,
  variationIds: [String],
});

const experimentTrafficTableBlockSchema = new mongoose.Schema({
  experimentId: String,
});

const experimentTrafficGraphBlockSchema = new mongoose.Schema({
  experimentId: String,
});

const sqlExplorerBlockSchema = new mongoose.Schema({
  savedQueryId: String,
  dataVizConfigIndex: Number,
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
  experimentDescriptionBlockSchema,
);
DashboardBlockModel.discriminator(
  "experiment-hypothesis",
  experimentHypothesisBlockSchema,
);
DashboardBlockModel.discriminator(
  "experiment-variation-image",
  experimentVariationImageBlockSchema,
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
  experimentTrafficTableBlockSchema,
);
DashboardBlockModel.discriminator(
  "experiment-traffic-graph",
  experimentTrafficGraphBlockSchema,
);
DashboardBlockModel.discriminator("sql-explorer", sqlExplorerBlockSchema);

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
