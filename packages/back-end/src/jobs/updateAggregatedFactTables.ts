import Agenda, { Job } from "agenda";
import uniqid from "uniqid";
import { getAutoSliceMetrics, isRatioMetric } from "shared/experiments";
import {
  FactMetricInterface,
  FactTableInterface,
} from "shared/types/fact-table";
import { ReqContext } from "back-end/types/request";
import {
  getAllFactTablesWithAggregatedTablesEnabled,
  getFactTable,
} from "back-end/src/models/FactTableModel";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import { getSourceIntegrationObject } from "back-end/src/services/datasource";
import { getContextForAgendaJobByOrgId } from "back-end/src/services/organizations";
import { getAgendaInstance } from "back-end/src/services/queueing";
import { logger } from "back-end/src/util/logger";
import {
  AggregatedFactTableQueryRunner,
  AggregatedFactTableRunMode,
} from "back-end/src/queryRunners/AggregatedFactTableQueryRunner";
import {
  buildAggregatedFactTableSchemaState,
  getAggregatedFactTableRestateReason,
} from "back-end/src/enterprise/services/data-pipeline";
import { getMostRecentUpdateOccurrence } from "back-end/src/util/factTable";

const QUEUE_AGGREGATED_FACT_TABLE_UPDATES = "queueAggregatedFactTableUpdates";
const UPDATE_SINGLE_AGGREGATED_FACT_TABLE = "updateSingleAggregatedFactTable";

type UpdateSingleAggregatedFactTableJob = Job<{
  organization: string;
  factTableId: string;
  idType: string;
  forceRestate?: boolean;
}>;

export default async function (agenda: Agenda) {
  agenda.define(QUEUE_AGGREGATED_FACT_TABLE_UPDATES, pollAggregatedFactTables);

  agenda.define(
    UPDATE_SINGLE_AGGREGATED_FACT_TABLE,
    updateSingleAggregatedFactTable,
  );

  await startUpdateJob();

  async function startUpdateJob() {
    const updateJob = agenda.create(QUEUE_AGGREGATED_FACT_TABLE_UPDATES, {});
    updateJob.unique({});
    // Frequent poller: each table fires once per day at its own updateTime. The
    // claimScheduledSlot gate keeps the short interval from re-enqueueing a slot.
    updateJob.repeatEvery("1 minutes");
    await updateJob.save();
  }
}

type AgendaJobContext = Awaited<
  ReturnType<typeof getContextForAgendaJobByOrgId>
>;

// Runs every minute. For each fact table with aggregated settings, computes the
// most recent occurrence of its daily updateTime and atomically claims that
// slot per id type; only newly-claimed slots are enqueued, so a given day's run
// is enqueued exactly once even though the poller fires every minute.
async function pollAggregatedFactTables() {
  const factTables = await getAllFactTablesWithAggregatedTablesEnabled();
  const now = new Date();
  const contextCache = new Map<string, AgendaJobContext | null>();

  const getContext = async (
    organization: string,
  ): Promise<AgendaJobContext | null> => {
    if (contextCache.has(organization)) {
      return contextCache.get(organization) ?? null;
    }
    let context: AgendaJobContext | null = null;
    try {
      context = await getContextForAgendaJobByOrgId(organization);
      if (!context.hasPremiumFeature("pipeline-mode")) {
        context = null;
      }
    } catch (e) {
      logger.error(
        e,
        `Failed to load context for org ${organization} in aggregated fact table poller`,
      );
      context = null;
    }
    contextCache.set(organization, context);
    return context;
  };

  for (const factTable of factTables) {
    const settings = factTable.aggregatedFactTableSettings;
    if (!settings?.idTypes?.length) continue;

    let fireTime: Date;
    try {
      fireTime = getMostRecentUpdateOccurrence(settings.updateTime, now);
    } catch (e) {
      logger.error(
        e,
        `Invalid aggregatedFactTableSettings.updateTime for fact table ${factTable.id}`,
      );
      continue;
    }

    const context = await getContext(factTable.organization);
    if (!context) continue;

    for (const idType of settings.idTypes) {
      const key = {
        datasourceId: factTable.datasource,
        factTableId: factTable.id,
        idType,
      };
      let claimed = false;
      try {
        claimed = await context.models.aggregatedFactTables.claimScheduledSlot(
          key,
          fireTime,
        );
      } catch (e) {
        logger.error(
          e,
          `Failed to claim aggregated fact table slot for ${factTable.id}/${idType}`,
        );
        continue;
      }
      if (!claimed) continue;

      await queueAggregatedFactTableUpdate({
        organization: factTable.organization,
        factTableId: factTable.id,
        idType,
      });
    }
  }
}

// Enqueue a single (org, factTable, idType) worker run; exported for the force refresh/restate back door.
export async function queueAggregatedFactTableUpdate({
  organization,
  factTableId,
  idType,
  forceRestate,
}: {
  organization: string;
  factTableId: string;
  idType: string;
  forceRestate?: boolean;
}) {
  const agenda = getAgendaInstance();
  const job = agenda.create(UPDATE_SINGLE_AGGREGATED_FACT_TABLE, {
    organization,
    factTableId,
    idType,
    forceRestate: forceRestate ?? false,
  });
  job.unique({
    organization,
    factTableId,
    idType,
  });
  job.schedule(new Date());
  await job.save();
}

// Fact metrics whose materialized columns live in this fact table
export function getMetricsForAggregatedFactTable(
  factMetrics: FactMetricInterface[],
  factTableId: string,
): FactMetricInterface[] {
  return factMetrics.filter((metric) => {
    const referencesFactTable =
      metric.numerator.factTableId === factTableId ||
      (isRatioMetric(metric) &&
        metric.denominator?.factTableId === factTableId);
    return referencesFactTable;
  });
}

// The full flattened metric set the aggregated table materializes: base metrics
// referencing the fact table plus their auto-slice variants. The nightly driver
// and the status endpoint both use this so they agree on the schema state (and
// therefore on drift verdicts).
export function getAggregatedFactTableMetrics({
  factMetrics,
  factTable,
}: {
  factMetrics: FactMetricInterface[];
  factTable: FactTableInterface;
}): FactMetricInterface[] {
  const baseMetrics = getMetricsForAggregatedFactTable(
    factMetrics,
    factTable.id,
  );
  return baseMetrics.flatMap((metric) => [
    metric,
    ...getAutoSliceMetrics({ metric, factTable }),
  ]);
}

const updateSingleAggregatedFactTable = async (
  job: UpdateSingleAggregatedFactTableJob,
) => {
  const { organization, factTableId, idType, forceRestate } =
    job.attrs.data ?? {};

  if (!organization || !factTableId || !idType) return;

  const context = await getContextForAgendaJobByOrgId(organization);

  if (!context.hasPremiumFeature("pipeline-mode")) {
    return;
  }

  const factTable = await getFactTable(context, factTableId);
  if (!factTable) return;

  // The setting may have been removed for this id type since the job was queued
  if (!factTable.aggregatedFactTableSettings?.idTypes?.includes(idType)) {
    return;
  }

  await runAggregatedFactTableUpdate(context, factTable, idType, {
    forceRestate: !!forceRestate,
  });
};

// Shared materialization driver for both the nightly worker and the force refresh/restate back door.
export async function runAggregatedFactTableUpdate(
  context: ReqContext,
  factTable: FactTableInterface,
  idType: string,
  {
    forceRestate,
    // true (nightly worker): block until queries finish. false (manual UI trigger): return after creating the run and finish in the background.
    awaitResults = true,
  }: { forceRestate: boolean; awaitResults?: boolean },
): Promise<void> {
  const datasource = await getDataSourceById(context, factTable.datasource);
  if (!datasource) return;

  const pipelineSettings = datasource.settings.pipelineSettings;
  if (!pipelineSettings?.writeDataset) {
    logger.warn(
      `Skipping aggregated fact table update for ${factTable.id}/${idType}: data source ${datasource.id} has no pipeline write dataset configured`,
    );
    return;
  }

  const integration = getSourceIntegrationObject(context, datasource, true);
  if (!integration.generateTablePath) {
    logger.warn(
      `Skipping aggregated fact table update for ${factTable.id}/${idType}: data source ${datasource.id} does not support writing tables`,
    );
    return;
  }

  const factMetrics = await context.models.factMetrics.getAll();
  const metrics = getAggregatedFactTableMetrics({ factMetrics, factTable });
  if (!metrics.length) {
    logger.debug(
      `Skipping aggregated fact table update for ${factTable.id}/${idType}: no regression-adjusted fact metrics reference this fact table`,
    );
    return;
  }

  const key = {
    datasourceId: datasource.id,
    factTableId: factTable.id,
    idType,
  };

  const executionId = uniqid("aftexec_");
  const locked = await context.models.aggregatedFactTables.acquireLock(
    key,
    executionId,
  );
  if (!locked) {
    logger.debug(
      `Aggregated fact table update for ${factTable.id}/${idType} already in progress; skipping`,
    );
    return;
  }

  const registry = await context.models.aggregatedFactTables.getByKey(key);
  if (!registry) {
    // Lock acquired but the registry doc vanished; release it so the next run isn't blocked.
    await context.models.aggregatedFactTables.releaseLock(key, executionId);
    throw new Error(
      "Aggregated fact table registry doc missing after acquiring lock",
    );
  }

  // Schema state this run will persist; also feeds drift detection below.
  const { factTableSettingsHash, metricState } =
    buildAggregatedFactTableSchemaState({ factTable, metrics });

  // Resolve the effective mode here (the runner is a dumb executor of it). A
  // never-materialized table, an explicit restate request, schema drift, or an
  // incomplete prior write (in-flight marker still set) all force a full
  // rebuild; otherwise we incrementally append.
  const restateReason = getAggregatedFactTableRestateReason({
    registry,
    factTableSettingsHash,
    metricState,
  });
  const mode: AggregatedFactTableRunMode =
    forceRestate || !registry.tableFullName || restateReason !== null
      ? "restate"
      : "incremental";
  if (restateReason) {
    logger.info(
      { factTableId: factTable.id, idType, restateReason },
      "[aggregated-fact-table] forcing restate",
    );
  }

  // Each run gets its own doc so run history can be referenced later; the registry is updated when the run finishes.
  const run = await context.models.aggregatedFactTableRuns.create({
    aggregatedFactTableId: registry.id,
    datasourceId: datasource.id,
    factTableId: factTable.id,
    idType,
    mode,
    executionId,
    queries: [],
    runStarted: null,
    finishedAt: null,
    error: null,
    result: null,
  });

  // Record the failure and release the lock; the watermark is left untouched so
  // the next run self-heals.
  const handleFailure = async (e: unknown) => {
    const message = e instanceof Error ? e.message : String(e);
    logger.error(
      e,
      `Failed to update aggregated fact table for ${factTable.id}/${idType}`,
    );
    try {
      await context.models.aggregatedFactTableRuns.updateRunFields(run.id, {
        error: message,
        finishedAt: new Date(),
      });
      await context.models.aggregatedFactTables.updateByKeyIfCurrentExecution(
        key,
        executionId,
        { lastError: message, lastRunId: run.id },
      );
      await context.models.aggregatedFactTables.releaseLock(key, executionId);
    } catch (cleanupError) {
      logger.error(
        cleanupError,
        `Failed to record error for aggregated fact table ${factTable.id}/${idType}`,
      );
    }
  };

  const runner = new AggregatedFactTableQueryRunner(
    context,
    run,
    integration,
    false,
  );

  // Kick off the queries (submitted to the warehouse); returns before they finish.
  try {
    await runner.startAnalysis({
      factTable,
      idType,
      metrics,
      mode,
      executionId,
      aggregatedFactTable: registry,
      factTableSettingsHash,
      metricState,
      lookbackWindowDays:
        factTable.aggregatedFactTableSettings?.lookbackWindow ?? 60,
    });
  } catch (e) {
    await handleFailure(e);
    return;
  }

  // Poll to completion and finalize; the runner's updateModel releases the lock on a terminal status.
  const waitForCompletion = async () => {
    try {
      await runner.waitForResults();
      logger.debug(
        `Updated aggregated fact table ${factTable.id}/${idType} (${mode})`,
      );
    } catch (e) {
      await handleFailure(e);
    }
  };

  if (awaitResults) {
    await waitForCompletion();
  } else {
    // Manual UI trigger: return now and let materialization finish in the background.
    void waitForCompletion();
  }
}
