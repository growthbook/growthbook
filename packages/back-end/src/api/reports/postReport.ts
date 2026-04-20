import {
  postReportValidator,
  experimentAnalysisSettings,
} from "shared/validators";
import { pick, omit } from "lodash";
import uniqid from "uniqid";
import { getAllVariations } from "shared/experiments";
import {
  ExperimentReportAnalysisSettings,
  ExperimentSnapshotReportInterface,
} from "shared/types/report";
import { getValidDate } from "shared/dates";
import { getExperimentById } from "back-end/src/models/ExperimentModel";
import {
  createExperimentSnapshotModel,
  getLatestSnapshot,
} from "back-end/src/models/ExperimentSnapshotModel";
import { getMetricMap } from "back-end/src/models/MetricModel";
import { getFactTableMap } from "back-end/src/models/FactTableModel";
import { createReport, updateReport } from "back-end/src/models/ReportModel";
import { createReportSnapshot } from "back-end/src/services/reports";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { toReportApiInterface } from "./toReportApiInterface";

export const postReport = createApiRequestHandler(postReportValidator)(async (
  req,
) => {
  const { org } = req.context;

  const {
    experimentId,
    title,
    description,
    statsEngine,
    goalMetrics,
    secondaryMetrics,
    guardrailMetrics,
    activationMetric,
    dimension,
    dateStarted,
    dateEnded,
    regressionAdjustmentEnabled,
    sequentialTestingEnabled,
  } = req.body;

  const experiment = await getExperimentById(req.context, experimentId);
  if (!experiment) {
    throw new Error("Could not find experiment with that id");
  }

  if (!req.context.permissions.canCreateReport(experiment)) {
    req.context.permissions.throwPermissionError();
  }

  const phaseIndex = Math.max(experiment.phases.length - 1, 0);
  const latestSnapshot = await getLatestSnapshot({
    context: req.context,
    experiment: experiment.id,
    phase: phaseIndex,
    type: "standard",
  });
  if (!latestSnapshot) {
    throw new Error(
      "No existing snapshot found for this experiment. Run the experiment at least once before creating a report.",
    );
  }

  const _experimentAnalysisSettings: ExperimentReportAnalysisSettings = {
    ...pick(experiment, Object.keys(experimentAnalysisSettings.shape)),
    trackingKey: experiment.trackingKey || experiment.id,
  } as ExperimentReportAnalysisSettings;

  if (statsEngine) {
    _experimentAnalysisSettings.statsEngine = statsEngine;
  }
  if (goalMetrics) {
    _experimentAnalysisSettings.goalMetrics = goalMetrics;
  }
  if (secondaryMetrics) {
    _experimentAnalysisSettings.secondaryMetrics = secondaryMetrics;
  }
  if (guardrailMetrics) {
    _experimentAnalysisSettings.guardrailMetrics = guardrailMetrics;
  }
  if (activationMetric !== undefined) {
    _experimentAnalysisSettings.activationMetric = activationMetric;
  }
  if (dimension) {
    _experimentAnalysisSettings.dimension = dimension;
  }
  if (dateStarted) {
    _experimentAnalysisSettings.dateStarted = getValidDate(dateStarted);
  } else {
    _experimentAnalysisSettings.dateStarted =
      experiment.phases?.[phaseIndex]?.dateStarted ?? new Date();
  }
  if (dateEnded) {
    _experimentAnalysisSettings.dateEnded = getValidDate(dateEnded);
  } else if (
    experiment?.status === "stopped" &&
    experiment.phases?.[phaseIndex]?.dateEnded
  ) {
    _experimentAnalysisSettings.dateEnded =
      experiment.phases?.[phaseIndex]?.dateEnded;
  }
  if (regressionAdjustmentEnabled !== undefined) {
    _experimentAnalysisSettings.regressionAdjustmentEnabled =
      regressionAdjustmentEnabled;
  }
  if (sequentialTestingEnabled !== undefined) {
    _experimentAnalysisSettings.sequentialTestingEnabled =
      sequentialTestingEnabled;
  }

  const report = await createReport(org.id, {
    experimentId: experiment.id,
    title: title || `API Report - ${experiment.name}`,
    description: description || "",
    type: "experiment-snapshot",
    snapshot: latestSnapshot.id,
    experimentMetadata: {
      type: experiment.type || "standard",
      phases: experiment.phases.map((phase) =>
        pick(phase, [
          "dateStarted",
          "dateEnded",
          "name",
          "variationWeights",
          "variations",
          "banditEvents",
          "coverage",
        ]),
      ),
      variations: getAllVariations(experiment).map((variation) =>
        omit(variation, ["description", "screenshots"]),
      ),
    },
    experimentAnalysisSettings: _experimentAnalysisSettings,
  });

  await req.audit({
    event: "experiment.analysis",
    entity: {
      object: "experiment",
      id: experiment.id,
    },
    details: JSON.stringify({ report: report.id }),
  });

  // Clone the latest snapshot with reset status so a stale "success" isn't
  // misleading if the fresh analysis below fails.
  const clonedSnapshot = {
    ...latestSnapshot,
    id: uniqid("snp_"),
    type: "report" as const,
    report: report.id,
    triggeredBy: "manual" as const,
    status: "running" as const,
    error: "",
    queries: [],
  };
  await createExperimentSnapshotModel({
    context: req.context,
    data: clonedSnapshot,
  });
  await updateReport(org.id, report.id, { snapshot: clonedSnapshot.id });

  const metricMap = await getMetricMap(req.context);
  const factTableMap = await getFactTableMap(req.context);

  const reportWithSnapshot: ExperimentSnapshotReportInterface = {
    ...report,
    snapshot: clonedSnapshot.id,
  };

  try {
    const newSnapshot = await createReportSnapshot({
      report: reportWithSnapshot,
      previousSnapshot: clonedSnapshot,
      context: req.context,
      metricMap,
      factTableMap,
    });

    await updateReport(org.id, report.id, { snapshot: newSnapshot.id });

    return {
      report: toReportApiInterface(
        { ...reportWithSnapshot, snapshot: newSnapshot.id },
        newSnapshot,
      ),
    };
  } catch (e) {
    return {
      report: {
        ...toReportApiInterface(reportWithSnapshot),
        snapshotStatus: "error" as const,
        snapshotError: (e as Error).message,
      },
    };
  }
});
