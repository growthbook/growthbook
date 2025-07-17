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
        "metadata-description",
        "metadata-hypothesis",
        "variation-image",
        "metric",
        "dimension",
        "time-series",
        "traffic-table",
        "traffic-graph",
        "sql-explorer",
      ],
    },
    title: String,
    description: String,
    snapshotId: String,
  },
  { discriminatorKey: "type" }
);

const markdownBlockSchema = new mongoose.Schema({
  content: String,
});

const descriptionBlockSchema = new mongoose.Schema({
  experimentId: String,
});

const hypothesisBlockSchema = new mongoose.Schema({
  experimentId: String,
});

const variationImageBlockSchema = new mongoose.Schema({
  experimentId: String,
  variationIds: [String],
});

const metricBlockSchema = new mongoose.Schema({
  experimentId: String,
  metricIds: [String],
  variationIds: [String],
  baselineRow: Number,
  differenceType: String,
  columnsFilter: [String],
});

const dimensionBlockSchema = new mongoose.Schema({
  experimentId: String,
  metricIds: [String],
  dimensionId: String,
  dimensionValues: [String],
  variationIds: [String],
  baselineRow: Number,
  differenceType: String,
  columnsFilter: [String],
});

const timeSeriesBlockSchema = new mongoose.Schema({
  experimentId: String,
  metricId: String,
  variationIds: [String],
});

const trafficTableBlockSchema = new mongoose.Schema({
  experimentId: String,
});

const trafficGraphBlockSchema = new mongoose.Schema({
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
  dashboardBlockSchema
);

DashboardBlockModel.discriminator("markdown", markdownBlockSchema);
DashboardBlockModel.discriminator(
  "metadata-description",
  descriptionBlockSchema
);
DashboardBlockModel.discriminator("metadata-hypothesis", hypothesisBlockSchema);
DashboardBlockModel.discriminator("variation-image", variationImageBlockSchema);
DashboardBlockModel.discriminator("metric", metricBlockSchema);
DashboardBlockModel.discriminator("dimension", dimensionBlockSchema);
DashboardBlockModel.discriminator("time-series", timeSeriesBlockSchema);
DashboardBlockModel.discriminator("traffic-table", trafficTableBlockSchema);
DashboardBlockModel.discriminator("traffic-graph", trafficGraphBlockSchema);
DashboardBlockModel.discriminator("sql-explorer", sqlExplorerBlockSchema);

export const toInterface: ToInterface<DashboardBlockInterface> = (doc) => {
  return removeMongooseFields<DashboardBlockInterface>(doc);
};

export async function createDashboardBlock(
  organization: string,
  initialValue: CreateDashboardBlockInterface
) {
  const block = await DashboardBlockModel.create({
    ...initialValue,
    organization,
    id: uniqid("dshblk_"),
    uid: uuidv4().replace(/-/g, ""),
  });

  return toInterface(block);
}
