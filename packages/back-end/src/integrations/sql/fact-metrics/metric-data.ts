import {
  eligibleForUncappedMetric,
  ExperimentMetricInterface,
  getFactMetricPrimaryFactTableId,
  isFactFunnelMetric,
  isFactMetric,
  isPercentileCappedMetric,
  isRatioMetric,
  isRegressionAdjusted,
  quantileMetricType,
} from "shared/experiments";
import type { ExperimentSnapshotSettings } from "shared/types/experiment-snapshot";
import type {
  FactMetricInterface,
  FactTableInterface,
  MetricQuantileSettings,
} from "shared/types/fact-table";
import type { FactMetricData } from "shared/types/integrations";
import type { SqlDialect } from "shared/types/sql";

import { getAggregationMetadata } from "back-end/src/integrations/sql/fact-metrics/aggregation-metadata";
import { applyDailyParticipationTransformation } from "back-end/src/integrations/sql/processing/apply-daily-participation-transformation";
import { capCoalesceValue } from "back-end/src/integrations/sql/primitives/cap-coalesce-value";
import { getMaxHoursToConvert } from "back-end/src/integrations/sql/dates/max-hours-to-convert";
import { getMetricEnd } from "back-end/src/integrations/sql/dates/metric-end";
import { getMetricMinDelay } from "back-end/src/integrations/sql/dates/metric-min-delay";
import { getMetricStart } from "back-end/src/integrations/sql/dates/metric-start";
import { getRaMetricPhaseStartSettings } from "back-end/src/integrations/sql/dates/ra-metric-phase-start-settings";

export function getMetricRegressionAdjustmentData(
  metric: FactMetricInterface,
  regressionAdjustmentEnabled: boolean,
): {
  regressionAdjusted: boolean;
  regressionAdjustmentHours: number;
} {
  const regressionAdjusted =
    regressionAdjustmentEnabled && isRegressionAdjusted(metric);
  const regressionAdjustmentHours = regressionAdjusted
    ? (metric.regressionAdjustmentDays ?? 0) * 24
    : 0;
  return {
    regressionAdjusted,
    regressionAdjustmentHours,
  };
}

export function getMetricData(
  dialect: SqlDialect,
  metricWithIndex: { metric: FactMetricInterface; index: number },
  settings: Pick<
    ExperimentSnapshotSettings,
    "attributionModel" | "regressionAdjustmentEnabled" | "startDate"
  > & { endDate?: Date },
  activationMetric: ExperimentMetricInterface | null,
  factTablesWithIndices: { factTable: FactTableInterface; index: number }[],
  covariateTableAlias: string = "m",
  alias: string,
  /**
   * Set when every source's per-user columns sit on one table, so value
   * columns read from the bare `m` alias instead of the per-source `m{i}`.
   */
  flattenSources: boolean = false,
): FactMetricData {
  const { metric, index: metricIndex } = metricWithIndex;
  const ratioMetric = isRatioMetric(metric);
  const funnelMetric = isFactFunnelMetric(metric);
  const quantileMetric = funnelMetric ? "" : quantileMetricType(metric);
  const metricQuantileSettings: MetricQuantileSettings = (isFactMetric(
    metric,
  ) && !!quantileMetric
    ? metric.quantileSettings
    : undefined) ?? { type: "unit", quantile: 0, ignoreZeros: false };

  const { regressionAdjusted, regressionAdjustmentHours } = funnelMetric
    ? // TODO(funnel): CUPED for funnel metrics
      { regressionAdjusted: false, regressionAdjustmentHours: 0 }
    : getMetricRegressionAdjustmentData(
        metric,
        settings.regressionAdjustmentEnabled,
      );

  const overrideConversionWindows =
    settings.attributionModel === "experimentDuration" ||
    settings.attributionModel === "lookbackOverride";

  const isPercentileCapped = isPercentileCappedMetric(metric);
  const computeUncappedMetric = eligibleForUncappedMetric(metric);

  const sourceIndexForFactTable = (factTableId: string | undefined): number =>
    factTablesWithIndices.find((f) => f.factTable.id === factTableId)?.index ??
    0;

  const numeratorSourceIndex = sourceIndexForFactTable(
    getFactMetricPrimaryFactTableId(metric),
  );
  const denominatorSourceIndex = sourceIndexForFactTable(
    metric.denominator?.factTableId,
  );
  const funnelStepSourceIndices = isFactFunnelMetric(metric)
    ? metric.funnelSettings.steps.map((step) =>
        sourceIndexForFactTable(step.factTableId),
      )
    : [];
  const numeratorAlias = `${numeratorSourceIndex === 0 ? "" : numeratorSourceIndex}`;
  const denominatorAlias = `${denominatorSourceIndex === 0 ? "" : denominatorSourceIndex}`;
  // Cap values stay per-source even when the value columns do not: each source
  // gets its own __capValue CTE, cross joined under its own `cap{i}` alias.
  const numeratorValueAlias = flattenSources ? "" : numeratorAlias;
  const denominatorValueAlias = flattenSources ? "" : denominatorAlias;
  const capCoalesceMetric = capCoalesceValue(dialect, {
    valueCol: `m${numeratorValueAlias}.${alias}_value`,
    metric,
    capTablePrefix: `cap${numeratorAlias}`,
    capValueCol: `${alias}_value_cap`,
    columnRef: metric.numerator,
  });
  const capCoalesceDenominator = capCoalesceValue(dialect, {
    valueCol: `m${denominatorValueAlias}.${alias}_denominator`,
    metric,
    capTablePrefix: `cap${denominatorAlias}`,
    capValueCol: `${alias}_denominator_cap`,
    columnRef: metric.denominator,
  });
  const capCoalesceCovariate = capCoalesceValue(dialect, {
    valueCol: `${covariateTableAlias}${numeratorValueAlias}.${alias}_covariate_value`,
    metric,
    capTablePrefix: `cap${numeratorAlias}`,
    capValueCol: `${alias}_value_cap`,
    columnRef: metric.numerator,
  });
  const capCoalesceDenominatorCovariate = capCoalesceValue(dialect, {
    valueCol: `${covariateTableAlias}${denominatorValueAlias}.${alias}_covariate_denominator`,
    metric,
    capTablePrefix: `cap${denominatorAlias}`,
    capValueCol: `${alias}_denominator_cap`,
    columnRef: metric.denominator,
  });
  const uncappedMetric = {
    ...metric,
    cappingSettings: {
      type: "" as const,
      value: 0,
    },
  };
  const uncappedCoalesceMetric = capCoalesceValue(dialect, {
    valueCol: `m${numeratorValueAlias}.${alias}_value`,
    metric: uncappedMetric,
    capTablePrefix: `cap${numeratorAlias}`,
    capValueCol: `${alias}_value_cap`,
    columnRef: metric.numerator,
  });
  const uncappedCoalesceDenominator = capCoalesceValue(dialect, {
    valueCol: `m${denominatorValueAlias}.${alias}_denominator`,
    metric: uncappedMetric,
    capTablePrefix: `cap${denominatorAlias}`,
    capValueCol: `${alias}_denominator_cap`,
    columnRef: metric.denominator,
  });
  const uncappedCoalesceCovariate = capCoalesceValue(dialect, {
    valueCol: `${covariateTableAlias}${numeratorValueAlias}.${alias}_covariate_value`,
    metric: uncappedMetric,
    capTablePrefix: `cap${numeratorAlias}`,
    capValueCol: `${alias}_value_cap`,
    columnRef: metric.numerator,
  });
  const uncappedCoalesceDenominatorCovariate = capCoalesceValue(dialect, {
    valueCol: `${covariateTableAlias}${denominatorValueAlias}.${alias}_covariate_denominator`,
    metric: uncappedMetric,
    capTablePrefix: `cap${denominatorAlias}`,
    capValueCol: `${alias}_denominator_cap`,
    columnRef: metric.denominator,
  });

  const orderedMetrics = (activationMetric ? [activationMetric] : []).concat([
    metric,
  ]);
  const minMetricDelay = getMetricMinDelay(orderedMetrics);
  const metricStart = getMetricStart(
    settings.startDate,
    minMetricDelay,
    regressionAdjustmentHours,
  );
  const metricEnd = getMetricEnd(
    orderedMetrics,
    settings.endDate,
    overrideConversionWindows,
  );

  const raMetricPhaseStartSettings = getRaMetricPhaseStartSettings({
    minDelay: minMetricDelay,
    phaseStartDate: settings.startDate,
    regressionAdjustmentHours,
  });
  const raMetricFirstExposureSettings = {
    hours: regressionAdjustmentHours,
    minDelay: minMetricDelay,
    alias,
  };

  const maxHoursToConvert = getMaxHoursToConvert(
    funnelMetric,
    [metric],
    activationMetric,
  );

  const numeratorAggFns = getAggregationMetadata(dialect, {
    metric,
    useDenominator: false,
  });
  const denominatorAggFns = getAggregationMetadata(dialect, {
    metric,
    useDenominator: true,
  });

  const covariateNumeratorAggFns = getAggregationMetadata(dialect, {
    metric,
    useDenominator: false,
  });
  const covariateDenominatorAggFns = getAggregationMetadata(dialect, {
    metric,
    useDenominator: true,
  });

  const aggregatedValueTransformation =
    metric.metricType === "dailyParticipation"
      ? ({
          column,
          initialTimestampColumn,
          analysisEndDate,
        }: {
          column: string;
          initialTimestampColumn: string;
          analysisEndDate: Date;
        }) =>
          applyDailyParticipationTransformation(dialect, {
            column,
            initialTimestampColumn,
            analysisEndDate,
            metric,
            overrideConversionWindows,
          })
      : ({ column }: { column: string }) => column;

  return {
    alias,
    id: metric.id,
    metric,
    metricIndex,
    ratioMetric,
    funnelMetric,
    quantileMetric,
    metricQuantileSettings,
    regressionAdjusted,
    regressionAdjustmentHours,
    overrideConversionWindows,
    isPercentileCapped,
    computeUncappedMetric,
    numeratorSourceIndex,
    denominatorSourceIndex,
    funnelStepSourceIndices,
    capCoalesceMetric,
    capCoalesceDenominator,
    capCoalesceCovariate,
    capCoalesceDenominatorCovariate,
    numeratorAggFns,
    denominatorAggFns,
    covariateNumeratorAggFns,
    covariateDenominatorAggFns,
    uncappedCoalesceMetric,
    uncappedCoalesceDenominator,
    uncappedCoalesceCovariate,
    uncappedCoalesceDenominatorCovariate,
    minMetricDelay,
    raMetricFirstExposureSettings,
    raMetricPhaseStartSettings,
    metricStart,
    metricEnd,
    maxHoursToConvert,
    aggregatedValueTransformation,
  };
}
