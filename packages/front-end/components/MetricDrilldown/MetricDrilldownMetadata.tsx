import { Flex, Tooltip } from "@radix-ui/themes";
import { MdSwapCalls } from "react-icons/md";
import { quantileMetricType, isFactMetric } from "shared/experiments";
import { DEFAULT_PROPER_PRIOR_STDDEV } from "shared/constants";
import { StatsEngine } from "shared/types/stats";
import Metadata from "@/ui/Metadata";
import FactMetricTypeDisplayName from "@/components/Metrics/FactMetricTypeDisplayName";
import { getPercentileLabel } from "@/services/metrics";
import {
  capitalizeFirstLetter,
  isNullUndefinedOrEmpty,
} from "@/services/utils";
import { ExperimentTableRow } from "@/services/experiments";

export function MetricDrilldownMetadata({
  statsEngine,
  row,
}: {
  statsEngine: StatsEngine;
  row: ExperimentTableRow;
}) {
  const { metric, metricOverrideFields, metricSnapshotSettings } = row;

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

      {!isNullUndefinedOrEmpty(metric.cappingSettings.type) &&
      (metric.cappingSettings.value ?? 0) !== 0 ? (
        <Metadata
          label={`Capping (${metric.cappingSettings.type})`}
          value={metric.cappingSettings.value}
        />
      ) : null}

      {(!isNullUndefinedOrEmpty(metric.windowSettings.type) ||
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
