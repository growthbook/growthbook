import { SnapshotMetric } from "back-end/types/experiment-snapshot";
import { MetricInterface } from "back-end/types/metric";
import { CSSProperties, DetailedHTMLProps, TdHTMLAttributes } from "react";
import { formatConversionRate } from "@/services/metrics";
import { useCurrency } from "@/hooks/useCurrency";

const numberFormatter = Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

interface Props
  extends DetailedHTMLProps<
    TdHTMLAttributes<HTMLTableCellElement>,
    HTMLTableCellElement
  > {
  metric: MetricInterface;
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
  return (
    <td className={className} style={style} rowSpan={rowSpan} {...otherProps}>
      {metric && stats.users ? (
        <>
          <div className="result-number">
            {formatConversionRate(metric?.type, stats.cr, displayCurrency)}
          </div>
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
                  {formatConversionRate(
                    metric.type === "binomial" ? "count" : metric.type,
                    stats.value,
                    displayCurrency
                  )}
                </span>{" "}
                /&nbsp;
                {numberFormatter.format(
                  stats.denominator || stats.users || users
                )}
              </em>
            </div>
          ) : null}
        </>
      ) : (
        <em>no data</em>
      )}
    </td>
  );
}
