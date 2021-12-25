import { Response } from "express";
import { ReportInterface } from "../../types/report";
import { ExperimentModel } from "../models/ExperimentModel";
import { ExperimentSnapshotModel } from "../models/ExperimentSnapshotModel";
import {
  createReport,
  getReportById,
  updateReport,
  getReportsByOrg,
  getReportsByExperimentId,
} from "../models/ReportModel";
import { generateReportNotebook } from "../services/notebook";
import { getOrgFromReq } from "../services/organizations";
import { cancelRun, getStatusEndpoint } from "../services/queries";
import { runReport, reportArgsFromSnapshot } from "../services/reports";
import { analyzeExperimentResults } from "../services/stats";
import { AuthRequest } from "../types/AuthRequest";
import { getValidDate } from "../util/dates";
import { getExperimentsByIds } from "../services/experiments";

export async function postReportFromSnapshot(
  req: AuthRequest<null, { snapshot: string }>,
  res: Response
) {
  const { org } = getOrgFromReq(req);

  const snapshot = await ExperimentSnapshotModel.findOne({
    id: req.params.snapshot,
    organization: org.id,
  });

  if (!snapshot) {
    throw new Error("Invalid snapshot id");
  }

  const experiment = await ExperimentModel.findOne({
    organization: org.id,
    id: snapshot.experiment,
  });

  if (!experiment) {
    throw new Error("Could not find experiment");
  }

  const phase = experiment.phases[snapshot.phase];
  if (!phase) {
    throw new Error("Unknown experiment phase");
  }

  const doc = await createReport(org.id, {
    experimentId: experiment.id,
    userId: req.userId,
    title: `New Report - ${experiment.name}`,
    description: ``,
    type: "experiment",
    args: reportArgsFromSnapshot(experiment, snapshot),
    results: snapshot.results
      ? {
          dimensions: snapshot.results,
          unknownVariations: snapshot.unknownVariations || [],
        }
      : undefined,
    queries: snapshot.queries,
    runStarted: snapshot.runStarted,
    error: snapshot.error,
  });

  await req.audit({
    event: "experiment.analysis",
    entity: {
      object: "experiment",
      id: snapshot.experiment,
    },
    details: JSON.stringify({
      report: doc.id,
    }),
  });

  res.status(200).json({
    status: 200,
    report: doc,
  });
}

export async function getReports(req: AuthRequest, res: Response) {
  const { org } = getOrgFromReq(req);
  let project = "";
  if (typeof req.query?.project === "string") {
    project = req.query.project;
  }

  const reports = await getReportsByOrg(org.id, project);

  // get the experiments for these reports, mostly needed for names.
  const experimentsIds: string[] = [];
  if (reports.length) {
    reports.forEach((r) => {
      if (r.experimentId) {
        experimentsIds.push(r.experimentId);
      }
    });
  }

  const experiments = experimentsIds
    ? await getExperimentsByIds(experimentsIds)
    : [];

  res.status(200).json({
    status: 200,
    reports,
    experiments,
  });
}

export async function getReportsOnExperiment(req: AuthRequest, res: Response) {
  const { org } = getOrgFromReq(req);
  const { id } = req.params;

  const reports = await getReportsByExperimentId(org.id, id);

  res.status(200).json({
    status: 200,
    reports,
  });
}

export async function getReport(
  req: AuthRequest<null, { id: string }>,
  res: Response
) {
  const { org } = getOrgFromReq(req);

  const report = await getReportById(org.id, req.params.id);

  if (!report) {
    throw new Error("Unknown report id");
  }

  res.status(200).json({
    status: 200,
    report,
  });
}

export async function refreshReport(
  req: AuthRequest<null, { id: string }>,
  res: Response
) {
  const { org } = getOrgFromReq(req);

  const report = await getReportById(org.id, req.params.id);

  if (!report) {
    throw new Error("Unknown report id");
  }

  const useCache = !req.query["force"];

  await runReport(report, useCache);

  return res.status(200).json({
    status: 200,
  });
}

export async function putReport(
  req: AuthRequest<Partial<ReportInterface>, { id: string }>,
  res: Response
) {
  const { org } = getOrgFromReq(req);

  const report = await getReportById(org.id, req.params.id);

  if (!report) {
    throw new Error("Unknown report id");
  }

  const updates: Partial<ReportInterface> = {};
  let needsRun = false;
  if ("args" in req.body) {
    updates.args = {
      ...report.args,
      ...req.body.args,
    };

    updates.args.startDate = getValidDate(updates.args.startDate);
    updates.args.endDate = getValidDate(updates.args.endDate || new Date());
    needsRun = true;
  }
  if ("title" in req.body) updates.title = req.body.title;
  if ("description" in req.body) updates.description = req.body.description;
  await updateReport(org.id, req.params.id, updates);

  if (needsRun) {
    await runReport(
      {
        ...report,
        ...updates,
      },
      true
    );
  }

  return res.status(200).json({
    status: 200,
  });
}

export async function getReportStatus(
  req: AuthRequest<null, { id: string }>,
  res: Response
) {
  const { org } = getOrgFromReq(req);
  const { id } = req.params;
  const report = await getReportById(org.id, id);
  if (!report) {
    throw new Error("Could not get query status");
  }
  const result = await getStatusEndpoint(
    report,
    org.id,
    (queryData) => {
      if (report.type === "experiment") {
        return analyzeExperimentResults(
          org.id,
          report.args.variations,
          report.args.dimension || "",
          queryData
        );
      }
      throw new Error("Unsupported report type");
    },
    async (updates, results, error) => {
      await updateReport(org.id, id, {
        ...updates,
        results: results || report.results,
        error,
      });
    },
    report.error
  );
  return res.status(200).json(result);
}

export async function cancelReport(
  req: AuthRequest<null, { id: string }>,
  res: Response
) {
  const { org } = getOrgFromReq(req);
  const { id } = req.params;
  const report = await getReportById(org.id, id);
  if (!report) {
    throw new Error("Could not cancel query");
  }
  res.status(200).json(
    await cancelRun(report, org.id, async () => {
      await updateReport(org.id, id, {
        queries: [],
        runStarted: null,
      });
    })
  );
}

export async function postNotebook(
  req: AuthRequest<null, { id: string }>,
  res: Response
) {
  const { org } = getOrgFromReq(req);
  const { id } = req.params;

  const notebook = await generateReportNotebook(id, org.id);

  res.status(200).json({
    status: 200,
    notebook,
  });
}
