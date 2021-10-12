import clsx from "clsx";
import { SnapshotVariation } from "back-end/types/experiment-snapshot";
import { MetricInterface } from "back-end/types/metric";
import { getRisk } from "../../services/experiments";
import {
  defaultLoseRiskThreshold,
  defaultWinRiskThreshold,
  formatConversionRate,
} from "../../services/metrics";

const percentFormatter = new Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 2,
});

export default function RiskColumn({
  metric,
  baselineValue,
  variations,
  riskVariation,
}: {
  metric: MetricInterface;
  baselineValue: number;
  variations: SnapshotVariation[];
  riskVariation: number;
}) {
  const { relativeRisk, risk, showRisk } = getRisk(
    riskVariation,
    metric,
    variations
  );

  const winRiskThreshold = metric?.winRisk || defaultWinRiskThreshold;
  const loseRiskThreshold = metric?.loseRisk || defaultLoseRiskThreshold;

  if (!baselineValue || !showRisk) {
    return <td className="empty-td"></td>;
  }

  return (
    <td
      className={clsx("chance variation align-middle", {
        won: showRisk && relativeRisk <= winRiskThreshold,
        lost: showRisk && relativeRisk >= loseRiskThreshold,
        warning:
          showRisk &&
          relativeRisk > winRiskThreshold &&
          relativeRisk < loseRiskThreshold,
      })}
    >
      <div className="result-number">
        {percentFormatter.format(relativeRisk)}
      </div>
      {metric?.type !== "binomial" && (
        <div>
          <small className="text-muted">
            <em>
              {formatConversionRate(metric?.type, risk)}
              &nbsp;/&nbsp;user
            </em>
          </small>
        </div>
      )}
    </td>
  );
}
