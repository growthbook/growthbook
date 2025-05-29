import mongoose from "mongoose";

export const blockSchema = new mongoose.Schema(
  {
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

export const BlockModel = mongoose.model("DashboardBlock", blockSchema);

BlockModel.discriminator("markdown", markdownBlockSchema);
BlockModel.discriminator("metadata", metadataBlockSchema);
BlockModel.discriminator("variation-image", variationImageBlockSchema);
BlockModel.discriminator("metric", metricBlockSchema);
BlockModel.discriminator("dimension", dimensionBlockSchema);
BlockModel.discriminator("time-series", timeSeriesBlockSchema);
