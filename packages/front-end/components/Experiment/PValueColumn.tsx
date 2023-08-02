import clsx from "clsx";
import { SnapshotMetric } from "back-end/types/experiment-snapshot";
import { MetricInterface } from "back-end/types/metric";
import { HiOutlineExclamationCircle } from "react-icons/hi";
import { pValueFormatter, RowResults } from "@/services/experiments";
import NotEnoughData from "@/components/Experiment/NotEnoughData";
import { GBSuspicious } from "@/components/Icons";
import useOrgSettings from "@/hooks/useOrgSettings";

export default function PValueColumn({
  stats,
  baseline,
  rowResults,
  metric,
  showRisk = true,
  showSuspicious = true,
  showPercentComplete = false,
  showTimeRemaining = true,
  showUnadjustedPValue = false,
  className,
}: {
  stats: SnapshotMetric;
  baseline: SnapshotMetric;
  rowResults: RowResults;
  metric: MetricInterface;
  showRisk?: boolean;
  showSuspicious?: boolean;
  showPercentComplete?: boolean;
  showTimeRemaining?: boolean;
  showUnadjustedPValue?: boolean;
  className?: string;
}) {
  // todo: move to snapshot property
  const orgSettings = useOrgSettings();
  const pValueCorrection = orgSettings?.pValueCorrection;

  let pValText = (
    <>{stats?.pValue !== undefined ? pValueFormatter(stats.pValue) : ""}</>
  );
  if (stats?.pValueAdjusted !== undefined && pValueCorrection) {
    pValText = showUnadjustedPValue ? (
      <>
        <div>
          {stats?.pValueAdjusted ? pValueFormatter(stats.pValueAdjusted) : ""}
        </div>
        <div className="small text-muted">(unadj.:&nbsp;{pValText})</div>
      </>
    ) : (
      <>{stats?.pValueAdjusted ? pValueFormatter(stats.pValueAdjusted) : ""}</>
    );
  }

  return (
    <td
      className={clsx(
        "variation chance result-number align-middle",
        rowResults.resultsStatus,
        className
      )}
    >
      {!baseline?.value || !stats?.value ? (
        <em className="text-gray">no data</em>
      ) : !rowResults.enoughData ? (
        <NotEnoughData
          metric={metric}
          rowResults={rowResults}
          showTimeRemaining={showTimeRemaining}
          showPercentComplete={showPercentComplete}
        />
      ) : (
        <div className="d-flex align-items-center justify-content-end">
          <div className="d-inline-block ml-2" style={{ lineHeight: "14px" }}>
            {pValText || "P-value missing"}
          </div>
          {showRisk &&
          rowResults.riskMeta.showRisk &&
          ["warning", "danger"].includes(rowResults.riskMeta.riskStatus) &&
          rowResults.resultsStatus !== "lost" ? (
            <span
              className={rowResults.riskMeta.riskStatus}
              style={{ fontSize: 14, marginLeft: 1 }}
            >
              <HiOutlineExclamationCircle />
            </span>
          ) : null}
          {showSuspicious && rowResults.suspiciousChange ? (
            <span
              className="suspicious"
              style={{ fontSize: 14, marginLeft: 1 }}
            >
              <GBSuspicious />
            </span>
          ) : null}
        </div>
      )}
    </td>
  );
}
