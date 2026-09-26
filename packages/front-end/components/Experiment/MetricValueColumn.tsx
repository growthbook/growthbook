import { SnapshotMetric } from "shared/types/experiment-snapshot";
import {
  CSSProperties,
  DetailedHTMLProps,
  ReactElement,
  TdHTMLAttributes,
} from "react";
import {
  ExperimentMetricDefinition,
  isFactMetric,
  isRatioMetric,
  quantileMetricType,
} from "shared/experiments";
import { FactTableDefinition } from "shared/types/fact-table";
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
  metric: ExperimentMetricDefinition,
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
  metric: ExperimentMetricDefinition;
  stats: SnapshotMetric;
  users: number;
  className?: string;
  style?: CSSProperties;
  rowSpan?: number;
  showRatio?: boolean;
  noDataMessage?: ReactElement | string;
  displayCurrency: string;
  getExperimentMetricById: (id: string) => null | ExperimentMetricDefinition;
  getFactTableById: (id: string) => null | FactTableDefinition;
  asTd?: boolean;
  // Differentiates the same component rendered as the baseline vs. the
  // treatment column. Drives the data-field name so both values can be
  // extracted without one overwriting the other under a single key.
  cellRole?: "baseline" | "treatment";
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
  cellRole = "treatment",
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

  // Field names for programmatic value extraction. Baseline cells are prefixed
  // so they don't collide with the treatment cell's values under one key.
  const fieldPrefix = cellRole === "baseline" ? "baseline_" : "";
  const metricValueField = `${fieldPrefix}metric_value`;
  const userCountField = `${fieldPrefix}user_count`;

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
          {/* Stable field name for programmatic value extraction */}
          <div className="result-number" data-field={metricValueField}>
            {overall}
          </div>
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
                    {/* Stable field name for programmatic value extraction */}
                    <span data-field={userCountField}>{denominator}</span>
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
