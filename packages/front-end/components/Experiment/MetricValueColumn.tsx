import { SnapshotMetric } from "back-end/types/experiment-snapshot";
import { CSSProperties, DetailedHTMLProps, TdHTMLAttributes } from "react";
import { ExperimentMetricInterface, isFactMetric } from "shared/experiments";
import {
  formatConversionRate,
  formatMetricValue,
  formatFactRefValue,
} from "@/services/metrics";
import { useCurrency } from "@/hooks/useCurrency";
import { useDefinitions } from "@/services/DefinitionsContext";

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
  newUi?: boolean;
  style?: CSSProperties;
  rowSpan?: number;
  showRatio?: boolean;
}

export default function MetricValueColumn({
  metric,
  stats,
  users,
  className,
  newUi = false,
  style,
  rowSpan,
  showRatio = true,
  ...otherProps
}: Props) {
  const displayCurrency = useCurrency();
  const { getFactTableById } = useDefinitions();

  const overall = formatMetricValue(
    metric,
    stats.cr,
    getFactTableById,
    displayCurrency
  );

  const numeratorValue = stats.value;
  const denominatorValue = stats.denominator || stats.users || users;

  let numerator: string;
  let denominator = numberFormatter.format(denominatorValue);
  if (isFactMetric(metric)) {
    numerator = formatFactRefValue(
      metric.numerator,
      getFactTableById,
      numeratorValue,
      displayCurrency
    );
    if (metric.metricType === "ratio" && metric.denominator) {
      denominator = formatFactRefValue(
        metric.denominator,
        getFactTableById,
        denominatorValue,
        displayCurrency
      );
    }
  } else {
    numerator = formatConversionRate(
      metric.type === "binomial" ? "count" : metric.type,
      numeratorValue,
      displayCurrency
    );
  }

  return (
    <td className={className} style={style} rowSpan={rowSpan} {...otherProps}>
      {metric && stats.users ? (
        <>
          <div className="result-number">{overall}</div>
          {showRatio ? (
            <div className="result-number-sub text-muted">
              <em
                style={
                  newUi
                    ? {}
                    : {
                        display: "inline-block",
                        lineHeight: "1.2em",
                        marginTop: "0.2em",
                      }
                }
              >
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
        <em className={newUi ? "text-muted" : ""}>no data</em>
      )}
    </td>
  );
}
