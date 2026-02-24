import type { Response } from "express";
import {
  ProductAnalyticsConfig,
  productAnalyticsConfigValidator,
  ProductAnalyticsExploration,
} from "shared/validators";
import { calculateProductAnalyticsDateRange } from "shared/enterprise";
import {
  FactMetricInterface,
  FactTableInterface,
} from "shared/types/fact-table";
import { stringToBoolean } from "shared/util";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import { getContextFromReq } from "back-end/src/services/organizations";
import {
  getFactTable,
  getFactTablesByIds,
} from "back-end/src/models/FactTableModel";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import { BadRequestError, NotFoundError } from "back-end/src/util/errors";
import { getSourceIntegrationObject } from "back-end/src/services/datasource";
import SqlIntegration from "back-end/src/integrations/SqlIntegration";
import { ProductAnalyticsExplorationQueryRunner } from "back-end/src/queryRunners/ProductAnalyticsExplorationQueryRunner";

export const postProductAnalyticsRun = async (
  req: AuthRequest<
    { config: ProductAnalyticsConfig },
    unknown,
    { skipCache?: string }
  >,
  res: Response<{
    status: 200;
    exploration: ProductAnalyticsExploration;
  }>,
) => {
  const context = getContextFromReq(req);

  const skipCache = stringToBoolean(req.query.skipCache);

  const config = productAnalyticsConfigValidator.parse(req.body.config);

  // Read from cache first
  if (!skipCache) {
    const existing =
      await context.models.analyticsExplorations.findLatestByConfig(config);
    if (existing) {
      return res.status(200).json({
        status: 200,
        exploration: existing,
      });
    }
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
  } else {
    throw new BadRequestError("Invalid dataset type");
  }

  const configHashes =
    context.models.analyticsExplorations.getConfigHashes(config);
  if (!configHashes) {
    throw new BadRequestError("Invalid config");
  }

  const dateRange = calculateProductAnalyticsDateRange(config.dateRange);

  // Create model
  const exploration = await context.models.analyticsExplorations.create({
    config,
    datasource: datasource.id,
    configHash: configHashes.generalSettingsHash,
    valueHashes: configHashes.valueHashes,
    dateStart: dateRange.startDate,
    dateEnd: dateRange.endDate,
    queries: [],
    result: { rows: [], statistics: {}, sql: "", error: null },
    runStarted: null,
    status: "running",
    error: null,
  });

  // Start queries
  const integration = getSourceIntegrationObject(
    context,
    datasource,
    !skipCache,
  );
  if (!(integration instanceof SqlIntegration)) {
    throw new BadRequestError("Datasource is not a SQL datasource");
  }

  try {
    const queryRunner = new ProductAnalyticsExplorationQueryRunner(
      context,
      exploration,
      integration,
      true,
    );
    await queryRunner.startAnalysis({
      factTableMap,
      factMetricMap: metricMap,
    });
    // TODO: add a timeout - if results are taking longer than 5 seconds, return the in progress exploration
    // Frontend will handle this by showing a loading state and polling for updates
    await queryRunner.waitForResults();

    return res.status(200).json({
      status: 200,
      exploration: queryRunner.model,
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("Error running product analytics query", e);
    const error = e instanceof Error ? e : new Error(String(e));
    await context.models.analyticsExplorations.update(exploration, {
      status: "error",
      error: error.message,
    });
    throw new BadRequestError(
      "Error running product analytics query: " + error.message,
    );
  }
};

export const getExplorationById = async (
  req: AuthRequest<never, { id: string }, never>,
  res: Response<{
    status: 200;
    exploration: ProductAnalyticsExploration;
  }>,
) => {
  const context = getContextFromReq(req);
  const { id } = req.params;

  const exploration = await context.models.analyticsExplorations.getById(id);
  if (!exploration) {
    throw new NotFoundError("Exploration not found");
  }

  return res.status(200).json({
    status: 200,
    exploration,
  });
};
