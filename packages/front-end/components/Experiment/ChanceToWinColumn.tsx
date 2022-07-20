import clsx from "clsx";
import { SnapshotMetric } from "back-end/types/experiment-snapshot";
import { MetricInterface } from "back-end/types/metric";
import useConfidenceLevels from "../../hooks/useConfidenceLevels";
import {
  hasEnoughData,
  isBelowMinChange,
  isSuspiciousUplift,
} from "../../services/experiments";
import { defaultMinSampleSize } from "../../services/metrics";
import NotEnoughData from "./NotEnoughData";
import { ExperimentStatus } from "back-end/types/experiment";
import Tooltip from "../Tooltip";

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
  const minSampleSize = metric?.minSampleSize || defaultMinSampleSize;
  const enoughData = hasEnoughData(baseline, stats, metric);
  const suspiciousChange = isSuspiciousUplift(baseline, stats, metric);
  const belowMinChange = isBelowMinChange(baseline, stats, metric);
  const { ciUpper, ciLower } = useConfidenceLevels();

  const shouldHighlight =
    metric &&
    baseline?.value &&
    stats?.value &&
    enoughData &&
    !suspiciousChange &&
    !belowMinChange;

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
        ) : suspiciousChange ? (
          <div>
            <div className="mb-1">
              <span className="badge badge-pill badge-warning">
                suspicious result
              </span>
            </div>
            <small className="text-muted">value changed too much</small>
          </div>
        ) : (
          <>{percentFormatter.format(chanceToWin)}</>
        )}
      </Tooltip>
    </td>
  );
}
