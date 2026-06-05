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
import { snapToUtcDayStart } from "shared/dates";
import { AggregatedFactTableKey } from "back-end/src/models/AggregatedFactTableModel";
import { QueryRunner, QueryMap } from "./QueryRunner";

export const AGGREGATED_FACT_TABLE_PREFIX = "gb_aggregated";

export type AggregatedFactTableRunMode = "incremental" | "restate";

export type AggregatedFactTableQueryParams = {
  factTable: FactTableInterface;
  idType: string;
  metrics: FactMetricInterface[];
  mode: AggregatedFactTableRunMode;
  // Lock token; durable writes are gated on it.
  executionId: string;
  // Registry snapshot loaded by the worker.
  aggregatedFactTable: AggregatedFactTableInterface;
  // Schema state resolved by the driver, persisted onto the registry on success.
  factTableSettingsHash: string;
  metricState: AggregatedFactTableMetricStateInterface[];
  // How far back a full restate re-scans.
  lookbackWindowDays: number;
};

export type AggregatedFactTableResult = {
  lastMaxTimestamp: Date | null;
  firstEventDate: Date | null;
  lastEventDate: Date | null;
};

const MAX_TIMESTAMP_QUERY_NAME = "aggregated_fact_table_max_timestamp";

// Parse a coverage row. The query is pruned to the touched slice, so these are
// reconciled with prior registry coverage by `foldAggregatedFactTableCoverage`.
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

function maxDate(a: Date | null, b: Date | null): Date | null {
  if (!a) return b;
  if (!b) return a;
  return a.getTime() >= b.getTime() ? a : b;
}

// Reconcile the pruned-slice coverage with the prior registry coverage.
// Restate re-scanned everything, so its values are exact. Incremental only
// scanned the newest partitions: the timestamp maxes are exact, but
// MIN(event_date) is not the global first, so pin `firstEventDate` to
// max(prior, retentionFloor) — never older than partition expiration allows
// (see resolveCovariateInsertPath for why that direction is the safe one).
export function foldAggregatedFactTableCoverage({
  scanned,
  mode,
  prior,
  retentionFloor,
}: {
  scanned: AggregatedFactTableResult;
  mode: AggregatedFactTableRunMode;
  prior: AggregatedFactTableResult;
  retentionFloor: Date | null;
}): AggregatedFactTableResult {
  if (mode === "restate") return scanned;

  const lastMaxTimestamp = maxDate(
    prior.lastMaxTimestamp,
    scanned.lastMaxTimestamp,
  );
  const lastEventDate = maxDate(prior.lastEventDate, scanned.lastEventDate);
  const firstEventDate =
    lastEventDate === null
      ? null
      : maxDate(prior.firstEventDate, retentionFloor);

  return { lastMaxTimestamp, firstEventDate, lastEventDate };
}

function priorCoverage(
  registry: AggregatedFactTableInterface,
): AggregatedFactTableResult {
  return {
    lastMaxTimestamp: registry.lastMaxTimestamp ?? null,
    firstEventDate: registry.firstEventDate ?? null,
    lastEventDate: registry.lastEventDate ?? null,
  };
}

export class AggregatedFactTableQueryRunner extends QueryRunner<
  AggregatedFactTableRunInterface,
  AggregatedFactTableQueryParams,
  AggregatedFactTableResult
> {
  private params: AggregatedFactTableQueryParams | null = null;
  // Captured in startQueries so onSuccess and the updateModel backstop fold
  // against the same bounds.
  private coverageScanStartDate: Date | null = null;
  private coverageRetentionFloor: Date | null = null;

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

  // Set before the first committing query and cleared once the watermark is
  // durably advanced (or on an observed insert failure). If a run dies with it
  // still set, the next run restates instead of double-appending.
  private async markInFlight(executionId: string): Promise<void> {
    const lockHeld =
      await this.context.models.aggregatedFactTables.updateByKeyIfCurrentExecution(
        this.getKey(),
        executionId,
        { inFlightExecutionId: executionId },
      );
    if (!lockHeld) {
      this.context.logger.warn(
        "Aggregated fact table execution lock lost before marking write in flight",
      );
    }
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
      lookbackWindowDays,
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

    // The driver decides the mode; the runner just executes it.
    const queries: Queries = [];

    let dropQuery: QueryPointer | null = null;
    let createQuery: QueryPointer | null = null;

    if (mode === "restate") {
      // Build SQL before marking in flight so a build error leaves the marker
      // unset; set it before the drop so a partial restate still re-restates.
      const dropQueryString = integration.getDropAggregatedFactTableQuery({
        tableFullName,
      });
      const createQueryString = integration.getCreateAggregatedFactTableQuery({
        factTableId: factTable.id,
        idType,
        metrics,
        tableFullName,
        retentionWindowDays: lookbackWindowDays,
      });

      await this.markInFlight(executionId);

      dropQuery = await this.startQuery({
        name: "drop_aggregated_fact_table",
        displayTitle: `Drop Aggregated Fact Table (${factTable.name} / ${idType})`,
        query: dropQueryString,
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
        query: createQueryString,
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

    // Restate re-scans the retained window; incremental slices after the watermark.
    const restateWindowStart = new Date(
      Date.now() - lookbackWindowDays * 24 * 60 * 60 * 1000,
    );
    const windowStartDate =
      mode === "restate"
        ? restateWindowStart
        : (aggregatedFactTable.lastMaxTimestamp ?? restateWindowStart);
    const exclusiveStart =
      mode === "incremental" && !!aggregatedFactTable.lastMaxTimestamp;

    // Scan coverage from the day the insert started writing (prunes to the
    // touched partitions); the retention floor bounds incremental firstEventDate.
    const coverageScanStartDate = snapToUtcDayStart(windowStartDate);
    const coverageRetentionFloor = snapToUtcDayStart(restateWindowStart);
    this.coverageScanStartDate = coverageScanStartDate;
    this.coverageRetentionFloor = coverageRetentionFloor;

    // In incremental mode the insert is the first committing op, so mark in
    // flight now (restate already marked it before the drop).
    const insertQueryString = integration.getInsertAggregatedFactTableDataQuery(
      {
        factTable,
        idType,
        metrics,
        tableFullName,
        windowStartDate,
        exclusiveStart,
      },
    );

    if (mode === "incremental") {
      await this.markInFlight(executionId);
    }

    const insertQuery = await this.startQuery({
      name: "insert_aggregated_fact_table_data",
      displayTitle: `Update Aggregated Fact Table (${factTable.name} / ${idType})`,
      query: insertQueryString,
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
        // An observed INSERT failure means nothing committed (atomic on
        // BigQuery/Snowflake/Redshift/Postgres), so clear the marker to let the
        // next run retry the same window instead of restating.
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
        scanStartDate: coverageScanStartDate,
      }),
      dependencies: [insertQuery.query],
      run: (query, setExternalId, queryMetadata) =>
        integration.runIncrementalWithNoOutputQuery(
          query,
          setExternalId,
          queryMetadata,
        ),
      onSuccess: async (rows) => {
        // Coverage success durably advances the watermark; fold the pruned
        // slice against prior coverage before persisting.
        const folded = foldAggregatedFactTableCoverage({
          scanned: parseAggregatedFactTableCoverage(rows?.[0]),
          mode,
          prior: priorCoverage(aggregatedFactTable),
          retentionFloor: coverageRetentionFloor,
        });
        const lockHeld =
          await this.context.models.aggregatedFactTables.updateByKeyIfCurrentExecution(
            this.getKey(),
            executionId,
            {
              lastMaxTimestamp: folded.lastMaxTimestamp,
              firstEventDate: folded.firstEventDate,
              lastEventDate: folded.lastEventDate,
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
    return foldAggregatedFactTableCoverage({
      scanned: parseAggregatedFactTableCoverage(row),
      mode: this.params?.mode ?? "restate",
      prior: this.params
        ? priorCoverage(this.params.aggregatedFactTable)
        : { lastMaxTimestamp: null, firstEventDate: null, lastEventDate: null },
      retentionFloor: this.coverageRetentionFloor,
    });
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

    // On terminal status, write final coverage/error, point lastRunId here, and
    // release the lock.
    if (isTerminal && executionId) {
      // Backstop for coverage onSuccess: on success `result` is already folded
      // by runAnalysis, so persist it and clear the marker (idempotent). On
      // failure there is no result; leave the marker so the next run restates.
      const coverageUpdates = result
        ? {
            lastMaxTimestamp: result.lastMaxTimestamp,
            firstEventDate: result.firstEventDate,
            lastEventDate: result.lastEventDate,
            inFlightExecutionId: null,
          }
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
