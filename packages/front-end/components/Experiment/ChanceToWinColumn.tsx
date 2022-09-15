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
import useOrgSettings from "../../hooks/useOrgSettings";

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
  const orgSettings = useOrgSettings();

  const minSampleSize =
    metric?.minSampleSize ||
    orgSettings?.metricDefaults?.minimumSampleSize ||
    defaultMinSampleSize;
  const enoughData = hasEnoughData(
    baseline,
    stats,
    metric,
    orgSettings?.metricDefaults
  );
  const suspiciousChange = isSuspiciousUplift(
    baseline,
    stats,
    metric,
    orgSettings?.metricDefaults
  );
  const belowMinChange = isBelowMinChange(
    baseline,
    stats,
    metric,
    orgSettings?.metricDefaults
  );
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
