import { SnapshotMetric } from "back-end/types/experiment-snapshot";
import { CSSProperties, DetailedHTMLProps, TdHTMLAttributes } from "react";
import { ExperimentMetricInterface, isFactMetric } from "shared/experiments";
import {
  getColumnRefFormatter,
  getExperimentMetricFormatter,
  getMetricFormatter,
} from "@front-end/services/metrics";
import { useCurrency } from "@front-end/hooks/useCurrency";
import { useDefinitions } from "@front-end/services/DefinitionsContext";

const numberFormatter = Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

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
}

export default function MetricValueColumn({
  metric,
  stats,
  users,
  className,
  style,
  rowSpan,
  showRatio = true,
  ...otherProps
}: Props) {
  const displayCurrency = useCurrency();
  const formatterOptions = { currency: displayCurrency };
  const { getFactTableById } = useDefinitions();

  const overall = getExperimentMetricFormatter(metric, getFactTableById)(
    stats.cr,
    formatterOptions
  );

  const numeratorValue = stats.value;
  const denominatorValue = stats.denominator || stats.users || users;

  let numerator: string;
  let denominator = numberFormatter.format(denominatorValue);

  if (isFactMetric(metric)) {
    numerator = getColumnRefFormatter(metric.numerator, getFactTableById)(
      numeratorValue,
      formatterOptions
    );
    if (metric.metricType === "ratio" && metric.denominator) {
      denominator = getColumnRefFormatter(metric.denominator, getFactTableById)(
        denominatorValue,
        formatterOptions
      );
    }
  } else {
    numerator = getMetricFormatter(
      metric.type === "binomial" ? "count" : metric.type
    )(numeratorValue, formatterOptions);
  }

  return (
    <td className={className} style={style} rowSpan={rowSpan} {...otherProps}>
      {metric && stats.users ? (
        <>
          <div className="result-number">{overall}</div>
          {showRatio ? (
            <div className="result-number-sub text-muted">
              <em>
                <span
                  style={{
                    whiteSpace: "nowrap",
                  }}
                >
                  {numerator}
                </span>{" "}
                /&nbsp;
                {denominator}
              </em>
            </div>
          ) : null}
        </>
      ) : (
        <em className="text-muted">no data</em>
      )}
    </td>
  );
}
