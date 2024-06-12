import uniqid from "uniqid";
import { FactMetricInterface } from "@back-end/types/fact-table";
import {
  MetricAnalysisInterface,
  MetricAnalysisSettings,
} from "@back-end/types/metric-analysis";
import { MetricAnalysisQueryRunner } from "../queryRunners/MetricAnalysisQueryRunner";
import { getFactTableMap } from "../models/FactTableModel";
import { Context } from "../models/BaseModel";
import { SegmentInterface } from "../../types/segment";
import { getIntegrationFromDatasourceId } from "./datasource";

const DEFAULT_METRIC_ANALYSIS_DAYS = 90;

export async function createMetricAnalysis(
  context: Context,
  metric: FactMetricInterface,
  metricAnalysisDays: number = DEFAULT_METRIC_ANALYSIS_DAYS
): Promise<MetricAnalysisQueryRunner> {
  if (metric.datasource) {
    const integration = await getIntegrationFromDatasourceId(
      context,
      metric.datasource,
      true
    );

    const factTableMap = await getFactTableMap(context);

    const segment: SegmentInterface | undefined = undefined;
    // TODO settings and snapshot

    let days = metricAnalysisDays;
    if (days < 1) {
      days = DEFAULT_METRIC_ANALYSIS_DAYS;
    }

    const from = new Date();
    from.setDate(from.getDate() - days);
    const to = new Date();
    to.setDate(to.getDate() + 1);

    const metricAnalysisSettings: MetricAnalysisSettings = {
      dimensions: [],

      startDate: from,
      endDate: to,
      populationType: "metric",
      population: null,
    };
 
    const model = await context.models.metricAnalysis.create({
      metric: metric.id,
      runStarted: null,
      status: "running",

      settings: metricAnalysisSettings,
      queries: [],
    });

    const queryRunner = new MetricAnalysisQueryRunner(
      context,
      model,
      integration
    );
    await queryRunner.startAnalysis({
      settings: metricAnalysisSettings,
      metric: metric,
      factTableMap: factTableMap,
    });
    return queryRunner;
  } else {
    throw new Error("Cannot analyze manual metrics");
  }
}
