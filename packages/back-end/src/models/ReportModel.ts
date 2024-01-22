import mongoose from "mongoose";
import uniqid from "uniqid";
import omit from "lodash/omit";
import { ReportInterface } from "../../types/report";
import { ReqContext } from "../../types/organization";
import { getAllExperiments } from "./ExperimentModel";
import { queriesSchema } from "./QueryModel";

const reportSchema = new mongoose.Schema({
  id: String,
  dateCreated: Date,
  dateUpdated: Date,
  organization: String,
  experimentId: String,
  userId: String,
  title: String,
  description: String,
  runStarted: Date,
  error: String,
  queries: queriesSchema,
  status: String,
  type: String,
  args: {},
  results: {},
});

type ReportDocument = mongoose.Document & ReportInterface;

const ReportModel = mongoose.model<ReportInterface>("Report", reportSchema);

const toInterface = (doc: ReportDocument): ReportInterface => {
  const json = omit(doc.toJSON<ReportDocument>(), ["__v", "_id"]);
  if ((json.args?.attributionModel as string) === "allExposures") {
    json.args.attributionModel = "experimentDuration";
  }
  return json;
};

export async function createReport(
  organization: string,
  initialValue: Partial<ReportInterface>
): Promise<ReportInterface> {
  const report = await ReportModel.create({
    status: "private",
    ...initialValue,
    organization,
    id: uniqid("rep_"),
    dateCreated: new Date(),
    dateUpdated: new Date(),
  });

  return toInterface(report);
}

export async function getReportById(
  organization: string,
  id: string
): Promise<ReportInterface | null> {
  const report = await ReportModel.findOne({
    organization,
    id,
  });

  return report ? toInterface(report) : null;
}

export async function getReportsByOrg(
  context: ReqContext,
  project: string
): Promise<ReportInterface[]> {
  let reports = (
    await ReportModel.find({ organization: context.org.id })
  ).map((r) => toInterface(r));
  // filter by project assigned to the experiment:
  if (reports.length > 0 && project) {
    const allExperiments = await getAllExperiments(context, project);
    const expIds = new Set(allExperiments.map((e) => e.id));
    reports = reports.filter(
      (r) => r.experimentId && expIds.has(r.experimentId)
    );
  }
  return reports;
}

export async function getReportsByExperimentId(
  organization: string,
  experimentId: string
): Promise<ReportInterface[]> {
  return (await ReportModel.find({ organization, experimentId })).map((r) =>
    toInterface(r)
  );
}

export async function findReportsByQueryId(ids: string[]) {
  // Only look for matches in the past 24 hours to make the query more efficient
  // Older snapshots should not still be running anyway
  const earliestDate = new Date();
  earliestDate.setDate(earliestDate.getDate() - 1);

  const docs = await ReportModel.find({
    dateCreated: { $gt: earliestDate },
    queries: { $elemMatch: { query: { $in: ids }, status: "running" } },
  });

  return docs.map((doc) => toInterface(doc));
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

export async function deleteReportById(organization: string, id: string) {
  await ReportModel.deleteOne({
    organization,
    id,
  });
}
