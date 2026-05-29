import uniqid from "uniqid";
import { ExperimentInterface } from "shared/validators";
import { ReqContext } from "back-end/types/request";
import { ApiReqContext } from "back-end/types/api";
import { logger } from "back-end/src/util/logger";
import { promiseAllChunks } from "back-end/src/util/promise";
import {
  getExperimentById,
  updateExperiment,
} from "back-end/src/models/ExperimentModel";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import { getMetricMap } from "back-end/src/models/MetricModel";
import { getFactTableMap } from "back-end/src/models/FactTableModel";
import { findSnapshotById } from "back-end/src/models/ExperimentSnapshotModel";
import {
  getExperimentTimeSeriesContext,
  updateExperimentAnalysisTimeSeries,
} from "back-end/src/services/experimentTimeSeries";
import { getOrCreatePrecomputedDimensionTimeSeriesAnalyses } from "back-end/src/services/experimentDimensionTimeSeries";
import {
  createSnapshotFromPlan,
  planExperimentSnapshot,
} from "back-end/src/services/experiments";

// Bound the parallel exploratory snapshot fan-out so a single experiment cannot
// saturate the warehouse / gbstats workers. All snapshots share one lock token.
const UNIT_DIMENSION_BATCH_CONCURRENCY = 3;

// Heartbeat the shared lock token while the parallel exploratory batch runs so
// it is not reclaimed via the stale-lock path mid-batch.
const BATCH_LOCK_HEARTBEAT_MS = 30 * 1000;

/**
 * After the main incremental run finishes and releases its lock, run one
 * exploratory snapshot per materialized unit dimension. All snapshots share a
 * single coordinator-held lock token, run in parallel (bounded), and write
 * per-dimension time series. The set of dimensions that produced time series is
 * recorded on `experiment.analysisSummary.precomputedUnitDimensions`.
 */
export async function runIncrementalUnitDimensionExploratoryBatch({
  context,
  experiment,
}: {
  context: ReqContext | ApiReqContext;
  experiment: ExperimentInterface;
}): Promise<void> {
  try {
    const incrementalRefreshModel =
      await context.models.incrementalRefresh.getByExperimentId(experiment.id);
    const unitDimensionIds =
      incrementalRefreshModel?.precomputedUnitDimensions ?? [];

    if (unitDimensionIds.length === 0) {
      // Nothing to compute; clear any stale availability on the summary.
      await clearPrecomputedUnitDimensions({ context, experiment });
      return;
    }

    const datasource = experiment.datasource
      ? await getDataSourceById(context, experiment.datasource)
      : null;
    if (!datasource) {
      return;
    }

    const batchLockToken = uniqid("irb_");
    const acquired = await context.models.incrementalRefresh.acquireLock(
      experiment.id,
      batchLockToken,
    );
    if (!acquired) {
      // Another refresh is using the shared pipeline tables; the exploratory
      // batch will run after the next successful main refresh.
      logger.info(
        { experimentId: experiment.id },
        "Skipping unit dimension exploratory batch; incremental refresh lock is held",
      );
      return;
    }

    const heartbeat = setInterval(() => {
      context.models.incrementalRefresh
        .touchLockHeartbeat(experiment.id, batchLockToken)
        .catch((e) =>
          logger.warn(
            e,
            "Failed to refresh unit dimension exploratory batch heartbeat",
          ),
        );
    }, BATCH_LOCK_HEARTBEAT_MS);

    const succeededDimensionIds: string[] = [];
    try {
      const metricMap = await getMetricMap(context);
      const factTableMap = await getFactTableMap(context);
      const phaseIndex = experiment.phases.length - 1;

      const tasks = unitDimensionIds.map((dimensionId) => async () => {
        try {
          const plan = await planExperimentSnapshot({
            context,
            experiment,
            datasource,
            dimension: dimensionId,
            phase: phaseIndex,
            useCache: false,
            type: "exploratory",
            allowIncrementalRefresh: true,
          });

          const queryRunner = await createSnapshotFromPlan({
            plan,
            context,
            experiment,
            metricMap,
            factTableMap,
            batchLockToken,
          });

          await queryRunner.waitForResults();

          const snapshot = await findSnapshotById(
            context,
            queryRunner.model.id,
          );
          if (!snapshot || snapshot.status !== "success") {
            throw new Error(
              `Exploratory snapshot for unit dimension "${dimensionId}" did not succeed`,
            );
          }

          const newAnalyses =
            await getOrCreatePrecomputedDimensionTimeSeriesAnalyses(context, {
              experiment,
              snapshot,
              dimensionId,
            });

          const timeSeriesContext = await getExperimentTimeSeriesContext({
            context,
            experiment,
            experimentSnapshot: snapshot,
          });

          await updateExperimentAnalysisTimeSeries({
            context,
            experiment,
            experimentSnapshot: snapshot,
            analyses: newAnalyses,
            allMetricIds: timeSeriesContext.allMetricIds,
            factMetrics: timeSeriesContext.factMetrics,
            factTableMap: timeSeriesContext.factTableMap,
          });

          succeededDimensionIds.push(dimensionId);
        } catch (err) {
          logger.error(
            {
              err,
              experimentId: experiment.id,
              dimensionId,
            },
            "Unit dimension exploratory snapshot failed",
          );
        }
      });

      await promiseAllChunks(tasks, UNIT_DIMENSION_BATCH_CONCURRENCY);
    } finally {
      clearInterval(heartbeat);
      await context.models.incrementalRefresh
        .releaseLock(experiment.id, batchLockToken)
        .catch((e) =>
          logger.warn(
            e,
            "Failed to release unit dimension exploratory batch lock",
          ),
        );
    }

    await setPrecomputedUnitDimensions({
      context,
      experimentId: experiment.id,
      dimensionIds: succeededDimensionIds,
    });
  } catch (err) {
    logger.error(
      {
        err,
        experimentId: experiment.id,
      },
      "Unit dimension exploratory batch failed before per-dimension loop",
    );
  }
}

async function clearPrecomputedUnitDimensions({
  context,
  experiment,
}: {
  context: ReqContext | ApiReqContext;
  experiment: ExperimentInterface;
}): Promise<void> {
  if (!experiment.analysisSummary?.precomputedUnitDimensions?.length) {
    return;
  }
  await setPrecomputedUnitDimensions({
    context,
    experimentId: experiment.id,
    dimensionIds: [],
  });
}

// Merges the computed unit dimension availability into the latest experiment
// analysis summary without clobbering the rest of it.
async function setPrecomputedUnitDimensions({
  context,
  experimentId,
  dimensionIds,
}: {
  context: ReqContext | ApiReqContext;
  experimentId: string;
  dimensionIds: string[];
}): Promise<void> {
  const latest = await getExperimentById(context, experimentId);
  if (!latest?.analysisSummary) {
    return;
  }
  await updateExperiment({
    context,
    experiment: latest,
    changes: {
      analysisSummary: {
        ...latest.analysisSummary,
        precomputedUnitDimensions: dimensionIds,
      },
    },
  });
}
