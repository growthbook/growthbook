import { ASK_ROW_LIMIT, assertSafeReadOnlySQL, ensureLimit } from "shared/sql";
import { runSqlQueryValidator } from "shared/validators";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import {
  getSourceIntegrationObject,
  runFreeFormQuery,
} from "back-end/src/services/datasource";
import { getProductAnalyticsExplorationUrl } from "back-end/src/enterprise/services/product-analytics";
import {
  resultsToCsv,
  createSqlExploration,
} from "back-end/src/agent/ask-data-tools";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { logger } from "back-end/src/util/logger";

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
  let costEstimationUnavailable = false;
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

      // Non-BigQuery integrations return 0 bytes — the threshold is not meaningful
      if (estimate.bytesProcessed === 0 && !estimate.costEstimateUsd) {
        costEstimationUnavailable = true;
      }
    }
    // Legacy "auto-always" values fall through to execution
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

  // Create a persisted SQL exploration so the agent's SQL populates the SQL IDE
  let explorationUrl: string | undefined;
  let explorationId: string | undefined;
  try {
    const result = await createSqlExploration(req.context, {
      datasourceId: datasource.id,
      sql: executedSql,
      purpose: req.body.purpose,
      colNames,
      columns: columns ?? undefined,
      rows,
      durationMs: duration ?? 0,
      timestampColumn: req.body.tableMetadata?.timestampColumn,
    });
    explorationId = result.explorationId;
    explorationUrl = getProductAnalyticsExplorationUrl(result.config);
  } catch (e) {
    logger.error(e, "Failed to create SQL exploration");
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
    ...(explorationId ? { explorationId } : {}),
    ...(costEstimationUnavailable
      ? {
          notice:
            "Cost estimation is not supported for this datasource type. The query was auto-approved without a cost check.",
        }
      : {}),
  };
});

function formatBytes(bytes: number): string {
  if (bytes >= 1099511627776)
    return `${(bytes / 1099511627776).toFixed(2)} TiB`;
  if (bytes >= 1073741824) return `${(bytes / 1073741824).toFixed(2)} GiB`;
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)} MiB`;
  return `${(bytes / 1024).toFixed(0)} KiB`;
}
