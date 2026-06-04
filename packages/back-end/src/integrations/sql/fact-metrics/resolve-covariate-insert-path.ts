import { parseSliceMetricId } from "shared/experiments";
import type {
  FactMetricInterface,
  FactTableInterface,
} from "shared/types/fact-table";
import type { AggregatedFactTableMetricStateInterface } from "shared/validators";

import { ApiReqContext } from "back-end/types/api";
import { getMetricSettingsHashForAggregatedFactTable } from "back-end/src/enterprise/services/data-pipeline";
import { getColumnsForMetric } from "back-end/src/integrations/sql/fact-metrics/columns-for-metric";
import { canReAggregateDailyPartialsForCovariate } from "back-end/src/integrations/sql/fact-metrics/aggregation-metadata";

// A pre-aggregated covariate table is only trusted if its newest day is within
// this window; otherwise the nightly materialization is behind and we fall back
// to the legacy raw scan so covariates don't silently miss recent days.
export const AGGREGATED_FACT_TABLE_COVARIATE_FRESHNESS_MS = 36 * 60 * 60 * 1000;

export type CovariateInsertPath =
  | { path: "legacy" }
  | { path: "aggregated"; aggregatedTableFullName: string; idType: string };

// Decides whether a fact-table group's covariate insert reads from the
// pre-aggregated daily table or falls back to the legacy raw scan. The decision
// is all-or-nothing for the group: a single covariate INSERT writes one row per
// unit with every metric column, so it can't mix aggregated and raw columns.
export async function resolveCovariateInsertPath({
  context,
  factTable,
  datasourceId,
  exposureUserIdType,
  regressionAdjustedMetrics,
  now = new Date(),
}: {
  context: ApiReqContext;
  factTable: FactTableInterface | undefined;
  datasourceId: string;
  exposureUserIdType: string;
  regressionAdjustedMetrics: FactMetricInterface[];
  now?: Date;
}): Promise<CovariateInsertPath> {
  const legacy: CovariateInsertPath = { path: "legacy" };

  if (!factTable) return legacy;

  const idTypes = factTable.aggregatedFactTableIdTypes ?? [];
  if (!idTypes.includes(exposureUserIdType)) return legacy;

  const registry = await context.models.aggregatedFactTables.getByKey({
    datasourceId,
    factTableId: factTable.id,
    idType: exposureUserIdType,
  });
  if (!registry || !registry.tableFullName) return legacy;

  if (
    !registry.lastEventDate ||
    now.getTime() - registry.lastEventDate.getTime() >
      AGGREGATED_FACT_TABLE_COVARIATE_FRESHNESS_MS
  ) {
    return legacy;
  }

  const allMetricsCovered = regressionAdjustedMetrics.every((metric) =>
    isMetricCoveredByRegistry(metric, factTable.id, registry.metricState),
  );
  if (!allMetricsCovered) return legacy;

  return {
    path: "aggregated",
    aggregatedTableFullName: registry.tableFullName,
    idType: exposureUserIdType,
  };
}

function isMetricCoveredByRegistry(
  metric: FactMetricInterface,
  factTableId: string,
  metricState: AggregatedFactTableMetricStateInterface[],
): boolean {
  if (!canReAggregateDailyPartialsForCovariate(metric)) return false;

  const { baseMetricId, isSliceMetric } = parseSliceMetricId(metric.id);
  const baseState = metricState.find((s) => s.metricId === baseMetricId);
  if (!baseState) return false;

  // Slice clones share the base metric's schema-breaking settings, so the hash
  // computed from either matches the base hash stored at materialization time.
  const settingsHash = getMetricSettingsHashForAggregatedFactTable({
    factMetric: metric,
    factTableId,
  });
  if (settingsHash !== baseState.settingsHash) return false;

  const storedColumns = isSliceMetric
    ? baseState.slices?.find((sl) => sl.metricId === metric.id)?.columns
    : baseState.columns;
  if (!storedColumns) return false;

  const requiredColumns = getColumnsForMetric(metric, factTableId);
  return requiredColumns.every((c) => storedColumns.includes(c));
}
