import { Response } from "express";
import { ReportInterface } from "../../types/report";
import { ExperimentModel } from "../models/ExperimentModel";
import { ExperimentSnapshotModel } from "../models/ExperimentSnapshotModel";
import { getMetricById, updateMetric } from "../models/MetricModel";
import {
  createReport,
  getReportById,
  updateReport,
} from "../models/ReportModel";
import { getOrgFromReq } from "../services/organizations";
import { cancelRun, getStatusEndpoint } from "../services/queries";
import { analyzeExperimentResults, runReport } from "../services/reports";
import { AuthRequest } from "../types/AuthRequest";

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
    title: `New Report - ${experiment.name}`,
    description: `[Back to experiment results](/experiment/${snapshot.experiment}#results)`,
    type: "experiment",
    args: {
      trackingKey: experiment.trackingKey,
      datasource: experiment.datasource,
      userIdType: experiment.userIdType,
      startDate: phase.dateStarted,
      endDate: phase.dateEnded || undefined,
      dimension: snapshot.dimension || undefined,
      variations: experiment.variations.map((v, i) => {
        return {
          id: v.key || i + "",
          name: v.name,
          weight: phase.variationWeights[i] || 0,
        };
      }),
      segment: snapshot.segment,
      metrics: experiment.metrics,
      guardrails: experiment.guardrails,
      activationMetric: snapshot.activationMetric,
      queryFilter: snapshot.queryFilter,
      skipPartialData: snapshot.skipPartialData,
    },
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

  // TODO: start refreshing results
  await runReport(report);

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
    needsRun = true;
  }
  if ("title" in req.body) updates.title = req.body.title;
  if ("description" in req.body) updates.description = req.body.description;
  await updateReport(org.id, req.params.id, updates);

  if (needsRun) {
    await runReport({
      ...report,
      ...updates,
    });
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
  const metric = await getMetricById(id, org.id, true);
  if (!metric) {
    throw new Error("Could not cancel query");
  }
  res.status(200).json(
    await cancelRun(metric, org.id, async () => {
      await updateMetric(
        id,
        {
          queries: [],
          runStarted: null,
        },
        org.id
      );
    })
  );
}
