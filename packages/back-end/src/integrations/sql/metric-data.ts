import {
  eligibleForUncappedMetric,
  ExperimentMetricInterface,
  isFactMetric,
  isFunnelMetric,
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
import type { SqlHelpers } from "shared/types/sql";

import { getAggregationMetadata } from "./aggregation-metadata";
import { applyDailyParticipationTransformation } from "./apply-daily-participation-transformation";
import { capCoalesceValue } from "./cap-coalesce-value";
import { getMaxHoursToConvert } from "./max-hours-to-convert";
import { getMetricEnd } from "./metric-end";
import { getMetricMinDelay } from "./metric-min-delay";
import { getMetricStart } from "./metric-start";
import { getRaMetricPhaseStartSettings } from "./ra-metric-phase-start-settings";

export function getMetricData(
  helpers: SqlHelpers,
  metricWithIndex: { metric: FactMetricInterface; index: number },
  settings: Pick<
    ExperimentSnapshotSettings,
    "attributionModel" | "regressionAdjustmentEnabled" | "startDate"
  > & { endDate?: Date },
  activationMetric: ExperimentMetricInterface | null,
  factTablesWithIndices: { factTable: FactTableInterface; index: number }[],
  covariateTableAlias: string = "m",
  alias: string,
): FactMetricData {
  const { metric, index: metricIndex } = metricWithIndex;
  const ratioMetric = isRatioMetric(metric);
  const funnelMetric = isFunnelMetric(metric);
  const quantileMetric = quantileMetricType(metric);
  const metricQuantileSettings: MetricQuantileSettings = (isFactMetric(
    metric,
  ) && !!quantileMetric
    ? metric.quantileSettings
    : undefined) ?? { type: "unit", quantile: 0, ignoreZeros: false };

  const regressionAdjusted =
    settings.regressionAdjustmentEnabled && isRegressionAdjusted(metric);
  const regressionAdjustmentHours = regressionAdjusted
    ? (metric.regressionAdjustmentDays ?? 0) * 24
    : 0;

  const overrideConversionWindows =
    settings.attributionModel === "experimentDuration" ||
    settings.attributionModel === "lookbackOverride";

  const isPercentileCapped = isPercentileCappedMetric(metric);
  const computeUncappedMetric = eligibleForUncappedMetric(metric);

  const numeratorSourceIndex =
    factTablesWithIndices.find(
      (f) => f.factTable.id === metric.numerator?.factTableId,
    )?.index ?? 0;
  const denominatorSourceIndex =
    factTablesWithIndices.find(
      (f) => f.factTable.id === metric.denominator?.factTableId,
    )?.index ?? 0;
  const numeratorAlias = `${numeratorSourceIndex === 0 ? "" : numeratorSourceIndex}`;
  const denominatorAlias = `${denominatorSourceIndex === 0 ? "" : denominatorSourceIndex}`;
  const capCoalesceMetric = capCoalesceValue(helpers, {
    valueCol: `m${numeratorAlias}.${alias}_value`,
    metric,
    capTablePrefix: `cap${numeratorAlias}`,
    capValueCol: `${alias}_value_cap`,
    columnRef: metric.numerator,
  });
  const capCoalesceDenominator = capCoalesceValue(helpers, {
    valueCol: `m${denominatorAlias}.${alias}_denominator`,
    metric,
    capTablePrefix: `cap${denominatorAlias}`,
    capValueCol: `${alias}_denominator_cap`,
    columnRef: metric.denominator,
  });
  const capCoalesceCovariate = capCoalesceValue(helpers, {
    valueCol: `${covariateTableAlias}${numeratorAlias}.${alias}_covariate_value`,
    metric,
    capTablePrefix: `cap${numeratorAlias}`,
    capValueCol: `${alias}_value_cap`,
    columnRef: metric.numerator,
  });
  const capCoalesceDenominatorCovariate = capCoalesceValue(helpers, {
    valueCol: `${covariateTableAlias}${denominatorAlias}.${alias}_covariate_denominator`,
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
  const uncappedCoalesceMetric = capCoalesceValue(helpers, {
    valueCol: `m${numeratorAlias}.${alias}_value`,
    metric: uncappedMetric,
    capTablePrefix: `cap${numeratorAlias}`,
    capValueCol: `${alias}_value_cap`,
    columnRef: metric.numerator,
  });
  const uncappedCoalesceDenominator = capCoalesceValue(helpers, {
    valueCol: `m${denominatorAlias}.${alias}_denominator`,
    metric: uncappedMetric,
    capTablePrefix: `cap${denominatorAlias}`,
    capValueCol: `${alias}_denominator_cap`,
    columnRef: metric.denominator,
  });
  const uncappedCoalesceCovariate = capCoalesceValue(helpers, {
    valueCol: `${covariateTableAlias}${numeratorAlias}.${alias}_covariate_value`,
    metric: uncappedMetric,
    capTablePrefix: `cap${numeratorAlias}`,
    capValueCol: `${alias}_value_cap`,
    columnRef: metric.numerator,
  });
  const uncappedCoalesceDenominatorCovariate = capCoalesceValue(helpers, {
    valueCol: `${covariateTableAlias}${denominatorAlias}.${alias}_covariate_denominator`,
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

  const numeratorAggFns = getAggregationMetadata(helpers, {
    metric,
    useDenominator: false,
  });
  const denominatorAggFns = getAggregationMetadata(helpers, {
    metric,
    useDenominator: true,
  });

  const covariateNumeratorAggFns = getAggregationMetadata(helpers, {
    metric,
    useDenominator: false,
  });
  const covariateDenominatorAggFns = getAggregationMetadata(helpers, {
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
          applyDailyParticipationTransformation(helpers, {
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
