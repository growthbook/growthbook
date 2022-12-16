import clsx from "clsx";
import { ExperimentTableRow, getRisk } from "@/services/experiments";
import {
  defaultLoseRiskThreshold,
  defaultWinRiskThreshold,
  formatConversionRate,
} from "@/services/metrics";
import { useOrganizationMetricDefaults } from "@/hooks/useOrganizationMetricDefaults";

const percentFormatter = new Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 2,
});

export default function RiskColumn({
  row,
  riskVariation,
}: {
  row: ExperimentTableRow;
  riskVariation: number;
}) {
  const { metricDefaults } = useOrganizationMetricDefaults();
  const { relativeRisk, risk, showRisk } = getRisk(
    riskVariation,
    row,
    metricDefaults
  );

  const winRiskThreshold = row.metric.winRisk ?? defaultWinRiskThreshold;
  const loseRiskThreshold = row.metric.loseRisk ?? defaultLoseRiskThreshold;

  if (!row.variations[0]?.value || !showRisk) {
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
      {row.metric.type !== "binomial" && (
        <div>
          <small className="text-muted">
            <em>
              {formatConversionRate(row.metric.type, risk)}
              &nbsp;/&nbsp;user
            </em>
          </small>
        </div>
      )}
    </td>
  );
}
