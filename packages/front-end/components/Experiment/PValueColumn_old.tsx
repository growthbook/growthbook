import clsx from "clsx";
import { FC } from "react";
import { SnapshotMetric } from "back-end/types/experiment-snapshot";
import { ExperimentStatus } from "back-end/types/experiment";
import { PValueCorrection } from "back-end/types/stats";
import { ExperimentMetricInterface } from "shared/experiments";
import {
  hasEnoughData,
  isBelowMinChange,
  isExpectedDirection,
  isStatSig,
  isSuspiciousUplift,
  shouldHighlight as _shouldHighlight,
  pValueFormatter,
} from "@/services/experiments";
import { useOrganizationMetricDefaults } from "@/hooks/useOrganizationMetricDefaults";
import usePValueThreshold from "@/hooks/usePValueThreshold";
import Tooltip from "@/components/Tooltip/Tooltip";
import NotEnoughData_old from "./NotEnoughData_old";

const PValueColumn_old: FC<{
  metric: ExperimentMetricInterface;
  status: ExperimentStatus;
  isLatestPhase: boolean;
  startDate: string;
  snapshotDate: Date;
  baseline: SnapshotMetric;
  stats: SnapshotMetric;
  pValueCorrection?: PValueCorrection;
}> = ({
  metric,
  status,
  isLatestPhase,
  startDate,
  snapshotDate,
  baseline,
  stats,
  pValueCorrection,
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
    belowMinChange,
  });

  const statSig = isStatSig(
    stats.pValueAdjusted ?? stats.pValue ?? 1,
    pValueThreshold
  );
  const expectedDirection = isExpectedDirection(stats, metric);

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
  } else if (enoughData && belowMinChange && statSig) {
    sigText =
      "The change is significant, but too small to matter (below the min detectable change threshold). Consider this a draw.";
    className += " draw";
  }

  let pValText = (
    <>{stats?.pValue !== undefined ? pValueFormatter(stats.pValue) : ""}</>
  );
  if (stats?.pValueAdjusted !== undefined && pValueCorrection) {
    pValText = (
      <>
        <div>
          {stats?.pValueAdjusted !== undefined
            ? pValueFormatter(stats.pValueAdjusted)
            : ""}
        </div>
        <div className="small text-muted">(unadj.: {pValText})</div>
      </>
    );
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
                (metric.maxPercentChange ??
                  metricDefaults?.maxPercentageChange ??
                  0) * 100
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
          <NotEnoughData_old
            experimentStatus={status}
            isLatestPhase={isLatestPhase}
            baselineValue={baseline?.value}
            variationValue={stats?.value}
            minSampleSize={minSampleSize}
            snapshotCreated={snapshotDate}
            phaseStart={startDate}
          />
        ) : (
          <>{pValText || "P-value missing"}</>
        )}
      </Tooltip>
    </td>
  );
};

export default PValueColumn_old;
