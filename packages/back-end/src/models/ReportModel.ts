import mongoose from "mongoose";
import { ReportInterface } from "../../types/report";
import uniqid from "uniqid";
import { queriesSchema } from "./QueryModel";

const reportSchema = new mongoose.Schema({
  id: String,
  dateCreated: Date,
  dateUpdated: Date,
  organization: String,
  links: [
    {
      _id: false,
      href: String,
      display: String,
      external: Boolean,
    },
  ],
  title: String,
  description: String,
  runStarted: Date,
  error: String,
  queries: queriesSchema,
  type: String,
  args: {},
  results: {},
});

type ReportDocument = mongoose.Document & ReportInterface;

const ReportModel = mongoose.model<ReportDocument>("Report", reportSchema);

export async function createReport(
  organization: string,
  initialValue: Partial<ReportInterface>
): Promise<ReportInterface> {
  const report = await ReportModel.create({
    ...initialValue,
    organization,
    id: uniqid("rep_"),
    dateCreated: new Date(),
    dateUpdated: new Date(),
  });

  return report.toJSON();
}

export async function getReportById(
  organization: string,
  id: string
): Promise<ReportInterface | null> {
  const report = await ReportModel.findOne({
    organization,
    id,
  });

  return report ? report.toJSON() : null;
}

export async function updateReport(
  organization: string,
  id: string,
  updates: Partial<ReportInterface>
) {
  await ReportModel.updateOne(
    {
      organization,
      id,
    },
    {
      $set: {
        ...updates,
        dateUpdated: new Date(),
      },
    }
  );
}
