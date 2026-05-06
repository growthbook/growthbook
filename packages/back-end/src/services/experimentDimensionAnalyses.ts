import { ExperimentSnapshotInterface } from "shared/types/experiment-snapshot";
import { isPrecomputedDimension } from "shared/experiments";
import { ExperimentInterface } from "shared/validators";
import { ReqContext } from "back-end/types/request";
import { logger } from "back-end/src/util/logger";
import { createExperimentSnapshot } from "back-end/src/services/experiments";
import {
  getExperimentTimeSeriesContext,
  updateExperimentAnalysisTimeSeries,
} from "back-end/src/services/experimentTimeSeries";
import {
  getTimeSeriesBaseAnalysis,
  getOrCreatePrecomputedDimensionTimeSeriesAnalyses,
} from "back-end/src/services/experimentDimensionTimeSeries";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import { findInFlightEagerUnitDimensionSnapshots } from "back-end/src/models/ExperimentSnapshotModel";
import { getEligiblePrecomputedUnitDimensionIds } from "back-end/src/services/dimensions";

/**
 * After a successful standard snapshot, runs gbstats analyses for every
 * precomputed dimension on the snapshot so we can persist dimension time series.
 */
export async function runEagerExperimentDimensionAnalyses({
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

    // We only run eager dimension analyses if we have a compatible base analysis
    if (!getTimeSeriesBaseAnalysis({ analyses: experimentSnapshot.analyses })) {
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
          await getOrCreatePrecomputedDimensionTimeSeriesAnalyses(context, {
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

export async function runEagerUnitDimensionAnalyses({
  context,
  experiment,
  experimentSnapshot,
}: {
  context: ReqContext;
  experiment: ExperimentInterface;
  experimentSnapshot: ExperimentSnapshotInterface;
}) {
  // Don't run eager dimension from a dimensioned snapshot
  if (
    experimentSnapshot.dimension !== null &&
    experimentSnapshot.dimension !== ""
  ) {
    return;
  }
  if (experimentSnapshot.type !== "standard") return;
  if (experimentSnapshot.triggeredBy === "eager-unit-dimension") return;
  if (experiment.type === "multi-armed-bandit") return;

  const requestedDimensionIds = experiment.precomputedUnitDimensionIds ?? [];
  if (requestedDimensionIds.length === 0) return;

  try {
    const datasource = await getDataSourceById(context, experiment.datasource);
    if (!datasource) {
      logger.warn(
        {
          experimentId: experiment.id,
          datasourceId: experiment.datasource,
        },
        "Eager unit-dim fan-out skipped: datasource not found",
      );
      return;
    }

    const eligibleDimensionIds = await getEligiblePrecomputedUnitDimensionIds({
      context,
      experiment,
      datasource,
      dimensionIds: requestedDimensionIds,
    });

    if (eligibleDimensionIds.length === 0) return;

    const inFlight = await findInFlightEagerUnitDimensionSnapshots(context, {
      experimentId: experiment.id,
      phase: experimentSnapshot.phase,
      dimensionIds: eligibleDimensionIds,
    });

    const dimensionIdsToRun = eligibleDimensionIds.filter(
      (dimensionId) => !inFlight.has(dimensionId),
    );

    for (const dimensionId of dimensionIdsToRun) {
      try {
        await createExperimentSnapshot({
          context,
          experiment,
          datasource,
          dimension: dimensionId,
          phase: experimentSnapshot.phase,
          useCache: true,
          triggeredBy: "eager-unit-dimension",
        });
      } catch (err) {
        logger.error(
          {
            err,
            experimentId: experiment.id,
            snapshotId: experimentSnapshot.id,
            dimensionId,
          },
          "Eager unit-dim snapshot creation failed",
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
      "Eager unit-dim fan-out failed before per-dimension loop",
    );
  }
}
