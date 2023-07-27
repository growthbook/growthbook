import clsx from "clsx";
import { FC } from "react";
import { SnapshotMetric } from "back-end/types/experiment-snapshot";
import { MetricInterface } from "back-end/types/metric";
import { ExperimentStatus } from "back-end/types/experiment";
import { PValueCorrection } from "back-end/types/stats";
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
  pValueCorrection?: PValueCorrection;
  className?: string;
  newUi?: boolean;
}> = ({
  metric,
  status,
  isLatestPhase,
  startDate,
  snapshotDate,
  baseline,
  stats,
  pValueCorrection,
  className,
  newUi = false,
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

  const statSig = isStatSig(
    stats.pValueAdjusted ?? stats.pValue ?? 1,
    pValueThreshold
  );
  const expectedDirection = isExpectedDirection(stats, metric);

  let sigText: string | JSX.Element = "";
  let statusClassName = "";

  if (shouldHighlight && statSig && expectedDirection) {
    sigText = `Significant win as the p-value is below ${pValueThreshold} and the change is in the desired direction.`;
    statusClassName = "won";
  } else if (shouldHighlight && statSig && !expectedDirection) {
    sigText = (
      <>
        Significant loss as the p-value is below {pValueThreshold} and the
        change is <em>not</em> in the desired direction.
      </>
    );
    statusClassName = "lost";
  } else if (enoughData && belowMinChange && statSig) {
    sigText =
      "The change is significant, but too small to matter (below the min detectable change threshold). Consider this a draw.";
    statusClassName += " draw";
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
                  {(metric.maxPercentChange ??
                    metricDefaults?.maxPercentageChange ??
                    0) * 100}
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
          <em className={newUi ? "text-blue font-weight-normal" : ""}>
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
          <>{pValText || "P-value missing"}</>
        )}
      </Tooltip>
    </td>
  );
};

export default PValueColumn;
