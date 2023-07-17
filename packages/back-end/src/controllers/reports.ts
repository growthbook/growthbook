import { Response } from "express";
import { DEFAULT_STATS_ENGINE } from "shared/constants";
import { getValidDate } from "shared/dates";
import { getSnapshotAnalysis } from "shared/util";
import { ReportInterface } from "../../types/report";
import {
  getExperimentById,
  getExperimentsByIds,
} from "../models/ExperimentModel";
import { findSnapshotById } from "../models/ExperimentSnapshotModel";
import { getMetricMap } from "../models/MetricModel";
import {
  createReport,
  deleteReportById,
  getReportById,
  getReportsByExperimentId,
  getReportsByOrg,
  updateReport,
} from "../models/ReportModel";
import { ReportQueryRunner } from "../queryRunners/ReportQueryRunner";
import { getIntegrationFromDatasourceId } from "../services/datasource";
import { generateReportNotebook } from "../services/notebook";
import { getOrgFromReq } from "../services/organizations";
import { reportArgsFromSnapshot } from "../services/reports";
import { AuthRequest } from "../types/AuthRequest";

export async function postReportFromSnapshot(
  req: AuthRequest<null, { snapshot: string }>,
  res: Response
) {
  const { org } = getOrgFromReq(req);

  const snapshot = await findSnapshotById(org.id, req.params.snapshot);

  if (!snapshot) {
    throw new Error("Invalid snapshot id");
  }

  const experiment = await getExperimentById(org.id, snapshot.experiment);

  if (!experiment) {
    throw new Error("Could not find experiment");
  }

  req.checkPermissions("createAnalyses", experiment.project);

  const phase = experiment.phases[snapshot.phase];
  if (!phase) {
    throw new Error("Unknown experiment phase");
  }

  const analysis = getSnapshotAnalysis(snapshot);
  if (!analysis) {
    throw new Error("Missing analysis settings");
  }

  const doc = await createReport(org.id, {
    experimentId: experiment.id,
    userId: req.userId,
    title: `New Report - ${experiment.name}`,
    description: ``,
    type: "experiment",
    args: reportArgsFromSnapshot(experiment, snapshot, analysis.settings),
    results: analysis.results
      ? {
          dimensions: analysis.results,
          unknownVariations: snapshot.unknownVariations || [],
          multipleExposures: snapshot.multipleExposures || 0,
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

export async function getReports(
  req: AuthRequest<
    unknown,
    unknown,
    {
      project?: string;
    }
  >,
  res: Response
) {
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

  const experiments = experimentsIds.length
    ? await getExperimentsByIds(org.id, experimentsIds)
    : [];

  res.status(200).json({
    status: 200,
    reports,
    experiments,
  });
}

export async function getReportsOnExperiment(
  req: AuthRequest<unknown, { id: string }>,
  res: Response
) {
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

export async function deleteReport(
  req: AuthRequest<null, { id: string }>,
  res: Response
) {
  const { org } = getOrgFromReq(req);
  const report = await getReportById(org.id, req.params.id);

  if (!report) {
    throw new Error("Could not find report");
  }

  // Only allow admins to delete other people's reports
  if (report.userId !== req.userId) {
    req.checkPermissions("superDelete");
  }

  await deleteReportById(org.id, req.params.id);

  res.status(200).json({
    status: 200,
  });
}

export async function refreshReport(
  req: AuthRequest<null, { id: string }, { force?: string }>,
  res: Response
) {
  req.checkPermissions("runQueries", "");

  const { org } = getOrgFromReq(req);
  const report = await getReportById(org.id, req.params.id);

  if (!report) {
    throw new Error("Unknown report id");
  }

  const useCache = !req.query["force"];

  const statsEngine = report.args?.statsEngine || DEFAULT_STATS_ENGINE;

  report.args.statsEngine = statsEngine;
  report.args.regressionAdjustmentEnabled =
    statsEngine === "frequentist"
      ? !!report.args?.regressionAdjustmentEnabled
      : false;

  const metricMap = await getMetricMap(org.id);

  const integration = await getIntegrationFromDatasourceId(
    org.id,
    report.args.datasource,
    true
  );
  const queryRunner = new ReportQueryRunner(report, integration, useCache);

  const updatedReport = await queryRunner.startAnalysis({
    metricMap,
  });

  return res.status(200).json({
    status: 200,
    updatedReport,
  });
}

export async function putReport(
  req: AuthRequest<Partial<ReportInterface>, { id: string }>,
  res: Response
) {
  req.checkPermissions("createAnalyses", "");
  req.checkPermissions("runQueries", "");

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

    const statsEngine = updates.args?.statsEngine || DEFAULT_STATS_ENGINE;

    updates.args.startDate = getValidDate(updates.args.startDate);
    if (!updates.args.endDate) {
      delete updates.args.endDate;
    } else {
      updates.args.endDate = getValidDate(updates.args.endDate || new Date());
    }
    updates.args.statsEngine = statsEngine;
    updates.args.regressionAdjustmentEnabled =
      statsEngine === "frequentist"
        ? !!updates.args?.regressionAdjustmentEnabled
        : false;
    updates.args.metricRegressionAdjustmentStatuses =
      updates.args?.metricRegressionAdjustmentStatuses || [];

    needsRun = true;
  }
  if ("title" in req.body) updates.title = req.body.title;
  if ("description" in req.body) updates.description = req.body.description;
  if ("status" in req.body) updates.status = req.body.status;

  await updateReport(org.id, req.params.id, updates);

  const updatedReport: ReportInterface = {
    ...report,
    ...updates,
  };
  if (needsRun) {
    const metricMap = await getMetricMap(org.id);

    const integration = await getIntegrationFromDatasourceId(
      org.id,
      updatedReport.args.datasource,
      true
    );
    const queryRunner = new ReportQueryRunner(updatedReport, integration);

    await queryRunner.startAnalysis({
      metricMap,
    });
  }

  return res.status(200).json({
    status: 200,
    updatedReport,
  });
}

export async function cancelReport(
  req: AuthRequest<null, { id: string }>,
  res: Response
) {
  req.checkPermissions("runQueries", "");

  const { org } = getOrgFromReq(req);
  const { id } = req.params;
  const report = await getReportById(org.id, id);
  if (!report) {
    throw new Error("Could not cancel query");
  }

  const integration = await getIntegrationFromDatasourceId(
    org.id,
    report.args.datasource
  );
  const queryRunner = new ReportQueryRunner(report, integration);
  await queryRunner.cancelQueries();

  res.status(200).json({ status: 200 });
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
