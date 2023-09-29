import clsx from "clsx";
import { ExperimentTableRow, getRiskByVariation } from "@/services/experiments";
import {
  defaultLoseRiskThreshold,
  defaultWinRiskThreshold,
  formatMetricValue,
} from "@/services/metrics";
import { useOrganizationMetricDefaults } from "@/hooks/useOrganizationMetricDefaults";
import { useCurrency } from "@/hooks/useCurrency";
import { useDefinitions } from "@/services/DefinitionsContext";

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
  const { relativeRisk, risk, showRisk } = getRiskByVariation(
    riskVariation,
    row,
    metricDefaults
  );
  const displayCurrency = useCurrency();
  const { getFactTableById } = useDefinitions();

  const winRiskThreshold = row.metric.winRisk ?? defaultWinRiskThreshold;
  const loseRiskThreshold = row.metric.loseRisk ?? defaultLoseRiskThreshold;

  if (!row.variations[0]?.value || !showRisk) {
    return <td className="empty-td"></td>;
  }

  const showRatio =
    ("type" in row.metric && row.metric.type !== "binomial") ||
    ("metricType" in row.metric && row.metric.metricType !== "proportion");

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
      {showRatio && (
        <div>
          <small className="text-muted">
            <em>
              {formatMetricValue(
                row.metric,
                risk,
                getFactTableById,
                displayCurrency
              )}
              &nbsp;/&nbsp;user
            </em>
          </small>
        </div>
      )}
    </td>
  );
}
