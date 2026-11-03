import { isFactMetric } from "shared/experiments";
import { getInterleavingMetricIssue } from "shared/util";
import type {
  FactMetricInterface,
  FactTableInterface,
} from "shared/types/fact-table";
import { InterleavingMetricConfig } from "shared/validators";
import { ReqContext } from "back-end/types/request";
import { ApiReqContext } from "back-end/types/api";
import { getMetricMap } from "back-end/src/models/MetricModel";
import { getFactTableMap } from "back-end/src/models/FactTableModel";

type Context = ReqContext | ApiReqContext;

export type InterleavingAnalysisInputs = {
  datasourceId: string;
  userIdType: string;
  metrics: InterleavingMetricConfig[];
};

export type ResolvedInterleavingMetric = {
  config: InterleavingMetricConfig;
  metric: FactMetricInterface;
  factTable: FactTableInterface;
};

/**
 * Load and validate the fact metrics an interleaving analysis reads. Used
 * both when saving an Interleaving and when running a snapshot, so a bad
 * setup is reported at save time with the same message it would fail with
 * at run time.
 */
export async function resolveInterleavingMetrics(
  context: Context,
  { datasourceId, userIdType, metrics }: InterleavingAnalysisInputs,
): Promise<ResolvedInterleavingMetric[]> {
  const [metricMap, factTableMap] = await Promise.all([
    getMetricMap(context),
    getFactTableMap(context),
  ]);

  return metrics.map((config) => {
    const metricId = config.id;
    const label = "Interleaving metric";
    const metric = metricMap.get(metricId);
    if (!metric || !isFactMetric(metric)) {
      throw new Error(`${label} must be an existing fact metric: ${metricId}`);
    }
    const ref = `${label} "${metric.name}"`;
    if (metric.datasource !== datasourceId) {
      throw new Error(`${ref} must belong to datasource ${datasourceId}`);
    }
    const factTable = metric.numerator
      ? factTableMap.get(metric.numerator.factTableId)
      : undefined;
    // Same predicate the metric picker greys options out with, so a metric the
    // UI offered cannot fail here for a reason the UI could have shown.
    const issue = getInterleavingMetricIssue({
      metric,
      factTable,
      userIdType,
      analyses: config.analyses,
    });
    if (issue) throw new Error(issue);
    if (!factTable) throw new Error(`Fact table not found for ${ref}`);

    return { config, metric, factTable };
  });
}
