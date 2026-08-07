import uniqid from "uniqid";
import { getAutoSliceMetrics, isRatioMetric } from "shared/experiments";
import { DataSourceInterface } from "shared/types/datasource";
import {
  FactMetricInterface,
  FactTableInterface,
} from "shared/types/fact-table";
import {
  AggregatedFactTableInterface,
  AggregatedFactTableMetricStateInterface,
  AggregatedFactTableRunInterface,
  AggregatedTableRefreshSkipReason,
} from "shared/validators";
import { QueryStatus } from "shared/types/query";
import { ReqContext } from "back-end/types/request";
import { ApiReqContext } from "back-end/types/api";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import { getSourceIntegrationObject } from "back-end/src/services/datasource";
import { logger } from "back-end/src/util/logger";
import { getMostRecentUpdateOccurrence } from "back-end/src/util/factTable";
import {
  AggregatedFactTableQueryRunner,
  AggregatedFactTableRunMode,
} from "back-end/src/queryRunners/AggregatedFactTableQueryRunner";
import {
  AggregatedFactTableRestateReason,
  buildAggregatedFactTableSchemaState,
  getAggregatedFactTableRestateReason,
} from "back-end/src/enterprise/services/data-pipeline";

type AggregatedFactTableRestateLogReason =
  | "forced"
  | "no-existing-table"
  | "incomplete-write"
  | "schema-drift"
  | null;

function resolveAggregatedFactTableRestateLogReason({
  mode,
  forceRestate,
  hasExistingTable,
  restateReason,
}: {
  mode: AggregatedFactTableRunMode;
  forceRestate: boolean;
  hasExistingTable: boolean;
  restateReason: AggregatedFactTableRestateReason;
}): AggregatedFactTableRestateLogReason {
  if (mode === "incremental") return null;
  if (forceRestate) return "forced";
  if (!hasExistingTable) return "no-existing-table";
  return restateReason ?? "schema-drift";
}

function createAggregatedFactTableUpdateExecutionLogger(meta: {
  organization: string;
  datasource: Pick<DataSourceInterface, "id" | "type">;
  aggregatedFactTableId: string;
  factTableId: string;
  idType: string;
  runId: string;
  executionId: string;
  mode: AggregatedFactTableRunMode;
  restateReason: AggregatedFactTableRestateLogReason;
}) {
  const startedAtMs = Date.now();
  let logged = false;

  return {
    logUpdateCompleted(
      context: ReqContext,
      {
        status,
        error,
      }: {
        status: "success" | "error";
        error?: string;
      },
    ): void {
      if (logged) return;
      logged = true;
      context.logger.info(
        {
          event: "aggregated_fact_table_updated",
          organization: meta.organization,
          datasourceId: meta.datasource.id,
          datasourceType: meta.datasource.type,
          aggregatedFactTableId: meta.aggregatedFactTableId,
          factTableId: meta.factTableId,
          idType: meta.idType,
          runId: meta.runId,
          executionId: meta.executionId,
          mode: meta.mode,
          restate: meta.mode === "restate",
          restateReason: meta.restateReason,
          status,
          error: error || null,
          durationMs: Date.now() - startedAtMs,
        },
        "Aggregated fact table update completed",
      );
    },
  };
}

export type AggregatedFactTableMaterializationStatus =
  | "running"
  | "error"
  | "pending"
  | "active";

export type AggregatedFactTableStatus = {
  idType: string;
  status: AggregatedFactTableMaterializationStatus;
  tableFullName: string | null;
  firstEventDate: Date | null;
  lastEventDate: Date | null;
  lastMaxTimestamp: Date | null;
  lastError: string | null;
  dateUpdated: Date | null;
  pendingRestate: boolean;
  pendingRestateReason: AggregatedFactTableRestateReason;
};

export function getMetricsForAggregatedFactTable(
  factMetrics: FactMetricInterface[],
  factTableId: string,
): FactMetricInterface[] {
  return factMetrics.filter((metric) => {
    if (metric.archived) return false;
    const referencesFactTable =
      metric.numerator.factTableId === factTableId ||
      (isRatioMetric(metric) &&
        metric.denominator?.factTableId === factTableId);
    return referencesFactTable;
  });
}

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

/**
 * Claims the current slot for each enabled id type on a new fact table so the
 * first aggregation waits for the next updateTime instead of restating right
 * after creation.
 *
 * No-op unless aggregation is already enabled.
 */
export async function deferAggregatedFactTableToNextSlot(
  context: ReqContext | ApiReqContext,
  factTable: Pick<
    FactTableInterface,
    "id" | "datasource" | "aggregatedFactTableSettings"
  >,
) {
  const settings = factTable.aggregatedFactTableSettings;
  if (!settings?.idTypes?.length) return;
  if (!context.hasPremiumFeature("pipeline-mode")) return;

  let fireTime: Date;
  try {
    fireTime = getMostRecentUpdateOccurrence(settings.updateTime);
  } catch (e) {
    logger.error(
      e,
      `Invalid aggregatedFactTableSettings.updateTime for fact table ${factTable.id}; skipping schedule seed`,
    );
    return;
  }

  for (const idType of settings.idTypes) {
    try {
      const claimed =
        await context.models.aggregatedFactTables.claimScheduledSlot(
          {
            datasourceId: factTable.datasource,
            factTableId: factTable.id,
            idType,
          },
          fireTime,
        );
      if (!claimed) {
        logger.debug(
          `Aggregated fact table slot for ${factTable.id}/${idType} was already claimed for ${fireTime.toISOString()}; deferral had no effect`,
        );
      }
    } catch (e) {
      logger.error(
        e,
        `Failed to seed aggregated fact table slot for ${factTable.id}/${idType}`,
      );
    }
  }
}

export function getAggregatedFactTableMaterializationStatus(
  doc: AggregatedFactTableInterface | undefined,
): AggregatedFactTableMaterializationStatus {
  if (!doc) return "pending";
  if (doc.currentExecutionId) return "running";
  if (doc.lastError) return "error";
  if (doc.tableFullName) return "active";
  return "pending";
}

export function buildAggregatedFactTableStatus({
  idType,
  doc,
  factTableSettingsHash,
  factTableNonSqlSettingsHash,
  factTableColumnsFingerprint,
  metricState,
}: {
  idType: string;
  doc: AggregatedFactTableInterface | undefined;
  factTableSettingsHash: string;
  factTableNonSqlSettingsHash?: string;
  factTableColumnsFingerprint?: string | null;
  metricState: AggregatedFactTableMetricStateInterface[];
}): AggregatedFactTableStatus {
  const status = getAggregatedFactTableMaterializationStatus(doc);

  const pendingRestateReason: AggregatedFactTableRestateReason =
    doc && status !== "running"
      ? getAggregatedFactTableRestateReason({
          registry: doc,
          factTableSettingsHash,
          factTableNonSqlSettingsHash,
          factTableColumnsFingerprint,
          metricState,
        })
      : null;

  return {
    idType,
    status,
    tableFullName: doc?.tableFullName ?? null,
    firstEventDate: doc?.firstEventDate ?? null,
    lastEventDate: doc?.lastEventDate ?? null,
    lastMaxTimestamp: doc?.lastMaxTimestamp ?? null,
    lastError: doc?.lastError ?? null,
    dateUpdated: doc?.dateUpdated ?? null,
    pendingRestate: pendingRestateReason !== null,
    pendingRestateReason,
  };
}

export function deriveAggregatedFactTableRunStatus(
  queries: { status: QueryStatus }[],
  error: string | null,
): QueryStatus {
  // A recorded error is terminal; surface as failed even if query pointers are
  // stale (e.g. a run finalized out-of-process by the expireOldQueries reaper).
  if (error) return "failed";

  const total = queries.length;
  if (!total) return "queued";

  const failed = queries.filter((q) => q.status === "failed").length;
  const running = queries.filter((q) => q.status === "running").length;
  const queued = queries.filter((q) => q.status === "queued").length;

  if (queued + running > 0) return "running";
  if (failed > 0) return "failed";
  return "succeeded";
}

export function toAggregatedTableRunSummaryApiInterface(
  run: AggregatedFactTableRunInterface,
) {
  return {
    id: run.id,
    idType: run.idType,
    mode: run.mode,
    status: deriveAggregatedFactTableRunStatus(run.queries, run.error),
    runStarted: run.runStarted?.toISOString() ?? null,
    dateCreated: run.dateCreated.toISOString(),
    finishedAt: run.finishedAt?.toISOString() ?? null,
    error: run.error,
    queryIds: run.queries.map((q) => q.query),
  };
}

export function toAggregatedTableRunApiInterface(
  run: AggregatedFactTableRunInterface,
) {
  return {
    ...toAggregatedTableRunSummaryApiInterface(run),
    factTableId: run.factTableId,
    datasourceId: run.datasourceId,
    result: run.result
      ? {
          lastMaxTimestamp: run.result.lastMaxTimestamp?.toISOString() ?? null,
          firstEventDate: run.result.firstEventDate?.toISOString() ?? null,
          lastEventDate: run.result.lastEventDate?.toISOString() ?? null,
        }
      : null,
  };
}

export type AggregatedFactTableUpdateOutcome =
  | { status: "started"; runId: string }
  | { status: "failed"; runId: string; error: string }
  | { status: "skipped"; reason: AggregatedTableRefreshSkipReason };

export function toAggregatedTableRefreshTriggerResult(
  idType: string,
  outcome: AggregatedFactTableUpdateOutcome,
) {
  return {
    idType,
    runId:
      outcome.status === "started" || outcome.status === "failed"
        ? outcome.runId
        : null,
    status: outcome.status,
    reason: outcome.status === "skipped" ? outcome.reason : null,
    error: outcome.status === "failed" ? outcome.error : null,
  };
}

export async function runAggregatedFactTableUpdate(
  context: ReqContext,
  factTable: FactTableInterface,
  idType: string,
  {
    forceRestate,
    // true (nightly worker): block until queries finish. false (manual UI trigger): return after creating the run and finish in the background.
    awaitResults = false,
  }: { forceRestate: boolean; awaitResults?: boolean },
): Promise<AggregatedFactTableUpdateOutcome> {
  const datasource = await getDataSourceById(context, factTable.datasource);
  if (!datasource) {
    return { status: "skipped", reason: "datasource-not-found" };
  }

  const pipelineSettings = datasource.settings.pipelineSettings;
  if (!pipelineSettings?.writeDataset) {
    logger.warn(
      `Skipping aggregated fact table update for ${factTable.id}/${idType}: data source ${datasource.id} has no pipeline write dataset configured`,
    );
    return { status: "skipped", reason: "pipeline-not-configured" };
  }

  const integration = getSourceIntegrationObject(context, datasource, true);
  if (!integration.generateTablePath) {
    logger.warn(
      `Skipping aggregated fact table update for ${factTable.id}/${idType}: data source ${datasource.id} does not support writing tables`,
    );
    return { status: "skipped", reason: "unsupported-datasource" };
  }

  const factMetrics = await context.models.factMetrics.getAll();
  const metrics = getAggregatedFactTableMetrics({ factMetrics, factTable });
  if (!metrics.length) {
    logger.debug(
      `Skipping aggregated fact table update for ${factTable.id}/${idType}: no regression-adjusted fact metrics reference this fact table`,
    );
    return { status: "skipped", reason: "no-eligible-metrics" };
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
    return { status: "skipped", reason: "already-in-progress" };
  }

  const registry = await context.models.aggregatedFactTables.getByKey(key);
  if (!registry) {
    await context.models.aggregatedFactTables.releaseLock(key, executionId);
    throw new Error(
      "Aggregated fact table registry doc missing after acquiring lock",
    );
  }

  const {
    factTableSettingsHash,
    factTableNonSqlSettingsHash,
    factTableColumnsFingerprint,
    metricState,
  } = buildAggregatedFactTableSchemaState({ factTable, metrics });

  const restateReason = getAggregatedFactTableRestateReason({
    registry,
    factTableSettingsHash,
    factTableNonSqlSettingsHash,
    factTableColumnsFingerprint,
    metricState,
  });
  const mode: AggregatedFactTableRunMode =
    forceRestate || !registry.tableFullName || restateReason !== null
      ? "restate"
      : "incremental";

  // Observability: log when a SQL-text change was tolerated so operators can
  // audit and force-restate if the edit was value-affecting.
  if (
    mode === "incremental" &&
    factTableSettingsHash !== registry.factTableSettingsHash
  ) {
    logger.info(
      {
        event: "aggregated_fact_table_sql_drift_tolerated",
        organization: context.org.id,
        factTableId: factTable.id,
        idType,
        registryFactTableSettingsHash: registry.factTableSettingsHash,
        newFactTableSettingsHash: factTableSettingsHash,
      },
      "Aggregated fact table SQL text changed but output schema is unchanged; skipping restate",
    );
  }

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

  const executionLogger = createAggregatedFactTableUpdateExecutionLogger({
    organization: context.org.id,
    datasource: { id: datasource.id, type: datasource.type },
    aggregatedFactTableId: registry.id,
    factTableId: factTable.id,
    idType,
    runId: run.id,
    executionId,
    mode,
    restateReason: resolveAggregatedFactTableRestateLogReason({
      mode,
      forceRestate,
      hasExistingTable: !!registry.tableFullName,
      restateReason,
    }),
  });

  const handleFailure = async (e: unknown) => {
    const message = e instanceof Error ? e.message : String(e);
    logger.error(
      e,
      `Failed to update aggregated fact table for ${factTable.id}/${idType}`,
    );
    executionLogger.logUpdateCompleted(context, {
      status: "error",
      error: message,
    });
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
    return message;
  };

  const runner = new AggregatedFactTableQueryRunner(
    context,
    run,
    integration,
    false,
  );

  try {
    await runner.startAnalysis({
      factTable,
      idType,
      metrics,
      mode,
      executionId,
      aggregatedFactTable: registry,
      factTableSettingsHash,
      factTableNonSqlSettingsHash,
      factTableColumnsFingerprint,
      metricState,
      lookbackWindowDays:
        factTable.aggregatedFactTableSettings?.lookbackWindow ?? 60,
    });
  } catch (e) {
    const error = await handleFailure(e);
    return { status: "failed", runId: run.id, error };
  }

  const waitForCompletion = async () => {
    try {
      await runner.waitForResults();
      executionLogger.logUpdateCompleted(context, { status: "success" });
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
    void waitForCompletion();
  }

  return { status: "started", runId: run.id };
}
