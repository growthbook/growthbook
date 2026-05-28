import { putReportSettingsValidator } from "shared/validators";
import { ExperimentSnapshotReportInterface } from "shared/types/report";
import { getValidDate } from "shared/dates";
import { getReportById, updateReport } from "back-end/src/models/ReportModel";
import { getExperimentById } from "back-end/src/models/ExperimentModel";
import { findSnapshotById } from "back-end/src/models/ExperimentSnapshotModel";
import {
  getMetricMapForExperiment,
  toSnapshotApiInterface,
} from "back-end/src/services/experiments";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { toReportApiInterface } from "./toReportApiInterface";

export const putReportSettings = createApiRequestHandler(
  putReportSettingsValidator,
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

  const {
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
    variations,
    coverage,
  } = req.body;

  const updates: Partial<ExperimentSnapshotReportInterface> = {};

  // Merge analysis settings — only overwrite fields explicitly provided.
  const currentSettings = report.experimentAnalysisSettings;
  const newSettings = { ...currentSettings };

  if (statsEngine !== undefined) newSettings.statsEngine = statsEngine;
  if (goalMetrics !== undefined) newSettings.goalMetrics = goalMetrics;
  if (secondaryMetrics !== undefined)
    newSettings.secondaryMetrics = secondaryMetrics;
  if (guardrailMetrics !== undefined)
    newSettings.guardrailMetrics = guardrailMetrics;
  if (activationMetric !== undefined)
    newSettings.activationMetric = activationMetric;
  if (metricOverrides !== undefined)
    newSettings.metricOverrides = metricOverrides;
  if (customMetricSlices !== undefined)
    newSettings.customMetricSlices = customMetricSlices;
  if (dimension !== undefined) newSettings.dimension = dimension;
  if (differenceType !== undefined) newSettings.differenceType = differenceType;
  if (dateStarted !== undefined)
    newSettings.dateStarted = getValidDate(dateStarted);
  if (dateEnded !== undefined)
    newSettings.dateEnded = dateEnded ? getValidDate(dateEnded) : null;
  if (regressionAdjustmentEnabled !== undefined)
    newSettings.regressionAdjustmentEnabled = regressionAdjustmentEnabled;
  if (sequentialTestingEnabled !== undefined)
    newSettings.sequentialTestingEnabled = sequentialTestingEnabled;
  if (sequentialTestingTuningParameter !== undefined)
    newSettings.sequentialTestingTuningParameter =
      sequentialTestingTuningParameter;
  if (attributionModel !== undefined)
    newSettings.attributionModel = attributionModel;
  if (lookbackOverride !== undefined)
    newSettings.lookbackOverride = lookbackOverride;
  if (segment !== undefined) newSettings.segment = segment;
  if (queryFilter !== undefined) newSettings.queryFilter = queryFilter;
  if (skipPartialData !== undefined)
    newSettings.skipPartialData = skipPartialData;

  updates.experimentAnalysisSettings = newSettings;

  // Merge variation metadata — update only the variations provided by index match on id.
  if (variations !== undefined || coverage !== undefined) {
    const meta = { ...report.experimentMetadata };
    const phases = meta.phases ? [...meta.phases] : [];
    const lastIdx = phases.length - 1;

    if (lastIdx >= 0) {
      const lastPhase = { ...phases[lastIdx] };

      if (variations !== undefined) {
        // Update variation names/keys by matching on id.
        const variationOverrideMap = new Map(variations.map((v) => [v.id, v]));
        meta.variations = (meta.variations ?? []).map((v) => {
          const override = variationOverrideMap.get(v.id);
          if (!override) return v;
          return {
            ...v,
            ...(override.name !== undefined ? { name: override.name } : {}),
            ...(override.key !== undefined ? { key: override.key } : {}),
          };
        });

        // Update weights in the latest phase.
        const weights = [...(lastPhase.variationWeights ?? [])];
        variations.forEach((override) => {
          if (override.weight === undefined) return;
          const idx = (meta.variations ?? []).findIndex(
            (v) => v.id === override.id,
          );
          if (idx !== -1) weights[idx] = override.weight;
        });
        lastPhase.variationWeights = weights;
      }

      if (coverage !== undefined) {
        lastPhase.coverage = coverage;
      }

      phases[lastIdx] = lastPhase;
      meta.phases = phases;
    }

    updates.experimentMetadata = meta;
  }

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
