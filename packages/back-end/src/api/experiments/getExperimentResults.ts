import { GetExperimentResultsResponse } from "shared/types/openapi";
import { isFactMetricId, parseSliceMetricId } from "shared/experiments";
import { getSnapshotAnalysis } from "shared/util";
import { getExperimentResultsValidator } from "shared/validators";
import { getExperimentById } from "back-end/src/models/ExperimentModel";
import { getLatestSnapshot } from "back-end/src/models/ExperimentSnapshotModel";
import { toSnapshotApiInterface } from "back-end/src/services/experiments";
import { createApiRequestHandler } from "back-end/src/util/handler";

export const getExperimentResults = createApiRequestHandler(
  getExperimentResultsValidator,
)(async (req): Promise<GetExperimentResultsResponse> => {
  const experiment = await getExperimentById(req.context, req.params.id);
  if (!experiment) {
    throw new Error("Could not find experiment with that id");
  }

  const phase = parseInt(req.query.phase ?? experiment.phases.length - 1 + "");

  const snapshot = await getLatestSnapshot({
    experiment: experiment.id,
    phase,
    dimension: req.query.dimension,
    withResults: true,
  });

  if (!snapshot) {
    throw new Error("No results found for that experiment");
  }

  // Resolve which snapshot metric ids are stale, so we can annotate them with
  // `deleted: true` using a constant-time `Set` lookup.
  const snapshotMetricIdToBaseFactMetricId = new Map<string, string>();
  getSnapshotAnalysis(snapshot)?.results?.forEach((dimensionResult) => {
    dimensionResult.variations.forEach((variation) => {
      Object.keys(variation.metrics).forEach((metricId) => {
        const { baseMetricId } = parseSliceMetricId(metricId);
        if (isFactMetricId(baseMetricId)) {
          snapshotMetricIdToBaseFactMetricId.set(metricId, baseMetricId);
        }
      });
    });
  });

  const existingFactMetricIds = new Set<string>();
  const baseFactMetricIds = Array.from(
    new Set(snapshotMetricIdToBaseFactMetricId.values()),
  );
  if (baseFactMetricIds.length > 0) {
    const existingFactMetrics =
      await req.context.models.factMetrics.getByIds(baseFactMetricIds);
    existingFactMetrics.forEach((metric) =>
      existingFactMetricIds.add(metric.id),
    );
  }

  const deletedMetricIds = new Set<string>();
  snapshotMetricIdToBaseFactMetricId.forEach((baseMetricId, metricId) => {
    if (!existingFactMetricIds.has(baseMetricId)) {
      deletedMetricIds.add(metricId);
    }
  });

  const result = toSnapshotApiInterface(experiment, snapshot);
  if (deletedMetricIds.size > 0) {
    result.results.forEach((r) => {
      r.metrics.forEach((metric) => {
        if (deletedMetricIds.has(metric.metricId)) {
          metric.deleted = true;
        }
      });
    });
  }

  return {
    result: result,
  };
});
