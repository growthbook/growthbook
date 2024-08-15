import clsx from "clsx";
import { SnapshotMetric } from "back-end/types/experiment-snapshot";
import { HiOutlineExclamationCircle } from "react-icons/hi";
import { DetailedHTMLProps, TdHTMLAttributes } from "react";
import { PValueCorrection } from "back-end/types/stats";
import { pValueFormatter, RowResults } from "@front-end/services/experiments";
import NotEnoughData from "@front-end/components/Experiment/NotEnoughData";
import { GBSuspicious } from "@front-end/components/Icons";

interface Props
  extends DetailedHTMLProps<
    TdHTMLAttributes<HTMLTableCellElement>,
    HTMLTableCellElement
  > {
  stats: SnapshotMetric;
  baseline: SnapshotMetric;
  rowResults: RowResults;
  pValueCorrection?: PValueCorrection;
  showRisk?: boolean;
  showSuspicious?: boolean;
  showPercentComplete?: boolean;
  showTimeRemaining?: boolean;
  showUnadjustedPValue?: boolean;
  showGuardrailWarning?: boolean;
  className?: string;
}

export default function PValueColumn({
  stats,
  baseline,
  rowResults,
  pValueCorrection,
  showRisk = true,
  showSuspicious = true,
  showPercentComplete = false,
  showTimeRemaining = true,
  showUnadjustedPValue = false,
  showGuardrailWarning = false,
  className,
  ...otherProps
}: Props) {
  let pValText = (
    <>{stats?.pValue !== undefined ? pValueFormatter(stats.pValue) : ""}</>
  );
  if (stats?.pValueAdjusted !== undefined && pValueCorrection) {
    pValText = showUnadjustedPValue ? (
      <>
        <div>{pValueFormatter(stats.pValueAdjusted)}</div>
        <div className="text-muted">(unadj.:&nbsp;{pValText})</div>
      </>
    ) : (
      <>{pValueFormatter(stats.pValueAdjusted)}</>
    );
  }

  const shouldRenderRisk =
    showRisk &&
    rowResults.riskMeta.showRisk &&
    ["warning", "danger"].includes(rowResults.riskMeta.riskStatus) &&
    rowResults.resultsStatus !== "lost";

  return (
    <td
      className={clsx("variation chance align-middle", className)}
      {...otherProps}
    >
      {!baseline?.value || !stats?.value ? (
        <em className="text-gray font-weight-normal">no data</em>
      ) : !rowResults.enoughData ? (
        <NotEnoughData
          rowResults={rowResults}
          showTimeRemaining={showTimeRemaining}
          showPercentComplete={showPercentComplete}
        />
      ) : (
        <div className="d-flex align-items-center justify-content-end">
          <div className="result-number d-inline-block">
            {pValText || "P-value missing"}
          </div>
          {shouldRenderRisk ? (
            <span
              className={rowResults.riskMeta.riskStatus}
              style={{ marginLeft: 1 }}
            >
              <HiOutlineExclamationCircle />
            </span>
          ) : null}
          {showGuardrailWarning &&
          rowResults.guardrailWarning &&
          !shouldRenderRisk ? (
            <span className="warning" style={{ marginLeft: 1 }}>
              <HiOutlineExclamationCircle />
            </span>
          ) : null}
          {showSuspicious && rowResults.suspiciousChange ? (
            <span className="suspicious" style={{ marginLeft: 1 }}>
              <GBSuspicious />
            </span>
          ) : null}
        </div>
      )}
    </td>
  );
}
