import { SnapshotMetric } from "back-end/types/experiment-snapshot";
import { MetricInterface } from "back-end/types/metric";
import { formatConversionRate } from "@/services/metrics";
import useOrgSettings from "@/hooks/useOrgSettings";
import { supportedCurrencies, SupportedCurrencies } from "@/pages/settings";

const numberFormatter = new Intl.NumberFormat();

export default function MetricValueColumn({
  metric,
  stats,
  users,
  className,
}: {
  metric: MetricInterface;
  stats: SnapshotMetric;
  users: number;
  className?: string;
}) {
  const orgSettings = useOrgSettings();

  const displayCurrency =
    (Object.keys(supportedCurrencies).find(
      (key) => key === orgSettings.displayCurrency
    ) as SupportedCurrencies) || "USD";
  return (
    <td className={className}>
      {metric && stats.users ? (
        <>
          <div className="result-number">
            {formatConversionRate(metric?.type, stats.cr, displayCurrency)}
          </div>
          <div>
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
