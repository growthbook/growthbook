import { Flex, Tooltip } from "@radix-ui/themes";
import { MdSwapCalls } from "react-icons/md";
import {
  ExperimentMetricDefinition,
  getLowerCappingSettings,
  hasActiveCappingTails,
  isAbsoluteCappedMetric,
  isFactMetric,
  isLowerAbsoluteCappedMetric,
  isLowerPercentileCappedMetric,
  isUpperPercentileCappedMetric,
  quantileMetricType,
} from "shared/experiments";
import { getCappingTailState, LookbackOverride } from "shared/validators";
import { DEFAULT_PROPER_PRIOR_STDDEV } from "shared/constants";
import { StatsEngine } from "shared/types/stats";
import { date } from "shared/dates";
import Metadata from "@/ui/Metadata";
import FactMetricTypeDisplayName from "@/components/Metrics/FactMetricTypeDisplayName";
import { getPercentileLabel } from "@/services/metrics";
import {
  capitalizeFirstLetter,
  isNullUndefinedOrEmpty,
} from "@/services/utils";
import { ExperimentTableRow } from "@/services/experiments";

/** Short label for tooltip / metadata when capping is enabled. */
function formatMetricCappingSummary(metric: ExperimentMetricDefinition) {
  const cs = metric.cappingSettings;
  const lower = getLowerCappingSettings(metric);
  const parts: string[] = [];
  if (isUpperPercentileCappedMetric(metric)) {
    parts.push(
      `Upper: ${100 * (cs.value as number)}%${cs.ignoreZeros ? " (ignore zeros)" : ""}`,
    );
  } else if (isAbsoluteCappedMetric(metric)) {
    parts.push(`Upper: ${cs.value}`);
  }
  if (isLowerPercentileCappedMetric(metric)) {
    parts.push(
      `Lower: ${100 * (lower?.value as number)}%${lower?.ignoreZeros ? " (ignore zeros)" : ""}`,
    );
  } else if (isLowerAbsoluteCappedMetric(metric)) {
    parts.push(`Lower: ${lower?.value}`);
  }
  return parts.join("; ");
}

export function MetricDrilldownMetadata({
  statsEngine,
  lookbackOverride,
  row,
}: {
  statsEngine: StatsEngine;
  lookbackOverride?: LookbackOverride;
  row: ExperimentTableRow;
}) {
  const { metric, metricOverrideFields, metricSnapshotSettings } = row;

  // Derive the capping label from the active tail(s) so a lower-only metric
  // doesn't render an empty "Capping ()". cappingSettings.type only reflects
  // the upper tail, which may be unset.
  const cappingTailState = getCappingTailState(
    metric.cappingSettings,
    getLowerCappingSettings(metric),
  );
  const cappingTypes = Array.from(
    new Set(
      [
        cappingTailState.upperPercentileCapped ||
        cappingTailState.lowerPercentileCapped
          ? "percentile"
          : null,
        cappingTailState.upperAbsoluteCapped ||
        cappingTailState.lowerAbsoluteCapped
          ? "absolute"
          : null,
      ].filter((t): t is string => t !== null),
    ),
  );
  const cappingLabel = cappingTypes.length
    ? `Capping (${cappingTypes.join(" / ")})`
    : "Capping";

  return (
    <Flex gap="4">
      <Metadata
        label="Type"
        value={
          <Flex gap="1" align="center">
            {isFactMetric(metric) ? (
              <FactMetricTypeDisplayName type={metric.metricType} />
            ) : (
              metric.type
            )}
            {metric.inverse ? (
              <Tooltip content="Metric is inverse, lower is better">
                <span>
                  <MdSwapCalls />
                </span>
              </Tooltip>
            ) : null}
          </Flex>
        }
      />

      {quantileMetricType(metric) !== "" ? (
        <>
          <Metadata
            label="Quantile"
            value={
              isFactMetric(metric) && metric.quantileSettings
                ? getPercentileLabel(metric.quantileSettings.quantile)
                : null
            }
          />
          <Metadata
            label="Quantile Type"
            value={
              isFactMetric(metric) && metric.quantileSettings
                ? `${
                    metric.quantileSettings.type === "unit"
                      ? "Per-user"
                      : "Events"
                  }${
                    metric.quantileSettings.ignoreZeros
                      ? " (ignoring zeros)"
                      : ""
                  }`
                : null
            }
          />
        </>
      ) : null}

      {hasActiveCappingTails(metric) ? (
        <Metadata
          label={cappingLabel}
          value={formatMetricCappingSummary(metric)}
        />
      ) : (
        <Metadata label="Capping" value="Disabled" />
      )}

      {/* Brute force show override from latest experiment settings, but we could instead show computed window from 
      metricForSnapshot, but would require potentially reconstructing more settings*/}
      {lookbackOverride ? (
        <Metadata
          label="Lookback Window Override"
          value={
            lookbackOverride.type === "date"
              ? `${date(lookbackOverride.value)} - now/end`
              : `${lookbackOverride.value} ${lookbackOverride.valueUnit}`
          }
        />
      ) : (!isNullUndefinedOrEmpty(metric.windowSettings.type) ||
          metricOverrideFields.includes("windowType")) &&
        (metric.windowSettings.windowValue !== 0 ||
          metricOverrideFields.includes("windowHours")) ? (
        <Metadata
          label={`${capitalizeFirstLetter(
            metric.windowSettings.type || "no",
          )} Window`}
          value={
            <>
              {metric.windowSettings.type
                ? `${metric.windowSettings.windowValue} ${metric.windowSettings.windowUnit}`
                : ""}
              {metricOverrideFields.includes("windowType") ||
              metricOverrideFields.includes("windowHours") ? (
                <small className="text-purple ml-1">(override)</small>
              ) : null}
            </>
          }
        />
      ) : null}

      {(metric.windowSettings.delayValue ?? 0) !== 0 ||
      metricOverrideFields.includes("delayHours") ? (
        <Metadata
          label={
            isFactMetric(metric) && metric.metricType === "retention"
              ? "Retention Window"
              : "Metric Delay"
          }
          value={
            <>
              {`${metric.windowSettings.delayValue} ${metric.windowSettings.delayUnit}`}
              {metricOverrideFields.includes("delayHours") ? (
                <small className="text-purple ml-1">(override)</small>
              ) : null}
            </>
          }
        />
      ) : null}

      {statsEngine === "bayesian" ? (
        <Metadata
          label="Bayesian Prior"
          value={
            <>
              {metricSnapshotSettings?.properPrior
                ? `Mean: ${
                    metricSnapshotSettings?.properPriorMean ?? 0
                  }, Std. Dev.: ${
                    metricSnapshotSettings?.properPriorStdDev ??
                    DEFAULT_PROPER_PRIOR_STDDEV
                  }`
                : "Disabled"}
              {metricOverrideFields.includes("prior") ? (
                <small className="text-purple ml-1">(override)</small>
              ) : null}
            </>
          }
        />
      ) : null}

      {metricSnapshotSettings ? (
        <Metadata
          label="CUPED"
          value={
            <>
              {metricSnapshotSettings?.regressionAdjustmentEnabled
                ? "Enabled"
                : "Disabled"}
              {metricOverrideFields.includes("regressionAdjustmentEnabled") ? (
                <small className="text-purple ml-1">(override)</small>
              ) : null}
            </>
          }
        />
      ) : null}

      {metricSnapshotSettings?.regressionAdjustmentEnabled ? (
        <Metadata
          label="CUPED Lookback (days)"
          value={
            <>
              {metricSnapshotSettings?.regressionAdjustmentDays}
              {metricOverrideFields.includes("regressionAdjustmentDays") ? (
                <small className="text-purple ml-1">(override)</small>
              ) : null}
            </>
          }
        />
      ) : null}
    </Flex>
  );
}
