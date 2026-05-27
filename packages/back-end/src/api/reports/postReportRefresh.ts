import { postReportRefreshValidator } from "shared/validators";
import { getReportById, updateReport } from "back-end/src/models/ReportModel";
import { getExperimentById } from "back-end/src/models/ExperimentModel";
import { findSnapshotById } from "back-end/src/models/ExperimentSnapshotModel";
import { getMetricMap } from "back-end/src/models/MetricModel";
import { getFactTableMap } from "back-end/src/models/FactTableModel";
import { createReportSnapshot } from "back-end/src/services/reports";
import { toSnapshotApiInterface } from "back-end/src/services/experiments";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { toReportApiInterface } from "./toReportApiInterface";

export const postReportRefresh = createApiRequestHandler(
  postReportRefreshValidator,
)(async (req) => {
  const { org } = req.context;

  const report = await getReportById(org.id, req.params.id);
  if (!report) {
    throw new Error("Could not find report with that id");
  }

  if (report.type !== "experiment-snapshot") {
    throw new Error("Only experiment-snapshot reports can be refreshed");
  }

  const experiment = report.experimentId
    ? await getExperimentById(req.context, report.experimentId)
    : null;

  // getExperimentById returns null if the caller can't read the project.
  // canUpdateReport({}) would otherwise degrade to an org-level check.
  if (report.experimentId && !experiment) {
    throw new Error("Could not find report with that id");
  }

  if (!req.context.permissions.canUpdateReport(experiment || {})) {
    req.context.permissions.throwPermissionError();
  }

  const previousSnapshot = report.snapshot
    ? (await findSnapshotById(req.context, report.snapshot)) || undefined
    : undefined;

  const metricMap = await getMetricMap(req.context);
  const factTableMap = await getFactTableMap(req.context);

  try {
    const newSnapshot = await createReportSnapshot({
      report,
      previousSnapshot,
      context: req.context,
      metricMap,
      factTableMap,
    });

    await updateReport(org.id, report.id, { snapshot: newSnapshot.id });

    await req.audit({
      event: "experiment.analysis",
      entity: {
        object: "experiment",
        id: report.experimentId || "",
      },
      details: JSON.stringify({ report: report.id }),
    });

    const apiReport = toReportApiInterface(
      { ...report, snapshot: newSnapshot.id },
      newSnapshot,
    );

    if (newSnapshot.status === "success" && experiment) {
      const results = toSnapshotApiInterface(
        experiment,
        newSnapshot,
        metricMap,
      );
      return { report: { ...apiReport, results } };
    }

    return { report: apiReport };
  } catch (e) {
    return {
      report: {
        ...toReportApiInterface(report),
        snapshotStatus: "error" as const,
        snapshotError: (e as Error).message,
      },
    };
  }
});
