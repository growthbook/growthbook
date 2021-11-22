import { Response } from "express";
import { ReportInterface } from "../../types/report";
import { ExperimentModel } from "../models/ExperimentModel";
import { ExperimentSnapshotModel } from "../models/ExperimentSnapshotModel";
import {
  createReport,
  getReportById,
  updateReport,
} from "../models/ReportModel";
import { getOrgFromReq } from "../services/organizations";
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
    description: "",
    links: [
      {
        href: `/experiment/${snapshot.experiment}#results`,
        display: "Back to experiment results",
        external: false,
      },
    ],
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
    results: snapshot.results,
    queries: snapshot.queries,
    runStarted: snapshot.runStarted,
    error: snapshot.error,
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

export async function putReport(
  req: AuthRequest<Partial<ReportInterface>, { id: string }>,
  res: Response
) {
  const { org } = getOrgFromReq(req);

  const report = await getReportById(org.id, req.params.id);

  if (!report) {
    throw new Error("Unknown report id");
  }

  await updateReport(org.id, req.params.id, req.body);

  // TODO: start refreshing results

  return res.status(200).json({
    status: 200,
  });
}
