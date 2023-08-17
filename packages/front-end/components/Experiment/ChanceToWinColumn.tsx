import clsx from "clsx";
import { SnapshotMetric } from "back-end/types/experiment-snapshot";
import { HiOutlineExclamationCircle } from "react-icons/hi";
import { DetailedHTMLProps, TdHTMLAttributes } from "react";
import { RowResults } from "@/services/experiments";
import NotEnoughData from "@/components/Experiment/NotEnoughData";
import { GBSuspicious } from "@/components/Icons";

const percentFormatter = new Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 2,
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
  className?: string;
}
export default function ChanceToWinColumn({
  stats,
  baseline,
  rowResults,
  showRisk = true,
  showSuspicious = true,
  showPercentComplete = false,
  showTimeRemaining = true,
  className,
  ...otherProps
}: Props) {
  return (
    <td
      className={clsx("variation chance result-number align-middle", className)}
      {...otherProps}
    >
      {!baseline?.value || !stats?.value ? (
        <em className="text-gray">no data</em>
      ) : !rowResults.enoughData ? (
        <NotEnoughData
          rowResults={rowResults}
          showTimeRemaining={showTimeRemaining}
          showPercentComplete={showPercentComplete}
          style={{ marginLeft: -20 }}
        />
      ) : (
        <>
          <div className="d-inline-block ml-2" style={{ lineHeight: "14px" }}>
            {percentFormatter.format(stats.chanceToWin ?? 0)}
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
        </>
      )}
    </td>
  );
}
