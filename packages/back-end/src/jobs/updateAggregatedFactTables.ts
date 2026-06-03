import Agenda, { Job } from "agenda";
import uniqid from "uniqid";
import { isRatioMetric, isRegressionAdjusted } from "shared/experiments";
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
import { AggregatedFactTableQueryRunner } from "back-end/src/queryRunners/AggregatedFactTableQueryRunner";

const QUEUE_AGGREGATED_FACT_TABLE_UPDATES = "queueAggregatedFactTableUpdates";
const UPDATE_SINGLE_AGGREGATED_FACT_TABLE = "updateSingleAggregatedFactTable";

type UpdateSingleAggregatedFactTableJob = Job<{
  organization: string;
  factTableId: string;
  idType: string;
  forceRestate?: boolean;
}>;

export default async function (agenda: Agenda) {
  agenda.define(QUEUE_AGGREGATED_FACT_TABLE_UPDATES, async () => {
    const factTables = await getAllFactTablesWithAggregatedTablesEnabled();

    // TODO(aggregated-fact-tables): remove debug logging before merging
    logger.info(
      { factTableCount: factTables.length },
      "[aggregated-fact-table] poller found fact tables with aggregated tables enabled",
    );

    for (const factTable of factTables) {
      for (const idType of factTable.aggregatedFactTableIdTypes ?? []) {
        // TODO(aggregated-fact-tables): remove debug logging before merging
        logger.info(
          {
            organization: factTable.organization,
            factTableId: factTable.id,
            idType,
          },
          "[aggregated-fact-table] poller enqueuing worker",
        );
        await queueAggregatedFactTableUpdate({
          organization: factTable.organization,
          factTableId: factTable.id,
          idType,
        });
      }
    }
  });

  agenda.define(
    UPDATE_SINGLE_AGGREGATED_FACT_TABLE,
    updateSingleAggregatedFactTable,
  );

  await startUpdateJob();

  async function startUpdateJob() {
    const updateJob = agenda.create(QUEUE_AGGREGATED_FACT_TABLE_UPDATES, {});
    updateJob.unique({});
    updateJob.repeatEvery("24 hours");
    await updateJob.save();
  }
}

// Enqueue a single (org, factTable, idType) worker run. Exported so the
// force refresh/restate back door can enqueue on-demand runs.
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

// The next time the nightly poller is scheduled to run (i.e. when the next
// round of aggregated fact table updates will be enqueued). Global across the
// instance, not per fact table. Returns null if the job hasn't been scheduled.
export async function getNextAggregatedFactTableUpdate(): Promise<Date | null> {
  const agenda = getAgendaInstance();
  const job = await agenda._collection.findOne(
    { name: QUEUE_AGGREGATED_FACT_TABLE_UPDATES },
    { projection: { nextRunAt: 1 } },
  );
  return job?.nextRunAt ?? null;
}

// Fact metrics whose materialized columns live in this fact table: the metric
// is regression-adjustment eligible (CUPED is the consumer) and at least one of
// its column refs points at this fact table.
export function getMetricsForAggregatedFactTable(
  factMetrics: FactMetricInterface[],
  factTableId: string,
): FactMetricInterface[] {
  return factMetrics.filter((metric) => {
    const referencesFactTable =
      metric.numerator.factTableId === factTableId ||
      (isRatioMetric(metric) &&
        metric.denominator?.factTableId === factTableId);
    return referencesFactTable && isRegressionAdjusted(metric);
  });
}

const updateSingleAggregatedFactTable = async (
  job: UpdateSingleAggregatedFactTableJob,
) => {
  const { organization, factTableId, idType, forceRestate } =
    job.attrs.data ?? {};

  if (!organization || !factTableId || !idType) return;

  // TODO(aggregated-fact-tables): remove debug logging before merging
  logger.info(
    { organization, factTableId, idType, forceRestate: !!forceRestate },
    "[aggregated-fact-table] worker started",
  );

  const context = await getContextForAgendaJobByOrgId(organization);

  if (!context.hasPremiumFeature("pipeline-mode")) {
    // TODO(aggregated-fact-tables): remove debug logging before merging
    logger.info(
      { organization, factTableId, idType },
      "[aggregated-fact-table] worker skipped: no pipeline-mode premium feature",
    );
    return;
  }

  const factTable = await getFactTable(context, factTableId);
  if (!factTable) return;

  // The setting may have been removed for this id type since the job was queued
  if (!factTable.aggregatedFactTableIdTypes?.includes(idType)) {
    // TODO(aggregated-fact-tables): remove debug logging before merging
    logger.info(
      { organization, factTableId, idType },
      "[aggregated-fact-table] worker skipped: id type no longer enabled",
    );
    return;
  }

  await runAggregatedFactTableUpdate(context, factTable, idType, {
    forceRestate: !!forceRestate,
  });
};

// Shared materialization driver used by both the nightly worker and the
// force refresh/restate back door.
export async function runAggregatedFactTableUpdate(
  context: ReqContext,
  factTable: FactTableInterface,
  idType: string,
  {
    forceRestate,
    // When true (the nightly agenda worker), block until the queries finish so
    // the job stays alive. When false (the manual UI trigger), return as soon
    // as the run doc + queries are created and finish in the background.
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
  const metrics = getMetricsForAggregatedFactTable(factMetrics, factTable.id);
  if (!metrics.length) {
    logger.info(
      `Skipping aggregated fact table update for ${factTable.id}/${idType}: no regression-adjusted fact metrics reference this fact table`,
    );
    return;
  }

  // TODO(aggregated-fact-tables): remove debug logging before merging
  logger.info(
    {
      factTableId: factTable.id,
      idType,
      datasourceId: datasource.id,
      mode: forceRestate ? "restate" : "incremental",
      metricCount: metrics.length,
      metricIds: metrics.map((m) => m.id),
    },
    "[aggregated-fact-table] driver selected metrics, acquiring lock",
  );

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
    logger.info(
      `Aggregated fact table update for ${factTable.id}/${idType} already in progress; skipping`,
    );
    return;
  }

  // TODO(aggregated-fact-tables): remove debug logging before merging
  logger.info(
    { factTableId: factTable.id, idType, executionId },
    "[aggregated-fact-table] lock acquired, starting query runner",
  );

  const mode = forceRestate ? "restate" : "incremental";

  const registry = await context.models.aggregatedFactTables.getByKey(key);
  if (!registry) {
    // We acquired the lock but the registry doc vanished; release it so the
    // next run isn't blocked.
    await context.models.aggregatedFactTables.releaseLock(key, executionId);
    throw new Error(
      "Aggregated fact table registry doc missing after acquiring lock",
    );
  }

  // Each materialization run gets its own document (the QueryRunner model) so
  // run history can be referenced later. The durable registry is updated when
  // the run finishes.
  const run = await context.models.aggregatedFactTableRuns.create({
    aggregatedFactTableId: registry.id,
    datasourceId: datasource.id,
    factTableId: factTable.id,
    idType,
    mode,
    queries: [],
    runStarted: null,
    finishedAt: null,
    error: null,
    result: null,
  });

  // Records the failure on the run doc + registry and releases the lock so the
  // next run can retry. The watermark is left untouched, so a failed/partial
  // run self-heals next time.
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

  // Kick off the queries: submits them to the warehouse and persists the run
  // doc with its query pointers. Returns before the queries finish.
  try {
    await runner.startAnalysis({
      factTable,
      idType,
      metrics,
      mode,
      executionId,
      aggregatedFactTable: registry,
    });
  } catch (e) {
    await handleFailure(e);
    return;
  }

  // Poll the queries to completion and finalize the registry (the runner's
  // updateModel releases the lock on a terminal status).
  const waitForCompletion = async () => {
    try {
      await runner.waitForResults();
      logger.info(
        `Updated aggregated fact table ${factTable.id}/${idType} (${mode})`,
      );
    } catch (e) {
      await handleFailure(e);
    }
  };

  if (awaitResults) {
    await waitForCompletion();
  } else {
    // Manual UI trigger: the run doc + queries already exist, so return now and
    // let the materialization finish in the background.
    void waitForCompletion();
  }
}
