import { getReportValidator } from "shared/validators";
import { getReportById } from "back-end/src/models/ReportModel";
import { getExperimentById } from "back-end/src/models/ExperimentModel";
import { findSnapshotById } from "back-end/src/models/ExperimentSnapshotModel";
import {
  getMetricMapForExperiment,
  toSnapshotApiInterface,
} from "back-end/src/services/experiments";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { toReportApiInterface } from "./toReportApiInterface";

export const getReport = createApiRequestHandler(getReportValidator)(async (
  req,
) => {
  const { org } = req.context;

  const report = await getReportById(org.id, req.params.id);
  if (!report) {
    throw new Error("Could not find report with that id");
  }

  const experiment = report.experimentId
    ? await getExperimentById(req.context, report.experimentId)
    : null;

  // getExperimentById returns null if the caller can't read the project,
  // so reject here to avoid leaking report metadata across projects.
  if (report.experimentId && !experiment) {
    throw new Error("Could not find report with that id");
  }

  if (report.type === "experiment-snapshot") {
    const snapshot = await findSnapshotById(req.context, report.snapshot);
    const apiReport = toReportApiInterface(report, snapshot);

    if (snapshot?.status === "success" && experiment) {
      const metricsById = await getMetricMapForExperiment(
        req.context,
        experiment,
      );
      const results = toSnapshotApiInterface(experiment, snapshot, metricsById);
      return { report: { ...apiReport, results } };
    }

    return { report: apiReport };
  }

  return { report: toReportApiInterface(report) };
});
