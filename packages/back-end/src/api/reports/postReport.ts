import {
  postReportValidator,
  experimentAnalysisSettings,
} from "shared/validators";
import { pick, omit } from "lodash";
import { getAllVariations } from "shared/experiments";
import { ExperimentReportAnalysisSettings } from "shared/types/report";
import { getValidDate } from "shared/dates";
import { getExperimentById } from "back-end/src/models/ExperimentModel";
import { getLatestSuccessfulSnapshot } from "back-end/src/models/ExperimentSnapshotModel";
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
    metricOverrides,
    customMetricSlices,
    dimension,
    differenceType,
    dateStarted,
    dateEnded,
    regressionAdjustmentEnabled,
    sequentialTestingEnabled,
    sequentialTestingTuningParameter,
    attributionModel,
    lookbackOverride,
    segment,
    queryFilter,
    skipPartialData,
    shareLevel,
  } = req.body;

  const experiment = await getExperimentById(req.context, experimentId);
  if (!experiment) {
    throw new Error("Could not find experiment with that id");
  }

  if (!req.context.permissions.canCreateReport(experiment)) {
    req.context.permissions.throwPermissionError();
  }

  const phaseIndex = Math.max(experiment.phases.length - 1, 0);
  const latestSnapshot = await getLatestSuccessfulSnapshot({
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

  const analysisSettings: ExperimentReportAnalysisSettings = {
    ...pick(experiment, Object.keys(experimentAnalysisSettings.shape)),
    trackingKey: experiment.trackingKey || experiment.id,
  } as ExperimentReportAnalysisSettings;

  if (statsEngine) {
    analysisSettings.statsEngine = statsEngine;
  }
  if (goalMetrics) {
    analysisSettings.goalMetrics = goalMetrics;
  }
  if (secondaryMetrics) {
    analysisSettings.secondaryMetrics = secondaryMetrics;
  }
  if (guardrailMetrics) {
    analysisSettings.guardrailMetrics = guardrailMetrics;
  }
  if (activationMetric !== undefined) {
    analysisSettings.activationMetric = activationMetric;
  }
  if (dimension) {
    analysisSettings.dimension = dimension;
  }
  if (dateStarted) {
    analysisSettings.dateStarted = getValidDate(dateStarted);
  } else {
    analysisSettings.dateStarted =
      experiment.phases?.[phaseIndex]?.dateStarted ?? new Date();
  }
  if (dateEnded) {
    analysisSettings.dateEnded = getValidDate(dateEnded);
  } else if (
    experiment?.status === "stopped" &&
    experiment.phases?.[phaseIndex]?.dateEnded
  ) {
    analysisSettings.dateEnded = experiment.phases?.[phaseIndex]?.dateEnded;
  }
  if (regressionAdjustmentEnabled !== undefined) {
    analysisSettings.regressionAdjustmentEnabled = regressionAdjustmentEnabled;
  }
  if (sequentialTestingEnabled !== undefined) {
    analysisSettings.sequentialTestingEnabled = sequentialTestingEnabled;
  }
  if (sequentialTestingTuningParameter !== undefined) {
    analysisSettings.sequentialTestingTuningParameter =
      sequentialTestingTuningParameter;
  }
  if (differenceType) {
    analysisSettings.differenceType = differenceType;
  }
  if (attributionModel) {
    analysisSettings.attributionModel = attributionModel;
  }
  if (lookbackOverride) {
    analysisSettings.lookbackOverride = lookbackOverride;
  }
  if (metricOverrides) {
    analysisSettings.metricOverrides = metricOverrides;
  }
  if (customMetricSlices) {
    analysisSettings.customMetricSlices = customMetricSlices;
  }
  if (segment !== undefined) {
    analysisSettings.segment = segment;
  }
  if (queryFilter !== undefined) {
    analysisSettings.queryFilter = queryFilter;
  }
  if (skipPartialData !== undefined) {
    analysisSettings.skipPartialData = skipPartialData;
  }

  const report = await createReport(org.id, {
    experimentId: experiment.id,
    title: title || `API Report - ${experiment.name}`,
    description: description || "",
    type: "experiment-snapshot",
    shareLevel: shareLevel ?? "private",
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
    experimentAnalysisSettings: analysisSettings,
  });

  await req.audit({
    event: "experiment.analysis",
    entity: {
      object: "experiment",
      id: experiment.id,
    },
    details: JSON.stringify({ report: report.id }),
  });

  const metricMap = await getMetricMap(req.context);
  const factTableMap = await getFactTableMap(req.context);

  try {
    const newSnapshot = await createReportSnapshot({
      report,
      previousSnapshot: latestSnapshot,
      context: req.context,
      metricMap,
      factTableMap,
    });

    await updateReport(org.id, report.id, { snapshot: newSnapshot.id });

    return {
      report: toReportApiInterface(
        { ...report, snapshot: newSnapshot.id },
        newSnapshot,
      ),
    };
  } catch (e) {
    // Clear the placeholder snapshot so a subsequent GET doesn't read back a
    // "success" status from the original experiment snapshot this report
    // never ran against.
    await updateReport(org.id, report.id, { snapshot: "" });
    return {
      report: {
        ...toReportApiInterface({ ...report, snapshot: "" }),
        snapshotStatus: "error" as const,
        snapshotError: (e as Error).message,
      },
    };
  }
});
