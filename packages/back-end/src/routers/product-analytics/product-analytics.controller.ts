import type { Response } from "express";
import {
  ProductAnalyticsConfig,
  productAnalyticsConfigValidator,
  ProductAnalyticsResultRow,
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
  } else if (dataset.type === "sql") {
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
    });
  } catch (e) {
    // Still return 200 so the application can handle the error gracefully
    return res.status(200).json({
      status: 200,
      sql,
      error: e.message,
      rows: [],
      rawRows: [],
    });
  }
};
