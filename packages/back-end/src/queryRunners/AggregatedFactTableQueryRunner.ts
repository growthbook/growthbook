import {
  getAutoSliceMetrics,
  isRatioMetric,
  quantileMetricType,
} from "shared/experiments";
import {
  AggregatedFactTableInterface,
  AggregatedFactTableMetricStateInterface,
  AggregatedFactTableRunInterface,
} from "shared/validators";
import { Queries, QueryPointer, QueryStatus } from "shared/types/query";
import { UpdateProps } from "shared/types/base-model";
import {
  FactMetricInterface,
  FactTableInterface,
} from "shared/types/fact-table";
import {
  getFactTableSettingsHashForAggregatedFactTable,
  getMetricSettingsHashForAggregatedFactTable,
} from "back-end/src/enterprise/services/data-pipeline";
import { encodeMetricIdForColumnName } from "back-end/src/integrations/sql/fact-metrics/encode-metric-id-for-column-name";
import { AggregatedFactTableKey } from "back-end/src/models/AggregatedFactTableModel";
import { QueryRunner, QueryMap } from "./QueryRunner";

export const AGGREGATED_FACT_TABLE_PREFIX = "gb_aggregated";

// TODO LOOKBACK
export const AGGREGATED_FACT_TABLE_MAX_RESTATE_DAYS = 900;

export type AggregatedFactTableRunMode = "incremental" | "restate";

export type AggregatedFactTableQueryParams = {
  factTable: FactTableInterface;
  idType: string;
  metrics: FactMetricInterface[];
  // `restate` drops + recreates the table and re-scans the retained window.
  // `incremental` appends the new event slice since `lastMaxTimestamp`.
  mode: AggregatedFactTableRunMode;
  // The lock token held for this run; durable writes are gated on it.
  executionId: string;
  // Durable registry snapshot the worker already loaded. The runner reads prior
  // watermark/tableFullName from here (it operates on a per-run doc as its
  // model) and writes the final coverage back to the registry when the run ends.
  aggregatedFactTable: AggregatedFactTableInterface;
};

export type AggregatedFactTableResult = {
  lastMaxTimestamp: Date | null;
  firstEventDate: Date | null;
  lastEventDate: Date | null;
};

const MAX_TIMESTAMP_QUERY_NAME = "aggregated_fact_table_max_timestamp";

// Parse a single coverage row (from the max-timestamp watermark query) into the
// registry watermark fields. Exported as a pure helper for unit testing. A null
// `max_timestamp` means the table is empty (e.g. a restate that materialized no
// rows), in which case all coverage fields are null.
export function parseAggregatedFactTableCoverage(
  row: Record<string, unknown> | undefined,
): AggregatedFactTableResult {
  const toDate = (value: unknown): Date | null => {
    if (value === null || value === undefined) return null;
    const d = new Date(value as string);
    return isNaN(d.getTime()) ? null : d;
  };

  return {
    lastMaxTimestamp: toDate(row?.max_timestamp),
    firstEventDate: toDate(row?.first_event_date),
    lastEventDate: toDate(row?.last_event_date),
  };
}

// Warehouse-safe columns a metric materializes in this table (role-gated on
// the table's fact table), mirroring `getAggregatedFactTableSchema`.
export function getColumnsForMetric(
  metric: FactMetricInterface,
  factTableId: string,
): string[] {
  const enc = encodeMetricIdForColumnName(metric.id);
  const columns: string[] = [];
  if (metric.numerator.factTableId === factTableId) {
    columns.push(`${enc}_value`);
    if (quantileMetricType(metric) === "event") {
      columns.push(`${enc}_n_events`);
    }
  }
  if (
    isRatioMetric(metric) &&
    metric.denominator?.factTableId === factTableId
  ) {
    columns.push(`${enc}_denominator_value`);
  }
  return columns;
}

export class AggregatedFactTableQueryRunner extends QueryRunner<
  AggregatedFactTableRunInterface,
  AggregatedFactTableQueryParams,
  AggregatedFactTableResult
> {
  private params: AggregatedFactTableQueryParams | null = null;

  checkPermissions(): boolean {
    return this.context.permissions.canRunExperimentQueries(
      this.integration.datasource,
    );
  }

  private getKey(): AggregatedFactTableKey {
    return {
      datasourceId: this.model.datasourceId,
      factTableId: this.model.factTableId,
      idType: this.model.idType,
    };
  }

  protected override onHeartbeat(): void {
    if (!this.params) return;
    this.context.models.aggregatedFactTables
      .touchLockHeartbeat(this.getKey(), this.params.executionId)
      .catch((e) =>
        this.context.logger.warn(
          e,
          "Failed to refresh aggregated fact table lock heartbeat",
        ),
      );
  }

  async startQueries(params: AggregatedFactTableQueryParams): Promise<Queries> {
    this.params = params;
    const {
      factTable,
      idType,
      metrics,
      mode,
      executionId,
      aggregatedFactTable,
    } = params;
    const integration = this.integration;

    if (!integration.generateTablePath) {
      throw new Error(
        "Data source does not support generating table paths for aggregated fact tables.",
      );
    }

    // Expand each base metric into the flat list of metrics actually
    // materialized: the base metric plus any auto-slice variants. The schema /
    // insert / column builders all key off `metric.id`, so passing the expanded
    // list materializes one column group per (base metric, slice). Auto-slice
    // expansion is shared with the experiment analysis path (`getAutoSliceMetrics`)
    // and yields [] for metrics without configured auto slices.
    const materializedMetrics: FactMetricInterface[] = metrics.flatMap(
      (metric) => [metric, ...getAutoSliceMetrics({ metric, factTable })],
    );

    const pipelineSettings = integration.datasource.settings.pipelineSettings;

    // Reuse the existing table when present; otherwise generate a new path.
    const tableFullName =
      aggregatedFactTable.tableFullName ??
      integration.generateTablePath(
        `${AGGREGATED_FACT_TABLE_PREFIX}_${factTable.id}_${idType}`,
        pipelineSettings?.writeDataset,
        pipelineSettings?.writeDatabase,
        true,
      );

    // A table that has never been materialized must always do a full restate.
    const effectiveMode: AggregatedFactTableRunMode =
      mode === "restate" || !aggregatedFactTable.tableFullName
        ? "restate"
        : mode;

    // TODO(aggregated-fact-tables): remove debug logging before merging
    this.context.logger.info(
      {
        factTableId: factTable.id,
        idType,
        requestedMode: mode,
        effectiveMode,
        tableFullName,
        existingTableFullName: aggregatedFactTable.tableFullName,
        lastMaxTimestamp: aggregatedFactTable.lastMaxTimestamp,
        metricCount: metrics.length,
        metricIds: metrics.map((m) => m.id),
        materializedMetricCount: materializedMetrics.length,
        materializedMetricIds: materializedMetrics.map((m) => m.id),
      },
      "[aggregated-fact-table] startQueries",
    );

    const queries: Queries = [];

    let dropQuery: QueryPointer | null = null;
    let createQuery: QueryPointer | null = null;

    if (effectiveMode === "restate") {
      // Try to drop any table with the same name
      dropQuery = await this.startQuery({
        name: "drop_aggregated_fact_table",
        displayTitle: `Drop Aggregated Fact Table (${factTable.name} / ${idType})`,
        query: integration.getDropAggregatedFactTableQuery({
          tableFullName,
        }),
        dependencies: [],
        run: (query, setExternalId, queryMetadata) =>
          integration.runIncrementalWithNoOutputQuery(
            query,
            setExternalId,
            queryMetadata,
          ),
        queryType: "aggregatedFactTableDrop",
      });
      queries.push(dropQuery);

      createQuery = await this.startQuery({
        name: "create_aggregated_fact_table",
        displayTitle: `Create Aggregated Fact Table (${factTable.name} / ${idType})`,
        query: integration.getCreateAggregatedFactTableQuery({
          factTableId: factTable.id,
          idType,
          metrics: materializedMetrics,
          tableFullName,
        }),
        dependencies: dropQuery ? [dropQuery.query] : [],
        run: (query, setExternalId, queryMetadata) =>
          integration.runIncrementalWithNoOutputQuery(
            query,
            setExternalId,
            queryMetadata,
          ),
        queryType: "aggregatedFactTableCreate",
      });
      queries.push(createQuery);
    }

    // Window lower bound. Restate re-scans the retained window (inclusive);
    // incremental slices strictly after the event-time watermark.
    const restateWindowStart = new Date(
      Date.now() - AGGREGATED_FACT_TABLE_MAX_RESTATE_DAYS * 24 * 60 * 60 * 1000,
    );
    const windowStartDate =
      effectiveMode === "restate"
        ? restateWindowStart
        : (aggregatedFactTable.lastMaxTimestamp ?? restateWindowStart);
    const exclusiveStart =
      effectiveMode === "incremental" && !!aggregatedFactTable.lastMaxTimestamp;

    // TODO(aggregated-fact-tables): remove debug logging before merging
    this.context.logger.info(
      {
        factTableId: factTable.id,
        idType,
        windowStartDate,
        exclusiveStart,
      },
      "[aggregated-fact-table] computed insert window",
    );

    const factTableSettingsHash =
      getFactTableSettingsHashForAggregatedFactTable(factTable);
    const metricState: AggregatedFactTableMetricStateInterface[] = metrics.map(
      (metric) => ({
        metricId: metric.id,
        settingsHash: getMetricSettingsHashForAggregatedFactTable({
          factMetric: metric,
          factTableId: factTable.id,
        }),
        columns: getColumnsForMetric(metric, factTable.id),
        slices: getAutoSliceMetrics({ metric, factTable }).map(
          (sliceMetric) => ({
            metricId: sliceMetric.id,
            columns: getColumnsForMetric(sliceMetric, factTable.id),
          }),
        ),
        builtAt: new Date(),
      }),
    );

    const insertQuery = await this.startQuery({
      name: "insert_aggregated_fact_table_data",
      displayTitle: `Update Aggregated Fact Table (${factTable.name} / ${idType})`,
      query: integration.getInsertAggregatedFactTableDataQuery({
        factTable,
        idType,
        metrics: materializedMetrics,
        tableFullName,
        windowStartDate,
        exclusiveStart,
      }),
      dependencies: createQuery ? [createQuery.query] : [],
      run: (query, setExternalId, queryMetadata) =>
        integration.runIncrementalWithNoOutputQuery(
          query,
          setExternalId,
          queryMetadata,
        ),
      onSuccess: async () => {
        // TODO(aggregated-fact-tables): remove debug logging before merging
        this.context.logger.info(
          {
            factTableId: factTable.id,
            idType,
            tableFullName,
            metricStateCount: metricState.length,
          },
          "[aggregated-fact-table] insert query succeeded, persisting metric state",
        );
        const lockHeld =
          await this.context.models.aggregatedFactTables.updateByKeyIfCurrentExecution(
            this.getKey(),
            executionId,
            {
              tableFullName,
              factTableSettingsHash,
              metricState,
            },
          );
        if (!lockHeld) {
          this.context.logger.warn(
            "Aggregated fact table execution lock lost during insert success",
          );
        }
      },
      queryType: "aggregatedFactTableInsertData",
    });
    queries.push(insertQuery);

    const maxTimestampQuery = await this.startQuery({
      name: MAX_TIMESTAMP_QUERY_NAME,
      displayTitle: `Find Aggregated Fact Table Coverage (${factTable.name} / ${idType})`,
      query: integration.getAggregatedFactTableMaxTimestampQuery({
        tableFullName,
      }),
      dependencies: [insertQuery.query],
      run: (query, setExternalId, queryMetadata) =>
        integration.runIncrementalWithNoOutputQuery(
          query,
          setExternalId,
          queryMetadata,
        ),
      queryType: "aggregatedFactTableMaxTimestamp",
    });
    queries.push(maxTimestampQuery);

    // TODO(aggregated-fact-tables): remove debug logging before merging
    this.context.logger.info(
      {
        factTableId: factTable.id,
        idType,
        queryCount: queries.length,
        queryNames: queries.map((q) => q.name),
      },
      "[aggregated-fact-table] queued queries",
    );

    return queries;
  }

  async runAnalysis(queryMap: QueryMap): Promise<AggregatedFactTableResult> {
    const query = queryMap.get(MAX_TIMESTAMP_QUERY_NAME);
    const row = (query?.result as Record<string, unknown>[] | undefined)?.[0];
    const result = parseAggregatedFactTableCoverage(row);
    // TODO(aggregated-fact-tables): remove debug logging before merging
    this.context.logger.info(
      {
        modelId: this.model.id,
        factTableId: this.model.factTableId,
        idType: this.model.idType,
        coverage: result,
      },
      "[aggregated-fact-table] runAnalysis parsed coverage",
    );
    return result;
  }

  async getLatestModel(): Promise<AggregatedFactTableRunInterface> {
    const obj = await this.context.models.aggregatedFactTableRuns.getById(
      this.model.id,
    );
    if (!obj) {
      throw new Error(
        "Could not load aggregated fact table run: " + this.model.id,
      );
    }
    return obj;
  }

  async updateModel({
    status,
    queries,
    runStarted,
    result,
    error,
  }: {
    status: QueryStatus;
    queries: Queries;
    runStarted?: Date;
    result?: AggregatedFactTableResult;
    error?: string;
  }): Promise<AggregatedFactTableRunInterface> {
    const executionId =
      this.params?.executionId ??
      this.params?.aggregatedFactTable.currentExecutionId ??
      null;

    const isTerminal = status !== "running" && status !== "queued";

    // TODO(aggregated-fact-tables): remove debug logging before merging
    this.context.logger.info(
      {
        runId: this.model.id,
        aggregatedFactTableId: this.model.aggregatedFactTableId,
        factTableId: this.model.factTableId,
        idType: this.model.idType,
        status,
        queryCount: queries.length,
        hasResult: !!result,
        error: error ?? null,
      },
      "[aggregated-fact-table] updateModel",
    );

    // Per-run state lives on the run doc.
    const runUpdates: UpdateProps<AggregatedFactTableRunInterface> = {
      queries,
      ...(runStarted ? { runStarted } : {}),
      error: error ?? null,
      ...(result ? { result } : {}),
      ...(isTerminal ? { finishedAt: new Date() } : {}),
    };
    await this.context.models.aggregatedFactTableRuns.updateRunFields(
      this.model.id,
      runUpdates,
    );

    // The durable registry is updated only when the run finishes: write the
    // final coverage/error, point lastRunId at this run, and release the lock.
    if (isTerminal && executionId) {
      const lockHeld =
        await this.context.models.aggregatedFactTables.updateByKeyIfCurrentExecution(
          this.getKey(),
          executionId,
          {
            lastError: error ?? null,
            lastRunId: this.model.id,
            ...(result
              ? {
                  lastMaxTimestamp: result.lastMaxTimestamp,
                  firstEventDate: result.firstEventDate,
                  lastEventDate: result.lastEventDate,
                }
              : {}),
          },
        );
      if (!lockHeld) {
        this.context.logger.warn(
          "Aggregated fact table execution lock lost while finalizing run",
        );
      }

      await this.context.models.aggregatedFactTables
        .releaseLock(this.getKey(), executionId)
        .catch((e) =>
          this.context.logger.warn(
            e,
            "Failed to release aggregated fact table lock on terminal status",
          ),
        );
    }

    return {
      ...this.model,
      ...runUpdates,
    };
  }
}
