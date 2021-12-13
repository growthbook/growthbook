import mongoose from "mongoose";
import { ReportInterface } from "../../types/report";
import uniqid from "uniqid";
import { queriesSchema } from "./QueryModel";
import { ExperimentModel } from "./ExperimentModel";

const reportSchema = new mongoose.Schema({
  id: String,
  dateCreated: Date,
  dateUpdated: Date,
  organization: String,
  experimentId: String,
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

export async function getReportsByOrg(
  organization: string,
  project: string
): Promise<ReportInterface[]> {
  let reports = await ReportModel.find({ organization });
  // filter by project assigned to the experiment:
  if (reports && project) {
    reports = reports.filter(async (r) => {
      const experiment = await ExperimentModel.findOne({
        organization,
        id: r.experimentId,
      });
      if (experiment) {
        return experiment.project === project;
      }
      return !!r.experimentId;
    });
  }
  return reports;
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
