import { FactMetricInterface } from "@back-end/types/fact-table";
import {
  MetricAnalysisSettings,
} from "@back-end/types/metric-analysis";
import { MetricAnalysisQueryRunner } from "../queryRunners/MetricAnalysisQueryRunner";
import { getFactTableMap } from "../models/FactTableModel";
import { Context } from "../models/BaseModel";
import { findSegmentById } from "../models/SegmentModel";
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

    let segment: SegmentInterface | null = null;
    if (metricAnalysisSettings.populationType === "segment" && metricAnalysisSettings.populationId) {
      segment = await findSegmentById(metricAnalysisSettings.populationId, context.org.id);
      if (!segment) {
        throw new Error("Segment not found");
      }
    }
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
      segment: segment
    });
    return queryRunner;
  } else {
    throw new Error("Cannot analyze manual metrics");
  }
}
