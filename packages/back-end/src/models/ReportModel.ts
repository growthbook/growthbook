import mongoose from "mongoose";
import uniqid from "uniqid";
import { v4 as uuidv4 } from "uuid";
import omit from "lodash/omit";
import { migrateExperimentReport } from "back-end/src/util/migrations";
import {
  ExperimentReportInterface,
  ExperimentSnapshotReportInterface,
  ReportInterface,
} from "back-end/types/report";
import { ReqContext } from "back-end/types/request";
import { ApiReqContext } from "back-end/types/api";
import { logger } from "back-end/src/util/logger";
import { getAllExperiments } from "./ExperimentModel";
import { queriesSchema } from "./QueryModel";

const reportSchema = new mongoose.Schema({
  id: String,
  uid: String,
  shareLevel: String,
  editLevel: String,
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
  snapshot: String,
  experimentMetadata: {},
  experimentAnalysisSettings: {},
});

type ReportDocument = mongoose.Document & ReportInterface;

type ExperimentSnapshotReportDocument = mongoose.Document &
  ExperimentSnapshotReportInterface;
type ExperimentReportDocument = mongoose.Document & ExperimentReportInterface;

const ReportModel = mongoose.model<ReportInterface>("Report", reportSchema);

const toInterface = (doc: ReportDocument): ReportInterface => {
  switch (doc.type) {
    case "experiment":
      return migrateExperimentReport(
        omit(doc.toJSON<ExperimentReportDocument>(), ["__v", "_id"]),
      );
    case "experiment-snapshot":
      return omit(doc.toJSON<ExperimentSnapshotReportDocument>(), [
        "__v",
        "_id",
      ]);
    default:
      logger.error(
        `Invalid report type: [${
          (doc as ExperimentReportDocument)?.type ?? ""
        }] (id: ${(doc as ExperimentReportDocument)?.id ?? "unknown"})`,
      );
      return migrateExperimentReport(
        omit(
          (doc as ExperimentReportDocument).toJSON<ExperimentReportDocument>(),
          ["__v", "_id"],
        ),
      );
  }
};

export async function createReport(
  organization: string,
  initialValue: Partial<ExperimentSnapshotReportInterface>,
): Promise<ExperimentSnapshotReportInterface> {
  const report = await ReportModel.create({
    status: "private",
    ...initialValue,
    organization,
    id: uniqid("rep_"),
    uid: uuidv4().replace(/-/g, ""),
    dateCreated: new Date(),
    dateUpdated: new Date(),
  });

  return toInterface(report) as ExperimentSnapshotReportInterface;
}

export async function getReportById(
  organization: string,
  id: string,
): Promise<ReportInterface | null> {
  const report = await ReportModel.findOne({
    organization,
    id,
  });

  return report ? toInterface(report) : null;
}

export async function getReportByUid(
  uid: string,
): Promise<ReportInterface | null> {
  const report = await ReportModel.findOne({
    uid,
  });

  return report ? toInterface(report) : null;
}

export async function getReportsByOrg(
  context: ReqContext | ApiReqContext,
  project: string,
): Promise<ReportInterface[]> {
  let reports = (await ReportModel.find({ organization: context.org.id })).map(
    (r) => toInterface(r),
  );
  // filter by project assigned to the experiment:
  if (reports.length > 0 && project) {
    const allExperiments = await getAllExperiments(context, {
      project,
      includeArchived: true,
    });
    const expIds = new Set(allExperiments.map((e) => e.id));
    reports = reports.filter(
      (r) => r.experimentId && expIds.has(r.experimentId),
    );
  }
  return reports;
}

export async function getReportsByExperimentId(
  organization: string,
  experimentId: string,
): Promise<ReportInterface[]> {
  return (await ReportModel.find({ organization, experimentId })).map((r) =>
    toInterface(r),
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
  updates: Partial<ReportInterface>,
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
    },
  );
}

export async function deleteReportById(organization: string, id: string) {
  await ReportModel.deleteOne({
    organization,
    id,
  });
}
