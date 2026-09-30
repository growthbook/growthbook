import {
  postSnapshotAnalysisValidator,
  postSnapshotCancelValidator,
} from "shared/validators";
import {
  expandDerivedMetricsInMap,
  getPhaseVariations,
} from "shared/experiments";
import { getSnapshotAnalysis } from "shared/util";
import { ExperimentSnapshotAnalysisSettings } from "shared/types/experiment-snapshot";
import { findSnapshotById } from "back-end/src/models/ExperimentSnapshotModel";
import { getExperimentById } from "back-end/src/models/ExperimentModel";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import { getMetricMap } from "back-end/src/models/MetricModel";
import { getFactTableMap } from "back-end/src/models/FactTableModel";
import {
  createSnapshotAnalysis,
  getMetricMapForExperiment,
  toSnapshotApiInterface,
} from "back-end/src/services/experiments";
import { cancelExperimentSnapshot } from "back-end/src/services/snapshotCancellation";
import { BadRequestError, NotFoundError } from "back-end/src/util/errors";
import { ApiReqContext } from "back-end/types/api";
import { ReqContext } from "back-end/types/request";
import { createApiRequestHandler } from "back-end/src/util/handler";

// Snapshots have no read check of their own; reading the experiment is it.
async function getSnapshotAndExperiment(context: ApiReqContext, id: string) {
  const snapshot = await findSnapshotById(context, id);
  const experiment =
    snapshot && (await getExperimentById(context, snapshot.experiment));
  if (!snapshot || !experiment) {
    throw new NotFoundError("Snapshot not found or no permission to access");
  }
  return { snapshot, experiment };
}

export const postSnapshotCancel = createApiRequestHandler(
  postSnapshotCancelValidator,
)(async (req) => {
  const { context } = req;
  const { snapshot, experiment } = await getSnapshotAndExperiment(
    context,
    req.params.id,
  );
  const datasource = await getDataSourceById(context, experiment.datasource);
  if (
    !datasource ||
    !context.permissions.canCreateExperimentSnapshot(datasource)
  ) {
    context.permissions.throwPermissionError();
  }
  const { outcome } = await cancelExperimentSnapshot(
    context as ReqContext,
    snapshot,
  );
  return { outcome };
});

export const postSnapshotAnalysis = createApiRequestHandler(
  postSnapshotAnalysisValidator,
)(async (req) => {
  const { context } = req;
  const { snapshot, experiment } = await getSnapshotAndExperiment(
    context,
    req.params.id,
  );
  const base = getSnapshotAnalysis(snapshot)?.settings;
  if (!base) throw new BadRequestError("This snapshot has no results yet");

  const { baselineVariationId, ...overrides } = req.body;
  let baselineVariationIndex = base.baselineVariationIndex;
  if (baselineVariationId) {
    baselineVariationIndex = getPhaseVariations(
      experiment,
      snapshot.phase,
    ).findIndex((v) => v.id === baselineVariationId);
    if (baselineVariationIndex < 0) {
      throw new BadRequestError(`Unknown variation: ${baselineVariationId}`);
    }
  }
  const analysisSettings: ExperimentSnapshotAnalysisSettings = {
    ...base,
    ...overrides,
    baselineVariationIndex,
  };

  // Reuse a matching analysis rather than recomputing it
  if (!getSnapshotAnalysis(snapshot, analysisSettings)) {
    const [metricMap, factTableMap, metricGroups] = await Promise.all([
      getMetricMap(context),
      getFactTableMap(context),
      context.models.metricGroups.getAll(),
    ]);
    expandDerivedMetricsInMap({
      metricMap,
      factTableMap,
      experiment,
      metricGroups,
    });
    await createSnapshotAnalysis(context, {
      experiment,
      analysisSettings,
      metricMap,
      snapshot,
    });
  }

  const updated = (await findSnapshotById(context, snapshot.id)) ?? snapshot;
  const metricsById = await getMetricMapForExperiment(context, experiment);
  return {
    result: toSnapshotApiInterface(
      experiment,
      updated,
      metricsById,
      analysisSettings,
    ),
  };
});
