import { SnapshotMetric } from "back-end/types/experiment-snapshot";
import { MetricInterface } from "back-end/types/metric";
import { CSSProperties } from "react";
import { formatConversionRate } from "@/services/metrics";
import { useCurrency } from "@/hooks/useCurrency";

const numberFormatter = new Intl.NumberFormat();

export default function MetricValueColumn({
  metric,
  stats,
  users,
  className,
  style,
  newUi = false,
  rowSpan,
}: {
  metric: MetricInterface;
  stats: SnapshotMetric;
  users: number;
  className?: string;
  style?: CSSProperties;
  newUi?: boolean;
  rowSpan?: number;
}) {
  const displayCurrency = useCurrency();
  return (
    <td className={className} style={style} rowSpan={rowSpan}>
      {metric && stats.users ? (
        <>
          <div className="result-number">
            {formatConversionRate(metric?.type, stats.cr, displayCurrency)}
          </div>
          <div className="result-number-sub">
            <small className="text-muted">
              <em
                style={{
                  display: "inline-block",
                  lineHeight: "1.3em",
                  marginTop: "0.2em",
                }}
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
            </small>
          </div>
        </>
      ) : (
        <em>no data</em>
      )}
    </td>
  );
}
