import { SnapshotMetric } from "back-end/types/experiment-snapshot";
import { MetricInterface } from "back-end/types/metric";
import { CSSProperties, DetailedHTMLProps, HTMLAttributes } from "react";
import { formatConversionRate } from "@/services/metrics";
import { useCurrency } from "@/hooks/useCurrency";

const numberFormatter = new Intl.NumberFormat();

interface Props
  extends DetailedHTMLProps<HTMLAttributes<HTMLDivElement>, HTMLDivElement> {
  metric: MetricInterface;
  stats: SnapshotMetric;
  users: number;
  className?: string;
  style?: CSSProperties;
  rowSpan?: number;
}

export default function MetricValueColumn({
  metric,
  stats,
  users,
  className,
  style,
  rowSpan,
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
