import {
  ExplorationConfig,
  explorationConfigValidator,
  ProductAnalyticsExploration,
  ExplorationCacheQuery,
} from "shared/validators";
import {
  calculateProductAnalyticsDateRange,
  encodeExplorationConfig,
  isFunnelSupportedDatasourceType,
} from "shared/enterprise";
import { isReadOnlySQL } from "shared/sql";
import {
  FactMetricInterface,
  FactTableInterface,
} from "shared/types/fact-table";
import {
  getFactTable,
  getFactTablesByIds,
} from "back-end/src/models/FactTableModel";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import { BadRequestError, NotFoundError } from "back-end/src/util/errors";
import { getSourceIntegrationObject } from "back-end/src/services/datasource";
import SqlIntegration from "back-end/src/integrations/SqlIntegration";
import { ProductAnalyticsExplorationQueryRunner } from "back-end/src/queryRunners/ProductAnalyticsExplorationQueryRunner";
import { ApiReqContext } from "back-end/types/api";
import { ReqContext } from "back-end/types/request";
import { APP_ORIGIN } from "back-end/src/util/secrets";

/**
 * Cache lookup keys off query-defining fields (see AnalyticsExplorationModel.getConfigHashes)
 * and can reuse compatible date ranges. Reuse the cached rows but surface the
 * client's requested display config.
 */
function withRequestedDisplayConfig(
  existing: ProductAnalyticsExploration,
  requested: ExplorationConfig,
): ProductAnalyticsExploration {
  return {
    ...existing,
    config: {
      ...existing.config,
      chartType: requested.chartType,
      dateRange: requested.dateRange,
    },
  };
}

// Max time to wait synchronously for an exploration's queries before
// returning the in-progress model and letting the frontend poll for the
// result. Bounds request latency for heavy funnel/metric queries over large
// event tables.
const PRODUCT_ANALYTICS_SYNC_TIMEOUT_MS = 5000;

export async function runProductAnalyticsExploration(
  context: ReqContext | ApiReqContext,
  config: ExplorationConfig,
  options: ExplorationCacheQuery,
): Promise<ProductAnalyticsExploration | null> {
  config = explorationConfigValidator.parse(config);

  if (options.cache !== "never") {
    const existing =
      await context.models.analyticsExplorations.findLatestByConfig(config);
    if (existing) {
      return withRequestedDisplayConfig(existing, config);
    }
  }

  if (options.cache === "required") {
    return null;
  }

  // If no existing exploration, create a new one
  const metricMap: Map<string, FactMetricInterface> = new Map();
  const factTableMap: Map<string, FactTableInterface> = new Map();
  const datasource = await getDataSourceById(context, config.datasource);
  if (!datasource) {
    throw new NotFoundError("Datasource not found");
  }

  // Parse and validate dataset settings
  const dataset = config.dataset;
  if (!dataset) {
    throw new BadRequestError("Dataset is required");
  }

  if (dataset.type === "fact_table") {
    if (!dataset.factTableId) {
      throw new BadRequestError("Fact table ID is required");
    }
    const factTable = await getFactTable(context, dataset.factTableId);
    if (!factTable) {
      throw new NotFoundError("Fact table not found");
    }
    factTableMap.set(factTable.id, factTable);

    if (factTable.datasource !== datasource.id) {
      throw new BadRequestError(
        "Fact table must belong to the same datasource as the exploration",
      );
    }
  } else if (dataset.type === "metric") {
    // Populate fact metric map
    const metricIds = dataset.values.map((value) => value.metricId);
    if (!metricIds.length) {
      throw new BadRequestError("No metrics provided");
    }
    const factMetrics = await context.models.factMetrics.getByIds(metricIds);
    factMetrics.forEach((fm) => metricMap.set(fm.id, fm));

    // Populate fact table map
    const factTableIds = new Set<string>();
    factMetrics.forEach((fm) => {
      if (fm.numerator.factTableId) {
        factTableIds.add(fm.numerator.factTableId);
      }
      if (fm.metricType === "ratio" && fm.denominator?.factTableId) {
        factTableIds.add(fm.denominator.factTableId);
      }
    });
    const factTables = await getFactTablesByIds(
      context,
      Array.from(factTableIds),
    );
    factTables.forEach((ft) => factTableMap.set(ft.id, ft));

    // Populate datasource
    const datasourceIds = new Set(factMetrics.map((fm) => fm.datasource));
    if (datasourceIds.size > 1) {
      throw new BadRequestError(
        "All metrics must belong to the same datasource",
      );
    }
    if (!datasourceIds.has(datasource.id)) {
      throw new BadRequestError(
        "Metrics must belong to the same datasource as the exploration",
      );
    }
  } else if (dataset.type === "data_source") {
    // Nothing to fetch or verify
  } else if (dataset.type === "sql") {
    if (!dataset.sql.trim()) {
      throw new BadRequestError("SQL query is required");
    }
    if (!isReadOnlySQL(dataset.sql)) {
      throw new BadRequestError("Only SELECT queries are allowed");
    }
    if (!dataset.timestampColumn) {
      throw new BadRequestError("Timestamp column is required");
    }
    if (!dataset.columnTypes[dataset.timestampColumn]) {
      throw new BadRequestError("Timestamp column must exist in query results");
    }
    if (dataset.columnTypes[dataset.timestampColumn] !== "date") {
      throw new BadRequestError("Timestamp column must be a date or timestamp");
    }
  } else if (dataset.type === "funnel") {
    if (dataset.steps.length < 2) {
      throw new BadRequestError("Funnels require at least two steps");
    }
    if (!dataset.unit) {
      throw new BadRequestError("Funnel unit is required");
    }
    const unit = dataset.unit;

    // D-PA2: the funnel explorer launches on a validated subset of warehouse
    // types. Reject datasources whose funnel SQL hasn't been execution-verified
    // yet, rather than running SQL that may be invalid on that engine. Expand
    // the allowlist as each type is tested.
    if (!isFunnelSupportedDatasourceType(datasource.type)) {
      throw new BadRequestError(
        "Funnel explorations aren't supported for this data source yet. Supported warehouses will expand as each is validated.",
      );
    }

    // Load every fact table referenced by any funnel step. We don't fold
    // ids into a Set first because the order in `dataset.steps` is
    // significant for SQL generation; getFactTablesByIds dedupes for us.
    const factTableIds = Array.from(
      new Set(dataset.steps.map((s) => s.factTable).filter(Boolean)),
    );
    if (
      factTableIds.length === 0 ||
      dataset.steps.some((step) => !step.factTable)
    ) {
      throw new BadRequestError("Funnel steps require fact tables");
    }
    const factTables = await getFactTablesByIds(context, factTableIds);
    factTables.forEach((ft) => factTableMap.set(ft.id, ft));
    for (const id of factTableIds) {
      const ft = factTableMap.get(id);
      if (!ft) {
        throw new NotFoundError(`Fact table ${id} not found`);
      }
      if (ft.datasource !== datasource.id) {
        throw new BadRequestError(
          "Funnel fact tables must belong to the same datasource as the exploration",
        );
      }
      if (!ft.userIdTypes.includes(unit)) {
        throw new BadRequestError(
          `Funnel unit "${unit}" must exist on every step's fact table`,
        );
      }
    }
  } else {
    throw new BadRequestError("Invalid dataset type");
  }

  const configHashes =
    context.models.analyticsExplorations.getConfigHashes(config);
  if (!configHashes) {
    throw new BadRequestError("Invalid config");
  }

  const dateRange = calculateProductAnalyticsDateRange(config.dateRange);

  const exploration = await context.models.analyticsExplorations.create({
    config,
    datasource: datasource.id,
    configHash: configHashes.generalSettingsHash,
    valueHashes: configHashes.valueHashes,
    dateStart: dateRange.startDate.toISOString(),
    dateEnd: dateRange.endDate.toISOString(),
    queries: [],
    result: { rows: [] },
    runStarted: null,
    status: "running",
    error: null,
  });

  // Start queries
  const integration = getSourceIntegrationObject(
    context,
    datasource,
    options.cache !== "never",
  );
  if (!(integration instanceof SqlIntegration)) {
    throw new BadRequestError("Datasource is not a SQL datasource");
  }

  const queryRunner = new ProductAnalyticsExplorationQueryRunner(
    context,
    exploration,
    integration,
    true,
  );

  let syncTimer: ReturnType<typeof setTimeout> | undefined;
  try {
    await queryRunner.startAnalysis({
      factTableMap,
      factMetricMap: metricMap,
    });
    // If results aren't ready within the sync budget, return the in-progress
    // exploration (status "running") instead of blocking the request. The
    // warehouse query is NOT cancelled — the QueryRunner keeps driving it and
    // persists status updates via its own background timers, so the frontend
    // shows a loading state and polls getExplorationById for the result.
    // This bounds request latency (no UI hang) without re-running the query.
    const timeout = new Promise<void>((resolve) => {
      syncTimer = setTimeout(resolve, PRODUCT_ANALYTICS_SYNC_TIMEOUT_MS);
    });
    await Promise.race([
      // Swallow a late resolve/reject so it can't surface as an unhandled
      // rejection after the timeout wins; errors are persisted to the model
      // and surfaced to the client via polling.
      queryRunner.waitForResults().catch(() => {}),
      timeout,
    ]);
  } catch (e) {
    // Ignore errors here, still return the model
  } finally {
    // Clear the timer so the fast path doesn't leave a dangling timeout.
    if (syncTimer) clearTimeout(syncTimer);
  }

  return queryRunner.model;
}

const DATASET_TYPE_PATH: Record<ExplorationConfig["dataset"]["type"], string> =
  {
    metric: "metrics",
    fact_table: "fact-table",
    data_source: "data-source",
    sql: "sql",
    funnel: "funnel",
  };

export function getProductAnalyticsExplorationUrl(config: ExplorationConfig) {
  const baseUrl = `${APP_ORIGIN}/product-analytics/explore/${DATASET_TYPE_PATH[config.dataset.type]}`;
  return `${baseUrl}?config=${encodeURIComponent(encodeExplorationConfig(config))}`;
}
