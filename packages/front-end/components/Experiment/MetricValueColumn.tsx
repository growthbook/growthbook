import { SnapshotMetric } from "back-end/types/experiment-snapshot";
import { MetricInterface } from "back-end/types/metric";
import { formatConversionRate } from "@/services/metrics";
import { useCurrency } from "@/hooks/useCurrency";

const numberFormatter = new Intl.NumberFormat();

export default function MetricValueColumn({
  metric,
  stats,
  users,
  className,
  newUi = false,
}: {
  metric: MetricInterface;
  stats: SnapshotMetric;
  users: number;
  className?: string;
  newUi?: boolean;
}) {
  const displayCurrency = useCurrency();
  return (
    <td className={className}>
      {metric && stats.users ? (
        <>
          <div className="result-number" style={ newUi ? {lineHeight: "10px", fontWeight: "bold"} : {}}>
            {formatConversionRate(metric?.type, stats.cr, displayCurrency)}
          </div>
          <div style={ newUi ? {lineHeight: "12px", textAlign: "right"} : {}}>
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
