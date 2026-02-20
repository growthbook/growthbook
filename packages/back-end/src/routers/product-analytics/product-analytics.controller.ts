import type { Response } from "express";
import {
  ProductAnalyticsConfig,
  ProductAnalyticsResult,
  productAnalyticsConfigValidator,
  ProductAnalyticsResultRow,
  ExplorerAnalysisResponse,
} from "shared/validators";
import {
  FactMetricInterface,
  FactTableInterface,
} from "shared/types/fact-table";
import { DataSourceInterface } from "shared/types/datasource";
import { QueryStatistics } from "shared/types/query";
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

export const postProductAnalyticsRun = async (
  req: AuthRequest<{ config: ProductAnalyticsConfig }>,
  res: Response<{
    status: 200;
    sql: string;
    error?: string;
    rows: ProductAnalyticsResultRow[];
    rawRows: Record<string, unknown>[];
    statistics?: QueryStatistics;
    analysisId: string;
  }>,
) => {
  const context = getContextFromReq(req);

  const config = productAnalyticsConfigValidator.parse(req.body.config);
  const metricMap: Map<string, FactMetricInterface> = new Map();
  const factTableMap: Map<string, FactTableInterface> = new Map();
  let datasource: DataSourceInterface | null = null;

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

    datasource = await getDataSourceById(context, factTable.datasource);
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
    const datasourceId = Array.from(datasourceIds)[0];
    if (!datasourceId) {
      throw new BadRequestError("No datasource found");
    }
    datasource = await getDataSourceById(context, datasourceId);
  } else if (dataset.type === "data_source") {
    datasource = await getDataSourceById(context, dataset.datasource);
  } else {
    throw new BadRequestError("Invalid dataset type");
  }

  if (!datasource) {
    throw new NotFoundError("Datasource not found");
  }
  if (!context.permissions.canRunTestQueries(datasource)) {
    context.permissions.throwPermissionError();
  }

  const integration = getSourceIntegrationObject(context, datasource, true);
  if (!(integration instanceof SqlIntegration)) {
    throw new BadRequestError("Datasource is not a SQL datasource");
  }

  const { sql, orderedMetricIds } = integration.getProductAnalyticsQuery(
    config,
    {
      metricMap,
      factTableMap,
    },
  );

  try {
    const results = await integration.runProductAnalyticsQuery(
      config,
      sql,
      orderedMetricIds,
    );

    return res.status(200).json({
      status: 200,
      sql,
      ...results,
      analysisId: "test123",
    });
  } catch (e) {
    const error = e instanceof Error ? e : new Error(String(e));
    // Still return 200 so the application can handle the error gracefully
    return res.status(200).json({
      status: 200,
      sql,
      error: error.message,
      rows: [],
      rawRows: [],
      analysisId: "test123",
    });
  }
};

export const getExplorerAnalysis = async (
  req: AuthRequest<never, { explorerAnalysisId: string }, never>,
  res: Response<ExplorerAnalysisResponse>,
) => {
  const { explorerAnalysisId } = req.params;

  // Mock data for test endpoint; replace with persistence when ready
  const config: ProductAnalyticsConfig = {
    analysisId: explorerAnalysisId,
    dataset: {
      type: "metric",
      values: [
        {
          type: "metric",
          name: "Average Order Value - New",
          rowFilters: [],
          metricId: "fact__18ez1c10n6mh2a2ycw",
          unit: "USD",
          denominatorUnit: "USD",
        },
      ],
    },
    dimensions: [],
    chartType: "line",
    dateRange: {
      predefined: "last30Days",
      lookbackValue: 30,
      lookbackUnit: "day",
      startDate: null,
      endDate: null,
    },
    lastRefreshedAt: new Date().toISOString(),
  };

  const results: ProductAnalyticsResult = {
    analysisId: "test123",
    rows: [
      {
        dimensions: ["2021-01-01"],
        values: [{ metricId: "123", numerator: 100, denominator: 100 }],
      },
      {
        dimensions: ["2021-01-02"],
        values: [{ metricId: "123", numerator: 200, denominator: 100 }],
      },
      {
        dimensions: ["2021-01-03"],
        values: [{ metricId: "123", numerator: 300, denominator: 300 }],
      },
      {
        dimensions: ["2021-01-04"],
        values: [{ metricId: "123", numerator: 400, denominator: 200 }],
      },
      {
        dimensions: ["2021-01-05"],
        values: [{ metricId: "123", numerator: 500, denominator: 100 }],
      },
    ],
  };

  return res.status(200).json({ config, results });
};
