import clsx from "clsx";
import { SnapshotMetric } from "back-end/types/experiment-snapshot";
import { MetricInterface } from "back-end/types/metric";
import { ExperimentStatus } from "back-end/types/experiment";
import useConfidenceLevels from "@/hooks/useConfidenceLevels";
import {
  hasEnoughData,
  isBelowMinChange,
  isSuspiciousUplift,
  shouldHighlight as _shouldHighlight,
} from "@/services/experiments";
import { useOrganizationMetricDefaults } from "@/hooks/useOrganizationMetricDefaults";
import Tooltip from "../Tooltip/Tooltip";
import NotEnoughData from "./NotEnoughData";

const percentFormatter = new Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 2,
});

export default function ChanceToWinColumn({
  metric,
  status,
  isLatestPhase,
  startDate,
  snapshotDate,
  baseline,
  stats,
}: {
  metric: MetricInterface;
  status: ExperimentStatus;
  isLatestPhase: boolean;
  startDate: string;
  snapshotDate: Date;
  baseline: SnapshotMetric;
  stats: SnapshotMetric;
}) {
  const {
    getMinSampleSizeForMetric,
    metricDefaults,
  } = useOrganizationMetricDefaults();

  const minSampleSize = getMinSampleSizeForMetric(metric);
  const enoughData = hasEnoughData(baseline, stats, metric, metricDefaults);
  const suspiciousChange = isSuspiciousUplift(
    baseline,
    stats,
    metric,
    metricDefaults
  );
  const belowMinChange = isBelowMinChange(
    baseline,
    stats,
    metric,
    metricDefaults
  );
  const { ciUpper, ciLower } = useConfidenceLevels();

  const shouldHighlight = _shouldHighlight({
    metric,
    baseline,
    stats,
    hasEnoughData: enoughData,
    suspiciousChange,
    belowMinChange,
  });

  const chanceToWin = stats?.chanceToWin ?? 0;

  let sigText = "";
  let className = "";
  if (shouldHighlight && chanceToWin > ciUpper) {
    sigText = `Significant win as the chance to win is above the ${percentFormatter.format(
      ciUpper
    )} threshold`;
    className = "won";
  } else if (shouldHighlight && chanceToWin < ciLower) {
    sigText = `Significant loss as the chance to win is below the ${percentFormatter.format(
      ciLower
    )} threshold`;
    className = "lost";
  }
  if (belowMinChange && (chanceToWin > ciUpper || chanceToWin < ciLower)) {
    sigText =
      "The change is significant, but too small to matter (below the min detectable change threshold). Consider this a draw.";
    className += " draw";
  }

  return (
    <td
      className={clsx(
        "variation chance result-number align-middle d-table-cell",
        className
      )}
    >
      {enoughData && suspiciousChange && (
        <div>
          <div className="mb-1 d-flex flex-row">
            <Tooltip
              body={`A suspicious result occurs when the percent change is equal to or greater than your maximum percent change (${
                metric.maxPercentChange * 100
              }%).`}
            >
              <span className="badge badge-pill badge-warning">
                Suspicious Result
              </span>
            </Tooltip>
          </div>
        </div>
      )}
      <Tooltip
        body={sigText}
        className="d-block"
        tipPosition={"top"}
        shouldDisplay={sigText !== ""}
      >
        {!baseline?.value || !stats?.value ? (
          <em>no data</em>
        ) : !enoughData ? (
          <NotEnoughData
            experimentStatus={status}
            isLatestPhase={isLatestPhase}
            baselineValue={baseline?.value}
            variationValue={stats?.value}
            minSampleSize={minSampleSize}
            snapshotCreated={snapshotDate}
            phaseStart={startDate}
          />
        ) : (
          <>{percentFormatter.format(chanceToWin)}</>
        )}
      </Tooltip>
    </td>
  );
}
