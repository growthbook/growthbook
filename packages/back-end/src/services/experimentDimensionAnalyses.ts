import { ExperimentSnapshotInterface } from "shared/types/experiment-snapshot";
import { isDimensionPrecomputed } from "shared/experiments";
import { ExperimentInterface } from "shared/validators";
import { ReqContext } from "back-end/types/request";
import { logger } from "back-end/src/util/logger";
import { promiseAllChunks } from "back-end/src/util/promise";
import {
  getExperimentTimeSeriesContext,
  updateExperimentAnalysisTimeSeries,
} from "back-end/src/services/experimentTimeSeries";
import {
  getTimeSeriesBaseAnalysis,
  getOrCreatePrecomputedDimensionTimeSeriesAnalyses,
} from "back-end/src/services/experimentDimensionTimeSeries";

// Optimize some concurrency for the analyses, as the query cost is already
// paid, we don't want to process them via gbstats serially.
const EAGER_DIMENSION_CONCURRENCY = 3;

/**
 * After a successful standard snapshot, runs gbstats analyses for every
 * precomputed experiment and unit dimension on the snapshot, then persists
 * their dimension time series.
 */
export async function runEagerExperimentAndUnitDimensionsAnalyses({
  context,
  experiment,
  experimentSnapshot,
}: {
  context: ReqContext;
  experiment: ExperimentInterface;
  experimentSnapshot: ExperimentSnapshotInterface;
}) {
  try {
    // Snapshots with dimension (unit dimension) already have their analyses populated
    if (
      experimentSnapshot.dimension !== null &&
      experimentSnapshot.dimension !== ""
    ) {
      return;
    }

    const precomputedUnitDimensionIds =
      experimentSnapshot.settings.precomputedUnitDimensionIds ?? [];
    const precomputedDimensionIds = new Set<string>();

    (experimentSnapshot.settings.dimensions ?? []).forEach((dimension) => {
      if (isDimensionPrecomputed(dimension.id, precomputedUnitDimensionIds)) {
        precomputedDimensionIds.add(dimension.id);
      }
    });

    if (
      experimentSnapshot.type === "standard" &&
      experiment.type !== "multi-armed-bandit"
    ) {
      precomputedUnitDimensionIds.forEach((dimensionId) => {
        precomputedDimensionIds.add(dimensionId);
      });
    }

    if (precomputedDimensionIds.size === 0) {
      return;
    }

    // We only run eager dimension analyses if we have a compatible base analysis
    if (!getTimeSeriesBaseAnalysis({ analyses: experimentSnapshot.analyses })) {
      return;
    }

    const timeSeriesContext = await getExperimentTimeSeriesContext({
      context,
      experiment,
      experimentSnapshot,
    });

    const dimensionTasks = Array.from(precomputedDimensionIds).map(
      (dimensionId) => async () => {
        try {
          const newAnalyses =
            await getOrCreatePrecomputedDimensionTimeSeriesAnalyses(context, {
              experiment,
              snapshot: experimentSnapshot,
              dimensionId,
            });

          await updateExperimentAnalysisTimeSeries({
            context,
            experiment,
            experimentSnapshot,
            analyses: newAnalyses,
            allMetricIds: timeSeriesContext.allMetricIds,
            factMetrics: timeSeriesContext.factMetrics,
            factTableMap: timeSeriesContext.factTableMap,
          });
        } catch (err) {
          logger.error(
            {
              err,
              experimentId: experiment.id,
              snapshotId: experimentSnapshot.id,
              dimensionId,
            },
            "Eager precomputed dimension analysis failed",
          );
        }
      },
    );

    await promiseAllChunks(dimensionTasks, EAGER_DIMENSION_CONCURRENCY);
  } catch (err) {
    logger.error(
      {
        err,
        experimentId: experiment.id,
        snapshotId: experimentSnapshot.id,
      },
      "Eager precomputed dimension analyses failed before per-dimension loop",
    );
  }
}
