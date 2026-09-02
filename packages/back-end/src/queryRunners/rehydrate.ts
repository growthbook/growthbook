/**
 * Finalizes an experiment snapshot whose warehouse queries all succeeded but
 * whose results were never written, because the process driving it died first.
 * It re-derives the analysis inputs and replays the refresh path over the
 * persisted query results, so no warehouse queries are run. Report and bandit
 * snapshots are gated out.
 */
import {
  ExperimentSnapshotInterface,
  SnapshotQueryRunnerKind,
} from "shared/types/experiment-snapshot";
import {
  expandDerivedMetricsInMap,
  getPhaseVariations,
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

type Context = ReqContext | ApiReqContext;

type MetricMap = Awaited<ReturnType<typeof getMetricMap>>;

/**
 * runAnalysis reads only metricMap and variationNames; experimentQueryMetadata
 * only shapes queries, which recovery never issues.
 */
type ExperimentAnalysisInputs = {
  metricMap: MetricMap;
  variationNames: string[];
  experimentQueryMetadata: null;
};

/** A runner that can be seeded from persisted results and finalized. */
interface FinalizableExperimentRunner {
  prepareAnalysisData(inputs: ExperimentAnalysisInputs): void;
  finalizeFromPersistedResults(): Promise<boolean>;
}

type ExperimentRunnerFactory = (
  context: Context,
  snapshot: ExperimentSnapshotInterface,
  integration: SourceIntegrationInterface,
) => FinalizableExperimentRunner;

/**
 * Mirrors the live construction switch in services/experiments.ts, keyed by the
 * runnerKind persisted on the snapshot (absent means a legacy "results"
 * snapshot). A kind is only listed once its runner supports prepareAnalysisData.
 */
const experimentRunnerFactories: Partial<
  Record<SnapshotQueryRunnerKind, ExperimentRunnerFactory>
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
 * Finalizes a stalled snapshot from its persisted query results. Returns false
 * when the snapshot is not eligible, so the caller can fail it instead.
 */
export async function recoverStalledSnapshot(
  context: Context,
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

  // Not getLatestSnapshotStatus: it returns the single most recent doc across
  // success, running and error, so a newer errored run would hide a newer
  // successful one behind it.
  const newer = await getLatestSuccessfulSnapshot({
    context,
    experiment: snapshot.experiment,
    phase: snapshot.phase,
    dimension: snapshot.dimension ?? undefined,
    type: snapshot.type,
  });
  if (newer && newer.dateCreated > snapshot.dateCreated) {
    logger.info(
      `Not recovering stalled snapshot ${snapshot.id}: superseded by newer successful snapshot ${newer.id}`,
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
    experimentQueryMetadata: null,
  });
  return runner.finalizeFromPersistedResults();
}
