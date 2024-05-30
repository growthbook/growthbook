import clsx from "clsx";
import {
  ExperimentMetricInterface,
  isFactMetric,
  quantileMetricType,
} from "shared/experiments";
import React from "react";
import { DEFAULT_PROPER_PRIOR_STDDEV } from "shared/constants";
import { StatsEngine } from "@back-end/types/stats";
import {
  capitalizeFirstLetter,
  isNullUndefinedOrEmpty,
} from "@/services/utils";
import { ExperimentTableRow } from "@/services/experiments";
import Markdown from "@/components/Markdown/Markdown";
import SortedTags from "@/components/Tags/SortedTags";
import { getPercentileLabel } from "@/services/metrics";
import styles from "./MetricToolTipBody.module.scss";
import MetricName from "./MetricName";

interface MetricToolTipCompProps {
  metric: ExperimentMetricInterface;
  row?: ExperimentTableRow;
  statsEngine?: StatsEngine;
  reportRegressionAdjustmentEnabled?: boolean;
}

interface MetricInfo {
  show: boolean;
  label: string;
  body: string | number | JSX.Element;
  markdown?: boolean;
}

const MetricTooltipBody = ({
  metric,
  row,
  statsEngine,
  reportRegressionAdjustmentEnabled,
}: MetricToolTipCompProps): React.ReactElement => {
  function validMetricDescription(description: string): boolean {
    if (!description) return false;
    const regExp = new RegExp(/[A-Za-z0-9]/);
    return regExp.test(description);
  }

  const metricOverrideFields = row?.metricOverrideFields ?? [];

  const metricInfo: MetricInfo[] = [
    {
      show: true,
      label: "Type",
      body: isFactMetric(metric) ? metric.metricType : metric.type,
    },
    {
      show: (metric.tags?.length ?? 0) > 0,
      label: "Tags",
      body: (
        <SortedTags
          tags={metric.tags}
          shouldShowEllipsis={false}
          useFlex={true}
        />
      ),
    },
    {
      show: !!quantileMetricType(metric),
      label: "Quantile",
      body: (
        <>
          {isFactMetric(metric) && metric.quantileSettings
            ? getPercentileLabel(metric.quantileSettings.quantile)
            : null}
        </>
      ),
    },
    {
      show: !!quantileMetricType(metric),
      label: "Quantile Type",
      body: (
        <>
          {isFactMetric(metric) && metric.quantileSettings
            ? `${
                metric.quantileSettings.type === "unit" ? "Per-user" : "Events"
              }${
                metric.quantileSettings.ignoreZeros ? " (ignoring zeros)" : ""
              }`
            : null}
        </>
      ),
    },
    {
      show:
        !isNullUndefinedOrEmpty(metric.cappingSettings.type) &&
        (metric.cappingSettings.value ?? 0) !== 0,
      label: `Capping (${metric.cappingSettings.type})`,
      body: metric.cappingSettings.value ?? 0,
    },
    {
      show:
        (!isNullUndefinedOrEmpty(metric.windowSettings.type) ||
          metricOverrideFields.includes("windowType")) &&
        (metric.windowSettings.windowValue !== 0 ||
          metricOverrideFields.includes("windowHours")),
      label: `${capitalizeFirstLetter(
        metric.windowSettings.type || "no"
      )} Window`,
      body: (
        <>
          {metric.windowSettings.type
            ? `${metric.windowSettings.windowValue} ${metric.windowSettings.windowUnit}`
            : ""}
          {metricOverrideFields.includes("windowType") ||
          metricOverrideFields.includes("windowHours") ? (
            <small className="text-purple ml-1">(override)</small>
          ) : null}
        </>
      ),
    },
    {
      show:
        (metric.windowSettings.delayHours ?? 0) !== 0 ||
        metricOverrideFields.includes("delayHours"),
      label: "Metric Delay Hours",
      body: (
        <>
          {metric.windowSettings.delayHours}
          {metricOverrideFields.includes("delayHours") ? (
            <small className="text-purple ml-1">(override)</small>
          ) : null}
        </>
      ),
    },
  ];

  if (statsEngine === "bayesian") {
    metricInfo.push({
      show: true,
      label: "Bayesian Prior",
      body: (
        <>
          {row?.metricSnapshotSettings?.properPrior
            ? `Mean: ${
                row?.metricSnapshotSettings?.properPriorMean ?? 0
              }, Std. Dev.: ${
                row?.metricSnapshotSettings?.properPriorStdDev ??
                DEFAULT_PROPER_PRIOR_STDDEV
              }`
            : "Disabled"}
          {metricOverrideFields.includes("prior") ? (
            <small className="text-purple ml-1">(override)</small>
          ) : null}
        </>
      ),
    });
  }

  if (reportRegressionAdjustmentEnabled && row) {
    metricInfo.push({
      show: true,
      label: "CUPED",
      body: (
        <>
          {row?.metricSnapshotSettings?.regressionAdjustmentEnabled
            ? "Enabled"
            : "Disabled"}
          {metricOverrideFields.includes("regressionAdjustmentEnabled") ? (
            <small className="text-purple ml-1">(override)</small>
          ) : null}
        </>
      ),
    });
    if (row?.metricSnapshotSettings?.regressionAdjustmentEnabled) {
      metricInfo.push({
        show: true,
        label: "CUPED Lookback (days)",
        body: (
          <>
            {row?.metricSnapshotSettings?.regressionAdjustmentDays}
            {metricOverrideFields.includes("regressionAdjustmentDays") ? (
              <small className="text-purple ml-1">(override)</small>
            ) : null}
          </>
        ),
      });
    }
  }

  metricInfo.push({
    show: validMetricDescription(metric.description),
    label: "Description",
    body: metric.description,
    markdown: true,
  });

  return (
    <div>
      <h4>
        <MetricName id={metric.id} showOfficialLabel disableTooltip />
      </h4>
      <table className="table table-sm table-bordered text-left mb-0">
        <tbody>
          {metricInfo
            .filter((i) => i.show)
            .map(({ label, body, markdown }, index) => (
              <tr key={`metricInfo${index}`}>
                <td
                  className="text-right font-weight-bold py-1 align-middle"
                  style={{
                    width: 120,
                    border: "1px solid var(--border-color-100)",
                    fontSize: "12px",
                    lineHeight: "14px",
                  }}
                >{`${label}`}</td>
                <td
                  className="py-1 align-middle"
                  style={{
                    minWidth: 180,
                    border: "1px solid var(--border-color-100)",
                    fontSize: "12px",
                    lineHeight: "14px",
                  }}
                >
                  {markdown ? (
                    <div
                      className={clsx("border rounded p-1", styles.markdown)}
                    >
                      <Markdown>{body}</Markdown>
                    </div>
                  ) : (
                    <span className="font-weight-normal">{body}</span>
                  )}
                </td>
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  );
};

export default MetricTooltipBody;
