import { FactMetricInterface } from "back-end/types/fact-table";
import {
  MetricAnalysisSettings,
  MetricAnalysisSource,
} from "back-end/types/metric-analysis";
import { MetricAnalysisQueryRunner } from "back-end/src/queryRunners/MetricAnalysisQueryRunner";
import { getFactTableMap } from "back-end/src/models/FactTableModel";
import { Context } from "back-end/src/models/BaseModel";
import { SegmentInterface } from "back-end/types/segment";
import { getIntegrationFromDatasourceId } from "./datasource";

export async function createMetricAnalysis(
  context: Context,
  metric: FactMetricInterface,
  metricAnalysisSettings: MetricAnalysisSettings,
  source: MetricAnalysisSource,
  useCache: boolean = true,
): Promise<MetricAnalysisQueryRunner> {
  if (!metric.datasource) {
    throw new Error("Cannot analyze manual metrics");
  }

  let segment: SegmentInterface | null = null;
  if (
    metricAnalysisSettings.populationType === "segment" &&
    metricAnalysisSettings.populationId
  ) {
    segment = await context.models.segments.getById(
      metricAnalysisSettings.populationId,
    );
    if (!segment) {
      throw new Error("Segment not found");
    }
  }

  const integration = await getIntegrationFromDatasourceId(
    context,
    metric.datasource,
    true,
  );

  const factTableMap = await getFactTableMap(context);

  const model = await context.models.metricAnalysis.create({
    metric: metric.id,
    runStarted: null,
    status: "running",
    source: source,

    settings: metricAnalysisSettings,
    queries: [],
  });

  const queryRunner = new MetricAnalysisQueryRunner(
    context,
    model,
    integration,
    useCache,
  );

  await queryRunner
    .startAnalysis({
      settings: metricAnalysisSettings,
      metric: metric,
      factTableMap: factTableMap,
      segment: segment,
    })
    .catch((e) => {
      context.models.metricAnalysis.updateById(model.id, {
        status: "error",
        error: e.message,
      });
    });
  return queryRunner;
}
