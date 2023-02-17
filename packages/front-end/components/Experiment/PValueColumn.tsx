import clsx from "clsx";
import { FC } from "react";
import { SnapshotMetric } from "back-end/types/experiment-snapshot";
import { MetricInterface } from "back-end/types/metric";
import { ExperimentStatus } from "back-end/types/experiment";
import {
  hasEnoughData,
  isBelowMinChange,
  isSuspiciousUplift,
  shouldHighlight as _shouldHighlight,
  pValueFormatter,
} from "@/services/experiments";
import { useOrganizationMetricDefaults } from "@/hooks/useOrganizationMetricDefaults";
import usePValueThreshold from "@/hooks/usePValueThreshold";
import Tooltip from "../Tooltip/Tooltip";
import NotEnoughData from "./NotEnoughData";

const PValueColumn: FC<{
  metric: MetricInterface;
  status: ExperimentStatus;
  isLatestPhase: boolean;
  startDate: string;
  snapshotDate: Date;
  baseline: SnapshotMetric;
  stats: SnapshotMetric;
}> = ({
  metric,
  status,
  isLatestPhase,
  startDate,
  snapshotDate,
  baseline,
  stats,
}) => {
  const {
    getMinSampleSizeForMetric,
    metricDefaults,
  } = useOrganizationMetricDefaults();
  const pValueThreshold = usePValueThreshold();
  const minSampleSize = getMinSampleSizeForMetric(metric);
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
  const enoughData = hasEnoughData(baseline, stats, metric, metricDefaults);
  const shouldHighlight = _shouldHighlight({
    metric,
    baseline,
    stats,
    hasEnoughData: enoughData,
    suspiciousChange,
    belowMinChange,
  });
  const expectedDirection = metric.inverse
    ? stats.expected < 0
    : stats.expected > 0;
  const statSig = stats.pValue < pValueThreshold;

  let sigText: string | JSX.Element = "";
  let className = "";

  if (shouldHighlight && statSig && expectedDirection) {
    sigText = `Significant win as the p-value is below ${pValueThreshold} and the change is in the desired direction.`;
    className = "won";
  } else if (shouldHighlight && statSig && !expectedDirection) {
    sigText = (
      <>
        Significant loss as the p-value is below {pValueThreshold} and the
        change is <em>not</em> in the desired direction.
      </>
    );
    className = "lost";
  } else if (belowMinChange && statSig) {
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
          <>{pValueFormatter(stats.pValue)}</>
        )}
      </Tooltip>
    </td>
  );
};

export default PValueColumn;
