import isEqual from "lodash/isEqual";
import { getExperimentBulkResultsValidator } from "shared/validators";
import {
  ExperimentSnapshotAnalysis,
  ExperimentSnapshotInterface,
} from "shared/types/experiment-snapshot";
import { ExperimentInterface } from "shared/types/experiment";
import { expandAllSliceMetricsInMap } from "shared/experiments";
import { ReqContext } from "back-end/types/request";
import { ApiReqContext } from "back-end/types/api";
import { getExperimentById } from "back-end/src/models/ExperimentModel";
import { findSnapshotsByExperiment } from "back-end/src/models/ExperimentSnapshotModel";
import { getMetricMap } from "back-end/src/models/MetricModel";
import { getFactTableMap } from "back-end/src/models/FactTableModel";
import {
  createSnapshotAnalysesBatched,
  getMetricMapForExperiment,
  getMissingDifferenceTypeVariantSettings,
  getPrecomputedDimensionIdsInAnalyses,
  toExperimentSnapshotResultsApiInterface,
} from "back-end/src/services/experiments";
import { getOrCreatePrecomputedDimensionTimeSeriesAnalyses } from "back-end/src/services/experimentDimensionTimeSeries";
import {
  createApiRequestHandler,
  getPaginationReturnFields,
  validatePagination,
} from "back-end/src/util/handler";
import { logger } from "back-end/src/util/logger";
import { promiseAllChunks } from "back-end/src/util/promise";

// Bounded concurrency for on-demand gbstats runs filling in missing
// difference-type analyses.
const MISSING_ANALYSES_CONCURRENCY = 3;

// Merge newly computed analyses into the in-memory snapshot so the serializer
// can find them.
function mergeAnalysesIntoSnapshot(
  snapshot: ExperimentSnapshotInterface,
  analyses: ExperimentSnapshotAnalysis[],
): void {
  for (const analysis of analyses) {
    if (
      !snapshot.analyses.some((a) => isEqual(a.settings, analysis.settings))
    ) {
      snapshot.analyses.push(analysis);
    }
  }
}

/**
 * For each snapshot's default (0th) analysis, ensure the other difference-type
 * variants (absolute/scaled) exist, computing and persisting missing ones from
 * stored query data. Failures are logged and non-fatal: the response simply
 * omits variants we couldn't get.
 */
async function fillMissingDefaultAnalysisVariants(
  context: ReqContext | ApiReqContext,
  experiment: ExperimentInterface,
  snapshots: ExperimentSnapshotInterface[],
): Promise<void> {
  const snapshotsWithMissing = snapshots.flatMap((snapshot) => {
    const defaultAnalysis = snapshot.analyses[0];
    if (!defaultAnalysis || defaultAnalysis.status !== "success") return [];
    const missing = getMissingDifferenceTypeVariantSettings(
      snapshot.analyses,
      defaultAnalysis,
    );
    return missing.length ? [{ snapshot, missing }] : [];
  });
  if (!snapshotsWithMissing.length) return;

  // Same metric-map preparation as the precomputed dimension path: slice
  // metrics must be expanded for gbstats to resolve them.
  const metricGroups = await context.models.metricGroups.getAll();
  const metricMap = await getMetricMap(context);
  const factTableMap = await getFactTableMap(context);
  expandAllSliceMetricsInMap({
    metricMap,
    factTableMap,
    experiment,
    metricGroups,
  });

  const tasks = snapshotsWithMissing.map(
    ({ snapshot, missing }) =>
      async () => {
        try {
          const created = await createSnapshotAnalysesBatched(context, {
            experiment,
            snapshot,
            metricMap,
            analysisSettingsList: missing,
          });
          mergeAnalysesIntoSnapshot(snapshot, created);
        } catch (err) {
          logger.error(
            {
              err,
              experimentId: experiment.id,
              snapshotId: snapshot.id,
            },
            "Failed to compute default analysis difference-type variants for all-analyses response",
          );
        }
      },
  );

  await promiseAllChunks(tasks, MISSING_ANALYSES_CONCURRENCY);
}

/**
 * For every precomputed dimension already present in a snapshot's analyses,
 * ensure all difference-type variants (relative/absolute/scaled) exist,
 * computing and persisting missing ones from stored query data. Failures are
 * logged and non-fatal: the response simply omits variants we couldn't get.
 */
async function fillMissingPrecomputedDimensionAnalyses(
  context: ReqContext | ApiReqContext,
  experiment: ExperimentInterface,
  snapshots: ExperimentSnapshotInterface[],
): Promise<void> {
  const tasks = snapshots.flatMap((snapshot) =>
    getPrecomputedDimensionIdsInAnalyses(snapshot).map(
      (dimensionId) => async () => {
        try {
          const analyses =
            await getOrCreatePrecomputedDimensionTimeSeriesAnalyses(context, {
              experiment,
              snapshot,
              dimensionId,
            });
          mergeAnalysesIntoSnapshot(snapshot, analyses);
        } catch (err) {
          logger.error(
            {
              err,
              experimentId: experiment.id,
              snapshotId: snapshot.id,
              dimensionId,
            },
            "Failed to get or create precomputed dimension analyses for all-analyses response",
          );
        }
      },
    ),
  );

  await promiseAllChunks(tasks, MISSING_ANALYSES_CONCURRENCY);
}

export const getExperimentAllAnalyses = createApiRequestHandler(
  getExperimentBulkResultsValidator,
)(async (req) => {
  const experiment = await getExperimentById(req.context, req.params.id);
  if (!experiment) {
    throw new Error("Could not find experiment with that id");
  }

  const dateStart = new Date(req.query.dateStart);
  if (isNaN(dateStart.getTime())) {
    throw new Error("Invalid dateStart, expected an ISO 8601 date-time");
  }
  const dateEnd = req.query.dateEnd ? new Date(req.query.dateEnd) : new Date();
  if (isNaN(dateEnd.getTime())) {
    throw new Error("Invalid dateEnd, expected an ISO 8601 date-time");
  }

  const phase =
    req.query.phase !== undefined ? parseInt(req.query.phase, 10) : undefined;
  if (phase !== undefined && isNaN(phase)) {
    throw new Error("Invalid phase");
  }

  const { limit, offset } = validatePagination(req.query);

  const [{ snapshots, total }, metricsById] = await Promise.all([
    findSnapshotsByExperiment(req.context, {
      experiment: experiment.id,
      dateStart,
      dateEnd,
      phase,
      type: req.query.type,
      limit,
      offset,
    }),
    getMetricMapForExperiment(req.context, experiment),
  ]);

  // The default analysis and precomputed dimensions may be missing
  // absolute/scaled variants; compute and persist them from stored query data
  // before serializing.
  await fillMissingDefaultAnalysisVariants(req.context, experiment, snapshots);
  await fillMissingPrecomputedDimensionAnalyses(
    req.context,
    experiment,
    snapshots,
  );

  // A single snapshot expands into one result item per dimension; pagination
  // stays over snapshots, so `count` reflects snapshots on this page.
  const results = snapshots.flatMap((snapshot) =>
    toExperimentSnapshotResultsApiInterface(experiment, snapshot, metricsById),
  );

  return {
    results,
    ...getPaginationReturnFields(snapshots, total, { limit, offset }),
  };
});
