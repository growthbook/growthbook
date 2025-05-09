import mongoose from "mongoose";
import uniqid from "uniqid";
import { ExperimentReportInterface } from "back-end/src/enterprise/validators/experiment-report";
import { ReqContext } from "back-end/types/organization";
import { ApiReqContext } from "back-end/types/api";
import {
  removeMongooseFields,
  ToInterface,
} from "back-end/src/util/mongo.util";
import { ExperimentInterface } from "back-end/types/experiment";

const blockSchema = new mongoose.Schema(
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

// Register discriminators
const BlockModel = mongoose.model("ExperimentReportBlock", blockSchema);

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

// Register discriminators
BlockModel.discriminator("markdown", markdownBlockSchema);
BlockModel.discriminator("metadata", metadataBlockSchema);
BlockModel.discriminator("variation-image", variationImageBlockSchema);
BlockModel.discriminator("metric", metricBlockSchema);
BlockModel.discriminator("dimension", dimensionBlockSchema);
BlockModel.discriminator("time-series", timeSeriesBlockSchema);

export const experimentReportSchema = new mongoose.Schema({
  id: {
    type: String,
    unique: true,
  },
  organization: String,
  experiment: String,
  dateCreated: Date,
  dateUpdated: Date,
  title: String,
  content: [blockSchema],
});

experimentReportSchema.index({
  experiment: 1,
  dateCreated: -1,
});

export type ExperimentReportDocument = mongoose.Document &
  ExperimentReportInterface;

export const ExperimentReportModel = mongoose.model<ExperimentReportInterface>(
  "ExperimentReport",
  experimentReportSchema
);

export async function createExperimentReport({
  data,
  context,
  experiment,
}: {
  data: Pick<ExperimentReportInterface, "title" | "content">;
  context: ReqContext | ApiReqContext;
  experiment: ExperimentInterface;
}) {
  const report = toInterface(
    await ExperimentReportModel.create({
      ...data,
      id: uniqid("rep_"),
      organization: context.org.id,
      dateCreated: new Date(),
      dateUpdated: new Date(),
      experiment: experiment.id,
    })
  );

  return report;
}

export async function updateExperimentReport({
  context,
  report,
  changes,
}: {
  context: ReqContext | ApiReqContext;
  report: ExperimentReportInterface;
  changes: Partial<ExperimentReportInterface>;
}) {
  const allChanges = {
    ...changes,
    dateUpdated: new Date(),
  };

  await ExperimentReportModel.updateOne(
    { id: report.id, organization: context.org.id },
    { $set: allChanges }
  );

  const updated = { ...report, ...allChanges };

  return toInterface(updated);
}

const toInterface: ToInterface<ExperimentReportInterface> = (doc) => {
  const report = removeMongooseFields(doc);
  return report as ExperimentReportInterface;
};
