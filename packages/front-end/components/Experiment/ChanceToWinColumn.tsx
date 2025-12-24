import clsx from "clsx";
import { SnapshotMetric } from "shared/types/experiment-snapshot";
import { HiOutlineExclamationCircle } from "react-icons/hi";
import { DetailedHTMLProps, TdHTMLAttributes } from "react";
import { RowResults } from "@/services/experiments";
import NotEnoughData from "@/components/Experiment/NotEnoughData";
import { GBSuspicious } from "@/components/Icons";
import NoScaledImpact from "@/components/Experiment/NoScaledImpact";

const percentFormatter = new Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 1,
});

interface Props
  extends DetailedHTMLProps<
    TdHTMLAttributes<HTMLTableCellElement>,
    HTMLTableCellElement
  > {
  stats: SnapshotMetric;
  baseline: SnapshotMetric;
  rowResults: RowResults;
  showRisk?: boolean;
  showSuspicious?: boolean;
  showPercentComplete?: boolean;
  showTimeRemaining?: boolean;
  showGuardrailWarning?: boolean;
  className?: string;
  hideScaledImpact?: boolean;
}
export default function ChanceToWinColumn({
  stats,
  baseline,
  rowResults,
  showRisk = true,
  showSuspicious = true,
  showPercentComplete = false,
  showTimeRemaining = true,
  showGuardrailWarning = false,
  className,
  hideScaledImpact = false,
  ...otherProps
}: Props) {
  const shouldRenderRisk =
    showRisk &&
    rowResults.riskMeta.showRisk &&
    ["warning", "danger"].includes(rowResults.riskMeta.riskStatus) &&
    rowResults.resultsStatus !== "lost";
  return (
    <td className={clsx("chance align-middle", className)} {...otherProps}>
      {!baseline?.value || !stats?.value ? (
        <em className="text-muted font-weight-normal">no data</em>
      ) : hideScaledImpact ? (
        <NoScaledImpact />
      ) : !rowResults.enoughData ? (
        <NotEnoughData
          rowResults={rowResults}
          showTimeRemaining={showTimeRemaining}
          showPercentComplete={showPercentComplete}
        />
      ) : (
        <>
          <div className="result-number d-inline-block">
            {percentFormatter.format(stats.chanceToWin ?? 0)}
          </div>
          {shouldRenderRisk ? (
            <span
              className={rowResults.riskMeta.riskStatus}
              style={{ marginLeft: 1, marginBottom: 4 }}
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
        </>
      )}
    </td>
  );
}
