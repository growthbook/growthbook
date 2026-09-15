/**
 * Finalize a experiment snapshot for which all queries succeeded but
 * results were never written, because the process driving it died first.
 * It re-creates the analysis inputs and replays the refresh path over the
 * persisted results, so no new warehouse queries are run.
 */
import {
  ExperimentSnapshotInterface,
  SnapshotQueryRunnerKind,
} from "shared/types/experiment-snapshot";
import {
  expandDerivedMetricsInMap,
  getPhaseVariations,
  ExperimentMetricInterface,
} from "shared/experiments";
import { getExperimentById } from "back-end/src/models/ExperimentModel";
import { getLatestSuccessfulSnapshot } from "back-end/src/models/ExperimentSnapshotModel";
import { getFactTableMap } from "back-end/src/models/FactTableModel";
import { getMetricMap } from "back-end/src/models/MetricModel";
import { getIntegrationFromDatasourceId } from "back-end/src/services/datasource";
import { SourceIntegrationInterface } from "back-end/src/types/Integration";
import { logger } from "back-end/src/util/logger";
import { ReqContext } from "back-end/types/request";
import { ApiReqContext } from "back-end/types/api";
import { ExperimentResultsQueryRunner } from "./ExperimentResultsQueryRunner";
import { ExperimentIncrementalRefreshQueryRunner } from "./ExperimentIncrementalRefreshQueryRunner";
import { ExperimentIncrementalRefreshExploratoryQueryRunner } from "./ExperimentIncrementalRefreshExploratoryQueryRunner";

type ExperimentAnalysisInputs = {
  metricMap: Map<string, ExperimentMetricInterface>;
  variationNames: string[];
};

interface RecoverableExperimentRunner {
  prepareAnalysisData(inputs: ExperimentAnalysisInputs): void;
  finalizeFromPersistedResults(): Promise<boolean>;
}

/**
 * Mirrors the live construction switch in services/experiments.ts, keyed by the
 * runnerKind persisted on the snapshot (absent means a legacy "results"
 * snapshot).
 */
const experimentRunnerFactories: Partial<
  Record<
    SnapshotQueryRunnerKind,
    (
      context: ReqContext | ApiReqContext,
      snapshot: ExperimentSnapshotInterface,
      integration: SourceIntegrationInterface,
    ) => RecoverableExperimentRunner
  >
> = {
  results: (context, snapshot, integration) =>
    new ExperimentResultsQueryRunner(context, snapshot, integration, false),
  "incremental-full": (context, snapshot, integration) =>
    new ExperimentIncrementalRefreshQueryRunner(
      context,
      snapshot,
      integration,
      false,
    ),
  "incremental-update": (context, snapshot, integration) =>
    new ExperimentIncrementalRefreshQueryRunner(
      context,
      snapshot,
      integration,
      false,
    ),
  "incremental-exploratory": (context, snapshot, integration) =>
    new ExperimentIncrementalRefreshExploratoryQueryRunner(
      context,
      snapshot,
      integration,
      false,
    ),
};

/**
 * Finalizes a stalled snapshot from its persisted query results.
 * Returns false when we are unable to do so, so the caller can take action.
 */
export async function recoverStalledSnapshot(
  context: ReqContext | ApiReqContext,
  snapshot: ExperimentSnapshotInterface,
): Promise<boolean> {
  if (snapshot.report) {
    logger.info(
      `Not recovering stalled snapshot ${snapshot.id}: report snapshots have no recovery path`,
    );
    return false;
  }

  const make = experimentRunnerFactories[snapshot.runnerKind ?? "results"];
  if (!make) {
    logger.info(
      `Not recovering stalled snapshot ${snapshot.id}: no recovery path for runner kind "${snapshot.runnerKind}"`,
    );
    return false;
  }

  if (!snapshot.experiment) {
    logger.info(
      `Not recovering stalled snapshot ${snapshot.id}: snapshot has no experiment`,
    );
    return false;
  }

  const experiment = await getExperimentById(context, snapshot.experiment);
  if (!experiment) {
    logger.info(
      `Not recovering stalled snapshot ${snapshot.id}: experiment ${snapshot.experiment} no longer exists`,
    );
    return false;
  }

  if (experiment.type === "multi-armed-bandit") {
    logger.info(
      `Not recovering stalled snapshot ${snapshot.id}: the live path applies a bandit reweight after results that recovery cannot reproduce`,
    );
    return false;
  }

  const lastSuccessfulSnapshot = await getLatestSuccessfulSnapshot({
    context,
    experiment: snapshot.experiment,
    phase: snapshot.phase,
    dimension: snapshot.dimension ?? undefined,
    type: snapshot.type,
  });
  if (
    lastSuccessfulSnapshot &&
    lastSuccessfulSnapshot.dateCreated > snapshot.dateCreated
  ) {
    logger.info(
      `Not recovering stalled snapshot ${snapshot.id}: superseded by newer successful snapshot ${lastSuccessfulSnapshot.id}`,
    );
    return false;
  }

  const metricMap = await getMetricMap(context);
  const factTableMap = await getFactTableMap(context);
  const metricGroups = await context.models.metricGroups.getAll();
  expandDerivedMetricsInMap({
    metricMap,
    factTableMap,
    experiment,
    metricGroups,
  });

  const variationNames = getPhaseVariations(experiment, snapshot.phase).map(
    (v) => v.name,
  );

  const integration = await getIntegrationFromDatasourceId(
    context,
    snapshot.settings.datasourceId,
    true,
  );

  const runner = make(context, snapshot, integration);
  runner.prepareAnalysisData({
    metricMap,
    variationNames,
  });
  return runner.finalizeFromPersistedResults();
}
