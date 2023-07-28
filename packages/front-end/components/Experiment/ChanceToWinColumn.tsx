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
  className,
  newUi = false,
}: {
  metric: MetricInterface;
  status: ExperimentStatus;
  isLatestPhase: boolean;
  startDate: string;
  snapshotDate: Date;
  baseline: SnapshotMetric;
  stats: SnapshotMetric;
  className?: string;
  newUi?: boolean;
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
  let statusClassName = "";
  if (shouldHighlight && chanceToWin > ciUpper) {
    sigText = `Significant win as the chance to win is above the ${percentFormatter.format(
      ciUpper
    )} threshold`;
    statusClassName = "won";
  } else if (shouldHighlight && chanceToWin < ciLower) {
    sigText = `Significant loss as the chance to win is below the ${percentFormatter.format(
      ciLower
    )} threshold`;
    statusClassName = "lost";
  }
  if (
    enoughData &&
    belowMinChange &&
    (chanceToWin > ciUpper || chanceToWin < ciLower)
  ) {
    sigText =
      "The change is significant, but too small to matter (below the min detectable change threshold). Consider this a draw.";
    statusClassName += " draw";
  }

  return (
    <td
      className={clsx(
        "variation chance result-number align-middle d-table-cell",
        className,
        statusClassName
      )}
    >
      {enoughData && suspiciousChange && (
        <div>
          <div className="mb-1 d-flex flex-row">
            <Tooltip
              body={
                <div className="text-left" style={{ lineHeight: 1.5 }}>
                  A suspicious result occurs when the percent change is equal to
                  or greater than your maximum percent change (
                  {(metric.maxPercentChange ?? 0) * 100}
                  %).
                </div>
              }
            >
              <span className="badge badge-pill badge-warning">
                Suspicious Result
              </span>
            </Tooltip>
          </div>
        </div>
      )}
      <Tooltip
        body={
          <div className="text-left" style={{ lineHeight: 1.5 }}>
            {sigText}
          </div>
        }
        className="d-block"
        tipPosition={"top"}
        shouldDisplay={sigText !== ""}
      >
        {!baseline?.value || !stats?.value ? (
          <em className={newUi ? "text-gray font-weight-normal" : ""}>
            no data
          </em>
        ) : !enoughData ? (
          <NotEnoughData
            experimentStatus={status}
            isLatestPhase={isLatestPhase}
            baselineValue={baseline?.value}
            variationValue={stats?.value}
            minSampleSize={minSampleSize}
            snapshotCreated={snapshotDate}
            phaseStart={startDate}
            newUi={newUi}
          />
        ) : (
          <>{percentFormatter.format(chanceToWin)}</>
        )}
      </Tooltip>
    </td>
  );
}
