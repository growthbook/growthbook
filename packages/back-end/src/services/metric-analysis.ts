import { cloneDeep } from "lodash";
import { SegmentInterface } from "shared/types/segment";
import { FactMetricInterface } from "shared/types/fact-table";
import {
  MetricAnalysisSettings,
  MetricAnalysisSource,
} from "shared/types/metric-analysis";
import { MetricAnalysisQueryRunner } from "back-end/src/queryRunners/MetricAnalysisQueryRunner";
import { getFactTableMap } from "back-end/src/models/FactTableModel";
import { Context } from "back-end/src/models/BaseModel";
import { MetricAnalysisParams } from "back-end/src/types/Integration";
import { getIntegrationFromDatasourceId } from "./datasource";

// When creating an analysis for metrics via a Dashboard, we sometimes apply adhoc filters to the analysis, that aren't a part of the metric itself (e.g. adding additional row filters)
// This function takes the metric and applies these adhoc settings before running the analysis
export function getMetricWithFiltersApplied(
  params: MetricAnalysisParams,
): FactMetricInterface {
  const { metric, settings } = params;

  // If no adhoc filters are provided, we can return the original metric
  if (
    !settings.additionalNumeratorFilters &&
    !settings.additionalDenominatorFilters
  ) {
    return metric;
  }

  const metricWithFilters = cloneDeep(metric);
  if (settings.additionalNumeratorFilters) {
    metricWithFilters.numerator.rowFilters = [
      ...(metricWithFilters.numerator.rowFilters || []),
      ...settings.additionalNumeratorFilters.map((f) => ({
        operator: "saved_filter" as const,
        values: [f],
      })),
    ];
  }
  if (settings.additionalDenominatorFilters && metricWithFilters.denominator) {
    metricWithFilters.denominator.rowFilters = [
      ...(metricWithFilters.denominator.rowFilters || []),
      ...settings.additionalDenominatorFilters.map((f) => ({
        operator: "saved_filter" as const,
        values: [f],
      })),
    ];
  }
  return metricWithFilters;
}

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
