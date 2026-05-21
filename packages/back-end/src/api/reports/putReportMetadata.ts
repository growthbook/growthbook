import { putReportMetadataValidator } from "shared/validators";
import { ExperimentSnapshotReportInterface } from "shared/types/report";
import { getReportById, updateReport } from "back-end/src/models/ReportModel";
import { getExperimentById } from "back-end/src/models/ExperimentModel";
import { findSnapshotById } from "back-end/src/models/ExperimentSnapshotModel";
import {
  getMetricMapForExperiment,
  toSnapshotApiInterface,
} from "back-end/src/services/experiments";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { toReportApiInterface } from "./toReportApiInterface";

export const putReportMetadata = createApiRequestHandler(
  putReportMetadataValidator,
)(async (req) => {
  const { org } = req.context;

  const report = await getReportById(org.id, req.params.id);
  if (!report) {
    throw new Error("Could not find report with that id");
  }

  if (report.type !== "experiment-snapshot") {
    throw new Error("Only experiment-snapshot reports can be updated");
  }

  const experiment = report.experimentId
    ? await getExperimentById(req.context, report.experimentId)
    : null;

  if (report.experimentId && !experiment) {
    throw new Error("Could not find report with that id");
  }

  if (!req.context.permissions.canUpdateReport(experiment || {})) {
    req.context.permissions.throwPermissionError();
  }

  const { title, description, status, shareLevel, editLevel } = req.body;

  const updates: Partial<ExperimentSnapshotReportInterface> = {};
  if (title !== undefined) updates.title = title;
  if (description !== undefined) updates.description = description;
  if (status !== undefined) updates.status = status;
  if (shareLevel !== undefined) updates.shareLevel = shareLevel;
  if (editLevel !== undefined) updates.editLevel = editLevel;

  await updateReport(org.id, report.id, updates);

  const refreshed = await getReportById(org.id, report.id);
  const updatedReport = (
    refreshed?.type === "experiment-snapshot"
      ? refreshed
      : { ...report, ...updates }
  ) as ExperimentSnapshotReportInterface;

  const snapshot = updatedReport.snapshot
    ? await findSnapshotById(req.context, updatedReport.snapshot)
    : null;
  const apiReport = toReportApiInterface(updatedReport, snapshot);

  if (snapshot?.status === "success" && experiment) {
    const metricsById = await getMetricMapForExperiment(
      req.context,
      experiment,
    );
    const results = toSnapshotApiInterface(experiment, snapshot, metricsById);
    return { report: { ...apiReport, results } };
  }

  return { report: apiReport };
});
