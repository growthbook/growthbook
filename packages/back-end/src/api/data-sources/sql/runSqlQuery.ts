import { ASK_ROW_LIMIT, assertSafeReadOnlySQL, ensureLimit } from "shared/sql";
import type { ExplorationConfig } from "shared/validators";
import { runSqlQueryValidator } from "shared/validators";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import {
  getSourceIntegrationObject,
  runFreeFormQuery,
} from "back-end/src/services/datasource";
import { getProductAnalyticsExplorationUrl } from "back-end/src/enterprise/services/product-analytics";
import { resultsToCsv } from "back-end/src/agent/ask-data-tools";
import { createApiRequestHandler } from "back-end/src/util/handler";

const DEFAULT_THRESHOLD_BYTES = 1073741824; // 1 GiB

export const runSqlQuery = createApiRequestHandler(runSqlQueryValidator)(async (
  req,
) => {
  const datasource = await getDataSourceById(req.context, req.params.id);
  if (!datasource) {
    throw new Error("Could not find data source with that id");
  }
  if (!req.context.org.settings?.aiAskDataEnabled) {
    throw new Error("Ask data is not enabled for this organization");
  }
  if (!datasource.settings?.askData?.enabled) {
    throw new Error("Ask data is not enabled for this data source");
  }
  if (!req.context.permissions.canRunSchemaQueries(datasource)) {
    req.context.permissions.throwPermissionError();
  }
  if (!req.context.permissions.canRunSqlExplorerQueries(datasource)) {
    req.context.permissions.throwPermissionError();
  }

  assertSafeReadOnlySQL(req.body.sql);
  const limited = ensureLimit(req.body.sql, ASK_ROW_LIMIT);

  // Cost estimation gate (skip if caller already confirmed)
  if (!req.body.confirm) {
    const policy =
      datasource.settings?.askData?.runPolicy ?? "auto-below-threshold";

    if (policy === "always-confirm") {
      const integration = getSourceIntegrationObject(req.context, datasource);
      const estimate = integration.estimateQueryCost
        ? await integration.estimateQueryCost(limited)
        : { bytesProcessed: 0 };
      return {
        status: "confirmation_required" as const,
        estimatedBytesProcessed: estimate.bytesProcessed,
        estimatedCostUsd: estimate.costEstimateUsd,
        sql: limited,
        message: `This query requires confirmation before executing.${
          estimate.costEstimateUsd
            ? ` Estimated cost: $${estimate.costEstimateUsd.toFixed(4)} (${formatBytes(estimate.bytesProcessed)} scanned).`
            : ""
        } Re-call with confirm: true to execute.`,
      };
    }

    if (policy === "auto-below-threshold") {
      const threshold =
        datasource.settings?.askData?.thresholdBytes ?? DEFAULT_THRESHOLD_BYTES;
      const integration = getSourceIntegrationObject(req.context, datasource);
      const estimate = integration.estimateQueryCost
        ? await integration.estimateQueryCost(limited)
        : { bytesProcessed: 0 };

      if (estimate.bytesProcessed > threshold) {
        return {
          status: "confirmation_required" as const,
          estimatedBytesProcessed: estimate.bytesProcessed,
          estimatedCostUsd: estimate.costEstimateUsd,
          sql: limited,
          message: `This query would scan ${formatBytes(estimate.bytesProcessed)}, which exceeds the ${formatBytes(threshold)} threshold.${
            estimate.costEstimateUsd
              ? ` Estimated cost: $${estimate.costEstimateUsd.toFixed(4)}.`
              : ""
          } Re-call with confirm: true to execute.`,
        };
      }
    }
    // "auto-always" falls through to execution
  }

  const { results, duration, sql, columns, error } = await runFreeFormQuery(
    req.context,
    datasource,
    limited,
    ASK_ROW_LIMIT,
  );

  if (error) {
    return { status: "error" as const, message: error };
  }

  const rows = results ?? [];
  const colNames = columns?.map((c) => c.name) ?? Object.keys(rows[0] ?? {});
  const truncated = rows.length >= ASK_ROW_LIMIT;
  const executedSql = sql ?? limited;

  // Build exploration URL when table metadata is provided
  let explorationUrl: string | undefined;
  const tm = req.body.tableMetadata;
  if (tm) {
    try {
      const config: ExplorationConfig = {
        type: "data_source",
        datasource: datasource.id,
        chartType: "table",
        dateRange: { predefined: "last30Days" },
        dimensions: [],
        dataset: {
          type: "data_source",
          table: tm.table,
          path: tm.path,
          timestampColumn: tm.timestampColumn,
          columnTypes: tm.columnTypes,
          values: [
            {
              type: "data_source",
              name: "Count",
              valueType: "count",
              valueColumn: null,
              unit: null,
              rowFilters: [],
            },
          ],
        },
      };
      explorationUrl = getProductAnalyticsExplorationUrl(config);
    } catch {
      // If config building fails, skip the URL
    }
  }

  return {
    status: "success" as const,
    summary: `SQL query (${rows.length} rows, ${duration ?? 0}ms): ${executedSql.slice(0, 120)}`,
    rowCount: rows.length,
    columns: colNames.map((name) => ({
      name,
      dataType: columns?.find((c) => c.name === name)?.dataType,
    })),
    resultCsv: resultsToCsv(rows, 20),
    truncated,
    durationMs: duration ?? 0,
    sql: executedSql,
    ...(explorationUrl ? { explorationUrl } : {}),
  };
});

function formatBytes(bytes: number): string {
  if (bytes >= 1099511627776)
    return `${(bytes / 1099511627776).toFixed(2)} TiB`;
  if (bytes >= 1073741824) return `${(bytes / 1073741824).toFixed(2)} GiB`;
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)} MiB`;
  return `${(bytes / 1024).toFixed(0)} KiB`;
}
