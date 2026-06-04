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
import { mergeAggregatedFactTableCoverage } from "back-end/src/enterprise/services/data-pipeline";
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
  // `restate` drops/recreates and re-scans the retained window; `incremental`
  // appends events since `lastMaxTimestamp`.
  mode: AggregatedFactTableRunMode;
  // Lock token for this run; durable writes are gated on it.
  executionId: string;
  // Registry snapshot loaded by the worker; the runner reads prior
  // watermark/tableFullName and writes final coverage back when the run ends.
  aggregatedFactTable: AggregatedFactTableInterface;
  // Schema state resolved by the driver (the runner does not recompute it); the
  // insert onSuccess persists these onto the registry.
  factTableSettingsHash: string;
  metricState: AggregatedFactTableMetricStateInterface[];
};

export type AggregatedFactTableResult = {
  lastMaxTimestamp: Date | null;
  firstEventDate: Date | null;
  lastEventDate: Date | null;
};

const MAX_TIMESTAMP_QUERY_NAME = "aggregated_fact_table_max_timestamp";

// Parse a coverage row into registry watermark fields. A null `max_timestamp`
// means the table is empty, so all coverage fields are null.
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
      factTableSettingsHash,
      metricState,
    } = params;
    const integration = this.integration;

    if (!integration.generateTablePath) {
      throw new Error(
        "Data source does not support generating table paths for aggregated fact tables.",
      );
    }

    const pipelineSettings = integration.datasource.settings.pipelineSettings;

    const tableFullName =
      aggregatedFactTable.tableFullName ??
      integration.generateTablePath(
        `${AGGREGATED_FACT_TABLE_PREFIX}_${factTable.id}_${idType}`,
        pipelineSettings?.writeDataset,
        pipelineSettings?.writeDatabase,
        true,
      );

    // The driver owns mode resolution (first-run, drift, incomplete-write, and
    // explicit restate all decided there); the runner just executes it.
    const queries: Queries = [];

    let dropQuery: QueryPointer | null = null;
    let createQuery: QueryPointer | null = null;

    if (mode === "restate") {
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
          metrics,
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
      mode === "restate"
        ? restateWindowStart
        : (aggregatedFactTable.lastMaxTimestamp ?? restateWindowStart);
    const exclusiveStart =
      mode === "incremental" && !!aggregatedFactTable.lastMaxTimestamp;

    const insertQuery = await this.startQuery({
      name: "insert_aggregated_fact_table_data",
      displayTitle: `Update Aggregated Fact Table (${factTable.name} / ${idType})`,
      query: integration.getInsertAggregatedFactTableDataQuery({
        factTable,
        idType,
        metrics,
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
      onFailure: () => {
        // An observed failure of INSERT means nothing committed
        // (true for BigQuery/Snowflake/Redshift/Postgres). So we clear the
        // in-flight marker: the next run can safely retry the same incremental
        // window instead of rebuilding.
        this.context.models.aggregatedFactTables
          .updateByKeyIfCurrentExecution(this.getKey(), executionId, {
            inFlightExecutionId: null,
          })
          .catch((e) =>
            this.context.logger.warn(
              e,
              "Failed to clear aggregated fact table in-flight marker on insert failure",
            ),
          );
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
      onSuccess: async (rows) => {
        // The watermark is durably advanced the instant coverage succeeds.
        // The merge guard prevents a transient empty/unparseable read
        // from regressing a non-null watermark and re-scanning the window.
        const parsed = parseAggregatedFactTableCoverage(rows?.[0]);
        const merged = mergeAggregatedFactTableCoverage(
          {
            lastMaxTimestamp: aggregatedFactTable.lastMaxTimestamp ?? null,
            firstEventDate: aggregatedFactTable.firstEventDate ?? null,
            lastEventDate: aggregatedFactTable.lastEventDate ?? null,
          },
          parsed,
        );
        const lockHeld =
          await this.context.models.aggregatedFactTables.updateByKeyIfCurrentExecution(
            this.getKey(),
            executionId,
            {
              lastMaxTimestamp: merged.lastMaxTimestamp,
              firstEventDate: merged.firstEventDate,
              lastEventDate: merged.lastEventDate,
              lastError: null,
              inFlightExecutionId: null,
            },
          );
        if (!lockHeld) {
          this.context.logger.warn(
            "Aggregated fact table execution lock lost during coverage success",
          );
        }
      },
      queryType: "aggregatedFactTableMaxTimestamp",
    });
    queries.push(maxTimestampQuery);

    return queries;
  }

  async runAnalysis(queryMap: QueryMap): Promise<AggregatedFactTableResult> {
    const query = queryMap.get(MAX_TIMESTAMP_QUERY_NAME);
    const row = (query?.result as Record<string, unknown>[] | undefined)?.[0];
    const result = parseAggregatedFactTableCoverage(row);
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

    // Registry is updated only when the run finishes: write final coverage/error,
    // point lastRunId at this run, and release the lock.
    if (isTerminal && executionId) {
      // Backstop for the coverage onSuccess path: when we have a coverage result
      // (success), persist the merged watermark and clear the in-flight marker
      // (idempotent if onSuccess already did). On a failed terminal status there
      // is no result, so we leave the marker untouched - only the targeted insert
      // onFailure clears it on failure, so a crash / coverage failure / ambiguous
      // commit still forces the next run to restate.
      const coverageUpdates = result
        ? (() => {
            const merged = mergeAggregatedFactTableCoverage(
              {
                lastMaxTimestamp:
                  this.params?.aggregatedFactTable.lastMaxTimestamp ?? null,
                firstEventDate:
                  this.params?.aggregatedFactTable.firstEventDate ?? null,
                lastEventDate:
                  this.params?.aggregatedFactTable.lastEventDate ?? null,
              },
              result,
            );
            return {
              lastMaxTimestamp: merged.lastMaxTimestamp,
              firstEventDate: merged.firstEventDate,
              lastEventDate: merged.lastEventDate,
              inFlightExecutionId: null,
            };
          })()
        : {};

      const lockHeld =
        await this.context.models.aggregatedFactTables.updateByKeyIfCurrentExecution(
          this.getKey(),
          executionId,
          {
            lastError: error ?? null,
            lastRunId: this.model.id,
            ...coverageUpdates,
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
