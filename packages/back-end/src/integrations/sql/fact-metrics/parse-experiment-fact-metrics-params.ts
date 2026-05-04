import cloneDeep from "lodash/cloneDeep";
import type { ExperimentSnapshotSettings } from "shared/types/experiment-snapshot";
import type {
  FactMetricPercentileData,
  FactMetricSourceData,
  FactMetricData,
} from "shared/types/integrations";
import type { ExperimentMetricInterface } from "shared/experiments";
import type { FactMetricInterface } from "shared/types/fact-table";
import type { SqlDialect } from "shared/types/sql";
import type { FactTableMap } from "back-end/src/models/FactTableModel";
import { applyMetricOverrides } from "back-end/src/util/integration";

import { getFactMetricQuantileData } from "back-end/src/integrations/sql/columns/fact-metric-quantile-data";
import { getFactTablesForMetrics } from "back-end/src/integrations/sql/fact-metrics/fact-tables-for-metrics";
import { getMetricData } from "back-end/src/integrations/sql/fact-metrics/metric-data";
import { processActivationMetric } from "back-end/src/integrations/sql/processing/process-activation-metric";

export function parseExperimentFactMetricsParams(
  dialect: SqlDialect,
  params: {
    metrics: FactMetricInterface[];
    activationMetric: ExperimentMetricInterface | null;
    settings: ExperimentSnapshotSettings;
    factTableMap: FactTableMap;
    lastMaxTimestamp: Date | null;
    covariateTableAlias: string;
    forcedUserIdType?: string;
  },
): {
  factTablesWithMetricData: FactMetricSourceData[];
  metricData: FactMetricData[];
} {
  const { settings } = params;
  const metricsWithIndices = cloneDeep(params.metrics).map((m, i) => ({
    metric: m,
    index: i,
  }));

  metricsWithIndices.forEach((m) => {
    applyMetricOverrides(m.metric, settings);
  });

  const activationMetric = processActivationMetric(
    params.activationMetric,
    settings,
  );

  const factTableMap = params.factTableMap;

  const factTablesWithMetrics = getFactTablesForMetrics(
    metricsWithIndices,
    factTableMap,
  );

  const metricData = metricsWithIndices.map((m) => {
    return getMetricData(
      dialect,
      { metric: m.metric, index: m.index },
      settings,
      activationMetric,
      factTablesWithMetrics,
      params.covariateTableAlias,
      `m${m.index}`,
    );
  });

  const factTablesWithMetricData = factTablesWithMetrics.map((f) => {
    const factTableMetricData = metricData.filter((m) =>
      f.metrics.some((fm) => fm.metric.id === m.metric.id),
    );

    const percentileData: FactMetricPercentileData[] = [];
    factTableMetricData
      .filter((m) => m.isPercentileCapped)
      .forEach((m) => {
        percentileData.push({
          valueCol: `${m.alias}_value`,
          outputCol: `${m.alias}_value_cap`,
          percentile: m.metric.cappingSettings.value ?? 1,
          ignoreZeros: m.metric.cappingSettings.ignoreZeros ?? false,
          sourceIndex: m.numeratorSourceIndex,
        });
        if (m.ratioMetric) {
          percentileData.push({
            valueCol: `${m.alias}_denominator`,
            outputCol: `${m.alias}_denominator_cap`,
            percentile: m.metric.cappingSettings.value ?? 1,
            ignoreZeros: m.metric.cappingSettings.ignoreZeros ?? false,
            sourceIndex: m.denominatorSourceIndex,
          });
        }
      });

    const eventQuantileData = getFactMetricQuantileData(
      factTableMetricData,
      "event",
    );

    const maxHoursToConvert = Math.max(
      ...factTableMetricData.map((m) => m.maxHoursToConvert),
    );

    const metricStart = factTableMetricData.reduce(
      (min, d) => (d.metricStart < min ? d.metricStart : min),
      settings.startDate,
    );
    const metricEnd = factTableMetricData.reduce(
      (max, d) => (d.metricEnd && d.metricEnd > max ? d.metricEnd : max),
      settings.endDate,
    );

    const lastMaxTimestamp = params.lastMaxTimestamp;
    const bindingLastMaxTimestamp =
      !!lastMaxTimestamp && lastMaxTimestamp > metricStart;
    const startDate =
      lastMaxTimestamp && bindingLastMaxTimestamp
        ? lastMaxTimestamp
        : metricStart;

    const regressionAdjustedMetrics = metricData.filter(
      (m) => m.regressionAdjusted,
    );
    const minCovariateStartDate = regressionAdjustedMetrics
      .map((m) => m.raMetricPhaseStartSettings.covariateStartDate)
      .sort((a, b) => a.getTime() - b.getTime())[0];
    const maxCovariateEndDate = regressionAdjustedMetrics
      .map((m) => m.raMetricPhaseStartSettings.covariateEndDate)
      .sort((a, b) => b.getTime() - a.getTime())[0];

    return {
      factTable: f.factTable,
      index: f.index,
      metricData,
      percentileData,
      eventQuantileData,
      maxHoursToConvert,
      metricStart: startDate,
      metricEnd,
      regressionAdjustedMetrics,
      minCovariateStartDate,
      maxCovariateEndDate,
      activationMetric,
      bindingLastMaxTimestamp,
    };
  });

  return {
    factTablesWithMetricData,
    metricData,
  };
}
