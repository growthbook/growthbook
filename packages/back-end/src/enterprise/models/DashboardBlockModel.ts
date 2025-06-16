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
        "metadata",
        "image",
        "metric",
        "dimension",
        "time-series",
      ],
    },
  },
  { discriminatorKey: "type" }
);

const markdownBlockSchema = new mongoose.Schema({
  content: String,
});

const metadataBlockSchema = new mongoose.Schema({
  subtype: {
    type: String,
    required: true,
    enum: ["description", "hypothesis"],
  },
});

const variationImageBlockSchema = new mongoose.Schema({
  variationIds: [String],
});

const metricBlockSchema = new mongoose.Schema({
  metricId: String,
  baselineRow: Number,
  variationIds: [String],
});

const dimensionBlockSchema = new mongoose.Schema({
  dimensionId: String,
  dimensionValues: [String],
  metricId: String,
  variationIds: [String],
});

const timeSeriesBlockSchema = new mongoose.Schema({
  metricId: String,
  variationIds: [String],
  dateStart: Date,
  dateEnd: Date,
});

dashboardBlockSchema.index({
  uid: 1,
});

export const DashboardBlockModel = mongoose.model(
  "DashboardBlock",
  dashboardBlockSchema
);

DashboardBlockModel.discriminator("markdown", markdownBlockSchema);
DashboardBlockModel.discriminator("metadata", metadataBlockSchema);
DashboardBlockModel.discriminator("variation-image", variationImageBlockSchema);
DashboardBlockModel.discriminator("metric", metricBlockSchema);
DashboardBlockModel.discriminator("dimension", dimensionBlockSchema);
DashboardBlockModel.discriminator("time-series", timeSeriesBlockSchema);

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
