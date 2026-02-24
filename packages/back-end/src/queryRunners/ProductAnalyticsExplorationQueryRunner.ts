import { ProductAnalyticsExplorationParams } from "shared/types/integrations";
import {
  ProductAnalyticsExploration,
  ProductAnalyticsResult,
} from "shared/validators";
import { FactMetricInterface, FactTableMap } from "shared/types/fact-table";
import { Queries, QueryStatus } from "shared/types/query";
import { QueryRunner, QueryMap } from "./QueryRunner";
import SqlIntegration from "../integrations/SqlIntegration";
import { transformProductAnalyticsRowsToResult } from "shared/enterprise";
import { UpdateProps } from "shared/types/base-model";

export class ProductAnalyticsExplorationQueryRunner extends QueryRunner<
  ProductAnalyticsExploration,
  ProductAnalyticsExplorationParams,
  ProductAnalyticsResult
> {
  private factTableMap?: FactTableMap;
  private factMetricMap?: Map<string, FactMetricInterface>;

  checkPermissions(): boolean {
    const datasetType = this.model.config?.dataset?.type;

    // If a pre-defined metric or fact table are being explored
    if (datasetType === "metric" || datasetType === "fact_table") {
      return this.context.permissions.canRunMetricAnalysisQueries(
        this.integration.datasource,
      );
    }
    // If custom SQL is being explored
    else {
      return this.context.permissions.canRunSqlExplorerQueries(
        this.integration.datasource,
      );
    }
  }

  async startQueries(
    params: ProductAnalyticsExplorationParams,
  ): Promise<Queries> {
    this.factTableMap = params.factTableMap;
    this.factMetricMap = params.factMetricMap;

    if (!(this.integration instanceof SqlIntegration)) {
      throw new Error("Product Analytics only supports SQL data sources");
    }

    const { sql } = this.integration.getProductAnalyticsQuery(
      this.model.config,
      {
        factTableMap: this.factTableMap,
        metricMap: this.factMetricMap,
      },
    );
    return [
      await this.startQuery({
        name: "productAnalyticsExploration",
        query: sql,
        dependencies: [],
        run: (query, setExternalId) =>
          (this.integration as SqlIntegration).runProductAnalyticsQuery(
            query,
            setExternalId,
          ),
        queryType: "productAnalyticsExploration",
      }),
    ];
  }
  async runAnalysis(queryMap: QueryMap): Promise<ProductAnalyticsResult> {
    const query = queryMap.get("productAnalyticsExploration");
    if (!query) {
      throw new Error("Product analytics exploration query not found");
    }
    const rows = query.result as Record<string, unknown>[];
    if (!rows) {
      throw new Error("Product analytics exploration query result not found");
    }
    const statistics = query.statistics;
    const { orderedMetricIds, startDate, endDate } = (
      this.integration as SqlIntegration
    ).getProductAnalyticsQuery(this.model.config, {
      factTableMap: this.factTableMap as FactTableMap,
      metricMap: this.factMetricMap as Map<string, FactMetricInterface>,
    });

    const resp = transformProductAnalyticsRowsToResult(
      this.model.config,
      rows,
      orderedMetricIds,
    );
    return {
      rows: resp.rows,
      statistics: statistics,
      sql: query.query,
      error: query.error,
    };
  }
  async getLatestModel(): Promise<ProductAnalyticsExploration> {
    const model = await this.context.models.analyticsExplorations.getById(
      this.model.id,
    );
    if (!model) {
      throw new Error("Product analytics exploration not found");
    }
    return model;
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
    runStarted?: Date | undefined;
    result?: ProductAnalyticsResult | undefined;
    error?: string | undefined;
  }): Promise<ProductAnalyticsExploration> {
    const updates: UpdateProps<ProductAnalyticsExploration> = {
      queries,
      error,
      result,
      status:
        status === "running"
          ? "running"
          : status === "failed"
            ? "error"
            : "success",
    };
    if (runStarted) {
      updates.runStarted = runStarted;
    }

    const latest = await this.getLatestModel();
    const updated = await this.context.models.analyticsExplorations.update(
      latest,
      updates,
    );
    return updated;
  }
}
