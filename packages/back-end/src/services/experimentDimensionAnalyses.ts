import { ExperimentSnapshotInterface } from "shared/types/experiment-snapshot";
import { isPrecomputedDimension } from "shared/experiments";
import { ExperimentInterface } from "shared/validators";
import { ReqContext } from "back-end/types/request";
import { logger } from "back-end/src/util/logger";
import { getOrCreatePrecomputedDimensionSnapshotAnalyses } from "back-end/src/services/experiments";
import {
  getExperimentTimeSeriesContext,
  updateExperimentAnalysisTimeSeries,
} from "back-end/src/services/experimentTimeSeries";

/**
 * After a successful standard snapshot, runs gbstats analyses for every
 * precomputed dimension on the snapshot so we can persist dimension time series.
 */
export async function runEagerPrecomputedDimensionAnalyses({
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

    const precomputedDimensions = (
      experimentSnapshot.settings.dimensions ?? []
    ).filter((d) => isPrecomputedDimension(d.id));

    if (precomputedDimensions.length === 0) {
      return;
    }

    // We need to have a baseline analysis to run the eager dimension analyses
    if (!experimentSnapshot.analyses[0]) {
      return;
    }

    const timeSeriesContext = await getExperimentTimeSeriesContext({
      context,
      experiment,
      experimentSnapshot,
    });

    // Iterate dimensions sequentially
    for (const dim of precomputedDimensions) {
      try {
        const newAnalyses =
          await getOrCreatePrecomputedDimensionSnapshotAnalyses(context, {
            experiment,
            snapshot: experimentSnapshot,
            dimensionId: dim.id,
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
            dimensionId: dim.id,
          },
          "Eager precomputed dimension analysis failed",
        );
      }
    }
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
