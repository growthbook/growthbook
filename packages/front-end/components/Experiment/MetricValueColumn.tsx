import { SnapshotMetric } from "shared/types/experiment-snapshot";
import {
  CSSProperties,
  DetailedHTMLProps,
  ReactElement,
  TdHTMLAttributes,
} from "react";
import {
  ExperimentMetricInterface,
  isFactMetric,
  isRatioMetric,
  quantileMetricType,
} from "shared/experiments";
import { FactTableInterface } from "shared/types/fact-table";
import {
  getColumnRefFormatter,
  getExperimentMetricFormatter,
  getMetricFormatter,
} from "@/services/metrics";
import ConditionalWrapper from "@/components/ConditionalWrapper";

const numberFormatter = Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

/**
 * Stats engine sometimes omits or zeroes `cr` while `value` / user counts are
 * populated (e.g. safe-rollout snapshots). Derive a per-user rate for display.
 */
function effectiveCrForDisplay(
  metric: ExperimentMetricInterface,
  stats: SnapshotMetric,
): number {
  const cr = stats.cr;
  const value = stats.value ?? 0;
  const brokenCr =
    cr === 0 ||
    cr === undefined ||
    (typeof cr === "number" && Number.isNaN(cr));

  if (!isFactMetric(metric) || !brokenCr || value === 0) {
    return cr;
  }

  if (metric.metricType === "ratio" && metric.denominator) {
    const denom = stats.denominator ?? stats.users;
    if (denom) {
      return value / denom;
    }
  }

  if (stats.users > 0) {
    return value / stats.users;
  }

  return cr ?? 0;
}

interface Props
  extends DetailedHTMLProps<
    TdHTMLAttributes<HTMLTableCellElement>,
    HTMLTableCellElement
  > {
  metric: ExperimentMetricInterface;
  stats: SnapshotMetric;
  users: number;
  className?: string;
  style?: CSSProperties;
  rowSpan?: number;
  showRatio?: boolean;
  noDataMessage?: ReactElement | string;
  displayCurrency: string;
  getExperimentMetricById: (id: string) => null | ExperimentMetricInterface;
  getFactTableById: (id: string) => null | FactTableInterface;
  asTd?: boolean;
}

export default function MetricValueColumn({
  metric,
  stats,
  users,
  className,
  style,
  rowSpan,
  showRatio = true,
  noDataMessage = "No data",
  displayCurrency,
  getExperimentMetricById,
  getFactTableById,
  asTd = true,
  ...otherProps
}: Props) {
  const formatterOptions = { currency: displayCurrency };

  const crForDisplay = effectiveCrForDisplay(metric, stats);

  const overall = getExperimentMetricFormatter(metric, getFactTableById)(
    crForDisplay,
    formatterOptions,
  );

  const numeratorValue = stats.value;
  const denominatorValue = isRatioMetric(
    metric,
    !isFactMetric(metric) && metric.denominator
      ? (getExperimentMetricById(metric.denominator) ?? undefined)
      : undefined,
  )
    ? (stats.denominator ?? stats.users)
    : stats.denominator || stats.users || users;

  let numerator: string;
  let denominator = numberFormatter.format(denominatorValue);

  const quantileMetric = quantileMetricType(metric);
  if (quantileMetric && stats.stats?.count !== undefined) {
    numerator = `${numberFormatter.format(stats.stats.count)} ${
      quantileMetric === "event" ? "events" : "users"
    }`;
  } else if (isFactMetric(metric)) {
    numerator = getColumnRefFormatter(metric.numerator, getFactTableById)(
      numeratorValue,
      formatterOptions,
    );
    if (metric.metricType === "ratio" && metric.denominator) {
      denominator = getColumnRefFormatter(metric.denominator, getFactTableById)(
        denominatorValue,
        formatterOptions,
      );
    }
  } else {
    numerator = getMetricFormatter(
      metric.type === "binomial" ? "count" : metric.type,
    )(numeratorValue, formatterOptions);
  }

  return (
    <ConditionalWrapper
      condition={asTd}
      wrapper={
        <td
          className={className}
          style={style}
          rowSpan={rowSpan}
          {...otherProps}
        />
      }
    >
      {metric && stats.users ? (
        <>
          <div className="result-number">{overall}</div>
          {showRatio && numerator ? (
            <div className="result-number-sub text-muted">
              <em>
                <span
                  style={{
                    whiteSpace: "nowrap",
                  }}
                >
                  {numerator}
                </span>
                {!quantileMetric ? (
                  <>
                    {" "}
                    /&nbsp;
                    {denominator}
                  </>
                ) : null}
              </em>
            </div>
          ) : null}
        </>
      ) : (
        <em className="text-muted small">{noDataMessage}</em>
      )}
    </ConditionalWrapper>
  );
}
