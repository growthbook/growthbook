import { FactMetricInterface } from "@back-end/types/fact-table";
import {
  MetricAnalysisSettings,
} from "@back-end/types/metric-analysis";
import { MetricAnalysisQueryRunner } from "../queryRunners/MetricAnalysisQueryRunner";
import { getFactTableMap } from "../models/FactTableModel";
import { Context } from "../models/BaseModel";
import { SegmentInterface } from "../../types/segment";
import { getIntegrationFromDatasourceId } from "./datasource";

export async function createMetricAnalysis(
  context: Context,
  metric: FactMetricInterface,
  metricAnalysisSettings: MetricAnalysisSettings,
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
      integration,
      false
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
