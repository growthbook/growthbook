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
  metricAnalysisSettings: Partial<MetricAnalysisSettings>,
  source: MetricAnalysisSource,
  useCache: boolean = true,
): Promise<MetricAnalysisQueryRunner> {
  if (!metric.datasource) {
    throw new Error("Cannot analyze manual metrics");
  }

  // Get fact table to determine default user ID types
  const factTableMap = await getFactTableMap(context);
  const factTable = factTableMap.get(metric.numerator.factTableId);
  if (!factTable) {
    throw new Error("Fact table not found");
  }

  // Create default settings based on frontend defaults (getAnalysisSettingsForm)
  const endOfToday = new Date();
  endOfToday.setHours(23, 59, 59, 999);

  const startDate = new Date(endOfToday);
  startDate.setDate(
    startDate.getDate() - (metricAnalysisSettings.lookbackDays ?? 30),
  );
  startDate.setHours(0, 0, 0, 0);

  const fullSettings: MetricAnalysisSettings = {
    userIdType:
      metricAnalysisSettings.userIdType ?? factTable.userIdTypes?.[0] ?? "",
    startDate,
    endDate: endOfToday,
    lookbackDays: metricAnalysisSettings.lookbackDays ?? 30,
    populationType: metricAnalysisSettings.populationType ?? "factTable",
    populationId: metricAnalysisSettings.populationId ?? null,
  };

  let segment: SegmentInterface | null = null;
  if (fullSettings.populationType === "segment" && fullSettings.populationId) {
    segment = await context.models.segments.getById(fullSettings.populationId);
    if (!segment) {
      throw new Error("Segment not found");
    }
  }

  const integration = await getIntegrationFromDatasourceId(
    context,
    metric.datasource,
    true,
  );

  const model = await context.models.metricAnalysis.create({
    metric: metric.id,
    runStarted: null,
    status: "running",
    source: source,

    settings: fullSettings,
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
      settings: fullSettings,
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
