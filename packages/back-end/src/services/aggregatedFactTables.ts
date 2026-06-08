import uniqid from "uniqid";
import { getAutoSliceMetrics, isRatioMetric } from "shared/experiments";
import {
  FactMetricInterface,
  FactTableInterface,
} from "shared/types/fact-table";
import {
  AggregatedFactTableInterface,
  AggregatedFactTableMetricStateInterface,
} from "shared/validators";
import { ReqContext } from "back-end/types/request";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import { getSourceIntegrationObject } from "back-end/src/services/datasource";
import { logger } from "back-end/src/util/logger";
import {
  AggregatedFactTableQueryRunner,
  AggregatedFactTableRunMode,
} from "back-end/src/queryRunners/AggregatedFactTableQueryRunner";
import {
  AggregatedFactTableRestateReason,
  buildAggregatedFactTableSchemaState,
  getAggregatedFactTableRestateReason,
} from "back-end/src/enterprise/services/data-pipeline";

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
  metricState,
}: {
  idType: string;
  doc: AggregatedFactTableInterface | undefined;
  factTableSettingsHash: string;
  metricState: AggregatedFactTableMetricStateInterface[];
}): AggregatedFactTableStatus {
  const status = getAggregatedFactTableMaterializationStatus(doc);

  const pendingRestateReason: AggregatedFactTableRestateReason =
    doc && status !== "running"
      ? getAggregatedFactTableRestateReason({
          registry: doc,
          factTableSettingsHash,
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

export async function runAggregatedFactTableUpdate(
  context: ReqContext,
  factTable: FactTableInterface,
  idType: string,
  {
    forceRestate,
    // true (nightly worker): block until queries finish. false (manual UI trigger): return after creating the run and finish in the background.
    awaitResults = false,
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
    await context.models.aggregatedFactTables.releaseLock(key, executionId);
    throw new Error(
      "Aggregated fact table registry doc missing after acquiring lock",
    );
  }

  const { factTableSettingsHash, metricState } =
    buildAggregatedFactTableSchemaState({ factTable, metrics });

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
    void waitForCompletion();
  }
}
